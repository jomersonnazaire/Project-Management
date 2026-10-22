import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import {
  changePasswordSchema,
  inviteTokenSchema,
  loginSchema,
  myPermissionsSummary,
  setupPasswordSchema,
  type EmailStatusDto,
  type SystemRole,
} from '@xc8/shared';
import { AUTHENTICATED, PUBLIC, type RouteRegistry } from '../access/registry.js';
import type { AppConfig } from '../config.js';
import { HttpError, badRequest, unauthorized } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { now as clockNow } from '../lib/clock.js';
import { clientIp } from '../middleware/clientIp.js';
import { bearerToken, currentPermissions, currentRole, currentUser } from '../middleware/auth.js';
import { MobileAuthCodeModel, SessionModel, UserModel } from '../models/index.js';
import { buildMicrosoftLoginUrl, exchangeMicrosoftCode } from '../services/microsoftAuth.js';
import { handleMicrosoftDarMailCallback } from '../services/microsoftDarCallback.js';
import { handleMicrosoftActionEmailCallback } from '../services/actionEmail.js';
import {
  MS_ACTION_EMAIL_COOKIE,
  MS_MAIL_COOKIE,
  MS_OAUTH_COOKIE,
  clearMicrosoftActionEmailCookie,
  clearMicrosoftMailOAuthCookie,
  clearMicrosoftOAuthCookie,
  readMicrosoftActionEmailCookie,
  readMicrosoftMailOAuthCookie,
  readMicrosoftOAuthCookie,
  setMicrosoftOAuthCookie,
} from '../services/microsoftOAuthCookie.js';
import {
  CHALLENGE_RE,
  CODE_TTL_MS,
  PENDING_TTL_MS,
  VERIFIER_RE,
  appRedirect,
  s256,
} from '../services/microsoftMobile.js';
import { msSignInErrorCode, resolveMicrosoftSignIn } from '../services/microsoftSignIn.js';
import {
  confirmMobileMailResult,
  mobileMailConfirmSchema,
  ACTION_EMAIL_FLOW,
  returnToMobile,
  takeMobileMailState,
} from '../services/msSendReturn.js';
import { permissionsFor } from '../services/accessRules.js';
import { audit } from '../services/audit.js';
import { toUserDto } from '../services/dto.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../services/passwords.js';
import {
  clearSessionCookie,
  cookieName,
  createMobileSession,
  createSession,
  idleMs,
  looksLikeBrowser,
  revokeUserSessions,
} from '../services/sessions.js';
import { newToken, sha256 } from '../services/tokens.js';

const INVALID_CREDENTIALS = 'Email or password is incorrect.';
const MOBILE_ONLY = new HttpError(
  403,
  'MOBILE_ONLY',
  'This sign-in is only for the OpsTrack mobile app.',
);

/**
 * Auth routes. Every lookup is against the `users` collection only, so a client contact's
 * email behaves exactly like an unknown email (FR-AUTH-08, AC-01.6).
 */
