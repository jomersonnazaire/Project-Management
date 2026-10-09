import {
  HOURS_NOT_A_SCORE_NOTE,
  ISSUE_SEVERITIES,
  ISSUE_STAGES,
  PARTIES,
  HEALTH_VALUES,
  TIME_TYPES,
  daysBetween,
  effortVariance,
  isOverdue,
  parseDateOnly,
  todayPH,
  toDateOnly,
  utilizationPct,
  type EffortRowDto,
  type IssueReportDto,
  type MyProjectsDto,
  type OverdueRowDto,
  type ProjectStatusRowDto,
  type ReportList,
  type TimeType,
  type TimesheetReportDto,
  type WorkloadDto,
  type WorkloadRowDto,
} from '@xc8/shared';
import { Types, type FilterQuery } from 'mongoose';
import type { Request } from 'express';
import { z } from 'zod';
import { perm, type RouteRegistry } from '../access/registry.js';
import { forbidden } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import { audit } from '../services/audit.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import { TaskModel, TeamModel, TimeEntryModel, UserModel } from '../models/index.js';
import {
  MAX_ROWS,
  OPEN_TASK,
  WORKING_TYPES,
  byProject,
  computeFor,
  dashboard,
  issueReportRows,
  issuesOf,
  myProjects,
  projectRef,
  refMaps,
  scopedProjects,
  summarizeIssues,
  tasksOf,
  weekOf,
  type ScopedProject,
} from '../services/reports.js';

/**
 * Milestone 4 (FR-DASH, FR-PMV, FR-WL, FR-RPT, FR-ISS-16). The dashboard and the reports need
 * Reports View, report exports Reports Export, and workload Team & workload View (doc 11 v0.4.8). Every route only ever reads projects inside the caller's scope (FR-DASH-06). Reports return the rows for
 * the current filters; the web app exports exactly those rows to CSV (FR-RPT-05, AC-22.2).
 */
const id = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const projectFilters = z.object({ projectId: id.optional(), clientId: id.optional() });

function narrow(projects: ScopedProject[], f: { projectId?: string; clientId?: string }) {
  return projects.filter(
    (p) =>
      (!f.projectId || p._id.toString() === f.projectId) &&
      (!f.clientId || p.clientId.toString() === f.clientId),
  );
}

