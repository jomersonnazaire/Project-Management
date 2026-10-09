import { z } from 'zod';
import { HOLIDAY_TYPES, type HolidayType, type Ref, type UserRefDto } from './projects.js';

/**
 * Milestone 3 (doc 12, doc 10, FR-TIME): calendar settings, time logging, uploads (evidence and
 * documents), notifications and project conversations. Shared by the API and the web app.
 */

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.');
const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required.`).max(max);
const optionalText = (max = 2000) => z.string().trim().max(max).nullable().optional();
const dateOnly = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Enter a valid ${label}.`)
    .refine(
      (s) =>
        !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
        new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
      `Enter a valid ${label}.`,
    );

// ---------- Calendar (FR-CAL-01..05) ----------
export const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  REGULAR: 'Regular holiday',
  SPECIAL_NON_WORKING: 'Special non-working day',
  SPECIAL_WORKING: 'Special working day',
};
/** Short labels for the list's type badges (mockup v0.7.4). */
export const HOLIDAY_TYPE_SHORT: Record<HolidayType, string> = {
  REGULAR: 'Regular holiday',
  SPECIAL_NON_WORKING: 'Special non-working',
  SPECIAL_WORKING: 'Special working day',
};
export const HOLIDAY_TYPE_VARIANTS: Record<HolidayType, string> = {
  REGULAR: 'danger',
  SPECIAL_NON_WORKING: 'warning',
  SPECIAL_WORKING: 'success',
};
export const isNonWorkingHoliday = (t: HolidayType) => t !== 'SPECIAL_WORKING';

/** Weekday checkboxes in display order (Mon first); values are getUTCDay numbers. */
export const WEEKDAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
] as const;

export const KEEP_ONE_WORKING_DAY = 'Keep at least one working day.';
export const HOLIDAY_BANNER_NOTE =
  'New due dates skip today. Tasks already due today keep their date.';

export const holidaySchema = z.strictObject({
  date: dateOnly('date'),
  name: requiredText('Name', 120),
  type: z.enum(HOLIDAY_TYPES, 'Choose a type.'),
  note: optionalText(300),
});
export type HolidayInput = z.input<typeof holidaySchema>;
export const updateHolidaySchema = holidaySchema.partial();

export const copyHolidaysSchema = z.strictObject({
  fromYear: z.number().int().min(2000).max(2100),
  toYear: z.number().int().min(2000).max(2100),
});

/** Load the official Philippine holidays for a year that has them (PH_OFFICIAL_HOLIDAYS). */
export const officialHolidaysSchema = z.strictObject({
  year: z.number().int().min(2000).max(2100),
});

export const workingDaysSchema = z.strictObject({
  days: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .refine((d) => new Set(d).size === d.length, 'Each day can be ticked once.'),
  version: z.number().int().min(0),
});

export interface HolidayDto {
  id: string;
  date: string;
  name: string;
  type: HolidayType;
  note: string | null;
}

export interface CalendarDto {
  workingDays: number[];
  version: number;
  year: number;
  holidays: HolidayDto[];
}

export interface HolidayImpactDto {
  date: string;
  count: number;
  tasks: { id: string; name: string; project: Ref; dueDate: string }[];
  /** An existing holiday on this date, if any (duplicates are refused). */
  existing: HolidayDto | null;
}

// ---------- Time logging (FR-TIME-01..08) ----------
export const TIME_TYPES = ['EXECUTION', 'WAITING', 'REWORK'] as const;
export type TimeType = (typeof TIME_TYPES)[number];
export const TIME_TYPE_LABELS: Record<TimeType, string> = {
  EXECUTION: 'Execution',
  WAITING: 'Waiting on client / external',
  REWORK: 'Rework',
};
export const TIME_TYPE_SHORT: Record<TimeType, string> = {
  EXECUTION: 'Execution',
  WAITING: 'Waiting',
  REWORK: 'Rework',
};
export const HOURS_MESSAGE = 'Enter between 0.25 and 24.';

