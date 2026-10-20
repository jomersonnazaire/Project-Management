import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityLogModel,
  ClientContactModel,
  ClientModel,
  SessionModel,
  UserModel,
} from '../src/models/index.js';
import {
  readEmailFromIdTokenClaims,
  type MicrosoftIdClaims,
} from '../src/services/microsoftAuth.js';
import { CSRF, PASSWORD, createUser, login, makeApp, useDatabase } from './helpers.js';

const loginReq = (a: ReturnType<typeof makeApp>, email: string, password: string) =>
  request(a).post('/api/v1/auth/login').set(CSRF).send({ email, password });

useDatabase();

const TENANT = '11111111-1111-1111-1111-111111111111';
const DOMAIN = 'xceler8.example';
let oidSeq = 0;
const nextOid = () => {
  oidSeq += 1;
  return `aaaaaaaa-aaaa-aaaa-aaaa-${String(oidSeq).padStart(12, '0')}`;
};

const MS_ENV: Record<string, string> = {
  MS_TENANT_ID: TENANT,
  MS_CLIENT_ID: 'client-id-ms-test',
  MS_CLIENT_SECRET: 'ms-test-client-secret-32chars-minimum!!',
  MS_REDIRECT_URI: 'http://localhost:5173/api/auth/microsoft/callback',
  MS_ALLOWED_TENANT_IDS: TENANT,
  MS_ALLOWED_DOMAINS: DOMAIN,
  EDGE_PROXY_SECRET: 'edge-secret-for-ms-oauth-tests-0123456789ab',
};

const baseClaims = (email?: string): MicrosoftIdClaims => {
  const n = oidSeq + 1;
  return {
    oid: nextOid(),
    tid: TENANT,
    email: email ?? `newuser-${n}@${DOMAIN}`,
    name: 'New Microsoft User',
    acct: 0,
    xms_edov: true,
  };
};

const exchangeMock = vi.fn();
const loginUrlMock = vi.fn();

vi.mock('../src/services/microsoftAuth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    buildMicrosoftLoginUrl: (...args: unknown[]) => loginUrlMock(...args),
    exchangeMicrosoftCode: (...args: unknown[]) => exchangeMock(...args),
  };
});

function appMs(overrides: Record<string, string> = {}) {
  return makeApp({ ...MS_ENV, ...overrides });
}

async function runCallback(
  a: ReturnType<typeof makeApp>,
  claims: MicrosoftIdClaims,
  opts: { state?: string; skipCookie?: boolean } = {},
) {
  loginUrlMock.mockResolvedValueOnce({
    url: 'https://login.microsoftonline.com/mock',
    codeVerifier: 'verifier-12345678901234567890123456789012',
    state: 'state-abc',
    nonce: 'nonce-xyz',
  });
  const agent = request.agent(a);
  const loginRes = await agent.get('/api/v1/auth/microsoft/login');
  const setCookie = loginRes.headers['set-cookie'];
  exchangeMock.mockResolvedValueOnce(claims);
  const cb = request(a)
    .get('/api/v1/auth/microsoft/callback')
    .query({
      code: 'auth-code',
      state: opts.state ?? 'state-abc',
    });
  if (!opts.skipCookie && setCookie) {
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const m = /xc8_ms_oauth=([^;]+)/.exec(raw);
    if (m) cb.set('Cookie', `xc8_ms_oauth=${m[1]}`);
  }
  return cb;
}

