import type { CookieOptions, Request, Response } from 'express';
import type { Types } from 'mongoose';
import type { AppConfig } from '../config.js';
import { SessionModel } from '../models/index.js';
import { newToken, sha256 } from './tokens.js';
import { now as clockNow } from '../lib/clock.js';

export function cookieName(config: AppConfig): string {
  // The __Host- prefix pins the cookie to this host, path "/", Secure, with no Domain.
  return config.COOKIE_SECURE ? '__Host-xc8_sid' : 'xc8_sid';
}

export function cookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAMESITE,
    path: '/',
    // No maxAge: a browser-session cookie. Server-side expiry enforces the idle timeout.
  };
}

const FAR_FUTURE = new Date('9999-12-31T00:00:00Z');

/** Idle window of a session in ms. */
export function idleMs(config: AppConfig, kind: string | null | undefined): number {
  return kind === 'mobile'
    ? config.MOBILE_SESSION_IDLE_HOURS * 3_600_000
    : config.SESSION_IDLE_MINUTES * 60_000;
}

/**
 * True when the request comes from a web browser. Browsers always attach `Origin` to
 * cross-origin and non-GET requests and `Sec-Fetch-*` metadata to every request; page
 * scripts can't remove these (forbidden headers). A cookie header means a browser too.
 */
export function looksLikeBrowser(req: Request): boolean {
  const h = req.headers;
  return Boolean(
    h.origin ||
    h.cookie ||
    h['sec-fetch-mode'] ||
    h['sec-fetch-site'] ||
    h['sec-fetch-dest'] ||
    h.referer,
  );
}

/** Mobile session: the token goes back in the body (never a cookie); only its hash is stored. */
export async function createMobileSession(
  config: AppConfig,
  userId: Types.ObjectId,
  req: Request,
  ip: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const now = clockNow();
  const expiresAt = new Date(now.getTime() + idleMs(config, 'mobile'));
  await SessionModel.create({
    tokenHash: sha256(token),
    userId,
    kind: 'mobile',
    lastSeenAt: now,
    expiresAt,
    absoluteExpiresAt: config.MOBILE_SESSION_MAX_DAYS
      ? new Date(now.getTime() + config.MOBILE_SESSION_MAX_DAYS * 86_400_000)
      : FAR_FUTURE,
    ip,
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
  });
  return { token, expiresAt };
}

export async function createSession(
  config: AppConfig,
  userId: Types.ObjectId,
  req: Request,
  res: Response,
  ip: string,
): Promise<void> {
  const token = newToken();
  const now = clockNow();
  await SessionModel.create({
    tokenHash: sha256(token),
    userId,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + config.SESSION_IDLE_MINUTES * 60_000),
    absoluteExpiresAt: new Date(now.getTime() + config.SESSION_ABSOLUTE_HOURS * 3_600_000),
    ip,
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
  });
  res.cookie(cookieName(config), token, cookieOptions(config));
}

export function clearSessionCookie(config: AppConfig, res: Response): void {
  res.clearCookie(cookieName(config), cookieOptions(config));
}

/** Ends a user's sessions, optionally keeping one (e.g. the caller's own current session). */
export async function revokeUserSessions(
  userId: Types.ObjectId | string,
  exceptSessionId?: string,
): Promise<void> {
  await SessionModel.deleteMany(
    exceptSessionId ? { userId, _id: { $ne: exceptSessionId } } : { userId },
  );
}
