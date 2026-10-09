import {
  ISSUE_SEVERITIES,
  ISSUE_STAGES,
  computeProject,
  daysBetween,
  effortVariance,
  isIssueOpen,
  isIssueOverdue,
  isOverdue,
  todaySection,
  toDateOnly,
  todayPH,
  utilizationPct,
  weekStartOf,
  type DashboardDto,
  type FollowUpContactDto,
  type FollowUpItemDto,
  type FollowUpPersonDto,
  type Health,
  type IssueReportRowDto,
  type IssueSeverity,
  type IssueStage,
  type IssueStatus,
  type IssueSummaryDto,
  type MyProjectRowDto,
  type Party,
  type ProjectStatus,
  type Ref,
  type TaskStatus,
  type TimeType,
} from '@xc8/shared';
import type { FilterQuery, Types } from 'mongoose';
import {
  ClientContactModel,
  ClientModel,
  DocumentModel,
  IssueModel,
  ProjectModel,
  TaskModel,
  TimeEntryModel,
  UserModel,
  type Project,
} from '../models/index.js';
import { projectScopeFilter, type ScopeUser } from './scope.js';

/**
 * Milestone 4 read models: dashboard, My projects, workload and reports. Everything starts from the
 * projects the caller may see (FR-DASH-06, FR-ACL-07): Members only their own projects. Archived
 * projects are left out. Health, forecast and variance are recalculated for today (FR-PRJ-08..10).
 */
type Id = Types.ObjectId;
const OPEN_TASK: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'FOR_REVIEW'];
const MAX_ROWS = 2000;

export interface ScopedProject {
  _id: Id;
  name: string;
  clientId: Id;
  managerId: Id | null;
  memberIds: Id[];
  status: ProjectStatus;
  startDate: Date | null;
  plannedEndDate: Date | null;
  activeContactIds: Id[];
  templateName: string | null;
}
export interface LoadedTask {
  _id: Id;
  projectId: Id;
  name: string;
  status: TaskStatus;
  party: Party;
  ownerId: Id | null;
  clientContactId: Id | null;
  plannedStart: Date | null;
  dueDate: Date | null;
  estHours: number | null;
  actualHours: number;
  mandatory: boolean;
  isMilestone: boolean;
}

export async function scopedProjects(
  user: ScopeUser,
  extra: FilterQuery<Project> = {},
): Promise<ScopedProject[]> {
  const docs = await ProjectModel.find({
    ...projectScopeFilter(user),
    archived: { $ne: true },
    ...extra,
  })
    .select(
      'name clientId managerId memberIds status startDate plannedEndDate activeContactIds templateSnapshot.name',
    )
    .sort({ name: 1 })
    .lean();
  return docs.map((p) => ({
    _id: p._id,
    name: p.name,
    clientId: p.clientId,
    managerId: p.managerId ?? null,
    memberIds: p.memberIds ?? [],
    status: p.status as ProjectStatus,
    startDate: p.startDate ?? null,
    plannedEndDate: p.plannedEndDate ?? null,
    activeContactIds: p.activeContactIds ?? [],
    templateName: p.templateSnapshot?.name ?? null,
  }));
}

export async function tasksOf(projectIds: Id[], extra: FilterQuery<unknown> = {}) {
  if (!projectIds.length) return [] as LoadedTask[];
  const docs = await TaskModel.find({ projectId: { $in: projectIds }, ...extra })
    .select(
      'projectId name status party ownerId clientContactId plannedStart dueDate estHours actualHours mandatory isMilestone order',
    )
    .sort({ projectId: 1, order: 1 })
    .lean();
  return docs.map((t) => ({
    _id: t._id,
    projectId: t.projectId,
    name: t.name,
    status: t.status as TaskStatus,
    party: t.party as Party,
    ownerId: t.ownerId ?? null,
    clientContactId: t.clientContactId ?? null,
    plannedStart: t.plannedStart ?? null,
    dueDate: t.dueDate ?? null,
    estHours: t.estHours ?? null,
    actualHours: t.actualHours ?? 0,
    mandatory: Boolean(t.mandatory),
    isMilestone: Boolean(t.isMilestone),
  }));
}

