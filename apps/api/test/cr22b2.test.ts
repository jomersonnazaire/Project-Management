import { afterEach, describe, expect, it } from 'vitest';
import { todayPH, toDateOnly, type TimelineDto } from '@xc8/shared';
import { ActivityLogModel, ProjectModel, TaskModel } from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

/** CR-22 Part B slice 2: Save baseline and history, actual dates (FR-TL-08, 10, 31; AC-73.1, 2, 6). */
useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];
const today = () => toDateOnly(todayPH(new Date()));
const timeline = async (agent: Agent, id: string) =>
  (await agent.get(`/api/v1/projects/${id}/timeline`)).body as TimelineDto;
const saveBaseline = (agent: Agent, id: string, body: Record<string, unknown> = {}) =>
  agent.post(`/api/v1/projects/${id}/baseline`).set(CSRF).send(body);
async function move(agent: Agent, id: string, body: Record<string, unknown>) {
  const current = (await agent.get(`/api/v1/tasks/${id}`)).body.task;
  return agent
    .post(`/api/v1/tasks/${id}/status`)
    .set(CSRF)
    .send({ version: current.version, ...body });
}

describe('CR-22 B2: Save baseline (FR-TL-08, Q-133, AC-73.1)', () => {
  it('copies every scheduled task’s planned dates, adds a history entry and audits it', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    let tl = await timeline(w.pm.agent, pid);
    expect(tl.baselines).toEqual([]);
    expect(tl.can.saveBaseline).toBe(true);
    // One task loses its start, so it's unscheduled and its baseline stays empty.
    const third = tl.tasks[2]!;
    await TaskModel.updateOne({ _id: third.id }, { $set: { plannedStart: null } });

    const res = await saveBaseline(w.pm.agent, pid, { reason: '  Signed off  ' });
    expect(res.status).toBe(201);
    expect(res.body.baseline).toMatchObject({ reason: 'Signed off', taskCount: 2 });
    tl = await timeline(w.pm.agent, pid);
    expect(tl.tasks[0]).toMatchObject({
      baselineStart: tl.tasks[0]!.plannedStart,
      baselineFinish: tl.tasks[0]!.dueDate,
    });
    expect(tl.tasks[2]).toMatchObject({ baselineStart: null, baselineFinish: null });
    expect(tl.baselines).toHaveLength(1);
    expect(tl.baselines[0]).toMatchObject({
      reason: 'Signed off',
      taskCount: 2,
      savedBy: { id: w.pm.user._id.toString() },
    });
    const log = await ActivityLogModel.findOne({ projectId: pid, action: 'baseline_saved' }).lean();
    expect(log).toMatchObject({ reason: 'Signed off' });
    expect(log!.meta).toMatchObject({ taskCount: 2, unscheduledCount: 1 });

    // Moving a task later leaves its baseline; a second save replaces it, history keeps both.
    await TaskModel.updateOne(
      { _id: tl.tasks[0]!.id },
      { $set: { plannedStart: new Date('2026-11-02'), dueDate: new Date('2026-11-04') } },
    );
    const before = (await timeline(w.pm.agent, pid)).tasks[0]!;
    expect(before.baselineStart).not.toBe('2026-11-02');
    expect((await saveBaseline(w.admin.agent, pid)).status).toBe(201);
    tl = await timeline(w.pm.agent, pid);
    expect(tl.tasks[0]).toMatchObject({
      baselineStart: '2026-11-02',
      baselineFinish: '2026-11-04',
    });
    expect(tl.baselines.map((b) => b.reason)).toEqual([null, 'Signed off']);
    expect(tl.baselines[0]!.savedBy?.id).toBe(w.admin.user._id.toString());
  });

  it('only an Admin or a PM on the project saves; members get 403, other PMs 404, archived 409', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    expect((await saveBaseline(w.member.agent, pid)).status).toBe(403);
    expect((await saveBaseline(w.viewer.agent, pid)).status).toBe(403);
    expect((await saveBaseline(w.pm2.agent, pid)).status).toBe(404);
    expect((await timeline(w.member.agent, pid)).can.saveBaseline).toBe(false);
    expect((await saveBaseline(w.pm.agent, pid, { reason: 'x'.repeat(501) })).status).toBe(400);
    await ProjectModel.updateOne({ _id: pid }, { $set: { archived: true } });
    expect((await saveBaseline(w.pm.agent, pid)).status).toBe(409);
    expect(
      await ActivityLogModel.countDocuments({ projectId: pid, action: 'baseline_saved' }),
    ).toBe(0);
  });
});

