import { z } from 'zod';
import {
  addDays,
  isWorkingDay,
  parseDateOnly,
  toDateOnly,
  workingDaysSince,
  DEFAULT_CALENDAR,
  MAX_CALENDAR_SCAN_DAYS,
  CalendarLimitError,
  type HolidayType,
  type ProjectStatus,
  type TaskStatus,
  type WorkCalendar,
} from './projects.js';

/**
 * CR-22 Part B, slice 1 (FR-TL-01 to 07, 23): the project timeline. Pure and calendar-driven, so
 * the web and any later mobile app draw the same chart (NFR-50). Dates are calendar dates as
 * YYYY-MM-DD and never shift with the viewer's time zone (NFR-51).
 */

/** Doc 14 §J: phase identity ignores case and leading/trailing spaces. */
export function timelinePhaseKey(name: string): string {
  return name.trim().toLowerCase();
}

// ---------- Inputs ----------
export interface TimelineTaskInput {
  id: string;
  order: number;
  name: string;
  /** CR-22 (Lead): the phase record id; `phase` is the phase's current name. */
  phaseId: string | null;
  phase: string | null;
  status: TaskStatus;
  plannedStart: string | null;
  dueDate: string | null;
  isMilestone: boolean;
  dependsOn: readonly string[];
  owner: { id: string; name: string } | null;
}

export interface TimelinePhaseInput {
  /** Phase record id; null for a phase that only exists as task text (not saved in the list yet). */
  id: string | null;
  name: string;
  targetDate: string | null;
}

// ---------- Scheduling basics ----------
/** FR-TL-02: a task needs both a start and a finish to be scheduled (milestone: Finish = Start). */
export function isScheduled(t: { plannedStart: string | null; dueDate: string | null }): boolean {
  return Boolean(t.plannedStart && t.dueDate && t.dueDate >= t.plannedStart);
}

/** FR-TL-27: the next working day after `date` (YYYY-MM-DD). */
export function nextWorkingDayAfter(date: string, cal: WorkCalendar = DEFAULT_CALENDAR): string {
  let d = addDays(parseDateOnly(date), 1);
  for (let steps = 0; !isWorkingDay(d, cal); steps++) {
    if (steps > MAX_CALENDAR_SCAN_DAYS) throw new CalendarLimitError();
    d = addDays(d, 1);
  }
  return toDateOnly(d);
}

/**
 * FR-TL-30: working days from `from` to `to`, late positive. 0 on the same day; a Friday compared
 * with the next Monday is −1 (the weekend doesn't count).
 */
export function workingDayVariance(
  from: string,
  to: string,
  cal: WorkCalendar = DEFAULT_CALENDAR,
): number {
  if (to === from) return 0;
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  return to > from ? workingDaysSince(a, b, cal) : -workingDaysSince(b, a, cal);
}

/** UIE §2.4 phase variance: `On time`, `+1d`, `−2d` (U+2212 minus). */
export function shortVarianceLabel(days: number): string {
  if (days === 0) return 'On time';
  return days > 0 ? `+${days}d` : `\u2212${-days}d`;
}

// ---------- Dependencies ----------
/**
 * One finish-to-start link (FR-TL-06). OK: drawn normally. BROKEN (FR-TL-07, AC-72.4; Lead): the
 * successor's planned start is on or before its predecessor's finish; drawn red, never blocks or
 * moves dates. A start on a non-working day right after the finish (Saturday after a Friday) is
 * not broken; the forecast treats it as the next working day (FR-TL-27). UNSCHEDULED (FR-TL-28): one end has no dates, so the link is ignored and the scheduled
 * end shows a warning icon. CANCELLED (EC-190): one end is cancelled, so the link is satisfied.
 */
export type TimelineLinkState = 'OK' | 'BROKEN' | 'UNSCHEDULED' | 'CANCELLED';

export interface TimelineLink {
  from: string;
  to: string;
  state: TimelineLinkState;
  /** The earliest start the link allows: the next working day after the predecessor (FR-TL-27). */
  earliestStart: string | null;
}

