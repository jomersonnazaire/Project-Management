import type { AccessAction, PermissionGrid, RecordType } from './accessRules.js';
import { hasPermission } from './accessRules.js';

/**
 * CR-19: Clients Excel template download and import (doc 17, `17_CR-19_CLIENTS_EXCEL_IMPORT.md`).
 * Shared by the API (template, parsing, matching) and the web app (button gate, preview, the
 * skipped-rows file), so both read the same columns, limits and copy.
 */

/** FR-CLI-23 / FR-CLI-24 (Q-111): the one gate for the button and all three API calls. */
export const CLIENT_IMPORT_PERMISSIONS: readonly (readonly [RecordType, AccessAction])[] = [
  ['clients', 'create'],
  ['clients', 'edit'],
  ['contacts', 'create'],
  ['contacts', 'edit'],
] as const;

export function canImportClients(permissions: PermissionGrid | null | undefined): boolean {
  return CLIENT_IMPORT_PERMISSIONS.every(([record, action]) =>
    hasPermission(permissions, record, action),
  );
}

/** NFR-36 (Locked): 5 MB per file and 2,000 data rows per sheet. */
export const CLIENT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const CLIENT_IMPORT_MAX_ROWS = 2000;
/** NFR-37: zip-bomb guard on the declared uncompressed size of the workbook. */
export const CLIENT_IMPORT_MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

/** NFR-41 (Locked): per user, per 15 minutes; then 429. One commit per user at a time. */
export const CLIENT_IMPORT_RATE_WINDOW_MS = 15 * 60_000;
export const CLIENT_IMPORT_PREVIEW_LIMIT = 20;
export const CLIENT_IMPORT_COMMIT_LIMIT = 5;

export const CLIENT_IMPORT_TEMPLATE_NAME = 'OpsTrack-clients-template.xlsx';
export const CLIENT_IMPORT_SKIPPED_NAME = 'OpsTrack-skipped-rows.xlsx';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** FR-CLI-27: row 1 explains each column, row 2 holds the headers, data starts on row 3. */
export const CLIENT_IMPORT_HELP_ROW = 1;
export const CLIENT_IMPORT_HEADER_ROW = 2;
export const CLIENT_IMPORT_FIRST_DATA_ROW = 3;

export type ClientImportSheet = 'Clients' | 'Contacts';
export const CLIENT_IMPORT_SHEETS: readonly ClientImportSheet[] = ['Clients', 'Contacts'];

export type ClientImportField =
  | 'company'
  | 'industry'
  | 'address'
  | 'notes'
  | 'status'
  | 'name'
  | 'position'
  | 'email'
  | 'phone'
  | 'department';

export interface ClientImportColumn {
  field: ClientImportField;
  header: string;
  /** Model limit (schemas.ts / Client.ts / ClientContact.ts). */
  max: number;
  help: string;
}

/**
 * FR-CLI-26 (Locked): the columns of each sheet, in order. "Company name" maps to the client's
 * `name`; on Contacts it links the row to its client. "Full Name" maps to the contact's `name`.
 */
export const CLIENT_IMPORT_COLUMNS: Record<ClientImportSheet, readonly ClientImportColumn[]> = {
  Clients: [
    {
      field: 'company',
      header: 'Company name',
      max: 160,
      help: 'Required. Up to 160 characters. Matches an existing client, with case and outer spaces ignored.',
    },
    { field: 'industry', header: 'Industry', max: 120, help: 'Optional. Up to 120 characters.' },
    {
      field: 'address',
      header: 'Address',
      max: 500,
      help: 'Optional. Up to 500 characters. Line breaks allowed.',
    },
    { field: 'notes', header: 'Notes', max: 2000, help: 'Optional. Up to 2,000 characters.' },
    {
      field: 'status',
      header: 'Status',
      max: 20,
      help: 'Active or Inactive. Blank = Active for a new client, unchanged for an existing one.',
    },
  ],
  Contacts: [
    {
      field: 'company',
      header: 'Company name',
      max: 160,
      help: 'Required. A client on the Clients sheet or already in OpsTrack.',
    },
    {
      field: 'name',
      header: 'Full Name',
      max: 120,
      help: 'Required for a new contact. Up to 120 characters. Matches when Email is blank.',
    },
    { field: 'position', header: 'Position', max: 120, help: 'Optional. Up to 120 characters.' },
    {
      field: 'email',
      header: 'Email',
      max: 254,
      help: 'Optional. Matches an existing contact of that client, with case ignored.',
    },
    {
      field: 'phone',
      header: 'Phone',
      max: 40,
      help: 'Optional. Up to 40 characters. A leading + or 0 is kept.',
    },
    {
      field: 'department',
      header: 'Department',
      max: 120,
      help: 'Optional. Up to 120 characters.',
    },
    { field: 'notes', header: 'Notes', max: 2000, help: 'Optional. Up to 2,000 characters.' },
  ],
};

