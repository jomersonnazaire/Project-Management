import { z } from 'zod';
import type { Ref, UserRefDto } from './projects.js';

/**
 * Milestone 3.5: project issue tracking (doc 13 v0.6.0). Shared by the API and the web app.
 * Issues reuse M3's upload rules (PDF, Word, Excel; 25 MB), in-app notifications and permanent
 * comments.
 */

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.');
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid due date.')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Enter a valid due date.');

// ---------- Severity (§4, Q-32) ----------
export const ISSUE_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];
export const ISSUE_SEVERITY_LABELS: Record<IssueSeverity, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};
export const ISSUE_SEVERITY_HINTS: Record<IssueSeverity, string> = {
  CRITICAL: 'System down or blocks go-live / business operations, no workaround',
  HIGH: 'Major function broken, workaround is painful',
  MEDIUM: 'Function affected, workaround exists',
  LOW: 'Cosmetic, question, minor',
};
/** Default due date in working days from the day the issue is raised (Q-07 calendar). */
export const ISSUE_SEVERITY_DUE_DAYS: Record<IssueSeverity, number> = {
  CRITICAL: 1,
  HIGH: 3,
  MEDIUM: 7,
  LOW: 15,
};

// ---------- Status workflow (§5) ----------
export const ISSUE_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CLIENT',
  'RESOLVED',
  'CLOSED',
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_CLIENT: 'Waiting on client',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
/** Not Resolved or Closed: counts as open, can be overdue. */
export const OPEN_ISSUE_STATUSES: readonly IssueStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CLIENT',
];
export const isIssueOpen = (s: IssueStatus) => OPEN_ISSUE_STATUSES.includes(s);

export const ISSUE_TRANSITIONS: Record<IssueStatus, readonly IssueStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['WAITING_ON_CLIENT', 'RESOLVED'],
  WAITING_ON_CLIENT: ['IN_PROGRESS'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: ['IN_PROGRESS'],
};

export interface TransitionRule {
  allowed: boolean;
  /** Resolved needs the resolution text. */
  resolution: boolean;
  /** Close-as-duplicate and reopen need a reason. */
  reason: boolean;
  /** Only the project's PM or an Admin (reopen a Closed issue). */
  plannerOnly: boolean;
  /** Only the PM, an Admin or the reporter (confirm a resolution). */
  confirmer: boolean;
  /** In progress needs an owner. */
  owner: boolean;
}

export function issueTransition(from: IssueStatus, to: IssueStatus): TransitionRule {
  const allowed = ISSUE_TRANSITIONS[from].includes(to);
  return {
    allowed,
    resolution: allowed && to === 'RESOLVED',
    reason:
      allowed &&
      ((from === 'OPEN' && to === 'CLOSED') ||
        ((from === 'RESOLVED' || from === 'CLOSED') && to === 'IN_PROGRESS')),
    plannerOnly: allowed && from === 'CLOSED',
    confirmer: allowed && from === 'RESOLVED' && to === 'CLOSED',
    owner: allowed && to === 'IN_PROGRESS',
  };
}

/** Labels for the status buttons on the issue page. */
export function transitionLabel(from: IssueStatus, to: IssueStatus): string {
  if (to === 'IN_PROGRESS')
    return from === 'OPEN' ? 'Start' : from === 'WAITING_ON_CLIENT' ? 'Client responded' : 'Reopen';
  if (to === 'WAITING_ON_CLIENT') return 'Waiting on client';
  if (to === 'RESOLVED') return 'Mark resolved';
  return from === 'OPEN' ? 'Close as duplicate / not an issue' : 'Close';
}

/** FR-ISS-06 (Q-33): Resolved issues close automatically after 7 days with no reopen. */
export const ISSUE_AUTO_CLOSE_DAYS = 7;

// ---------- Stage and category (§3) ----------
export const ISSUE_STAGES = ['BEFORE_GO_LIVE', 'AFTER_GO_LIVE'] as const;
export type IssueStage = (typeof ISSUE_STAGES)[number];
export const ISSUE_STAGE_LABELS: Record<IssueStage, string> = {
  BEFORE_GO_LIVE: 'Before go-live',
  AFTER_GO_LIVE: 'After go-live',
};
export const ISSUE_CATEGORIES = [
  'BUG',
  'CONFIGURATION',
  'DATA',
  'TRAINING',
  'CHANGE_REQUEST',
  'OTHER',
] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];
export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  BUG: 'Bug',
  CONFIGURATION: 'Configuration',
  DATA: 'Data',
  TRAINING: 'Training',
  CHANGE_REQUEST: 'Change request',
  OTHER: 'Other',
};

