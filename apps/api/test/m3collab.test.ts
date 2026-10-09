import { afterEach, describe, expect, it } from 'vitest';
import { ActivityLogModel, MessageModel } from '../src/models/index.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';
import { grant, resetRules, world } from './m2helpers.js';

/** Follow-up notifications and the Project Conversation (doc 12 §3.3–3.4, TC-N09..N15, TC-N21). */
useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

/** Adds people to the project, then makes A owner, B and C assignees and D reviewer of task 1. */
async function team(w: W) {
  const b = await signedInAs(app, 'MEMBER');
  const c = await signedInAs(app, 'MEMBER');
  const d = await signedInAs(app, 'MEMBER');
  const ids = [w.member, b, c, d].map((x) => x.user._id.toString());
  expect(
    (await w.pm.agent.patch(`/api/v1/projects/${w.project.id}`).set(CSRF).send({ memberIds: ids }))
      .status,
  ).toBe(200);
  const t1 = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items[0];
  const res = await w.pm.agent
    .patch(`/api/v1/tasks/${t1.id}`)
    .set(CSRF)
    .send({
      version: t1.version,
      ownerId: ids[0],
      assigneeIds: [ids[1], ids[2]],
      reviewerId: ids[3],
    });
  expect(res.status).toBe(200);
  return { a: w.member, b, c, d, task: res.body.task as { id: string } };
}

const followUps = async (agent: Agent) =>
  (
    (await agent.get('/api/v1/notifications')).body.items as {
      type: string;
      task: { id: string } | null;
    }[]
  ).filter((n) => n.type === 'FOLLOW_UP');

const followUp = (agent: Agent, taskId: string, note = 'Called the client') =>
  agent.post(`/api/v1/tasks/${taskId}/follow-ups`).set(CSRF).send({ note });

describe('TC-N09 / AC-40.1: follow-up notifications', () => {
  it('owner, other assignees, reviewer and PM each get exactly one; the author gets none', async () => {
    const w = await world(app);
    const { a, b, c, d, task } = await team(w);
    expect((await followUp(b.agent, task.id)).status).toBe(201);
    for (const who of [a, c, d, w.pm]) expect(await followUps(who.agent)).toHaveLength(1);
    expect(await followUps(b.agent)).toHaveLength(0);
    // Not on the project: nothing.
    expect(await followUps(w.pm2.agent)).toHaveLength(0);
    const [n] = await followUps(a.agent);
    expect(n).toMatchObject({
      task: { id: task.id },
      project: { id: w.project.id },
      actor: { id: b.user._id.toString() },
    });
    // Assignment itself notified the new people (FR-NTF-05).
    const assigned = (await c.agent.get('/api/v1/notifications')).body.items.filter(
      (x: { type: string }) => x.type === 'ASSIGNED',
    );
    expect(assigned).toHaveLength(1);
  });

  it('EC-61: a task with no assignees notifies the owner and the PM', async () => {
    const w = await world(app);
    const t = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items[0];
    await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t.version, ownerId: w.member.user._id.toString() });
    expect((await followUp(w.admin.agent, t.id)).status).toBe(201);
    expect(await followUps(w.member.agent)).toHaveLength(1);
    expect(await followUps(w.pm.agent)).toHaveLength(1);
  });
});

describe('TC-N10 / AC-40.2: people removed from the project', () => {
  it('get no new notifications, and its old ones disappear from their list', async () => {
    const w = await world(app);
    const { a, b, c, d, task } = await team(w);
    await followUp(b.agent, task.id);
    expect(await followUps(c.agent)).toHaveLength(1);
    // Remove C from the project (still listed as an assignee on the task).
    const keep = [a, b, d].map((x) => x.user._id.toString());
    const removed = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: keep });
    expect(removed.status).toBe(200);
    await followUp(b.agent, task.id, 'Second');
    expect(await followUps(c.agent)).toHaveLength(0);
    expect((await c.agent.get('/api/v1/notifications/unread-count')).body.unread).toBe(0);
    expect(await followUps(a.agent)).toHaveLength(2);
  });
});

