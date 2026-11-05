import { z } from 'zod';
import type { Ref } from './projects.js';
import type { TimeType } from './m3.js';
import { TIME_TYPES, moduleText } from './m3.js';

/**
 * Milestone 5: Activity Tracker (doc 14 §2, §10, §12). One time-entry model: timed entries
 * (time in / time out, exact minutes) and hours-only entries (FR-TIME) live together. Quick
 * activities are entries with no project. All times are Philippine time (UTC+8, A-17).
 */
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.');
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour).');
const remarks = z.string().trim().max(1000).nullable().optional();

export const PH_OFFSET_MINUTES = 8 * 60;

// ---------- Admin lists (FR-ACT-15, §10) ----------
export const LOOKUP_KINDS = ['ACTIVITY_TYPE', 'LOCATION', 'MODULE'] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];
/**
 * The lists Admins edit. Module became free text (FR-ACT-20..22): the old MODULE values stay in
 * the database untouched and are no longer shown or edited.
 */
export const EDITABLE_LOOKUP_KINDS = ['ACTIVITY_TYPE', 'LOCATION'] as const;
export type EditableLookupKind = (typeof EDITABLE_LOOKUP_KINDS)[number];
export const LOOKUP_LABELS: Record<LookupKind, { one: string; many: string; path: string }> = {
  ACTIVITY_TYPE: { one: 'activity type', many: 'Activity types', path: 'activity-types' },
  LOCATION: { one: 'location', many: 'Locations', path: 'locations' },
  MODULE: { one: 'module', many: 'Modules', path: 'modules' },
};
export const DEFAULT_LOOKUPS: Record<LookupKind, string[]> = {
  ACTIVITY_TYPE: [
    'Integration',
    'Configuration',
    'Data migration',
    'Training',
    'Testing / UAT',
    'Development',
    'Internal meeting',
    'Client meeting',
    'Pre-sales',
    'Admin work',
    'Support',
    'Other',
  ],
  LOCATION: ['Onsite', 'WFH', 'Office'],
  // Free text since mockup v0.8.9: nothing to seed.
  MODULE: [],
};
/** Doc 14 FR-ACT-32 / NFR-31: the system Activity type, preselected by Add quick activity. */
export const QUICK_ACTIVITY_KEY = 'quick_activity';
export const QUICK_ACTIVITY_NAME = 'Quick Activity';
/** EC-90 / A-21: an Admin-made type already named "Quick Activity" is renamed to this. */
export const QUICK_ACTIVITY_CUSTOM_NAME = 'Quick Activity (custom)';
export const SYSTEM_ACTIVITY_TYPE_MESSAGE =
  "Quick Activity is a system type. It can't be renamed, deactivated or deleted.";
export const lookupSchema = z.strictObject({
  name: z.string().trim().min(1, 'Add a name.').max(80),
});
export const updateLookupSchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Add a name.').max(80).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export interface LookupDto {
  id: string;
  kind: LookupKind;
  name: string;
  active: boolean;
  /** Entries using it (Admin list only; null elsewhere). */
  usedBy: number | null;
  deactivatedAt: string | null;
  deactivatedBy: Ref | null;
  createdAt: string;
  /** Stable key for system values (`quick_activity`), else null (NFR-31). */
  key: string | null;
  /** System value: no rename, deactivate or delete (FR-ACT-32). */
  system: boolean;
}
/** GET /lookups option (entry forms). `key`/`system` added in m8-polish (additive). */
export interface LookupOptionDto {
  id: string;
  name: string;
  key: string | null;
  system: boolean;
}
export const lookupInUseMessage = (name: string, n: number) =>
  `"${name}" is used by ${n} ${n === 1 ? 'entry' : 'entries'}, so it can't be deleted. Deactivate it instead.`;

// ---------- Entries ----------
/** Fields every timed entry carries (FR-ACT-15, -16, -17, -18). */
const entryFields = {
  activityTypeId: objectId,
  /** Optional free text, max 100 (FR-ACT-20). */
  module: moduleText,
  /** Null = the day's location (FR-ACT-17). */
  locationId: objectId.nullable().optional(),
  /** Defaults: Yes for project tasks, No for quick activities. */
  billable: z.boolean().optional(),
  /** Project tasks only; defaults to Execution (FR-ACT-18). */
  type: z.enum(TIME_TYPES).optional(),
  notes: remarks,
};

