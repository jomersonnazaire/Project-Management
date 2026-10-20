import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config.js';
import { oauthStateCookieSecret } from '../config.js';
import { cookieOptions } from './sessions.js';

export const MS_OAUTH_COOKIE = 'xc8_ms_oauth';
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
