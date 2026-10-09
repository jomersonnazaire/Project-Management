import { z } from 'zod';
import { JOB_ROLES } from './roles.js';

/**
 * Milestone 2: implementation templates, projects and tasks (doc 03 TPL/PRJ/TSK, doc 11 FR-PRJ-11..13).
 * Enums, request schemas and the pure calculations shared by the API and the web app.
 */

// ---------- Decisions that are easy to change (doc 09) ----------
/**
 * Q-12 (resolved 2026-10-09): PMs view all projects but edit and archive only the projects they
 * manage. Set to 'ALL' to let any PM edit any project. Members are always limited to their
 * projects and only Admins delete projects (FR-ACL-07, Q-26), whatever this says.
 */
export const PM_PROJECT_EDIT_SCOPE: 'OWN' | 'ALL' = 'OWN';
/**
 * Q-11 (resolved 2026-10-09): PMs can publish templates. Publishing follows Edit on `templates`
 * in the access rules grid, so an Admin can take it away from PMs by unticking that cell.
 */
export const TEMPLATE_PUBLISH_PERMISSION = { record: 'templates', action: 'edit' } as const;

// ---------- Templates ----------
export const TEMPLATE_TYPES = ['SAP_B1', 'SOFTWARE_API', 'CLOUD', 'GENERAL_IT', 'OTHER'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];
export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  SAP_B1: 'SAP Business One',
  SOFTWARE_API: 'Software / API integration',
  CLOUD: 'Cloud deployment / migration',
  GENERAL_IT: 'General IT consulting',
  OTHER: 'Other',
};

export const TEMPLATE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export const PARTIES = ['INTERNAL', 'CLIENT'] as const;
export type Party = (typeof PARTIES)[number];
export const PARTY_LABELS: Record<Party, string> = { INTERNAL: 'Internal', CLIENT: 'Client' };

// ---------- Projects ----------
/** FR-PRJ-05. */
export const PROJECT_STATUSES = [
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** FR-PRJ-10. */
export const HEALTH_VALUES = ['ON_TRACK', 'AT_RISK', 'DELAYED', 'ON_HOLD'] as const;
export type Health = (typeof HEALTH_VALUES)[number];
export const HEALTH_LABELS: Record<Health, string> = {
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  DELAYED: 'Delayed',
  ON_HOLD: 'On hold',
};

/**
 * Filters on project lists (Clients › Projects and the Projects page): a status, a health value
 * for running projects (Delayed / At risk, as in the mockup), or Archived.
 */
export const PROJECT_FILTERS = [
  'PLANNING',
  'ACTIVE',
  'DELAYED',
  'AT_RISK',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
] as const;
export type ProjectFilter = (typeof PROJECT_FILTERS)[number];
export const PROJECT_FILTER_LABELS: Record<ProjectFilter, string> = {
  ...PROJECT_STATUS_LABELS,
  DELAYED: 'Delayed',
  AT_RISK: 'At risk',
  ARCHIVED: 'Archived',
};

/** The badge on project rows: running projects show their health when it isn't On track. */
export function projectBadge(p: {
  status: ProjectStatus;
  health?: Health | null;
  archived?: boolean;
}): { label: string; variant: string } {
  if (p.archived) return { label: 'Archived', variant: 'secondary' };
  if (p.status === 'ACTIVE' && p.health === 'DELAYED')
    return { label: 'Delayed', variant: 'danger' };
  if (p.status === 'ACTIVE' && p.health === 'AT_RISK')
    return { label: 'At risk', variant: 'warning' };
  const variant: Record<ProjectStatus, string> = {
    PLANNING: 'info',
    ACTIVE: 'success',
    ON_HOLD: 'secondary',
    COMPLETED: 'primary',
    CANCELLED: 'dark',
  };
  return {
    label: PROJECT_STATUS_LABELS[p.status] ?? p.status,
    variant: variant[p.status] ?? 'secondary',
  };
}

// ---------- Tasks ----------
/** FR-TSK-02; the board shows the first five as columns (FR-TSK-10). */
export const TASK_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'FOR_REVIEW',
  'COMPLETED',
  'CANCELLED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const BOARD_COLUMNS = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'FOR_REVIEW', 'COMPLETED'] as const;
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  FOR_REVIEW: 'For Review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
export const TASK_STATUS_VARIANTS: Record<TaskStatus, string> = {
  TODO: 'secondary',
  IN_PROGRESS: 'info',
  BLOCKED: 'danger',
  FOR_REVIEW: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'dark',
};

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'FOR_REVIEW',
];

