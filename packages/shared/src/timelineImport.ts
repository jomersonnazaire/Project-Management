/**
 * CR-22 Part B slice 3: timeline Excel template, export and import (FR-TL-15 to 22, 25, 26; §B4,
 * §B5; UIE CR22_PROJECT_TIMELINE_UI.md §5 and §6). Shared by the API (workbook, checks, DTOs) and
 * the web app (modal copy). Limits follow CR-19 (NFR-52).
 */

/** §B4 columns, in order. The first ten are visible; `Task ID` (column K) is hidden. */
export const TIMELINE_COLUMNS = [
  { field: 'number', header: 'Task number' },
  { field: 'name', header: 'Task name' },
  { field: 'phase', header: 'Phase' },
  { field: 'milestone', header: 'Milestone' },
  { field: 'start', header: 'Start' },
  { field: 'finish', header: 'Finish' },
  { field: 'dependsOn', header: 'Depends on' },
  { field: 'owner', header: 'Owner' },
  { field: 'baselineStart', header: 'Baseline start' },
  { field: 'baselineFinish', header: 'Baseline finish' },
  { field: 'taskId', header: 'Task ID' },
] as const;
export type TimelineImportField = (typeof TIMELINE_COLUMNS)[number]['field'];
export const TIMELINE_COLUMN_LABEL = Object.fromEntries(
  TIMELINE_COLUMNS.map((c) => [c.field, c.header]),
) as Record<TimelineImportField, string>;
/** The 10 columns the preview table shows (the hidden Task ID isn't shown, UIE §5.1). */
export const TIMELINE_VISIBLE_FIELDS = TIMELINE_COLUMNS.slice(0, 10).map((c) => c.field);
/** Fields an import writes (§B4: status, assignees, estimate, priority and party never change). */
export const TIMELINE_PLAN_FIELDS = [
  'name',
  'phase',
  'milestone',
  'start',
  'finish',
  'dependsOn',
  'owner',
] as const satisfies readonly TimelineImportField[];
export type TimelinePlanField = (typeof TIMELINE_PLAN_FIELDS)[number];

export const TIMELINE_SHEET = 'Timeline';
export const TIMELINE_INSTRUCTIONS_SHEET = 'Instructions';
export const TIMELINE_META_SHEET = '_meta';
export const TIMELINE_TEMPLATE_ID = 'opstrack-timeline';
export const TIMELINE_TEMPLATE_VERSION = 1;
export const TIMELINE_TEMPLATE_NAME = 'OpsTrack-timeline-template.xlsx';
export const TIMELINE_MAX_DEPENDENCIES = 50;
/** Q24 length limits (task model: name 200; phase names 120). */
export const TIMELINE_MAX_NAME = 200;
export const TIMELINE_MAX_PHASE = 120;
/** Q24: a Depends on cell longer than this isn't parsed (50 numbers fit easily). */
export const TIMELINE_MAX_DEPENDS_TEXT = 500;

/** File names: `acme-test-co-rollout-timeline-2026-11-09.xlsx` (UIE §5.1 file chip). */
export function timelineSlug(projectName: string): string {
  const s = projectName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'project';
}
export const timelineExportFileName = (projectName: string, phDate: string) =>
  `${timelineSlug(projectName)}-timeline-${phDate}.xlsx`;