export function timelineLinks(
  tasks: readonly TimelineTaskInput[],
  cal: WorkCalendar = DEFAULT_CALENDAR,
): TimelineLink[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: TimelineLink[] = [];
  for (const succ of tasks) {
    for (const predId of succ.dependsOn) {
      const pred = byId.get(predId);
      if (!pred || pred.id === succ.id) continue;
      let state: TimelineLinkState = 'OK';
      let earliestStart: string | null = null;
      if (pred.status === 'CANCELLED' || succ.status === 'CANCELLED') state = 'CANCELLED';
      else if (!isScheduled(pred) || !isScheduled(succ)) state = 'UNSCHEDULED';
      else {
        earliestStart = nextWorkingDayAfter(pred.dueDate!, cal);
        if (succ.plannedStart! <= pred.dueDate!) state = 'BROKEN';
      }
      out.push({ from: pred.id, to: succ.id, state, earliestStart });
    }
  }
  return out;
}

/**
 * FR-TL-07 / AC-72.8: the task form's warning when the planned start is on or before a
 * predecessor's finish. Pure, so the form can check before saving. Never blocks.
 */
export function brokenDependencies(
  task: {
    id: string;
    plannedStart: string | null;
    dueDate: string | null;
    dependsOn: readonly string[];
  },
  others: readonly Pick<
    TimelineTaskInput,
    'id' | 'order' | 'name' | 'plannedStart' | 'dueDate' | 'status'
  >[],
) {
  if (!isScheduled(task)) return [];
  const byId = new Map(others.map((t) => [t.id, t]));
  return task.dependsOn
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p) && p!.id !== task.id)
    .filter((p) => p.status !== 'CANCELLED' && isScheduled(p))
    .filter((p) => task.plannedStart! <= p.dueDate!)
    .map((p) => ({ id: p.id, order: p.order, name: p.name, finish: p.dueDate! }));
}

// ---------- Groups ----------
export type TimelineGroupKind = 'PHASE' | 'NO_PHASE' | 'UNSCHEDULED';

export interface TimelineGroup {
  kind: TimelineGroupKind;
  key: string;
  name: string;
  phaseId: string | null;
  targetDate: string | null;
  /** Rows shown in this group, in plan order. Unscheduled tasks go to the UNSCHEDULED group. */
  tasks: TimelineTaskInput[];
  /** Every task of the phase, scheduled or not (for counts and completion). */
  memberCount: number;
  /** Summary bar: earliest start to latest finish of its scheduled, non-cancelled tasks. */
  start: string | null;
  finish: string | null;
  /** FR-TL-03: all non-cancelled tasks done; false when every task is cancelled (A-53). */
  complete: boolean;
  allCancelled: boolean;
  completedOn: string | null;
  /** Completed: completion vs target; otherwise latest planned finish vs target (working days). */
  variance: number | null;
}

export interface TimelineModel {
  groups: TimelineGroup[];
  links: TimelineLink[];
  broken: TimelineLink[];
  scheduledCount: number;
  unscheduledCount: number;
  /** Tasks shown (cancelled included). */
  taskCount: number;
  range: { start: string; end: string };
  milestoneCount: number;
}

/** Done task's finish for phase completion. Slice 2 adds actual finish and the Done date (FR-TL-31). */
function doneFinish(
  t: TimelineTaskInput & { actualFinish?: string | null; doneAt?: string | null },
) {
  return t.actualFinish ?? t.doneAt ?? t.dueDate ?? null;
}

const maxDate = (xs: (string | null | undefined)[]) =>
  xs
    .filter((x): x is string => Boolean(x))
    .reduce<string | null>((m, x) => (!m || x > m ? x : m), null);
const minDate = (xs: (string | null | undefined)[]) =>
  xs
    .filter((x): x is string => Boolean(x))
    .reduce<string | null>((m, x) => (!m || x < m ? x : m), null);

/** Monday on or before `date` (the week grid starts on Mondays, UIE §2.4). */
export function mondayOnOrBefore(date: string): string {
  const d = parseDateOnly(date);
  return toDateOnly(addDays(d, -((d.getUTCDay() + 6) % 7)));
}

/**
 * The chart's date range: every bar, today, the target delivery date and phase targets, padded by
 * a week on each side and aligned to Mondays.
 */
export function timelineRange(dates: (string | null | undefined)[], today: string) {
  const lo = minDate([...dates, today])!;
  const hi = maxDate([...dates, today])!;
  const start = mondayOnOrBefore(toDateOnly(addDays(parseDateOnly(lo), -7)));
  const end = toDateOnly(addDays(parseDateOnly(mondayOnOrBefore(hi)), 13));
  return { start, end };
}