/**
 * Status moves a user can ask for directly (workflow §2). Blocked → previous goes through
 * "unblock"; For Review → Completed / In Progress goes through approve / reject.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'COMPLETED', 'CANCELLED'],
  BLOCKED: [],
  FOR_REVIEW: [],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: [],
};

// ---------- Dates (calendar dates as YYYY-MM-DD, never shifted by timezones; 07 §2) ----------
const DAY = 86_400_000;

export function toDateOnly(d: Date | string): string {
  return (typeof d === 'string' ? new Date(d) : d).toISOString().slice(0, 10);
}

export function parseDateOnly(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

export function isWorkingDay(d: Date): boolean {
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6;
}

/** Mon–Fri working days (Q-07 default; holidays arrive with settings). A weekend start rolls to Monday. */
export function addWorkingDays(start: Date, n: number): Date {
  let d = new Date(start.getTime());
  while (!isWorkingDay(d)) d = addDays(d, 1);
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWorkingDay(d)) left -= 1;
  }
  return d;
}

/** FR-PRJ-03: planned start = baseline start + offset; due = start + (duration − 1), working days. */
export function scheduleFromOffsets(
  baselineStart: Date,
  offsetDays: number,
  durationDays: number,
): { plannedStart: Date; dueDate: Date } {
  const plannedStart = addWorkingDays(baselineStart, offsetDays);
  const dueDate = addWorkingDays(plannedStart, Math.max(durationDays, 1) - 1);
  return { plannedStart, dueDate };
}

export function todayUtc(now = new Date()): Date {
  return parseDateOnly(now.toISOString());
}

// ---------- Calculations (NFR-22) ----------
export interface CalcTask {
  status: TaskStatus;
  mandatory?: boolean;
  plannedStart?: Date | null;
  dueDate?: Date | null;
}

/** FR-TSK-09. */
export function isOverdue(t: CalcTask, today: Date): boolean {
  return (
    Boolean(t.dueDate) && t.dueDate! < today && t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
  );
}

/** FR-PRJ-08 / AC-11.1: completed ÷ (total − cancelled), whole %; 0 when nothing counts (EC-03). */
export function progressPct(tasks: CalcTask[]): number {
  const counted = tasks.filter((t) => t.status !== 'CANCELLED');
  if (!counted.length) return 0;
  return Math.round(
    (counted.filter((t) => t.status === 'COMPLETED').length / counted.length) * 100,
  );
}

/**
 * FR-PRJ-09: latest of each incomplete task's due date, or today + its remaining duration when it
 * is overdue. With no incomplete dated tasks the forecast is the baseline end (EC-03).
 */
export function forecastEnd(tasks: CalcTask[], baselineEnd: Date, today: Date): Date {
  let latest: Date | null = null;
  for (const t of tasks) {
    if (t.status === 'COMPLETED' || t.status === 'CANCELLED' || !t.dueDate) continue;
    let end = t.dueDate;
    if (end < today) {
      const duration = t.plannedStart ? Math.max(daysBetween(t.plannedStart, t.dueDate), 0) : 0;
      end = addDays(today, duration);
    }
    if (!latest || end > latest) latest = end;
  }
  return latest ?? baselineEnd;
}

export interface HealthThresholds {
  /** Variance above this many days is Delayed (FR-PRJ-10, A-09). */
  delayedDays: number;
}
export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = { delayedDays: 5 };

/** FR-PRJ-10 / AC-11.3, evaluated in order: On hold, Delayed, At risk, On track. */
export function projectHealth(
  status: ProjectStatus,
  varianceDays: number,
  tasks: CalcTask[],
  today: Date,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): Health {
  if (status === 'ON_HOLD') return 'ON_HOLD';
  const overdue = tasks.filter((t) => isOverdue(t, today));
  if (varianceDays > thresholds.delayedDays) return 'DELAYED';
  if (overdue.some((t) => t.mandatory && t.status === 'BLOCKED')) return 'DELAYED';
  if (varianceDays >= 1 || overdue.length > 0) return 'AT_RISK';
  return 'ON_TRACK';
}