const hours = z
  .number(HOURS_MESSAGE)
  .min(0.25, HOURS_MESSAGE)
  .max(24, HOURS_MESSAGE)
  .refine((h) => Number.isInteger(h * 4), 'Use steps of 0.25 hours.');

export const timeEntrySchema = z.strictObject({
  taskId: objectId,
  workDate: dateOnly('work date'),
  hours,
  type: z.enum(TIME_TYPES).default('EXECUTION'),
  notes: optionalText(1000),
  /** Doc 14 FR-ACT-15, FR-DAR-09: required on every entry, Log time included. */
  activityTypeId: objectId,
  moduleId: objectId,
  locationId: objectId.nullable().optional(),
  billable: z.boolean().default(true),
});
export type TimeEntryInput = z.input<typeof timeEntrySchema>;
export const updateTimeEntrySchema = z.strictObject({
  workDate: dateOnly('work date').optional(),
  hours: hours.optional(),
  type: z.enum(TIME_TYPES).optional(),
  notes: optionalText(1000),
  activityTypeId: objectId.optional(),
  moduleId: objectId.optional(),
  locationId: objectId.nullable().optional(),
  billable: z.boolean().optional(),
});
export const timeWeekQuerySchema = z.strictObject({ week: dateOnly('week').optional() });

export interface TimeEntryDto {
  id: string;
  user: Ref;
  project: Ref;
  task: Ref;
  workDate: string;
  hours: number;
  /** Exact minutes (timed entries) or hours × 60. */
  minutes: number;
  /** Logged with Time in / Time out (doc 14 FR-ACT-02); hours change on the Day timesheet. */
  timed: boolean;
  activityType: Ref | null;
  module: Ref | null;
  billable: boolean;
  type: TimeType;
  notes: string | null;
  locked: boolean;
  createdAt: string;
}

export interface TimeWeekDto {
  weekStart: string;
  weekEnd: string;
  items: TimeEntryDto[];
  total: number;
  capacity: number;
  /** Q-09: the Admin-set lock in words, e.g. "Last week's entries lock every Monday at 12:00 PM Philippine time." */
  lockDescription?: string;
}

export interface LoggableTaskDto {
  project: Ref;
  tasks: { id: string; name: string; phase: string | null }[];
}

/** Monday of the ISO week containing `d` (calendar date at UTC midnight). */
export function weekStartOf(d: Date): Date {
  const day = d.getUTCDay();
  return new Date(d.getTime() - ((day + 6) % 7) * 86_400_000);
}

/**
 * Q-09 (built as an Admin setting, v0.7.2): the previous week locks every week at `weekday`
 * (0 = Sunday … 6 = Saturday) and `hour` Philippine time. Default: Monday 12:00 PM. There is no
 * approval step. With `enabled` off nothing locks.
 */
export interface TimeLockPolicy {
  enabled: boolean;
  weekday: number;
  hour: number;
}
export const DEFAULT_TIME_LOCK: TimeLockPolicy = { enabled: true, weekday: 1, hour: 12 };
export const timeLockSchema = z.object({
  enabled: z.boolean(),
  weekday: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  version: z.number().int().min(0),
});
export type TimeLockInput = z.infer<typeof timeLockSchema>;
export interface TimeLockDto {
  policy: TimeLockPolicy;
  version: number;
  /** First work date still open now (YYYY-MM-DD), or null when locking is off. */
  boundary: string | null;
  description: string;
}
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
export function formatHour12(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}
/** "Last week locks every Monday at 12:00 PM Philippine time." */
export function describeTimeLock(p: TimeLockPolicy): string {
  if (!p.enabled) return 'Time entries never lock.';
  return `Last week's entries lock every ${WEEKDAY_NAMES[p.weekday]} at ${formatHour12(p.hour)} Philippine time.`;
}