export function buildTimeline(input: {
  tasks: readonly TimelineTaskInput[];
  phases: readonly TimelinePhaseInput[];
  plannedEndDate: string | null;
  today: string;
  calendar?: WorkCalendar;
}): TimelineModel {
  const cal = input.calendar ?? DEFAULT_CALENDAR;
  const tasks = [...input.tasks].sort((a, b) => a.order - b.order);
  const groups = new Map<string, TimelineGroup>();
  const ordered: TimelineGroup[] = [];
  const mk = (kind: TimelineGroupKind, key: string, name: string, ph?: TimelinePhaseInput) => {
    const g: TimelineGroup = {
      kind,
      key,
      name,
      phaseId: ph?.id ?? null,
      targetDate: ph?.targetDate ?? null,
      tasks: [],
      memberCount: 0,
      start: null,
      finish: null,
      complete: false,
      allCancelled: false,
      completedOn: null,
      variance: null,
    };
    groups.set(key, g);
    ordered.push(g);
    return g;
  };
  const keyById = new Map<string, string>();
  for (const ph of input.phases) {
    const key = ph.id ? `id:${ph.id}` : timelinePhaseKey(ph.name);
    if (ph.id) keyById.set(ph.id, key);
    if (!groups.has(key)) mk('PHASE', key, ph.name.trim(), ph);
  }
  // Tasks join their phase record by id; a task with only a name (before the phase migration)
  // joins by name, ignoring case and spaces.
  const keyByName = new Map(
    [...groups.values()].map((g) => [timelinePhaseKey(g.name), g.key] as const),
  );
  const members = new Map<string, TimelineTaskInput[]>();
  for (const t of tasks) {
    const key =
      (t.phaseId && keyById.get(t.phaseId)) ||
      (t.phase?.trim()
        ? (keyByName.get(timelinePhaseKey(t.phase)) ?? timelinePhaseKey(t.phase))
        : '');
    if (key && !groups.has(key)) {
      mk('PHASE', key, t.phase!.trim());
      keyByName.set(timelinePhaseKey(t.phase!), key);
    }
    if (!members.has(key)) members.set(key, []);
    members.get(key)!.push(t);
  }
  if (members.has('')) mk('NO_PHASE', '', 'No phase');
  const unscheduled = mk('UNSCHEDULED', '\u0000unscheduled', 'Unscheduled');
  for (const [key, list] of members) {
    const g = groups.get(key)!;
    g.memberCount = list.length;
    for (const t of list) (isScheduled(t) ? g : unscheduled).tasks.push(t);
    const active = list.filter((t) => t.status !== 'CANCELLED');
    const activeScheduled = active.filter(isScheduled);
    g.start = minDate(activeScheduled.map((t) => t.plannedStart));
    g.finish = maxDate(activeScheduled.map((t) => t.dueDate));
    g.allCancelled = list.length > 0 && active.length === 0;
    g.complete = active.length > 0 && active.every((t) => t.status === 'COMPLETED');
    if (g.complete) g.completedOn = maxDate(active.map(doneFinish));
    const compare = g.complete ? g.completedOn : g.finish;
    if (g.kind === 'PHASE' && g.targetDate && compare) {
      g.variance = workingDayVariance(g.targetDate, compare, cal);
    }
  }
  unscheduled.memberCount = unscheduled.tasks.length;
  const links = timelineLinks(tasks, cal);
  const scheduledCount = tasks.filter(isScheduled).length;
  const range = timelineRange(
    [
      ...tasks.filter(isScheduled).flatMap((t) => [t.plannedStart, t.dueDate]),
      input.plannedEndDate,
      ...ordered.map((g) => g.targetDate),
    ],
    input.today,
  );
  return {
    // Empty phases stay (so their target flag shows); No phase and Unscheduled only with rows.
    groups: ordered
      .filter((g) => g.kind === 'PHASE' || g.tasks.length > 0)
      .sort((a, b) => Number(a.kind === 'UNSCHEDULED') - Number(b.kind === 'UNSCHEDULED')),
    links,
    broken: links.filter((l) => l.state === 'BROKEN'),
    scheduledCount,
    unscheduledCount: tasks.length - scheduledCount,
    taskCount: tasks.length,
    range,
    milestoneCount: tasks.filter((t) => t.isMilestone).length,
  };
}

// ---------- Copy (UIE §2) ----------
export const TIMELINE_READ_ONLY_NOTE =
  'View only. The project PM or an Admin changes dates, phases and the baseline.';