/** §B4 date rule: a date cell (read as YYYY-MM-DD) or YYYY-MM-DD text; a real calendar date. */
export function parseTimelineDate(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const d = new Date(`${m[0]}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[0]) return null;
  return m[0];
}

/** §B4 Milestone: Y, N, Yes, No in any case; blank = N. `null` = not allowed. */
export function parseMilestone(text: string): boolean | null {
  const v = text.trim().toLowerCase();
  if (v === '' || v === 'n' || v === 'no') return false;
  if (v === 'y' || v === 'yes') return true;
  return null;
}

/** §B4 Depends on: whole numbers separated by `,` or `;`. `null` = bad format. */
export function parseDependsOn(text: string): number[] | null {
  const v = text.trim();
  if (!v) return [];
  if (!/^\d+(\s*[,;]\s*\d+)*\s*[,;]?$/.test(v)) return null;
  const nums = v
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  return [...new Set(nums)];
}

/** §B4 Task number: a whole number of 1 or more. */
export function parseTaskNumber(text: string): number | null {
  const v = text.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 1_000_000 ? n : null;
}

/** §B5 / UIE §5.2 row messages (exact copy). */
export const TIMELINE_ROW_MESSAGES = {
  NAME_REQUIRED: 'Task name is required.',
  BAD_NUMBER: 'Task number must be a whole number of 1 or more.',
  FINISH_BEFORE_START: "Finish can't be before Start.",
  BASELINE_FINISH_BEFORE_START: "Baseline finish can't be before Baseline start.",
  MILESTONE: 'Milestone must be Y or N.',
  SELF_DEPENDENCY: "Depends on: a task can't depend on itself.",
  DEPENDENCY_FORMAT: 'Depends on: use task numbers only, e.g. 3, 5.',
  TOO_MANY_DEPENDENCIES: `More than ${TIMELINE_MAX_DEPENDENCIES} dependencies.`,
  DEPENDS_ON_TOO_LONG: 'Depends on is too long. Use task numbers only, e.g. 3, 5.',
  CHANGED_SINCE_EXPORT:
    'This task was changed in OpsTrack after the file was exported. Confirm to overwrite it.',
} as const;
/** Q24 (UIE §5.2). */
export const nameTooLongMessage = (n: number, max = TIMELINE_MAX_NAME) =>
  `Task name can be up to ${max} characters (this one has ${n}).`;
export const phaseTooLongMessage = (max = TIMELINE_MAX_PHASE) =>
  `Phase can be up to ${max} characters.`;
export const duplicateNumberMessage = (n: number | string) =>
  `Task number ${n} appears more than once in the file.`;
export const badDateMessage = (column: string) =>
  `${column} isn't a valid date. Use a date cell or YYYY-MM-DD.`;
export const missingDependencyMessage = (n: number) =>
  `Depends on: ${n} isn't a task in this project or this file.`;
export const cycleMessage = (labels: (number | string)[]) =>
  `Depends on: circular dependency ${labels.join(' → ')}.`;
export const unknownOwnerMessage = (email: string) =>
  `Owner ${email} isn't an active internal user.`;
export const notMemberMessage = (email: string) =>
  `${email} isn't a member of this project. Add them to the project first.`;
export const phaseNotAllowedMessage = (name: string, status: string) =>
  `You can't add phase ${name} while the project is ${status}.`;
export const badTaskIdMessage = (id: string) => `Task ID ${id} isn't a task in this project.`;
export const duplicateTaskIdMessage = (id: string) =>
  `Task ID ${id} appears more than once in the file.`;

/**
 * UIE §5.1 file errors: a bold lead and the rest. Nothing is previewed or imported. The API sends
 * `lead + ' ' + rest` as the message and the code; the web app renders the lead in bold.
 */
export const TIMELINE_FILE_ERRORS = {
  NOT_XLSX: {
    lead: "This file isn't an .xlsx workbook.",
    rest: 'Save it as Excel Workbook (.xlsx) and try again. Nothing was imported.',
  },
  // Q24 (UIE §5.1), word for word.
  UNREADABLE_FILE: {
    lead: "We couldn't open this file.",
    rest: 'It may be damaged or password-protected. Open it in Excel, save it again as Excel Workbook (.xlsx), then try again. Nothing was imported.',
  },
  NO_TIMELINE_SHEET: {
    lead: 'This file has no Timeline sheet.',
    rest: 'Use the OpsTrack template or a downloaded timeline, and keep the sheet name Timeline. Nothing was imported.',
  },
  EMPTY_FILE: {
    lead: 'This file has no tasks.',
    rest: 'Add at least one row under the headers on the Timeline sheet and try again. Nothing was imported.',
  },
} as const;
/** The 5 MB upload limit (same as CR-19), checked in the browser and by the API. */
export const TIMELINE_MAX_BYTES = 5 * 1024 * 1024;
/** "{size} MB" rounded UP to one decimal, so a file just over the limit never reads "5 MB". */
export const fileSizeMb = (bytes: number) => {
  const mb = Math.ceil((bytes / (1024 * 1024)) * 10) / 10;
  return mb.toFixed(1).replace(/\.0$/, '');
};
export const fileTooLargeError = (bytes: number) => ({
  lead: `This file is ${fileSizeMb(bytes)} MB.`,
  rest: 'The limit is 5 MB. Remove extra sheets or images and try again. Nothing was imported.',
});
export type TimelineFileErrorCode =
  | keyof typeof TIMELINE_FILE_ERRORS
  | 'COLUMNS'
  | 'OTHER_PROJECT'
  | 'TOO_MANY_ROWS'
  | 'FILE_TOO_LARGE';
export const columnsError = (names: string[]) => ({
  lead: `Some columns are missing or out of order: ${names.join(', ')}.`,
  rest: 'Keep row 1 of the template as it is, then try again. Nothing was imported.',
});
export const otherProjectError = (projectName: string) => ({
  lead: 'This file was exported from a different project.',
  rest: `Export the timeline from ${projectName}, or start from the blank template. Nothing was imported.`,
});
export const tooManyTimelineRowsError = (n: number, max: number) => ({
  lead: `This file has ${n.toLocaleString('en-US')} rows.`,
  rest: `You can import up to ${max.toLocaleString('en-US')} at a time. Split it into smaller files and import them one by one. Nothing was imported.`,
});
export const TIMELINE_FILE_ERROR_CODES = [
  'NOT_XLSX',
  'UNREADABLE_FILE',
  'FILE_TOO_LARGE',
  'NO_TIMELINE_SHEET',
  'EMPTY_FILE',
  'COLUMNS',
  'OTHER_PROJECT',
  'TOO_MANY_ROWS',
] as const;

/** UIE §5.1 copy used by the modal. */
export const TIMELINE_IMPORT_COPY = {
  NEVER_DELETES_LEAD: 'Import adds and updates tasks. It never deletes tasks.',
  NEVER_DELETES_REST:
    "Rows exported from OpsTrack update their own task (matched by a hidden Task ID). Rows you add become new tasks at the end of the list. Tasks that aren't in the file stay as they are. A blank cell clears that field.",
  LIMITS: '.xlsx only · up to 5 MB · 2,000 rows',
  READING: 'Reading file…',
  READING_SUB: 'Checking every row. Nothing is saved yet.',
  IMPORTING: 'Importing…',
  IMPORTING_SUB: "Don't close this window.",
  BASELINE_IGNORED_LEAD: 'Baseline columns are ignored on import.',
  STALE_LEAD: 'This preview is out of date.',
  STALE_REST: 'The project changed after you checked the file. Nothing was saved.',
  FOOTNOTE_REST: 'means the cell is empty, so that field will be cleared.',
  NOTHING_DELETED:
    "Nothing was deleted. Baselines didn't change: click Save baseline if you want the new dates as the baseline.",
  UP_TO_DATE: 'The timeline, critical path and forecast are up to date.',
  IMPORT_NOT_ALLOWED: 'Import works while the project is Planning, Active or On hold.',
} as const;

export const errorsAlertLead = (n: number) =>
  `Fix ${n} error${n === 1 ? '' : 's'} in the file and upload again.`;
export const changedAlertLead = (n: number) =>
  `${n} task${n === 1 ? ' was' : 's were'} changed in OpsTrack after this file was exported.`;
export const changedAlertRest = (n: number) =>
  `Nothing is saved for ${n === 1 ? 'it' : 'them'} unless you confirm. Confirming replaces the OpsTrack values with the file values.`;
export const notConfirmedHelp = (n: number) =>
  `${n} changed row${n === 1 ? '' : 's'} not confirmed will be left as ${n === 1 ? 'it is' : 'they are'}.`;
export const newPhaseNotice = (name: string) =>
  `New phase ${name} will be added at the end of the phase list.`;
export const numberingLine = (pairs: { file: number; final: number }[]) =>
  `New tasks go to the end of the list. When you import, OpsTrack gives them the final numbers (${pairs
    .map((p) => `file ${p.file} → #${p.final}`)
    .join(
      ', ',
    )}). Depends on uses the Task numbers in this file, so new rows can depend on each other.`;
const list = (nums: number[]) =>
  nums.length <= 1
    ? nums.map((n) => `#${n}`).join('')
    : `${nums
        .slice(0, -1)
        .map((n) => `#${n}`)
        .join(', ')} and #${nums[nums.length - 1]}`;
