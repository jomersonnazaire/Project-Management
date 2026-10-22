import { z } from 'zod';
import { phDateOf, type Ref } from './projects.js';
import { BRAND, EXPORT_FOOTER, PRE_BRAND_EXPORT_NAME, exportFooterFor } from './brand.js';

/**
 * Daily Accomplishment Report (doc 14 §3, §14, §15, §N): view, save, export and, for
 * Microsoft-linked users, Send a saved report from their own mailbox (FR-DAR-20).
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
export const DAR_SEND_HOW = 'Save the report, then send it from Saved reports.';
export const DAR_NOTIFIED = 'Your supervisor has been notified that your report is ready.';
/** §11 "Send not available (password sign-in)" (AC-57.4, FR-DAR-24). */
export const DAR_PASSWORD_ONLY =
  "You sign in with a password, so this app can't email your report. Export it instead, and use Notify supervisor to tell your supervisor it's ready.";
/** Largest PDF that Send attaches: 2.5 MB raw (base64 adds ~33%; Graph's request cap is ~4 MB). */
export const DAR_MAX_PDF_BYTES = 2.5 * 1024 * 1024;
/** §11 "Report too large to send" (FR-DAR-22, AC-57.3). */
export const DAR_TOO_LARGE =
  "This report's PDF is over 2.5 MB, so it can't be emailed. Choose a shorter date range, or export it and send it yourself.";
/** Send's own per-user limiter (30 per 15 minutes) answered 429. */
export const DAR_SEND_RATE_LIMITED =
  "You've pressed Send too many times. Wait 15 minutes and try again, or export the report and send it yourself.";
/** Notify supervisor is limited to one notice per report per hour. */
export const DAR_NOTIFY_RECENT =
  'You already notified your supervisor about this report in the last hour. You can notify them again later.';

/**
 * Graph timed out or the connection dropped after the request went out: the mail may or may not
 * have been sent. Not a failure; the saved report records the send as unknown.
 */
export const DAR_SEND_UNCONFIRMED =
  "We couldn't confirm the send. Check your Outlook Sent Items before sending again.";
/**
 * CR-16 / UIE 6: sending a saved report that already has a send on record (sent, or an
 * unconfirmed send) always needs an explicit confirm, however long ago it was.
 * `lastAttemptAt` is the ISO time of that send (from the 409); it is shown in Asia/Manila.
 */
export function darResendConfirmMessage(
  state: 'sent' | 'unknown',
  lastAttemptAt: string,
  range: { from: string; to: string },
): string {
  const when = formatPhDateTime(lastAttemptAt);
  const r = darEmailRange(range.from, range.to);
  return state === 'unknown'
    ? `We couldn't confirm your last send of the report for ${r} on ${when}. Microsoft may already have sent it, so check your Outlook Sent Items. Send it again anyway?`
    : `Already sent on ${when}: report for ${r}. Send it again?`;
}

/** First sentence of every failed-send message (web banner, 409 SEND_UNAVAILABLE). */
export const DAR_NOT_SENT = "Your report wasn't sent.";
/** Any send error code without its own line: never show the raw code. */
export const DAR_SEND_FAILURE_GENERIC =
  'Something went wrong. Try again, or export the report and send it yourself.';
const DAR_NOT_ENABLED_LINE =
  "Sending reports isn't turned on. Export the report and send it yourself.";

/** The line after "Your report wasn't sent." for each `send_error` / SEND_UNAVAILABLE reason. */
const DAR_SEND_FAILURE_LINES: Readonly<Record<string, string>> = {
  ms_auth_failed: 'Microsoft sign-in failed, so nothing was sent. Try again.',
  send_forbidden:
    "Your Microsoft account isn't allowed to send email from OpsTrack. Ask your Admin to allow it.",
  bad_recipient: "Your supervisor's email address isn't valid. Ask your Admin to check it.",
  graph_unavailable: "Microsoft isn't responding right now. Try again in a few minutes.",
  not_found: "We couldn't find this saved report. Refresh the page and try again.",
  not_enabled: DAR_NOT_ENABLED_LINE,
  ms_disabled: DAR_NOT_ENABLED_LINE,
  // Codes that already had their own wording (web and mobile): kept, so the user knows what to do.
  no_mailbox: 'This Microsoft account has no mailbox. Use Export instead.',
  no_supervisor: 'Ask an Admin to set your supervisor.',
  consent_declined:
    "You didn't allow OpsTrack to send email as you. Press Send again and choose Accept, or export the report.",
  admin_consent_required:
    'Your organization needs an administrator to approve OpsTrack sending email for you. Ask your IT admin to approve it, then press Send again. You can export the report meanwhile.',
  wrong_account: 'Pick the same Microsoft account you use for OpsTrack.',
  too_large: DAR_TOO_LARGE,
  not_linked: DAR_PASSWORD_ONLY,
  rate_limited: DAR_SEND_RATE_LIMITED,
};