export function reportsRouter(registry: RouteRegistry) {
  const d = registry.router('/dashboard');

  d.get('/', perm('reports', 'view'), async (req, res) => {
    res.json(await dashboard(currentUser(req), currentPermissions(req).time.view));
  });

  // FR-PMV-04: PMs see the projects they manage, Admins and Viewers all; Members don't get it.
  d.get('/my-projects', perm('reports', 'view'), async (req, res) => {
    const user = currentUser(req);
    if (user.systemRole === 'MEMBER') throw forbidden();
    const body: MyProjectsDto = { items: await myProjects(user) };
    res.json(body);
  });

  const w = registry.router('/workload');
  // FR-WL-01..03: one row per person for the selected week. Gated by Team & workload View (doc 11
  // v0.4.8); the scope stays fixed in code: Members only see their own row, tasks only count in
  // projects the caller can see, and recorded hours need View on time.
  w.get('/', perm('workload', 'view'), async (req, res) => {
    const q = parseQuery(z.object({ week: day.optional(), teamId: id.optional() }), req);
    const user = currentUser(req);
    const { start, end } = weekOf(q.week ? parseDateOnly(q.week) : todayPH());
    const people = await UserModel.find({
      active: true,
      systemRole: { $ne: 'VIEWER' },
      ...(user.systemRole === 'MEMBER' ? { _id: user._id } : {}),
      ...(q.teamId ? { teamIds: new Types.ObjectId(q.teamId) } : {}),
    })
      .select('name email active jobRole teamIds weeklyCapacityHours')
      .sort({ name: 1 })
      .lean();
    const ids = people.map((p) => p._id);
    const projects = await scopedProjects(user);
    const pids = projects.map((p) => p._id);
    const [tasks, time, teams] = await Promise.all([
      TaskModel.find({
        projectId: { $in: pids },
        ownerId: { $in: ids },
        status: { $in: OPEN_TASK },
        dueDate: { $gte: start, $lte: end },
      })
        .select('ownerId estHours actualHours')
        .lean(),
      currentPermissions(req).time.view
        ? TimeEntryModel.aggregate<{
            _id: { userId: Types.ObjectId; type: TimeType };
            hours: number;
          }>([
            {
              $match: {
                userId: { $in: ids },
                workDate: { $gte: start, $lte: end },
                taskId: { $ne: null },
              },
            },
            { $group: { _id: { userId: '$userId', type: '$type' }, hours: { $sum: '$hours' } } },
          ])
        : Promise.resolve([]),
      TeamModel.find({ _id: { $in: people.flatMap((p) => p.teamIds ?? []) } })
        .select('name')
        .lean(),
    ]);
    const teamName = new Map(teams.map((t) => [t._id.toString(), t.name]));
    const items = people.map((p): WorkloadRowDto => {
      const pid = p._id.toString();
      const assigned = tasks
        .filter((t) => t.ownerId?.toString() === pid)
        .reduce((n, t) => n + Math.max((t.estHours ?? 0) - (t.actualHours ?? 0), 0), 0);
      const mine = time.filter((t) => t._id.userId.toString() === pid);
      const recorded = mine
        .filter((t) => WORKING_TYPES.includes(t._id.type))
        .reduce((n, t) => n + t.hours, 0);
      const waiting = mine.filter((t) => t._id.type === 'WAITING').reduce((n, t) => n + t.hours, 0);
      const capacity = p.weeklyCapacityHours ?? 40;
      const assignedPct = utilizationPct(assigned, capacity);
      return {
        person: { id: pid, name: p.name, email: p.email, active: Boolean(p.active) },
        jobRole: p.jobRole,
        teams: (p.teamIds ?? []).map((t) => ({
          id: t.toString(),
          name: teamName.get(t.toString()) ?? '',
        })),
        capacityHours: capacity,
        assignedHours: Math.round(assigned * 100) / 100,
        recordedHours: Math.round(recorded * 100) / 100,
        waitingHours: Math.round(waiting * 100) / 100,
        utilizationPct: utilizationPct(recorded, capacity),
        assignedPct,
        overAssigned: (assignedPct ?? 0) > 100,
      };
    });
    const body: WorkloadDto = {
      weekStart: toDateOnly(start),
      weekEnd: toDateOnly(end),
      items,
      note: HOURS_NOT_A_SCORE_NOTE,
    };
    res.json(body);
  });

  const r = registry.router('/reports');

  /**
   * Each report answers on two routes with the same rows and the same scope: `/reports/<name>`
   * needs Reports View, `/reports/<name>/export` needs Reports Export and is audited (FR-ACL-16).
   * The web app builds the CSV from the export route's rows.
   */
  function report(name: string, build: (req: Request) => Promise<{ items: unknown[] }>) {
    r.get(`/${name}`, perm('reports', 'view'), async (req, res) => {
      res.json(await build(req));
    });
    r.get(`/${name}/export`, perm('reports', 'export'), async (req, res) => {
      const body = await build(req);
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'report',
        entityId: new Types.ObjectId(),
        action: 'report_exported',
        meta: { report: name, filters: req.query, rows: body.items.length },
      });
      res.json(body);
    });
  }

  // FR-RPT-01: effort variance per task (EC-58: tasks without an estimate have no variance).
  report('effort-variance', async (req) => {
    const q = parseQuery(projectFilters.extend({ ownerId: id.optional() }), req);
    const projects = narrow(await scopedProjects(currentUser(req)), q);
    const tasks = (
      await tasksOf(
        projects.map((p) => p._id),
        {
          status: { $ne: 'CANCELLED' },
          ...(q.ownerId ? { ownerId: new Types.ObjectId(q.ownerId) } : {}),
        },
      )
    )
      .filter((t) => t.estHours !== null || t.actualHours > 0)
      .slice(0, MAX_ROWS);
    const pm = new Map(projects.map((p) => [p._id.toString(), p]));
    const refs = await refMaps({
      clients: projects.map((p) => p.clientId),
      users: tasks.map((t) => t.ownerId),
    });
    const body: ReportList<EffortRowDto> = {
      items: tasks.map((t) => {
        const p = pm.get(t.projectId.toString())!;
        const v = effortVariance(t);
        return {
          id: t._id.toString(),
          name: t.name,
          project: projectRef(p),
          client: refs.client(p.clientId),
          owner: refs.userRef(t.ownerId),
          status: t.status,
          estHours: t.estHours,
          actualHours: t.actualHours,
          variance: v.variance,
          overrunPct: v.overrunPct === null ? null : Math.round(v.overrunPct * 10) / 10,
        };
      }),
    };
    return body;
  });

  // FR-RPT-02: overdue tasks, filtered by project, client, owner, party and due-date range.
  report('overdue', async (req) => {
    const q = parseQuery(
      projectFilters.extend({
        ownerId: id.optional(),
        party: z.enum(PARTIES).optional(),
        from: day.optional(),
        to: day.optional(),
      }),
      req,
    );
    const today = todayPH();
    const projects = narrow(await scopedProjects(currentUser(req)), q).filter(
      (p) => p.status === 'ACTIVE' || p.status === 'PLANNING',
    );
    const due: FilterQuery<unknown> = { $lt: today };
    if (q.from) due.$gte = parseDateOnly(q.from);
    if (q.to && parseDateOnly(q.to) < today) due.$lt = new Date(parseDateOnly(q.to).getTime() + 1);
    const tasks = (
      await tasksOf(
        projects.map((p) => p._id),
        {
          status: { $in: OPEN_TASK },
          dueDate: due,
          ...(q.ownerId ? { ownerId: new Types.ObjectId(q.ownerId) } : {}),
          ...(q.party ? { party: q.party } : {}),
        },
      )
    )
      .filter((t) => isOverdue(t, today))
      .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
      .slice(0, MAX_ROWS);
    const pm = new Map(projects.map((p) => [p._id.toString(), p]));
    const refs = await refMaps({
      clients: projects.map((p) => p.clientId),
      users: tasks.map((t) => t.ownerId),
      contacts: tasks.map((t) => t.clientContactId),
    });
    const body: ReportList<OverdueRowDto> = {
      items: tasks.map((t) => {
        const p = pm.get(t.projectId.toString())!;
        const c = refs.contact(t.clientContactId);
        return {
          id: t._id.toString(),
          name: t.name,
          project: projectRef(p),
          client: refs.client(p.clientId),
          owner: refs.userRef(t.ownerId),
          party: t.party,
          contact: c ? { id: c.id, name: c.name } : null,
          status: t.status,
          dueDate: toDateOnly(t.dueDate!),
          daysOverdue: daysBetween(t.dueDate!, today),
        };
      }),
    };
    return body;
  });

  // FR-RPT-03: time entries by user/project/date range with totals by entry type. Needs View on
  // time; Members only ever see their own entries (07 §4).
  report('timesheets', async (req) => {
    if (!currentPermissions(req).time.view) throw forbidden();
    const q = parseQuery(
      projectFilters.extend({ userId: id.optional(), from: day.optional(), to: day.optional() }),
      req,
    );
    const user = currentUser(req);
    const projects = narrow(await scopedProjects(user), q);
    const filter: FilterQuery<unknown> = { projectId: { $in: projects.map((p) => p._id) } };
    if (user.systemRole === 'MEMBER') filter.userId = user._id;
    else if (q.userId) filter.userId = new Types.ObjectId(q.userId);
    if (q.from || q.to) {
      filter.workDate = {
        ...(q.from ? { $gte: parseDateOnly(q.from) } : {}),
        ...(q.to ? { $lte: parseDateOnly(q.to) } : {}),
      };
    }
    const entries = await TimeEntryModel.find(filter)
      .sort({ workDate: 1, createdAt: 1 })
      .limit(MAX_ROWS)
      .lean();
    const pm = new Map(projects.map((p) => [p._id.toString(), p]));
    const [refs, tasks] = await Promise.all([
      refMaps({ users: entries.map((e) => e.userId) }),
      TaskModel.find({ _id: { $in: entries.map((e) => e.taskId) } })
        .select('name')
        .lean(),
    ]);
    const taskName = new Map(tasks.map((t) => [t._id.toString(), t.name]));
    const totals = Object.fromEntries([
      ...TIME_TYPES.map((t) => [t, 0]),
      ['all', 0],
    ]) as TimesheetReportDto['totals'];
    const items = entries.map((e) => {
      const type = e.type as TimeType;
      totals[type] += e.hours;
      totals.all += e.hours;
      return {
        id: e._id.toString(),
        workDate: toDateOnly(e.workDate),
        user: refs.userRef(e.userId) ?? { id: e.userId.toString(), name: 'Unknown user' },
        project: projectRef(pm.get(e.projectId!.toString())!),
        task: {
          id: e.taskId!.toString(),
          name: taskName.get(e.taskId!.toString()) ?? '(deleted task)',
        },
        type,
        hours: e.hours,
        note: e.notes ?? null,
      };
    });
    for (const k of Object.keys(totals) as (keyof typeof totals)[])
      totals[k] = Math.round(totals[k] * 100) / 100;
    const body: TimesheetReportDto = { items, totals };
    return body;
  });

  // FR-RPT-04: project status: progress, health, baseline vs forecast, overdue, blocked, client items.
  report('project-status', async (req) => {
    const q = parseQuery(projectFilters.extend({ health: z.enum(HEALTH_VALUES).optional() }), req);
    const today = todayPH();
    const projects = narrow(await scopedProjects(currentUser(req)), q);
    const tByP = byProject(await tasksOf(projects.map((p) => p._id)));
    const refs = await refMaps({ clients: projects.map((p) => p.clientId) });
    const items = projects
      .map((p): ProjectStatusRowDto => {
        const tasks = tByP.get(p._id.toString()) ?? [];
        const c = computeFor(p, tasks, today);
        const open = tasks.filter((t) => OPEN_TASK.includes(t.status));
        return {
          id: p._id.toString(),
          name: p.name,
          client: refs.client(p.clientId),
          status: p.status,
          progress: c.progressPct,
          health: c.health,
          baselineEnd: p.plannedEndDate ? toDateOnly(p.plannedEndDate) : null,
          forecastEnd: toDateOnly(c.forecastEnd),
          varianceDays: p.plannedEndDate ? c.scheduleVarianceDays : 0,
          overdueTasks: open.filter((t) => isOverdue(t, today)).length,
          blockedTasks: open.filter((t) => t.status === 'BLOCKED').length,
          pendingClientItems: open.filter((t) => t.party === 'CLIENT').length,
        };
      })
      .filter((row) => !q.health || row.health === q.health);
    const body: ReportList<ProjectStatusRowDto> = { items };
    return body;
  });

  // FR-ISS-16: open issues by severity and stage, overdue issues, average time to resolve, per client.
  report('issues', async (req) => {
    if (!currentPermissions(req).issues.view) throw forbidden();
    const q = parseQuery(
      projectFilters.extend({
        severity: z.enum(ISSUE_SEVERITIES).optional(),
        stage: z.enum(ISSUE_STAGES).optional(),
        from: day.optional(),
        to: day.optional(),
      }),
      req,
    );
    const projects = narrow(await scopedProjects(currentUser(req)), q);
    const raised: FilterQuery<unknown> = {};
    if (q.from) raised.$gte = new Date(`${q.from}T00:00:00+08:00`);
    if (q.to) raised.$lt = new Date(new Date(`${q.to}T00:00:00+08:00`).getTime() + 86_400_000);
    const issues = await issuesOf(
      projects.map((p) => p._id),
      {
        ...(q.severity ? { severity: q.severity } : {}),
        ...(q.stage ? { stage: q.stage } : {}),
        ...(q.from || q.to ? { createdAt: raised } : {}),
      },
    );
    const items = await issueReportRows(issues, projects);
    const pm = new Map(projects.map((p) => [p._id.toString(), p]));
    const refs = await refMaps({ clients: projects.map((p) => p.clientId) });
    const body: IssueReportDto = {
      items,
      summary: summarizeIssues(issues, (pid) => refs.client(pm.get(pid.toString())!.clientId)),
    };
    return body;
  });

  return [d.router, w.router, r.router];
}