/**
 * FR-TIME-04 / Q-09: returns the first work date that is still open; anything earlier is read-only
 * (except PM/Admin). Weeks run Monday to Sunday. The previous week locks at this week's lock moment
 * (weekday + hour, Philippine time). With locking off, nothing is locked (the epoch is returned).
 */
export function timeLockBoundary(
  now = new Date(),
  policy: TimeLockPolicy = DEFAULT_TIME_LOCK,
): Date {
  if (!policy.enabled) return new Date(0);
  const ph = new Date(now.getTime() + 8 * 3_600_000);
  const today = new Date(`${ph.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const monday = weekStartOf(today);
  const lockAt =
    monday.getTime() + ((policy.weekday + 6) % 7) * 86_400_000 + policy.hour * 3_600_000;
  return ph.getTime() >= lockAt ? monday : new Date(monday.getTime() - 7 * 86_400_000);
}

// ---------- Uploads (FR-EVD-01..08, FR-DOC-13) ----------
/** 25 MiB (FR-EVD-03, FR-DOC-13). */
export const MAX_UPLOAD_BYTES = 26_214_400;

/**
 * DEF-004: never "report.pdf is 25.0 MB. The limit is 25 MB." for a file just over the limit.
 * Show the real size when it reads as more than 25 MB, otherwise say "larger than 25 MB".
 */
export function tooLargeMessage(name: string, size: number): string {
  const shown = formatBytes(size);
  const mb = Number.parseFloat(shown);
  return shown.endsWith('MB') && mb > 25
    ? `${name} is ${shown}, larger than the 25 MB limit.`
    : `${name} is larger than 25 MB, the limit per file.`;
}
export const MAX_FILES_PER_UPLOAD = 10;
/** Signed download links expire within 5 minutes (FR-DOC-41, FR-EVD-04). */
export const DOWNLOAD_LINK_MINUTES = 5;

export const FILE_KINDS = ['PDF', 'WORD', 'EXCEL', 'IMAGE'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** ISSUE: issue attachments (doc 13 FR-ISS-08), same rules as evidence. */
export const UPLOAD_PURPOSES = ['EVIDENCE', 'DOCUMENT', 'ISSUE'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

const EVIDENCE_EXT: Record<string, FileKind> = {
  pdf: 'PDF',
  doc: 'WORD',
  docx: 'WORD',
  xls: 'EXCEL',
  xlsx: 'EXCEL',
};
/** Q-30 (approved): images stay allowed in Documents; evidence is PDF, Word and Excel only. */
const DOCUMENT_EXT: Record<string, FileKind> = {
  ...EVIDENCE_EXT,
  png: 'IMAGE',
  jpg: 'IMAGE',
  jpeg: 'IMAGE',
};
const MACRO_EXT = new Set(['docm', 'dotm', 'xlsm', 'xltm', 'xlsb', 'xlam']);

export const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export const EVIDENCE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx';
export const DOCUMENT_ACCEPT = `${EVIDENCE_ACCEPT},.png,.jpg,.jpeg`;
export const EVIDENCE_TYPES_LABEL = 'PDF, Word or Excel · up to 25 MB each';
export const DOCUMENT_TYPES_LABEL = 'Up to 25 MB · PDF, DOCX, XLSX, PNG, JPG';

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : '';
}

/** "1.8 MB", "640 KB" (1 MB = 1,048,576 bytes, so 25 MiB shows as 25 MB). */
export function formatBytes(n: number): string {
  if (n >= 1_048_576) {
    const mb = n / 1_048_576;
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export interface FileRuleIssue {
  status: 413 | 422;
  code: 'INVALID_FILE_TYPE' | 'FILE_TOO_LARGE' | 'EMPTY_FILE';
  message: string;
}

/**
 * Name and size checks done before upload, in the browser and again by the API. The API also
 * checks the real type from the file's content after upload (FR-EVD-02).
 */
export function checkFileRules(
  file: { name: string; size: number },
  purpose: UploadPurpose,
): FileRuleIssue | null {
  const ext = fileExtension(file.name);
  const allowed = purpose === 'DOCUMENT' ? DOCUMENT_EXT : EVIDENCE_EXT;
  if (MACRO_EXT.has(ext)) {
    const plain = ext.startsWith('d') ? 'docx' : 'xlsx';
    return {
      status: 422,
      code: 'INVALID_FILE_TYPE',
      message: `${file.name} can't be added. Save it as .${plain} without macros.`,
    };
  }
  if (!allowed[ext]) {
    return {
      status: 422,
      code: 'INVALID_FILE_TYPE',
      message:
        purpose === 'EVIDENCE'
          ? `${file.name} can't be added. Evidence must be a PDF, Word or Excel file.`
          : purpose === 'ISSUE'
            ? `${file.name} can't be added. Attachments must be a PDF, Word or Excel file.`
            : `${file.name} can't be added. That file type isn't allowed.`,
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      status: 413,
      code: 'FILE_TOO_LARGE',
      message: tooLargeMessage(file.name, file.size),
    };
  }
  if (file.size <= 0) {
    return { status: 422, code: 'EMPTY_FILE', message: `${file.name} is empty.` };
  }
  return null;
}

