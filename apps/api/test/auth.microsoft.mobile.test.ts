import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestTime, setTestTime } from '../src/lib/clock.js';
import {
  ActivityLogModel,
  ClientContactModel,
  ClientModel,
  MobileAuthCodeModel,
  SessionModel,
  UserModel,
} from '../src/models/index.js';
import { CODE_TTL_MS, PENDING_TTL_MS, s256 } from '../src/services/microsoftMobile.js';
import type { MicrosoftIdClaims } from '../src/services/microsoftAuth.js';
import { CSRF, createUser, makeApp, useDatabase } from './helpers.js';
import { sha256 } from '../src/services/tokens.js';

useDatabase();

const TENANT = '11111111-1111-1111-1111-111111111111';
const DOMAIN = 'xceler8.example';
// RFC 7636 Appendix B test vector.
const MS_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const MOBILE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const MOBILE_STATE = 'state-mobile-flow-001';
const MS_NONCE = 'nonce-mobile-xyz';

const MS_ENV: Record<string, string> = {
  MS_TENANT_ID: TENANT,
  MS_CLIENT_ID: 'client-id-ms-test',
  MS_CLIENT_SECRET: 'ms-test-client-secret-32chars-minimum!!',
  MS_REDIRECT_URI: 'http://localhost:5173/api/auth/microsoft/callback',
  MS_ALLOWED_TENANT_IDS: TENANT,
  MS_ALLOWED_DOMAINS: DOMAIN,
  EDGE_PROXY_SECRET: 'edge-secret-for-ms-oauth-tests-0123456789ab',
};

let oidSeq = 0;
const nextOid = () => {
  oidSeq += 1;
  return `bbbbbbbb-bbbb-bbbb-bbbb-${String(oidSeq).padStart(12, '0')}`;
};

