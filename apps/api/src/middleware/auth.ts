import type { Request, Response } from 'express';
import type { PermissionGrid, SystemRole } from '@xc8/shared';
import type { AppConfig } from '../config.js';
import { now as clockNow } from '../lib/clock.js';
import { unauthorized } from '../lib/errors.js';
import { SessionModel, UserModel } from '../models/index.js';
import { clearSessionCookie, cookieName, idleMs, looksLikeBrowser } from '../services/sessions.js';
import { sha256 } from '../services/tokens.js';

const TOUCH_INTERVAL_MS = 15_000;

/**
 * Authenticates the request from the session cookie. The user is re-read on every
 * request, so deactivation and role changes apply immediately (EC-36, TC-A12).
 * Sessions idle longer than SESSION_IDLE_MINUTES are rejected with 401 (AC-01.5).
 */
export function bearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

export async function authenticate(config: AppConfig, req: Request, res: Response): Promise<void> {
  // Mobile app: bearer token, only accepted outside a browser (a browser can't opt in).
  const bearer = bearerToken(req);
  const kind = bearer !== null ? 'mobile' : 'web';
  if (bearer !== null && looksLikeBrowser(req)) throw unauthorized();
  const token: unknown = bearer ?? req.cookies?.[cookieName(config)];
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw unauthorized();
  }
  const found = await SessionModel.findOne({ tokenHash: sha256(token) });
  // A mobile token never works as a cookie and a web cookie never works as a bearer.
  const session = found && (found.kind ?? 'web') === kind ? found : null;
  if (!session) {
    clearSessionCookie(config, res);
    throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_EXPIRED');
  }
  const now = clockNow().getTime();
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
    const idleExpiry = now + idleMs(config, session.kind);
    await SessionModel.updateOne(
      { _id: session._id },
      {
        $set: {
          lastSeenAt: clockNow(),
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