export function fileKindOf(name: string): FileKind | null {
  return DOCUMENT_EXT[fileExtension(name)] ?? null;
}

/** Messages for content checks done after upload (FR-EVD-02, Q-29). */
export const KIND_LABELS: Record<FileKind, string> = {
  PDF: 'PDF',
  WORD: 'Word file',
  EXCEL: 'Excel file',
  IMAGE: 'image',
};
export const notRealTypeMessage = (name: string) => {
  const k = fileKindOf(name);
  return `${name} isn't a real ${k ? KIND_LABELS[k] : 'file of that type'}, so it wasn't uploaded.`;
};
export const malwareMessage = (name: string) =>
  `${name} was blocked by the malware scan and wasn't uploaded.`;

const uploadFile = z.strictObject({
  name: requiredText('File name', 200),
  size: z.number().int().min(0),
  contentType: z.string().trim().max(200).optional(),
});

export const evidenceUploadSchema = z.strictObject({
  files: z.array(uploadFile).min(1).max(MAX_FILES_PER_UPLOAD, 'Up to 10 files per upload.'),
});

/** Status a file is uploaded with (FR-DOC-11, FR-DOC-21). */
export const DOCUMENT_STATUSES = ['SUBMITTED', 'SIGNED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
/**
 * A document's lifecycle (FR-DOC-22/23): Requested → Submitted → Signed, or Requested → Cancelled.
 * Requested and Cancelled documents have no file.
 */
export const DOCUMENT_STATES = ['REQUESTED', 'SUBMITTED', 'SIGNED', 'CANCELLED'] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];
export const DOCUMENT_STATUS_LABELS: Record<DocumentState, string> = {
  REQUESTED: 'Requested',
  SUBMITTED: 'Submitted',
  SIGNED: 'Signed',
  CANCELLED: 'Cancelled',
};
/** Filter tabs on the Documents list (mockup: All · Requested · Submitted · Signed). */
export const DOCUMENT_FILTER_STATES = ['REQUESTED', 'SUBMITTED', 'SIGNED'] as const;

/** Someone a document is requested from or signed by: a user or a client contact (FR-DOC-10/25). */
export const PARTY_KINDS = ['USER', 'CONTACT'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];
export const partyRefSchema = z.strictObject(
  { kind: z.enum(PARTY_KINDS), id: objectId },
  'Choose who the document is requested from.',
);
export interface PartyDto {
  kind: PartyKind;
  id: string;
  name: string;
  /** false for a deactivated contact or user (EC-44 shows "(inactive)"). */
  active: boolean;
  /** Client company name, for contacts. */
  company?: string | null;
}
export const CLIENT_CONTACT_NOTICE =
  'Client contacts can be named on a document but have no access.';
export const REQUEST_CANCELLED_MESSAGE = 'This request was cancelled.';

