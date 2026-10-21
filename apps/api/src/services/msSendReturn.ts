import type { Response } from 'express';
import type { AppConfig } from '../config.js';
import { now as clockNow } from '../lib/clock.js';
import { bearerToken } from '../middleware/auth.js';
import { MobileMailStateModel } from '../models/index.js';
import {
  setMicrosoftActionEmailCookie,
  setMicrosoftMailOAuthCookie,
  type MicrosoftActionEmailOAuthState,
  type MicrosoftMailOAuthState,
} from './microsoftOAuthCookie.js';
import { sha256 } from './tokens.js';

/**
 * Mobile return path for the Microsoft Mail.Send round trip (DAR Send, action emails).
 *
 * The client never sends a return URL. A send started with the mobile bearer token (only a
 * mobile session can authenticate that way) keeps its state server-side and comes back to the
 * one fixed app address below; a send started with the web cookie works exactly as before.
 * Only outcome params go into the return URL, never a token, code or state.
 */
export const MOBILE_SEND_RETURN = 'opstrack://ms/send-result';
const TTL_MS = 10 * 60 * 1000;

export type MobileSendFlow = 'dar' | 'action';

/** True when the (already authenticated) request came from the mobile app's bearer session. */
export function isMobileSend(res: Response): boolean {
  return bearerToken(res.req) !== null;
}

/** Keeps a DAR Send's OAuth state: cookie for web, server-side for mobile. */
export async function storeDarMailState(
  config: AppConfig,
  res: Response,
  data: MicrosoftMailOAuthState,
): Promise<void> {
  if (isMobileSend(res)) return saveMobile('dar', data);
  setMicrosoftMailOAuthCookie(config, res, data);
}

/** Keeps an action email's OAuth state: cookie for web, server-side for mobile. */
export async function storeActionMailState(
  config: AppConfig,
  res: Response,
  data: MicrosoftActionEmailOAuthState,
): Promise<void> {
  if (isMobileSend(res)) return saveMobile('action', data);
  setMicrosoftActionEmailCookie(config, res, data);
}

async function saveMobile(flow: MobileSendFlow, data: { state: string }): Promise<void> {
  const { state, ...rest } = data;
  await MobileMailStateModel.create({
    keyHash: sha256(state),
    flow,
    data: rest,
    expiresAt: new Date(clockNow().getTime() + TTL_MS),
  });
}

export type TakenMobileMailState =
  | { flow: 'dar'; data: MicrosoftMailOAuthState }
  | { flow: 'action'; data: MicrosoftActionEmailOAuthState };

const str = (v: unknown): v is string => typeof v === 'string';

/** Finds and deletes (single use) an unexpired mobile send state for this OAuth state. */
export async function takeMobileMailState(state: string): Promise<TakenMobileMailState | null> {
  if (!state) return null;
  const doc = await MobileMailStateModel.findOneAndDelete({
    keyHash: sha256(state),
    expiresAt: { $gt: clockNow() },
  }).lean();
  if (!doc) return null;
  const d = (doc.data ?? {}) as Record<string, unknown>;
  if (!str(d.codeVerifier) || !str(d.nonce) || !str(d.userId)) return null;
  const base = { codeVerifier: d.codeVerifier, nonce: d.nonce, userId: d.userId, state };
  if (doc.flow === 'dar') {
    if (!str(d.savedReportId)) return null;
    return { flow: 'dar', data: { ...base, savedReportId: d.savedReportId } };
  }
  if (
    (d.kind !== 'FOLLOW_UP' && d.kind !== 'TASK_ASSIGNED' && d.kind !== 'PROJECT_ADDED') ||
    !str(d.projectId) ||
    !str(d.taskId) ||
    !str(d.followUpId) ||
    !Array.isArray(d.recipientIds) ||
    !d.recipientIds.every(str)
  ) {
    return null;
  }
  return {
    flow: 'action',
    data: {
      ...base,
      kind: d.kind,
      projectId: d.projectId,
      taskId: d.taskId,
      followUpId: d.followUpId,
      recipientIds: d.recipientIds,
    },
  };
}

/** Marks this callback response as going back to the app, with the item's ids as base params. */
export function returnToMobile(res: Response, base: Record<string, string>): void {
  res.locals.msSendReturn = base;
}

/**
 * The end of a send: the web page as before, or the fixed app address when the send started on
 * mobile. `params` are outcome params only (sent / send_error / email / email_error).
 */
export function sendResultRedirect(
  res: Response,
  webUrl: string,
  params: Record<string, string>,
): void {
  const base = res.locals.msSendReturn as Record<string, string> | undefined;
  if (!base) {
    res.redirect(webUrl);
    return;
  }
  const q = new URLSearchParams({ ...base, ...params });
  res.redirect(`${MOBILE_SEND_RETURN}?${q.toString()}`);
}
