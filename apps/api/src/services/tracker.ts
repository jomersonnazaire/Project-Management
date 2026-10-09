import {
  DAY_LOCKED,
  DEFAULT_LOOKUPS,
  LOOKUP_KINDS,
  autoStopAt,
  dailyCapMessage,
  formatTime12,
  minutesBetween,
  onHoldStoppedMessage,
  overlapMessage,
  phDateOf,
  toDateOnly,
  type LookupKind,
  type TimeType,
  type TrackerEntryDto,
} from '@xc8/shared';
import type { Logger } from 'pino';
import type { Types } from 'mongoose';
import { badRequest } from '../lib/errors.js';
import { unprocessable } from '../lib/http422.js';
import {
  ClientModel,
  LookupModel,
  MigrationModel,
  ProjectModel,
  TaskModel,
  TimeEntryModel,
  TimesheetDayModel,
  UserModel,
  type TimeEntry,
} from '../models/index.js';
import { audit } from './audit.js';
import { notifyPersonal } from './notify.js';
import { recomputeProject } from './projectService.js';
import type { ScopeUser } from './scope.js';
import { currentLockBoundary } from './timeLock.js';

/**
 * Activity tracker rules (doc 14 §2, §10, §12): one running timer per user, auto-stop at 23:59
 * PHT, no overlapping timed entries, the 24-hour cap in exact minutes, day submit / reopen and
 * the weekly lock. Shared by the tracker routes and the existing time routes.
 */
type Id = Types.ObjectId;
export type EntryDoc = TimeEntry & { _id: Id; createdAt?: Date; updatedAt?: Date };