export interface ProjectComputed {
  progressPct: number;
  forecastEnd: Date;
  scheduleVarianceDays: number;
  health: Health;
}

export function computeProject(
  status: ProjectStatus,
  baselineEnd: Date,
  tasks: CalcTask[],
  today: Date,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): ProjectComputed {
  const forecast = forecastEnd(tasks, baselineEnd, today);
  const variance = daysBetween(baselineEnd, forecast);
  return {
    progressPct: progressPct(tasks),
    forecastEnd: forecast,
    scheduleVarianceDays: variance,
    health: projectHealth(status, variance, tasks, today, thresholds),
  };
}

/** "+N days", "0 days", "−N days" (AC-11.2). */
export function formatVariance(days: number): string {
  if (days === 0) return '0 days';
  const n = Math.abs(days);
  return `${days > 0 ? '+' : '−'}${n} day${n === 1 ? '' : 's'}`;
}

// ---------- Effort (EC-58: a missing estimate is null, never 0) ----------
export const NO_ESTIMATE_LABEL = 'No estimate';

export function hasEstimate<T extends { estHours?: number | null }>(
  t: T,
): t is T & { estHours: number } {
  return typeof t.estHours === 'number';
}

/** "–" for tasks without an estimate (EC-58), otherwise the hours. */
export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '–';
  return Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0$/, '');
}

/**
 * Effort variance (FR-RPT-01) = actual − estimate. Tasks without an estimate have no variance and
 * are never flagged over budget (EC-58); overrun % needs an estimate above 0 (EC-01/02).
 */
export function effortVariance(t: { estHours?: number | null; actualHours?: number | null }): {
  variance: number | null;
  overrunPct: number | null;
  overBudget: boolean;
} {
  if (!hasEstimate(t)) return { variance: null, overrunPct: null, overBudget: false };
  const actual = t.actualHours ?? 0;
  const variance = actual - t.estHours;
  return {
    variance,
    overrunPct: t.estHours > 0 ? (variance / t.estHours) * 100 : null,
    overBudget: variance > 0,
  };
}

/** Totals for summaries: estimated hours over tasks that have one, and how many have none (EC-58). */
export function effortSummary(tasks: { estHours?: number | null; actualHours?: number | null }[]) {
  const estimated = tasks.filter(hasEstimate);
  return {
    estimatedHours: estimated.reduce((n, t) => n + t.estHours, 0),
    actualHours: tasks.reduce((n, t) => n + (t.actualHours ?? 0), 0),
    unestimatedCount: tasks.length - estimated.length,
    overBudgetCount: tasks.filter((t) => effortVariance(t).overBudget).length,
  };
}

/**
 * Finds a dependency cycle (FR-TPL-07, AC-07.2, EC-15). Returns the ids in the cycle in order
 * (first id repeated at the end, e.g. [A, B, A]) or null when there is none.
 */
