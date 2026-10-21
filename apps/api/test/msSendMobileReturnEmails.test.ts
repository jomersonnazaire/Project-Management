import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestTime, setTestTime } from '../src/lib/clock.js';
import { MobileMailStateModel, TaskModel, UserModel } from '../src/models/index.js';
import { MS_ACTION_EMAIL_COOKIE } from '../src/services/microsoftOAuthCookie.js';
import { MOBILE_MAIL_RETURN } from '../src/services/msSendReturn.js';
import { sha256 } from '../src/services/tokens.js';
import { CSRF, PASSWORD, createUser, makeApp, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

/**
 * Mobile action emails (stacked on the mobile DAR Send return, #36): POST /action-emails/mobile
 * and `emailReturn: 'mobile'` + PKCE on task / project saves. Same pattern as DAR: the OAuth state
 * is kept server-side (hashed), the callback returns to exactly opstrack://auth/mail?code=…,
 * and POST /auth/mobile/mail/confirm {code, code_verifier} gives the outcome once, within 60 s,
 * to the same user. Web stays unchanged. MSAL and Graph are faked.
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
const TOKEN = 'mock-delegated-token-never-in-url';
const CODE = 'auth-code-from-microsoft-never-in-url';
const VERIFIER = 'verifier-act-mobile-123456789012345678901234567';
// App-side PKCE: RFC 7636 Appendix B test vector.
const APP_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const APP_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const PKCE = { code_challenge: APP_CHALLENGE, code_challenge_method: 'S256' };
const MOBILE = { emailReturn: 'mobile', ...PKCE };
const LINK_RE = /^opstrack:\/\/auth\/mail\?code=[A-Za-z0-9_-]+$/;
const WEB_REJECT = 'http://localhost:5173/login?error=ms_signin_failed';

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
type W = Awaited<ReturnType<typeof world>>;

let seq = 0;
let oidSeq = 0;
function nextLogin() {
  seq += 1;
  const state = `act-mobile-state-${seq}-${Date.now()}`;
  loginUrlMock.mockResolvedValueOnce({
    url: `https://login.microsoftonline.com/mock?state=${state}`,
    codeVerifier: VERIFIER,
    state,
    nonce: `nonce-act-${seq}`,
  });
  return state;
}
async function link(userId: unknown) {
  oidSeq += 1;
  const oid = `eeeeeeee-eeee-eeee-eeee-${String(oidSeq).padStart(12, '0')}`;
  await UserModel.updateOne({ _id: userId }, { $set: { msOid: oid, msTid: TID } });
  return oid;
}
const msToken = (oid: string) => ({
  oid,
  tid: TID,
  acct: 0,
  idp: `https://sts.windows.net/${TID}/`,
  accessToken: TOKEN,
  scopes: ['Mail.Send'],
});
async function mobileToken(email: string) {
  const res = await request(app)
    .post('/api/v1/auth/mobile/login')
    .set(CSRF)
    .send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.token as string;
}
const bearerReq = (bearer: string) => ({
  post: (url: string) => request(app).post(url).set(CSRF).set('Authorization', `Bearer ${bearer}`),
  patch: (url: string) =>
    request(app).patch(url).set(CSRF).set('Authorization', `Bearer ${bearer}`),
});
const callback = (query: Record<string, string>, cookie?: string) => {
  const r = request(app).get('/api/v1/auth/microsoft/callback').query(query);
  if (cookie) r.set('Cookie', cookie);
  return r;
};
const confirm = (
  bearer: string,
  code: string,
  body: Record<string, unknown> = { code_verifier: APP_VERIFIER },
) =>
  request(app)
    .post('/api/v1/auth/mobile/mail/confirm')
    .set(CSRF)
    .set('Authorization', `Bearer ${bearer}`)
    .send({ code, ...body });
const graph = (status = 202) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      status === 202
        ? new Response(null, { status })
        : new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status }),
    );
const setCookies = (res: request.Response) => {
  const c = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  return (Array.isArray(c) ? c : [c ?? '']).join('; ');
};
/** The deep link is exactly opstrack://auth/mail?code=…; returns the code. */
function appCode(res: request.Response, state: string) {
  expect(res.status).toBe(302);
  const loc = res.headers.location as string;
  expect(loc).toMatch(LINK_RE);
  for (const secret of [TOKEN, CODE, state, VERIFIER, 'nonce-act']) {
    expect(loc).not.toContain(secret);
  }
  const u = new URL(loc);
  expect(`${u.protocol}//${u.host}${u.pathname}`).toBe(MOBILE_MAIL_RETURN);
  return u.searchParams.get('code')!;
}

async function firstTask(w: W) {
  const res = await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`);
  return res.body.items[0] as { id: string; version: number; name: string };
}
async function taskVersion(w: W, taskId: string) {
  return (await w.pm.agent.get(`/api/v1/tasks/${taskId}`)).body.task.version as number;
}
/** Member owns the first task and posts a follow-up; returns ids and the member's bearer. */
async function followUpSetup(w: W) {
  const oid = await link(w.member.user._id);
  const t = await firstTask(w);
  const a = await w.pm.agent
    .patch(`/api/v1/tasks/${t.id}`)
    .set(CSRF)
    .send({ version: t.version, ownerId: w.member.user._id.toString() });
  expect(a.status).toBe(200);
  const fu = await w.member.agent
    .post(`/api/v1/tasks/${t.id}/follow-ups`)
    .set(CSRF)
    .send({ note: 'Called the client' });
  const followUpId = fu.body.task.followUps.at(-1).id as string;
  const bearer = await mobileToken(w.member.user.email);
  return { oid, taskId: t.id, followUpId, bearer };
}

beforeEach(() => {
  loginUrlMock.mockReset();
  mailExchangeMock.mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  resetTestTime();
  await MobileMailStateModel.deleteMany({});
  await resetRules();
});

describe('POST /action-emails/mobile (follow-up email from the app)', () => {
  it('start: no cookie, state hashed with the challenge; confirm gives flow=action_email once', async () => {
    const w = await world(app);
    const { oid, taskId, followUpId, bearer } = await followUpSetup(w);
    const state = nextLogin();
    const res = await bearerReq(bearer)
      .post('/api/v1/action-emails/mobile')
      .send({ kind: 'FOLLOW_UP', taskId, followUpId, ...PKCE });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ url: expect.stringContaining(state), recipients: 1 });
    expect(setCookies(res)).not.toContain(MS_ACTION_EMAIL_COOKIE);
    const pending = await MobileMailStateModel.findOne({ phase: 'pending' }).lean();
    expect(pending).toMatchObject({
      keyHash: sha256(state),
      flow: 'action',
      codeChallenge: APP_CHALLENGE,
    });
    expect(JSON.stringify(pending)).not.toContain(state);

    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    const spy = graph();
    const code = appCode(await callback({ code: CODE, state }), state);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(mailExchangeMock.mock.calls[0]?.slice(1)).toEqual([CODE, VERIFIER, `nonce-act-${seq}`]);
    const result = await MobileMailStateModel.findOne({ phase: 'result' }).lean();
    expect(result?.keyHash).toBe(sha256(code));
    expect(JSON.stringify(result)).not.toContain(code);
    expect(JSON.stringify(result)).not.toContain(TOKEN);

    const ok = await confirm(bearer, code);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({
      flow: 'action_email',
      project: w.project.id,
      task: taskId,
      followUp: followUpId,
      email: 'sent',
      recipients: 1,
    });
    expect((await confirm(bearer, code)).body.error.code).toBe('INVALID_CODE');
    const task = await TaskModel.findById(taskId).lean();
    expect(task?.followUps.at(-1)?.emailedAt).toBeInstanceOf(Date);
    // Replay of the callback: rejected, nothing sent again.
    expect((await callback({ code: CODE, state })).headers.location).toBe(WEB_REJECT);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('start: bearer only, PKCE S256 required, no return URL accepted', async () => {
    const w = await world(app);
    const { taskId, followUpId, bearer } = await followUpSetup(w);
    const base = { kind: 'FOLLOW_UP', taskId, followUpId };
    const web = await w.member.agent
      .post('/api/v1/action-emails/mobile')
      .set(CSRF)
      .send({ ...base, ...PKCE });
    expect(web.status).toBe(403);
    expect(web.body.error.code).toBe('MOBILE_ONLY');
    for (const body of [
      base,
      { ...base, code_challenge: APP_CHALLENGE },
      { ...base, code_challenge: APP_CHALLENGE, code_challenge_method: 'plain' },
      { ...base, code_challenge: 'short', code_challenge_method: 'S256' },
      { ...base, ...PKCE, returnUrl: 'https://evil.example/' },
    ]) {
      const r = await bearerReq(bearer).post('/api/v1/action-emails/mobile').send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(loginUrlMock).not.toHaveBeenCalled();
    expect(await MobileMailStateModel.countDocuments({})).toBe(0);
  });

  it('Graph refusing: confirm gives email_error with recipients 0, and the follow-up can be retried', async () => {
    const w = await world(app);
    const { oid, taskId, followUpId, bearer } = await followUpSetup(w);
    const state = nextLogin();
    await bearerReq(bearer)
      .post('/api/v1/action-emails/mobile')
      .send({ kind: 'FOLLOW_UP', taskId, followUpId, ...PKCE });
    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    graph(403);
    const code = appCode(await callback({ code: CODE, state }), state);
    expect((await confirm(bearer, code)).body).toEqual({
      flow: 'action_email',
      project: w.project.id,
      task: taskId,
      followUp: followUpId,
      email_error: 'send_forbidden',
      recipients: 0,
    });
    const task = await TaskModel.findById(taskId).lean();
    expect(task?.followUps.at(-1)?.emailedAt ?? null).toBeNull();
  });
});

describe("Task and project saves with emailReturn: 'mobile'", () => {
  it('task assigned: email.url uses the mobile flow; confirm gives flow=task_assigned', async () => {
    const w = await world(app);
    const oid = await link(w.pm.user._id);
    const bearer = await mobileToken(w.pm.user.email);
    const t = await firstTask(w);
    const state = nextLogin();
    const res = await bearerReq(bearer)
      .patch(`/api/v1/tasks/${t.id}`)
      .send({
        version: t.version,
        ownerId: w.member.user._id.toString(),
        emailNewAssignees: true,
        ...MOBILE,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.email).toEqual({
      url: expect.stringContaining(state),
      error: null,
      message: null,
      recipients: 1,
    });
    expect(setCookies(res)).not.toContain(MS_ACTION_EMAIL_COOKIE);
    // Not stored on the task.
    const raw = (await TaskModel.findById(t.id).lean()) as Record<string, unknown>;
    expect(raw.emailReturn).toBeUndefined();
    expect(raw.code_challenge).toBeUndefined();

    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    const spy = graph();
    const code = appCode(await callback({ code: CODE, state }), state);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await confirm(bearer, code)).body).toEqual({
      flow: 'task_assigned',
      project: w.project.id,
      task: t.id,
      email: 'sent',
      recipients: 1,
    });
  });

  it('task create with emailReturn mobile works the same', async () => {
    const w = await world(app);
    const oid = await link(w.pm.user._id);
    const bearer = await mobileToken(w.pm.user.email);
    const state = nextLogin();
    const res = await bearerReq(bearer)
      .post(`/api/v1/projects/${w.project.id}/tasks`)
      .send({
        name: 'Mobile task',
        ownerId: w.member.user._id.toString(),
        emailNewAssignees: true,
        ...MOBILE,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.email).toMatchObject({ error: null, recipients: 1 });
    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    graph();
    const code = appCode(await callback({ code: CODE, state }), state);
    expect((await confirm(bearer, code)).body).toEqual({
      flow: 'task_assigned',
      project: w.project.id,
      task: res.body.task.id,
      email: 'sent',
      recipients: 1,
    });
  });

  it('project update: added members; confirm gives flow=project_added with the count', async () => {
    const w = await world(app);
    const oid = await link(w.pm.user._id);
    const bearer = await mobileToken(w.pm.user.email);
    const a = await createUser({ name: 'Ana Added' });
    const b = await createUser({ name: 'Bo Added' });
    const state = nextLogin();
    const res = await bearerReq(bearer)
      .patch(`/api/v1/projects/${w.project.id}`)
      .send({
        memberIds: [w.member.user._id.toString(), a._id.toString(), b._id.toString()],
        emailAddedMembers: true,
        ...MOBILE,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.email).toMatchObject({ url: expect.stringContaining(state), recipients: 2 });
    expect(setCookies(res)).not.toContain(MS_ACTION_EMAIL_COOKIE);
    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    const spy = graph();
    const code = appCode(await callback({ code: CODE, state }), state);
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await confirm(bearer, code)).body).toEqual({
      flow: 'project_added',
      project: w.project.id,
      email: 'sent',
      recipients: 2,
    });
  });

  it('save validation: PKCE only with emailReturn mobile, mobile only with a bearer, flags stay booleans', async () => {
    const w = await world(app);
    await link(w.pm.user._id);
    const bearer = await mobileToken(w.pm.user.email);
    const t = await firstTask(w);
    const owner = w.member.user._id.toString();
    const bodies: Record<string, unknown>[] = [
      { emailReturn: 'mobile' },
      { emailReturn: 'mobile', code_challenge: APP_CHALLENGE },
      { emailReturn: 'mobile', code_challenge: APP_CHALLENGE, code_challenge_method: 'plain' },
      { emailReturn: 'web', ...PKCE },
      { ...PKCE },
      { ...MOBILE, returnUrl: 'opstrack://elsewhere' },
      { emailReturn: 'other' },
    ];
    for (const extra of bodies) {
      const r = await bearerReq(bearer)
        .patch(`/api/v1/tasks/${t.id}`)
        .send({ version: t.version, ownerId: owner, emailNewAssignees: true, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    // emailNewAssignees / emailAddedMembers stay booleans (no user ids).
    const ids = await bearerReq(bearer)
      .patch(`/api/v1/tasks/${t.id}`)
      .send({ version: t.version, ownerId: owner, emailNewAssignees: [owner], ...MOBILE });
    expect(ids.status).toBe(400);
    const pids = await bearerReq(bearer)
      .patch(`/api/v1/projects/${w.project.id}`)
      .send({ memberIds: [owner], emailAddedMembers: [owner], ...MOBILE });
    expect(pids.status).toBe(400);
    // Web cookie session asking for the mobile return: refused before anything is saved.
    const web = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t.version, ownerId: owner, emailNewAssignees: true, ...MOBILE });
    expect(web.status).toBe(403);
    expect(web.body.error.code).toBe('MOBILE_ONLY');
    expect(await taskVersion(w, t.id)).toBe(t.version);
    expect(loginUrlMock).not.toHaveBeenCalled();
    expect(await MobileMailStateModel.countDocuments({})).toBe(0);
  });
});

describe('Confirm rules for action emails (same as DAR)', () => {
  async function sentCode(w: W) {
    const { oid, taskId, followUpId, bearer } = await followUpSetup(w);
    const state = nextLogin();
    await bearerReq(bearer)
      .post('/api/v1/action-emails/mobile')
      .send({ kind: 'FOLLOW_UP', taskId, followUpId, ...PKCE });
    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    graph();
    return { code: appCode(await callback({ code: CODE, state }), state), bearer };
  }

  it('wrong or missing verifier is refused; a wrong one spends the code', async () => {
    const w = await world(app);
    const { code, bearer } = await sentCode(w);
    expect((await confirm(bearer, code, {})).status).toBe(400);
    expect(await MobileMailStateModel.countDocuments({ phase: 'result' })).toBe(1);
    const wrong = await confirm(bearer, code, { code_verifier: 'y'.repeat(43) });
    expect(wrong.body.error.code).toBe('INVALID_CODE');
    expect((await confirm(bearer, code)).status).toBe(400);
  });

  it('another user cannot read it; it still works for the right user', async () => {
    const w = await world(app);
    const { code, bearer } = await sentCode(w);
    const otherBearer = await mobileToken(w.outsider.user.email);
    expect((await confirm(otherBearer, code)).status).toBe(400);
    expect((await confirm(bearer, code)).body.flow).toBe('action_email');
  });

  it('expires after 60 seconds', async () => {
    const w = await world(app);
    const t0 = Date.now();
    setTestTime(t0);
    const { code, bearer } = await sentCode(w);
    const result = await MobileMailStateModel.findOne({ phase: 'result' }).lean();
    expect(result?.expiresAt.getTime()).toBe(t0 + 60_000);
    setTestTime(t0 + 61_000);
    expect((await confirm(bearer, code)).body.error.code).toBe('INVALID_CODE');
  });

  it('bad or missing state never reaches the app address', async () => {
    const w = await world(app);
    const { taskId, followUpId, bearer } = await followUpSetup(w);
    nextLogin();
    await bearerReq(bearer)
      .post('/api/v1/action-emails/mobile')
      .send({ kind: 'FOLLOW_UP', taskId, followUpId, ...PKCE });
    const bad: Record<string, string>[] = [{ code: CODE, state: 'not-the-state' }, { code: CODE }];
    for (const q of bad) {
      expect((await callback(q)).headers.location).toBe(WEB_REJECT);
    }
    expect(mailExchangeMock).not.toHaveBeenCalled();
  });
});

describe('Web is unchanged', () => {
  it('web follow-up and task save: cookie, nothing stored server-side, web URL without recipients', async () => {
    const w = await world(app);
    const { oid, taskId, followUpId } = await followUpSetup(w);
    const state = nextLogin();
    const res = await w.member.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'FOLLOW_UP', taskId, followUpId });
    expect(res.status).toBe(200);
    const cookie = /xc8_ms_act=([^;]+)/.exec(setCookies(res))?.[1] ?? '';
    expect(cookie).not.toBe('');
    expect(await MobileMailStateModel.countDocuments({})).toBe(0);
    mailExchangeMock.mockResolvedValueOnce(msToken(oid));
    graph();
    const done = await callback({ code: CODE, state }, `${MS_ACTION_EMAIL_COOKIE}=${cookie}`);
    expect(done.headers.location).toBe(
      `http://localhost:5173/projects/${w.project.id}?task=${taskId}&email=sent`,
    );

    // Web task save with the email ticked: cookie flow as before (emailReturn omitted).
    await link(w.pm.user._id);
    const v = await taskVersion(w, taskId);
    nextLogin();
    const save = await w.pm.agent
      .patch(`/api/v1/tasks/${taskId}`)
      .set(CSRF)
      .send({
        version: v,
        assigneeIds: [w.pm2.user._id.toString()],
        addMemberIds: [w.pm2.user._id.toString()],
        emailNewAssignees: true,
      });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    expect(setCookies(save)).toContain(MS_ACTION_EMAIL_COOKIE);
    expect(await MobileMailStateModel.countDocuments({})).toBe(0);
  });
});
