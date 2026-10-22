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
import { emailLinkBasis } from '../src/services/microsoftSignIn.js';
import { CSRF, PASSWORD, createUser, login, makeApp, testConfig, useDatabase } from './helpers.js';

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
    await ActivityLogModel.deleteMany({
      action: { $in: ['sso_user_created', 'sso_linked', 'sso_link_refused'] },
    });
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

  describe('5 xms_edov missing: link only for our tenant and an allowed domain (Lean)', () => {
    const OTHER_TENANT = '99999999-9999-9999-9999-999999999999';

    it('our tenant, allowed domain: linked, audited as allowed_tenant_domain', async () => {
      const a = appMs();
      const user = await createUser({ email: `nodov-ok@${DOMAIN}` });
      const claims = baseClaims(user.email);
      delete claims.xms_edov;
      const res = await runCallback(a, claims);
      expect(res.status).toBe(302);
      expect(res.headers.location).not.toMatch(/error=/);
      expect(String(res.headers['set-cookie'] ?? '')).toMatch(/xc8_sid=[^;]/);
      const after = await UserModel.findById(user._id);
      expect(after?.msOid).toBe(claims.oid);
      expect(after?.msTid).toBe(TENANT);
      const linked = await ActivityLogModel.findOne({ action: 'sso_linked', entityId: user._id });
      expect(linked?.meta).toMatchObject({
        msTid: TENANT,
        emailVerifiedBy: 'allowed_tenant_domain',
      });
    });

    it('another tenant: refused, not linked, no session', async () => {
      const a = appMs();
      const user = await createUser({ email: `nodov-tid@${DOMAIN}` });
      const claims = baseClaims(user.email);
      delete claims.xms_edov;
      claims.tid = OTHER_TENANT;
      const res = await runCallback(a, claims);
      expect(res.headers.location).toMatch(/\/login\?error=ms_signin_failed$/);
      expect(String(res.headers['set-cookie'] ?? '')).not.toMatch(/xc8_sid=[^;]/);
      const after = await UserModel.findById(user._id);
      expect(after?.msOid).toBeFalsy();
      expect(after?.msTid).toBeFalsy();
      expect(await ActivityLogModel.countDocuments({ action: 'sso_linked' })).toBe(0);
    });

    it('a domain that is not allowed: refused, not linked, no session', async () => {
      // The user stays a seeded @xceler8.example account; only that domain is not allowed here.
      const a = appMs({ MS_ALLOWED_DOMAINS: 'partner.xceler8.example' });
      const user = await createUser({ email: `nodov-dom@${DOMAIN}` });
      const claims = baseClaims(user.email);
      delete claims.xms_edov;
      const res = await runCallback(a, claims);
      expect(res.headers.location).toMatch(/\/login\?error=ms_signin_failed$/);
      expect(String(res.headers['set-cookie'] ?? '')).not.toMatch(/xc8_sid=[^;]/);
      expect((await UserModel.findById(user._id))?.msOid).toBeFalsy();
      expect(await ActivityLogModel.countDocuments({ action: 'sso_linked' })).toBe(0);
    });

    it('claim false (our tenant, allowed domain): refused ms_email_unverified, audited', async () => {
      const a = appMs();
      const user = await createUser({ email: `nodov-false@${DOMAIN}` });
      const claims = baseClaims(user.email);
      claims.xms_edov = false;
      const res = await runCallback(a, claims);
      expect(res.headers.location).toBe('http://localhost:5173/login?error=ms_email_unverified');
      expect(String(res.headers['set-cookie'] ?? '')).not.toMatch(/xc8_sid=[^;]/);
      expect((await UserModel.findById(user._id))?.msOid).toBeFalsy();
      const refused = await ActivityLogModel.findOne({
        action: 'sso_link_refused',
        entityId: user._id,
      });
      expect(refused?.reason).toBe('ms_email_unverified');
      expect(await ActivityLogModel.countDocuments({ action: 'sso_linked' })).toBe(0);
    });

    it('the fallback rule itself: missing claim needs both the tenant and the domain', () => {
      const config = testConfig(MS_ENV);
      const narrow = testConfig({ ...MS_ENV, MS_ALLOWED_DOMAINS: 'partner.xceler8.example' });
      const c = (over: Partial<MicrosoftIdClaims>): MicrosoftIdClaims => {
        const claims = { ...baseClaims(), ...over };
        if (!('xms_edov' in over)) delete claims.xms_edov;
        return claims;
      };
      const ours = `x@${DOMAIN}`;
      expect(emailLinkBasis(c({ xms_edov: true }), ours, config)).toBe('xms_edov');
      expect(emailLinkBasis(c({ xms_edov: false }), ours, config)).toBeNull();
      expect(emailLinkBasis(c({}), ours, config)).toBe('allowed_tenant_domain');
      expect(emailLinkBasis(c({ tid: OTHER_TENANT }), ours, config)).toBeNull();
      expect(emailLinkBasis(c({}), ours, narrow)).toBeNull();
      expect(emailLinkBasis(c({ tid: OTHER_TENANT }), ours, narrow)).toBeNull();
      expect(emailLinkBasis(c({ xms_edov: true }), ours, narrow)).toBe('xms_edov');
    });
  });

  it('5b existing user, xms_edov false: refused ms_email_unverified, not linked', async () => {
    const a = appMs();
    const user = await createUser({ email: `dovfalse@${DOMAIN}` });
    const claims = baseClaims(user.email);
    claims.xms_edov = false;
    const res = await runCallback(a, claims);
    expect(res.headers.location).toBe('http://localhost:5173/login?error=ms_email_unverified');
    expect((await UserModel.findById(user._id))?.msOid).toBeFalsy();
    expect(
      await ActivityLogModel.countDocuments({ action: 'sso_link_refused', entityId: user._id }),
    ).toBe(1);
  });

  it('5c already linked to another oid: refused ms_account_mismatch, link unchanged, audited', async () => {
    const a = appMs();
    const user = await createUser({ email: `relink-oid@${DOMAIN}`, systemRole: 'MEMBER' });
    const linkedOid = nextOid();
    await UserModel.updateOne({ _id: user._id }, { $set: { msOid: linkedOid, msTid: TENANT } });
    const claims = baseClaims(user.email);
    expect(claims.oid).not.toBe(linkedOid);
    const res = await runCallback(a, claims);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/login?error=ms_account_mismatch');
    expect(String(res.headers['set-cookie'] ?? '')).not.toMatch(/xc8_sid=[^;]/);
    expect(await SessionModel.countDocuments({ userId: user._id })).toBe(0);
    const after = await UserModel.findById(user._id);
    expect(after?.msOid).toBe(linkedOid);
    expect(after?.msTid).toBe(TENANT);
    const refused = await ActivityLogModel.findOne({
      action: 'sso_link_refused',
      entityId: user._id,
    });
    expect(refused?.reason).toBe('ms_account_mismatch');
    expect(refused?.meta).toMatchObject({
      userId: user._id.toString(),
      msTid: TENANT,
      msOid: claims.oid,
      email: user.email,
    });
    // No tokens, codes, verifiers or nonces in the audit entry.
    const raw = JSON.stringify(refused?.toObject());
    expect(raw).not.toMatch(/auth-code|verifier|nonce|token/i);
    expect(await ActivityLogModel.countDocuments({ action: 'sso_linked' })).toBe(0);
  });

  it('5d same oid but another tenant: refused ms_account_mismatch', async () => {
    const otherTenant = '22222222-2222-2222-2222-222222222222';
    const a = appMs({ MS_ALLOWED_TENANT_IDS: `${TENANT},${otherTenant}` });
    const user = await createUser({ email: `relink-tid@${DOMAIN}` });
    const claims = baseClaims(user.email);
    await UserModel.updateOne({ _id: user._id }, { $set: { msOid: claims.oid, msTid: TENANT } });
    claims.tid = otherTenant;
    const res = await runCallback(a, claims);
    expect(res.headers.location).toBe('http://localhost:5173/login?error=ms_account_mismatch');
    const after = await UserModel.findById(user._id);
    expect(after?.msTid).toBe(TENANT);
    expect(
      (await ActivityLogModel.findOne({ action: 'sso_link_refused', entityId: user._id }))?.reason,
    ).toBe('ms_account_mismatch');
  });

  it('5e mismatch is refused even when xms_edov is true and the domain is allowed', async () => {
    const a = appMs();
    const user = await createUser({ email: `relink-edov@${DOMAIN}` });
    await UserModel.updateOne({ _id: user._id }, { $set: { msOid: nextOid(), msTid: TENANT } });
    const claims = baseClaims(user.email);
    claims.xms_edov = true;
    const res = await runCallback(a, claims);
    expect(res.headers.location).toMatch(/error=ms_account_mismatch/);
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
