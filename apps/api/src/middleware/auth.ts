import type { Request, Response } from 'express';
import type { PermissionGrid, SystemRole } from '@xc8/shared';
import type { AppConfig } from '../config.js';
import { unauthorized } from '../lib/errors.js';
import { SessionModel, UserModel } from '../models/index.js';
import { clearSessionCookie, cookieName } from '../services/sessions.js';
import { sha256 } from '../services/tokens.js';

const TOUCH_INTERVAL_MS = 15_000;

/**
 * Authenticates the request from the session cookie. The user is re-read on every
 * request, so deactivation and role changes apply immediately (EC-36, TC-A12).
 * Sessions idle longer than SESSION_IDLE_MINUTES are rejected with 401 (AC-01.5).
 */
export async function authenticate(config: AppConfig, req: Request, res: Response): Promise<void> {
  const token: unknown = req.cookies?.[cookieName(config)];
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw unauthorized();
  }
  const session = await SessionModel.findOne({ tokenHash: sha256(token) });
  if (!session) {
    clearSessionCookie(config, res);
    throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_EXPIRED');
  }
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
    await session.deleteOne();
    clearSessionCookie(config, res);
    throw unauthorized('Your session expired. Please sign in again.', 'SESSION_EXPIRED');
  }
  const user = await UserModel.findById(session.userId).select('+passwordHash');
  if (!user || !user.active || !user.passwordHash) {
    await SessionModel.deleteMany({ userId: session.userId });
    clearSessionCookie(config, res);
    throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_EXPIRED');
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    const idleExpiry = now + config.SESSION_IDLE_MINUTES * 60_000;
    await SessionModel.updateOne(
      { _id: session._id },
      {
        $set: {
          lastSeenAt: new Date(now),
          expiresAt: new Date(Math.min(idleExpiry, session.absoluteExpiresAt.getTime())),
        },
      },
    );
  }
  req.auth = { user, sessionId: session._id.toString() };
}

export function currentUser(req: Request) {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}

export function currentRole(req: Request): SystemRole {
  return currentUser(req).systemRole as SystemRole;
}

/** Effective permissions of the signed-in user, loaded by the central gate for this request. */
export function currentPermissions(req: Request): PermissionGrid {
  if (!req.access) throw unauthorized();
  return req.access.permissions;
}