export function findCycle(nodes: { id: string; dependsOn: readonly string[] }[]): string[] | null {
  const deps = new Map(nodes.map((n) => [n.id, n.dependsOn]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      if (state.get(d) === 1) return [...stack.slice(stack.indexOf(d)), d];
      if (!state.has(d)) {
        const found = visit(d);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const n of nodes) {
    if (!state.has(n.id)) {
      const found = visit(n.id);
      if (found) return found;
    }
  }
  return null;
}

// ---------- Request schemas (strict: unknown fields are rejected, NFR-04) ----------
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.');
const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required.`).max(max);
// Optional text also accepts null, which the web sends to clear a field and the DTOs return.
const optionalText = (max = 2000) => z.string().trim().max(max).nullable().optional();
const localId = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid id.');
export const dateOnlySchema = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required.`)
    .refine((s) => !Number.isNaN(parseDateOnly(s).getTime()), `${label} is not a valid date.`);
export const END_AFTER_START = 'End date must be after the start date.';
export const DUE_NOT_BEFORE_START = "Due date can't be before the start date.";

export const templatePhaseSchema = z.strictObject({
  id: localId,
  name: requiredText('Phase name', 120),
});

export const templateActivitySchema = z.strictObject({
  id: localId,
  phaseId: localId,
  name: requiredText('Activity name', 200),
  taskType: optionalText(60),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
  mandatory: z.boolean().default(true),
  party: z.enum(PARTIES).default('INTERNAL'),
  defaultJobRole: z.enum(JOB_ROLES).nullable().optional(),
  defaultTeamId: objectId.nullable().optional(),
  /** null = no estimate (EC-58), never stored as 0. */
  estHours: z.number().min(0).max(10_000).nullable().default(null),
  offsetDays: z.number().int().min(0).max(3650).default(0),
  durationDays: z.number().int().min(0).max(3650).default(1),
  deliverable: optionalText(500),
  requiresApproval: z.boolean().default(false),
  isMilestone: z.boolean().default(false),
  dependsOn: z.array(localId).max(50).default([]),
});
export type TemplateActivityInput = z.input<typeof templateActivitySchema>;

export const templateSchema = z.strictObject({
  name: requiredText('Template name', 160),
  type: z.enum(TEMPLATE_TYPES, 'Choose a template type.'),
  description: optionalText(2000),
  phases: z.array(templatePhaseSchema).max(50).default([]),
  activities: z.array(templateActivitySchema).max(500).default([]),
});
export type TemplateInput = z.input<typeof templateSchema>;
// Built without defaults so a partial update never resets phases or activities.
export const updateTemplateSchema = z
  .strictObject({
    name: requiredText('Template name', 160).optional(),
    type: z.enum(TEMPLATE_TYPES, 'Choose a template type.').optional(),
    description: optionalText(2000),
    phases: z.array(templatePhaseSchema).max(50).optional(),
    activities: z.array(templateActivitySchema).max(500).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update.');

export const createProjectSchema = z
  .strictObject({
    name: requiredText('Project name', 160),
    clientId: objectId,
    managerId: objectId,
    type: z.enum(TEMPLATE_TYPES).optional(),
    startDate: dateOnlySchema('Baseline start'),
    plannedEndDate: dateOnlySchema('Baseline end'),
    description: optionalText(4000),
    templateId: objectId,
    /** The template version shown in the preview (EC-11): a newer version answers 409. */
    templateVersion: z.number().int().min(1).optional(),
    memberIds: z.array(objectId).max(200).default([]),
  })
  .refine((v) => v.plannedEndDate > v.startDate, {
    path: ['plannedEndDate'],
    message: END_AFTER_START,
  });
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z
  .strictObject({
    name: requiredText('Project name', 160).optional(),
    description: optionalText(4000),
    type: z.enum(TEMPLATE_TYPES).nullable().optional(),
    managerId: objectId.optional(),
    memberIds: z.array(objectId).max(200).optional(),
    clientId: objectId.optional(),
    startDate: dateOnlySchema('Baseline start').optional(),
    plannedEndDate: dateOnlySchema('Baseline end').optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    /** Required when baseline dates change (FR-PRJ-12). */
    reason: optionalText(500),
    /** Confirms that changing the client clears the active contacts (FR-PRJ-13). */
    confirmClearContacts: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectContactSchema = z.strictObject({ contactId: objectId });

export const projectListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(100).optional(),
  status: z.string().max(20).optional(),
  clientId: objectId.optional(),
  mine: z.enum(['true', 'false']).optional(),
});

const taskFields = {
  name: requiredText('Task name', 200),
  phase: optionalText(120),
  taskType: optionalText(60),
  priority: z.enum(PRIORITIES),
  mandatory: z.boolean(),
  party: z.enum(PARTIES),
  teamId: objectId.nullable(),
  ownerId: objectId.nullable(),
  assigneeIds: z.array(objectId).max(50),
  clientContactId: objectId.nullable(),
  plannedStart: dateOnlySchema('Planned start').nullable(),
  dueDate: dateOnlySchema('Due date').nullable(),
  /** null = no estimate (EC-58). */
  estHours: z.number().min(0).max(10_000).nullable(),
  dependsOn: z.array(objectId).max(50),
  deliverable: optionalText(500),
  requiresApproval: z.boolean(),
  reviewerId: objectId.nullable(),
  isMilestone: z.boolean(),
};

const datesInOrder = (v: { plannedStart?: string | null; dueDate?: string | null }) =>
  !v.plannedStart || !v.dueDate || v.dueDate >= v.plannedStart;

export const createTaskSchema = z
  .strictObject({
    ...taskFields,
    priority: taskFields.priority.default('MEDIUM'),
    mandatory: taskFields.mandatory.default(false),
    party: taskFields.party.default('INTERNAL'),
    teamId: taskFields.teamId.optional(),
    ownerId: taskFields.ownerId.optional(),
    assigneeIds: taskFields.assigneeIds.default([]),
    clientContactId: taskFields.clientContactId.optional(),
    plannedStart: taskFields.plannedStart.optional(),
    dueDate: taskFields.dueDate.optional(),
    estHours: taskFields.estHours.default(null),
    dependsOn: taskFields.dependsOn.default([]),
    requiresApproval: taskFields.requiresApproval.default(false),
    reviewerId: taskFields.reviewerId.optional(),
    isMilestone: taskFields.isMilestone.default(false),
  })
  .refine(datesInOrder, { path: ['dueDate'], message: DUE_NOT_BEFORE_START });
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z
  .strictObject({
    ...Object.fromEntries(Object.entries(taskFields).map(([k, s]) => [k, s.optional()])),
    version: z.number().int().min(0),
  } as { [K in keyof typeof taskFields]: z.ZodOptional<(typeof taskFields)[K]> } & {
    version: z.ZodNumber;
  })
  .refine(datesInOrder, { path: ['dueDate'], message: DUE_NOT_BEFORE_START });
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

/** Fields only the project's planners (Admin, the managing PM) may change (FR-TSK-14, AC-10.4). */
export const TASK_PLAN_FIELDS = Object.keys(taskFields) as (keyof typeof taskFields)[];

export const taskStatusSchema = z.strictObject({
  status: z.enum(TASK_STATUSES),
  version: z.number().int().min(0),
  /** Blocker reason (FR-TSK-03), cancel or reopen reason (FR-TSK-06, workflow §2). */
  reason: optionalText(1000),
  /** PM override of unfinished predecessors (FR-TSK-04). */
  overrideReason: optionalText(1000),
});
export type TaskStatusInput = z.input<typeof taskStatusSchema>;

export const taskVersionSchema = z.strictObject({ version: z.number().int().min(0) });
export const approveTaskSchema = z.strictObject({
  version: z.number().int().min(0),
  comment: optionalText(1000),
});
export const rejectTaskSchema = z.strictObject({
  version: z.number().int().min(0),
  comment: requiredText('Comment', 1000),
});
export const evidenceLinkSchema = z.strictObject({
  name: requiredText('Name', 200),
  url: z
    .string()
    .trim()
    .max(2000)
    .pipe(
      z.url({ protocol: /^https?$/, error: 'Enter a link starting with http:// or https://.' }),
    ),
});
export const followUpSchema = z.strictObject({
  note: requiredText('Note', 2000),
  contactId: objectId.nullable().optional(),
});

export const myTasksQuerySchema = z.strictObject({
  view: z.enum(['assigned', 'accountable', 'review', 'completed']).optional(),
  q: z.string().trim().max(100).optional(),
});

// ---------- Response shapes ----------
export interface Ref {
  id: string;
  name: string;
}

export interface TemplatePhaseDto {
  id: string;
  name: string;
}

export interface TemplateActivityDto {
  id: string;
  phaseId: string;
  name: string;
  taskType: string | null;
  priority: Priority;
  mandatory: boolean;
  party: Party;
  defaultJobRole: (typeof JOB_ROLES)[number] | null;
  defaultTeamId: string | null;
  estHours: number | null;
  offsetDays: number;
  durationDays: number;
  deliverable: string | null;
  requiresApproval: boolean;
  isMilestone: boolean;
  dependsOn: string[];
}

export interface TemplateSummaryDto {
  id: string;
  templateKey: string;
  name: string;
  type: TemplateType;
  description: string | null;
  status: TemplateStatus;
  version: number;
  /** True for older published versions kept read-only (FR-TPL-04). */
  superseded: boolean;
  phaseCount: number;
  activityCount: number;
  dependencyCount: number;
  deliverableCount: number;
  /** Projects created from any version of this template that the caller can see (FR-TPL-06). */
  projectCount: number;
  publishedAt: string | null;
  updatedAt: string;
  /** Id of an open draft of the next version, if any. */
  draftId: string | null;
}

export interface TemplateDto extends TemplateSummaryDto {
  phases: TemplatePhaseDto[];
  activities: TemplateActivityDto[];
  versions: {
    id: string;
    version: number;
    status: TemplateStatus;
    superseded: boolean;
    publishedAt: string | null;
  }[];
}

export interface UserRefDto extends Ref {
  active: boolean;
  email?: string;
}

export interface ProjectListItemDto {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  managerId: string | null;
  managerName: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  forecastEnd: string | null;
  scheduleVarianceDays: number;
  progress: number;
  status: ProjectStatus;
  health: Health;
  archived: boolean;
  templateName: string | null;
  templateVersion: number | null;
  taskCount: number;
  /** Tasks without an estimate (EC-58). */
  unestimatedTaskCount: number;
}

export interface ActiveContactDto {
  id: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
}

export interface ProjectDto extends ProjectListItemDto {
  description: string | null;
  type: TemplateType | null;
  manager: UserRefDto | null;
  members: UserRefDto[];
  activeContacts: ActiveContactDto[];
  templateId: string | null;
  baselineHistory: {
    startDate: string | null;
    plannedEndDate: string | null;
    reason: string;
    changedAt: string;
    changedBy: string | null;
  }[];
  /** What the caller may do on this project; the API checks the same rules on every request. */
  can: { edit: boolean; archive: boolean; delete: boolean; planTasks: boolean };
}

export interface EvidenceDto {
  id: string;
  type: 'LINK';
  name: string;
  url: string;
  addedBy: Ref | null;
  at: string;
}

export interface FollowUpDto {
  id: string;
  note: string;
  author: Ref | null;
  contact: Ref | null;
  at: string;
}

export interface TaskDto {
  id: string;
  projectId: string;
  order: number;
  name: string;
  phase: string | null;
  taskType: string | null;
  priority: Priority;
  mandatory: boolean;
  party: Party;
  teamId: string | null;
  owner: UserRefDto | null;
  assignees: UserRefDto[];
  clientContact: (Ref & { active: boolean }) | null;
  plannedStart: string | null;
  dueDate: string | null;
  /** null = no estimate (EC-58). */
  estHours: number | null;
  actualHours: number;
  status: TaskStatus;
  previousStatus: TaskStatus | null;
  dependsOn: string[];
  deliverable: string | null;
  blockerReason: string | null;
  requiresApproval: boolean;
  reviewer: UserRefDto | null;
  approval: {
    state: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
    decidedBy: Ref | null;
    decidedAt: string | null;
    comment: string | null;
  };
  evidence: EvidenceDto[];
  followUps: FollowUpDto[];
  isMilestone: boolean;
  overdue: boolean;
  daysLate: number;
  version: number;
  /** What the caller may do on this task. */
  can: { edit: boolean; plan: boolean; status: boolean; approve: boolean };
}

export interface TaskHistoryDto {
  id: string;
  at: string;
  actor: Ref | null;
  action: string;
  changes: { field: string; old: unknown; new: unknown }[];
  reason: string | null;
}

export interface MyTaskDto {
  id: string;
  name: string;
  project: Ref;
  role: 'ACCOUNTABLE' | 'ASSIGNEE' | 'REVIEWER';
  dueDate: string | null;
  overdue: boolean;
  daysLate: number;
  estHours: number | null;
  actualHours: number;
  status: TaskStatus;
  party: Party;
}

export interface MyTasksDto {
  items: MyTaskDto[];
  counts: {
    overdue: number;
    dueThisWeek: number;
    toReview: number;
    assigned: number;
    accountable: number;
  };
}

/** GET /people: the people picker (names and roles only). */
export interface PersonDto {
  id: string;
  name: string;
  systemRole: string;
  jobRole: string;
}