export const MAX_ISSUE_TITLE = 150;
export const MAX_ISSUE_DESCRIPTION = 10_000;
export const MAX_ISSUE_COMMENT = 5000;
export const MAX_ISSUE_LINKS = 20;

export const ISSUE_COMPLETED_BANNER = 'This project is completed. Issues stay open for support.';
export const ISSUE_ARCHIVED_NOTE = 'This project is archived, so its issues are read-only.';
export const ISSUE_OWNER_NEEDED = 'Owner needed';

/** "ACME-SAP-ISS-012": project prefix + running number, never reused. */
export function issueKey(prefix: string, number: number): string {
  return `${prefix}-ISS-${String(number).padStart(3, '0')}`;
}

/** Project prefix from the client name and project type, e.g. "Acme Trading" + SAP_B1 → "ACME-SAP". */
export function issuePrefix(clientName: string, projectType?: string | null): string {
  const word =
    clientName
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .find((w) => w.length > 0) ?? 'PRJ';
  const type =
    (projectType ?? '')
      .toUpperCase()
      .split('_')[0]
      ?.replace(/[^A-Z0-9]/g, '') || 'PRJ';
  return `${word.slice(0, 6)}-${type.slice(0, 4)}`;
}

/** Overdue = due date passed (Philippine calendar date) and not Resolved/Closed (FR-ISS-05). */
export function isIssueOverdue(
  dueDate: string | null,
  status: IssueStatus,
  today: string,
): boolean {
  return Boolean(dueDate) && isIssueOpen(status) && dueDate! < today;
}

// ---------- Request bodies ----------
const severity = z.enum(ISSUE_SEVERITIES, { error: 'Choose a severity.' });
const stage = z.enum(ISSUE_STAGES, { error: 'Choose a stage.' });
const category = z.enum(ISSUE_CATEGORIES, { error: 'Choose a category.' });
const title = z
  .string({ error: 'Title is required.' })
  .trim()
  .min(1, 'Title is required.')
  .max(MAX_ISSUE_TITLE, `Title can be up to ${MAX_ISSUE_TITLE} characters.`);
const description = z
  .string({ error: 'Description is required.' })
  .trim()
  .min(1, 'Description is required.')
  .max(MAX_ISSUE_DESCRIPTION, 'Description can be up to 10,000 characters.');
const links = z.array(objectId).max(MAX_ISSUE_LINKS, `Up to ${MAX_ISSUE_LINKS} links.`);

export const createIssueSchema = z.strictObject({
  title,
  description,
  severity,
  stage,
  category: category.default('OTHER'),
  ownerId: objectId.nullable().optional(),
  reportedByContactId: objectId.nullable().optional(),
  /** Leave empty to use the severity default (§4). */
  dueDate: dateOnly.nullable().optional(),
  taskIds: links.default([]),
  messageIds: links.default([]),
});
export type CreateIssueInput = z.input<typeof createIssueSchema>;

export const updateIssueSchema = z.strictObject({
  version: z.number().int().min(0),
  title: title.optional(),
  description: description.optional(),
  severity: severity.optional(),
  stage: stage.optional(),
  category: category.optional(),
  ownerId: objectId.nullable().optional(),
  reportedByContactId: objectId.nullable().optional(),
  /** A date sets it by hand (needs dueReason); null goes back to the severity default. */
  dueDate: dateOnly.nullable().optional(),
  dueReason: z.string().trim().max(500).optional(),
  taskIds: links.optional(),
  messageIds: links.optional(),
});
export type UpdateIssueInput = z.input<typeof updateIssueSchema>;

export const issueStatusSchema = z.strictObject({
  version: z.number().int().min(0),
  status: z.enum(ISSUE_STATUSES, { error: 'Choose a status.' }),
  resolution: z.string().trim().max(2000).optional(),
  reason: z.string().trim().max(500).optional(),
});
export type IssueStatusInput = z.input<typeof issueStatusSchema>;

