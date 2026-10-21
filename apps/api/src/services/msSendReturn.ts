import type { Response } from 'express';
import { Types } from 'mongoose';
import { now as clockNow } from '../lib/clock.js';
import { HttpError } from '../lib/errors.js';
import { bearerToken } from '../middleware/auth.js';
import { MobileMailStateModel } from '../models/index.js';
import type { MicrosoftMailOAuthState } from './microsoftOAuthCookie.js';
import { newToken, sha256 } from './tokens.js';

/**
 * Mobile return path for the Microsoft Mail.Send round trip (DAR Send).
 *
 * The app starts with POST /dar/saved/:id/send/mobile (bearer token; only a mobile session can
 * authenticate that way). The OAuth state is kept server-side, not in a cookie. After the send,
 * the callback returns to the one fixed app address below with a random one-time code (never a
 * Microsoft token, code or the OAuth state); the app reads the outcome with
 * POST /auth/mobile/mail/confirm, with its own bearer token. The client never sends a return URL.
 */
export const MOBILE_MAIL_RETURN = 'opstrack://auth/mail';
const PENDING_TTL_MS = 10 * 60 * 1000;
export const RESULT_TTL_MS = 5 * 60 * 1000;

export const MOBILE_SEND_ONLY = new HttpError(
  403,
  'MOBILE_ONLY',
  'This send is only for the OpsTrack mobile app.',
);

export type MobileSendFlow = 'dar';

/** True when the (already authenticated) request came from the mobile app's bearer session. */
export function isMobileSend(res: Response): boolean {
  return bearerToken(res.req) !== null;
}

/** Keeps a mobile DAR Send's OAuth state server-side (hashed key, single use, 10 minutes). */
export async function saveMobileDarState(data: MicrosoftMailOAuthState): Promise<void> {
  const { state, ...rest } = data;
  await MobileMailStateModel.create({
    phase: 'pending',
    keyHash: sha256(state),
    flow: 'dar',
    userId: new Types.ObjectId(data.userId),
    data: rest,
    expiresAt: new Date(clockNow().getTime() + PENDING_TTL_MS),
  });
}

const str = (v: unknown): v is string => typeof v === 'string';

/** Finds and deletes (single use) an unexpired mobile DAR Send state for this OAuth state. */
export async function takeMobileDarState(state: string): Promise<MicrosoftMailOAuthState | null> {
  if (!state) return null;
  const doc = await MobileMailStateModel.findOneAndDelete({
    phase: 'pending',
    flow: 'dar',
    keyHash: sha256(state),
    expiresAt: { $gt: clockNow() },
  }).lean();
  if (!doc) return null;
  const d = (doc.data ?? {}) as Record<string, unknown>;
  if (!str(d.codeVerifier) || !str(d.nonce) || !str(d.userId) || !str(d.savedReportId)) {
    return null;
  }
  return {
    codeVerifier: d.codeVerifier,
    nonce: d.nonce,
    userId: d.userId,
    savedReportId: d.savedReportId,
    state,
  };
}

interface MobileReturn {
  flow: MobileSendFlow;
  userId: string;
  base: Record<string, string>;
}

/** Marks this callback response as going back to the app (set before running the handler). */
export function returnToMobile(res: Response, ret: MobileReturn): void {
  res.locals.msSendReturn = ret;
}

/**
 * The end of a send: the web page as before, or, when the send started on mobile, the fixed app
 * address with a one-time code for the outcome (`params` are outcome params only).
 */
export function sendResultRedirect(
  res: Response,
  webUrl: string,
  params: Record<string, string>,
): void {
  const ret = res.locals.msSendReturn as MobileReturn | undefined;
  if (!ret) {
    res.redirect(webUrl);
    return;
  }
  const code = newToken();
  MobileMailStateModel.create({
    phase: 'result',
    keyHash: sha256(code),
    flow: ret.flow,
    userId: new Types.ObjectId(ret.userId),
    data: { flow: ret.flow, ...ret.base, ...params },
    expiresAt: new Date(clockNow().getTime() + RESULT_TTL_MS),
  }).then(
    () => res.redirect(`${MOBILE_MAIL_RETURN}?${new URLSearchParams({ code }).toString()}`),
    (err: unknown) => {
      res.req.log?.warn({ err }, 'Mobile send result could not be stored');
      res.redirect(`${MOBILE_MAIL_RETURN}?error=result_unavailable`);
    },
  );
}

/** The outcome for this one-time code, only for the user who started the send (single use). */
export async function confirmMobileMailResult(
  code: string,
  userId: Types.ObjectId,
): Promise<Record<string, string> | null> {
  const doc = await MobileMailStateModel.findOneAndDelete({
    phase: 'result',
    keyHash: sha256(code),
    userId,
    expiresAt: { $gt: clockNow() },
  }).lean();
  return doc ? (doc.data as Record<string, string>) : null;
}