/** UIE §5.1 Done: "2 tasks added at the end (#21 and #22) and 5 updated. 8 rows were unchanged." */
export function importDoneLine(r: {
  created: number[];
  updated: number;
  unchanged: number;
  leftUnconfirmed: number;
}): string {
  const added =
    r.created.length === 0
      ? 'No tasks added'
      : `${r.created.length} task${r.created.length === 1 ? '' : 's'} added at the end (${list(r.created)})`;
  let s = `${added} and ${r.updated} updated. ${r.unchanged} row${r.unchanged === 1 ? ' was' : 's were'} unchanged.`;
  if (r.leftUnconfirmed)
    s += ` ${r.leftUnconfirmed} changed row${r.leftUnconfirmed === 1 ? ' was' : 's were'} not confirmed and left as ${r.leftUnconfirmed === 1 ? 'it was' : 'they were'}.`;
  return s;
}

export type TimelineImportResult = 'NEW' | 'UPDATE' | 'UNCHANGED' | 'CHANGED' | 'ERROR';
export const TIMELINE_RESULT_LABELS: Record<TimelineImportResult, string> = {
  NEW: 'New',
  UPDATE: 'Update',
  UNCHANGED: 'Unchanged',
  CHANGED: 'Changed since export',
  ERROR: 'Error',
};

