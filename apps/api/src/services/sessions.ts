import type { CookieOptions, Request, Response } from 'express';
import type { Types } from 'mongoose';
import type { AppConfig } from '../config.js';
import { SessionModel } from '../models/index.js';
import { newToken, sha256 } from './tokens.js';

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

export async function createSession(
  config: AppConfig,
  userId: Types.ObjectId,
  req: Request,
  res: Response,
  ip: string,
): Promise<void> {
  const token = newToken();
  const now = new Date();
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
