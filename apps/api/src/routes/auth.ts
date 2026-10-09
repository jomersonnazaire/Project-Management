import { Router, type RequestHandler } from 'express';
import {
  changePasswordSchema,
  inviteTokenSchema,
  loginSchema,
  setupPasswordSchema,
} from '@xc8/shared';
import type { AppConfig } from '../config.js';
import { HttpError, badRequest, unauthorized } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { clientIp } from '../middleware/clientIp.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { SessionModel, UserModel } from '../models/index.js';
import { audit } from '../services/audit.js';
import { toUserDto } from '../services/dto.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../services/passwords.js';
import {
  clearSessionCookie,
  cookieName,
  createSession,
  revokeUserSessions,
} from '../services/sessions.js';
import { sha256 } from '../services/tokens.js';

const INVALID_CREDENTIALS = 'Email or password is incorrect.';

/**
 * Auth routes. Every lookup is against the `users` collection only, so a client contact's
 * email behaves exactly like an unknown email (FR-AUTH-08, AC-01.6).
 */
export function authRouter(config: AppConfig, authLimiter: RequestHandler) {
  const router = Router();

  router.post('/login', authLimiter, async (req, res) => {
    const { email, password } = parseBody(loginSchema, req);
    const user = await UserModel.findOne({ email }).select('+passwordHash');

    if (!user || !user.passwordHash) {
      await burnPasswordCheck(password);
      throw unauthorized(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      // Silent lockout (AC-01.3): a locked account answers exactly like a wrong password,
      // even when the correct password is entered, so the lock can't be used to confirm
      // that an email belongs to a real account.
      await burnPasswordCheck(password);
      throw unauthorized(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      // Atomic increment so parallel attempts can't slip past the threshold.
      const counted = await UserModel.findOneAndUpdate(
        { _id: user._id },
        { $inc: { failedLogins: 1 } },
        { new: true },
      );
      const failed = counted?.failedLogins ?? 1;
      if (failed >= config.LOCKOUT_THRESHOLD) {
        const lockedUntil = new Date(now.getTime() + config.LOCKOUT_MINUTES * 60_000);
        await UserModel.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil } });
        await audit({
          actorId: null,
          entityType: 'user',
          entityId: user._id,
          action: 'account_locked',
          changes: [{ field: 'lockedUntil', old: null, new: lockedUntil }],
        });
        req.log?.warn({ userId: user._id.toString() }, 'Account locked after failed sign-ins');
      }
      throw unauthorized(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    if (!user.active) {
      // Checked after the password so that the response doesn't reveal account state
      // to someone who doesn't know the password (AC-01.4).
      throw new HttpError(
        403,
        'ACCOUNT_DEACTIVATED',
        'This account is deactivated. Contact your administrator.',
      );
    }

    await UserModel.updateOne(
      { _id: user._id },
      { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } },
    );
    await createSession(
      config,
      user._id,
      req,
      res,
      clientIp(req, { trustedHops: config.TRUST_PROXY_HOPS, edgeSecret: config.EDGE_PROXY_SECRET }),
    );
    user.lastLoginAt = now;
    res.json({ user: toUserDto(user) });
  });

  router.post('/logout', async (req, res) => {
    const token: unknown = req.cookies?.[cookieName(config)];
    if (typeof token === 'string' && token.length <= 200) {
      await SessionModel.deleteOne({ tokenHash: sha256(token) });
    }
    clearSessionCookie(config, res);
    res.status(204).end();
  });

  router.get('/me', requireAuth(config), (req, res) => {
    res.json({ user: toUserDto(currentUser(req)) });
  });

  /**
   * Checks a first-time setup (invite) or reset link so the UI can greet the user.
   * POST with the token in the JSON body so it never appears in a URL path, where platform
   * HTTP logs and proxies would record it (FR-AUTH-04/05, QA review R-2). Read-only.
   */
  router.post('/invite/verify', authLimiter, async (req, res) => {
    const parsed = inviteTokenSchema.safeParse(req.body);
    // Malformed tokens get the same answer as unknown, used or expired ones (AC-02.6).
    if (!parsed.success) throw invalidLink();
    const user = await findByInviteToken(parsed.data.token);
    const invitedBy = user.invite?.invitedBy
      ? await UserModel.findById(user.invite.invitedBy).select('name').lean()
      : null;
    res.json({
      name: user.name,
      email: user.email,
      invitedByName: invitedBy?.name ?? null,
      purpose: user.invite?.purpose ?? 'INVITE',
    });
  });

  /** First-time password setup via invite token (FR-AUTH-04, AC-02.2). Signs the user in. */
  router.post('/setup-password', authLimiter, async (req, res) => {
    const { token, password } = parseBody(setupPasswordSchema, req);
    const user = await findByInviteToken(token);
    const passwordHash = await hashPassword(password);
    // Consume the token atomically so it can only be used once.
    const updated = await UserModel.findOneAndUpdate(
      { _id: user._id, 'invite.tokenHash': sha256(token), active: true },
      {
        $set: {
          passwordHash,
          mustChangePassword: false,
          failedLogins: 0,
          lockedUntil: null,
          invite: null,
          lastLoginAt: new Date(),
        },
      },
      { new: true },
    ).select('+passwordHash');
    if (!updated) throw invalidLink();
    await revokeUserSessions(updated._id);
    await audit({
      actorId: updated._id,
      entityType: 'user',
      entityId: updated._id,
      action: user.invite?.purpose === 'RESET' ? 'password_reset' : 'password_set',
    });
    await createSession(
      config,
      updated._id,
      req,
      res,
      clientIp(req, { trustedHops: config.TRUST_PROXY_HOPS, edgeSecret: config.EDGE_PROXY_SECRET }),
    );
    res.json({ user: toUserDto(updated) });
  });

  router.post('/change-password', requireAuth(config), async (req, res) => {
    const { currentPassword, newPassword } = parseBody(changePasswordSchema, req);
    const me = await UserModel.findById(currentUser(req)._id).select('+passwordHash');
    if (!me?.passwordHash || !(await verifyPassword(me.passwordHash, currentPassword))) {
      throw badRequest('Current password is incorrect.', undefined, 'INVALID_CREDENTIALS');
    }
    me.passwordHash = await hashPassword(newPassword);
    me.mustChangePassword = false;
    await me.save();
    // Sign out other sessions; keep the current one.
    await SessionModel.deleteMany({ userId: me._id, _id: { $ne: req.auth!.sessionId } });
    await audit({
      actorId: me._id,
      entityType: 'user',
      entityId: me._id,
      action: 'password_changed',
    });
    res.status(204).end();
  });

  return router;
}

const LINK_EXPIRED_MESSAGE = 'This link has expired. Ask an Admin for a new one.';

function invalidLink() {
  // Same message for unknown, used, expired and replaced links (AC-02.6), so nothing leaks.
  return badRequest(LINK_EXPIRED_MESSAGE, undefined, 'INVALID_TOKEN');
}

async function findByInviteToken(token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw invalidLink();
  const user = await UserModel.findOne({ 'invite.tokenHash': sha256(token) }).select('+invite');
  if (!user || !user.active || !user.invite || user.invite.expiresAt <= new Date()) {
    throw invalidLink();
  }
  return user;
}