export interface TimelineImportRowDto {
  /** Excel row number. */
  row: number;
  result: TimelineImportResult;
  /** The file's cells as shown (dates as YYYY-MM-DD, Depends on as `3, 5`). */
  values: Record<TimelineImportField, string>;
  /** What OpsTrack has now, for each changed field (shown struck through). */
  old: Partial<Record<TimelinePlanField, string>>;
  /** Fields this row changes (cleared ones included). */
  changes: TimelinePlanField[];
  /** Fields a blank cell clears (FR-TL-17, Q-145). */
  clears: TimelinePlanField[];
  errors: { field: TimelineImportField | null; message: string }[];
  /** FR-TL-25: who changed the task after the export, when the row is CHANGED. */
  changedSince: string | null;
  /** NEW rows: the task number it will get. */
  willBe: number | null;
}

export interface TimelineImportCounts {
  total: number;
  new: number;
  update: number;
  unchanged: number;
  changed: number;
  error: number;
  /** Error messages (UIE "Fix N errors"). */
  errorMessages: number;
  clears: number;
}

export interface TimelineImportPreviewDto {
  fileName: string;
  size: number;
  /** From the metadata sheet; null for the blank template or a file without one. */
  exported: { at: string | null; by: string | null } | null;
  rows: TimelineImportRowDto[];
  counts: TimelineImportCounts;
  newPhases: string[];
  baselineFilled: boolean;
  token: string;
}

export interface TimelineImportCommitDto {
  importId: string;
  created: number[];
  updated: number;
  unchanged: number;
  leftUnconfirmed: number;
  newPhases: string[];
}

/** FR-TL-25: the commit names the CHANGED rows the PM confirmed (Excel row numbers). */
export const TIMELINE_CONFIRM_QUERY = 'confirm';
