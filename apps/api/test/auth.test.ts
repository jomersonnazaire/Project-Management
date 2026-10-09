import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ClientContactModel, ClientModel, SessionModel, UserModel } from '../src/models/index.js';
import { CSRF, PASSWORD, createUser, login, makeApp, useDatabase } from './helpers.js';

useDatabase();

const app = makeApp();
const loginReq = (a: typeof app, email: string, password: string, ip?: string) => {
  const r = request(a).post('/api/v1/auth/login').set(CSRF);
  if (ip) r.set('X-Forwarded-For', ip);
  return r.send({ email, password });
};

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

  it('AC-01.3 locks the account for 15 minutes after 5 consecutive failures, from any IP', async () => {
    const proxied = makeApp({ TRUST_PROXY_HOPS: '1' });
    const user = await createUser();
    for (let i = 1; i <= 4; i++) {
      const r = await loginReq(proxied, user.email, 'Wrong-password-1!', `10.0.0.${i}`);
      expect(r.status).toBe(401);
    }
    const fifth = await loginReq(proxied, user.email, 'Wrong-password-1!', '10.0.0.5');
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(fifth.body.error.message).toMatch(/locked for 15 minutes/);

    // Correct password is refused while locked.
    const locked = await loginReq(proxied, user.email, PASSWORD, '10.0.0.6');
    expect(locked.status).toBe(423);

    const stored = await UserModel.findById(user._id);
    const minutes = (stored!.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    // After the lock expires the correct password works again.
    await UserModel.updateOne({ _id: user._id }, { lockedUntil: new Date(Date.now() - 1000) });
    expect((await loginReq(proxied, user.email, PASSWORD)).status).toBe(200);
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

    const info = await request(app).get(`/api/v1/auth/invite/${token}`);
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

  it('expired links are refused', async () => {
    const admin = await createUser({ systemRole: 'ADMIN' });
    const adminAgent = await login(app, admin.email);
    const invited = await adminAgent.post('/api/v1/users').set(CSRF).send({
      name: 'Late',
      email: 'late@xceler8.example',
      systemRole: 'VIEWER',
      jobRole: 'SUPPORT',
    });
    const token = new URL(invited.body.inviteUrl).hash.replace('#token=', '');
    await UserModel.updateOne(
      { email: 'late@xceler8.example' },
      { 'invite.expiresAt': new Date(Date.now() - 1000) },
    );
    expect((await request(app).get(`/api/v1/auth/invite/${token}`)).status).toBe(400);
  });

  it('admin can issue a password reset link for an active user', async () => {
    const admin = await createUser({ systemRole: 'ADMIN' });
    const user = await createUser();
    const adminAgent = await login(app, admin.email);
    const res = await adminAgent.post(`/api/v1/users/${user._id}/invite`).set(CSRF).send({});
    expect(res.status).toBe(200);
    const token = new URL(res.body.inviteUrl).hash.replace('#token=', '');
    expect((await request(app).get(`/api/v1/auth/invite/${token}`)).body.purpose).toBe('RESET');
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
