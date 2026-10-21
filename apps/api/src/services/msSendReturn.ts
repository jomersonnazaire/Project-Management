import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import { now as clockNow } from '../lib/clock.js';
import { HttpError } from '../lib/errors.js';
import { bearerToken } from '../middleware/auth.js';
import { MobileMailStateModel } from '../models/index.js';
import type {
  ActionEmailKind,
  MicrosoftActionEmailOAuthState,
  MicrosoftMailOAuthState,
} from './microsoftOAuthCookie.js';
import { CHALLENGE_RE, CODE_TTL_MS, VERIFIER_RE, s256 } from './microsoftMobile.js';
import { newToken, sha256 } from './tokens.js';

/**
 * Mobile return path for the Microsoft Mail.Send round trip (DAR Send, action emails).
 *
 * The app starts with POST /dar/saved/:id/send/mobile, POST /action-emails/mobile, or a task /
 * project save with `emailReturn: 'mobile'` (bearer token; only a mobile session can
 * authenticate that way), always with its own PKCE challenge. The OAuth state is kept server-side, not in a cookie. After the send,
 * the callback returns to the one fixed app address below with a random one-time code (never a
 * Microsoft token, code or the OAuth state); the app reads the outcome with
 * POST /auth/mobile/mail/confirm, with its own bearer token and the PKCE verifier matching the
 * challenge it sent at the start. The deep link alone never proves a send. The client never
 * sends a return URL.
 */
export const MOBILE_MAIL_RETURN = 'opstrack://auth/mail';
const PENDING_TTL_MS = 10 * 60 * 1000;
/** The one-time result code lives 60 seconds, as the mobile sign-in exchange code. */
export const RESULT_TTL_MS = CODE_TTL_MS;

/** Start body: the app's PKCE challenge (S256). No return URL can be given. */
export const mobileSendSchema = z.strictObject({
  code_challenge: z.string().regex(CHALLENGE_RE),
  code_challenge_method: z.literal('S256'),
});

/** Confirm body: the one-time code from the deep link and the app's PKCE verifier. */
export const mobileMailConfirmSchema = z.strictObject({
  code: z.string().min(20).max(200),
  code_verifier: z.string().regex(VERIFIER_RE),
});

export const MOBILE_SEND_ONLY = new HttpError(
  403,
  'MOBILE_ONLY',
  'This send is only for the OpsTrack mobile app.',
);

/** The pending record's flow (internal). */
export type MobileSendFlow = 'dar' | 'action';

/** The `flow` the app sees in the confirm response for an action email. */
export const ACTION_EMAIL_FLOW: Record<ActionEmailKind, string> = {
  FOLLOW_UP: 'action_email',
  TASK_ASSIGNED: 'task_assigned',
  PROJECT_ADDED: 'project_added',
};

/** True when the (already authenticated) request came from the mobile app's bearer session. */
export function isMobileSend(res: Response): boolean {
  return bearerToken(res.req) !== null;
}

/** Keeps a mobile DAR Send's OAuth state server-side (hashed key, single use, 10 minutes). */
export async function saveMobileDarState(
  data: MicrosoftMailOAuthState,
  codeChallenge: string,
): Promise<void> {
  await saveMobilePending('dar', data, codeChallenge);
}

/** Same for a mobile action email (follow-up, task assigned, added to project). */
export async function saveMobileActionState(
  data: MicrosoftActionEmailOAuthState,
  codeChallenge: string,
): Promise<void> {
  await saveMobilePending('action', data, codeChallenge);
}

async function saveMobilePending(
  flow: MobileSendFlow,
  data: { state: string; userId: string },
  codeChallenge: string,
): Promise<void> {
  const { state, ...rest } = data;
  await MobileMailStateModel.create({
    phase: 'pending',
    keyHash: sha256(state),
    flow,
    userId: new Types.ObjectId(data.userId),
    codeChallenge,
    data: rest,
    expiresAt: new Date(clockNow().getTime() + PENDING_TTL_MS),
  });
}

/**
 * A save that starts an action email from the app (`emailReturn: 'mobile'`): the route calls this
 * right after validating the body, before saving. Bearer only. startActionEmail then keeps the
 * state server-side with this challenge instead of setting the web cookie.
 */