describe('Microsoft 365 sign-in', () => {
  beforeEach(async () => {
    exchangeMock.mockReset();
    loginUrlMock.mockReset();
    await ActivityLogModel.deleteMany({ action: { $in: ['sso_user_created', 'sso_linked'] } });
  });

  it('providers: msEnabled false when allowlists empty', async () => {
    const a = makeApp({
      ...MS_ENV,
      MS_ALLOWED_TENANT_IDS: '',
    });
    const res = await request(a).get('/api/v1/auth/providers');
    expect(res.body.microsoft).toBe(false);
  });

  it('providers: msEnabled false when EDGE_PROXY_SECRET empty (all MS_* set)', async () => {
    const a = makeApp({ ...MS_ENV, EDGE_PROXY_SECRET: '' });
    expect((await request(a).get('/api/v1/auth/providers')).body.microsoft).toBe(false);
    const loginRes = await request(a).get('/api/v1/auth/microsoft/login');
    expect(loginRes.status).toBe(302);
    expect(loginRes.headers.location).toMatch(/ms_signin_failed/);
  });

  it('EDGE_PROXY_SECRET: 31 chars stops startup, 32 chars enables MS sign-in', async () => {
    const short = 'e'.repeat(31);
    const ok = 'e'.repeat(32);
    expect(() => makeApp({ ...MS_ENV, EDGE_PROXY_SECRET: short })).toThrow(
      /EDGE_PROXY_SECRET must be at least 32 characters/,
    );
    expect(
      (await request(makeApp({ ...MS_ENV, EDGE_PROXY_SECRET: ok })).get('/api/v1/auth/providers'))
        .body.microsoft,
    ).toBe(true);
  });

  it('1 wrong tid: refused, no user created', async () => {
    const a = appMs();
    const claims = baseClaims();
    claims.tid = '99999999-9999-9999-9999-999999999999';
    const res = await runCallback(a, claims);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/error=ms_signin_failed/);
    expect(await UserModel.countDocuments({ email: claims.email })).toBe(0);
  });

  it('2 new user: VIEWER, jobRole null, microsoft auth, session cookie', async () => {
    const a = appMs();
    const claims = baseClaims();
    const res = await runCallback(a, claims);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173');
    const user = await UserModel.findOne({ email: claims.email });
    expect(user).toMatchObject({
      systemRole: 'VIEWER',
      jobRole: null,
      active: true,
      mustChangePassword: false,
      authProvider: 'microsoft',
      msOid: claims.oid,
      msTid: TENANT,
    });
    expect(String(res.headers['set-cookie'])).toMatch(/xc8_sid=/);
    const audit = await ActivityLogModel.findOne({ action: 'sso_user_created' });
    expect(audit?.meta).toMatchObject({
      userId: user!._id.toString(),
      msTid: TENANT,
      email: claims.email,
    });
  });

  it('3 returning user matched by msOid+msTid writes no SSO audit', async () => {
    const a = appMs();
    const msOid = nextOid();
    const oldEmail = `old-${oidSeq}@${DOMAIN}`;
    await UserModel.create({
      name: 'Linked MS',
      email: oldEmail,
      systemRole: 'MEMBER',
      jobRole: 'DEVELOPER',
      active: true,
      mustChangePassword: false,
      passwordHash: null,
      authProvider: 'microsoft',
      msOid,
      msTid: TENANT,
    });
    const claims = baseClaims(`newemail-${oidSeq}@${DOMAIN}`);
    claims.oid = msOid;
    await runCallback(a, claims);
    expect(
      await ActivityLogModel.countDocuments({
        action: { $in: ['sso_linked', 'sso_user_created'] },
      }),
    ).toBe(0);
  });

  it('3b returning user matched by msOid+msTid even if email changed', async () => {
    const a = appMs();
    const msOid = nextOid();
    const oldEmail = `old-${oidSeq}@${DOMAIN}`;
    const user = await UserModel.create({
      name: 'Linked MS',
      email: oldEmail,
      systemRole: 'MEMBER',
      jobRole: 'DEVELOPER',
      active: true,
      mustChangePassword: false,
      passwordHash: null,
      authProvider: 'microsoft',
      msOid,
      msTid: TENANT,
    });
    const claims = baseClaims(`newemail-${oidSeq}@${DOMAIN}`);
    claims.oid = msOid;
    const res = await runCallback(a, claims);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173');
    const updated = await UserModel.findById(user._id);
    expect(updated?.email).toBe(oldEmail);
  });

  it('4 existing password user, allowed domain: linked, password still works', async () => {
    const a = appMs();
    const user = await createUser({ email: `link@${DOMAIN}`, systemRole: 'MEMBER' });
    const claims = baseClaims(user.email);
    claims.oid = '33333333-3333-3333-3333-333333333333';
    const res = await runCallback(a, claims);
    expect(res.status).toBe(302);
    const linked = await UserModel.findById(user._id);
    expect(linked?.msOid).toBe(claims.oid);
    expect((await loginReq(a, user.email, PASSWORD)).status).toBe(200);
    const audit = await ActivityLogModel.findOne({ action: 'sso_linked', entityId: user._id });
    expect(audit?.meta).toMatchObject({
      userId: user._id.toString(),
      msTid: TENANT,
      email: user.email,
    });
  });

  it('5 existing user, domain allowed, xms_edov absent: linked', async () => {
    const a = appMs();
    const user = await createUser({ email: `nodov@${DOMAIN}` });
    const claims = baseClaims();
    claims.email = user.email;
    claims.oid = '44444444-4444-4444-4444-444444444444';
    delete claims.xms_edov;
    expect((await runCallback(a, claims)).status).toBe(302);
    expect((await UserModel.findById(user._id))?.msOid).toBe(claims.oid);
  });

  it('6 existing user, domain not allowed, xms_edov false: no link', async () => {
    const a = appMs();
    const user = await createUser({ email: 'user@other.example' });
    const claims = baseClaims();
    claims.email = user.email;
    claims.xms_edov = false;
    claims.oid = '55555555-5555-5555-5555-555555555555';
    const res = await runCallback(a, claims);
    expect(res.headers.location).toMatch(/ms_signin_failed/);
    expect((await UserModel.findById(user._id))?.msOid).toBeFalsy();
  });

  it('7 deactivated user blocked via Microsoft', async () => {
    const a = appMs();
    const msOid = nextOid();
    const deadEmail = `dead-${oidSeq}@${DOMAIN}`;
    await UserModel.create({
      name: 'Dead',
      email: deadEmail,
      systemRole: 'MEMBER',
      jobRole: 'DEVELOPER',
      active: false,
      msOid,
      msTid: TENANT,
      passwordHash: null,
      mustChangePassword: false,
    });
    const claims = baseClaims(deadEmail);
    claims.oid = msOid;
    const res = await runCallback(a, claims);
    expect(res.headers.location).toMatch(/ms_signin_failed/);
  });

  it('8 client contact email: never linked or created', async () => {
    const a = appMs();
    const contactEmail = `contact-${oidSeq + 1}@${DOMAIN}`;
    const client = await ClientModel.create({ name: 'Co', nameKey: `co-${oidSeq}` });
    await ClientContactModel.create({
      clientId: client._id,
      name: 'Contact',
      email: contactEmail,
    });
    const claims = baseClaims(contactEmail);
    const res = await runCallback(a, claims);
    expect(res.headers.location).toMatch(/ms_signin_failed/);
    expect(await UserModel.countDocuments({ email: claims.email })).toBe(0);
  });

  it('9 middleware: Microsoft-only session survives authenticate', async () => {
    const a = appMs();
    const claims = baseClaims();
    claims.email = `session@${DOMAIN}`;
    claims.oid = '66666666-6666-6666-6666-666666666666';
    const agent = request.agent(a);
    loginUrlMock.mockResolvedValueOnce({
      url: 'https://login.microsoftonline.com/mock',
      codeVerifier: 'verifier-12345678901234567890123456789012',
      state: 'state-abc',
      nonce: 'nonce-xyz',
    });
    await agent.get('/api/v1/auth/microsoft/login');
    exchangeMock.mockResolvedValueOnce(claims);
    await agent.get('/api/v1/auth/microsoft/callback').query({ code: 'c', state: 'state-abc' });
    const me = await agent.get('/api/v1/auth/me').set(CSRF);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(claims.email);
  });

  it('9b user with neither password nor msOid revoked on authenticate', async () => {
    const a = appMs();
    const user = await UserModel.create({
      name: 'Broken',
      email: `broken@${DOMAIN}`,
      systemRole: 'VIEWER',
      jobRole: null,
      active: true,
      passwordHash: null,
      mustChangePassword: false,
    });
    const { sha256 } = await import('../src/services/tokens.js');
    const { newToken } = await import('../src/services/tokens.js');
    const { SessionModel } = await import('../src/models/index.js');
    const token = newToken();
    await SessionModel.create({
      tokenHash: sha256(token),
      userId: user._id,
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      ip: '127.0.0.1',
    });
    const me = await request(a).get('/api/v1/auth/me').set(CSRF).set('Cookie', `xc8_sid=${token}`);
    expect(me.status).toBe(401);
  });

  it('10 Microsoft-only user password login: INVALID_CREDENTIALS', async () => {
    const a = appMs();
    await UserModel.create({
      name: 'MS Only',
      email: `msonly@${DOMAIN}`,
      systemRole: 'VIEWER',
      jobRole: null,
      active: true,
      authProvider: 'microsoft',
      msOid: '77777777-7777-7777-7777-777777777777',
      msTid: TENANT,
      passwordHash: null,
      mustChangePassword: false,
    });
    const res = await request(a)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: `msonly@${DOMAIN}`, password: 'Any-password-1!' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('11 bad/missing state rejected', async () => {
    const a = appMs();
    const res = await runCallback(a, baseClaims(), { state: 'wrong-state' });
    expect(res.headers.location).toMatch(/ms_signin_failed/);
  });

  it('16 fail closed: empty MS_ALLOWED_TENANT_IDS', async () => {
    const a = makeApp({ ...MS_ENV, MS_ALLOWED_TENANT_IDS: '' });
    expect((await request(a).get('/api/v1/auth/providers')).body.microsoft).toBe(false);
    const before = await UserModel.countDocuments();
    const res = await request(a)
      .get('/api/v1/auth/microsoft/callback')
      .query({ code: 'x', state: 'y' });
    expect(res.headers.location).toMatch(/ms_signin_failed/);
    expect(await UserModel.countDocuments()).toBe(before);
  });

  it('17 fail closed: empty MS_ALLOWED_DOMAINS', async () => {
    const a = makeApp({ ...MS_ENV, MS_ALLOWED_DOMAINS: '' });
    expect((await request(a).get('/api/v1/auth/providers')).body.microsoft).toBe(false);
  });

  it('19 guest acct=1 refused', async () => {
    const a = appMs();
    const guestEmail = `guest-${oidSeq + 1}@${DOMAIN}`;
    const claims = baseClaims(guestEmail);
    claims.acct = 1;
    const res = await runCallback(a, claims);
    expect(res.headers.location).toMatch(/ms_signin_failed/);
    expect(await UserModel.countDocuments({ email: guestEmail })).toBe(0);
  });

  it('20a missing acct claim refused', async () => {
    const a = appMs();
    const claims = baseClaims();
    delete claims.acct;
    const res = await runCallback(a, claims);
    expect(res.headers.location).toMatch(/ms_signin_failed/);
  });

  it('20 domain not in allowlist refused for new user', async () => {
    const a = appMs();
    const claims = baseClaims('person@notallowed.example');
    const res = await runCallback(a, claims);
    expect(res.headers.location).toMatch(/ms_signin_failed/);
    expect(await UserModel.countDocuments({ email: claims.email })).toBe(0);
  });

  it('foreign idp refused', async () => {
    const a = appMs();
    const claims = baseClaims();
    claims.idp = 'https://sts.windows.net/other-tenant/';
    const res = await runCallback(a, claims);
    expect(res.headers.location).toMatch(/ms_signin_failed/);
  });

  it('12 users list and detail accept jobRole null', async () => {
    const a = appMs();
    const admin = await createUser({ systemRole: 'ADMIN' });
    const agent = await login(a, admin.email);
    const msUser = await UserModel.create({
      name: 'Null Role',
      email: `nullrole@${DOMAIN}`,
      systemRole: 'VIEWER',
      jobRole: null,
      active: true,
      authProvider: 'microsoft',
      msOid: '88888888-8888-8888-8888-888888888888',
      msTid: TENANT,
      passwordHash: null,
      mustChangePassword: false,
    });
    const list = await agent.get('/api/v1/users');
    expect(list.status).toBe(200);
    const row = list.body.items.find((u: { id: string }) => u.id === msUser._id.toString());
    expect(row.jobRole).toBeNull();
    const one = await agent.get(`/api/v1/users/${msUser._id}`);
    expect(one.body.user.jobRole).toBeNull();
  });

  it('13 admin can set jobRole on a Microsoft-created user', async () => {
    const a = appMs();
    const admin = await createUser({ systemRole: 'ADMIN' });
    const agent = await login(a, admin.email);
    const msUser = await UserModel.create({
      name: 'Promote Me',
      email: `promote@${DOMAIN}`,
      systemRole: 'VIEWER',
      jobRole: null,
      active: true,
      authProvider: 'microsoft',
      msOid: '99999999-9999-9999-9999-999999999999',
      msTid: TENANT,
      passwordHash: null,
      mustChangePassword: false,
    });
    const patch = await agent
      .patch(`/api/v1/users/${msUser._id}`)
      .set(CSRF)
      .send({ jobRole: 'CONSULTANT', systemRole: 'MEMBER' });
    expect(patch.status).toBe(200);
    expect(patch.body.user.jobRole).toBe('CONSULTANT');
    expect(patch.body.user.systemRole).toBe('MEMBER');
  });

  it('14 invite flow still requires jobRole', async () => {
    const a = appMs();
    const admin = await createUser({ systemRole: 'ADMIN' });
    const agent = await login(a, admin.email);
    const bad = await agent.post('/api/v1/users').set(CSRF).send({
      name: 'No Role',
      email: 'norole@xceler8.example',
      systemRole: 'MEMBER',
    });
    expect(bad.status).toBe(400);
  });

  it('refuses token with no email claim', async () => {
    const a = appMs();
    const email = `noemail-${oidSeq + 1}@${DOMAIN}`;
    exchangeMock.mockRejectedValueOnce(new Error('Missing email'));
    const res = await runCallback(a, baseClaims(email));
    expect(res.headers.location).toMatch(/error=ms_no_email/);
    expect(await UserModel.countDocuments({ email })).toBe(0);
  });

  it('ignores preferred_username when email claim is absent', () => {
    expect(
      readEmailFromIdTokenClaims({ preferred_username: `only@${DOMAIN}`, email: undefined }),
    ).toBe('');
  });

  it('GET /api/users is 404; GET /api/auth/microsoft/login still works', async () => {
    const a = appMs();
    expect((await request(a).get('/api/users')).status).toBe(404);
    loginUrlMock.mockResolvedValueOnce({
      url: 'https://login.microsoftonline.com/mock',
      codeVerifier: 'verifier-12345678901234567890123456789012',
      state: 'state-abc',
      nonce: 'nonce-xyz',
    });
    const res = await request(a).get('/api/auth/microsoft/login');
    expect(res.status).toBe(302);
  });

  it('15 Viewer created via Microsoft cannot use time logging', async () => {
    const a = appMs();
    const msUser = await UserModel.create({
      name: 'Viewer MS',
      email: `viewerms@${DOMAIN}`,
      systemRole: 'VIEWER',
      jobRole: null,
      active: true,
      authProvider: 'microsoft',
      msOid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      msTid: TENANT,
      passwordHash: null,
      mustChangePassword: false,
    });
    const { sha256, newToken } = await import('../src/services/tokens.js');
    const token = newToken();
    await SessionModel.create({
      tokenHash: sha256(token),
      userId: msUser._id,
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      ip: '127.0.0.1',
    });
    const denied = await request(a).get('/api/v1/time').set(CSRF).set('Cookie', `xc8_sid=${token}`);
    expect(denied.status).toBe(403);
  });
});
