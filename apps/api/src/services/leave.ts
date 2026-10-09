import {
  DEFAULT_LEAVE_TYPES,
  ON_LEAVE,
  addDays,
  halfDayLeaveLabel,
  isWorkingDay,
  parseDateOnly,
  toDateOnly,
  type DayPart,
  type LeaveBalanceDto,
  type LeaveDto,
  type LeaveTypeDto,
  type WorkCalendar,
} from '@xc8/shared';
import type { Logger } from 'pino';
import { Types } from 'mongoose';
import {
  LeaveEntitlementModel,
  LeaveModel,
  LeaveTypeModel,
  MigrationModel,
  UserModel,
  type Leave,
  type LeaveType,
} from '../models/index.js';
import { loadCalendar } from './calendar.js';
import { setLeaveDayLookup, type LeaveDay } from './leaveHook.js';
import { userRefs } from './projectService.js';

type Id = Types.ObjectId;
export type LeaveDoc = Leave & { _id: Id; createdAt?: Date };
export type LeaveTypeDoc = LeaveType & { _id: Id };

const SEED_ID = 'leave-types-seed';

/** Seeds the FR-LV-01 starting list once; Admins edit it afterwards. */
export async function ensureDefaultLeaveTypes(logger?: Logger): Promise<number> {
  if (await MigrationModel.exists({ _id: SEED_ID })) return 0;
  const res = await LeaveTypeModel.bulkWrite(
    DEFAULT_LEAVE_TYPES.map((t, order) => ({
      updateOne: {
        filter: { nameKey: t.name.toLowerCase() },
        update: { $setOnInsert: { ...t, nameKey: t.name.toLowerCase(), order, active: true } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  await MigrationModel.updateOne(
    { _id: SEED_ID },
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
  );
  if (res.upsertedCount) logger?.info({ seeded: res.upsertedCount }, 'leave types seeded');
  return res.upsertedCount;
}

export const toLeaveTypeDto = (t: LeaveTypeDoc): LeaveTypeDto => ({
  id: t._id.toString(),
  name: t.name,
  paid: t.paid,
  unit: t.unit as LeaveTypeDto['unit'],
  needsDocument: Boolean(t.needsDocument),
  carryOverLimit: t.carryOverLimit ?? null,
  active: t.active !== false,
});

/**
 * Working dates a leave covers and what it deducts (EC-78: weekends and non-working holidays
 * are not deducted; FR-LV-02: split by calendar year; half days count 0.5).
 */
export function leaveSpan(from: string, to: string, part: DayPart, cal: WorkCalendar) {
  const dates: Date[] = [];
  for (let d = parseDateOnly(from); toDateOnly(d) <= to; d = addDays(d, 1)) {
    if (isWorkingDay(d, cal)) dates.push(d);
  }
  const per = part === 'FULL' ? 1 : 0.5;
  const byYear = new Map<number, number>();
  for (const d of dates)
    byYear.set(d.getUTCFullYear(), (byYear.get(d.getUTCFullYear()) ?? 0) + per);
  return {
    dates,
    days: dates.length * per,
    byYear: [...byYear.entries()].map(([year, days]) => ({ year, days })),
  };
}

/** Days recorded per type in a year (status RECORDED, past and future). */
export async function recordedByType(userId: Id, year: number) {
  const rows = await LeaveModel.aggregate<{ _id: Id; days: number }>([
    { $match: { userId, status: 'RECORDED', 'byYear.year': year } },
    { $unwind: '$byYear' },
    { $match: { 'byYear.year': year } },
    { $group: { _id: '$leaveTypeId', days: { $sum: '$byYear.days' } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.days]));
}

/** Balance = entitlement + carry-over − recorded (FR-LV-03 without pending, Q-46). */
export async function balancesFor(userId: Id, year: number): Promise<LeaveBalanceDto[]> {
  const [types, ents, recorded] = await Promise.all([
    LeaveTypeModel.find().sort({ order: 1, name: 1 }).lean(),
    LeaveEntitlementModel.find({ userId, year }).lean(),
    recordedByType(userId, year),
  ]);
  const em = new Map(ents.map((e) => [e.leaveTypeId.toString(), e]));
  return types
    .filter((t) => t.active !== false || recorded.has(t._id.toString()))
    .map((t) => {
      const e = em.get(t._id.toString());
      const used = recorded.get(t._id.toString()) ?? 0;
      const balance = t.paid ? (e?.days ?? 0) + (e?.carryOver ?? 0) - used : null;
      return {
        type: toLeaveTypeDto(t as LeaveTypeDoc),
        year,
        entitlement: e ? e.days : null,
        carryOver: e?.carryOver ?? 0,
        recorded: used,
        balance,
        negative: balance !== null && balance < 0,
      };
    });
}

/** Who gets leave notices: the active supervisor, otherwise every active Admin (FR-LV-10). */
export async function leaveRecipients(userId: Id): Promise<Id[]> {
  const u = await UserModel.findById(userId).select('supervisorId').lean();
  if (u?.supervisorId) {
    const sup = await UserModel.findOne({ _id: u.supervisorId, active: true }).select('_id').lean();
    if (sup) return [sup._id];
  }
  const admins = await UserModel.find({ systemRole: 'ADMIN', active: true }).select('_id').lean();
  return admins.map((a) => a._id).filter((id) => !id.equals(userId));
}

/** Recorded leave on one date (FR-LV-11 labels). */
export async function leaveDay(userId: Id, date: Date): Promise<LeaveDay> {
  const leaves = await LeaveModel.find({
    userId,
    status: 'RECORDED',
    from: { $lte: date },
    to: { $gte: date },
    dates: date,
  })
    .select('dayPart')
    .lean();
  const full = leaves.some((l) => l.dayPart === 'FULL');
  const am = leaves.some((l) => l.dayPart === 'AM');
  const pm = leaves.some((l) => l.dayPart === 'PM');
  if (full || (am && pm)) return { full: true, half: null, label: ON_LEAVE };
  if (am) return { full: false, half: 'AM', label: halfDayLeaveLabel('AM') };
  if (pm) return { full: false, half: 'PM', label: halfDayLeaveLabel('PM') };
  return { full: false, half: null, label: null };
}
setLeaveDayLookup(leaveDay);

/** Re-reads the calendar for every new leave (FR-CAL-02). */
export const calendar = () => loadCalendar();

export async function toLeaveDtos(
  docs: LeaveDoc[],
  viewer: { _id: Id; systemRole: string },
  today: Date,
): Promise<LeaveDto[]> {
  const types = await LeaveTypeModel.find({ _id: { $in: docs.map((d) => d.leaveTypeId) } })
    .select('name paid')
    .lean();
  const tm = new Map(types.map((t) => [t._id.toString(), t]));
  const refs = await userRefs([
    ...docs.map((d) => d.userId),
    ...docs.map((d) => d.cancelledBy).filter((x): x is Id => Boolean(x)),
  ]);
  const owners = await UserModel.find({ _id: { $in: docs.map((d) => d.userId) } })
    .select('supervisorId')
    .lean();
  const sup = new Map(owners.map((o) => [o._id.toString(), o.supervisorId?.toString() ?? null]));
  const isAdmin = viewer.systemRole === 'ADMIN';
  return docs.map((d) => {
    const own = d.userId.equals(viewer._id);
    const canSeeReason = own || isAdmin || sup.get(d.userId.toString()) === viewer._id.toString();
    const t = tm.get(d.leaveTypeId.toString());
    const recorded = d.status === 'RECORDED';
    return {
      id: d._id.toString(),
      user: {
        id: d.userId.toString(),
        name: refs.get(d.userId.toString())?.name ?? 'Unknown user',
      },
      type: {
        id: d.leaveTypeId.toString(),
        name: t?.name ?? 'Unknown type',
        paid: t?.paid ?? true,
      },
      dayPart: d.dayPart as DayPart,
      from: toDateOnly(d.from),
      to: toDateOnly(d.to),
      days: d.days,
      byYear: d.byYear.map((y) => ({ year: y.year!, days: y.days! })),
      reason: canSeeReason ? (d.reason ?? null) : null,
      status: d.status as LeaveDto['status'],
      recordedAt: (d.createdAt ?? new Date()).toISOString(),
      cancelledAt: d.cancelledAt ? d.cancelledAt.toISOString() : null,
      cancelledBy: d.cancelledBy
        ? {
            id: d.cancelledBy.toString(),
            name: refs.get(d.cancelledBy.toString())?.name ?? 'Unknown user',
          }
        : null,
      // Own leave that hasn't started; Admins any recorded leave (FR-LV-08).
      can: { cancel: recorded && (isAdmin || (own && d.from > today)) },
    };
  });
}
