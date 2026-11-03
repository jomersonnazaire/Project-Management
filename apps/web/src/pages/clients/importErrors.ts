import { CLIENT_IMPORT_FILE_ERROR_CODES, CLIENT_IMPORT_MESSAGES as MSG } from '@xc8/shared';
import { ApiError, NO_LONGER_PERMITTED } from '../../api/client';

/**
 * CR-19 UIE review: which API errors the import UI may show in its own words. Only the known
 * file checks (§9), 413/415, PREVIEW_STALE and IMPORT_NOT_CONFIGURED get specific copy; anything
 * else (404, 5xx, network) gets the generic spec line, never raw server text.
 */
export interface ImportProblem {
  code: string;
  message: string;
}

const FILE_CODES: readonly string[] = CLIENT_IMPORT_FILE_ERROR_CODES;

function common(e: ApiError): ImportProblem | null {
  if (e.status === 403) return { code: e.code, message: NO_LONGER_PERMITTED };
  if (e.code === 'IMPORT_NOT_CONFIGURED')
    return { code: e.code, message: MSG.IMPORT_NOT_CONFIGURED };
  return null;
}

/** Preview and commit errors. */
export function importProblemOf(e: unknown): ImportProblem {
  if (e instanceof ApiError) {
    const known = common(e);
    if (known) return known;
    if (e.status === 413) return { code: 'FILE_TOO_LARGE', message: MSG.FILE_TOO_LARGE };
    if (e.status === 415) return { code: 'UNSUPPORTED_FILE', message: MSG.UNSUPPORTED_FILE };
    if (e.code === 'PREVIEW_STALE') return { code: e.code, message: MSG.PREVIEW_STALE };
    if (FILE_CODES.includes(e.code)) return { code: e.code, message: e.message };
  }
  return { code: 'IMPORT_FAILED', message: MSG.IMPORT_FAILED };
}

/** Download template errors (Excel menu and the modal link). */
export function templateErrorOf(e: unknown): string {
  if (e instanceof ApiError) {
    const known = common(e);
    if (known) return known.message;
  }
  return MSG.TEMPLATE_FAILED;
}