/** What is being timed: a project task, or a quick activity with a title (FR-ACT-06). */
const target = {
  taskId: objectId.optional(),
  title: z.string().trim().min(1, 'Add a title.').max(150).optional(),
};
const oneTarget = (v: { taskId?: string; title?: string }) =>
  Boolean(v.taskId) !== Boolean(v.title);
const TARGET_MESSAGE = 'Choose a task, or give the quick activity a title.';

/**
 * Time in. The server sets the start time (FR-ACT-09): the schema is strict, so a client can't
 * send its own start or end. `dayLocationId` answers "Where are you working today?" on the
 * first entry of the day.
 */
export const startTimerSchema = z
  .strictObject({
    ...target,
    ...entryFields,
    dayLocationId: objectId.optional(),
    /** Confirms the half-day leave warning (FR-LV-06). */
    confirmLeave: z.boolean().optional(),
    /**
     * FR-ACT-26 Switch: the running timer the user agreed to stop. Without it, Time in while a
     * timer runs answers 409 TIMER_RUNNING; with a stale id (that timer already stopped and
     * another started), it answers 409 too, so two starts can never both win.
     */
    switchFrom: objectId.optional(),
  })
  .refine(oneTarget, { message: TARGET_MESSAGE, path: ['taskId'] });
export type StartTimerInput = z.input<typeof startTimerSchema>;

/** A manual timed entry (FR-ACT-10): date with time in and time out. */
export const timedEntrySchema = z
  .strictObject({
    ...target,
    ...entryFields,
    date: dateOnly,
    timeIn: hhmm,
    timeOut: hhmm,
    dayLocationId: objectId.optional(),
    confirmLeave: z.boolean().optional(),
  })
  .refine(oneTarget, { message: TARGET_MESSAGE, path: ['taskId'] })
  .refine((v) => v.timeOut > v.timeIn, {
    message: 'Time out must be after time in.',
    path: ['timeOut'],
  });
export type TimedEntryInput = z.input<typeof timedEntrySchema>;