describe('TC-N11: reading notifications', () => {
  it('mark one read, then all; another user’s notification is 404', async () => {
    const w = await world(app);
    const { a, b, c, task } = await team(w);
    await followUp(b.agent, task.id, 'one');
    await followUp(b.agent, task.id, 'two');
    const before = (await a.agent.get('/api/v1/notifications')).body;
    const unread0 = before.unread;
    expect(unread0).toBeGreaterThanOrEqual(2);
    const first = before.items[0].id;
    expect(
      (await a.agent.post(`/api/v1/notifications/${first}/read`).set(CSRF).send({})).body.unread,
    ).toBe(unread0 - 1);
    expect(
      (await c.agent.post(`/api/v1/notifications/${first}/read`).set(CSRF).send({})).status,
    ).toBe(404);
    expect(
      (await a.agent.post('/api/v1/notifications/read-all').set(CSRF).send({})).body.unread,
    ).toBe(0);
    expect((await a.agent.get('/api/v1/notifications/unread-count')).body.unread).toBe(0);
  });
});

const messages = (w: W) => `/api/v1/projects/${w.project.id}/messages`;

describe('TC-N12 / AC-41.1: who reads and posts', () => {
  it('Member on the project posts; Viewer reads but gets 403; outsider gets 404; pm2 (not on it) reads only', async () => {
    const w = await world(app);
    const post = (a: Agent, text = 'Hello team') => a.post(messages(w)).set(CSRF).send({ text });
    expect((await post(w.member.agent)).status).toBe(201);
    expect((await post(w.pm.agent)).status).toBe(201);
    expect((await post(w.admin.agent)).status).toBe(201);
    expect((await w.viewer.agent.get(messages(w))).status).toBe(200);
    expect((await w.viewer.agent.get(messages(w))).body.can.post).toBe(false);
    expect((await post(w.viewer.agent)).status).toBe(403);
    expect((await w.outsider.agent.get(messages(w))).status).toBe(404);
    expect((await post(w.outsider.agent)).status).toBe(404);
    expect((await w.pm2.agent.get(messages(w))).status).toBe(200);
    expect((await post(w.pm2.agent)).status).toBe(403);
    const list = (await w.member.agent.get(messages(w))).body.items;
    // Oldest first (FR-CNV-01).
    expect(list.map((m: { author: { id: string } }) => m.author.id)).toEqual([
      w.member.user._id.toString(),
      w.pm.user._id.toString(),
      w.admin.user._id.toString(),
    ]);
  });

  it('FR-CNV-02: type, a task of this project and active contacts can be tagged; others are refused', async () => {
    const w = await world(app);
    const t1 = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items[0];
    await w.pm.agent
      .post(`/api/v1/projects/${w.project.id}/contacts`)
      .set(CSRF)
      .send({ contactId: w.acme.active[0].id });
    const ok = await w.pm.agent
      .post(messages(w))
      .set(CSRF)
      .send({
        text: 'Called them',
        type: 'CALL',
        taskId: t1.id,
        contactIds: [w.acme.active[0].id],
      });
    expect(ok.status).toBe(201);
    expect(ok.body.message).toMatchObject({
      type: 'CALL',
      task: { id: t1.id },
      contacts: [{ id: w.acme.active[0].id, active: true }],
    });
    expect(
      (
        await w.pm.agent
          .post(messages(w))
          .set(CSRF)
          .send({ text: 'x', contactIds: [w.acme.active[1].id] })
      ).status,
    ).toBe(400);
    expect(
      (
        await w.pm.agent
          .post(messages(w))
          .set(CSRF)
          .send({ text: 'x'.repeat(5001) })
      ).status,
    ).toBe(400);
    // FR-CNV-05: filter by task.
    const tagged = (await w.member.agent.get(`${messages(w)}?taskId=${t1.id}`)).body.items;
    expect(tagged).toHaveLength(1);
    expect((await w.member.agent.get(`${messages(w)}?type=DECISION`)).body.items).toHaveLength(0);
  });
});

