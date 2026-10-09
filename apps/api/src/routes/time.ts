import {
  DAY_LOCKED,
  OPEN_TASK_STATUSES,
  addDays,
  dailyCapMessage,
  describeTimeLock,
  parseDateOnly,
  timeEntrySchema,
  timeWeekQuerySchema,
  toDateOnly,
  todayPH,
  updateTimeEntrySchema,
  weekStartOf,
  type LoggableTaskDto,
  type TimeEntryDto,
  type TimeType,
  type TimeWeekDto,
} from '@xc8/shared';
import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AUTHENTICATED, perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { unprocessable } from '../lib/http422.js';
import { idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import {
  LookupModel,
  ProjectModel,
  TaskModel,
  TimeEntryModel,
  UserModel,
  type TimeEntry,
} from '../models/index.js';
import { assertLookup, getOrCreateDay, loadDay, touchDay } from '../services/tracker.js';
import { audit } from '../services/audit.js';
import { currentLockBoundary, loadTimeLock } from '../services/timeLock.js';
import { recomputeProject } from '../services/projectService.js';
import { isProjectMember, type ScopeUser } from '../services/scope.js';
import { loadProject } from './projects.js';

/**
 * Time logging (FR-TIME-01..08). Users log their own time to tasks of projects they're on; the
 * server enforces the 24 h/day cap, no future dates, the weekly lock, and blocks Cancelled tasks
 * and projects that are On Hold, Completed, Cancelled or archived. Task actual hours are the sum of
 * every entry on the task (FR-TIME-07).
 */
type Id = Types.ObjectId;
type EntryDoc = TimeEntry & { _id: Id; createdAt?: Date };

const CLOSED_PROJECT = new Set(['ON_HOLD', 'COMPLETED', 'CANCELLED']);
const canBypassLock = (u: ScopeUser) =>
  u.systemRole === 'ADMIN' || u.systemRole === 'PROJECT_MANAGER';

export async function recomputeActualHours(taskId: Id) {
  const [sum] = await TimeEntryModel.aggregate<{ total: number }>([
    { $match: { taskId } },
    { $group: { _id: null, total: { $sum: '$hours' } } },
  ]);
  await TaskModel.updateOne({ _id: taskId }, { $set: { actualHours: sum?.total ?? 0 } });
}

async function toDtos(entries: EntryDoc[]): Promise<TimeEntryDto[]> {
  const lookupIds = entries.flatMap((e) => [e.activityTypeId, e.moduleId]).filter(Boolean);
  const [projects, tasks, users, lookups] = await Promise.all([
    ProjectModel.find({ _id: { $in: entries.map((e) => e.projectId) } })
      .select('name')
      .lean(),
    TaskModel.find({ _id: { $in: entries.map((e) => e.taskId) } })
      .select('name')
      .lean(),
    UserModel.find({ _id: { $in: entries.map((e) => e.userId) } })
      .select('name')
      .lean(),
    LookupModel.find({ _id: { $in: lookupIds } })
      .select('name')
      .lean(),
  ]);
  const name = (list: { _id: Id; name: string }[]) =>
    new Map(list.map((x) => [x._id.toString(), x.name]));
  const [pn, tn, un, ln] = [name(projects), name(tasks), name(users), name(lookups)];
  const ref = (id: Id | null | undefined) =>
    id ? { id: id.toString(), name: ln.get(id.toString()) ?? '' } : null;
  const boundary = await currentLockBoundary();
  return entries.map((e) => ({
    id: e._id.toString(),
    user: { id: e.userId.toString(), name: un.get(e.userId.toString()) ?? 'Unknown user' },
    project: { id: String(e.projectId), name: pn.get(String(e.projectId)) ?? '' },
    task: { id: String(e.taskId), name: tn.get(String(e.taskId)) ?? '(deleted task)' },
    workDate: toDateOnly(e.workDate),
    hours: e.hours,
    minutes: e.startAt && e.minutes != null ? e.minutes : Math.round(e.hours * 60),
    timed: Boolean(e.startAt),
    activityType: ref(e.activityTypeId),
    module: ref(e.moduleId),
    billable: e.billable ?? true,
    type: (e.type ?? 'EXECUTION') as TimeType,
    notes: e.notes ?? null,
    locked: e.workDate < boundary,
    createdAt: (e.createdAt ?? new Date()).toISOString(),
  }));
}

/** Checks the work date and the 24 h/day cap for `userId` (excluding `ignoreId`). */
async function assertDateAndCap(user: ScopeUser, workDate: Date, hours: number, ignoreId?: Id) {
  if (workDate > todayPH()) {
    throw badRequest(
      "Work date can't be in the future.",
      [{ path: 'workDate', message: "Work date can't be in the future." }],
      'VALIDATION_ERROR',
    );
  }
  if (workDate < (await currentLockBoundary()) && !canBypassLock(user)) {
    throw unprocessable(
      'That week is locked. Ask your project manager to change it.',
      'TIME_LOCKED',
    );
  }
  // Doc 14 FR-ACT-12: a submitted day is read-only for its owner, whatever their role.
  if ((await loadDay(user._id, workDate))?.status === 'SUBMITTED') {
    throw unprocessable(DAY_LOCKED, 'DAY_LOCKED');
  }
  const [sum] = await TimeEntryModel.aggregate<{ total: number }>([
    { $match: { userId: user._id, workDate, ...(ignoreId ? { _id: { $ne: ignoreId } } : {}) } },
    { $group: { _id: null, total: { $sum: '$hours' } } },
  ]);
  const total = Math.round(((sum?.total ?? 0) + hours) * 60);
  if (total > 24 * 60) {
    throw unprocessable(dailyCapMessage(toDateOnly(workDate), total), 'DAILY_LIMIT');
  }
}

export async function loadLoggableTask(req: Request, taskId: string) {
  const user = currentUser(req);
  const task = await TaskModel.findById(taskId);
  if (!task) throw notFound();
  const project = await loadProject(req, 'view', task.projectId.toString());
  // FR-TIME-02: only projects the user is on (manager or member), whatever their role.
  if (!isProjectMember(user, project)) {
    throw forbidden('You can only log time on projects you are a member of.', 'NOT_A_MEMBER');
  }
  if (project.archived || CLOSED_PROJECT.has(project.status)) {
    throw unprocessable(
      'Time can’t be logged on a project that is on hold, completed, cancelled or archived.',
      'PROJECT_CLOSED',
    );
  }
  if (task.status === 'CANCELLED') {
    throw unprocessable('Time can’t be logged on a cancelled task.', 'TASK_CANCELLED');
  }
  return { task, project };
}

export function timeRouter(registry: RouteRegistry) {
  const r = registry.router('/time');

  // FR-TIME-05: my entries for one week (Mon–Sun), with totals vs capacity.
  r.get('/', perm('time', 'view'), async (req, res) => {
    const q = parseQuery(timeWeekQuerySchema, req);
    const user = currentUser(req);
    const start = weekStartOf(q.week ? parseDateOnly(q.week) : todayPH());
    const end = addDays(start, 6);
    // Project time only; quick activities live on the Day timesheet (doc 14 FR-ACT-10).
    const entries = (await TimeEntryModel.find({
      userId: user._id,
      workDate: { $gte: start, $lte: end },
      taskId: { $ne: null },
      running: { $ne: true },
    })
      .sort({ workDate: 1, createdAt: 1 })
      .lean()) as EntryDoc[];
    const items = await toDtos(entries);
    const body: TimeWeekDto = {
      weekStart: toDateOnly(start),
      weekEnd: toDateOnly(end),
      items,
      total: items.reduce((s, e) => s + e.hours, 0),
      capacity: user.weeklyCapacityHours ?? 40,
      lockDescription: describeTimeLock((await loadTimeLock()).policy),
    };
    res.json(body);
  });

  // The Log time form's choices: open tasks on active projects the user is on.
  r.get('/options', perm('time', 'create'), async (req, res) => {
    const user = currentUser(req);
    const projects = await ProjectModel.find({
      $or: [{ memberIds: user._id }, { managerId: user._id }],
      archived: { $ne: true },
      status: { $nin: [...CLOSED_PROJECT] },
    })
      .select('name')
      .sort({ name: 1 })
      .lean();
    const tasks = await TaskModel.find({
      projectId: { $in: projects.map((p) => p._id) },
      status: { $ne: 'CANCELLED' },
    })
      .select('name phase projectId status order')
      .sort({ order: 1 })
      .lean();
    const items: LoggableTaskDto[] = projects.map((p) => ({
      project: { id: p._id.toString(), name: p.name },
      tasks: tasks
        .filter((t) => t.projectId.equals(p._id))
        .sort(
          (a, b) =>
            Number(!(OPEN_TASK_STATUSES as string[]).includes(a.status)) -
            Number(!(OPEN_TASK_STATUSES as string[]).includes(b.status)),
        )
        .map((t) => ({ id: t._id.toString(), name: t.name, phase: t.phase ?? null })),
    }));
    res.json({ items });
  });

  r.post('/', perm('time', 'create'), async (req, res) => {
    const input = parseBody(timeEntrySchema, req);
    const user = currentUser(req);
    const { task, project } = await loadLoggableTask(req, input.taskId);
    const workDate = parseDateOnly(input.workDate);
    const activityTypeId = await assertLookup(
      input.activityTypeId,
      'ACTIVITY_TYPE',
      'activityTypeId',
    );
    const moduleId = await assertLookup(input.moduleId, 'MODULE', 'moduleId');
    let locationId = input.locationId
      ? await assertLookup(input.locationId, 'LOCATION', 'locationId')
      : null;
    await assertDateAndCap(user, workDate, input.hours);
    // FR-ACT-17: the first entry of a day sets the day's location; later ones inherit it.
    if (locationId) {
      const day = await getOrCreateDay(user._id, workDate);
      if (!day.locationId) {
        day.locationId = locationId;
        await day.save();
        locationId = null;
      } else if (day.locationId.equals(locationId)) locationId = null;
    }
    const entry = await TimeEntryModel.create({
      userId: user._id,
      kind: 'TASK',
      projectId: project._id,
      taskId: task._id,
      workDate,
      hours: input.hours,
      type: input.type,
      notes: input.notes || null,
      activityTypeId,
      moduleId,
      locationId,
      billable: input.billable,
    });
    await touchDay(user._id, workDate);
    await recomputeActualHours(task._id);
    await recomputeProject(project._id);
    await audit({
      actorId: user._id,
      entityType: 'time',
      entityId: entry._id,
      projectId: project._id,
      action: 'time_logged',
      changes: [{ field: 'hours', old: null, new: input.hours }],
      meta: { taskId: task._id.toString(), workDate: input.workDate, type: input.type },
    });
    const [dto] = await toDtos([entry.toObject() as EntryDoc]);
    res.status(201).json({ entry: dto });
  });

  // FR-TIME-06: own unlocked entries only (PM/Admin may also change their own locked ones).
  async function loadOwn(req: Request) {
    const entry = await TimeEntryModel.findById(idParam(req));
    const user = currentUser(req);
    if (!entry || !entry.userId.equals(user._id)) throw notFound();
    if ((await loadDay(user._id, entry.workDate))?.status === 'SUBMITTED') {
      throw unprocessable(DAY_LOCKED, 'DAY_LOCKED');
    }
    if (entry.workDate < (await currentLockBoundary()) && !canBypassLock(user)) {
      throw unprocessable(
        'That week is locked. Ask your project manager to change it.',
        'TIME_LOCKED',
      );
    }
    return entry;
  }

  r.patch('/:id', perm('time', 'edit'), async (req, res) => {
    const input = parseBody(updateTimeEntrySchema, req);
    const entry = await loadOwn(req);
    if (!entry.taskId) throw notFound();
    if (entry.startAt && (input.hours !== undefined || input.workDate !== undefined)) {
      throw unprocessable(
        'This entry was timed. Change its time in and time out on the Day timesheet.',
        'TIMED_ENTRY',
      );
    }
    await loadLoggableTask(req, entry.taskId.toString());
    const before = {
      workDate: toDateOnly(entry.workDate),
      hours: entry.hours,
      type: entry.type,
      notes: entry.notes,
    };
    const workDate = input.workDate ? parseDateOnly(input.workDate) : entry.workDate;
    const hours = input.hours ?? entry.hours;
    await assertDateAndCap(currentUser(req), workDate, hours, entry._id);
    entry.workDate = workDate;
    entry.hours = hours;
    if (input.type) entry.type = input.type;
    if (input.notes !== undefined) entry.notes = input.notes || null;
    if (input.activityTypeId) {
      entry.activityTypeId = await assertLookup(
        input.activityTypeId,
        'ACTIVITY_TYPE',
        'activityTypeId',
        entry.activityTypeId,
      );
    }
    if (input.moduleId) {
      entry.moduleId = await assertLookup(input.moduleId, 'MODULE', 'moduleId', entry.moduleId);
    }
    if (input.locationId !== undefined) {
      entry.locationId = input.locationId
        ? await assertLookup(input.locationId, 'LOCATION', 'locationId', entry.locationId)
        : null;
    }
    if (input.billable !== undefined) entry.billable = input.billable;
    const oldDate = before.workDate;
    await entry.save();
    await touchDay(entry.userId, entry.workDate);
    if (oldDate !== toDateOnly(entry.workDate))
      await touchDay(entry.userId, parseDateOnly(oldDate));
    await recomputeActualHours(entry.taskId);
    await recomputeProject(entry.projectId!);
    const after = {
      workDate: toDateOnly(entry.workDate),
      hours: entry.hours,
      type: entry.type,
      notes: entry.notes,
    };
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'time',
      entityId: entry._id,
      projectId: entry.projectId,
      action: 'time_updated',
      changes: (Object.keys(before) as (keyof typeof before)[])
        .filter((k) => before[k] !== after[k])
        .map((k) => ({ field: k, old: before[k], new: after[k] })),
    });
    const [dto] = await toDtos([entry.toObject() as EntryDoc]);
    res.json({ entry: dto });
  });

  // DEF-005: someone else's entry (any project) is "not found" before the Delete permission is
  // checked, so a 403 never confirms that the entry exists. The access rules still apply (403).
  r.delete('/:id', AUTHENTICATED, async (req, res) => {
    const found = await TimeEntryModel.findById(idParam(req)).select('userId').lean();
    if (!found || !found.userId.equals(currentUser(req)._id)) throw notFound();
    if (!currentPermissions(req).time.delete) throw forbidden();
    const entry = await loadOwn(req);
    await entry.deleteOne();
    await touchDay(entry.userId, entry.workDate);
    if (entry.taskId) await recomputeActualHours(entry.taskId);
    if (entry.projectId) await recomputeProject(entry.projectId);
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'time',
      entityId: entry._id,
      projectId: entry.projectId,
      action: 'time_deleted',
      changes: [{ field: 'hours', old: entry.hours, new: null }],
      meta: { taskId: entry.taskId?.toString() ?? null, workDate: toDateOnly(entry.workDate) },
    });
    res.status(204).end();
  });

  // Project Time tab: PMs and Admins see everyone's entries; others only their own (fixed scope).
  const p = registry.router('/projects');
  p.get('/:id/time', perm('time', 'view'), async (req, res) => {
    const project = await loadProject(req, 'view');
    const user = currentUser(req);
    const all = user.systemRole === 'ADMIN' || user.systemRole === 'PROJECT_MANAGER';
    const entries = (await TimeEntryModel.find({
      projectId: project._id,
      running: { $ne: true },
      ...(all ? {} : { userId: user._id }),
    })
      .sort({ workDate: -1, createdAt: -1 })
      .limit(1000)
      .lean()) as EntryDoc[];
    const items = await toDtos(entries);
    const byType = { EXECUTION: 0, WAITING: 0, REWORK: 0 } as Record<TimeType, number>;
    for (const e of items) byType[e.type] += e.hours;
    res.json({
      items,
      total: items.reduce((s, e) => s + e.hours, 0),
      byType,
      scope: all ? 'ALL' : 'OWN',
    });
  });

  return [r.router, p.router];
}