export const updateTimedEntrySchema = z
  .strictObject({
    title: z.string().trim().min(1, 'Add a title.').max(150).optional(),
    timeIn: hhmm.optional(),
    timeOut: hhmm.optional(),
    activityTypeId: objectId.optional(),
    module: moduleText,
    locationId: objectId.nullable().optional(),
    billable: z.boolean().optional(),
    type: z.enum(TIME_TYPES).optional(),
    notes: remarks,
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type UpdateTimedEntryInput = z.input<typeof updateTimedEntrySchema>;

export const dayLocationSchema = z.strictObject({ locationId: objectId });

/**
 * Time out (FR-ACT-02, FR-ACT-23). `entryId` makes it idempotent: the top bar and the Day
 * timesheet both send it, so a second click returns the already-stopped entry unchanged.
 */
export const stopTimerSchema = z.strictObject({
  entryId: objectId.optional(),
  /** Accepted for older clients; ignored. */
  locationId: objectId.optional(),
});
export type StopTimerInput = z.input<typeof stopTimerSchema>;
export const reopenDaySchema = z.strictObject({
  userId: objectId,
  reason: z.string().trim().min(1, 'Add a reason for reopening.').max(500),
});
export const dayQuerySchema = z.strictObject({
  date: dateOnly.optional(),
  userId: objectId.optional(),
});

export type EntryKind = 'TASK' | 'QUICK';
export type DayStatus = 'OPEN' | 'SUBMITTED' | 'REOPENED';

export interface TrackerEntryDto {
  id: string;
  kind: EntryKind;
  user: Ref;
  /** Project task entries; null for quick activities. */
  project: Ref | null;
  client: Ref | null;
  task: Ref | null;
  /** Quick activity title. */
  title: string | null;
  date: string;
  /** ISO instants; null for hours-only entries. `endAt` null while running. */
  startAt: string | null;
  endAt: string | null;
  running: boolean;
  /** Exact minutes (running: up to now), with the 12:00–1:00 PM lunch taken out (CR-20). */
  minutes: number;
  /** CR-20 FR-ACT-41: lunch minutes taken off this entry (0 for hours-only or older entries). */
  lunchMinutes: number;
  /** Hours-only entries (FR-TIME) have no times. */
  timed: boolean;
  autoStopped: boolean;
  activityType: Ref | null;
  /** Free text (mockup v0.8.9). */
  module: string | null;
  /** The effective location (the entry's own, or the day's). */
  location: Ref | null;
  locationOverridden: boolean;
  billable: boolean;
  type: TimeType | null;
  notes: string | null;
  /** Read-only for the caller (submitted day, weekly lock, someone else's entry). */
  locked: boolean;
}

export interface ReopenDto {
  by: Ref;
  at: string;
  reason: string;
}

export interface TrackerDayDto {
  user: Ref;
  date: string;
  location: Ref | null;
  status: DayStatus;
  submittedAt: string | null;
  reopened: ReopenDto[];
  /** Past the weekly lock without being submitted (FR-ACT-13). */
  notSubmitted: boolean;
  /** Past the weekly lock (only an Admin can reopen). */
  weekLocked: boolean;
  entries: TrackerEntryDto[];
  totalMinutes: number;
  /** The caller's own day. */
  own: boolean;
  can: { edit: boolean; submit: boolean; reopen: boolean };
  /** Filled by M7 Leave: "On leave", "Half day leave (AM)" … */
  leave: string | null;
  /** FR-LV-12: the recorded leave on this day, shown as grey read-only rows at the top. */
  leaveRows: TrackerLeaveRowDto[];
}

export interface RunningDto {
  entry: TrackerEntryDto | null;
  /** Server time, so the top-bar timer doesn't drift with the browser clock. */
  now: string;
}

// ---------- Formatting (12.2) ----------
/** 427 → "07:07"; 1510 → "25:10". Exact minutes, no rounding. */
export function formatHHMM(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/**
 * Decimal hours → HH:MM (DR-25, 12.2): 0.0333 → "00:02", 4.8833 → "04:53", 40 → "40:00".
 * Hours stored as decimals come from exact minutes, so rounding to the minute is lossless.
 */
export function hoursHHMM(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '–';
  return formatHHMM(Math.round(hours * 60));
}
/** 1510 → "25h 10m" (24-hour cap message, 12.3). */
export function formatHoursMinutes(minutes: number): string {
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
/** ISO instant → "08:00 AM" in Philippine time (FR-DAR-08). */
export function formatTime12(iso: string): string {
  const d = new Date(new Date(iso).getTime() + PH_OFFSET_MINUTES * 60_000);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
/** ISO instant → "08:00" (24-hour) in Philippine time, for form fields. */
export function formatTime24(iso: string): string {
  return new Date(new Date(iso).getTime() + PH_OFFSET_MINUTES * 60_000).toISOString().slice(11, 16);
}
/** "2026-10-09" + "08:30" (Philippine time) → the instant. */
export function phInstant(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+08:00`);
}
/** The auto-stop moment for a Philippine date: 23:59 (FR-ACT-04). */
export function autoStopAt(date: string): Date {
  return phInstant(date, '23:59');
}
/**
 * DR-45: timer times are saved floored to the whole minute (01:02:40 → 01:02:00), so an entry's
 * minutes always equal end minus start as shown (01:02 → 01:05 is 00:03).
 */
export const floorToMinute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

export const minutesBetween = (a: Date, b: Date) =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

// ---------- Lunch break (CR-20, Jomerson Nov 5) ----------
/** The standard day is 08:00 AM – 05:00 PM Philippine time, with 12:00 – 1:00 PM as unpaid lunch. */
export const WORKDAY_START = '08:00';
export const WORKDAY_END = '17:00';
export const LUNCH_START = '12:00';
export const LUNCH_END = '13:00';
/** CR-20 Q-125: an entry entirely inside lunch is refused. */
export const LUNCH_ONLY_MESSAGE = 'This time is inside the 12:00–1:00 PM lunch break.';
/** "Lunch 1h 00m not counted" for an entry that lost lunch time. */
export const lunchTakenLabel = (minutes: number) =>
  `Lunch ${formatHoursMinutes(minutes)} not counted`;

const phDateKey = (d: Date) =>
  new Date(d.getTime() + PH_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
const nextDateKey = (date: string) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/** Milliseconds of [a, b) that fall in a 12:00–1:00 PM lunch hour (Philippine time), any day. */
export function lunchMs(a: Date, b: Date): number {
  if (b <= a) return 0;
  let total = 0;
  const last = phDateKey(b);
  for (let day = phDateKey(a), n = 0; day <= last && n < 400; day = nextDateKey(day), n++) {
    const ls = phInstant(day, LUNCH_START).getTime();
    const le = phInstant(day, LUNCH_END).getTime();
    const overlap = Math.min(b.getTime(), le) - Math.max(a.getTime(), ls);
    if (overlap > 0) total += overlap;
  }
  return total;
}
/** Whole minutes of [a, b) inside lunch (times are on whole minutes, DR-45). */
export const lunchMinutes = (a: Date, b: Date) => Math.round(lunchMs(a, b) / 60_000);

/** Counted minutes of a timed entry: end minus start, less any 12:00–1:00 PM lunch overlap. */
export const workedMinutes = (a: Date, b: Date) =>
  Math.max(0, minutesBetween(a, b) - lunchMinutes(a, b));

/**
 * CR-20 FR-ACT-37..42: the live helper under Time in / Time out, for "08:00"–"17:00" on a
 * Philippine date: "Counts as 8h 00m. Lunch 1h 00m not counted." ("Counts as 2h 00m." with no
 * lunch; LUNCH_ONLY_MESSAGE when the whole range is lunch). Null unless both times are valid and
 * Time out is after Time in.
 */
export function countsAsLabel(date: string, timeIn: string, timeOut: string): string | null {
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!hhmm.test(timeIn) || !hhmm.test(timeOut) || timeOut <= timeIn) return null;
  const a = phInstant(date, timeIn);
  const b = phInstant(date, timeOut);
  const lunch = lunchMinutes(a, b);
  const worked = workedMinutes(a, b);
  if (worked === 0) return LUNCH_ONLY_MESSAGE;
  const counts = `Counts as ${formatHoursMinutes(worked)}.`;
  return lunch > 0 ? `${counts} ${lunchTakenLabel(lunch)}.` : counts;
}

/**
 * CR-20 DEF-061: the earliest end where `minutes` of work (lunch taken out) have passed since
 * `start`. Each step adds only the shortfall, so it never overshoots and lands past lunch.
 */
export function endAfterWorkedMinutes(start: Date, minutes: number): Date {
  let end = new Date(start.getTime() + minutes * 60_000);
  for (let short = minutes - workedMinutes(start, end); short > 0;) {
    end = new Date(end.getTime() + short * 60_000);
    short = minutes - workedMinutes(start, end);
  }
  return end;
}

/** CR-20 FR-ACT-37..42: true while it is 12:00–1:00 PM Philippine time (a running timer holds still). */
export const isLunchTime = (at: Date) => lunchMs(at, new Date(at.getTime() + 1)) > 0;

// ---------- Messages (doc 14 §11, §12.3) ----------
export const dailyCapMessage = (date: string, minutes: number) =>
  `This would bring your total for ${date} to ${formatHoursMinutes(minutes)}. A day can't exceed 24 hours. Shorten or remove an entry.`;
export const overlapMessage = (other: string, start: string, end: string) =>
  `This overlaps ${other} (${start}–${end}). Adjust the times so they don't overlap.`;
export const STOP_TIMER_FIRST = 'Stop the running timer before submitting this day.';
export const DAY_LOCKED = 'This day is locked. Ask your supervisor or an Admin to reopen it.';
export const DAY_LOCKED_ADMIN = 'This day is past the day lock. Only an Admin can reopen it.';
export const AUTO_STOPPED_LABEL = 'Auto-stopped – please check';
export const NOT_SUBMITTED_LABEL = 'Not submitted';
export const WHERE_WORKING = 'Where are you working today?';
export const reopenedMessage = (name: string, date: string, reason: string) =>
  `${name} reopened your timesheet for ${date}: ${reason}. Make your changes and submit it again before the weekly lock.`;
export const onHoldStoppedMessage = (project: string, task: string, time: string) =>
  `${project} was put on hold, so your timer on "${task}" stopped at ${time}.`;

/** FR-ACT-26: the Switch prompt shown when Time in finds another timer running. */
export const switchTimerQuestion = (name: string) => `Stop '${name}' and start this one?`;
export const TIMER_RUNNING_MESSAGE = 'A timer is already running. Stop it first or switch.';
/** 409 TIMER_RUNNING details: the timer that's running. */
export interface TimerRunningDetails {
  running: { id: string; name: string };
}

/** FR-LV-12: one recorded leave on a Day timesheet ("Vacation · Full day"). */
export interface TrackerLeaveRowDto {
  id: string;
  type: string;
  dayPart: 'FULL' | 'AM' | 'PM';
  label: string;
}
export function leaveRowLabel(type: string, dayPart: 'FULL' | 'AM' | 'PM'): string {
  return `${type} · ${dayPart === 'FULL' ? 'Full day' : `Half day ${dayPart}`}`;
}
