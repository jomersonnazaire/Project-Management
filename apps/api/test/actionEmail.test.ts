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

function nextLogin() {
  seq += 1;
  const state = `act-state-${seq}-${Date.now()}`;
  loginUrlMock.mockResolvedValueOnce({
    url: `https://login.microsoftonline.com/mock?state=${state}`,
    codeVerifier: 'verifier-act-123456789012345678901234567890',
    state,
    nonce: `nonce-${seq}`,
  });
  return state;
}
function actCookie(res: request.Response) {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const raw = (Array.isArray(setCookie) ? setCookie : [setCookie ?? '']).join('; ');
  return /xc8_ms_act=([^;]+)/.exec(raw)?.[1] ?? '';
}
async function start(agent: Agent, body: Record<string, unknown>) {
  const state = nextLogin();
  const res = await agent.post('/api/v1/action-emails').set(CSRF).send(body);
  return { res, state, cookie: actCookie(res) };
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
/** Saves the task's owner, ticking "Email {name}"; the server works out who is newly given it. */
async function assignWithEmail(w: W, taskId: string, ownerId: string, agent: Agent = w.pm.agent) {
  const t = (await agent.get(`/api/v1/tasks/${taskId}`)).body.task;
  const state = nextLogin();
  const res = await agent
    .patch(`/api/v1/tasks/${taskId}`)
    .set(CSRF)
    .send({ version: t.version, ownerId, emailNewAssignees: true });
  return { res, state, cookie: actCookie(res) };
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

    // An unlinked PM assigning: action works, email refused.
    expect(
      await NotificationModel.countDocuments({ type: 'ASSIGNED', userId: w.member.user._id }),
    ).toBe(1);
    const other = await createUser({ name: 'Oli Other' });
    await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: [w.member.user._id.toString(), other._id.toString()] });
    const { res: r } = await assignWithEmail(w, t.id, other._id.toString());
    loginUrlMock.mockReset();
    expect(r.status).toBe(200);
    expect(r.body.task.owner.id).toBe(other._id.toString());
    expect(r.body.email).toMatchObject({ url: null, error: 'MICROSOFT_NOT_LINKED' });
    expect(await NotificationModel.countDocuments({ type: 'ASSIGNED', userId: other._id })).toBe(1);

    // An unlinked PM adding a member and ticking email: saved, in-app sent, email refused.
    const newbie = await createUser({ name: 'Nia New' });
    const added = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({
        memberIds: [w.member.user._id.toString(), newbie._id.toString()],
        emailAddedMembers: true,
      });
    expect(added.status).toBe(200);
    expect(added.body.project.members.map((m: { id: string }) => m.id)).toContain(
      newbie._id.toString(),
    );
    expect(added.body.email).toEqual({
      url: null,
      error: 'MICROSOFT_NOT_LINKED',
      message: ACTION_EMAIL_NOT_LINKED,
      recipients: 0,
    });
    expect(actCookie(added)).toBe('');
    expect(
      await NotificationModel.countDocuments({ type: 'ADDED_TO_PROJECT', userId: newbie._id }),
    ).toBe(1);
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
      // A fresh owner each round, so the save newly assigns someone.
      const next = await createUser({ name: `Next ${reason}` });
      const p = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}`)).body.project;
      await w.pm.agent
        .patch(`/api/v1/projects/${w.project.id}`)
        .set(CSRF)
        .send({ memberIds: [...p.members.map((m: { id: string }) => m.id), next._id.toString()] });
      const { state, cookie } = await assignWithEmail(w, t.id, next._id.toString());
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
    const { state, cookie } = await assignWithEmail(w, t.id, w.member.user._id.toString());
    mailExchangeMock.mockResolvedValueOnce(token('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));
    const spy = graph();
    const done = await callback(cookie, { code: 'c', state });
    expect(done.headers.location).toContain('email_error=wrong_account');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Task assigned (FA-01, FA-06, FA-07, E1)', () => {
  it('emails only the person the save newly gives the task, never the assigner', async () => {
    const w = await world(appOn);
    const oid = await link(w.pm.user._id);
    const t = await firstTask(w);
    const other = await createUser({ name: 'Bea Other' });
    await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: [w.member.user._id.toString(), other._id.toString()] });
    await assign(w, t.id, w.member.user._id.toString());
    // Reassign A (member) to B (other): only B is emailed (FA-07).
    const { res, state, cookie } = await assignWithEmail(w, t.id, other._id.toString());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.email).toMatchObject({ error: null, recipients: 1 });
    expect(await NotificationModel.countDocuments({ type: 'ASSIGNED', userId: other._id })).toBe(1);
    mailExchangeMock.mockResolvedValueOnce(token(oid));
    const spy = graph();
    const done = await callback(cookie, { code: 'c', state });
    expect(done.headers.location).toContain('email=sent');
    expect(sentTo(spy)).toEqual([other.email]);
    const msg = JSON.parse(String(spy.mock.calls[0]![1]!.body)).message;
    expect(msg.subject).toBe(`[Rollout P] You were assigned ${t.name}`);
    expect(msg.body.content).toContain('Hi Bea Other,');
    expect(msg.body.content).toContain(`assigned you to ${t.name} in Rollout P.`);

    // Self-assign: nobody to email (FA-06).
    const self = await assignWithEmail(w, t.id, w.pm.user._id.toString());
    expect(self.res.status).toBe(200);
    expect(self.res.body.email).toMatchObject({ url: null, error: 'NO_RECIPIENTS' });
  });

  it('E1 (Queen QA-P2): saving again with the same owner emails nobody, however often', async () => {
    const w = await world(appOn);
    await link(w.pm.user._id);
    const t = await firstTask(w);
    await assign(w, t.id, w.member.user._id.toString());
    const spy = graph();
    for (let i = 0; i < 3; i++) {
      const { res, cookie } = await assignWithEmail(w, t.id, w.member.user._id.toString());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.email).toEqual({
        url: null,
        error: 'NO_RECIPIENTS',
        message: 'Nobody to email.',
        recipients: 0,
      });
      expect(cookie).toBe('');
    }
    // Adding B as an assignee next to owner A: only B, never A again.
    const b = await createUser({ name: 'Bo Assignee' });
    await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: [w.member.user._id.toString(), b._id.toString()] });
    const t1 = (await w.pm.agent.get(`/api/v1/tasks/${t.id}`)).body.task;
    nextLogin();
    const both = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t1.version, assigneeIds: [b._id.toString()], emailNewAssignees: true });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    expect(both.body.email).toMatchObject({ error: null, recipients: 1 });
    expect(spy).not.toHaveBeenCalled();

    // The client can't name recipients any more: TASK_ASSIGNED on /action-emails is refused.
    const direct = await w.pm.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'TASK_ASSIGNED', taskId: t.id, userIds: [w.member.user._id.toString()] });
    expect(direct.status).toBe(400);
  });

  it('new task: emails its owner and assignees (not me) when ticked; unticked sends nothing', async () => {
    const w = await world(appOn);
    const oid = await link(w.pm.user._id);
    const state = nextLogin();
    const res = await w.pm.agent
      .post(`/api/v1/projects/${w.project.id}/tasks`)
      .set(CSRF)
      .send({
        name: 'Go-live check',
        ownerId: w.member.user._id.toString(),
        assigneeIds: [w.pm.user._id.toString()],
        emailNewAssignees: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.email).toMatchObject({ error: null, recipients: 1 });
    mailExchangeMock.mockResolvedValueOnce(token(oid));
    const spy = graph();
    await callback(actCookie(res), { code: 'c', state });
    expect(sentTo(spy)).toEqual([w.member.user.email]);
    const plain = await w.pm.agent
      .post(`/api/v1/projects/${w.project.id}/tasks`)
      .set(CSRF)
      .send({ name: 'No email', ownerId: w.member.user._id.toString() });
    expect(plain.status).toBe(201);
    expect(plain.body.email).toBeUndefined();
    expect(actCookie(plain)).toBe('');
  });
});

describe('Added to project (FA-03, FA-06, FA-08)', () => {
  const ids = (xs: { userId: unknown }[]) => xs.map((x) => String(x.userId)).sort();

  it('in-app notice for exactly the people a save adds, always (flag off, no opt-in)', async () => {
    const w = await world(appOff);
    // Create: everyone on the initial team except the creator (here: the member).
    const onCreate = await NotificationModel.find({
      type: 'ADDED_TO_PROJECT',
      projectId: w.project.id,
    }).lean();
    expect(ids(onCreate)).toEqual([w.member.user._id.toString()]);
    expect(onCreate[0]!.actorId?.toString()).toBe(w.pm.user._id.toString());

    // Edit: bulk add A and B next to the existing member (FA-03); only A and B (FA-08).
    const a = await createUser({ name: 'Ana Added' });
    const b = await createUser({ name: 'Ben Added' });
    const res = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: [w.member.user._id.toString(), a._id.toString(), b._id.toString()] });
    expect(res.status).toBe(200);
    expect(res.body.email).toBeUndefined();
    const all = await NotificationModel.find({
      type: 'ADDED_TO_PROJECT',
      projectId: w.project.id,
    }).lean();
    expect(ids(all)).toEqual(
      [w.member.user._id.toString(), a._id.toString(), b._id.toString()].sort(),
    );

    // Same list again, a removal, or the PM re-adding themself: nobody new, nothing new.
    for (const memberIds of [
      [w.member.user._id.toString(), a._id.toString(), b._id.toString()],
      [a._id.toString()],
      [a._id.toString(), w.pm.user._id.toString()],
    ]) {
      const r = await w.pm.agent
        .patch(`/api/v1/projects/${w.project.id}`)
        .set(CSRF)
        .send({ memberIds });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    expect(
      await NotificationModel.countDocuments({ type: 'ADDED_TO_PROJECT', projectId: w.project.id }),
    ).toBe(3);

    // A new manager joins the team: they're added too.
    const r = await w.admin.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ managerId: w.pm2.user._id.toString() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(
      await NotificationModel.countDocuments({
        type: 'ADDED_TO_PROJECT',
        projectId: w.project.id,
        userId: w.pm2.user._id,
      }),
    ).toBe(1);
    // Never the actor; the flag off means no email part at all.
    expect(
      await NotificationModel.countDocuments({ type: 'ADDED_TO_PROJECT', userId: w.pm.user._id }),
    ).toBe(0);
    expect(loginUrlMock).not.toHaveBeenCalled();
  });

  it('opting in with the flag off: saved and notified, email reported as switched off', async () => {
    const w = await world(appOff);
    await link(w.pm.user._id);
    const a = await createUser({ name: 'Ana Added' });
    const res = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: [a._id.toString()], emailAddedMembers: true });
    expect(res.status).toBe(200);
    expect(res.body.email).toMatchObject({ url: null, error: 'EMAIL_DISABLED' });
    expect(
      await NotificationModel.countDocuments({ type: 'ADDED_TO_PROJECT', userId: a._id }),
    ).toBe(1);
    expect(loginUrlMock).not.toHaveBeenCalled();
  });

  it('edit: one email per added member, worked out by the server (FA-03, FA-08)', async () => {
    const w = await world(appOn);
    const oid = await link(w.pm.user._id);
    const a = await createUser({ name: 'Ana Added' });
    const b = await createUser({ name: 'Ben Added' });
    const state = nextLogin();
    const res = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({
        memberIds: [w.member.user._id.toString(), a._id.toString(), b._id.toString()],
        emailAddedMembers: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.email).toEqual({
      url: expect.stringContaining(state),
      error: null,
      message: null,
      recipients: 2,
    });
    expect(loginUrlMock.mock.calls[0]?.[1]).toEqual({
      scopes: ['Mail.Send'],
      loginHint: w.pm.user.email,
    });
    mailExchangeMock.mockResolvedValueOnce(token(oid));
    const spy = graph();
    const done = await callback(actCookie(res), { code: 'c', state });
    expect(done.headers.location).toBe(`http://localhost:5173/projects/${w.project.id}?email=sent`);
    // The existing member, the PM and outsiders get nothing (FA-08, FA-06).
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

  it('create: emails the initial team except the creator', async () => {
    const w = await world(appOn);
    const oid = await link(w.pm.user._id);
    const a = await createUser({ name: 'Ana Initial' });
    const state = nextLogin();
    const res = await w.pm.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send({
        name: 'Second P',
        projectTypeId: w.project.projectType.id,
        clientId: w.acme.client.id,
        managerId: w.pm.user._id.toString(),
        memberIds: [w.member.user._id.toString(), a._id.toString(), w.pm.user._id.toString()],
        startDate: '2026-10-12',
        plannedEndDate: '2026-12-18',
        emailAddedMembers: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.email).toMatchObject({ error: null, recipients: 2 });
    const pid = res.body.project.id as string;
    expect(
      ids(await NotificationModel.find({ type: 'ADDED_TO_PROJECT', projectId: pid }).lean()),
    ).toEqual([w.member.user._id.toString(), a._id.toString()].sort());
    mailExchangeMock.mockResolvedValueOnce(token(oid));
    const spy = graph();
    const done = await callback(actCookie(res), { code: 'c', state });
    expect(done.headers.location).toBe(`http://localhost:5173/projects/${pid}?email=sent`);
    expect(sentTo(spy).sort()).toEqual([w.member.user.email, a.email].sort());
  });

  it('a Graph failure still leaves the members added and notified, and is audited', async () => {
    const w = await world(appOn);
    const oid = await link(w.pm.user._id);
    const a = await createUser({ name: 'Ana Added' });
    const state = nextLogin();
    const res = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: [a._id.toString()], emailAddedMembers: true });
    mailExchangeMock.mockResolvedValueOnce(token(oid));
    graph(403);
    const done = await callback(actCookie(res), { code: 'c', state });
    expect(done.headers.location).toContain('email_error=send_forbidden');
    const p = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}`)).body.project;
    expect(p.members.map((m: { id: string }) => m.id)).toContain(a._id.toString());
    expect(
      await NotificationModel.countDocuments({ type: 'ADDED_TO_PROJECT', userId: a._id }),
    ).toBe(1);
    const failed = await ActivityLogModel.findOne({
      action: 'action_email_failed',
      entityId: w.project.id,
    }).lean();
    expect(failed?.meta).toMatchObject({ kind: 'PROJECT_ADDED', reason: 'send_forbidden' });
    expect(JSON.stringify(failed)).not.toContain(TOKEN);
  });

  it('the client can’t name who was added: PROJECT_ADDED and userIds are refused', async () => {
    const w = await world(appOn);
    await link(w.pm.user._id);
    const direct = await w.pm.agent
      .post('/api/v1/action-emails')
      .set(CSRF)
      .send({ kind: 'PROJECT_ADDED', projectId: w.project.id, userIds: [w.member.user._id] });
    expect(direct.status).toBe(400);
    const extra = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ emailAddedMembers: true, addedUserIds: [w.member.user._id.toString()] });
    expect(extra.status).toBe(400);
    // Opting in when nobody is new: no email, no notice.
    const none = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ description: 'Same team', emailAddedMembers: true });
    expect(none.status).toBe(200);
    expect(none.body.email).toMatchObject({ url: null, error: 'NO_RECIPIENTS' });
    expect(loginUrlMock).not.toHaveBeenCalled();
  });

  it('people added through the task form get the in-app notice too', async () => {
    const w = await world(appOff);
    const t = await firstTask(w);
    const t0 = (await w.pm.agent.get(`/api/v1/tasks/${t.id}`)).body.task;
    const res = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({
        version: t0.version,
        ownerId: w.outsider.user._id.toString(),
        addMemberIds: [w.outsider.user._id.toString()],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      await NotificationModel.countDocuments({
        type: 'ADDED_TO_PROJECT',
        userId: w.outsider.user._id,
        projectId: w.project.id,
      }),
    ).toBe(1);
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
