import { z } from 'zod';
import type { Ref } from './projects.js';
import { formatShortDate } from './dar.js';

/**
 * Leave (doc 14 §4, §12 Q-46, §16 FR-LV-11): recorded without approval as Full day, Half day AM
 * or Half day PM; yearly balances per type; notices to the supervisor (or all Admins).
 */
export const DAY_PARTS = ['FULL', 'AM', 'PM'] as const;
export type DayPart = (typeof DAY_PARTS)[number];
export const DAY_PART_LABELS: Record<DayPart, string> = {
  FULL: 'Full day',
  AM: 'Half day AM',
  PM: 'Half day PM',
};
export const LEAVE_UNITS = ['DAY', 'HALF_DAY'] as const;
export type LeaveUnit = (typeof LEAVE_UNITS)[number];
export const LEAVE_STATUSES = ['RECORDED', 'CANCELLED'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Starting list (FR-LV-01, Q-44 examples for HR to confirm). */
export const DEFAULT_LEAVE_TYPES: {
  name: string;
  paid: boolean;
  unit: LeaveUnit;
  needsDocument: boolean;
  carryOverLimit: number | null;
}[] = [
  { name: 'Vacation', paid: true, unit: 'HALF_DAY', needsDocument: false, carryOverLimit: 5 },
  { name: 'Sick', paid: true, unit: 'HALF_DAY', needsDocument: true, carryOverLimit: null },
  { name: 'Emergency', paid: true, unit: 'DAY', needsDocument: false, carryOverLimit: null },
  {
    name: 'Service Incentive Leave',
    paid: true,
    unit: 'DAY',
    needsDocument: false,
    carryOverLimit: null,
  },
  { name: 'Maternity', paid: true, unit: 'DAY', needsDocument: true, carryOverLimit: null },
  { name: 'Paternity', paid: true, unit: 'DAY', needsDocument: true, carryOverLimit: null },
  { name: 'Solo Parent', paid: true, unit: 'DAY', needsDocument: true, carryOverLimit: null },
  { name: 'Bereavement', paid: true, unit: 'DAY', needsDocument: false, carryOverLimit: null },
  { name: 'Unpaid', paid: false, unit: 'HALF_DAY', needsDocument: false, carryOverLimit: null },
];

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Choose a valid item.');
const dateOnly = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Pick a valid ${label} date.`);
const halfSteps = (label: string, max: number) =>
  z
    .number({ message: `Enter ${label}.` })
    .min(0, `${label} can't be negative.`)
    .max(max, `${label} can be up to ${max}.`)
    .refine((n) => Number.isInteger(n * 2), `${label} must be in half days.`);

export const leaveTypeSchema = z.strictObject({
  name: z.string().trim().min(1, 'Add a name.').max(80, 'Up to 80 characters.'),
  paid: z.boolean(),
  unit: z.enum(LEAVE_UNITS),
  needsDocument: z.boolean().default(false),
  carryOverLimit: halfSteps('Carry-over limit', 365).nullable().default(null),
});
export const updateLeaveTypeSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Add a name.').max(80, 'Up to 80 characters.').optional(),
    paid: z.boolean().optional(),
    unit: z.enum(LEAVE_UNITS).optional(),
    needsDocument: z.boolean().optional(),
    carryOverLimit: halfSteps('Carry-over limit', 365).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

export const entitlementSchema = z.strictObject({
  userId: objectId,
  leaveTypeId: objectId,
  year: z.number().int().min(2000).max(2100),
  days: halfSteps('Entitlement', 365),
  carryOver: halfSteps('Carry-over', 365).default(0),
});

export const LEAVE_REASON_HINT =
  "Don't include medical details. Only you, your supervisor and Admins can see this.";
export const HALF_DAY_SINGLE_DATE = 'A half day is on a single date. Set "To" to the same date.';
export const TO_BEFORE_FROM = 'Pick a "To" date on or after the "From" date.';

export const recordLeaveSchema = z
  .strictObject({
    leaveTypeId: objectId,
    dayPart: z.enum(DAY_PARTS),
    from: dateOnly('"From"'),
    to: dateOnly('"To"'),
    reason: z.string().trim().max(500, 'Up to 500 characters.').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: TO_BEFORE_FROM });
    else if (v.dayPart !== 'FULL' && v.from !== v.to)
      ctx.addIssue({ code: 'custom', path: ['to'], message: HALF_DAY_SINGLE_DATE });
  });
export type RecordLeaveInput = z.infer<typeof recordLeaveSchema>;

export const leaveListQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  userId: objectId.optional(),
});

export interface LeaveTypeDto {
  id: string;
  name: string;
  paid: boolean;
  unit: LeaveUnit;
  needsDocument: boolean;
  carryOverLimit: number | null;
  active: boolean;
}

export interface LeaveDto {
  id: string;
  user: Ref;
  type: Ref & { paid: boolean };
  dayPart: DayPart;
  from: string;
  to: string;
  /** Working days deducted (weekends and non-working holidays are not, EC-78). */
  days: number;
  /** Days per calendar year (FR-LV-02: a range across New Year counts in each year). */
  byYear: { year: number; days: number }[];
  /** null when the caller can't see it (FR-LV-07). */
  reason: string | null;
  status: LeaveStatus;
  recordedAt: string;
  cancelledAt: string | null;
  cancelledBy: Ref | null;
  can: { cancel: boolean };
}

