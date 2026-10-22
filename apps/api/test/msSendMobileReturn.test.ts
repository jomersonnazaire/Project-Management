import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestTime, setTestTime } from '../src/lib/clock.js';
import { ActivityLogModel, MobileMailStateModel, UserModel } from '../src/models/index.js';
import { MS_MAIL_COOKIE } from '../src/services/microsoftOAuthCookie.js';
import { MOBILE_MAIL_RETURN } from '../src/services/msSendReturn.js';
import { sha256 } from '../src/services/tokens.js';
import { CSRF, PASSWORD, createUser, login, makeApp, useDatabase } from './helpers.js';

/**
 * Mobile DAR Send: POST /dar/saved/:id/send/mobile (bearer) keeps the OAuth state server-side;
 * the callback returns to the fixed opstrack://auth/mail address with a one-time code only, and
 * the app reads the outcome with POST /auth/mobile/mail/confirm. Web Send is unchanged.
 */
useDatabase();

const MS_ENV: Record<string, string> = {
  MS_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  MS_CLIENT_ID: 'client-id-ms-test',
  MS_CLIENT_SECRET: 'ms-test-client-secret-32chars-minimum!!',
  MS_REDIRECT_URI: 'http://localhost:5173/api/auth/microsoft/callback',
  MS_ALLOWED_TENANT_IDS: '11111111-1111-1111-1111-111111111111',
  MS_ALLOWED_DOMAINS: 'xceler8.example',
  EDGE_PROXY_SECRET: 'edge-secret-for-ms-oauth-tests-0123456789ab',
};
const TID = '11111111-1111-1111-1111-111111111111';
const TOKEN = 'mock-mail-access-token-never-in-url';
const CODE = 'auth-code-from-microsoft-never-in-url';
const VERIFIER = 'verifier-mobile-mail-1234567890123456789012345';
// App-side PKCE for the result code: RFC 7636 Appendix B test vector.
const APP_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const APP_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PKCE = { code_challenge: APP_CHALLENGE, code_challenge_method: 'S256' };

const loginUrlMock = vi.fn();
const mailExchangeMock = vi.fn();
vi.mock('../src/services/microsoftAuth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    buildMicrosoftLoginUrl: (...args: unknown[]) => loginUrlMock(...args),
    exchangeMicrosoftMailCode: (...args: unknown[]) => mailExchangeMock(...args),
  };
});

const app = makeApp({ ...MS_ENV, EMAIL_NOTIFICATIONS_ENABLED: 'true' });

let seq = 0;
let oidSeq = 0;
function nextLogin() {
  seq += 1;
  const state = `mobile-mail-state-${seq}-${Date.now()}`;
  loginUrlMock.mockResolvedValueOnce({
    url: `https://login.microsoftonline.com/mock?state=${state}`,
    codeVerifier: VERIFIER,
    state,
    nonce: `nonce-mobile-${seq}`,
  });
  return state;
}
async function link(userId: unknown) {
  oidSeq += 1;
  const oid = `cccccccc-cccc-cccc-cccc-${String(oidSeq).padStart(12, '0')}`;
  await UserModel.updateOne({ _id: userId }, { $set: { msOid: oid, msTid: TID } });
  return oid;
}
const msToken = (oid: string, over: Record<string, unknown> = {}) => ({
  oid,
  tid: TID,
  acct: 0,
  idp: `https://sts.windows.net/${TID}/`,
  accessToken: TOKEN,
  scopes: ['Mail.Send'],
  ...over,
});
async function mobileToken(email: string) {
  const res = await request(app)
    .post('/api/v1/auth/mobile/login')
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.token as string;
}
const callback = (query: Record<string, string>, cookie?: string) => {
  const r = request(app).get('/api/v1/auth/microsoft/callback').query(query);
  if (cookie) r.set('Cookie', cookie);
  return r;
};
const graph202 = () =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
const setCookies = (res: request.Response) => {
  const c = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  return (Array.isArray(c) ? c : [c ?? '']).join('; ');
};
function parseReturn(location: string) {
  const u = new URL(location);
  return {
    base: `${u.protocol}//${u.host}${u.pathname}`,
    params: Object.fromEntries(u.searchParams),
  };
}
function expectNoSecrets(location: string, state: string) {
  for (const secret of [TOKEN, CODE, state, VERIFIER, 'nonce-mobile']) {
    expect(location).not.toContain(secret);
  }
}
/** The deep link carries only a one-time code (or an error); returns the code. */
function appCode(location: string) {
  const { base, params } = parseReturn(location);
  expect(base).toBe(MOBILE_MAIL_RETURN);
  expect(Object.keys(params)).toEqual(['code']);
  return params.code!;
}
const confirm = (
  bearer: string | null,
  code: string,
  body: Record<string, unknown> = { code_verifier: APP_VERIFIER },
  cookie?: string,
) => {
  const r = request(app)
    .post('/api/v1/auth/mobile/mail/confirm')
    .set(CSRF)
    .send({ code, ...body });
  if (bearer) r.set('Authorization', `Bearer ${bearer}`);
  if (cookie) r.set('Cookie', cookie);
  return r;
};
const WEB_REJECT = 'http://localhost:5173/login?error=ms_signin_failed';

