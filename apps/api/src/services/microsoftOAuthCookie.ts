import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config.js';
import { oauthStateCookieSecret } from '../config.js';
import { cookieOptions } from './sessions.js';

export const MS_OAUTH_COOKIE = 'xc8_ms_oauth';
export const MS_MAIL_COOKIE = 'xc8_ms_mail';
const TTL_MS = 10 * 60 * 1000;

export interface MicrosoftOAuthState {
  codeVerifier: string;
  state: string;
  nonce: string;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function setMicrosoftOAuthCookie(
  config: AppConfig,
  res: Response,
  data: MicrosoftOAuthState,
): void {
  const exp = Date.now() + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ ...data, exp })).toString('base64url');
  const sig = sign(oauthStateCookieSecret(config), payload);
  const opts: CookieOptions = { ...cookieOptions(config), maxAge: TTL_MS, sameSite: 'lax' };
  res.cookie(MS_OAUTH_COOKIE, `${payload}.${sig}`, opts);
}

export function readMicrosoftOAuthCookie(
  config: AppConfig,
  raw: unknown,
): MicrosoftOAuthState | null {
  if (typeof raw !== 'string' || !raw.includes('.')) return null;
  const i = raw.lastIndexOf('.');
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = sign(oauthStateCookieSecret(config), payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let parsed: { codeVerifier?: string; state?: string; nonce?: string; exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    return null;
  }
  if (
    typeof parsed.codeVerifier !== 'string' ||
    typeof parsed.state !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    typeof parsed.exp !== 'number' ||
    parsed.exp < Date.now()
  ) {
    return null;
  }
  return {
    codeVerifier: parsed.codeVerifier,
    state: parsed.state,
    nonce: parsed.nonce,
  };
}

export function clearMicrosoftOAuthCookie(config: AppConfig, res: Response): void {
  res.clearCookie(MS_OAUTH_COOKIE, cookieOptions(config));
}

export interface MicrosoftMailOAuthState extends MicrosoftOAuthState {
  userId: string;
  savedReportId: string;
}

export function setMicrosoftMailOAuthCookie(
  config: AppConfig,
  res: Response,
  data: MicrosoftMailOAuthState,
): void {
  const exp = Date.now() + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ ...data, exp })).toString('base64url');
  const sig = sign(oauthStateCookieSecret(config), payload);
  const opts: CookieOptions = { ...cookieOptions(config), maxAge: TTL_MS, sameSite: 'lax' };
  res.cookie(MS_MAIL_COOKIE, `${payload}.${sig}`, opts);
}

export function readMicrosoftMailOAuthCookie(
  config: AppConfig,
  raw: unknown,
): MicrosoftMailOAuthState | null {
  if (typeof raw !== 'string' || !raw.includes('.')) return null;
  const i = raw.lastIndexOf('.');
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = sign(oauthStateCookieSecret(config), payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let parsed: {
    codeVerifier?: string;
    state?: string;
    nonce?: string;
    userId?: string;
    savedReportId?: string;
    exp?: number;
  };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    return null;
  }
  if (
    typeof parsed.codeVerifier !== 'string' ||
    typeof parsed.state !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    typeof parsed.userId !== 'string' ||
    typeof parsed.savedReportId !== 'string' ||
    typeof parsed.exp !== 'number' ||
    parsed.exp < Date.now()
  ) {
    return null;
  }
  return {
    codeVerifier: parsed.codeVerifier,
    state: parsed.state,
    nonce: parsed.nonce,
    userId: parsed.userId,
    savedReportId: parsed.savedReportId,
  };
}

export function clearMicrosoftMailOAuthCookie(config: AppConfig, res: Response): void {
  res.clearCookie(MS_MAIL_COOKIE, cookieOptions(config));
}

/**
 * Each Send's OAuth state works once (replay guard): the callback consumes it before doing
 * anything else, so a replayed callback with the same cookie and state sends nothing. Kept in
 * process memory for the cookie's lifetime (the API runs as one instance, TD-01).
 */
const usedMailStates = new Map<string, number>();

export function consumeMicrosoftMailState(state: string): boolean {
  const now = Date.now();
  for (const [s, exp] of usedMailStates) if (exp < now) usedMailStates.delete(s);
  if (usedMailStates.has(state)) return false;
  usedMailStates.set(state, now + TTL_MS);
  return true;
}

// ---------- Action emails: same signed, 10-minute state cookie as DAR Send, own name ----------
export const MS_ACTION_EMAIL_COOKIE = 'xc8_ms_act';

export type ActionEmailKind = 'FOLLOW_UP' | 'TASK_ASSIGNED' | 'PROJECT_ADDED';

export interface MicrosoftActionEmailOAuthState extends MicrosoftOAuthState {
  userId: string;
  kind: ActionEmailKind;
  projectId: string;
  /** Empty for PROJECT_ADDED. */
  taskId: string;
  /** FOLLOW_UP only; empty otherwise. */
  followUpId: string;
  /** Who gets an email (user ids, checked again when sending). */
  recipientIds: string[];
}

export function setMicrosoftActionEmailCookie(
  config: AppConfig,
  res: Response,
  data: MicrosoftActionEmailOAuthState,
): void {
  const exp = Date.now() + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ ...data, exp })).toString('base64url');
  const sig = sign(oauthStateCookieSecret(config), payload);
  const opts: CookieOptions = { ...cookieOptions(config), maxAge: TTL_MS, sameSite: 'lax' };
  res.cookie(MS_ACTION_EMAIL_COOKIE, `${payload}.${sig}`, opts);
}

const ACTION_KINDS: readonly string[] = ['FOLLOW_UP', 'TASK_ASSIGNED', 'PROJECT_ADDED'];

export function readMicrosoftActionEmailCookie(
  config: AppConfig,
  raw: unknown,
): MicrosoftActionEmailOAuthState | null {
  if (typeof raw !== 'string' || !raw.includes('.')) return null;
  const i = raw.lastIndexOf('.');
  const payload = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = sign(oauthStateCookieSecret(config), payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    return null;
  }
  const keys = [
    'codeVerifier',
    'state',
    'nonce',
    'userId',
    'kind',
    'projectId',
    'taskId',
    'followUpId',
  ] as const;
  if (
    keys.some((k) => typeof parsed[k] !== 'string') ||
    !ACTION_KINDS.includes(parsed.kind as string) ||
    !Array.isArray(parsed.recipientIds) ||
    parsed.recipientIds.some((r) => typeof r !== 'string') ||
    typeof parsed.exp !== 'number' ||
    parsed.exp < Date.now()
  ) {
    return null;
  }
  const s = parsed as Record<(typeof keys)[number], string>;
  return {
    codeVerifier: s.codeVerifier,
    state: s.state,
    nonce: s.nonce,
    userId: s.userId,
    kind: s.kind as ActionEmailKind,
    projectId: s.projectId,
    taskId: s.taskId,
    followUpId: s.followUpId,
    recipientIds: parsed.recipientIds as string[],
  };
}

export function clearMicrosoftActionEmailCookie(config: AppConfig, res: Response): void {
  res.clearCookie(MS_ACTION_EMAIL_COOKIE, cookieOptions(config));
}