export const CLIENT_IMPORT_STATUS_VALUES = ['Active', 'Inactive'] as const;

/** FR-CLI-37 / NFR-38: a value Excel or a CSV reader could run as a formula. */
export function isFormulaLike(value: string): boolean {
  return /^[\t\r\n]*[=+\-@]/.test(value);
}

/** Signed numbers, times and percents (e.g. `-5`, `+04:00`, `+50%`) can't run as a formula. */
const SIGNED_NUMBER = /^[+-]?[\d.,:%]+$/;

/** FR-CLI-37: CSV cells that look like a formula are prefixed with `'`. */
export function csvSafe(value: string): string {
  return isFormulaLike(value) && !SIGNED_NUMBER.test(value) ? `'${value}` : value;
}

// ----- Copy (CR-19 §6, §9, UIE CLIENTS_EXCEL_IMPORT_UI.md) -----
export const CLIENT_IMPORT_MESSAGES = {
  UNSUPPORTED_FILE: 'Upload an .xlsx file.',
  FILE_TOO_LARGE: 'The file is larger than 5 MB.',
  NOT_TEMPLATE: "This file isn't the OpsTrack template. Download the template and try again.",
  EMPTY_FILE: 'No rows found in the file.',
  UNREADABLE_FILE: "This file can't be read. Save it again as .xlsx and retry.",
  IMPORT_FAILED: 'Import failed. Nothing was saved. Try again.',
  /** FR-CLI-35b / Q-116: any 409 PREVIEW_STALE (changed data, concurrent import, token checks). */
  PREVIEW_STALE: 'These clients changed after your preview. Preview again.',
  /** AC-62.23 / EC-158: the preview-token signing key isn't set on the API (503). */
  IMPORT_NOT_CONFIGURED: 'Excel import isn’t set up yet. Ask an Admin.',
  /** NFR-41 / AC-62.24: a second commit by the same user while one is running (429 IMPORT_BUSY). */
  IMPORT_BUSY: 'Another import is still running. Wait a moment, then try again. Nothing was saved.',
  /** NFR-41: over 20 previews or 5 commits in 15 minutes (429 RATE_LIMITED). */
  RATE_LIMITED: 'Too many imports. Wait a few minutes, then try again. Nothing was saved.',
  /** UIE modal copy (CLIENTS_EXCEL_IMPORT_UI.md), shown by the web app for these responses. */
  UI_PREVIEW_STALE: 'This preview is out of date. Preview again.',
  UI_NOT_CONFIGURED: "Excel import isn't available right now. Nothing was saved.",
  UI_NOT_CONFIGURED_TEMPLATE: "Excel import isn't available right now.",
  UI_BUSY: 'Another import is still running. Wait a moment, then try again. Nothing was saved.',
  /** UIE: any other template download failure (404, 5xx, network). */
  TEMPLATE_FAILED: "Couldn't download the template. Try again.",
} as const;

/** UIE: error codes whose server text the import modal shows as is (§9 file checks). */
export const CLIENT_IMPORT_FILE_ERROR_CODES = [
  'NOT_TEMPLATE',
  'EMPTY_FILE',
  'TOO_MANY_ROWS',
  'UNREADABLE_FILE',
] as const;

/** FR-CLI-35b: the commit sends the preview's signed token in this header. */
export const CLIENT_IMPORT_TOKEN_HEADER = 'X-Import-Preview-Token';