async function darMember() {
  const supervisor = await createUser({ email: 'sup-m@xceler8.example', name: 'Supervisor Sam' });
  const member = await createUser({ email: 'mem-m@xceler8.example', systemRole: 'MEMBER' });
  const oid = await link(member._id);
  await UserModel.updateOne({ _id: member._id }, { $set: { supervisorId: supervisor._id } });
  const agent = await login(app, member.email, PASSWORD);
  const saved = await agent
    .post('/api/v1/dar/saved')
    .set(CSRF)
    .send({ from: '2026-10-12', to: '2026-10-16' });
  expect(saved.status).toBe(201);
  const bearer = await mobileToken(member.email);
  return { member, supervisor, oid, agent, bearer, savedId: saved.body.item.id as string };
}
async function startDarMobile(
  bearer: string,
  savedId: string,
  extra: Record<string, unknown> = {},
) {
  const state = nextLogin();
  const res = await request(app)
    .post(`/api/v1/dar/saved/${savedId}/send/mobile`)
    .set(CSRF)
    .set('Authorization', `Bearer ${bearer}`)
    .send({ ...PKCE, ...extra });
  return { res, state };
}

beforeEach(async () => {
  loginUrlMock.mockReset();
  mailExchangeMock.mockReset();
  await UserModel.deleteMany({});
  await MobileMailStateModel.deleteMany({});
});
afterEach(async () => {
  vi.restoreAllMocks();
  resetTestTime();
});