/** The reason's own line, or the generic one; never the raw code. */
export function darSendFailureLine(reason: string | null | undefined): string {
  return (
    (reason && Object.hasOwn(DAR_SEND_FAILURE_LINES, reason) && DAR_SEND_FAILURE_LINES[reason]) ||
    DAR_SEND_FAILURE_GENERIC
  );
}

/** "Your report wasn't sent. {line}" for a failed send. */
export const darSendFailureMessage = (reason: string | null | undefined) =>
  `${DAR_NOT_SENT} ${darSendFailureLine(reason)}`;

/**
 * Short text for a reason without the "wasn't sent" lead-in (hints such as no_supervisor);
 * result_unavailable is not a failure and gets the "check Sent Items" text.
 */
export function darSendError(reason: string): string {
  if (reason === 'result_unavailable') return DAR_SEND_UNCONFIRMED;
  return darSendFailureLine(reason);
}

/** One person a send went to, as recorded when Graph accepted it. */
export interface DarSendRecipient {
  name: string;
  email: string;
}

/** GET /dar/saved/:id/send-result: who the last confirmed send of this report went to. */
export interface DarSendResultDto {
  sentAt: string;
  from: string;
  to: string;
  recipient: DarSendRecipient;
  cc: DarSendRecipient[];
}

/** "Report for Oct 13, 2026 sent to Supervisor Sam (sup@…). CC: Cee One." */
export function darSentBanner(
  r: Pick<DarSendResultDto, 'from' | 'to' | 'recipient' | 'cc'>,
): string {
  const head = `Report for ${darEmailRange(r.from, r.to)} sent to ${r.recipient.name} (${r.recipient.email}).`;
  return r.cc.length ? `${head} CC: ${r.cc.map((c) => c.name).join(', ')}.` : head;
}

export function darSentMessage(supervisorName: string, ccCount: number): string {
  const cc = ccCount === 0 ? '' : ccCount === 1 ? ' and 1 CC' : ` and ${ccCount} CC`;
  return `Report sent to ${supervisorName}${cc}.`;
}
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
export const DAR_STATUS_SENT = 'Sent';
export const DAR_STATUS_NOT_SENT = 'Not sent';
/** The last send timed out after it went out: it may or may not have been sent. */
export const DAR_STATUS_UNCONFIRMED = 'Not confirmed';
/** Hover note on the Sent badge: Graph accepted it; delivery isn't confirmed. */
export const DAR_SENT_NOTE = 'Accepted by Microsoft for delivery';
/** "1 recipient" / "3 recipients" */
export const recipientCountLabel = (n: number) => `${n} recipient${n === 1 ? '' : 's'}`;
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
  sent: z.enum(['ALL', 'SENT', 'NOT_SENT']).optional(),
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
  /** Last successful Send (ISO), or null when it was never sent. */
  sentAt: string | null;
  /** Who sent it (user id); always the saver, since saved reports are private. */
  sentBy: string | null;
  /** How many people that send went to (To + CC). */
  sentRecipientCount: number | null;
  /**
   * When the last send could not be confirmed (Graph timeout or dropped connection after the
   * request went out), ISO; null when there is no unconfirmed send after the last confirmed one.
   */
  sendUnknownAt: string | null;
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
/**
 * Range text for the DAR email (no prefix): "Oct 13, 2026" for one day,
 * "Oct 13 to Oct 17, 2026" within a year, "Dec 29, 2026 to Jan 2, 2027" across years.
 */
export function darEmailRange(from: string, to: string): string {
  if (from === to) return formatLongDate(from);
  if (from.slice(0, 4) === to.slice(0, 4))
    return `${formatShortDate(from)} to ${formatLongDate(to)}`;
  return `${formatLongDate(from)} to ${formatLongDate(to)}`;
}
/** An instant in Asia/Manila (UTC+8, no daylight saving): "2026-10-13T09:20:00Z" → "Oct 13, 2026, 5:20 PM". */
export function formatPhDateTime(iso: string): string {
  const t = new Date(iso);
  const h24 = new Date(t.getTime() + 8 * 3_600_000).getUTCHours();
  const min = String(t.getUTCMinutes()).padStart(2, '0');
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${formatLongDate(phDateOf(t))}, ${h12}:${min} ${h24 < 12 ? 'AM' : 'PM'}`;
}
/** "2026-09-30" → "Sep 30" */
export function formatShortDate(d: string): string {
  const [, m, day] = d.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${day}`;
}
/** Range label for lists: "Sep 30 – Oct 2" or "Sep 29". */
export const rangeLabel = (from: string, to: string) =>
  from === to ? formatShortDate(from) : `${formatShortDate(from)} – ${formatShortDate(to)}`;