export interface LeaveBalanceDto {
  type: LeaveTypeDto;
  year: number;
  /** null: no entitlement set (paid) or no limit (unpaid). */
  entitlement: number | null;
  carryOver: number;
  recorded: number;
  /** null for unpaid types (no limit). */
  balance: number | null;
  negative: boolean;
}

export interface EntitlementRowDto {
  user: Ref;
  leaveTypeId: string;
  year: number;
  entitlement: number | null;
  carryOver: number;
  taken: number;
  balance: number | null;
  negative: boolean;
}

// ---------- Messages (doc 14 §10, §12.3, §16) ----------
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
export const overBalanceMessage = (left: number, type: string, need: number) =>
  `You have ${days(left)} of ${type} left, and this needs ${days(need)}. Choose fewer days or another leave type.`;
export const leaveRangeLabel = (from: string, to: string) =>
  from === to ? formatShortDate(from) : `${formatShortDate(from)} – ${formatShortDate(to)}`;
export const leaveOverlapMessage = (dates: string) => `You already have leave filed for ${dates}.`;
export const MORNING_TAKEN = 'You already have leave recorded for this morning.';
export const AFTERNOON_TAKEN = 'You already have leave recorded for this afternoon.';
export const NO_WORKING_DAYS = 'This range has no working days. Pick working days.';
export const fullDayTypeMessage = (type: string) =>
  `${type} is taken in full days. Choose Full day.`;
export const ON_LEAVE = 'On leave';
export const halfDayLeaveLabel = (part: 'AM' | 'PM') => `Half day leave (${part})`;
export const onLeaveTimerMessage = (date: string) =>
  `You're on leave on ${date}. Cancel the leave first to log time.`;
export const halfDayTimerWarning = (part: 'AM' | 'PM', date: string) =>
  `You have half-day leave (${part}) on ${date}. Log time anyway?`;
export const PAST_LEAVE_ADMIN_ONLY =
  'Only leave that hasn’t started can be cancelled here. For past leave, ask an Admin.';
export const negativeBalanceWarning = (
  name: string,
  taken: number,
  type: string,
  set: number,
  balance: number,
) =>
  `${name} has already taken ${days(taken)} of ${type}. Setting ${set} makes the balance ${leaveDaysLabel(balance)}. The balance is flagged (EC-79).`;
export const carryOverLimitMessage = (type: string, limit: number) =>
  `Carry-over for ${type} can be up to ${days(limit)}.`;
export const NO_SUPERVISOR_LEAVE =
  "You don't have a supervisor yet, so your leave notices go to all Admins. Ask an Admin to set your supervisor.";

// ---------- DR-33: AM + PM halves shown as one full day (FR-LV-11) ----------
export const FULL_DAY_AM_PM = 'Full day (AM + PM)';
export type LeaveRow = LeaveDto & {
  /** The morning and afternoon records merged into this row; each can still be cancelled. */
  halves?: [LeaveDto, LeaveDto];
};
/**
 * Merges a recorded Half day AM and Half day PM of the same person, type and date into one row
 * (1 working day, "Full day (AM + PM)"). Order is kept at the first half's position.
 */
export function mergeHalfDays(items: LeaveDto[]): LeaveRow[] {
  const key = (l: LeaveDto) => `${l.user.id}|${l.type.id}|${l.from}`;
  const pm = new Map<string, LeaveDto>();
  const am = new Map<string, LeaveDto>();
  for (const l of items) {
    if (l.status !== 'RECORDED' || l.from !== l.to) continue;
    if (l.dayPart === 'AM' && !am.has(key(l))) am.set(key(l), l);
    if (l.dayPart === 'PM' && !pm.has(key(l))) pm.set(key(l), l);
  }
  const used = new Set<string>();
  const out: LeaveRow[] = [];
  for (const l of items) {
    if (used.has(l.id)) continue;
    const k = key(l);
    const a = am.get(k);
    const p = pm.get(k);
    if (a && p && (l.id === a.id || l.id === p.id)) {
      used.add(a.id);
      used.add(p.id);
      out.push({
        ...a,
        id: `${a.id}+${p.id}`,
        dayPart: 'FULL',
        days: a.days + p.days,
        byYear: a.byYear.map((y) => ({
          year: y.year,
          days: y.days + (p.byYear.find((x) => x.year === y.year)?.days ?? 0),
        })),
        reason:
          [a.reason, p.reason].filter((r, i, arr) => r && arr.indexOf(r) === i).join(' / ') || null,
        can: { cancel: a.can.cancel || p.can.cancel },
        halves: [a, p],
      });
      continue;
    }
    out.push(l);
  }
  return out;
}

/**
 * Leave days with a real minus sign (U+2212, DR-38): -3.5 → "−3.5"; null → "–". The one helper
 * for every balance on screen (My leave, Team on leave, Admin › Leave › Entitlements) and in
 * messages.
 */
export function leaveDaysLabel(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  return n < 0 ? `\u2212${Math.abs(n)}` : String(n);
}