export const issueCommentSchema = z.strictObject({
  text: z
    .string({ error: 'Comment is required.' })
    .trim()
    .min(1, 'Comment is required.')
    .max(MAX_ISSUE_COMMENT, 'Comment can be up to 5,000 characters.'),
});

export const issueAttachmentUploadSchema = z.strictObject({
  files: z
    .array(
      z.strictObject({
        name: z.string().trim().min(1).max(200),
        size: z.number().int().min(0),
        contentType: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(10, 'Up to 10 files per upload.'),
});

/** "OPEN_ALL" = Open, In progress and Waiting on client (the default list). */
export const ISSUE_STATUS_FILTERS = ['OPEN_ALL', 'ALL', ...ISSUE_STATUSES] as const;
export const issueListQuerySchema = z.strictObject({
  status: z.enum(ISSUE_STATUS_FILTERS).optional(),
  severity: z.enum(ISSUE_SEVERITIES).optional(),
  stage: z.enum(ISSUE_STAGES).optional(),
  category: z.enum(ISSUE_CATEGORIES).optional(),
  ownerId: z.union([objectId, z.literal('none')]).optional(),
  projectId: objectId.optional(),
  clientId: objectId.optional(),
  /** Issues linked to this task (task panel, FR-ISS-09). */
  taskId: objectId.optional(),
  q: z.string().trim().max(100).optional(),
});
export type IssueListQuery = z.infer<typeof issueListQuerySchema>;

// ---------- Responses ----------
export interface IssueRowDto {
  id: string;
  key: string;
  title: string;
  project: Ref;
  client: Ref | null;
  stage: IssueStage;
  category: IssueCategory;
  severity: IssueSeverity;
  status: IssueStatus;
  owner: UserRefDto | null;
  /** EC-66: no owner on an open issue, or the owner was deactivated / left the project. */
  ownerNeeded: boolean;
  contact: (Ref & { active: boolean }) | null;
  dueDate: string | null;
  overdue: boolean;
  updatedAt: string;
}

export interface IssueAttachmentDto {
  documentId: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedBy: Ref | null;
  at: string;
}

export interface IssueActivityDto {
  id: string;
  kind: 'COMMENT' | 'EVENT';
  actor: Ref | null;
  at: string;
  text: string | null;
  action: string | null;
  changes: { field: string; old: unknown; new: unknown }[];
  reason: string | null;
}

export interface IssueDto extends IssueRowDto {
  description: string;
  reportedBy: UserRefDto | null;
  dueManual: boolean;
  resolution: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  closedBy: Ref | null;
  closedReason: string | null;
  createdAt: string;
  version: number;
  projectStatus: string;
  projectArchived: boolean;
  links: {
    tasks: { id: string; name: string | null; status: string | null }[];
    messages: { id: string; excerpt: string | null; type: string | null; at: string | null }[];
  };
  attachments: IssueAttachmentDto[];
  can: {
    edit: boolean;
    comment: boolean;
    attach: boolean;
    delete: boolean;
    /** Statuses this user may move the issue to now. */
    transitions: IssueStatus[];
  };
}

export interface IssueListDto {
  items: IssueRowDto[];
  counts: { open: number; critical: number; high: number; overdue: number; waiting: number };
  can: { create: boolean };
}

export interface IssueOptionsDto {
  /** Internal users on the project (owner picker). */
  users: UserRefDto[];
  /** Active contacts of the project's client (reported-by picker). */
  contacts: (Ref & { active: boolean })[];
  tasks: { id: string; name: string; phase: string | null }[];
  messages: { id: string; excerpt: string; type: string; at: string }[];
  defaultStage: IssueStage;
  /** Default due date per severity for an issue raised today (YYYY-MM-DD). */
  defaultDue: Record<IssueSeverity, string>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 9", "Oct 9 · overdue" (mockup v0.7). */
export function issueDueLabel(dueDate: string | null, overdue: boolean): string {
  if (!dueDate) return '—';
  const d = new Date(`${dueDate}T00:00:00Z`);
  const label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return overdue ? `${label} · overdue` : label;
}
