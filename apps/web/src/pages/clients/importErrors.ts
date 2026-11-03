import { CLIENT_IMPORT_FILE_ERROR_CODES, CLIENT_IMPORT_MESSAGES as MSG } from '@xc8/shared';
import { ApiError, NO_LONGER_PERMITTED } from '../../api/client';

/**
 * CR-19 UIE review: which API errors the import UI may show in its own words. Only the known
 * file checks (§9), 413/415, PREVIEW_STALE, 429 (NFR-41) and IMPORT_NOT_CONFIGURED get specific
 * copy (UIE CLIENTS_EXCEL_IMPORT_UI.md); anything else (404, 5xx, network) gets the generic spec
 * line, never raw server text.
 */
export interface ImportProblem {
  code: string;
  message: string;
  /** UIE: stale preview and busy / rate limited are warnings, not errors. */
  tone?: 'warning';
}

const FILE_CODES: readonly string[] = CLIENT_IMPORT_FILE_ERROR_CODES;

function common(e: ApiError): ImportProblem | null {
  if (e.status === 403) return { code: e.code, message: NO_LONGER_PERMITTED };
  // DEF-057: unavailable is a wait state, not the user's fault, so it's amber like the others.
  if (e.code === 'IMPORT_NOT_CONFIGURED')
    return { code: e.code, message: MSG.UI_NOT_CONFIGURED, tone: 'warning' };
  return null;
}

/** Preview and commit errors. */
export function importProblemOf(e: unknown): ImportProblem {
  if (e instanceof ApiError) {
    const known = common(e);
    if (known) return known;
    if (e.status === 413) return { code: 'FILE_TOO_LARGE', message: MSG.FILE_TOO_LARGE };
    if (e.status === 415) return { code: 'UNSUPPORTED_FILE', message: MSG.UNSUPPORTED_FILE };
    if (e.code === 'PREVIEW_STALE')
      return { code: e.code, message: MSG.UI_PREVIEW_STALE, tone: 'warning' };
    // NFR-41: RATE_LIMITED has its own line (Lean, Nov 3); IMPORT_BUSY / other 429s (AC-62.24) say busy.
    if (e.status === 429 && e.code === 'RATE_LIMITED')
      return { code: e.code, message: MSG.RATE_LIMITED, tone: 'warning' };
    if (e.status === 429) return { code: e.code, message: MSG.UI_BUSY, tone: 'warning' };
    if (FILE_CODES.includes(e.code)) return { code: e.code, message: e.message };
  }
  return { code: 'IMPORT_FAILED', message: MSG.IMPORT_FAILED };
}

/** File download errors: 403, 503 (amber) or the given fallback for anything else. */
function downloadErrorOf(e: unknown, fallback: ImportProblem): ImportProblem {
  if (e instanceof ApiError) {
    if (e.status === 403) return { code: e.code, message: NO_LONGER_PERMITTED };
    // NFR-41: the clients export is rate limited (20 per 15 minutes); amber, like the import 429s.
    if (e.status === 429 && e.code === 'RATE_LIMITED')
      return { code: e.code, message: MSG.EXPORT_RATE_LIMITED, tone: 'warning' };
    // Nothing is saved by a download, so UIE's "Nothing was saved." is left off here.
    // DEF-057: amber, like the other "wait or re-run" states.
    if (e.code === 'IMPORT_NOT_CONFIGURED')
      return { code: e.code, message: MSG.UI_NOT_CONFIGURED_TEMPLATE, tone: 'warning' };
  }
  return fallback;
}

/** Download template errors (the modal link). */
export const templateErrorOf = (e: unknown): ImportProblem =>
  downloadErrorOf(e, { code: 'TEMPLATE_FAILED', message: MSG.TEMPLATE_FAILED });

/** Download clients (.xlsx) errors (Excel menu). */
export const exportErrorOf = (e: unknown): ImportProblem =>
  downloadErrorOf(e, { code: 'EXPORT_FAILED', message: MSG.EXPORT_FAILED });