// ---------- Lookups ----------
/** Seeds the default lists once per kind (a migration marker, so deleted values stay deleted). */
export async function ensureDefaultLookups(logger?: Logger): Promise<number> {
  let seeded = 0;
  for (const kind of LOOKUP_KINDS) {
    const id = `lookups-seed-${kind}`;
    if (await MigrationModel.exists({ _id: id })) continue;
    const res = await LookupModel.bulkWrite(
      DEFAULT_LOOKUPS[kind].map((name, order) => ({
        updateOne: {
          filter: { kind, nameKey: name.toLowerCase() },
          update: {
            $setOnInsert: { kind, name, nameKey: name.toLowerCase(), order, active: true },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    seeded += res.upsertedCount;
    await MigrationModel.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          kind: 'seed',
          status: 'DONE',
          startedAt: new Date(),
          finishedAt: new Date(),
          result: { seeded: res.upsertedCount },
        },
      },
      { upsert: true },
    ).catch(() => undefined);
  }
  if (seeded) logger?.info({ seeded }, 'Seeded tracker lists');
  return seeded;
}

/** Checks a lookup id for a new value: it must exist, be of `kind` and be active. */
export async function assertLookup(
  id: string,
  kind: LookupKind,
  path: string,
  current?: Id | null,
) {
  const doc = await LookupModel.findById(id).lean();
  const label = { ACTIVITY_TYPE: 'activity type', LOCATION: 'location', MODULE: 'module' }[kind];
  if (!doc || doc.kind !== kind) {
    throw badRequest(
      `Choose a valid ${label}.`,
      [{ path, message: `Choose a valid ${label}.` }],
      'VALIDATION_ERROR',
    );
  }
  // An entry keeps a value deactivated later; a new choice must be active.
  if (!doc.active && !(current && current.equals(doc._id))) {
    const msg = `"${doc.name}" is no longer in use. Choose another ${label}.`;
    throw badRequest(msg, [{ path, message: msg }], 'VALIDATION_ERROR');
  }
  return doc._id;
}

// ---------- Days ----------
export const dateKey = (d: Date) => toDateOnly(d);
export const todayKey = (now = new Date()) => phDateOf(now);

export async function loadDay(userId: Id, date: Date) {
  return TimesheetDayModel.findOne({ userId, date });
}

export async function getOrCreateDay(userId: Id, date: Date) {
  return TimesheetDayModel.findOneAndUpdate(
    { userId, date },
    { $setOnInsert: { userId, date } },
    { upsert: true, new: true },
  );
}

export async function weekLocked(date: Date) {
  return date < (await currentLockBoundary());
}

/** The day's state for its owner: why it is read-only, if it is. */
export async function dayState(userId: Id, date: Date) {
  const [day, locked] = await Promise.all([loadDay(userId, date), weekLocked(date)]);
  const submitted = day?.status === 'SUBMITTED';
  const pastLock = locked && !day?.unlockedPastLock;
  return { day, submitted, weekLocked: locked, pastLock, editable: !submitted && !pastLock };
}

/** 422 when the owner can't change entries on `date` (submitted day or past the weekly lock). */
export async function assertDayEditable(userId: Id, date: Date) {
  const s = await dayState(userId, date);
  if (!s.editable) throw unprocessable(DAY_LOCKED, 'DAY_LOCKED');
  return s;
}

/** Marks a day as changed (the DAR uses it to flag saved copies, FR-DAR-13). */
export async function touchDay(userId: Id, date: Date) {
  await TimesheetDayModel.updateOne(
    { userId, date },
    { $set: { changedAt: new Date() }, $setOnInsert: { userId, date } },
    { upsert: true },
  );
}

// ---------- Rules ----------
/**
 * Minutes already on a day: every entry (timed, quick and hours-only, TC-Q05 mixed) plus a running
 * timer's elapsed minutes up to now, so the 24-hour cap can't be dodged while a timer runs.
 */
export async function dayMinutes(userId: Id, date: Date, ignoreId?: Id, now = new Date()) {
  const entries = await TimeEntryModel.find({
    userId,
    workDate: date,
    ...(ignoreId ? { _id: { $ne: ignoreId } } : {}),
  })
    .select('hours minutes running startAt')
    .lean();
  return entries.reduce((n, e) => {
    if (e.running && e.startAt) return n + Math.max(0, minutesBetween(e.startAt, now));
    return n + (typeof e.minutes === 'number' ? e.minutes : Math.round((e.hours ?? 0) * 60));
  }, 0);
}

/** 24-hour cap in exact minutes (FR-TIME-03, 12.3). */
export async function assertDailyCap(userId: Id, date: Date, addMinutes: number, ignoreId?: Id) {
  const total = (await dayMinutes(userId, date, ignoreId)) + Math.round(addMinutes);
  if (total > 24 * 60) {
    throw unprocessable(dailyCapMessage(dateKey(date), total), 'DAILY_LIMIT');
  }
}

async function entryLabel(e: EntryDoc) {
  if (e.title) return `"${e.title}"`;
  const t = e.taskId ? await TaskModel.findById(e.taskId).select('name').lean() : null;
  return t ? `"${t.name}"` : 'another entry';
}

/**
 * FR-ACT-05, -11: timed entries of one user can't overlap. Touching edges are fine. A running
 * timer is open-ended, so nothing may end after it started.
 */
export async function assertNoOverlap(userId: Id, start: Date, end: Date, ignoreId?: Id) {
  const other = (await TimeEntryModel.findOne({
    userId,
    startAt: { $ne: null, $lt: end },
    $or: [{ endAt: { $gt: start } }, { running: true }],
    ...(ignoreId ? { _id: { $ne: ignoreId } } : {}),
  }).lean()) as EntryDoc | null;
  if (!other) return;
  const msg = overlapMessage(
    await entryLabel(other),
    formatTime12(other.startAt!.toISOString()),
    other.endAt ? formatTime12(other.endAt.toISOString()) : 'now',
  );
  throw unprocessable(msg, 'TIME_OVERLAP', [{ path: 'timeIn', message: msg }]);
}

/** Stops a running entry at `at` (never past 23:59 of its day). */
export async function stopEntry(id: Id, at: Date, opts: { auto?: boolean } = {}) {
  const e = (await TimeEntryModel.findById(id).lean()) as EntryDoc | null;
  if (!e || !e.running || !e.startAt) return null;
  const cap = autoStopAt(dateKey(e.workDate));
  let endAt = at > cap ? cap : at < e.startAt ? e.startAt : at;
  // TC-Q05: with hours-only entries on the same day, a timer stops where the day reaches 24:00
  // (flagged "Auto-stopped – please check") rather than pushing the total past 24 hours.
  const others = await dayMinutes(e.userId, e.workDate, e._id, endAt);
  const room = Math.max(0, 24 * 60 - others);
  let capped = false;
  if (minutesBetween(e.startAt, endAt) > room) {
    endAt = new Date(e.startAt.getTime() + room * 60_000);
    capped = true;
  }
  const minutes = minutesBetween(e.startAt, endAt);
  const done = (await TimeEntryModel.findOneAndUpdate(
    { _id: id, running: true },
    {
      $set: {
        running: false,
        endAt,
        minutes,
        hours: minutes / 60,
        autoStopped: Boolean(opts.auto) || at > cap || capped,
      },
    },
    { new: true },
  ).lean()) as EntryDoc | null;
  if (done) {
    await touchDay(done.userId, done.workDate);
    if (done.taskId) await recomputeTask(done.taskId, done.projectId ?? null);
  }
  return done;
}

export async function recomputeTask(taskId: Id, projectId: Id | null) {
  const [sum] = await TimeEntryModel.aggregate<{ total: number }>([
    { $match: { taskId } },
    { $group: { _id: null, total: { $sum: '$hours' } } },
  ]);
  await TaskModel.updateOne({ _id: taskId }, { $set: { actualHours: sum?.total ?? 0 } });
  if (projectId) await recomputeProject(projectId);
}

/**
 * FR-ACT-04, EC-75: timers still running past 23:59 PHT of their own day stop at 23:59 and are
 * flagged "Auto-stopped – please check". Runs lazily on tracker requests and hourly.
 */
export async function sweepAutoStop(now = new Date(), userId?: Id): Promise<number> {
  const running = await TimeEntryModel.find({ running: true, ...(userId ? { userId } : {}) })
    .select('_id workDate')
    .lean();
  let n = 0;
  for (const e of running) {
    if (autoStopAt(dateKey(e.workDate)) <= now) {
      if (await stopEntry(e._id, now, { auto: true })) n++;
    }
  }
  return n;
}

/** EC-76: timers on a project that goes On Hold (or closes) stop at that moment. */
export async function stopTimersForProject(
  project: { _id: Id; name: string; status?: string | null },
  actorId: Id,
): Promise<number> {
  const running = await TimeEntryModel.find({ projectId: project._id, running: true }).lean();
  const now = new Date();
  for (const e of running) {
    const done = await stopEntry(e._id, now);
    if (!done) continue;
    const task = e.taskId ? await TaskModel.findById(e.taskId).select('name').lean() : null;
    const time = formatTime12(done.endAt!.toISOString());
    await notifyPersonal({
      type: 'TIMER_STOPPED',
      actorId: null,
      recipients: [e.userId],
      message:
        project.status === 'ON_HOLD'
          ? onHoldStoppedMessage(project.name, task?.name ?? 'a task', time)
          : `${project.name} was closed, so your timer on "${task?.name ?? 'a task'}" stopped at ${time}.`,
      link: '/my-tasks',
    });
    await audit({
      actorId,
      entityType: 'time',
      entityId: e._id,
      projectId: project._id,
      action: 'timer_stopped_project_closed',
      changes: [{ field: 'endAt', old: null, new: done.endAt!.toISOString() }],
    });
  }
  return running.length;
}

// ---------- Viewing other people (FR-ACT-07) ----------
/** The user's own day, their supervisor, or an Admin. Everyone else gets 404. */
export async function canViewPerson(
  viewer: ScopeUser,
  userId: Id,
): Promise<'self' | 'supervisor' | 'admin' | null> {
  if (viewer._id.equals(userId)) return 'self';
  if (viewer.systemRole === 'ADMIN') return 'admin';
  const target = await UserModel.findById(userId).select('supervisorId').lean();
  if (target?.supervisorId && target.supervisorId.equals(viewer._id)) return 'supervisor';
  return null;
}

/** People whose tracker the viewer can open: themself, their direct reports, everyone for Admins. */
export async function viewablePeople(viewer: ScopeUser & { name: string }) {
  const filter =
    viewer.systemRole === 'ADMIN' ? { active: true } : { active: true, supervisorId: viewer._id };
  const users = await UserModel.find(filter).select('name').sort({ name: 1 }).lean();
  const me = { id: viewer._id.toString(), name: viewer.name };
  return [
    me,
    ...users
      .filter((u) => !u._id.equals(viewer._id))
      .map((u) => ({ id: u._id.toString(), name: u.name })),
  ];
}

// ---------- DTOs ----------
export async function toTrackerDtos(
  entries: EntryDoc[],
  opts: { lockedDays?: Set<string>; dayLocations?: Map<string, Id | null>; now?: Date } = {},
): Promise<TrackerEntryDto[]> {
  const ids = (k: keyof EntryDoc) =>
    entries.map((e) => e[k] as Id | null | undefined).filter((x): x is Id => Boolean(x));
  const dayLoc = opts.dayLocations ?? new Map<string, Id | null>();
  if (!opts.dayLocations) {
    const days = await TimesheetDayModel.find({
      $or: entries.map((e) => ({ userId: e.userId, date: e.workDate })),
    })
      .select('userId date locationId')
      .lean();
    for (const d of days)
      dayLoc.set(`${d.userId.toString()}|${dateKey(d.date)}`, d.locationId ?? null);
  }
  const lookupIds = [
    ...ids('activityTypeId'),
    ...ids('moduleId'),
    ...ids('locationId'),
    ...[...dayLoc.values()].filter((x): x is Id => Boolean(x)),
  ];
  const [projects, tasks, users, lookups] = await Promise.all([
    ProjectModel.find({ _id: { $in: ids('projectId') } })
      .select('name clientId')
      .lean(),
    TaskModel.find({ _id: { $in: ids('taskId') } })
      .select('name')
      .lean(),
    UserModel.find({ _id: { $in: ids('userId') } })
      .select('name')
      .lean(),
    LookupModel.find({ _id: { $in: lookupIds } })
      .select('name')
      .lean(),
  ]);
  const clients = await ClientModel.find({
    _id: { $in: projects.map((p) => p.clientId).filter(Boolean) },
  })
    .select('name')
    .lean();
  const m = <T extends { _id: Id }>(list: T[]) => new Map(list.map((x) => [x._id.toString(), x]));
  const [pm, tm, um, lm, cm] = [m(projects), m(tasks), m(users), m(lookups), m(clients)];
  const ref = (id: Id | null | undefined, map: Map<string, { name: string }>, fallback = '') =>
    id ? { id: id.toString(), name: map.get(id.toString())?.name ?? fallback } : null;
  const now = opts.now ?? new Date();
  return entries.map((e) => {
    const p = e.projectId ? pm.get(e.projectId.toString()) : undefined;
    const date = dateKey(e.workDate);
    const effectiveLoc = e.locationId ?? dayLoc.get(`${e.userId.toString()}|${date}`) ?? null;
    const timed = Boolean(e.startAt);
    const minutes =
      e.running && e.startAt
        ? minutesBetween(e.startAt, now)
        : timed
          ? (e.minutes ?? Math.round(e.hours * 60))
          : Math.round(e.hours * 60);
    return {
      id: e._id.toString(),
      kind: (e.kind ?? 'TASK') as 'TASK' | 'QUICK',
      user: { id: e.userId.toString(), name: um.get(e.userId.toString())?.name ?? 'Unknown user' },
      project: p ? { id: p._id.toString(), name: p.name } : null,
      client: p?.clientId ? ref(p.clientId, cm) : null,
      task: ref(e.taskId, tm, '(deleted task)'),
      title: e.title ?? null,
      date,
      startAt: e.startAt ? e.startAt.toISOString() : null,
      endAt: e.endAt ? e.endAt.toISOString() : null,
      running: Boolean(e.running),
      minutes,
      timed,
      autoStopped: Boolean(e.autoStopped),
      activityType: ref(e.activityTypeId, lm),
      module: ref(e.moduleId, lm),
      location: ref(effectiveLoc, lm),
      locationOverridden: Boolean(e.locationId),
      billable: e.billable ?? e.kind !== 'QUICK',
      type: e.kind === 'QUICK' ? null : ((e.type ?? 'EXECUTION') as TimeType),
      notes: e.notes ?? null,
      locked: opts.lockedDays?.has(`${e.userId.toString()}|${date}`) ?? false,
    };
  });
}
