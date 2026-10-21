import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestTime, setTestTime } from '../src/lib/clock.js';
import {
  ActivityLogModel,
  MobileMailStateModel,
  TaskModel,
  UserModel,
} from '../src/models/index.js';
import { MS_MAIL_COOKIE } from '../src/services/microsoftOAuthCookie.js';
import { MOBILE_SEND_RETURN } from '../src/services/msSendReturn.js';
import { sha256 } from '../src/services/tokens.js';
import { CSRF, PASSWORD, createUser, login, makeApp, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

/**
 * Mobile return path for the Microsoft Mail.Send round trip (DAR Send, action emails).
 * A send started with the mobile bearer token keeps its OAuth state server-side and returns to
 * the fixed opstrack://ms/send-result address with outcome params only. Web is unchanged.
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
async function startDarMobile(bearer: string, savedId: string) {
  const state = nextLogin();
  const res = await request(app)
    .post(`/api/v1/dar/saved/${savedId}/send`)
    .set(CSRF)
    .set('Authorization', `Bearer ${bearer}`)
    .send({});
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

describe('DAR Send from mobile: return to opstrack://ms/send-result', () => {
  it('start: no cookie, state kept hashed server-side; callback returns sent=<id> to the app only', async () => {
    const { oid, bearer, savedId } = await darMember();
    const { res, state } = await startDarMobile(bearer, savedId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ url: expect.stringContaining(state) });
    expect(setCookies(res)).not.toContain(MS_MAIL_COOKIE);
    const doc = await MobileMailStateModel.findOne({}).lean();
    expect(doc?.keyHash).toBe(sha256(state));
    expect(doc?.flow).toBe('dar');
    expect(JSON.stringify(doc)).not.toContain(state);

    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    const spy = graph202();
    const done = await callback({ code: CODE, state });
    expect(done.status).toBe(302);
    const loc = done.headers.location as string;
    const { base, params } = parseReturn(loc);
    expect(base).toBe(MOBILE_SEND_RETURN);
    expect(params).toEqual({ flow: 'dar', report: savedId, sent: savedId });
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
    expect(await MobileMailStateModel.countDocuments({})).toBe(0);
  });

  it('single use: a replayed callback with the same state does not send and is rejected', async () => {
    const { oid, bearer, savedId } = await darMember();
    const { state } = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValue(msToken(oid));
    const spy = graph202();
    expect((await callback({ code: CODE, state })).headers.location).toContain(MOBILE_SEND_RETURN);
    const replay = await callback({ code: CODE, state });
    expect(replay.status).toBe(302);
    expect(replay.headers.location).toBe('http://localhost:5173/login?error=ms_signin_failed');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('bad, missing or expired state is rejected and never reaches the app address', async () => {
    const { bearer, savedId } = await darMember();
    const { state } = await startDarMobile(bearer, savedId);
    const bad: Record<string, string>[] = [{ code: CODE, state: 'not-the-state' }, { code: CODE }];
    for (const q of bad) {
      const r = await callback(q);
      expect(r.status).toBe(302);
      expect(r.headers.location).toBe('http://localhost:5173/login?error=ms_signin_failed');
    }
    expect(mailExchangeMock).not.toHaveBeenCalled();
    // Expired after 10 minutes.
    setTestTime(Date.now() + 11 * 60_000);
    const late = await callback({ code: CODE, state });
    expect(late.headers.location).toBe('http://localhost:5173/login?error=ms_signin_failed');
    expect(mailExchangeMock).not.toHaveBeenCalled();
  });

  it('failures come back as send_error=<reason> (cancel at Microsoft, wrong account)', async () => {
    const { bearer, savedId } = await darMember();
    const a = await startDarMobile(bearer, savedId);
    const cancelled = await callback({
      state: a.state,
      error: 'access_denied',
      error_description: 'AADSTS65004: declined',
    });
    expect(parseReturn(cancelled.headers.location as string)).toEqual({
      base: MOBILE_SEND_RETURN,
      params: { flow: 'dar', report: savedId, send_error: 'consent_declined' },
    });

    const b = await startDarMobile(bearer, savedId);
    mailExchangeMock.mockResolvedValueOnce(msToken('dddddddd-0000-0000-0000-000000000000'));
    const wrong = await callback({ code: CODE, state: b.state });
    const loc = wrong.headers.location as string;
    expect(parseReturn(loc).params).toEqual({
      flow: 'dar',
      report: savedId,
      send_error: 'wrong_account',
    });
    expectNoSecrets(loc, b.state);
  });

  it('the client cannot choose the return address: extra fields are refused', async () => {
    const { bearer, savedId } = await darMember();
    const res = await request(app)
      .post(`/api/v1/dar/saved/${savedId}/send`)
      .set(CSRF)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ returnUrl: 'https://evil.example/' });
    expect(res.status).toBe(400);
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
    // Without the cookie the web callback is still rejected.
    const state2 = nextLogin();
    await agent.post(`/api/v1/dar/saved/${savedId}/send`).set(CSRF).send({});
    const noCookie = await callback({ code: CODE, state: state2 });
    expect(noCookie.headers.location).toBe('http://localhost:5173/login?error=ms_signin_failed');
  });
});

describe('Action emails from mobile: return to opstrack://ms/send-result', () => {
  afterEach(async () => {
    await resetRules();
  });

  it('follow-up: start with bearer, callback returns flow=action&kind&project&task&email=sent', async () => {
    const w = await world(app);
    const oid = await link(w.member.user._id);
    const tasks = await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`);
    const t = tasks.body.items[0] as { id: string; version: number };
    const assign = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t.version, ownerId: w.member.user._id.toString() });
    expect(assign.status).toBe(200);
    const fu = await w.member.agent
      .post(`/api/v1/tasks/${t.id}/follow-ups`)
      .set(CSRF)
      .send({ note: 'Called the client' });
    const followUpId = fu.body.task.followUps.at(-1).id as string;

    const bearer = await mobileToken(w.member.user.email);
    const state = nextLogin();
    const res = await request(app)
      .post('/api/v1/action-emails')
      .set(CSRF)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ kind: 'FOLLOW_UP', taskId: t.id, followUpId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ url: expect.stringContaining(state), recipients: 1 });
    expect(setCookies(res)).not.toContain('xc8_ms_act');

    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    graph202();
    const done = await callback({ code: CODE, state });
    const loc = done.headers.location as string;
    expect(parseReturn(loc)).toEqual({
      base: MOBILE_SEND_RETURN,
      params: {
        flow: 'action',
        kind: 'FOLLOW_UP',
        project: w.project.id,
        task: t.id,
        email: 'sent',
      },
    });
    expectNoSecrets(loc, state);
    const task = await TaskModel.findById(t.id).lean();
    expect(task?.followUps.at(-1)?.emailedAt).toBeInstanceOf(Date);

    // Replay: rejected, nothing sent again.
    const replay = await callback({ code: CODE, state });
    expect(replay.headers.location).toBe('http://localhost:5173/login?error=ms_signin_failed');
  });
});