export async function refMaps(ids: {
  clients?: Id[];
  users?: (Id | null)[];
  contacts?: (Id | null)[];
}) {
  const uniq = (xs: (Id | null | undefined)[] = []) => [
    ...new Set(xs.filter((x): x is Id => Boolean(x)).map(String)),
  ];
  const [clients, users, contacts] = await Promise.all([
    ClientModel.find({ _id: { $in: uniq(ids.clients) } })
      .select('name')
      .lean(),
    UserModel.find({ _id: { $in: uniq(ids.users) } })
      .select('name email active')
      .lean(),
    ClientContactModel.find({ _id: { $in: uniq(ids.contacts) } })
      .select('name active')
      .lean(),
  ]);
  const client = new Map(
    clients.map((c) => [c._id.toString(), { id: c._id.toString(), name: c.name }]),
  );
  const user = new Map(
    users.map((u) => [
      u._id.toString(),
      { id: u._id.toString(), name: u.name, email: u.email, active: Boolean(u.active) },
    ]),
  );
  const contact = new Map(
    contacts.map((c) => [
      c._id.toString(),
      { id: c._id.toString(), name: c.name, active: Boolean(c.active) },
    ]),
  );
  return {
    client: (id: Id): Ref => client.get(id.toString()) ?? { id: id.toString(), name: '' },
    user: (id: Id | null) => (id ? (user.get(id.toString()) ?? null) : null),
    userRef: (id: Id | null): Ref | null => {
      const u = id ? user.get(id.toString()) : null;
      return u ? { id: u.id, name: u.name } : null;
    },
    contact: (id: Id | null) => (id ? (contact.get(id.toString()) ?? null) : null),
  };
}

export const projectRef = (p: { _id: Id; name: string }): Ref => ({
  id: p._id.toString(),
  name: p.name,
});

/** Live health/progress/forecast for a project (FR-PRJ-08..10, Q-08 share of tasks completed). */
export function computeFor(p: ScopedProject, tasks: LoadedTask[], today = todayPH()) {
  const baseline = p.plannedEndDate ?? today;
  const c = computeProject(p.status, baseline, tasks, today);
  return { ...c, baselineEnd: p.plannedEndDate };
}

const isOpen = (t: LoadedTask) => OPEN_TASK.includes(t.status);
const byProject = <T extends { projectId: Id }>(xs: T[]) => {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = x.projectId.toString();
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
};

// ---------- Issues (FR-ISS-16) ----------
interface IssueLite {
  _id: Id;
  projectId: Id;
  key: string;
  title: string;
  severity: IssueSeverity;
  stage: IssueStage;
  status: IssueStatus;
  ownerId: Id | null;
  dueDate: Date | null;
  createdAt: Date;
  resolvedAt: Date | null;
}
export async function issuesOf(projectIds: Id[], extra: FilterQuery<unknown> = {}) {
  if (!projectIds.length) return [] as IssueLite[];
  const docs = await IssueModel.find({ projectId: { $in: projectIds }, ...extra })
    .select('projectId key title severity stage status ownerId dueDate createdAt resolvedAt')
    .sort({ createdAt: -1 })
    .limit(MAX_ROWS)
    .lean();
  return docs.map((d) => ({
    _id: d._id,
    projectId: d.projectId,
    key: d.key,
    title: d.title,
    severity: d.severity as IssueSeverity,
    stage: d.stage as IssueStage,
    status: d.status as IssueStatus,
    ownerId: d.ownerId ?? null,
    dueDate: d.dueDate ?? null,
    createdAt: d.createdAt,
    resolvedAt: d.resolvedAt ?? null,
  }));
}

const daysToResolve = (i: IssueLite) =>
  i.resolvedAt ? Math.max(0, (i.resolvedAt.getTime() - i.createdAt.getTime()) / 86_400_000) : null;