export const TIMELINE_PHONE_NOTE = 'On a phone you can view the timeline and open task details.';
export const TIMELINE_LARGER_SCREEN = 'Open this on a larger screen to make changes.';
export const TIMELINE_EMPTY_HELP =
  'A task needs both a start and a finish to show on the timeline. Add dates in the Checklist, or import a timeline from Excel.';
export const BROKEN_LINK_TITLE = 'Starts before a task it depends on finishes.';
export const PHASE_NAMES_LOCKED_TIP =
  'Phases can be added, renamed or removed only while the project is in Planning';
export const PHASE_HAS_TASKS_TIP = 'Move its tasks to another phase first';
export const PHASES_INTRO =
  'Tasks pick their phase from this list, and the timeline shows phases in this order. A phase is complete when all its tasks are done; cancelled tasks are left out, and a phase whose tasks are all cancelled has no completion date.';
export const PHASES_HISTORY_NOTE =
  'Changes are recorded in the project history. A saved baseline keeps its original dates, so variance still compares with them.';

export function noDatesLine(n: number): string {
  return `${n} task${n === 1 ? ' has' : 's have'} no dates yet.`;
}

export function phasesLockedAlert(status: ProjectStatus): string {
  const label = status === 'ON_HOLD' ? 'On hold' : status === 'ACTIVE' ? 'Active' : status;
  return `This project is ${label}. You can change target completion dates. Phases can be added, renamed or removed only while the project is in Planning.`;
}

export function phasesSavedToast(targetsOnly: boolean): string {
  return targetsOnly
    ? 'Phase target dates saved. The change is recorded in the project history.'
    : 'Phases saved. The change is recorded in the project history.';
}

/** UIE §2.3: the broken-dependency banner's lead. */
export function brokenBannerLead(n: number): string {
  return n === 1 ? '1 broken dependency.' : `${n} broken dependencies.`;
}

// ---------- Phase list (FR-TL-23) ----------
/** Statuses in which a PM may change phase target dates (Lean, 2026-11-11 ~12:59 AM SGT). */
export const PHASE_TARGET_STATUSES: readonly ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD'];

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

/**
 * PUT /projects/:id/phase-list: the whole phase list in its new order. `id` names an existing
 * record (or `originalName` a text-only phase); rows without either are new phases.
 */
export const savePhaseListSchema = z.strictObject({
  phases: z
    .array(
      z.strictObject({
        id: z
          .string()
          .regex(/^[a-f0-9]{24}$/i, 'Invalid id.')
          .nullable()
          .optional(),
        originalName: z.string().trim().max(120).nullable().optional(),
        name: z.string().trim().min(1, 'Enter a phase name.').max(120),
        targetDate: dateOnly.nullable(),
      }),
    )
    .max(200),
});
export type SavePhaseListInput = z.infer<typeof savePhaseListSchema>;

export const PHASE_NAME_REQUIRED = 'Enter a phase name.';
export const PHASE_NAME_DUPLICATE = 'There\u2019s already a phase with this name.';
/** Under the task form's phase pick (Lead: no free-text phases). */
export const PHASE_PICK_HINT = 'New phases are added in Phases on the Timeline tab.';
/** 422 UNKNOWN_PHASE (Lead): a task's phase must be one of its project's phases. */
export const UNKNOWN_PHASE_MESSAGE =
  'Pick a phase from this project\u2019s phase list. New phases are added in Phases on the Timeline.';

// ---------- API DTO ----------
export interface TimelinePhaseDto extends TimelinePhaseInput {
  taskCount: number;
  documentCount: number;
}

export interface TimelineDto {
  project: {
    id: string;
    name: string;
    status: ProjectStatus;
    archived: boolean;
    plannedEndDate: string | null;
  };
  /** Philippine calendar date (FR-TSK-21). */
  today: string;
  calendar: {
    workingDays: number[];
    holidays: Record<string, HolidayType>;
    holidayNames: Record<string, string>;
  };
  phases: TimelinePhaseDto[];
  tasks: TimelineTaskInput[];
  can: {
    /** Planners (Admin, PM on the project): task dates and the plan (FR-TL-14). */
    plan: boolean;
    /** Phase target dates: Admin any time, PM in Planning, Active or On hold (FR-TL-23). */
    editPhaseTargets: boolean;
    /** Add, rename, reorder and remove phases: Admin any time, PM in Planning only. */
    editPhaseNames: boolean;
  };
}
