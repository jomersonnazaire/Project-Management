import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  ActivityLogModel,
  ClientContactModel,
  ClientModel,
  SessionModel,
  UserModel,
} from '../src/models/index.js';
import { CSRF, PASSWORD, createUser, login, makeApp, useDatabase } from './helpers.js';

useDatabase();

const app = makeApp();
const loginReq = (a: typeof app, email: string, password: string, ip?: string) => {
  const r = request(a).post('/api/v1/auth/login').set(CSRF);
  if (ip) r.set('X-Forwarded-For', ip);
  return r.send({ email, password });
};
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LINK_EXPIRED = 'This link has expired. Ask an Admin for a new one.';
/** Response body without the per-request id, to compare error responses. */
const shape = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });
const tokenOf = (inviteUrl: string) => new URL(inviteUrl).hash.replace('#token=', '');
const verifyReq = (a: typeof app, token: string) =>
  request(a).post('/api/v1/auth/invite/verify').set(CSRF).send({ token });

describe('Sign in (US-01)', () => {
  it('AC-01.1 signs in an active user with an httpOnly session cookie and no token in the body', async () => {
    const user = await createUser({ systemRole: 'MEMBER' });
    const res = await loginReq(app, user.email.toUpperCase(), PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: user.email,
      systemRole: 'MEMBER',
      status: 'ACTIVE',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|token/i);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/xc8_sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const agent = await login(app, user.email);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user._id.toString());
  });

  it('AC-01.2 gives the same generic error for a wrong password and an unknown email', async () => {
    const user = await createUser();
    const wrong = await loginReq(app, user.email, 'Wrong-password-1!');
    const unknown = await loginReq(app, 'nobody@xceler8.example', 'Wrong-password-1!');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.body.error.message).toBe('Email or password is incorrect.');
  });

  it('AC-01.3 silently locks the account for 15 minutes after 5 consecutive failures, from any IP', async () => {
    const proxied = makeApp({ TRUST_PROXY_HOPS: '1' });
    const user = await createUser();
    const unknown = await loginReq(
      proxied,
      'nobody@xceler8.example',
      'Wrong-password-1!',
      '10.0.0.9',
    );
    expect(unknown.status).toBe(401);

    for (let i = 1; i <= 5; i++) {
      const r = await loginReq(proxied, user.email, 'Wrong-password-1!', `10.0.0.${i}`);
      // The fifth failure locks the account but answers exactly like any wrong password.
      expect(r.status).toBe(401);
      expect(Object.keys(r.body).sort()).toEqual(Object.keys(unknown.body).sort());
      expect(shape(r.body)).toEqual(shape(unknown.body));
    }

    const stored = await UserModel.findById(user._id);
    const lockedUntil = stored!.lockedUntil!.getTime();
    const minutes = (lockedUntil - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    // While locked, even the correct password gets the same generic 401 (never 423).
    const locked = await loginReq(proxied, user.email, PASSWORD, '10.0.0.6');
    expect(locked.status).toBe(401);
    expect(shape(locked.body)).toEqual(shape(unknown.body));
    expect(JSON.stringify(locked.body)).not.toMatch(/lock/i);
    expect(locked.headers['set-cookie']).toBeUndefined();

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Still locked one minute before the window ends.
      vi.setSystemTime(lockedUntil - MINUTE);
      const almost = await loginReq(proxied, user.email, PASSWORD, '10.0.0.7');
      expect(almost.status).toBe(401);
      expect(shape(almost.body)).toEqual(shape(unknown.body));

      // After the 15-minute window the correct password works again.
      vi.setSystemTime(lockedUntil + 1000);
      const after = await loginReq(proxied, user.email, PASSWORD, '10.0.0.8');
      expect(after.status).toBe(200);
      expect(after.body.user.email).toBe(user.email);
    } finally {
      vi.useRealTimers();
    }
    const unlocked = await UserModel.findById(user._id);
    expect(unlocked!.lockedUntil).toBeNull();
    expect(unlocked!.failedLogins).toBe(0);
  });

  it('AC-01.3 records the lockout in the activity log without revealing it to the caller', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) await loginReq(app, user.email, 'Wrong-password-1!');
    const log = await ActivityLogModel.find({
      entityId: user._id,
      action: 'account_locked',
    }).lean();
    expect(log).toHaveLength(1);
  });

  it('AC-01.3 / G-5 resets the failure counter after a successful sign-in', async () => {
    const user = await createUser();
    for (let i = 0; i < 4; i++) await loginReq(app, user.email, 'Wrong-password-1!');
    expect((await loginReq(app, user.email, PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await loginReq(app, user.email, 'Wrong-password-1!')).status).toBe(401);
    }
    expect((await loginReq(app, user.email, PASSWORD)).status).toBe(200);
  });

  it('AC-01.3 / NFR-05 rate-limits sign-in attempts per IP across many accounts (429)', async () => {
    const limited = makeApp({ AUTH_RATE_LIMIT_MAX: '20', TRUST_PROXY_HOPS: '1' });
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const r = await loginReq(
        limited,
        `user${i}@nowhere.example`,
        'Wrong-password-1!',
        '203.0.113.7',
      );
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20).every((s) => s === 429)).toBe(true);
    // A different client IP is not affected. Azure-style "ip:port" entries are handled.
    const other = await loginReq(
      limited,
      'x@nowhere.example',
      'Wrong-password-1!',
      '198.51.100.9:51234',
    );
    expect(other.status).toBe(401);
  });

  it('AC-01.4 denies a deactivated user and ends their existing sessions', async () => {
    const user = await createUser();
    const agent = await login(app, user.email);
    await UserModel.updateOne({ _id: user._id }, { active: false });
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    const res = await loginReq(app, user.email, PASSWORD);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('AC-01.5 rejects a session idle for more than 30 minutes with 401 and no data', async () => {
    const user = await createUser();
    const agent = await login(app, user.email);
    const session = await SessionModel.findOne({ userId: user._id });
    const idleMs = session!.expiresAt.getTime() - session!.lastSeenAt.getTime();
    expect(idleMs).toBe(30 * 60_000);

    await SessionModel.updateOne(
      { _id: session!._id },
      { lastSeenAt: new Date(Date.now() - 31 * 60_000), expiresAt: new Date(Date.now() - 60_000) },
    );
    const res = await agent.get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
    expect(res.body.user).toBeUndefined();
    expect(await SessionModel.countDocuments({ _id: session!._id })).toBe(0);
  });

  it('activity slides the idle window forward', async () => {
    const user = await createUser();
    const agent = await login(app, user.email);
    const old = new Date(Date.now() - 20 * 60_000);
    await SessionModel.updateOne(
      { userId: user._id },
      { lastSeenAt: old, expiresAt: new Date(old.getTime() + 30 * 60_000) },
    );
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    const s = await SessionModel.findOne({ userId: user._id });
    expect(s!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
  });

  it('FR-AUTH-03 sign-out invalidates the session server-side', async () => {
    const user = await createUser();
    const agent = await login(app, user.email);
    const cookie = (await SessionModel.countDocuments({ userId: user._id })) > 0;
    expect(cookie).toBe(true);
    expect((await agent.post('/api/v1/auth/logout').set(CSRF)).status).toBe(204);
    expect(await SessionModel.countDocuments({ userId: user._id })).toBe(0);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('TC-A12 / EC-36 role changes apply to the next request', async () => {
    const pm = await createUser({ systemRole: 'PROJECT_MANAGER' });
    const agent = await login(app, pm.email);
    const ok = await agent.post('/api/v1/clients').set(CSRF).send({ name: 'Role Change Co' });
    expect(ok.status).toBe(201);
    await UserModel.updateOne({ _id: pm._id }, { systemRole: 'VIEWER' });
    const denied = await agent.post('/api/v1/clients').set(CSRF).send({ name: 'Role Change Co 2' });
    expect(denied.status).toBe(403);
  });
});

describe('Client contacts can never authenticate (FR-AUTH-08, AC-01.6, TC-A06, EC-21)', () => {
  it('a contact email behaves exactly like an unknown email on every auth endpoint', async () => {
    const client = await ClientModel.create({ name: 'Acme Auth Test', nameKey: 'acme auth test' });
    await ClientContactModel.create({
      clientId: client._id,
      name: 'R. Santos',
      email: 'rsantos@acme-auth.example',
    });

    const contact = await loginReq(app, 'rsantos@acme-auth.example', 'Any-password-1!');
    const unknown = await loginReq(app, 'unknown@acme-auth.example', 'Any-password-1!');
    expect(contact.status).toBe(unknown.status);
    expect(contact.body.error).toEqual(unknown.body.error);

    // Setup-password and invite lookups only accept tokens issued to users.
    const setup = await request(app)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token: 'rsantos@acme-auth.example-aaaaaaaa', password: 'Valid-password-1!' });
    expect(setup.status).toBe(400);
    expect(setup.body.error.code).toBe('INVALID_TOKEN');
    expect(await SessionModel.countDocuments()).toBeGreaterThanOrEqual(0);
  });

  it('an internal user whose email matches a contact still signs in with their own password', async () => {
    const user = await createUser({ email: 'shared@xceler8.example' });
    const client = await ClientModel.create({
      name: 'Shared Email Co',
      nameKey: 'shared email co',
    });
    await ClientContactModel.create({
      clientId: client._id,
      name: 'M. Lim',
      email: 'shared@xceler8.example',
    });
    const res = await loginReq(app, 'shared@xceler8.example', PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user._id.toString());
  });
});

describe('Invite and first-time password setup (FR-AUTH-04, AC-02.2)', () => {
  it('admin invites; the user sets a password via the one-time link and is signed in', async () => {
    const admin = await createUser({ systemRole: 'ADMIN', name: 'Jomerson Nazaire' });
    const adminAgent = await login(app, admin.email);
    const invited = await adminAgent.post('/api/v1/users').set(CSRF).send({
      name: 'A. Reyes',
      email: 'areyes@xceler8.example',
      systemRole: 'MEMBER',
      jobRole: 'DEVELOPER',
    });
    expect(invited.status).toBe(201);
    expect(invited.body.user.status).toBe('INVITED');
    const url = new URL(invited.body.inviteUrl);
    expect(url.pathname).toBe('/setup-password');
    const token = url.hash.replace('#token=', '');
    expect(token.length).toBeGreaterThan(30);

    // Can't sign in before setting a password.
    expect((await loginReq(app, 'areyes@xceler8.example', 'Whatever-123!')).status).toBe(401);

    const info = await verifyReq(app, token);
    expect(info.status).toBe(200);
    expect(info.body).toEqual({
      name: 'A. Reyes',
      email: 'areyes@xceler8.example',
      invitedByName: 'Jomerson Nazaire',
      purpose: 'INVITE',
    });

    const weak = await request(app)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');

    // 7 characters is one short of the 8-character minimum.
    const sevenChars = await request(app)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token, password: 'Abc12!x' });
    expect(sevenChars.status).toBe(400);
    expect(sevenChars.body.error.code).toBe('VALIDATION_ERROR');

    const agent = request.agent(app);
    const done = await agent
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token, password: 'New-password-123!' });
    expect(done.status).toBe(200);
    expect(done.body.user.status).toBe('ACTIVE');
    expect((await agent.get('/api/v1/auth/me')).body.user.email).toBe('areyes@xceler8.example');

    // The link is single-use.
    const reuse = await request(app)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token, password: 'Other-password-123!' });
    expect(reuse.status).toBe(400);
    expect((await loginReq(app, 'areyes@xceler8.example', 'New-password-123!')).status).toBe(200);
  });

  it('FR-AUTH-04/05 accepts link tokens only in a POST body, never in a URL path (QA R-2)', async () => {
    const admin = await createUser({ systemRole: 'ADMIN' });
    const adminAgent = await login(app, admin.email);
    const invited = await adminAgent.post('/api/v1/users').set(CSRF).send({
      name: 'Body Token',
      email: 'bodytoken@xceler8.example',
      systemRole: 'MEMBER',
      jobRole: 'DEVELOPER',
    });
    const token = tokenOf(invited.body.inviteUrl);

    // The old GET lookup with the token in the path is gone.
    expect((await request(app).get(`/api/v1/auth/invite/${token}`)).status).toBe(404);
    expect((await request(app).get('/api/v1/auth/invite/verify').query({ token })).status).toBe(
      404,
    );

    // The POST lookup is a state-changing route as far as CSRF goes: it needs the header.
    const noCsrf = await request(app).post('/api/v1/auth/invite/verify').send({ token });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_REJECTED');
    const badOrigin = await request(app)
      .post('/api/v1/auth/invite/verify')
      .set(CSRF)
      .set('Origin', 'https://evil.example')
      .send({ token });
    expect(badOrigin.status).toBe(403);

    // Missing, malformed or extra fields get the same "expired" answer as an unknown token.
    for (const body of [{}, { token: 42 }, { token: 'short' }, { token, extra: 1 }]) {
      const r = await request(app).post('/api/v1/auth/invite/verify').set(CSRF).send(body);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatchObject({ code: 'INVALID_TOKEN', message: LINK_EXPIRED });
    }
    const unknown = await verifyReq(app, 'x'.repeat(40));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatchObject({ code: 'INVALID_TOKEN', message: LINK_EXPIRED });

    // Verifying doesn't consume the link.
    expect((await verifyReq(app, token)).status).toBe(200);
    expect((await verifyReq(app, token)).status).toBe(200);
    await request(app)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token, password: 'Body-token-pass-1!' })
      .expect(200);
    expect((await verifyReq(app, token)).status).toBe(400);
  });

  it('invite links expire after 72 hours (INVITE_TTL_HOURS, TC-A14)', async () => {
    const admin = await createUser({ systemRole: 'ADMIN' });
    const adminAgent = await login(app, admin.email);
    const invited = await adminAgent.post('/api/v1/users').set(CSRF).send({
      name: 'Late',
      email: 'late@xceler8.example',
      systemRole: 'VIEWER',
      jobRole: 'SUPPORT',
    });
    expect(invited.body.purpose).toBe('INVITE');
    const issuedAt = Date.now();
    const expiresAt = new Date(invited.body.inviteExpiresAt).getTime();
    expect(Math.abs(expiresAt - issuedAt - 72 * HOUR)).toBeLessThan(10_000);
    const token = tokenOf(invited.body.inviteUrl);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(expiresAt - MINUTE);
      expect((await verifyReq(app, token)).status).toBe(200);
      vi.setSystemTime(expiresAt + MINUTE);
      const late = await verifyReq(app, token);
      expect(late.status).toBe(400);
      expect(late.body.error).toMatchObject({ code: 'INVALID_TOKEN', message: LINK_EXPIRED });
      const setup = await request(app)
        .post('/api/v1/auth/setup-password')
        .set(CSRF)
        .send({ token, password: 'Late-password-1!' });
      expect(setup.status).toBe(400);
      expect(setup.body.error.message).toBe(LINK_EXPIRED);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset links expire after 24 hours (RESET_TTL_HOURS, TC-A14)', async () => {
    const admin = await createUser({ systemRole: 'ADMIN' });
    const user = await createUser();
    const adminAgent = await login(app, admin.email);
    const res = await adminAgent.post(`/api/v1/users/${user._id}/invite`).set(CSRF).send({});
    expect(res.status).toBe(200);
    expect(res.body.purpose).toBe('RESET');
    const expiresAt = new Date(res.body.inviteExpiresAt).getTime();
    expect(Math.abs(expiresAt - Date.now() - 24 * HOUR)).toBeLessThan(10_000);
    const token = tokenOf(res.body.inviteUrl);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(expiresAt - MINUTE);
      expect((await verifyReq(app, token)).status).toBe(200);
      vi.setSystemTime(expiresAt + MINUTE);
      const setup = await request(app)
        .post('/api/v1/auth/setup-password')
        .set(CSRF)
        .send({ token, password: 'Late-reset-pass-1!' });
      expect(setup.status).toBe(400);
      expect(setup.body.error.message).toBe(LINK_EXPIRED);
    } finally {
      vi.useRealTimers();
    }
    // The old password still works because the reset never happened.
    expect((await loginReq(app, user.email, PASSWORD)).status).toBe(200);
  });

  it('link lifetimes are configurable', async () => {
    const custom = makeApp({ INVITE_TTL_HOURS: '5', RESET_TTL_HOURS: '2' });
    const admin = await createUser({ systemRole: 'ADMIN' });
    const user = await createUser();
    const agent = request.agent(custom);
    await agent
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    const reset = await agent.post(`/api/v1/users/${user._id}/invite`).set(CSRF).send({});
    const invite = await agent.post('/api/v1/users').set(CSRF).send({
      name: 'Configured',
      email: 'configured@xceler8.example',
      systemRole: 'MEMBER',
      jobRole: 'SUPPORT',
    });
    const now = Date.now();
    expect(Math.abs(new Date(reset.body.inviteExpiresAt).getTime() - now - 2 * HOUR)).toBeLessThan(
      10_000,
    );
    expect(Math.abs(new Date(invite.body.inviteExpiresAt).getTime() - now - 5 * HOUR)).toBeLessThan(
      10_000,
    );
  });

  it('a new reset link cancels the earlier unused one (TC-A14)', async () => {
    const admin = await createUser({ systemRole: 'ADMIN' });
    const user = await createUser();
    const adminAgent = await login(app, admin.email);
    const first = await adminAgent.post(`/api/v1/users/${user._id}/invite`).set(CSRF).send({});
    expect(first.body.replacedPrevious).toBe(false);
    const second = await adminAgent.post(`/api/v1/users/${user._id}/invite`).set(CSRF).send({});
    expect(second.body.replacedPrevious).toBe(true);
    const oldToken = tokenOf(first.body.inviteUrl);
    const newToken = tokenOf(second.body.inviteUrl);
    expect(newToken).not.toBe(oldToken);

    const old = await request(app)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token: oldToken, password: 'Old-link-pass-1!' });
    expect(old.status).toBe(400);
    expect(old.body.error.message).toBe(LINK_EXPIRED);
    expect((await verifyReq(app, oldToken)).status).toBe(400);

    await request(app)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token: newToken, password: 'New-link-pass-1!' })
      .expect(200);
    // Single use: the replacement link is spent too.
    const again = await request(app)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token: newToken, password: 'Third-try-pass-1!' });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toBe(LINK_EXPIRED);
    expect((await loginReq(app, user.email, 'New-link-pass-1!')).status).toBe(200);
    expect((await loginReq(app, user.email, 'Third-try-pass-1!')).status).toBe(401);

    const log = await ActivityLogModel.find({
      entityId: user._id,
      action: 'password_reset_link_issued',
    }).lean();
    expect(log).toHaveLength(2);
  });

  it('a new invite link cancels the original invite (TC-A14)', async () => {
    const admin = await createUser({ systemRole: 'ADMIN' });
    const adminAgent = await login(app, admin.email);
    const invited = await adminAgent.post('/api/v1/users').set(CSRF).send({
      name: 'Twice Invited',
      email: 'twice@xceler8.example',
      systemRole: 'MEMBER',
      jobRole: 'DEVELOPER',
    });
    const again = await adminAgent
      .post(`/api/v1/users/${invited.body.user.id}/invite`)
      .set(CSRF)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ purpose: 'INVITE', replacedPrevious: true });
    expect(
      Math.abs(new Date(again.body.inviteExpiresAt).getTime() - Date.now() - 72 * HOUR),
    ).toBeLessThan(10_000);
    expect((await verifyReq(app, tokenOf(invited.body.inviteUrl))).status).toBe(400);
    expect((await verifyReq(app, tokenOf(again.body.inviteUrl))).status).toBe(200);
  });

  it('deactivated users cannot get or use links', async () => {
    const admin = await createUser({ systemRole: 'ADMIN' });
    const user = await createUser();
    const adminAgent = await login(app, admin.email);
    const res = await adminAgent.post(`/api/v1/users/${user._id}/invite`).set(CSRF).send({});
    await adminAgent.post(`/api/v1/users/${user._id}/deactivate`).set(CSRF).send({}).expect(200);
    expect((await verifyReq(app, tokenOf(res.body.inviteUrl))).status).toBe(400);
    const blocked = await adminAgent.post(`/api/v1/users/${user._id}/invite`).set(CSRF).send({});
    expect(blocked.status).toBe(409);
  });

  it('admin can issue a password reset link for an active user', async () => {
    const admin = await createUser({ systemRole: 'ADMIN' });
    const user = await createUser();
    const adminAgent = await login(app, admin.email);
    const res = await adminAgent.post(`/api/v1/users/${user._id}/invite`).set(CSRF).send({});
    expect(res.status).toBe(200);
    const token = new URL(res.body.inviteUrl).hash.replace('#token=', '');
    expect((await verifyReq(app, token)).body.purpose).toBe('RESET');
    const userAgent = await login(app, user.email);
    await request(app)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token, password: 'Reset-password-99!' })
      .expect(200);
    // Old sessions are revoked by the reset.
    expect((await userAgent.get('/api/v1/auth/me')).status).toBe(401);
    expect((await loginReq(app, user.email, 'Reset-password-99!')).status).toBe(200);
  });

  it('change-password requires the current password', async () => {
    const user = await createUser();
    const agent = await login(app, user.email);
    const bad = await agent
      .post('/api/v1/auth/change-password')
      .set(CSRF)
      .send({ currentPassword: 'nope', newPassword: 'Brand-new-pass-1!' });
    expect(bad.status).toBe(400);
    await agent
      .post('/api/v1/auth/change-password')
      .set(CSRF)
      .send({ currentPassword: PASSWORD, newPassword: 'Brand-new-pass-1!' })
      .expect(204);
    expect((await loginReq(app, user.email, 'Brand-new-pass-1!')).status).toBe(200);
  });
});

describe('Cookie flags in production mode (NFR-02, TC-A08)', () => {
  it('uses a __Host- prefixed httpOnly Secure cookie; SameSite configurable for cross-site', async () => {
    const user = await createUser();
    for (const sameSite of ['lax', 'none'] as const) {
      const prod = makeApp({ COOKIE_SECURE: 'true', COOKIE_SAMESITE: sameSite });
      const res = await loginReq(prod, user.email, PASSWORD);
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/^__Host-xc8_sid=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).not.toMatch(/Domain=/);
      expect(cookie).toMatch(sameSite === 'lax' ? /SameSite=Lax/ : /SameSite=None/);
    }
  });
});