export const documentUploadSchema = z.strictObject({
  folderId: objectId,
  file: uploadFile,
  status: z.enum(DOCUMENT_STATUSES).default('SUBMITTED'),
  /** FR-DOC-12: a file named like an existing document is added as a new version unless "Keep both". */
  onDuplicate: z.enum(['NEW_VERSION', 'KEEP_BOTH']).default('NEW_VERSION'),
  taskId: objectId.nullable().optional(),
  note: optionalText(500),
  /** FR-DOC-21: a Requested document in this project that the file fulfils. */
  fulfilsDocumentId: objectId.nullable().optional(),
  /** FR-DOC-25: a Signed copy signed by this client contact (recorded by the uploader). */
  signedByContactId: objectId.nullable().optional(),
});

/** FR-DOC-20 / AC-26.1: name, folder, due date (today or later) and requested-from are required. */
export const documentRequestSchema = z.strictObject({
  name: requiredText('Document name', 200),
  folderId: objectId,
  dueDate: dateOnly('due date'),
  requestedFrom: partyRefSchema,
  taskId: objectId.nullable().optional(),
  /** Defaults to on in Contracts and off elsewhere (FR-DOC-20). */
  requiresSignature: z.boolean().optional(),
  note: optionalText(500),
});
export type DocumentRequestInput = z.input<typeof documentRequestSchema>;
export const cancelRequestSchema = z.strictObject({ reason: requiredText('Reason', 500) });
export const DUE_DATE_PAST_MESSAGE = 'The due date can’t be in the past.';

export interface UploadTicketDto {
  id: string;
  name: string;
  /** PUT the file's bytes here (a short-lived write-only link). */
  uploadUrl: string;
  /** Headers the PUT must carry. */
  headers: Record<string, string>;
  expiresAt: string;
}

export const folderSchema = z.strictObject({
  name: requiredText('Folder name', 120),
  parentId: objectId.nullable().optional(),
});
export const renameFolderSchema = z.strictObject({ name: requiredText('Folder name', 120) });
export const archiveDocumentSchema = z.strictObject({ reason: requiredText('Reason', 500) });
export const updateDocumentSchema = z.strictObject({
  folderId: objectId.optional(),
  taskId: objectId.nullable().optional(),
  /** Requested documents only: reassign (EC-44) or move the due date. */
  requestedFrom: partyRefSchema.optional(),
  dueDate: dateOnly('due date').optional(),
});
/** FR-DOC-43: restrict a folder to the PM, Admins and the selected project members. */
export const folderAccessSchema = z.strictObject({
  restricted: z.boolean(),
  memberIds: z.array(objectId).max(200).default([]),
});
export type FolderAccessInput = z.input<typeof folderAccessSchema>;
export const RESTRICTED_FOLDER_NOTE =
  'Only the project manager, Admins and the people you pick can see this folder and its documents.';
export const documentListQuerySchema = z.strictObject({
  folderId: objectId.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(DOCUMENT_STATES).optional(),
  archived: z.enum(['true', 'false']).optional(),
});

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  kind: 'CONTRACTS' | 'PHASE' | 'CUSTOM' | 'ISSUES';
  depth: number;
  documentCount: number;
  /** FR-DOC-43: restricted to the PM, Admins and `allowedUserIds`. */
  restricted: boolean;
  /** Restricted, or inside a restricted folder. */
  restrictedByParent: boolean;
  /** The picked members; only sent to people who may change the restriction. */
  allowedUserIds: string[];
  /** Phase folders hold task evidence, so they can't be restricted. */
  canRestrict: boolean;
}

export interface DocumentVersionDto {
  version: number;
  fileName: string;
  size: number;
  mimeType: string;
  sha256: string;
  status: DocumentStatus;
  uploadedBy: Ref | null;
  uploadedAt: string;
  note: string | null;
  /** FR-DOC-25: the client contact who signed; `uploadedBy` is who recorded it. */
  signedBy: PartyDto | null;
}

