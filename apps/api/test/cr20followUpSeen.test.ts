import { afterEach, describe, expect, it } from 'vitest';
import { FollowUpSeenModel, ProjectModel, TaskModel } from '../src/models/index.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';
import { resetTestTime, setTestTime } from '../src/lib/clock.js';
import { ensureFollowUpSeenCutoff } from '../src/services/followUpSeen.js';
import { resetRules, world } from './m2helpers.js';

/** CR-20 FR-NTF-09..13: the follow-up count badge and its per-user "seen" state. */
useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

/** Makes A owner and B an assignee of the project's first task. */
async function team(w: W) {
  const b = await signedInAs(app, 'MEMBER');
  const ids = [w.member, b].map((x) => x.user._id.toString());
  expect(
    (await w.pm.agent.patch(`/api/v1/projects/${w.project.id}`).set(CSRF).send({ memberIds: ids }))
      .status,
  ).toBe(200);
  const t1 = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items[0];
  const res = await w.pm.agent
    .patch(`/api/v1/tasks/${t1.id}`)
    .set(CSRF)
    .send({ version: t1.version, ownerId: ids[0], assigneeIds: [ids[1]] });
  expect(res.status).toBe(200);
  return { a: w.member, b, taskId: res.body.task.id as string };
}

const followUp = (agent: Agent, taskId: string, note = 'Called the client') =>
  agent.post(`/api/v1/tasks/${taskId}/follow-ups`).set(CSRF).send({ note });
const seen = (agent: Agent, taskId: string) =>
  agent.post(`/api/v1/tasks/${taskId}/follow-ups/seen`).set(CSRF).send({});

/** [total, unseen] on the project checklist row. */
async function checklist(agent: Agent, w: W, taskId: string) {
  const items = (await agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
    id: string;
    followUps: unknown[];
    followUpsUnseen: number;
  }[];
  const t = items.find((x) => x.id === taskId)!;
  return [t.followUps.length, t.followUpsUnseen];
}

/** [total, unseen] on the My tasks row (Assigned to me). */
async function mine(agent: Agent, taskId: string) {
  const items = (await agent.get('/api/v1/tasks/mine?view=assigned')).body.items as {
    id: string;
    followUps: number;
    followUpsUnseen: number;
  }[];
  const t = items.find((x) => x.id === taskId)!;
  return [t.followUps, t.followUpsUnseen];
}