export function authRouter(
  config: AppConfig,
  registry: RouteRegistry,
  authLimiter: RequestHandler,
) {
  const router = registry.router('/auth');

  /** Shared credential checks for web and mobile sign-in (AC-01.2–AC-01.4). */
  async function checkCredentials(req: Request) {
    const { email, password } = parseBody(loginSchema, req);
    const user = await UserModel.findOne({ email }).select('+passwordHash');

    if (!user || !user.passwordHash) {
      await burnPasswordCheck(password);
      throw unauthorized(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    const now = clockNow();
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
    user.lastLoginAt = now;
    return user;
  }

  const ipOf = (req: Request) =>
    clientIp(req, { trustedHops: config.TRUST_PROXY_HOPS, edgeSecret: config.EDGE_PROXY_SECRET });

  const msFailureRedirect = (res: Response, code = 'ms_signin_failed') => {
    res.redirect(`${config.WEB_APP_URL}/login?error=${code}`);
  };

  router.get('/providers', PUBLIC, (_req, res) => {
    res.json({ microsoft: config.msEnabled });
  });

  router.get('/mobile/microsoft/login', PUBLIC, authLimiter, async (req, res) => {
    const challenge = typeof req.query.code_challenge === 'string' ? req.query.code_challenge : '';
    const method =
      typeof req.query.code_challenge_method === 'string' ? req.query.code_challenge_method : '';
    if (!config.msEnabled || !CHALLENGE_RE.test(challenge) || method !== 'S256') {
      res.redirect(appRedirect({ error: 'ms_signin_failed' }));
      return;
    }
    try {
      const login = await buildMicrosoftLoginUrl(config);
      const now = clockNow();
      await MobileAuthCodeModel.create({
        phase: 'pending',
        keyHash: sha256(login.state),
        codeChallenge: challenge,
        msCodeVerifier: login.codeVerifier,
        nonce: login.nonce,
        expiresAt: new Date(now.getTime() + PENDING_TTL_MS),
      });
      res.redirect(login.url);
    } catch (err) {
      req.log?.warn({ err }, 'Microsoft mobile login redirect failed');
      res.redirect(appRedirect({ error: 'ms_signin_failed' }));
    }
  });

  router.get('/microsoft/login', PUBLIC, authLimiter, async (req, res) => {
    if (!config.msEnabled) {
      msFailureRedirect(res);
      return;
    }
    try {
      const login = await buildMicrosoftLoginUrl(config);
      setMicrosoftOAuthCookie(config, res, {
        codeVerifier: login.codeVerifier,
        state: login.state,
        nonce: login.nonce,
      });
      res.redirect(login.url);
    } catch (err) {
      req.log?.warn({ err }, 'Microsoft login redirect failed');
      msFailureRedirect(res);
    }
  });

  // The DAR Send leg of the callback (a valid signed mail cookie for this state) is counted by
  // Send's own per-user limiter when it starts, so it doesn't use the sign-in bucket (D5).
  const callbackLimiter: RequestHandler = (req, res, next) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const mail = readMicrosoftMailOAuthCookie(config, req.cookies?.[MS_MAIL_COOKIE]);
    if (state && mail && mail.state === state) return next();
    // Same for an action email: counted by its own limiter when it started.
    const act = readMicrosoftActionEmailCookie(config, req.cookies?.[MS_ACTION_EMAIL_COOKIE]);
    if (state && act && act.state === state) return next();
    return authLimiter(req, res, next);
  };

  router.get('/microsoft/callback', PUBLIC, callbackLimiter, async (req, res) => {
    if (!config.msEnabled) {
      msFailureRedirect(res);
      return;
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const msError = typeof req.query.error === 'string' ? req.query.error : '';
    const errorDescription =
      typeof req.query.error_description === 'string' ? req.query.error_description : '';
    const oauth = readMicrosoftOAuthCookie(config, req.cookies?.[MS_OAUTH_COOKIE]);
    const mail = readMicrosoftMailOAuthCookie(config, req.cookies?.[MS_MAIL_COOKIE]);

    if (code && state && oauth && oauth.state === state) {
      clearMicrosoftOAuthCookie(config, res);
      try {
        const claims = await exchangeMicrosoftCode(config, code, oauth.codeVerifier, oauth.nonce);
        const result = await resolveMicrosoftSignIn(config, claims);
        if (!result.ok) {
          req.log?.warn(
            { reason: result.reason, tid: claims.tid, oid: claims.oid },
            'Microsoft sign-in refused',
          );
          msFailureRedirect(res, msSignInErrorCode(result.reason));
          return;
        }
        const now = clockNow();
        await UserModel.updateOne(
          { _id: result.user._id },
          { $set: { lastLoginAt: now, failedLogins: 0, lockedUntil: null } },
        );
        await createSession(config, result.user._id, req, res, ipOf(req));
        res.redirect(config.WEB_APP_URL);
      } catch (err) {
        if (err instanceof Error && err.message === 'Missing email') {
          req.log?.warn('Microsoft callback refused: no email claim');
          msFailureRedirect(res, 'ms_no_email');
          return;
        }
        req.log?.warn({ err }, 'Microsoft callback failed');
        msFailureRedirect(res);
      }
      return;
    }

    if (state && mail && mail.state === state) {
      clearMicrosoftMailOAuthCookie(config, res);
      await handleMicrosoftDarMailCallback(config, req, res, mail, code, msError, errorDescription);
      return;
    }

    const act = readMicrosoftActionEmailCookie(config, req.cookies?.[MS_ACTION_EMAIL_COOKIE]);
    if (state && act && act.state === state) {
      clearMicrosoftActionEmailCookie(config, res);
      await handleMicrosoftActionEmailCallback(
        config,
        req,
        res,
        act,
        code,
        msError,
        errorDescription,
      );
      return;
    }

    // A send started from the mobile app (DAR Send, action email): state kept server-side
    // (single use); the result goes back to the fixed opstrack://auth/mail address with a
    // one-time code. Same handlers, so the state/nonce checks still hold.
    const mobileMail = await takeMobileMailState(state);
    if (mobileMail?.flow === 'dar') {
      const d = mobileMail.data;
      returnToMobile(res, {
        flow: 'dar',
        userId: d.userId,
        codeChallenge: mobileMail.codeChallenge,
        base: { report: d.savedReportId, recipients: 0 },
      });
      await handleMicrosoftDarMailCallback(config, req, res, d, code, msError, errorDescription);
      return;
    }
    if (mobileMail?.flow === 'action') {
      const d = mobileMail.data;
      returnToMobile(res, {
        flow: 'action',
        userId: d.userId,
        codeChallenge: mobileMail.codeChallenge,
        base: {
          flow: ACTION_EMAIL_FLOW[d.kind],
          project: d.projectId,
          ...(d.taskId ? { task: d.taskId } : {}),
          ...(d.followUpId ? { followUp: d.followUpId } : {}),
          recipients: 0,
        },
      });
      await handleMicrosoftActionEmailCallback(
        config,
        req,
        res,
        d,
        code,
        msError,
        errorDescription,
      );
      return;
    }

    if (state) {
      const now = clockNow();
      const pending = await MobileAuthCodeModel.findOneAndDelete({
        phase: 'pending',
        keyHash: sha256(state),
        expiresAt: { $gt: now },
      });
      if (pending) {
        if (msError) {
          res.redirect(appRedirect({ error: 'cancelled' }));
          return;
        }
        if (!code) {
          res.redirect(appRedirect({ error: 'ms_signin_failed' }));
          return;
        }
        try {
          const claims = await exchangeMicrosoftCode(
            config,
            code,
            pending.msCodeVerifier!,
            pending.nonce!,
          );
          const result = await resolveMicrosoftSignIn(config, claims);
          if (!result.ok) {
            req.log?.warn(
              { reason: result.reason, tid: claims.tid, oid: claims.oid },
              'Microsoft mobile sign-in refused',
            );
            res.redirect(appRedirect({ error: msSignInErrorCode(result.reason) }));
            return;
          }
          const oneTime = newToken();
          await MobileAuthCodeModel.create({
            phase: 'code',
            keyHash: sha256(oneTime),
            codeChallenge: pending.codeChallenge,
            userId: result.user._id,
            expiresAt: new Date(now.getTime() + CODE_TTL_MS),
          });
          res.redirect(appRedirect({ code: oneTime }));
        } catch (err) {
          if (err instanceof Error && err.message === 'Missing email') {
            res.redirect(appRedirect({ error: 'ms_no_email' }));
            return;
          }
          req.log?.warn({ err }, 'Microsoft mobile callback failed');
          res.redirect(appRedirect({ error: 'ms_signin_failed' }));
        }
        return;
      }
    }

    if (oauth) clearMicrosoftOAuthCookie(config, res);
    if (mail) clearMicrosoftMailOAuthCookie(config, res);
    if (act) clearMicrosoftActionEmailCookie(config, res);
    req.log?.warn('Microsoft callback rejected: bad or missing OAuth state');
    msFailureRedirect(res);
  });

  /**
   * Mobile DAR Send: the app reads the outcome of its send with the one-time code from the
   * opstrack://auth/mail deep link and its PKCE verifier. Bearer only, the same user who started
   * it, single use, 60 seconds.
   */
  router.post('/mobile/mail/confirm', AUTHENTICATED, async (req, res) => {
    if (!bearerToken(req)) throw MOBILE_ONLY;
    const { code, code_verifier } = parseBody(mobileMailConfirmSchema, req);
    const result = await confirmMobileMailResult(code, code_verifier, currentUser(req)._id);
    if (!result) {
      throw new HttpError(400, 'INVALID_CODE', 'This send result has expired or was already read.');
    }
    res.json(result);
  });

  const mobileExchangeSchema = z.strictObject({
    code: z.string().min(20).max(200),
    code_verifier: z.string().regex(VERIFIER_RE),
  });

  router.post('/mobile/microsoft/exchange', PUBLIC, authLimiter, async (req, res) => {
    if (looksLikeBrowser(req)) throw MOBILE_ONLY;
    const parsed = mobileExchangeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Sign-in expired. Try again.', undefined, 'INVALID_CODE');
    }
    if (!config.msEnabled) {
      throw badRequest('Sign-in expired. Try again.', undefined, 'INVALID_CODE');
    }
    const { code, code_verifier } = parsed.data;
    const now = clockNow();
    const doc = await MobileAuthCodeModel.findOneAndDelete({
      phase: 'code',
      keyHash: sha256(code),
      expiresAt: { $gt: now },
    });
    let challengeOk = false;
    if (doc) {
      const got = Buffer.from(s256(code_verifier));
      const want = Buffer.from(doc.codeChallenge);
      challengeOk = got.length === want.length && timingSafeEqual(got, want);
    }
    if (!doc || !challengeOk) {
      throw badRequest('Sign-in expired. Try again.', undefined, 'INVALID_CODE');
    }
    const user = await UserModel.findById(doc.userId);
    if (!user || !user.active) {
      throw new HttpError(
        403,
        'ACCOUNT_DEACTIVATED',
        'This account is deactivated. Contact your administrator.',
      );
    }
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: now, failedLogins: 0, lockedUntil: null } },
    );
    const { token, expiresAt } = await createMobileSession(config, user._id, req, ipOf(req));
    res.json({
      user: toUserDto(user),
      permissions: await permissionsFor(user.systemRole as SystemRole),
      token,
      expiresAt: expiresAt.toISOString(),
    });
  });

  router.post('/login', PUBLIC, authLimiter, async (req, res) => {
    const user = await checkCredentials(req);
    await createSession(config, user._id, req, res, ipOf(req));
    res.json({
      user: toUserDto(user),
      permissions: await permissionsFor(user.systemRole as SystemRole),
    });
  });

  /**
   * Mobile app sign-in (mobile exception to FR-AUTH-03): returns a device token in the body,
   * never a cookie. Refused for browser requests, so a web page can't opt in to the longer
   * sliding session.
   */
  router.post('/mobile/login', PUBLIC, authLimiter, async (req, res) => {
    if (looksLikeBrowser(req)) throw MOBILE_ONLY;
    const user = await checkCredentials(req);
    const { token, expiresAt } = await createMobileSession(config, user._id, req, ipOf(req));
    res.json({
      user: toUserDto(user),
      permissions: await permissionsFor(user.systemRole as SystemRole),
      token,
      expiresAt: expiresAt.toISOString(),
    });
  });

  /** Called by the app on open/resume: extends the sliding window; 401 when already expired. */
  router.post('/mobile/refresh', AUTHENTICATED, async (req, res) => {
    const session = await SessionModel.findById(req.auth!.sessionId);
    if (!session || session.kind !== 'mobile') throw MOBILE_ONLY;
    const now = clockNow().getTime();
    const expiresAt = new Date(
      Math.min(now + idleMs(config, 'mobile'), session.absoluteExpiresAt.getTime()),
    );
    await SessionModel.updateOne(
      { _id: session._id },
      { $set: { lastSeenAt: new Date(now), expiresAt } },
    );
    res.json({
      user: toUserDto(currentUser(req)),
      permissions: currentPermissions(req),
      expiresAt: expiresAt.toISOString(),
    });
  });

  router.post('/mobile/logout', PUBLIC, async (req, res) => {
    const token = bearerToken(req);
    if (token && token.length <= 200) {
      await SessionModel.deleteOne({ tokenHash: sha256(token), kind: 'mobile' });
    }
    res.status(204).end();
  });

  router.post('/logout', PUBLIC, async (req, res) => {
    const token: unknown = req.cookies?.[cookieName(config)];
    if (typeof token === 'string' && token.length <= 200) {
      await SessionModel.deleteOne({ tokenHash: sha256(token) });
    }
    clearSessionCookie(config, res);
    res.status(204).end();
  });

  /** The signed-in user and their role's effective permissions (doc 11; refreshed per request). */
  router.get('/me', AUTHENTICATED, (req, res) => {
    res.json({ user: toUserDto(currentUser(req)), permissions: currentPermissions(req) });
  });

  /**
   * Effective permissions (FR-ACL-13, FR-ACL-21 / NFR-32): role and grid as before, plus Setup
   * children, create flags, `myTasksTabs` ([] when none) and `defaultTab` (null when none).
   */
  /** Whether the "Email {name}" option shows, and whether it's usable (Microsoft-linked). */
  router.get('/me/email-status', AUTHENTICATED, (req, res) => {
    const me = currentUser(req);
    const body: EmailStatusDto = {
      enabled: config.actionEmailEnabled,
      linked: Boolean(me.msOid && me.msTid),
    };
    res.json(body);
  });

  router.get('/me/permissions', AUTHENTICATED, (req, res) => {
    res.json(myPermissionsSummary(currentRole(req), currentPermissions(req)));
  });

  /**
   * Checks a first-time setup (invite) or reset link so the UI can greet the user.
   * POST with the token in the JSON body so it never appears in a URL path, where platform
   * HTTP logs and proxies would record it (FR-AUTH-04/05, QA review R-2). Read-only.
   */
  router.post('/invite/verify', PUBLIC, authLimiter, async (req, res) => {
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
  router.post('/setup-password', PUBLIC, authLimiter, async (req, res) => {
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
          lastLoginAt: clockNow(),
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
    res.json({
      user: toUserDto(updated),
      permissions: await permissionsFor(updated.systemRole as SystemRole),
    });
  });

  router.post('/change-password', AUTHENTICATED, async (req, res) => {
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

  return router.router;
}

const LINK_EXPIRED_MESSAGE = 'This link has expired. Ask an Admin for a new one.';

function invalidLink() {
  // Same message for unknown, used, expired and replaced links (AC-02.6), so nothing leaks.
  return badRequest(LINK_EXPIRED_MESSAGE, undefined, 'INVALID_TOKEN');
}

async function findByInviteToken(token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw invalidLink();
  const user = await UserModel.findOne({ 'invite.tokenHash': sha256(token) }).select('+invite');
  if (!user || !user.active || !user.invite || user.invite.expiresAt <= clockNow()) {
    throw invalidLink();
  }
  return user;
}