describe('Mobile DAR Send: opstrack://auth/mail + one-time code', () => {
  it('start: no cookie, state hashed server-side; callback sends and returns only a one-time code', async () => {
    const { oid, bearer, savedId } = await darMember();
    const { res, state } = await startDarMobile(bearer, savedId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ url: expect.stringContaining(state) });
    expect(setCookies(res)).not.toContain(MS_MAIL_COOKIE);
    const doc = await MobileMailStateModel.findOne({ phase: 'pending' }).lean();
    expect(doc?.keyHash).toBe(sha256(state));
    expect(doc?.flow).toBe('dar');
    expect(doc?.codeChallenge).toBe(APP_CHALLENGE);
    expect(JSON.stringify(doc)).not.toContain(state);

    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    const spy = graph202();
    const done = await callback({ code: CODE, state });
    expect(done.status).toBe(302);
    const loc = done.headers.location as string;
    expect(loc).toMatch(/^opstrack:\/\/auth\/mail\?code=[A-Za-z0-9_-]+$/);
    const oneTime = appCode(loc);
    expectNoSecrets(loc, state);
    expect(spy).toHaveBeenCalledTimes(1);
    // Nonce + verifier from the stored state reach the token exchange (#32 still holds).
    expect(mailExchangeMock.mock.calls[0]?.slice(1)).toEqual([
      CODE,
      VERIFIER,
      `nonce-mobile-${seq}`,
    ]);
    expect(
      await ActivityLogModel.countDocuments({ action: 'report_sent', entityId: savedId }),
    ).toBe(1);
    // The result record is keyed by the code's hash and holds no Microsoft token.
    const result = await MobileMailStateModel.findOne({ phase: 'result' }).lean();
    expect(result?.keyHash).toBe(sha256(oneTime));
    expect(result?.codeChallenge).toBe(APP_CHALLENGE);
    expect(JSON.stringify(result)).not.toContain(oneTime);
    expect(JSON.stringify(result)).not.toContain(TOKEN);

    const ok = await confirm(bearer, oneTime);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // No CC set: To only.
    expect(ok.body).toEqual({ flow: 'dar', report: savedId, sent: savedId, recipients: 1 });
    // Single use.
    const again = await confirm(bearer, oneTime);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_CODE');
    expect(await MobileMailStateModel.countDocuments({})).toBe(0);
  });

  it('confirm: only the same user with a bearer token; web cookie or another user is refused', async () => {
    const { oid, agent, bearer, savedId } = await darMember();
    const other = await createUser({ email: 'other-m@xceler8.example', systemRole: 'MEMBER' });
    const otherBearer = await mobileToken(other.email);
    const { state } = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    graph202();
    const oneTime = appCode((await callback({ code: CODE, state })).headers.location as string);

    expect((await confirm(null, oneTime)).status).toBe(401);
    const web = await agent
      .post('/api/v1/auth/mobile/mail/confirm')
      .set(CSRF)
      .send({ code: oneTime, code_verifier: APP_VERIFIER });
    expect(web.status).toBe(403);
    expect((await confirm(otherBearer, oneTime)).status).toBe(400);
    // Still there for the right user.
    expect((await confirm(bearer, oneTime)).body.sent).toBe(savedId);
  });

  it('confirm: the one-time code expires after 60 seconds', async () => {
    const { oid, bearer, savedId } = await darMember();
    const t0 = Date.now();
    setTestTime(t0);
    const { state } = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValue(msToken(oid));
    graph202();
    const oneTime = appCode((await callback({ code: CODE, state })).headers.location as string);
    const result = await MobileMailStateModel.findOne({ phase: 'result' }).lean();
    expect(result?.expiresAt.getTime()).toBe(t0 + 60_000);
    setTestTime(t0 + 61_000);
    const late = await confirm(bearer, oneTime);
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('INVALID_CODE');

    // Within 60 seconds it works.
    setTestTime(t0 + 120_000);
    // Sent 2 minutes ago: sending it again needs the explicit confirm.
    const b = await startDarMobile(bearer, savedId, { confirmResend: true });
    const code2 = appCode(
      (await callback({ code: CODE, state: b.state })).headers.location as string,
    );
    setTestTime(t0 + 120_000 + 59_000);
    expect((await confirm(bearer, code2)).body.sent).toBe(savedId);
  });

  it('timeout: the app reads send_error=result_unavailable; a re-send always needs confirmResend (CR-16)', async () => {
    const { oid, bearer, savedId } = await darMember();
    const t0 = Date.now();
    setTestTime(t0);
    const { state } = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValue(msToken(oid));
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    );
    const oneTime = appCode((await callback({ code: CODE, state })).headers.location as string);
    expect((await confirm(bearer, oneTime)).body).toEqual({
      flow: 'dar',
      report: savedId,
      send_error: 'result_unavailable',
      recipients: 0,
    });
    // No time window: a day later the app still has to confirm.
    setTestTime(t0 + 86_400_000);
    const blocked = await startDarMobile(bearer, savedId);
    expect(blocked.res.status).toBe(409);
    expect(blocked.res.body.error).toMatchObject({
      code: 'ALREADY_SENT_OR_UNKNOWN',
      details: { state: 'unknown', lastAttemptAt: new Date(t0).toISOString() },
    });
    expect(await MobileMailStateModel.countDocuments({ phase: 'pending' })).toBe(0);
    const ok = await startDarMobile(bearer, savedId, { confirmResend: true });
    expect(ok.res.status).toBe(200);
    expect(await MobileMailStateModel.countDocuments({ phase: 'pending' })).toBe(1);
  });

  it('confirm: a wrong or missing PKCE verifier is refused, and the code is then spent', async () => {
    const { oid, bearer, savedId } = await darMember();
    const { state } = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValue(msToken(oid));
    graph202();
    const oneTime = appCode((await callback({ code: CODE, state })).headers.location as string);
    // Missing or malformed verifier: refused by the strict body, code not touched.
    expect((await confirm(bearer, oneTime, {})).status).toBe(400);
    expect((await confirm(bearer, oneTime, { code_verifier: 'short' })).status).toBe(400);
    expect(await MobileMailStateModel.countDocuments({ phase: 'result' })).toBe(1);
    // Well-formed but wrong verifier: INVALID_CODE, and the code is spent (no guessing).
    const wrong = await confirm(bearer, oneTime, { code_verifier: 'x'.repeat(43) });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_CODE');
    expect((await confirm(bearer, oneTime)).status).toBe(400);
    // The deep link alone never proved anything: the send is audited server-side only.
    expect(
      await ActivityLogModel.countDocuments({ action: 'report_sent', entityId: savedId }),
    ).toBe(1);
  });

  it('single use: a replayed callback with the same state does not send and is rejected', async () => {
    const { oid, bearer, savedId } = await darMember();
    const { state } = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValue(msToken(oid));
    const spy = graph202();
    appCode((await callback({ code: CODE, state })).headers.location as string);
    const replay = await callback({ code: CODE, state });
    expect(replay.status).toBe(302);
    expect(replay.headers.location).toBe(WEB_REJECT);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('bad, missing or expired state is rejected and never reaches the app address', async () => {
    const { bearer, savedId } = await darMember();
    const { state } = await startDarMobile(bearer, savedId);
    const bad: Record<string, string>[] = [{ code: CODE, state: 'not-the-state' }, { code: CODE }];
    for (const q of bad) {
      const r = await callback(q);
      expect(r.status).toBe(302);
      expect(r.headers.location).toBe(WEB_REJECT);
    }
    expect(mailExchangeMock).not.toHaveBeenCalled();
    setTestTime(Date.now() + 11 * 60_000);
    const late = await callback({ code: CODE, state });
    expect(late.headers.location).toBe(WEB_REJECT);
    expect(mailExchangeMock).not.toHaveBeenCalled();
  });

  it('failures come back through confirm as send_error=<reason> (cancel, wrong account)', async () => {
    const { bearer, savedId } = await darMember();
    const a = await startDarMobile(bearer, savedId);
    const cancelled = await callback({
      state: a.state,
      error: 'access_denied',
      error_description: 'AADSTS65004: declined',
    });
    const c1 = appCode(cancelled.headers.location as string);
    expect((await confirm(bearer, c1)).body).toEqual({
      flow: 'dar',
      report: savedId,
      send_error: 'consent_declined',
      recipients: 0,
    });

    const b = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValueOnce(msToken('dddddddd-0000-0000-0000-000000000000'));
    const wrong = await callback({ code: CODE, state: b.state });
    const loc = wrong.headers.location as string;
    expectNoSecrets(loc, b.state);
    expect((await confirm(bearer, appCode(loc))).body).toEqual({
      flow: 'dar',
      report: savedId,
      send_error: 'wrong_account',
      recipients: 0,
    });
  });

  it('start: bearer only, PKCE S256 required, and the client cannot choose a return address', async () => {
    const { agent, bearer, savedId } = await darMember();
    const web = await agent.post(`/api/v1/dar/saved/${savedId}/send/mobile`).set(CSRF).send(PKCE);
    expect(web.status).toBe(403);
    expect(web.body.error.code).toBe('MOBILE_ONLY');
    const post = (body: Record<string, unknown>) =>
      request(app)
        .post(`/api/v1/dar/saved/${savedId}/send/mobile`)
        .set(CSRF)
        .set('Authorization', `Bearer ${bearer}`)
        .send(body);
    for (const body of [
      {},
      { code_challenge: APP_CHALLENGE },
      { code_challenge: APP_CHALLENGE, code_challenge_method: 'plain' },
      { code_challenge: 'too-short', code_challenge_method: 'S256' },
      { ...PKCE, returnUrl: 'https://evil.example/' },
      { ...PKCE, redirect_uri: 'opstrack://elsewhere' },
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(loginUrlMock).not.toHaveBeenCalled();
    expect(await MobileMailStateModel.countDocuments({})).toBe(0);
  });

  it('recipients counts every address in the sent message (To + CC), and 0 when Graph refuses', async () => {
    const { oid, member, bearer, savedId } = await darMember();
    await UserModel.updateOne(
      { _id: member._id },
      // Sender and duplicates are dropped by buildDarCc: To + 2 CC = 3.
      { $set: { reportCc: ['cc1@xceler8.example', 'cc2@xceler8.example', member.email] } },
    );
    const a = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValue(msToken(oid));
    const spy = graph202();
    const okCode = appCode(
      (await callback({ code: CODE, state: a.state })).headers.location as string,
    );
    const msg = JSON.parse(String(spy.mock.calls[0]![1]!.body)).message;
    expect(msg.toRecipients.length + msg.ccRecipients.length).toBe(3);
    expect((await confirm(bearer, okCode)).body).toEqual({
      flow: 'dar',
      report: savedId,
      sent: savedId,
      recipients: 3,
    });

    spy.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status: 403 }),
    );
    const b = await startDarMobile(bearer, savedId, { confirmResend: true });
    const failCode = appCode(
      (await callback({ code: CODE, state: b.state })).headers.location as string,
    );
    expect((await confirm(bearer, failCode)).body).toEqual({
      flow: 'dar',
      report: savedId,
      send_error: 'send_forbidden',
      recipients: 0,
    });
  });

  it('result_unavailable: the redirect is exactly opstrack://auth/mail?error=result_unavailable', async () => {
    const { oid, bearer, savedId } = await darMember();
    const orig = MobileMailStateModel.create.bind(MobileMailStateModel);
    vi.spyOn(MobileMailStateModel, 'create').mockImplementation(((doc: { phase?: string }) =>
      doc?.phase === 'result'
        ? Promise.reject(new Error('db down'))
        : orig(doc as never)) as never);
    const { state } = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    graph202();
    const done = await callback({ code: CODE, state });
    expect(done.status).toBe(302);
    // Nothing else: no code, no report id, no outcome.
    expect(done.headers.location).toBe('opstrack://auth/mail?error=result_unavailable');
    expect(done.headers.location).not.toContain(savedId);
    expect(
      await ActivityLogModel.countDocuments({ action: 'report_sent', entityId: savedId }),
    ).toBe(1);
    expect(await MobileMailStateModel.countDocuments({})).toBe(0);
  });

  it('web is unchanged: cookie start, nothing stored server-side, back to /dar/saved', async () => {
    const { oid, agent, savedId } = await darMember();
    const state = nextLogin();
    const res = await agent.post(`/api/v1/dar/saved/${savedId}/send`).set(CSRF).send({});
    expect(res.status).toBe(200);
    const cookie = /xc8_ms_mail=([^;]+)/.exec(setCookies(res))?.[1] ?? '';
    expect(cookie).not.toBe('');
    expect(await MobileMailStateModel.countDocuments({})).toBe(0);
    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    graph202();
    const done = await callback({ code: CODE, state }, `${MS_MAIL_COOKIE}=${cookie}`);
    expect(done.headers.location).toBe(`http://localhost:5173/dar/saved?sent=${savedId}`);
    const state2 = nextLogin();
    await agent.post(`/api/v1/dar/saved/${savedId}/send`).set(CSRF).send({});
    const noCookie = await callback({ code: CODE, state: state2 });
    expect(noCookie.headers.location).toBe(WEB_REJECT);
  });
});