export function useMobileEmailReturn(res: Response, codeChallenge: string): void {
  if (!isMobileSend(res)) throw MOBILE_SEND_ONLY;
  res.locals.mobileEmailChallenge = codeChallenge;
}

export function mobileEmailChallenge(res: Response): string | null {
  const c: unknown = res.locals.mobileEmailChallenge;
  return typeof c === 'string' ? c : null;
}

const str = (v: unknown): v is string => typeof v === 'string';

export type TakenMobileMailState =
  | { flow: 'dar'; data: MicrosoftMailOAuthState; codeChallenge: string }
  | { flow: 'action'; data: MicrosoftActionEmailOAuthState; codeChallenge: string };

const KINDS: ActionEmailKind[] = ['FOLLOW_UP', 'TASK_ASSIGNED', 'PROJECT_ADDED'];

/** Finds and deletes (single use) an unexpired mobile send state for this OAuth state. */
export async function takeMobileMailState(state: string): Promise<TakenMobileMailState | null> {
  if (!state) return null;
  const doc = await MobileMailStateModel.findOneAndDelete({
    phase: 'pending',
    keyHash: sha256(state),
    expiresAt: { $gt: clockNow() },
  }).lean();
  if (!doc) return null;
  const d = (doc.data ?? {}) as Record<string, unknown>;
  if (!str(d.codeVerifier) || !str(d.nonce) || !str(d.userId)) return null;
  const base = { codeVerifier: d.codeVerifier, nonce: d.nonce, userId: d.userId, state };
  const codeChallenge = doc.codeChallenge;
  if (doc.flow === 'dar') {
    if (!str(d.savedReportId)) return null;
    return { flow: 'dar', data: { ...base, savedReportId: d.savedReportId }, codeChallenge };
  }
  if (
    !KINDS.includes(d.kind as ActionEmailKind) ||
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
      kind: d.kind as ActionEmailKind,
      projectId: d.projectId,
      taskId: d.taskId,
      followUpId: d.followUpId,
      recipientIds: d.recipientIds,
    },
    codeChallenge,
  };
}

type ResultValue = string | number;

interface MobileReturn {
  flow: MobileSendFlow;
  userId: string;
  codeChallenge: string;
  /** Ids (and defaults) for the confirm response; `flow` here is the public name. */
  base: Record<string, ResultValue>;
}

/** Marks this callback response as going back to the app (set before running the handler). */
export function returnToMobile(res: Response, ret: MobileReturn): void {
  res.locals.msSendReturn = ret;
}

/**
 * The end of a send: the web page as before, or, when the send started on mobile, the fixed app
 * address with a one-time code for the outcome (`params` are outcome params only). `mobileExtra`
 * (e.g. the recipients count) goes only into the mobile confirm response, never the web URL.
 */
export function sendResultRedirect(
  res: Response,
  webUrl: string,
  params: Record<string, string>,
  mobileExtra: Record<string, ResultValue> = {},
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
    codeChallenge: ret.codeChallenge,
    data: { flow: ret.flow, ...ret.base, ...params, ...mobileExtra },
    expiresAt: new Date(clockNow().getTime() + RESULT_TTL_MS),
  }).then(
    () => res.redirect(`${MOBILE_MAIL_RETURN}?${new URLSearchParams({ code }).toString()}`),
    (err: unknown) => {
      res.req.log?.warn({ err }, 'Mobile send result could not be stored');
      res.redirect(`${MOBILE_MAIL_RETURN}?error=result_unavailable`);
    },
  );
}

function sameChallenge(verifier: string, challenge: string): boolean {
  const a = Buffer.from(s256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The outcome for this one-time code: only for the user who started the send, only with the
 * PKCE verifier for the challenge given at the start (S256, constant-time compare). Single use:
 * the code is spent by any attempt from that user, right or wrong verifier.
 */
export async function confirmMobileMailResult(
  code: string,
  codeVerifier: string,
  userId: Types.ObjectId,
): Promise<Record<string, ResultValue> | null> {
  const doc = await MobileMailStateModel.findOneAndDelete({
    phase: 'result',
    keyHash: sha256(code),
    userId,
    expiresAt: { $gt: clockNow() },
  }).lean();
  if (!doc || !sameChallenge(codeVerifier, doc.codeChallenge)) return null;
  return doc.data as Record<string, ResultValue>;
}