export interface DocumentDto {
  id: string;
  projectId: string;
  folderId: string;
  name: string;
  /** null for a Requested or Cancelled document with no file yet. */
  kind: FileKind | null;
  status: DocumentState;
  requiresSignature: boolean;
  /** Request details (FR-DOC-20/23/26); null for a direct upload. */
  request: {
    requestedBy: Ref | null;
    requestedFrom: PartyDto | null;
    dueDate: string | null;
    /** Still Requested and due before today (Philippine time). */
    overdue: boolean;
    cancelled: { by: Ref | null; at: string; reason: string } | null;
  } | null;
  /** Latest Signed version, kept as the "Signed copy" (FR-DOC-14, FR-DOC-31). */
  signedVersion: number | null;
  latestVersion: number;
  task: Ref | null;
  source: 'DOCUMENT' | 'EVIDENCE' | 'ISSUE';
  archived: boolean;
  archivedReason: string | null;
  updatedAt: string;
  uploadedBy: Ref | null;
  versions: DocumentVersionDto[];
  events: {
    event: string;
    actor: Ref | null;
    at: string;
    version: number | null;
    note: string | null;
    /** The client contact the internal actor acted for (FR-DOC-24/25). */
    onBehalfOf: PartyDto | null;
  }[];
  can: { upload: boolean; edit: boolean; archive: boolean; cancel: boolean };
}

export interface DocumentListDto {
  items: DocumentDto[];
  counts: { all: number; REQUESTED: number; SUBMITTED: number; SIGNED: number; CANCELLED: number };
  can: { upload: boolean; createFolder: boolean; archive: boolean; request: boolean };
}

/** People a document can be requested from (AC-26.2): project members and active client contacts. */
export interface RequestPartiesDto {
  users: PartyDto[];
  contacts: PartyDto[];
}

/** One open request in the Dashboard "Waiting on client" list or a user's "Requested from you". */
export interface DocumentRequestRowDto {
  id: string;
  name: string;
  project: Ref;
  client: Ref | null;
  folder: Ref;
  requestedFrom: PartyDto;
  requestedBy: Ref | null;
  dueDate: string;
  /** Days past the due date (negative = days left; 0 = due today). */
  daysOverdue: number;
  overdue: boolean;
}
export interface DocumentRequestListDto {
  items: DocumentRequestRowDto[];
  overdue: number;
}

/** "6d overdue", "Due today", "Due tomorrow", "Due Oct 15" (mockup dashboard pills). */
export function requestDueLabel(daysOverdue: number, dueDate: string): string {
  if (daysOverdue > 0) return `${daysOverdue}d overdue`;
  if (daysOverdue === 0) return 'Due today';
  if (daysOverdue === -1) return 'Due tomorrow';
  const d = new Date(`${dueDate}T00:00:00Z`);
  const m = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `Due ${m} ${d.getUTCDate()}`;
}
export function partyLabel(p: PartyDto | null): string {
  if (!p) return '—';
  const base = p.kind === 'CONTACT' && p.company ? `${p.name} · ${p.company}` : p.name;
  return p.active ? base : `${base} (inactive)`;
}