export function summarizeIssues(
  issues: IssueLite[],
  clientOf: (projectId: Id) => Ref,
  today = toDateOnly(todayPH()),
): IssueSummaryDto {
  const open = issues.filter((i) => isIssueOpen(i.status));
  const overdue = (i: IssueLite) =>
    isIssueOverdue(i.dueDate ? toDateOnly(i.dueDate) : null, i.status, today);
  const bySeverity = Object.fromEntries(ISSUE_SEVERITIES.map((s) => [s, 0])) as Record<
    IssueSeverity,
    number
  >;
  const byStage = Object.fromEntries(ISSUE_STAGES.map((s) => [s, 0])) as Record<IssueStage, number>;
  for (const i of open) {
    bySeverity[i.severity] += 1;
    byStage[i.stage] += 1;
  }
  const resolved = issues.map(daysToResolve).filter((d): d is number => d !== null);
  const perClient = new Map<string, { client: Ref; open: number; overdue: number }>();
  for (const i of open) {
    const c = clientOf(i.projectId);
    const row = perClient.get(c.id) ?? { client: c, open: 0, overdue: 0 };
    row.open += 1;
    if (overdue(i)) row.overdue += 1;
    perClient.set(c.id, row);
  }
  return {
    open: open.length,
    overdue: open.filter(overdue).length,
    bySeverity,
    byStage,
    avgDaysToResolve: resolved.length
      ? Math.round((resolved.reduce((a, b) => a + b, 0) / resolved.length) * 10) / 10
      : null,
    resolvedCount: resolved.length,
    perClient: [...perClient.values()].sort(
      (a, b) => b.open - a.open || a.client.name.localeCompare(b.client.name),
    ),
  };
}

export async function issueReportRows(issues: IssueLite[], projects: ScopedProject[]) {
  const pm = new Map(projects.map((p) => [p._id.toString(), p]));
  const refs = await refMaps({
    clients: projects.map((p) => p.clientId),
    users: issues.map((i) => i.ownerId),
  });
  const today = toDateOnly(todayPH());
  return issues.map((i): IssueReportRowDto => {
    const p = pm.get(i.projectId.toString())!;
    const due = i.dueDate ? toDateOnly(i.dueDate) : null;
    const d = daysToResolve(i);
    return {
      id: i._id.toString(),
      key: i.key,
      title: i.title,
      project: projectRef(p),
      client: refs.client(p.clientId),
      severity: i.severity,
      stage: i.stage,
      status: i.status,
      owner: refs.userRef(i.ownerId),
      dueDate: due,
      overdue: isIssueOverdue(due, i.status, today),
      raisedAt: i.createdAt.toISOString(),
      resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
      daysToResolve: d === null ? null : Math.round(d * 10) / 10,
    };
  });
}

// ---------- Time ----------
export async function hoursByType(filter: FilterQuery<unknown>) {
  const rows = await TimeEntryModel.aggregate<{
    _id: { userId: Id; type: TimeType };
    hours: number;
  }>([
    { $match: filter },
    { $group: { _id: { userId: '$userId', type: '$type' }, hours: { $sum: '$hours' } } },
  ]);
  return rows;
}
const WORKING_TYPES: TimeType[] = ['EXECUTION', 'REWORK'];

/** Mon–Sun of the PH week containing `day`. */
export function weekOf(day: Date) {
  const start = weekStartOf(day);
  return { start, end: new Date(start.getTime() + 6 * 86_400_000) };
}