export const tooManyRowsMessage = (sheet: ClientImportSheet, n: number) =>
  `Too many rows: the ${sheet} sheet has ${n.toLocaleString('en-US')}. The limit is ${CLIENT_IMPORT_MAX_ROWS.toLocaleString('en-US')} per sheet.`;

export const extraColumnsMessage = (names: string[]) =>
  `Extra columns were ignored: ${names.join(', ')}.`;

/** "rows 4 and 7", "rows 4, 7 and 9". */
export function rowList(rows: number[]): string {
  if (rows.length < 2) return `row ${rows[0] ?? ''}`;
  return `rows ${rows.slice(0, -1).join(', ')} and ${rows[rows.length - 1]}`;
}

export const CLIENT_IMPORT_REASONS = {
  companyBlank: 'Company name is blank',
  fullNameBlank: 'Full name is blank',
  emailInvalid: "Email isn't valid",
  statusInvalid: 'Status must be Active or Inactive',
  tooLong: (header: string, max: number) =>
    `${header} is longer than ${max.toLocaleString('en-US')} characters`,
  duplicate: (rows: number[]) => `Duplicate in file (${rowList(rows)})`,
  companyNotFound: (name: string) =>
    `Company ${name} isn't on the Clients sheet or in OpsTrack. Add it on the Clients sheet.`,
  companyOutOfScope: "This company name can't be used.",
  clientRowError: (row: number) => `Its client row ${row} has an error.`,
  ambiguous: (company: string) =>
    `Matches more than one contact in ${company}. Fix it on the Contacts tab first.`,
  statusPermission: (current: 'Active' | 'Inactive') =>
    `You don't have permission to change Status. Set it back to ${current} or leave it blank, then import this row again.`,
  possibleDuplicate: (name: string) =>
    `Possible duplicate of ${name} (no email) on the Contacts tab.`,
} as const;

// ----- API shapes -----
export type ClientImportResult = 'NEW' | 'UPDATE' | 'NO_CHANGE' | 'ERROR';

export const CLIENT_IMPORT_RESULT_LABELS: Record<ClientImportResult, string> = {
  NEW: 'New',
  UPDATE: 'Update',
  NO_CHANGE: 'No change',
  ERROR: 'Error',
};

export interface ClientImportRowDto {
  sheet: ClientImportSheet;
  /** Excel row number (data starts on row 3). */
  row: number;
  result: ClientImportResult;
  /** The matched record is inactive (preview tag "Update (inactive)", Q-114). */
  inactive?: boolean;
  /** Error reasons (empty unless result is ERROR). */
  reasons: string[];
  /** Non-blocking notes, e.g. "Possible duplicate of …" (Q-113). */
  warnings: string[];
  /** The row's cells as read (text), keyed by column header, for the preview and skipped file. */
  values: Record<string, string>;
}

export interface ClientImportCountsDto {
  new: number;
  update: number;
  noChange: number;
  error: number;
}

export interface ClientImportPreviewDto {
  fileName: string;
  size: number;
  counts: {
    clients: ClientImportCountsDto;
    contacts: ClientImportCountsDto;
    total: ClientImportCountsDto;
  };
  clients: ClientImportRowDto[];
  contacts: ClientImportRowDto[];
  /** File-level notes, e.g. "Extra columns were ignored: …". */
  notes: string[];
  /**
   * FR-CLI-35b: server-signed preview token; send it back with the commit (header
   * CLIENT_IMPORT_TOKEN_HEADER). Valid for 15 minutes, for the previewing user only.
   */
  token: string;
}

export interface ClientImportCommitDto extends Omit<ClientImportPreviewDto, 'token'> {
  importId: string;
  /** What was actually written (FR-CLI-38 toast: X new, Y updated, Z skipped). */
  applied: { created: number; updated: number; skipped: number };
}

/** FR-CLI-38: "Imported {X} new, updated {Y}. {Z} rows skipped." */
export function clientImportToast(applied: ClientImportCommitDto['applied']): string {
  return `Imported ${applied.created} new, updated ${applied.updated}. ${applied.skipped} ${applied.skipped === 1 ? 'row' : 'rows'} skipped.`;
}