describe('CR-20 FR-NTF-09..13: follow-up seen state', () => {
  it("a follow-up by someone else is new until the list is opened; the author's own never is", async () => {
    const w = await world(app);
    const { a, b, taskId } = await team(w);
    expect(await checklist(a.agent, w, taskId)).toEqual([0, 0]);
    expect(await mine(a.agent, taskId)).toEqual([0, 0]);

    expect((await followUp(b.agent, taskId)).status).toBe(201);
    expect(await checklist(a.agent, w, taskId)).toEqual([1, 1]);
    expect(await mine(a.agent, taskId)).toEqual([1, 1]);
    expect((await a.agent.get(`/api/v1/tasks/${taskId}`)).body.task.followUpsUnseen).toBe(1);
    // The author's own follow-up counts as seen for the author.
    expect(await checklist(b.agent, w, taskId)).toEqual([1, 0]);
    expect(await mine(b.agent, taskId)).toEqual([1, 0]);

    // Opening the list marks everything on the task seen.
    const res = await seen(a.agent, taskId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ followUps: 1, followUpsUnseen: 0 });
    expect(await checklist(a.agent, w, taskId)).toEqual([1, 0]);
    expect(await mine(a.agent, taskId)).toEqual([1, 0]);

    // A later follow-up is new again; only that one counts.
    expect((await followUp(w.pm.agent, taskId, 'Second')).status).toBe(201);
    expect(await checklist(a.agent, w, taskId)).toEqual([2, 1]);
    // B wrote the first one (seen for B) and never opened the list: only the PM's is new for B.
    expect(await checklist(b.agent, w, taskId)).toEqual([2, 1]);
    // The PM's own follow-up is seen for the PM; B's earlier one is still new.
    expect(await checklist(w.pm.agent, w, taskId)).toEqual([2, 1]);
  });

  it('seen is per user: one person opening the list leaves everyone else unchanged', async () => {
    const w = await world(app);
    const { a, b, taskId } = await team(w);
    await followUp(b.agent, taskId);
    await followUp(b.agent, taskId, 'Again');
    expect((await seen(a.agent, taskId)).status).toBe(200);
    expect(await checklist(a.agent, w, taskId)).toEqual([2, 0]);
    expect(await checklist(w.pm.agent, w, taskId)).toEqual([2, 2]);
    expect(await checklist(w.admin.agent, w, taskId)).toEqual([2, 2]);
    expect(await FollowUpSeenModel.countDocuments({ taskId })).toBe(1);
    // Marking twice keeps one row (unique per user and task).
    expect((await seen(a.agent, taskId)).status).toBe(200);
    expect(await FollowUpSeenModel.countDocuments({ taskId })).toBe(1);
  });

  it('reading the FOLLOW_UP notification does not mark the follow-ups seen', async () => {
    const w = await world(app);
    const { a, b, taskId } = await team(w);
    await followUp(b.agent, taskId);
    const items = (await a.agent.get('/api/v1/notifications')).body.items as {
      id: string;
      type: string;
    }[];
    const n = items.find((x) => x.type === 'FOLLOW_UP')!;
    expect(n).toBeTruthy();
    expect(
      (await a.agent.post(`/api/v1/notifications/${n.id}/read`).set(CSRF).send({})).status,
    ).toBe(200);
    expect((await a.agent.post('/api/v1/notifications/read-all').set(CSRF).send({})).status).toBe(
      200,
    );
    expect(await checklist(a.agent, w, taskId)).toEqual([1, 1]);
    expect(await mine(a.agent, taskId)).toEqual([1, 1]);
    expect(await FollowUpSeenModel.countDocuments({ userId: a.user._id })).toBe(0);
  });

  it('anyone who can view the task may mark it seen; outside the project it is 404; CSRF is required', async () => {
    const w = await world(app);
    const { b, taskId } = await team(w);
    await followUp(b.agent, taskId);
    // Another PM can view the project (read-only for them) and so may mark it seen.
    expect((await seen(w.pm2.agent, taskId)).status).toBe(200);
    expect(await checklist(w.pm2.agent, w, taskId)).toEqual([1, 0]);
    expect((await seen(w.outsider.agent, taskId)).status).toBe(404);
    expect((await w.pm.agent.post(`/api/v1/tasks/${taskId}/follow-ups/seen`).send({})).status).toBe(
      403,
    );
    // Archived projects can still be read, so their follow-ups can still be marked seen.
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { archived: true } });
    expect((await seen(w.pm.agent, taskId)).status).toBe(200);
  });

  it('the project checklist computes the badge for every task in one go', async () => {
    const w = await world(app);
    const { a, taskId } = await team(w);
    const others = (await TaskModel.find({ projectId: w.project.id, _id: { $ne: taskId } }).lean())
      .slice(0, 2)
      .map((t) => t._id.toString());
    for (const id of [taskId, ...others]) expect((await followUp(w.pm.agent, id)).status).toBe(201);
    await seen(a.agent, others[0]!);
    const items = (await a.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
      id: string;
      followUpsUnseen: number;
    }[];
    const unseen = Object.fromEntries(items.map((t) => [t.id, t.followUpsUnseen]));
    expect([unseen[taskId], unseen[others[0]!], unseen[others[1]!]]).toEqual([1, 0, 1]);
  });
});

describe('CR-20 (Lean Nov 5): follow-ups posted before the release count as seen', () => {
  afterEach(resetTestTime);
  it('uses one app-wide cutoff, written once, without seen rows per user', async () => {
    const w = await world(app);
    const { a, b, taskId } = await team(w);
    setTestTime('2026-11-05T01:00:00Z');
    expect((await followUp(b.agent, taskId, 'Before the release')).status).toBe(201);
    expect(await checklist(a.agent, w, taskId)).toEqual([1, 1]);
    setTestTime('2026-11-05T02:00:00Z');
    const cutoff = await ensureFollowUpSeenCutoff();
    setTestTime('2026-11-05T03:00:00Z');
    // A later start keeps the first cutoff.
    expect((await ensureFollowUpSeenCutoff()).getTime()).toBe(cutoff.getTime());
    expect(await checklist(a.agent, w, taskId)).toEqual([1, 0]);
    expect(await FollowUpSeenModel.countDocuments({ taskId })).toBe(0);
    expect((await followUp(b.agent, taskId, 'After the release')).status).toBe(201);
    expect(await checklist(a.agent, w, taskId)).toEqual([2, 1]);
    expect(await mine(a.agent, taskId)).toEqual([2, 1]);
  });
});