describe('CR-22 B2: actual dates (FR-TL-10, AC-73.2, AC-73.6)', () => {
  it('first In Progress sets actual start; Completed sets finish; Reopen clears finish, keeps start', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const t = (await timeline(w.pm.agent, pid)).tasks[0]!;
    const started = await move(w.pm.agent, t.id, { status: 'IN_PROGRESS' });
    expect(started.status).toBe(200);
    expect(started.body.task).toMatchObject({ actualStart: today(), actualFinish: null });
    // A later move doesn't change the start.
    await TaskModel.updateOne({ _id: t.id }, { $set: { actualStart: new Date('2026-11-02') } });
    await move(w.pm.agent, t.id, { status: 'BLOCKED', reason: 'Waiting' });
    const blockedVersion = (await w.pm.agent.get(`/api/v1/tasks/${t.id}`)).body.task.version;
    const unblocked = await w.pm.agent
      .post(`/api/v1/tasks/${t.id}/unblock`)
      .set(CSRF)
      .send({ version: blockedVersion });
    expect(unblocked.body.task.actualStart).toBe('2026-11-02');
    const done = await move(w.pm.agent, t.id, { status: 'COMPLETED' });
    expect(done.body.task).toMatchObject({ actualStart: '2026-11-02', actualFinish: today() });
    const reopened = await move(w.pm.agent, t.id, { status: 'IN_PROGRESS', reason: 'Redo' });
    expect(reopened.body.task).toMatchObject({ actualStart: '2026-11-02', actualFinish: null });
    const again = await move(w.pm.agent, t.id, { status: 'COMPLETED' });
    expect(again.body.task.actualFinish).toBe(today());
    const logs = await ActivityLogModel.find({ entityId: t.id, action: 'task_status_changed' })
      .sort({ at: 1 })
      .lean();
    expect(logs[0]!.changes).toContainEqual({ field: 'actualStart', old: null, new: today() });
    expect(logs.at(-2)!.changes).toContainEqual({
      field: 'actualFinish',
      old: today(),
      new: null,
    });
  });

  it('the PM edits both (audited); a finish before the start is refused; members cannot', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const t = (
      await w.pm.agent.get(`/api/v1/tasks/${(await timeline(w.pm.agent, pid)).tasks[0]!.id}`)
    ).body.task;
    const ok = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t.version, actualStart: '2026-10-12', actualFinish: '2026-10-14' });
    expect(ok.status).toBe(200);
    expect(ok.body.task).toMatchObject({ actualStart: '2026-10-12', actualFinish: '2026-10-14' });
    const log = await ActivityLogModel.findOne({ entityId: t.id, action: 'task_updated' }).lean();
    expect(log!.changes).toContainEqual({ field: 'actualStart', old: null, new: '2026-10-12' });
    const bad = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: ok.body.task.version, actualStart: '2026-10-20' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('actualFinish');
    const member = await w.member.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: ok.body.task.version, actualStart: '2026-10-13' });
    expect(member.status).toBe(403);
  });

  it('FR-TL-31: a Completed task with no actual finish reports the date it was marked Done', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const t = (await timeline(w.pm.agent, pid)).tasks[0]!;
    await move(w.pm.agent, t.id, { status: 'IN_PROGRESS' });
    await move(w.pm.agent, t.id, { status: 'COMPLETED' });
    let tl = await timeline(w.pm.agent, pid);
    expect(tl.tasks[0]).toMatchObject({ actualFinish: today(), doneOn: null });
    await TaskModel.updateOne({ _id: t.id }, { $set: { actualFinish: null } });
    tl = await timeline(w.pm.agent, pid);
    expect(tl.tasks[0]).toMatchObject({ actualFinish: null, doneOn: today() });
  });
});
