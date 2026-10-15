import { z } from 'zod';
import type { Ref } from './projects.js';
import { BRAND, EXPORT_FOOTER, PRE_BRAND_EXPORT_NAME, exportFooterFor } from './brand.js';

/**
 * Daily Accomplishment Report (doc 14 §3, §14, §15): view, save and export only (Q-49).
 * Layout follows Jomerson's sample (FR-DAR-07, -08); columns per FR-DAR-09.
 */
export const DAR_TITLE = 'Daily Accomplishment Report';
/** Footer of a report generated now (the name comes from brand.ts). */
export const DAR_FOOTER = EXPORT_FOOTER;
/**
 * The application name a report carries: what it was generated (or saved) with, so a saved
 * snapshot keeps its name after a rename. Snapshots older than this field were saved under
 * the pre-rename name.
 */
export const darExportName = (r: { exportName?: string | null }) =>
  r.exportName ?? PRE_BRAND_EXPORT_NAME;
export const darFooter = (r: { exportName?: string | null }) => exportFooterFor(darExportName(r));
/** The export name stamped on new reports. */
export const DAR_EXPORT_NAME = BRAND.exportName;
export const DAR_SEND_NOTE = 'Sending to your supervisor is coming with Microsoft sign-in.';
export const DAR_SEND_PILL = 'Coming with Microsoft sign-in';
export const DAR_MAX_DAYS = 31;
export const DAR_RANGE_TOO_LONG = 'The range can be up to 31 days. Pick a shorter range.';
export const DAR_FROM_AFTER_TO = '"From" must be on or before "To".';
export const DAR_COLUMNS = [
  'Date',
  'Time In',
  'Time Out',
  'Rendered Hrs',
  'Client Name',
  'Project Name',
  'Activity Type',
  'Location',
  'Billable',
  'Module',
  'Activity Remarks',
] as const;
export const SAVED_LATEST = 'Latest';
export const SAVED_EARLIER = 'Earlier version';

const dateOnly = (label: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Enter a valid ${label} date.`);

const DAY_MS = 86_400_000;
export const rangeDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

export const darRangeSchema = z
  .strictObject({ from: dateOnly('"From"'), to: dateOnly('"To"') })
  .superRefine((v, ctx) => {
    if (
      Number.isNaN(Date.parse(`${v.from}T00:00:00Z`)) ||
      Number.isNaN(Date.parse(`${v.to}T00:00:00Z`))
    )
      return;
    if (v.from > v.to) ctx.addIssue({ code: 'custom', path: ['from'], message: DAR_FROM_AFTER_TO });
    else if (rangeDays(v.from, v.to) > DAR_MAX_DAYS)
      ctx.addIssue({ code: 'custom', path: ['to'], message: DAR_RANGE_TOO_LONG });
  });
export type DarRange = z.infer<typeof darRangeSchema>;

export const savedReportQuerySchema = z.strictObject({
  from: dateOnly('"Saved from"').optional(),
  to: dateOnly('"Saved to"').optional(),
  label: z.enum(['ALL', 'LATEST', 'EARLIER']).optional(),
});

export type DarDayStatus = 'Submitted' | 'Not submitted' | 'Reopened';

/** One report row, already formatted as the sample shows it. */
export interface DarRowDto {
  date: string;
  /** "08:00 AM"; blank for hours-only entries. */
  timeIn: string;
  timeOut: string;
  minutes: number;
  /** HH:MM */
  rendered: string;
  client: string;
  project: string;
  activityType: string;
  location: string;
  billable: 'Yes' | 'No' | '';
  module: string;
  remarks: string;
  /** An "On leave" line, not an activity (not counted in Total Activities). */
  leave?: boolean;
}

export interface DarDayDto {
  date: string;
  status: DarDayStatus;
  /** "Reopened by {name}" detail, when reopened. */
  reopenedBy: string | null;
  /** "On leave", "Half day leave (AM)", … (FR-LV-06, EC-80 note). */
  leave: string | null;
  minutes: number;
  activities: number;
}

export interface DarReportDto {
  user: Ref;
  /** Supervisor and CC on file (FR-DAR-12); read-only, "Set by Admin". */
  supervisor: Ref | null;
  cc: string[];
  /** The range asked for, and the range shown (future days left out, EC-80). */
  from: string;
  to: string;
  shownTo: string | null;
  generatedAt: string;
  totalActivities: number;
  totalMinutes: number;
  totalRendered: string;
  rows: DarRowDto[];
  days: DarDayDto[];
  /** Running timers left out until Time out. */
  runningExcluded: number;
  /** Application name at generation time (export creator and footer); kept in saved snapshots. */
  exportName?: string;
}

export type SavedTag = 'LATEST' | 'EARLIER' | null;

export interface SavedReportSummaryDto {
  id: string;
  savedAt: string;
  from: string;
  to: string;
  totalActivities: number;
  totalMinutes: number;
  totalRendered: string;
  /** Only when the exact range was saved more than once (FR-DAR-15). */
  tag: SavedTag;
  /** Dates edited after this was saved (FR-DAR-13). */
  changedDates: string[];
}

export interface SavedReportDto extends SavedReportSummaryDto {
  report: DarReportDto;
}

export const savedCopyNote = (when: string) =>
  `Saved copy from ${when}. Later changes to your entries don't change it.`;
export const changedAfterSaveMessage = (date: string) => `${date} was changed after this was saved`;
export const generatedRangeLabel = (from: string, to: string) =>
  `Generated range: ${formatLongDate(from)} to ${formatLongDate(to)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-30" → "Sep 30, 2026" */
export function formatLongDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${day}, ${y}`;
}
/** "2026-09-30" → "Sep 30" */
export function formatShortDate(d: string): string {
  const [, m, day] = d.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${day}`;
}
/** Range label for lists: "Sep 30 – Oct 2" or "Sep 29". */
export const rangeLabel = (from: string, to: string) =>
  from === to ? formatShortDate(from) : `${formatShortDate(from)} – ${formatShortDate(to)}`;
