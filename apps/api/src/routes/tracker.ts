import {
  DAY_LOCKED,
  DAY_LOCKED_ADMIN,
  EDITABLE_LOOKUP_KINDS,
  LOOKUP_LABELS,
  STOP_TIMER_FIRST,
  TIMER_RUNNING_MESSAGE,
  type TimerRunningDetails,
  WHERE_WORKING,
  dayLocationSchema,
  stopTimerSchema,
  dayQuerySchema,
  lookupInUseMessage,
  lookupSchema,
  minutesBetween,
  parseDateOnly,
  phInstant,
  reopenDaySchema,
  startTimerSchema,
  timedEntrySchema,
  toDateOnly,
  todayPH,
  updateLookupSchema,
  updateTimedEntrySchema,
  reopenedMessage,
  type LookupDto,
  type LookupKind,
  type RunningDto,
  type TrackerDayDto,
  floorToMinute,
} from '@xc8/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { AUTHENTICATED, perm, type RouteRegistry } from '../access/registry.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { conflictWith, unprocessable } from '../lib/http422.js';
import { idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import {
  LookupModel,
  TaskModel,
  TimeEntryModel,
  TimesheetDayModel,
  UserModel,
} from '../models/index.js';
import { audit } from '../services/audit.js';
import { leaveRowsFor } from '../services/leave.js';
import { assertLeaveAllowsTime, leaveLabelFor } from '../services/leaveHook.js';
import { notifyPersonal } from '../services/notify.js';
import { userRefs } from '../services/projectService.js';
import {
  assertDailyCap,
  assertDayEditable,
  assertLookup,
  assertNoOverlap,
  canViewPerson,
  dateKey,
  dayState,
  ensureDefaultLookups,
  getOrCreateDay,
  recomputeTask,
  stopEntry,
  sweepAutoStop,
  toTrackerDtos,
  touchDay,
  viewablePeople,
  type EntryDoc,
} from '../services/tracker.js';
import { loadLoggableTask } from './time.js';

type Id = Types.ObjectId;

function dateParam(req: Request): Date {
  const v = req.params.date;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw notFound();
  const d = parseDateOnly(v);
  if (Number.isNaN(d.getTime()) || toDateOnly(d) !== v) throw notFound();
  return d;
}

function noFuture(date: Date) {
  if (date > todayPH()) {
    throw badRequest(
      "Date can't be in the future.",
      [{ path: 'date', message: "Date can't be in the future." }],
      'VALIDATION_ERROR',
    );
  }
}

// FR-ACT-22: Modules are no longer an Admin list. The stored values stay in the database untouched,
// so only Activity types and Locations are reachable here.
const KIND_BY_PATH = new Map(EDITABLE_LOOKUP_KINDS.map((k) => [LOOKUP_LABELS[k].path, k]));
const isEditableKind = (k: string) => (EDITABLE_LOOKUP_KINDS as readonly string[]).includes(k);
function kindParam(req: Request): LookupKind {
  const k = KIND_BY_PATH.get(String(req.params.kind));
  if (!k) throw notFound();
  return k;
}

interface FieldInput {
  activityTypeId?: string;
  /** Free text, already trimmed by the schema; null = blank (FR-ACT-20). */
  module?: string | null;
  locationId?: string | null;
  billable?: boolean;
  type?: 'EXECUTION' | 'WAITING' | 'REWORK';
  notes?: string | null;
}

/** Resolves the entry fields (FR-ACT-15..18) for a project task (TASK) or quick activity (QUICK). */
async function resolveFields(input: FieldInput, kind: 'TASK' | 'QUICK', current?: EntryDoc) {
  const out: Record<string, unknown> = {};
  if (input.activityTypeId !== undefined) {
    out.activityTypeId = await assertLookup(
      input.activityTypeId,
      'ACTIVITY_TYPE',
      'activityTypeId',
      current?.activityTypeId,
    );
  } else if (!current) {
    throw badRequest(
      'Choose an activity type.',
      [{ path: 'activityTypeId', message: 'Choose an activity type.' }],
      'VALIDATION_ERROR',
    );
  }
  // FR-ACT-20: optional free text on every entry; blank or spaces-only saves as blank.
  // DEF-010: any Module save (blank included) also drops the legacy Modules-list link, so the
  // free-text migration can never bring a cleared module back.
  if (input.module !== undefined || !current) {
    out.module = input.module || null;
    out.moduleId = null;
  }
  if (input.locationId) {
    out.locationId = await assertLookup(
      input.locationId,
      'LOCATION',
      'locationId',
      current?.locationId,
    );
  } else if (input.locationId === null) out.locationId = null;
  if (input.billable !== undefined) out.billable = input.billable;
  else if (!current) out.billable = kind === 'TASK';
  if (kind === 'QUICK') {
    if (input.type) {
      throw badRequest(
        "Quick activities don't have a time type.",
        [{ path: 'type', message: "Quick activities don't have a time type." }],
        'VALIDATION_ERROR',
      );
    }
    out.type = null;
  } else if (input.type) out.type = input.type;
  else if (!current) out.type = 'EXECUTION';
  if (input.notes !== undefined) out.notes = input.notes || null;
  return out;
}

/** FR-ACT-17: the day's location, asked on the first entry of the day. */
async function ensureDayLocation(
  userId: Id,
  date: Date,
  dayLocationId?: string,
  entryLocationId?: string | null,
) {
  const day = await getOrCreateDay(userId, date);
  if (dayLocationId) {
    day.locationId = await assertLookup(dayLocationId, 'LOCATION', 'dayLocationId');
    await day.save();
  } else if (!day.locationId) {
    if (!entryLocationId) {
      throw badRequest(
        WHERE_WORKING,
        [{ path: 'dayLocationId', message: 'Choose where you’re working today.' }],
        'LOCATION_NEEDED',
      );
    }
    day.locationId = await assertLookup(entryLocationId, 'LOCATION', 'locationId');
    await day.save();
    return { day, inherit: true };
  }
  return { day, inherit: false };
}

async function resolveTarget(req: Request, input: { taskId?: string; title?: string }) {
  if (input.taskId) {
    const { task, project } = await loadLoggableTask(req, input.taskId);
    return { kind: 'TASK' as const, projectId: project._id, taskId: task._id, title: null };
  }
  return { kind: 'QUICK' as const, projectId: null, taskId: null, title: input.title! };
}

async function buildDay(
  viewer: ReturnType<typeof currentUser>,
  userId: Id,
  date: Date,
  relation: string,
): Promise<TrackerDayDto> {
  await sweepAutoStop(new Date(), userId);
  const [state, entries, owner] = await Promise.all([
    dayState(userId, date),
    TimeEntryModel.find({ userId, workDate: date })
      .sort({ startAt: 1, createdAt: 1 })
      .lean() as Promise<EntryDoc[]>,
    UserModel.findById(userId).select('name').lean(),
  ]);
  const key = `${userId.toString()}|${dateKey(date)}`;
  const day = state.day;
  const own = relation === 'self';
  const items = await toTrackerDtos(entries, {
    lockedDays: own && state.editable ? new Set() : new Set([key]),
    dayLocations: new Map([[key, day?.locationId ?? null]]),
  });
  const reopenRefs = await userRefs((day?.reopened ?? []).map((r) => r.by));
  const loc = day?.locationId
    ? await LookupModel.findById(day.locationId).select('name').lean()
    : null;
  const isAdmin = viewer.systemRole === 'ADMIN';
  const canReopenRole = isAdmin || relation === 'supervisor';
  const lockedNow = state.submitted || state.pastLock;
  const status = (day?.status ?? 'OPEN') as TrackerDayDto['status'];
  return {
    user: { id: userId.toString(), name: owner?.name ?? 'Unknown user' },
    date: dateKey(date),
    location: loc ? { id: loc._id.toString(), name: loc.name } : null,
    status,
    submittedAt: day?.submittedAt ? day.submittedAt.toISOString() : null,
    reopened: (day?.reopened ?? []).map((r) => ({
      by: { id: r.by.toString(), name: reopenRefs.get(r.by.toString())?.name ?? 'Unknown user' },
      at: r.at.toISOString(),
      reason: r.reason,
    })),
    notSubmitted: state.weekLocked && status !== 'SUBMITTED',
    weekLocked: state.weekLocked,
    entries: items,
    totalMinutes: items.reduce((s, e) => s + e.minutes, 0),
    own,
    can: {
      edit: own && state.editable,
      submit: own && state.editable && status !== 'SUBMITTED' && date <= todayPH(),
      reopen: canReopenRole && lockedNow && (!state.weekLocked || isAdmin),
    },
    leave: await leaveLabelFor(userId, date),
    leaveRows: await leaveRowsFor(userId, date),
  };
}

async function timerRunning(e: Pick<EntryDoc, '_id' | 'kind' | 'title' | 'taskId'>) {
  const task = e.taskId ? await TaskModel.findById(e.taskId).select('name').lean() : null;
  const details: TimerRunningDetails = {
    running: { id: e._id.toString(), name: task?.name ?? e.title ?? 'Quick activity' },
  };
  return new HttpError(409, 'TIMER_RUNNING', TIMER_RUNNING_MESSAGE, details);
}

export function trackerRouter(registry: RouteRegistry) {
  const r = registry.router('/tracker');

  // People whose tracker the caller can open (self, direct reports; Admins: everyone).
  r.get('/people', perm('activities', 'view'), async (req, res) => {
    res.json({ items: await viewablePeople(currentUser(req)) });
  });

  r.get('/day', perm('activities', 'view'), async (req, res) => {
    const q = parseQuery(dayQuerySchema, req);
    const viewer = currentUser(req);
    const userId = q.userId ? new Types.ObjectId(q.userId) : viewer._id;
    const relation = await canViewPerson(viewer, userId);
    if (!relation) throw notFound();
    const date = q.date ? parseDateOnly(q.date) : todayPH();
    res.json({ day: await buildDay(viewer, userId, date, relation) });
  });

  r.get('/running', perm('activities', 'view'), async (req, res) => {
    const user = currentUser(req);
    await sweepAutoStop(new Date(), user._id);
    const e = (await TimeEntryModel.findOne({
      userId: user._id,
      running: true,
    }).lean()) as EntryDoc | null;
    const body: RunningDto = {
      entry: e ? (await toTrackerDtos([e]))[0]! : null,
      now: new Date().toISOString(),
    };
    res.json(body);
  });

  // Time in (FR-ACT-02, -03, -09): the server sets the start; a running timer stops first.
  r.post('/start', perm('activities', 'create'), async (req, res) => {
    const input = parseBody(startTimerSchema, req);
    const user = currentUser(req);
    // DR-45: the timer starts on the whole minute.
    const now = floorToMinute(new Date());
    await sweepAutoStop(now, user._id);
    const target = await resolveTarget(req, input);
    const fields = await resolveFields(input, target.kind);
    const date = todayPH(now);
    await assertDayEditable(user._id, date);
    await assertLeaveAllowsTime(user._id, date, input.confirmLeave);
    const { inherit } = await ensureDayLocation(
      user._id,
      date,
      input.dayLocationId,
      input.locationId,
    );
    if (inherit) fields.locationId = null;
    // FR-ACT-26: one timer per person. A running timer is only stopped when the user chose
    // Switch for that very timer; otherwise 409. The create below is guarded by the unique
    // partial index (one running entry per user), so two simultaneous starts can't both win.
    const current = (await TimeEntryModel.findOne({ userId: user._id, running: true })
      .select('_id kind title taskId')
      .lean()) as Pick<EntryDoc, '_id' | 'kind' | 'title' | 'taskId'> | null;
    if (current) {
      if (input.switchFrom !== current._id.toString()) throw await timerRunning(current);
      await stopEntry(current._id, now);
    }
    await assertNoOverlap(user._id, now, new Date(now.getTime() + 60_000));
    // TC-Q05: no new timer on a day that already has 24 hours.
    await assertDailyCap(user._id, date, 1);
    const entry = await TimeEntryModel.create({
      userId: user._id,
      ...target,
      workDate: date,
      hours: 0,
      startAt: now,
      endAt: null,
      minutes: null,
      running: true,
      ...fields,
    }).catch((e: unknown) => {
      if ((e as { code?: number }).code === 11000) {
        throw conflictWith(TIMER_RUNNING_MESSAGE, 'TIMER_RUNNING');
      }
      throw e;
    });
    await touchDay(user._id, date);
    await audit({
      actorId: user._id,
      entityType: 'time',
      entityId: entry._id,
      projectId: target.projectId,
      action: 'timer_started',
      meta: { kind: target.kind, stopped: current?._id.toString() ?? null },
    });
    const [dto] = await toTrackerDtos([entry.toObject() as EntryDoc]);
    res.status(201).json({ entry: dto, stopped: current?._id.toString() ?? null });
  });

  // Time out.
  r.post('/stop', perm('activities', 'edit'), async (req, res) => {
    const input = parseBody(stopTimerSchema, req);
    const user = currentUser(req);
    const now = new Date();
    await sweepAutoStop(now, user._id);
    // FR-ACT-23: stopping a named entry is idempotent. If it has already stopped (the other
    // Time out button, a double click, or the 23:59 auto-stop), return it unchanged.
    const current = input.entryId
      ? ((await TimeEntryModel.findOne({
          _id: input.entryId,
          userId: user._id,
        }).lean()) as EntryDoc | null)
      : await TimeEntryModel.findOne({ userId: user._id, running: true }).select('_id').lean();
    if (!current) {
      if (input.entryId) throw notFound();
      throw unprocessable('No timer is running.', 'NO_TIMER');
    }
    const done = await stopEntry(current._id, now);
    if (!done) {
      const already = (await TimeEntryModel.findById(current._id).lean()) as EntryDoc | null;
      const [same] = await toTrackerDtos([already!]);
      res.json({ entry: same });
      return;
    }
    await audit({
      actorId: user._id,
      entityType: 'time',
      entityId: done._id,
      projectId: done.projectId,
      action: 'timer_stopped',
      changes: [{ field: 'minutes', old: null, new: done.minutes }],
    });
    const [dto] = await toTrackerDtos([done]);
    res.json({ entry: dto });
  });

  // FR-ACT-10: a manual timed entry with time in and time out.
  r.post('/entries', perm('activities', 'create'), async (req, res) => {
    const input = parseBody(timedEntrySchema, req);
    const user = currentUser(req);
    const date = parseDateOnly(input.date);
    noFuture(date);
    const startAt = phInstant(input.date, input.timeIn);
    const endAt = phInstant(input.date, input.timeOut);
    if (endAt > new Date()) {
      throw badRequest(
        "Time out can't be in the future.",
        [{ path: 'timeOut', message: "Time out can't be in the future." }],
        'VALIDATION_ERROR',
      );
    }
    const target = await resolveTarget(req, input);
    const fields = await resolveFields(input, target.kind);
    await assertDayEditable(user._id, date);
    await assertLeaveAllowsTime(user._id, date, input.confirmLeave);
    const minutes = minutesBetween(startAt, endAt);
    await assertNoOverlap(user._id, startAt, endAt);
    await assertDailyCap(user._id, date, minutes);
    const { inherit } = await ensureDayLocation(
      user._id,
      date,
      input.dayLocationId,
      input.locationId,
    );
    if (inherit) fields.locationId = null;
    const entry = await TimeEntryModel.create({
      userId: user._id,
      ...target,
      workDate: date,
      startAt,
      endAt,
      minutes,
      hours: minutes / 60,
      running: false,
      ...fields,
    });
    await touchDay(user._id, date);
    if (target.taskId) await recomputeTask(target.taskId, target.projectId);
    await audit({
      actorId: user._id,
      entityType: 'time',
      entityId: entry._id,
      projectId: target.projectId,
      action: 'time_logged',
      changes: [{ field: 'minutes', old: null, new: minutes }],
      meta: { kind: target.kind, date: input.date, timeIn: input.timeIn, timeOut: input.timeOut },
    });
    const [dto] = await toTrackerDtos([entry.toObject() as EntryDoc]);
    res.status(201).json({ entry: dto });
  });

  /** Own entry → the entry. Supervisor/Admin → 403 (view only). Anyone else → 404 (FR-ACT-07). */
  async function loadOwnEntry(req: Request) {
    const user = currentUser(req);
    const entry = await TimeEntryModel.findById(idParam(req));
    if (!entry) throw notFound();
    if (!entry.userId.equals(user._id)) {
      if (await canViewPerson(user, entry.userId)) {
        throw forbidden('You can view this entry, but only its owner can change it.', 'VIEW_ONLY');
      }
      throw notFound();
    }
    await sweepAutoStop(new Date(), user._id);
    return (await TimeEntryModel.findById(entry._id))!;
  }

  r.patch('/entries/:id', perm('activities', 'edit'), async (req, res) => {
    const input = parseBody(updateTimedEntrySchema, req);
    const entry = await loadOwnEntry(req);
    const user = currentUser(req);
    await assertDayEditable(user._id, entry.workDate);
    const kind = (entry.kind ?? 'TASK') as 'TASK' | 'QUICK';
    if (input.title !== undefined && kind !== 'QUICK') {
      throw badRequest(
        'Only quick activities have a title.',
        [{ path: 'title', message: 'Only quick activities have a title.' }],
        'VALIDATION_ERROR',
      );
    }
    if ((input.timeIn || input.timeOut) && (!entry.startAt || entry.running)) {
      throw unprocessable(
        entry.running
          ? 'Stop the timer before changing its times.'
          : 'This entry has hours only. Change it under Time.',
        'NOT_TIMED',
      );
    }
    const fields = await resolveFields(input, kind, entry.toObject() as EntryDoc);
    const date = dateKey(entry.workDate);
    const before = {
      startAt: entry.startAt?.toISOString() ?? null,
      endAt: entry.endAt?.toISOString() ?? null,
      minutes: entry.minutes,
    };
    if (input.timeIn || input.timeOut) {
      const startAt = input.timeIn ? phInstant(date, input.timeIn) : entry.startAt!;
      const endAt = input.timeOut ? phInstant(date, input.timeOut) : entry.endAt!;
      if (endAt <= startAt) {
        throw badRequest(
          'Time out must be after time in.',
          [{ path: 'timeOut', message: 'Time out must be after time in.' }],
          'VALIDATION_ERROR',
        );
      }
      if (endAt > new Date()) {
        throw badRequest(
          "Time out can't be in the future.",
          [{ path: 'timeOut', message: "Time out can't be in the future." }],
          'VALIDATION_ERROR',
        );
      }
      const minutes = minutesBetween(startAt, endAt);
      await assertNoOverlap(user._id, startAt, endAt, entry._id);
      await assertDailyCap(user._id, entry.workDate, minutes, entry._id);
      entry.startAt = startAt;
      entry.endAt = endAt;
      entry.minutes = minutes;
      entry.hours = minutes / 60;
      // A checked auto-stopped entry is no longer flagged.
      entry.autoStopped = false;
    }
    if (input.title) entry.title = input.title;
    entry.set(fields);
    await entry.save();
    await touchDay(user._id, entry.workDate);
    if (entry.taskId) await recomputeTask(entry.taskId, entry.projectId ?? null);
    const after = {
      startAt: entry.startAt?.toISOString() ?? null,
      endAt: entry.endAt?.toISOString() ?? null,
      minutes: entry.minutes,
    };
    await audit({
      actorId: user._id,
      entityType: 'time',
      entityId: entry._id,
      projectId: entry.projectId,
      action: 'time_updated',
      changes: (Object.keys(before) as (keyof typeof before)[])
        .filter((k) => before[k] !== after[k])
        .map((k) => ({ field: k, old: before[k], new: after[k] })),
      meta: { fields: Object.keys(input) },
    });
    const [dto] = await toTrackerDtos([entry.toObject() as EntryDoc]);
    res.json({ entry: dto });
  });

  r.delete('/entries/:id', perm('activities', 'delete'), async (req, res) => {
    const entry = await loadOwnEntry(req);
    const user = currentUser(req);
    await assertDayEditable(user._id, entry.workDate);
    await entry.deleteOne();
    await touchDay(user._id, entry.workDate);
    if (entry.taskId) await recomputeTask(entry.taskId, entry.projectId ?? null);
    await audit({
      actorId: user._id,
      entityType: 'time',
      entityId: entry._id,
      projectId: entry.projectId,
      action: 'time_deleted',
      changes: [
        { field: 'minutes', old: entry.minutes ?? Math.round(entry.hours * 60), new: null },
      ],
      meta: { date: dateKey(entry.workDate) },
    });
    res.status(204).end();
  });

  // FR-ACT-17: change the day's location (entries without their own follow it).
  r.put('/days/:date/location', perm('activities', 'edit'), async (req, res) => {
    const input = parseBody(dayLocationSchema, req);
    const user = currentUser(req);
    const date = dateParam(req);
    noFuture(date);
    await assertDayEditable(user._id, date);
    const day = await getOrCreateDay(user._id, date);
    const old = day.locationId?.toString() ?? null;
    day.locationId = await assertLookup(input.locationId, 'LOCATION', 'locationId', day.locationId);
    day.changedAt = new Date();
    await day.save();
    await audit({
      actorId: user._id,
      entityType: 'timesheetDay',
      entityId: day._id,
      action: 'day_location_set',
      changes: [{ field: 'locationId', old, new: input.locationId }],
    });
    res.json({ day: await buildDay(user, user._id, date, 'self') });
  });

  // FR-ACT-12: submit locks the day (a running timer must be stopped first).
  r.post('/days/:date/submit', perm('activities', 'edit'), async (req, res) => {
    parseBody(dayLocationSchema.partial().strict(), req);
    const user = currentUser(req);
    const date = dateParam(req);
    noFuture(date);
    await sweepAutoStop(new Date(), user._id);
    const state = await dayState(user._id, date);
    if (state.pastLock) throw unprocessable(DAY_LOCKED, 'DAY_LOCKED');
    if (!state.submitted) {
      if (await TimeEntryModel.exists({ userId: user._id, workDate: date, running: true })) {
        throw unprocessable(STOP_TIMER_FIRST, 'TIMER_RUNNING');
      }
      const day = await getOrCreateDay(user._id, date);
      day.status = 'SUBMITTED';
      day.submittedAt = new Date();
      day.unlockedPastLock = false;
      await day.save();
      await audit({
        actorId: user._id,
        entityType: 'timesheetDay',
        entityId: day._id,
        action: 'day_submitted',
        meta: { date: dateKey(date) },
      });
    }
    res.json({ day: await buildDay(user, user._id, date, 'self') });
  });

  // FR-ACT-12, 12.3: the supervisor or an Admin reopens with a reason; past the lock, Admin only.
  r.post('/days/:date/reopen', perm('activities', 'view'), async (req, res) => {
    const input = parseBody(reopenDaySchema, req);
    const actor = currentUser(req);
    const date = dateParam(req);
    const userId = new Types.ObjectId(input.userId);
    const target = await UserModel.findById(userId).select('name supervisorId').lean();
    if (!target) throw notFound();
    const isAdmin = actor.systemRole === 'ADMIN';
    const isSupervisor = Boolean(target.supervisorId?.equals(actor._id));
    if (!isAdmin && !isSupervisor) {
      // FR-ACT-25 (NFR-25): a user outside the caller's scope is "not found" whether or not they
      // exist; 403 only when the caller can see them (e.g. a Member reopening their own day).
      if (!(await canViewPerson(actor, userId))) throw notFound();
      throw forbidden('Only their supervisor or an Admin can reopen this day.', 'NOT_SUPERVISOR');
    }
    const state = await dayState(userId, date);
    if (state.weekLocked && !isAdmin) throw forbidden(DAY_LOCKED_ADMIN, 'ADMIN_ONLY');
    if (state.editable)
      throw unprocessable("This day isn't locked, so there's nothing to reopen.", 'NOT_LOCKED');
    const day = await getOrCreateDay(userId, date);
    day.status = 'REOPENED';
    day.unlockedPastLock = state.weekLocked;
    day.reopened.push({ by: actor._id, at: new Date(), reason: input.reason });
    await day.save();
    await audit({
      actorId: actor._id,
      entityType: 'timesheetDay',
      entityId: day._id,
      action: 'day_reopened',
      reason: input.reason,
      meta: { userId: input.userId, date: dateKey(date), pastLock: state.weekLocked },
    });
    await notifyPersonal({
      type: 'DAY_REOPENED',
      actorId: actor._id,
      recipients: [userId],
      message: reopenedMessage(actor.name, dateKey(date), input.reason),
      link: `/my-tasks?tab=day&date=${dateKey(date)}`,
    });
    const relation = (await canViewPerson(actor, userId))!;
    res.json({ day: await buildDay(actor, userId, date, relation) });
  });

  // ---------- Admin lists (FR-ACT-15, §10) ----------
  const l = registry.router('/lookups');

  // Active values for the entry forms, any signed-in user.
  l.get('/', AUTHENTICATED, async (_req, res) => {
    await ensureDefaultLookups();
    const docs = await LookupModel.find({ active: true }).sort({ order: 1, name: 1 }).lean();
    const pick = (k: LookupKind) =>
      docs.filter((d) => d.kind === k).map((d) => ({ id: d._id.toString(), name: d.name }));
    res.json({
      activityTypes: pick('ACTIVITY_TYPE'),
      locations: pick('LOCATION'),
    });
  });

  async function usage(ids: Id[]) {
    const counts = new Map<string, number>();
    for (const field of ['activityTypeId', 'locationId'] as const) {
      const rows = await TimeEntryModel.aggregate<{ _id: Id; n: number }>([
        { $match: { [field]: { $in: ids } } },
        { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      ]);
      for (const r of rows) counts.set(r._id.toString(), (counts.get(r._id.toString()) ?? 0) + r.n);
    }
    const days = await TimesheetDayModel.aggregate<{ _id: Id; n: number }>([
      { $match: { locationId: { $in: ids } } },
      { $group: { _id: '$locationId', n: { $sum: 1 } } },
    ]);
    for (const r of days) counts.set(r._id.toString(), (counts.get(r._id.toString()) ?? 0) + r.n);
    return counts;
  }

  async function toLookupDtos(
    docs: {
      _id: Id;
      kind: string;
      name: string;
      active?: boolean | null;
      deactivatedAt?: Date | null;
      deactivatedBy?: Id | null;
      createdAt?: Date;
    }[],
  ): Promise<LookupDto[]> {
    const used = await usage(docs.map((d) => d._id));
    const refs = await userRefs(docs.map((d) => d.deactivatedBy));
    return docs.map((d) => ({
      id: d._id.toString(),
      kind: d.kind as LookupKind,
      name: d.name,
      active: d.active !== false,
      usedBy: used.get(d._id.toString()) ?? 0,
      deactivatedAt: d.deactivatedAt ? d.deactivatedAt.toISOString() : null,
      deactivatedBy: d.deactivatedBy
        ? {
            id: d.deactivatedBy.toString(),
            name: refs.get(d.deactivatedBy.toString())?.name ?? 'Unknown user',
          }
        : null,
      createdAt: (d.createdAt ?? new Date()).toISOString(),
    }));
  }

  l.get('/:kind/all', perm('settings', 'view'), async (req, res) => {
    const kind = kindParam(req);
    await ensureDefaultLookups();
    const docs = await LookupModel.find({ kind }).sort({ active: -1, order: 1, name: 1 }).lean();
    res.json({ items: await toLookupDtos(docs) });
  });

  // Mockup v0.8.7 wording: '"Configuration" already exists.'
  const duplicate = (_kind: LookupKind, name: string) => {
    const msg = `"${name}" already exists.`;
    return conflictWith(msg, 'DUPLICATE_NAME', [{ path: 'name', message: msg }]);
  };

  l.post('/:kind', perm('settings', 'edit'), async (req, res) => {
    const kind = kindParam(req);
    const input = parseBody(lookupSchema, req);
    const nameKey = input.name.toLowerCase();
    const clash = await LookupModel.findOne({ kind, nameKey }).select('name').lean();
    if (clash) throw duplicate(kind, clash.name);
    const last = await LookupModel.findOne({ kind }).sort({ order: -1 }).select('order').lean();
    const doc = await LookupModel.create({
      kind,
      name: input.name,
      nameKey,
      order: (last?.order ?? 0) + 1,
    }).catch((e: unknown) => {
      if ((e as { code?: number }).code === 11000) throw duplicate(kind, input.name);
      throw e;
    });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'lookup',
      entityId: doc._id,
      action: 'lookup_created',
      changes: [{ field: 'name', old: null, new: input.name }],
      meta: { kind },
    });
    const [dto] = await toLookupDtos([doc.toObject()]);
    res.status(201).json({ item: dto });
  });

  l.patch('/:id', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(updateLookupSchema, req);
    const doc = await LookupModel.findById(idParam(req));
    // FR-ACT-22: the old Modules list stays in the database untouched.
    if (!doc || !isEditableKind(doc.kind)) throw notFound();
    const user = currentUser(req);
    const changes: { field: string; old: unknown; new: unknown }[] = [];
    if (input.name && input.name !== doc.name) {
      const nameKey = input.name.toLowerCase();
      const clash = await LookupModel.findOne({ kind: doc.kind, nameKey, _id: { $ne: doc._id } })
        .select('name')
        .lean();
      if (clash) throw duplicate(doc.kind as LookupKind, clash.name);
      changes.push({ field: 'name', old: doc.name, new: input.name });
      doc.name = input.name;
      doc.nameKey = nameKey;
    }
    if (input.active !== undefined && input.active !== (doc.active !== false)) {
      changes.push({ field: 'active', old: doc.active !== false, new: input.active });
      doc.active = input.active;
      doc.deactivatedAt = input.active ? null : new Date();
      doc.deactivatedBy = input.active ? null : user._id;
    }
    await doc.save();
    if (changes.length) {
      await audit({
        actorId: user._id,
        entityType: 'lookup',
        entityId: doc._id,
        action: 'lookup_updated',
        changes,
        meta: { kind: doc.kind },
      });
    }
    const [dto] = await toLookupDtos([doc.toObject()]);
    res.json({ item: dto });
  });

  // In-use values can only be deactivated (§10).
  l.delete('/:id', perm('settings', 'edit'), async (req, res) => {
    const doc = await LookupModel.findById(idParam(req));
    // FR-ACT-22: the old Modules list stays in the database untouched.
    if (!doc || !isEditableKind(doc.kind)) throw notFound();
    const n = (await usage([doc._id])).get(doc._id.toString()) ?? 0;
    if (n > 0) throw conflictWith(lookupInUseMessage(doc.name, n), 'LOOKUP_IN_USE', { usedBy: n });
    await doc.deleteOne();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'lookup',
      entityId: doc._id,
      action: 'lookup_deleted',
      changes: [{ field: 'name', old: doc.name, new: null }],
      meta: { kind: doc.kind },
    });
    res.status(204).end();
  });

  return [r.router, l.router];
}

export { DAY_LOCKED };
