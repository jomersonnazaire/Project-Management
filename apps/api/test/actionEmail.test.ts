import { ACTION_EMAIL_NOT_LINKED } from '@xc8/shared';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityLogModel, NotificationModel, TaskModel, UserModel } from '../src/models/index.js';
import { actionMailContent } from '../src/services/actionEmail.js';
import { loadConfig } from '../src/config.js';
import { MS_ACTION_EMAIL_COOKIE } from '../src/services/microsoftOAuthCookie.js';
import { CSRF, createUser, makeApp, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

/**
 * Action emails (roadmap §4): follow-up, task assigned and added to project, sent from the
 * actor's own Outlook with delegated Mail.Send (DAR Send's flow). MSAL and Graph are faked:
 * buildMicrosoftLoginUrl / exchangeMicrosoftMailCode are mocked and fetch is spied, so no
 * network is used. Queen's cases FE-xx / FA-xx are named in the test titles.
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
const TOKEN = 'mock-delegated-access-token-never-stored';

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

const appOn = makeApp({ ...MS_ENV, EMAIL_NOTIFICATIONS_ENABLED: 'true' });
const appOff = makeApp(MS_ENV);
type Agent = ReturnType<typeof request.agent>;
type W = Awaited<ReturnType<typeof world>>;

let seq = 0;
let oidSeq = 0;
async function link(userId: unknown) {
  oidSeq += 1;
  const oid = `aaaaaaaa-aaaa-aaaa-aaaa-${String(oidSeq).padStart(12, '0')}`;
  await UserModel.updateOne({ _id: userId }, { $set: { msOid: oid, msTid: TID } });
  return oid;
}
const token = (oid: string, over: Record<string, unknown> = {}) => ({
  oid,
  tid: TID,
  acct: 0,
  idp: `https://sts.windows.net/${TID}/`,
  accessToken: TOKEN,
  scopes: ['Mail.Send'],
  ...over,
});

async function start(agent: Agent, body: Record<string, unknown>) {
  seq += 1;
  const state = `act-state-${seq}-${Date.now()}`;
  loginUrlMock.mockResolvedValueOnce({
    url: `https://login.microsoftonline.com/mock?state=${state}`,
    codeVerifier: 'verifier-act-123456789012345678901234567890',
    state,
    nonce: `nonce-${seq}`,
  });
  const res = await agent.post('/api/v1/action-emails').set(CSRF).send(body);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const raw = (Array.isArray(setCookie) ? setCookie : [setCookie ?? '']).join('; ');
  const cookie = /xc8_ms_act=([^;]+)/.exec(raw)?.[1] ?? '';
  return { res, state, cookie };
}
const callback = (cookie: string, query: Record<string, string>) =>
  request(appOn)
    .get('/api/v1/auth/microsoft/callback')
    .set('Cookie', `${MS_ACTION_EMAIL_COOKIE}=${cookie}`)
    .query(query);

const graph = (status = 202) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      status === 202
        ? new Response(null, { status })
        : new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), { status }),
    );
const sentTo = (spy: ReturnType<typeof graph>) =>
  spy.mock.calls.map(
    (c) => JSON.parse(String(c[1]!.body)).message.toRecipients[0].emailAddress.address as string,
  );

async function firstTask(w: W) {
  const res = await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`);
  return res.body.items[0] as { id: string; version: number; name: string };
}
async function postFollowUp(agent: Agent, taskId: string, note = 'Called the client') {
  const res = await agent.post(`/api/v1/tasks/${taskId}/follow-ups`).set(CSRF).send({ note });
  expect(res.status).toBe(201);
  const f = res.body.task.followUps.at(-1);
  return f.id as string;
}
async function assign(w: W, taskId: string, ownerId: string) {
  const t = (await w.pm.agent.get(`/api/v1/tasks/${taskId}`)).body.task;
  const res = await w.pm.agent
    .patch(`/api/v1/tasks/${taskId}`)
    .set(CSRF)
    .send({ version: t.version, ownerId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeEach(() => {
  loginUrlMock.mockReset();
  mailExchangeMock.mockReset();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetRules();
});

describe('Flag (AC7, FE-03, FA-11)', () => {
  it('is off by default: config, status and the start endpoint all say so', async () => {
    const cfg = loadConfig({ MONGODB_URI: 'mongodb://x', ...MS_ENV });
    expect(cfg.EMAIL_NOTIFICATIONS_ENABLED).toBe(false);
    expect(cfg.actionEmailEnabled).toBe(false);
    // On without Microsoft sign-in configured is still off.
    expect(
      loadConfig({ MONGODB_URI: 'mongodb://x', EMAIL_NOTIFICATIONS_ENABLED: 'true' })
        .actionEmailEnabled,
    ).toBe(false);

    const w = await world(appOff);
    await link(w.pm.user._id);
    expect((await w.pm.agent.get('/api/v1/auth/me/email-status')).body).toEqual({
      enabled: false,
      linked: true,
    });
    const t = await firstTask(w);
    const fu = await postFollowUp(w.pm.agent, t.id);
    const res = await w.pm.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'FOLLOW_UP', taskId: t.id, followUpId: fu });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_DISABLED');
    expect(loginUrlMock).not.toHaveBeenCalled();
  });
});

describe('Unlinked actor (FE-02, FE-08, FA-02, FA-04, FA-05)', () => {
  it('the action and its in-app notification still happen; the email part is refused', async () => {
    const w = await world(appOn);
    expect((await w.member.agent.get('/api/v1/auth/me/email-status')).body).toEqual({
      enabled: true,
      linked: false,
    });
    const t = await firstTask(w);
    await assign(w, t.id, w.member.user._id.toString());
    const before = await NotificationModel.countDocuments({ type: 'FOLLOW_UP' });
    const fu = await postFollowUp(w.member.agent, t.id);
    expect(await NotificationModel.countDocuments({ type: 'FOLLOW_UP' })).toBeGreaterThan(before);
    const spy = graph();
    const res = await w.member.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'FOLLOW_UP', taskId: t.id, followUpId: fu });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'MICROSOFT_NOT_LINKED',
      message: 'Link your Microsoft account to send emails.',
    });
    expect(ACTION_EMAIL_NOT_LINKED).toBe('Link your Microsoft account to send emails.');

    // An unlinked PM assigning or adding members: action works, email refused.
    expect(
      await NotificationModel.countDocuments({ type: 'ASSIGNED', userId: w.member.user._id }),
    ).toBe(1);
    for (const body of [
      { kind: 'TASK_ASSIGNED', taskId: t.id, userIds: [w.member.user._id.toString()] },
      { kind: 'PROJECT_ADDED', projectId: w.project.id, userIds: [w.member.user._id.toString()] },
    ]) {
      const r = await w.pm.agent.post('/api/v1/action-emails').set(CSRF).send(body);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('MICROSOFT_NOT_LINKED');
    }
    expect(loginUrlMock).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Follow-up email from the author’s own Outlook (FE-01, FE-04, FE-11, FE-12, FE-15, FE-16)', () => {
  it('emails each in-app recipient once from /me/sendMail; the in-app follow-up is unchanged', async () => {
    const w = await world(appOn);
    const oid = await link(w.member.user._id);
    const t = await firstTask(w);
    await assign(w, t.id, w.member.user._id.toString());
    const inAppBefore = await NotificationModel.countDocuments({ type: 'FOLLOW_UP' });
    const fu = await postFollowUp(w.member.agent, t.id, 'Client sent the <b>file</b>');
    // In-app: the PM (the member is the owner and the author, so not notified).
    const inApp = await NotificationModel.find({ type: 'FOLLOW_UP' }).skip(inAppBefore).lean();
    expect(inApp.map((n) => n.userId.toString())).toEqual([w.pm.user._id.toString()]);

    const { res, state, cookie } = await start(w.member.agent, {
      kind: 'FOLLOW_UP',
      taskId: t.id,
      followUpId: fu,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: expect.stringContaining(state), recipients: 1 });
    expect(loginUrlMock.mock.calls[0]?.[1]).toEqual({
      scopes: ['Mail.Send'],
      loginHint: w.member.user.email,
    });

    mailExchangeMock.mockResolvedValueOnce(token(oid));
    const spy = graph();
    const done = await callback(cookie, { code: 'c', state });
    expect(done.status).toBe(302);
    expect(done.headers.location).toBe(
      `http://localhost:5173/projects/${w.project.id}?task=${t.id}&email=sent`,
    );
    expect(sentTo(spy)).toEqual([w.pm.user.email]);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const msg = JSON.parse(String(init!.body));
    expect(msg.saveToSentItems).toBe(true);
    expect(msg.message.from).toBeUndefined();
    expect(msg.message.ccRecipients).toBeUndefined();
    expect(msg.message.subject).toBe(`[Rollout P] Follow-up on ${t.name}`);
    expect(msg.message.body.content).toContain('Client sent the &lt;b&gt;file&lt;/b&gt;');
    expect(msg.message.body.content).toContain(
      `href="http://localhost:5173/projects/${w.project.id}?task=${t.id}"`,
    );
    expect(msg.message.body.content).not.toContain(TOKEN);

    // In-app list unchanged by the email; follow-up marked as emailed; audited without secrets.
    expect(await NotificationModel.countDocuments({ type: 'FOLLOW_UP' })).toBe(inAppBefore + 1);
    const task = (await w.member.agent.get(`/api/v1/tasks/${t.id}`)).body.task;
    expect(task.followUps.at(-1).emailedAt).toEqual(expect.any(String));
    const sent = await ActivityLogModel.findOne({
      action: 'action_email_sent',
      entityId: t.id,
    }).lean();
    expect(sent?.meta).toEqual({ kind: 'FOLLOW_UP', followUpId: fu, recipients: 1 });
    expect(JSON.stringify(sent)).not.toContain(TOKEN);

    // FE-11: once per follow-up; a replayed callback sends nothing.
    const again = await w.member.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'FOLLOW_UP', taskId: t.id, followUpId: fu });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_EMAILED');
    mailExchangeMock.mockResolvedValueOnce(token(oid));
    const replay = await callback(cookie, { code: 'c', state });
    expect(replay.headers.location).toContain('email_error=send_failed');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('only the author can email a follow-up; extra fields like "to" are refused (FE-13)', async () => {
    const w = await world(appOn);
    await link(w.pm.user._id);
    const t = await firstTask(w);
    await assign(w, t.id, w.member.user._id.toString());
    const fu = await postFollowUp(w.member.agent, t.id);
    const notMine = await w.pm.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'FOLLOW_UP', taskId: t.id, followUpId: fu });
    expect(notMine.status).toBe(403);
    const injected = await w.pm.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'FOLLOW_UP', taskId: t.id, followUpId: fu, to: 'x@evil.example' });
    expect(injected.status).toBe(400);
    expect((await w.pm.agent.post('/api/v1/action-emails').send({})).status).toBe(403);
  });
});

describe('Failures never undo the action (AC4, FE-05, FE-06, FE-07, FA-10)', () => {
  it('Graph refusing the send: in-app stays, failure audited without the token, can retry', async () => {
    const w = await world(appOn);
    const oid = await link(w.pm.user._id);
    const t = await firstTask(w);
    await assign(w, t.id, w.member.user._id.toString());
    const fu = await postFollowUp(w.pm.agent, t.id);
    const inApp = await NotificationModel.countDocuments({ type: 'FOLLOW_UP' });
    const { state, cookie } = await start(w.pm.agent, {
      kind: 'FOLLOW_UP',
      taskId: t.id,
      followUpId: fu,
    });
    mailExchangeMock.mockResolvedValueOnce(token(oid));
    graph(403);
    const done = await callback(cookie, { code: 'c', state });
    expect(done.headers.location).toContain('email_error=send_forbidden');
    expect(await NotificationModel.countDocuments({ type: 'FOLLOW_UP' })).toBe(inApp);
    const failed = await ActivityLogModel.findOne({
      action: 'action_email_failed',
      entityId: t.id,
    }).lean();
    expect(failed?.meta).toMatchObject({
      kind: 'FOLLOW_UP',
      reason: 'send_forbidden',
      graphStatus: 403,
      graphCode: 'ErrorAccessDenied',
    });
    expect(JSON.stringify(failed)).not.toContain(TOKEN);
    expect(JSON.stringify(failed)).not.toContain(state);
    // Nothing went, so the follow-up can be emailed again.
    const task = await TaskModel.findById(t.id).lean();
    expect(task!.followUps.at(-1)!.emailedAt).toBeNull();
  });

  it('cancelled or missing consent is audited and nothing is sent', async () => {
    const w = await world(appOn);
    await link(w.pm.user._id);
    const t = await firstTask(w);
    await assign(w, t.id, w.member.user._id.toString());
    const spy = graph();
    for (const [query, reason] of [
      [{ error: 'access_denied', error_description: 'AADSTS65004' }, 'consent_declined'],
      [{ error: 'access_denied', error_description: 'AADSTS90094' }, 'admin_consent_required'],
    ] as const) {
      const { state, cookie } = await start(w.pm.agent, {
        kind: 'TASK_ASSIGNED',
        taskId: t.id,
        userIds: [w.member.user._id.toString()],
      });
      const done = await callback(cookie, { state, ...query });
      expect(done.headers.location).toContain(`email_error=${reason}`);
      expect(
        await ActivityLogModel.countDocuments({
          action: 'action_email_failed',
          'meta.reason': reason,
        }),
      ).toBe(1);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(mailExchangeMock).not.toHaveBeenCalled();
  });

  it('a token for another Microsoft account sends nothing', async () => {
    const w = await world(appOn);
    await link(w.pm.user._id);
    const t = await firstTask(w);
    await assign(w, t.id, w.member.user._id.toString());
    const { state, cookie } = await start(w.pm.agent, {
      kind: 'TASK_ASSIGNED',
      taskId: t.id,
      userIds: [w.member.user._id.toString()],
    });
    mailExchangeMock.mockResolvedValueOnce(token('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));
    const spy = graph();
    const done = await callback(cookie, { code: 'c', state });
    expect(done.headers.location).toContain('email_error=wrong_account');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Task assigned (FA-01, FA-06, FA-07)', () => {
  it('emails only the people now on the task, never the assigner; reassigned people get nothing', async () => {
    const w = await world(appOn);
    const oid = await link(w.pm.user._id);
    const t = await firstTask(w);
    const other = await createUser({ name: 'Bea Other' });
    await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: [w.member.user._id.toString(), other._id.toString()] });
    await assign(w, t.id, w.member.user._id.toString());
    // Reassign A (member) to B (other): only B can be emailed.
    await assign(w, t.id, other._id.toString());
    expect(await NotificationModel.countDocuments({ type: 'ASSIGNED', userId: other._id })).toBe(1);
    const stale = await w.pm.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'TASK_ASSIGNED', taskId: t.id, userIds: [w.member.user._id.toString()] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('NO_RECIPIENTS');
    // Self-assign: no email to self (FA-06).
    const self = await w.pm.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'TASK_ASSIGNED', taskId: t.id, userIds: [w.pm.user._id.toString()] });
    expect(self.body.error.code).toBe('NO_RECIPIENTS');

    const { res, state, cookie } = await start(w.pm.agent, {
      kind: 'TASK_ASSIGNED',
      taskId: t.id,
      userIds: [other._id.toString(), w.pm.user._id.toString(), w.member.user._id.toString()],
    });
    expect(res.body.recipients).toBe(1);
    mailExchangeMock.mockResolvedValueOnce(token(oid));
    const spy = graph();
    const done = await callback(cookie, { code: 'c', state });
    expect(done.headers.location).toContain('email=sent');
    expect(sentTo(spy)).toEqual([other.email]);
    const msg = JSON.parse(String(spy.mock.calls[0]![1]!.body)).message;
    expect(msg.subject).toBe(`[Rollout P] You were assigned ${t.name}`);
    expect(msg.body.content).toContain('Hi Bea Other,');
    expect(msg.body.content).toContain(`assigned you to ${t.name} in Rollout P.`);
  });

  it('only someone who can plan the task can start an assignment email', async () => {
    const w = await world(appOn);
    await link(w.member.user._id);
    const t = await firstTask(w);
    await assign(w, t.id, w.member.user._id.toString());
    const res = await w.member.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'TASK_ASSIGNED', taskId: t.id, userIds: [w.pm.user._id.toString()] });
    expect(res.status).toBe(403);
  });
});

describe('Added to project (FA-03, FA-06, FA-08)', () => {
  it('one email per added member with their own name; non-members and the adder get nothing', async () => {
    const w = await world(appOn);
    const oid = await link(w.pm.user._id);
    const a = await createUser({ name: 'Ana Added' });
    const b = await createUser({ name: 'Ben Added' });
    const res = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({
        memberIds: [w.member.user._id.toString(), a._id.toString(), b._id.toString()],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { state, cookie } = await start(w.pm.agent, {
      kind: 'PROJECT_ADDED',
      projectId: w.project.id,
      userIds: [
        a._id.toString(),
        b._id.toString(),
        w.pm.user._id.toString(),
        w.outsider.user._id.toString(),
      ],
    });
    mailExchangeMock.mockResolvedValueOnce(token(oid));
    const spy = graph();
    const done = await callback(cookie, { code: 'c', state });
    expect(done.headers.location).toBe(`http://localhost:5173/projects/${w.project.id}?email=sent`);
    expect(sentTo(spy).sort()).toEqual([a.email, b.email].sort());
    const bodies = spy.mock.calls.map((c) => JSON.parse(String(c[1]!.body)).message);
    expect(bodies.map((m) => m.body.content).join()).toContain('Hi Ana Added,');
    expect(bodies.map((m) => m.body.content).join()).toContain('Hi Ben Added,');
    expect(bodies[0].subject).toBe('[Rollout P] You were added to Rollout P');
    expect(bodies[0].body.content).toContain(
      `href="http://localhost:5173/projects/${w.project.id}"`,
    );
    const log = await ActivityLogModel.findOne({
      action: 'action_email_sent',
      entityId: w.project.id,
    }).lean();
    expect(log?.meta).toEqual({ kind: 'PROJECT_ADDED', recipients: 2 });
  });

  it('a Member who can’t add members can’t start it', async () => {
    const w = await world(appOn);
    await link(w.member.user._id);
    const res = await w.member.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({
        kind: 'PROJECT_ADDED',
        projectId: w.project.id,
        userIds: [w.pm.user._id.toString()],
      });
    expect(res.status).toBe(403);
  });
});

describe('Content safety (FE-17, FA-12)', () => {
  it('escapes names and notes, keeps the subject on one line and links to WEB_APP_URL', () => {
    const cfg = loadConfig({ MONGODB_URI: 'mongodb://x', WEB_APP_URL: 'https://ops.example/' });
    const id = '0123456789abcdef01234567';
    const project = { _id: new Types.ObjectId(id), name: 'P "<x>" &' };
    const task = { _id: new Types.ObjectId(id), name: 'T\r\nBcc: evil@x.example<script>' };
    const fu = actionMailContent(cfg, 'FOLLOW_UP', {
      actorName: '<img src=x>',
      recipientName: 'R',
      project,
      task,
      note: '<script>alert(1)</script>\nline 2',
    });
    expect(fu.subject).not.toMatch(/[\r\n]/);
    expect(fu.html).not.toContain('<script>');
    expect(fu.html).not.toContain('<img');
    expect(fu.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>line 2');
    expect(fu.html).toContain(`href="https://ops.example/projects/${id}?task=${id}"`);
    const added = actionMailContent(cfg, 'PROJECT_ADDED', {
      actorName: 'A',
      recipientName: '"><b>R',
      project,
      task: null,
    });
    expect(added.html).toContain('Hi &quot;&gt;&lt;b&gt;R,');
    expect(added.html).toContain(`href="https://ops.example/projects/${id}"`);
  });
});