// ---------- Notifications (FR-NTF-01..06) ----------
export const NOTIFICATION_TYPES = [
  'FOLLOW_UP',
  'ASSIGNED',
  'FOR_REVIEW',
  'APPROVED',
  'REJECTED',
  'EVIDENCE',
  // Issues (doc 13 FR-ISS-10)
  'ISSUE_CREATED',
  'ISSUE_ASSIGNED',
  'ISSUE_STATUS',
  'ISSUE_COMMENT',
  'ISSUE_OVERDUE',
  'ISSUE_OWNER_NEEDED',
  // Activity tracker (doc 14 §10, EC-76) and leave (Q-46)
  'DAY_REOPENED',
  'TIMER_STOPPED',
  'LEAVE_RECORDED',
  'LEAVE_CANCELLED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** FR-NTF-06: unread count refresh interval; notifications are kept 90 days. */
export const NOTIFICATION_LIST_NOTE = 'Showing the last 90 days';
export const NOTIFICATION_POLL_MS = 60_000;
export const NOTIFICATION_RETENTION_DAYS = 90;

export interface NotificationDto {
  id: string;
  type: NotificationType;
  actor: Ref | null;
  task: Ref | null;
  /** Issue notifications: the issue's key and title. */
  issue: { id: string; key: string; title: string } | null;
  /** Null on personal notices (tracker, leave). */
  project: Ref | null;
  /** Personal notices: the full sentence and where it opens. */
  message: string | null;
  link: string | null;
  read: boolean;
  at: string;
}

export interface NotificationListDto {
  items: NotificationDto[];
  unread: number;
}

/** "Maria P." from "Maria Perez" (mockup style). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

/** The sentence after the actor's name (FR-NTF-03). */
export const NOTIFICATION_VERBS: Record<NotificationType, string> = {
  FOLLOW_UP: 'added a follow-up on',
  ASSIGNED: 'assigned you to',
  FOR_REVIEW: 'sent for your review',
  APPROVED: 'approved',
  REJECTED: 'sent back',
  EVIDENCE: 'uploaded evidence on',
  ISSUE_CREATED: 'raised',
  ISSUE_ASSIGNED: 'assigned you',
  ISSUE_STATUS: 'changed the status of',
  ISSUE_COMMENT: 'commented on',
  ISSUE_OVERDUE: 'Overdue:',
  ISSUE_OWNER_NEEDED: 'Owner needed:',
  DAY_REOPENED: 'reopened your timesheet',
  TIMER_STOPPED: 'Timer stopped:',
  LEAVE_RECORDED: 'recorded leave',
  LEAVE_CANCELLED: 'cancelled leave',
};

// ---------- Project conversation (FR-CNV-01..08) ----------
export const MESSAGE_TYPES = ['NOTE', 'CALL', 'MEETING', 'DECISION'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  NOTE: 'Note',
  CALL: 'Call',
  MEETING: 'Meeting',
  DECISION: 'Decision',
};
export const MESSAGE_TYPE_PLURALS: Record<MessageType, string> = {
  NOTE: 'Notes',
  CALL: 'Calls',
  MEETING: 'Meetings',
  DECISION: 'Decisions',
};
export const MESSAGE_TYPE_VARIANTS: Record<MessageType, string> = {
  NOTE: 'secondary',
  CALL: 'info',
  MEETING: 'primary',
  DECISION: 'success',
};
export const MAX_MESSAGE_LENGTH = 5000;

export const postMessageSchema = z.strictObject({
  text: requiredText('Message', MAX_MESSAGE_LENGTH),
  type: z.enum(MESSAGE_TYPES).default('NOTE'),
  taskId: objectId.nullable().optional(),
  contactIds: z.array(objectId).max(10).default([]),
});
export type PostMessageInput = z.input<typeof postMessageSchema>;
export const hideMessageSchema = z.strictObject({ reason: requiredText('Reason', 500) });
export const messageQuerySchema = z.strictObject({
  type: z.enum(MESSAGE_TYPES).optional(),
  taskId: objectId.optional(),
  contactId: objectId.optional(),
  q: z.string().trim().max(100).optional(),
  from: dateOnly('date').optional(),
  to: dateOnly('date').optional(),
});

export interface MessageDto {
  id: string;
  /** null when hidden by an Admin (the text is withheld). */
  text: string | null;
  type: MessageType;
  author: UserRefDto | null;
  at: string;
  task: Ref | null;
  contacts: (Ref & { active: boolean })[];
  hidden: { by: Ref | null; at: string; reason: string } | null;
}

export interface MessageListDto {
  items: MessageDto[];
  can: { post: boolean; hide: boolean };
}

/** Splits plain text into text and http(s) links (FR-CNV-07); nothing is ever rendered as HTML. */
export function linkify(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], href: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