// ---------- Dashboard (FR-DASH-01..06) ----------
export async function dashboard(user: ScopeUser, canSeeTime: boolean): Promise<DashboardDto> {
  const today = todayPH();
  const projects = await scopedProjects(user);
  const ids = projects.map((p) => p._id);
  const tasks = await tasksOf(ids);
  const tByP = byProject(tasks);
  const refs = await refMaps({
    clients: projects.map((p) => p.clientId),
    contacts: tasks.filter((t) => t.party === 'CLIENT').map((t) => t.clientContactId),
  });
  const pById = new Map(projects.map((p) => [p._id.toString(), p]));
  const active = projects.filter((p) => p.status === 'ACTIVE');
  const computed = new Map(
    projects.map((p) => [p._id.toString(), computeFor(p, tByP.get(p._id.toString()) ?? [], today)]),
  );
  const liveTasks = tasks.filter((t) => {
    const s = pById.get(t.projectId.toString())!.status;
    return s === 'ACTIVE' || s === 'PLANNING';
  });
  const overdue = liveTasks.filter((t) => isOverdue(t, today));

  const { start, end } = weekOf(today);
  let hoursThisWeek = 0;
  let teamUtilizationPct: number | null = null;
  if (canSeeTime) {
    const timeFilter: FilterQuery<unknown> = {
      projectId: { $in: ids },
      workDate: { $gte: start, $lte: end },
      ...(user.systemRole === 'MEMBER' ? { userId: user._id } : {}),
    };
    const rows = await hoursByType(timeFilter);
    hoursThisWeek = rows.reduce((n, r) => n + r.hours, 0);
    const working = rows
      .filter((r) => WORKING_TYPES.includes(r._id.type))
      .reduce((n, r) => n + r.hours, 0);
    const people =
      user.systemRole === 'MEMBER'
        ? await UserModel.find({ _id: user._id }).select('weeklyCapacityHours').lean()
        : await UserModel.find({ active: true, systemRole: { $ne: 'VIEWER' } })
            .select('weeklyCapacityHours')
            .lean();
    const capacity = people.reduce((n, u) => n + (u.weeklyCapacityHours ?? 40), 0);
    teamUtilizationPct = utilizationPct(working, capacity);
  }

  const waiting = liveTasks
    .filter((t) => t.party === 'CLIENT' && isOpen(t))
    .sort(
      (a, b) =>
        (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, 50)
    .map((t) => {
      const p = pById.get(t.projectId.toString())!;
      return {
        id: t._id.toString(),
        name: t.name,
        project: projectRef(p),
        client: refs.client(p.clientId),
        contact: refs.contact(t.clientContactId),
        dueDate: t.dueDate ? toDateOnly(t.dueDate) : null,
        daysOverdue: t.dueDate ? daysBetween(t.dueDate, today) : null,
      };
    });

  const horizon = new Date(today.getTime() + 30 * 86_400_000);
  const milestones = liveTasks
    .filter(
      (t) => t.isMilestone && isOpen(t) && t.dueDate && t.dueDate >= today && t.dueDate <= horizon,
    )
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
    .slice(0, 20)
    .map((t) => {
      const p = pById.get(t.projectId.toString())!;
      return {
        id: t._id.toString(),
        name: t.name,
        project: projectRef(p),
        client: refs.client(p.clientId),
        dueDate: toDateOnly(t.dueDate!),
      };
    });

  const issues = await issuesOf(ids);
  const clientOf = (pid: Id) => refs.client(pById.get(pid.toString())!.clientId);

  return {
    kpis: {
      activeProjects: active.length,
      delayedProjects: active.filter((p) => computed.get(p._id.toString())!.health === 'DELAYED')
        .length,
      overdueTasks: overdue.length,
      overdueWaitingOnClient: overdue.filter((t) => t.party === 'CLIENT').length,
      hoursThisWeek: Math.round(hoursThisWeek * 100) / 100,
      teamUtilizationPct,
    },
    activeProjects: active.map((p) => {
      const c = computed.get(p._id.toString())!;
      return {
        id: p._id.toString(),
        name: p.name,
        client: refs.client(p.clientId),
        template: p.templateName,
        status: p.status,
        progress: c.progressPct,
        health: c.health as Health,
        goLive: p.plannedEndDate ? toDateOnly(p.plannedEndDate) : null,
      };
    }),
    waitingOnClient: waiting,
    upcomingMilestones: milestones,
    issues: summarizeIssues(issues, clientOf),
    myProjects: user.systemRole !== 'MEMBER',
  };
}

// ---------- My projects (doc 14 FR-PMV-01..04) ----------
export async function myProjects(user: ScopeUser): Promise<MyProjectRowDto[]> {
  const today = todayPH();
  const projects = await scopedProjects(
    user,
    user.systemRole === 'PROJECT_MANAGER' ? { managerId: user._id } : {},
  );
  const ids = projects.map((p) => p._id);
  const [tasks, issues, docs] = await Promise.all([
    tasksOf(ids),
    issuesOf(ids, { status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT'] } }),
    ids.length
      ? DocumentModel.find({
          projectId: { $in: ids },
          status: 'REQUESTED',
          archived: { $ne: true },
          'requestedFrom.kind': 'CONTACT',
        })
          .select('projectId name dueDate requestedFrom')
          .lean()
      : Promise.resolve([]),
  ]);
  const tByP = byProject(tasks);
  const iByP = byProject(issues);
  const dByP = byProject(
    docs as {
      projectId: Id;
      _id: Id;
      name: string;
      dueDate?: Date | null;
      requestedFrom?: { id?: Id | null } | null;
    }[],
  );
  const refs = await refMaps({
    clients: projects.map((p) => p.clientId),
    users: [...projects.map((p) => p.managerId), ...tasks.map((t) => t.ownerId)],
    contacts: [
      ...tasks.map((t) => t.clientContactId),
      ...(docs as { requestedFrom?: { id?: Id | null } | null }[]).map(
        (d) => d.requestedFrom?.id ?? null,
      ),
    ],
  });

  return projects.map((p) => {
    const pid = p._id.toString();
    const pt = tByP.get(pid) ?? [];
    const c = computeFor(p, pt, today);
    const open = pt.filter(isOpen);
    const overdue = open.filter((t) => isOverdue(t, today));
    const pi = iByP.get(pid) ?? [];
    const href = (t: LoadedTask) => `/projects/${pid}?task=${t._id.toString()}`;

    // FR-PMV-02: internal people with overdue or aging tasks; contacts with overdue items.
    const people = new Map<string, FollowUpPersonDto>();
    const contacts = new Map<string, FollowUpContactDto>();
    if (p.status !== 'ON_HOLD') {
      for (const t of open) {
        const isLate = isOverdue(t, today);
        const aging = !isLate && todaySection(t, today) === 'AGING';
        if (!isLate && !aging) continue;
        const item: FollowUpItemDto = {
          kind: 'TASK',
          id: t._id.toString(),
          name: t.name,
          dueDate: t.dueDate ? toDateOnly(t.dueDate) : null,
          reason: isLate ? 'OVERDUE' : 'AGING',
          href: href(t),
        };
        if (t.party === 'CLIENT') {
          if (!isLate) continue;
          const contact = refs.contact(t.clientContactId);
          if (!contact) continue;
          const row = contacts.get(contact.id) ?? {
            contact,
            overdueTasks: 0,
            overdueDocuments: 0,
            items: [],
          };
          row.overdueTasks += 1;
          row.items.push(item);
          contacts.set(contact.id, row);
        } else {
          const person = refs.user(t.ownerId);
          if (!person) continue;
          const row = people.get(person.id) ?? { person, overdue: 0, aging: 0, items: [] };
          if (isLate) row.overdue += 1;
          else row.aging += 1;
          row.items.push(item);
          people.set(person.id, row);
        }
      }
      for (const d of dByP.get(pid) ?? []) {
        if (!d.dueDate || d.dueDate >= today) continue;
        const contact = refs.contact(d.requestedFrom?.id ?? null);
        if (!contact) continue;
        const row = contacts.get(contact.id) ?? {
          contact,
          overdueTasks: 0,
          overdueDocuments: 0,
          items: [],
        };
        row.overdueDocuments += 1;
        row.items.push({
          kind: 'DOCUMENT',
          id: d._id.toString(),
          name: d.name,
          dueDate: d.dueDate ? toDateOnly(d.dueDate) : null,
          reason: 'OVERDUE',
          href: `/projects/${pid}/documents`,
        });
        contacts.set(contact.id, row);
      }
    }
    const sortPeople = (a: FollowUpPersonDto, b: FollowUpPersonDto) =>
      b.overdue + b.aging - (a.overdue + a.aging) || a.person.name.localeCompare(b.person.name);
    const sortContacts = (a: FollowUpContactDto, b: FollowUpContactDto) =>
      b.overdueTasks + b.overdueDocuments - (a.overdueTasks + a.overdueDocuments) ||
      a.contact.name.localeCompare(b.contact.name);

    return {
      id: pid,
      name: p.name,
      client: refs.client(p.clientId),
      manager: refs.userRef(p.managerId),
      status: p.status,
      health: c.health as Health,
      progress: c.progressPct,
      baselineEnd: p.plannedEndDate ? toDateOnly(p.plannedEndDate) : null,
      forecastEnd: toDateOnly(c.forecastEnd),
      daysLate: p.plannedEndDate ? c.scheduleVarianceDays : 0,
      overdueTasks: overdue.length,
      blockedTasks: open.filter((t) => t.status === 'BLOCKED').length,
      openIssues: pi.length,
      openCriticalHighIssues: pi.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH')
        .length,
      waitingOnClient:
        open.filter((t) => t.party === 'CLIENT').length + (dByP.get(pid)?.length ?? 0),
      followUps: {
        people: [...people.values()].sort(sortPeople),
        contacts: [...contacts.values()].sort(sortContacts),
      },
    };
  });
}

export { WORKING_TYPES, OPEN_TASK, MAX_ROWS, byProject, effortVariance };