const baseClaims = (email?: string): MicrosoftIdClaims => {
  const n = oidSeq + 1;
  return {
    oid: nextOid(),
    tid: TENANT,
    email: email ?? `mobile-${n}@${DOMAIN}`,
    name: 'Mobile Microsoft User',
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

function mockMicrosoftStart(state = MOBILE_STATE) {
  loginUrlMock.mockResolvedValueOnce({
    url: 'https://login.microsoftonline.com/mock',
    codeVerifier: MS_VERIFIER,
    state,
    nonce: MS_NONCE,
  });
}

function mobileLoginStart(
  a: ReturnType<typeof makeApp>,
  challenge = MOBILE_CHALLENGE,
  method = 'S256',
) {
  return request(a)
    .get('/api/v1/auth/mobile/microsoft/login')
    .query({ code_challenge: challenge, code_challenge_method: method });
}

function mobileCallback(
  a: ReturnType<typeof makeApp>,
  opts: { code?: string; state?: string; error?: string } = {},
) {
  const q: Record<string, string> = { state: opts.state ?? MOBILE_STATE };
  if (opts.error) q.error = opts.error;
  else q.code = opts.code ?? 'auth-code-from-ms';
  return request(a).get('/api/v1/auth/microsoft/callback').query(q);
}

function parseAppCode(location: string | undefined): string {
  expect(location).toMatch(/^opstrack:\/\/auth\/microsoft\?/);
  const u = new URL(location!);
  const code = u.searchParams.get('code');
  expect(code).toBeTruthy();
  return code!;
}

function exchange(
  a: ReturnType<typeof makeApp>,
  code: string,
  verifier = MS_VERIFIER,
  headers: Record<string, string> = {},
) {
  return request(a)
    .post('/api/v1/auth/mobile/microsoft/exchange')
    .set(CSRF)
    .set(headers)
    .send({ code, code_verifier: verifier });
}

async function happyPathThroughCallback(a: ReturnType<typeof makeApp>, claims: MicrosoftIdClaims) {
  mockMicrosoftStart();
  expect((await mobileLoginStart(a)).status).toBe(302);
  exchangeMock.mockResolvedValueOnce(claims);
  const cb = await mobileCallback(a);
  expect(cb.status).toBe(302);
  const code = parseAppCode(cb.headers.location);
  return { code, cb };
}

describe('Microsoft 365 mobile sign-in', () => {
  beforeEach(async () => {
    exchangeMock.mockReset();
    loginUrlMock.mockReset();
    resetTestTime();
    await MobileAuthCodeModel.deleteMany({});
    await SessionModel.deleteMany({});
    await UserModel.deleteMany({});
    await ActivityLogModel.deleteMany({
      action: { $in: ['sso_user_created', 'sso_linked', 'sso_link_refused'] },
    });
  });

  afterEach(() => resetTestTime());

  it('1 happy path: login → callback → exchange → bearer session', async () => {
    const a = appMs();
    const claims = baseClaims();
    const { code } = await happyPathThroughCallback(a, claims);
    const res = await exchange(a, code);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.expiresAt).toBeTruthy();
    expect(res.body.user.email).toBe(claims.email);
    const me = await request(a)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    const session = await SessionModel.findOne({ userId: me.body.user.id }).lean();
    expect(session?.kind).toBe('mobile');
  });

  it('2 new user VIEWER + sso_user_created; link existing with sso_linked', async () => {
    const a = appMs();
    const claims = baseClaims();
    await happyPathThroughCallback(a, claims);
    const created = await UserModel.findOne({ email: claims.email }).lean();
    expect(created?.systemRole).toBe('VIEWER');
    expect(created?.jobRole).toBeNull();
    expect(
      await ActivityLogModel.exists({ action: 'sso_user_created', entityId: created!._id }),
    ).toBeTruthy();

    const existing = await createUser({ email: `linkmob@${DOMAIN}` });
    const linkClaims = baseClaims(existing.email);
    linkClaims.oid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const { code } = await happyPathThroughCallback(a, linkClaims);
    await exchange(a, code);
    expect((await UserModel.findById(existing._id))?.msOid).toBe(linkClaims.oid);
    expect(
      await ActivityLogModel.exists({ action: 'sso_linked', entityId: existing._id }),
    ).toBeTruthy();
  });

  it('3 replay: second exchange → 400; one mobile session', async () => {
    const a = appMs();
    const { code } = await happyPathThroughCallback(a, baseClaims());
    expect((await exchange(a, code)).status).toBe(200);
    expect((await exchange(a, code)).status).toBe(400);
    expect(await SessionModel.countDocuments({ kind: 'mobile' })).toBe(1);
  });

  it('4 expiry: +61s fails; +59s succeeds; pending >10m fails callback', async () => {
    const a = appMs();
    const t0 = Date.now();
    setTestTime(t0);
    const { code: expiredCode } = await happyPathThroughCallback(a, baseClaims());
    setTestTime(t0 + CODE_TTL_MS + 1_000);
    expect((await exchange(a, expiredCode)).status).toBe(400);

    setTestTime(t0);
    const { code: freshCode } = await happyPathThroughCallback(a, baseClaims());
    setTestTime(t0 + CODE_TTL_MS - 1_000);
    expect((await exchange(a, freshCode)).status).toBe(200);

    setTestTime(t0);
    mockMicrosoftStart('state-expired-pending');
    await mobileLoginStart(a);
    setTestTime(t0 + PENDING_TTL_MS + 1_000);
    const cb = await mobileCallback(a, { state: 'state-expired-pending' });
    expect(cb.headers.location).toMatch(/error=ms_signin_failed/);
  });

  it('5 wrong verifier burns code; right verifier after still 400', async () => {
    const a = appMs();
    const { code } = await happyPathThroughCallback(a, baseClaims());
    expect((await exchange(a, code, 'wrong-verifier-that-is-forty-three-chars-xx')).status).toBe(
      400,
    );
    expect((await exchange(a, code)).status).toBe(400);
  });

  it('6 msEnabled off: login deep link error; exchange 400; nothing stored', async () => {
    const a = makeApp({ ...MS_ENV, EDGE_PROXY_SECRET: '' });
    mockMicrosoftStart();
    const login = await mobileLoginStart(a);
    expect(login.headers.location).toMatch(/error=ms_signin_failed/);
    expect(await MobileAuthCodeModel.countDocuments()).toBe(0);
    expect((await exchange(a, 'x'.repeat(40))).status).toBe(400);
    expect(await UserModel.countDocuments()).toBe(0);
    expect(await SessionModel.countDocuments()).toBe(0);
  });

  it('7 bad challenge or plain method → error deep link, no pending doc', async () => {
    const a = appMs();
    mockMicrosoftStart();
    expect((await mobileLoginStart(a, 'short')).headers.location).toMatch(/error=ms_signin_failed/);
    expect(await MobileAuthCodeModel.countDocuments()).toBe(0);
    mockMicrosoftStart();
    expect((await mobileLoginStart(a, MOBILE_CHALLENGE, 'plain')).headers.location).toMatch(
      /error=ms_signin_failed/,
    );
    expect(await MobileAuthCodeModel.countDocuments()).toBe(0);
  });

  it('8 refusals: tid, acct, no email, deactivated, client contact', async () => {
    const a = appMs();

    const wrongTid = baseClaims();
    wrongTid.tid = '99999999-9999-9999-9999-999999999999';
    mockMicrosoftStart('s-tid');
    await mobileLoginStart(a);
    exchangeMock.mockResolvedValueOnce(wrongTid);
    expect((await mobileCallback(a, { state: 's-tid' })).headers.location).toMatch(
      /error=ms_signin_failed/,
    );
    expect(await MobileAuthCodeModel.countDocuments({ phase: 'code' })).toBe(0);

    const guest = baseClaims();
    guest.acct = 1;
    mockMicrosoftStart('s-guest');
    await mobileLoginStart(a);
    exchangeMock.mockResolvedValueOnce(guest);
    expect((await mobileCallback(a, { state: 's-guest' })).headers.location).toMatch(
      /error=ms_signin_failed/,
    );

    const { email: _noEmail, ...noEmail } = baseClaims();
    mockMicrosoftStart('s-noemail');
    await mobileLoginStart(a);
    exchangeMock.mockResolvedValueOnce(noEmail);
    expect((await mobileCallback(a, { state: 's-noemail' })).headers.location).toMatch(
      /error=ms_no_email/,
    );

    const deadEmail = `dead-m-${oidSeq}@${DOMAIN}`;
    const msOid = nextOid();
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
    const dead = baseClaims(deadEmail);
    dead.oid = msOid;
    mockMicrosoftStart('s-dead');
    await mobileLoginStart(a);
    exchangeMock.mockResolvedValueOnce(dead);
    expect((await mobileCallback(a, { state: 's-dead' })).headers.location).toMatch(
      /error=ms_signin_failed/,
    );

    const contactEmail = `cm-${oidSeq}@${DOMAIN}`;
    const client = await ClientModel.create({ name: 'CoM', nameKey: `com-${oidSeq}` });
    await ClientContactModel.create({
      clientId: client._id,
      name: 'C',
      email: contactEmail,
    });
    mockMicrosoftStart('s-contact');
    await mobileLoginStart(a);
    exchangeMock.mockResolvedValueOnce(baseClaims(contactEmail));
    expect((await mobileCallback(a, { state: 's-contact' })).headers.location).toMatch(
      /error=ms_signin_failed/,
    );
    expect(await UserModel.countDocuments({ email: contactEmail })).toBe(0);

    const noAcct = baseClaims();
    delete noAcct.acct;
    mockMicrosoftStart('s-noacct');
    await mobileLoginStart(a);
    exchangeMock.mockResolvedValueOnce(noAcct);
    expect((await mobileCallback(a, { state: 's-noacct' })).headers.location).toMatch(
      /error=ms_signin_failed/,
    );
  });

  it('8b relink refusals carry their own code to the app; no one-time code, audited', async () => {
    const a = appMs();

    const linked = await createUser({ email: `m-linked-${oidSeq}@${DOMAIN}` });
    const linkedOid = nextOid();
    await UserModel.updateOne({ _id: linked._id }, { $set: { msOid: linkedOid, msTid: TENANT } });
    mockMicrosoftStart('s-mismatch');
    await mobileLoginStart(a);
    exchangeMock.mockResolvedValueOnce(baseClaims(linked.email));
    expect((await mobileCallback(a, { state: 's-mismatch' })).headers.location).toBe(
      'opstrack://auth/microsoft?error=ms_account_mismatch',
    );
    expect((await UserModel.findById(linked._id))?.msOid).toBe(linkedOid);

    const unverified = await createUser({ email: `m-nodov-${oidSeq}@${DOMAIN}` });
    const claims = baseClaims(unverified.email);
    claims.xms_edov = false;
    mockMicrosoftStart('s-unverified');
    await mobileLoginStart(a);
    exchangeMock.mockResolvedValueOnce(claims);
    expect((await mobileCallback(a, { state: 's-unverified' })).headers.location).toBe(
      'opstrack://auth/microsoft?error=ms_email_unverified',
    );
    expect((await UserModel.findById(unverified._id))?.msOid).toBeFalsy();

    expect(await MobileAuthCodeModel.countDocuments({ phase: 'code' })).toBe(0);
    const reasons = (
      await ActivityLogModel.find({ action: 'sso_link_refused' }).sort({ _id: 1 }).lean()
    ).map((e) => e.reason);
    expect(reasons).toEqual(['ms_account_mismatch', 'ms_email_unverified']);
  });

  it('8c xms_edov missing: links only for our tenant and an allowed domain (same rule as web)', async () => {
    const start = async (a: ReturnType<typeof makeApp>, state: string, c: MicrosoftIdClaims) => {
      mockMicrosoftStart(state);
      await mobileLoginStart(a);
      exchangeMock.mockResolvedValueOnce(c);
      return (await mobileCallback(a, { state })).headers.location as string;
    };
    const noClaim = (email: string, over: Partial<MicrosoftIdClaims> = {}) => {
      const c = { ...baseClaims(email), ...over };
      delete c.xms_edov;
      return c;
    };

    // Our tenant, allowed domain: linked, and the app gets a one-time code that works.
    const ok = await createUser({ email: `m-nodov-ok-${oidSeq}@${DOMAIN}` });
    const okClaims = noClaim(ok.email);
    const okLoc = await start(appMs(), 's-nodov-ok', okClaims);
    const code = parseAppCode(okLoc);
    expect((await exchange(appMs(), code)).status).toBe(200);
    expect((await UserModel.findById(ok._id))?.msOid).toBe(okClaims.oid);
    expect(
      (await ActivityLogModel.findOne({ action: 'sso_linked', entityId: ok._id }))?.meta,
    ).toMatchObject({ emailVerifiedBy: 'allowed_tenant_domain' });

    // Another tenant: refused.
    const tid = await createUser({ email: `m-nodov-tid-${oidSeq}@${DOMAIN}` });
    expect(
      await start(
        appMs(),
        's-nodov-tid',
        noClaim(tid.email, { tid: '99999999-9999-9999-9999-999999999999' }),
      ),
    ).toBe('opstrack://auth/microsoft?error=ms_signin_failed');
    expect((await UserModel.findById(tid._id))?.msOid).toBeFalsy();

    // A domain that isn't allowed (the account stays @xceler8.example; only the allow-list differs).
    const dom = await createUser({ email: `m-nodov-dom-${oidSeq}@${DOMAIN}` });
    expect(
      await start(
        appMs({ MS_ALLOWED_DOMAINS: 'partner.xceler8.example' }),
        's-nodov-dom',
        noClaim(dom.email),
      ),
    ).toBe('opstrack://auth/microsoft?error=ms_signin_failed');
    expect((await UserModel.findById(dom._id))?.msOid).toBeFalsy();

    // Claim false: refused with its own code.
    const no = await createUser({ email: `m-dov-false-${oidSeq}@${DOMAIN}` });
    expect(await start(appMs(), 's-dov-false', { ...baseClaims(no.email), xms_edov: false })).toBe(
      'opstrack://auth/microsoft?error=ms_email_unverified',
    );
    expect((await UserModel.findById(no._id))?.msOid).toBeFalsy();

    // Only the first one got a one-time code; only it was linked.
    expect(await ActivityLogModel.countDocuments({ action: 'sso_linked' })).toBe(1);
    expect(
      (await ActivityLogModel.find({ action: 'sso_link_refused' }).lean()).map((e) => e.reason),
    ).toEqual(['ms_email_unverified']);
  });

  it('9 access_denied → cancelled and pending removed', async () => {
    const a = appMs();
    mockMicrosoftStart('state-cancel');
    await mobileLoginStart(a);
    expect(await MobileAuthCodeModel.countDocuments({ phase: 'pending' })).toBe(1);
    const cb = await mobileCallback(a, { state: 'state-cancel', error: 'access_denied' });
    expect(cb.headers.location).toMatch(/error=cancelled/);
    expect(await MobileAuthCodeModel.countDocuments()).toBe(0);
  });

  it('10 browser Origin on exchange → MOBILE_ONLY', async () => {
    const a = appMs();
    const { code } = await happyPathThroughCallback(a, baseClaims());
    const res = await exchange(a, code, MS_VERIFIER, { Origin: 'http://localhost:5173' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MOBILE_ONLY');
  });

  it('11 web callback still works with mobile pending doc; states are not interchangeable', async () => {
    const a = appMs();
    mockMicrosoftStart('mobile-only-state');
    await mobileLoginStart(a);
    expect(await MobileAuthCodeModel.countDocuments({ phase: 'pending' })).toBe(1);

    loginUrlMock.mockResolvedValueOnce({
      url: 'https://login.microsoftonline.com/mock',
      codeVerifier: 'verifier-12345678901234567890123456789012',
      state: 'state-abc',
      nonce: 'nonce-xyz',
    });
    const agent = request.agent(a);
    await agent.get('/api/v1/auth/microsoft/login');
    const claims = baseClaims(`web-${oidSeq}@${DOMAIN}`);
    exchangeMock.mockResolvedValueOnce(claims);
    const webCb = await agent
      .get('/api/v1/auth/microsoft/callback')
      .query({ code: 'c', state: 'state-abc' });
    expect(webCb.headers.location).toBe('http://localhost:5173');
    // The web flow did not consume the mobile pending state.
    expect(await MobileAuthCodeModel.countDocuments({ phase: 'pending' })).toBe(1);

    // A web state replayed without its cookie is not accepted as a mobile state.
    const webReplay = await mobileCallback(a, { state: 'state-abc' });
    expect(webReplay.headers.location).not.toMatch(/^opstrack:/);
    expect(webReplay.headers.location).toMatch(/error=ms_signin_failed/);
    expect(await MobileAuthCodeModel.countDocuments({ phase: 'code' })).toBe(0);

    // The mobile state still finishes on the app deep link, with no web session cookie.
    exchangeMock.mockResolvedValueOnce(claims);
    const mobileCb = await mobileCallback(a, { state: 'mobile-only-state' });
    parseAppCode(mobileCb.headers.location);
    expect(String(mobileCb.headers['set-cookie'] ?? '')).not.toMatch(/xc8_sid=[^;]/);
  });

  it('12 state and one-time code stored only as hashes; RFC 7636 S256 vector', async () => {
    const a = appMs();
    mockMicrosoftStart();
    await mobileLoginStart(a);
    const pending = await MobileAuthCodeModel.findOne({ phase: 'pending' }).lean();
    expect(pending!.keyHash).toBe(sha256(MOBILE_STATE));
    expect(JSON.stringify(pending)).not.toContain(MOBILE_STATE);

    exchangeMock.mockResolvedValueOnce(baseClaims());
    const cb = await mobileCallback(a);
    const code = parseAppCode(cb.headers.location);
    const stored = await MobileAuthCodeModel.findOne({ phase: 'code' }).lean();
    expect(stored!.keyHash).toBe(sha256(code));
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(s256(MS_VERIFIER)).toBe(MOBILE_CHALLENGE);
    await exchange(a, code);
    expect(await MobileAuthCodeModel.countDocuments()).toBe(0);
  });
});