describe('TC-N13 / AC-41.2 and TC-N14 / AC-41.3: permanent, plain text', () => {
  it('PATCH and DELETE answer 404 and the message is unchanged; <script> is stored as text', async () => {
    const w = await world(app);
    const text = '<script>alert(1)</script> <img src=x onerror=alert(1)>';
    const m = (await w.pm.agent.post(messages(w)).set(CSRF).send({ text })).body.message;
    expect(m.text).toBe(text);
    expect(
      (
        await w.pm.agent
          .patch(`${messages(w)}/${m.id}`)
          .set(CSRF)
          .send({ text: 'edited' })
      ).status,
    ).toBe(404);
    expect((await w.admin.agent.delete(`${messages(w)}/${m.id}`).set(CSRF)).status).toBe(404);
    expect((await MessageModel.findById(m.id).lean())!.text).toBe(text);
  });
});

describe('TC-N15 / Q-31: Admins hide abusive messages', () => {
  it('the hide is audited and the text withheld; a non-Admin gets 403', async () => {
    const w = await world(app);
    const m = (await w.member.agent.post(messages(w)).set(CSRF).send({ text: 'rude words' })).body
      .message;
    expect(
      (
        await w.pm.agent
          .post(`${messages(w)}/${m.id}/hide`)
          .set(CSRF)
          .send({ reason: 'Conduct' })
      ).status,
    ).toBe(403);
    const hidden = await w.admin.agent
      .post(`${messages(w)}/${m.id}/hide`)
      .set(CSRF)
      .send({ reason: 'Conduct policy' });
    expect(hidden.status).toBe(200);
    expect(hidden.body.message).toMatchObject({
      text: null,
      hidden: { by: { id: w.admin.user._id.toString() }, reason: 'Conduct policy' },
    });
    const seen = (await w.member.agent.get(messages(w))).body.items.find(
      (x: { id: string }) => x.id === m.id,
    );
    expect(seen.text).toBeNull();
    expect(
      await ActivityLogModel.exists({ action: 'message_hidden', entityId: m.id }),
    ).toBeTruthy();
  });
});

describe('TC-N21: new record types in the access rules are enforced', () => {
  it('rows are present; unticking Create on conversations for Members applies on the next request', async () => {
    const w = await world(app);
    const rules = (await w.admin.agent.get('/api/v1/access-rules')).body.roles;
    for (const r of rules) {
      expect(Object.keys(r.permissions)).toEqual(
        expect.arrayContaining(['documents', 'conversations', 'notifications']),
      );
    }
    expect((await w.member.agent.post(messages(w)).set(CSRF).send({ text: 'a' })).status).toBe(201);
    await grant(app, 'MEMBER', { conversations: { create: false } });
    expect((await w.member.agent.post(messages(w)).set(CSRF).send({ text: 'b' })).status).toBe(403);
    await grant(app, 'MEMBER', { conversations: { view: false, create: false } });
    expect((await w.member.agent.get(messages(w))).status).toBe(403);
    // Documents: unticking View blocks the Documents tab's API.
    await grant(app, 'VIEWER', { documents: { view: false } });
    expect((await w.viewer.agent.get(`/api/v1/projects/${w.project.id}/documents`)).status).toBe(
      403,
    );
  });

  it('notifications can’t be switched off for anyone (422)', async () => {
    const w = await world(app);
    const current = (await w.admin.agent.get('/api/v1/access-rules')).body.roles.find(
      (r: { role: string }) => r.role === 'MEMBER',
    );
    const res = await w.admin.agent
      .put('/api/v1/access-rules/MEMBER')
      .set(CSRF)
      .send({ version: current.version, permissions: { notifications: { view: false } } });
    expect(res.status).toBe(422);
  });
});
