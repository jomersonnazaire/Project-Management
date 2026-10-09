import { afterEach, describe, expect, it } from 'vitest';
import {
  ActivityLogModel,
  DocumentModel,
  FolderModel,
  MessageModel,
  ProjectModel,
  TaskModel,
  TimeEntryModel,
} from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { grant, resetRules, world } from './m2helpers.js';
import { FILES, uploadEvidence } from './m3helpers.js';

/** M3.5: PMs (own projects) and Admins delete a phase or task only when nothing is recorded under it. */
useDatabase();
const app = makeApp();
type W = Awaited<ReturnType<typeof world>>;
afterEach(async () => {
  await resetRules();
});

const base = (w: W) => `/api/v1/projects/${w.project.id}`;
async function tasks(w: W, agent = w.pm.agent) {
  return (await agent.get(`${base(w)}/tasks`)).body.items as {
    id: string;
    name: string;
    phase: string | null;
    deletable: boolean;
    deleteBlockedReason: string | null;
  }[];
}
const del = (agent: W['pm']['agent'], id: string) => agent.delete(`/api/v1/tasks/${id}`).set(CSRF);

describe('Delete a task', () => {
  it('an empty task can be deleted by its PM, with an audit entry; dependencies are cleaned up', async () => {
    const w = await world(app);
    const [a, b] = await tasks(w);
    await TaskModel.updateOne({ _id: b!.id }, { $set: { dependsOn: [a!.id] } });
    expect(a!.deletable).toBe(true);
    expect(a!.deleteBlockedReason).toBeNull();
    expect((await del(w.pm.agent, a!.id)).status).toBe(204);
    expect(await TaskModel.exists({ _id: a!.id })).toBeNull();
    expect((await TaskModel.findById(b!.id).lean())!.dependsOn).toEqual([]);
    const log = await ActivityLogModel.findOne({ entityId: a!.id, action: 'task_deleted' }).lean();
    expect(log).toMatchObject({ meta: { name: a!.name } });
    expect(log!.actorId!.toString()).toBe(w.pm.user._id.toString());
  });

  it('409 TASK_HAS_RECORDS lists what blocks it: time, follow-ups, comments, evidence, documents, issues', async () => {
    const w = await world(app);
    const [t] = await tasks(w);
    const projectId = w.project.id;
    for (let i = 0; i < 3; i++) {
      await TimeEntryModel.create({
        userId: w.member.user._id,
        projectId,
        taskId: t!.id,
        workDate: new Date('2026-10-13T00:00:00Z'),
        hours: 1,
      });
    }
    let res = await del(w.pm.agent, t!.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'TASK_HAS_RECORDS',
      message: 'This task has 3 time entries; remove them first.',
      details: { counts: { timeEntries: 3 } },
    });
    await TaskModel.updateOne(
      { _id: t!.id },
      { $push: { followUps: { authorId: w.pm.user._id, note: 'Called the client' } } },
    );
    await MessageModel.create({
      projectId,
      authorId: w.pm.user._id,
      text: 'Re task',
      taskId: t!.id,
    });
    // A hidden comment doesn't block.
    await MessageModel.create({
      projectId,
      authorId: w.pm.user._id,
      text: 'Hidden',
      taskId: t!.id,
      hidden: { by: w.pm.user._id, at: new Date(), reason: 'Wrong task' },
    });
    res = await del(w.pm.agent, t!.id);
    expect(res.body.error.message).toBe(
      'This task has 3 time entries, 1 follow-up and 1 comment; remove them first.',
    );
    const row = (await tasks(w)).find((x) => x.id === t!.id)!;
    expect(row.deletable).toBe(false);
    expect(row.deleteBlockedReason).toBe(res.body.error.message);
    // Clean up everything: now it can go.
    await TimeEntryModel.deleteMany({ taskId: t!.id });
    await TaskModel.updateOne({ _id: t!.id }, { $set: { followUps: [] } });
    await MessageModel.deleteMany({ taskId: t!.id, hidden: null });
    expect((await del(w.pm.agent, t!.id)).status).toBe(204);
  });

  it('evidence and linked issues block it too', async () => {
    const w = await world(app);
    const [t, u] = await tasks(w);
    const ev = await uploadEvidence(w.pm.agent, t!.id, 'UAT_signoff.pdf', FILES.pdf());
    expect(ev.status).toBe(201);
    const res = await del(w.pm.agent, t!.id);
    expect(res.body.error.message).toBe('This task has 1 evidence file; remove it first.');
    const issue = await w.pm.agent
      .post(`${base(w)}/issues`)
      .set(CSRF)
      .send({
        title: 'Linked',
        description: 'x',
        severity: 'LOW',
        stage: 'BEFORE_GO_LIVE',
        taskIds: [u!.id],
      });
    expect(issue.status).toBe(201);
    const r2 = await del(w.pm.agent, u!.id);
    expect(r2.body.error).toMatchObject({
      code: 'TASK_HAS_RECORDS',
      message: 'This task has 1 linked issue; remove it first.',
    });
    // A document filed against the task (not as evidence) blocks it as well.
    const doc = (await DocumentModel.findOne({ taskId: t!.id }).lean())!;
    await DocumentModel.updateOne({ _id: doc._id }, { $set: { source: 'DOCUMENT' } });
    await TaskModel.updateOne({ _id: t!.id }, { $set: { evidence: [] } });
    expect((await del(w.pm.agent, t!.id)).body.error.message).toBe(
      'This task has 1 document; remove it first.',
    );
  });

  it('only Admins and the project’s own PM: another PM, Members and Viewers get 403', async () => {
    const w = await world(app);
    const [t] = await tasks(w);
    expect((await del(w.pm2.agent, t!.id)).status).toBe(403);
    expect((await del(w.member.agent, t!.id)).status).toBe(403);
    expect((await del(w.viewer.agent, t!.id)).status).toBe(403);
    expect((await tasks(w, w.member.agent))[0]).toMatchObject({
      deletable: false,
      deleteBlockedReason: null,
    });
    expect((await del(w.admin.agent, t!.id)).status).toBe(204);
  });

  it('an Admin who turns off PM Delete on Tasks stops PMs deleting', async () => {
    const w = await world(app);
    const [t] = await tasks(w);
    await grant(app, 'PROJECT_MANAGER', { tasks: { delete: false } });
    expect((await tasks(w))[0]!.deletable).toBe(false);
    expect((await del(w.pm.agent, t!.id)).status).toBe(403);
  });

  it('Completed projects keep their plan: 422 PROJECT_COMPLETED; archived projects: 409', async () => {
    const w = await world(app);
    const [t] = await tasks(w);
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'COMPLETED' } });
    expect((await del(w.pm.agent, t!.id)).body.error.code).toBe('PROJECT_COMPLETED');
    await ProjectModel.updateOne(
      { _id: w.project.id },
      { $set: { status: 'IN_PROGRESS', archived: true } },
    );
    expect((await del(w.pm.agent, t!.id)).status).toBe(409);
  });
});

describe('Delete a phase', () => {
  it('lists phases with counts; a phase with tasks is 409 PHASE_HAS_TASKS', async () => {
    const w = await world(app);
    const ts = await tasks(w);
    const phase = ts[0]!.phase!;
    const n = ts.filter((t) => t.phase === phase).length;
    const list = (await w.pm.agent.get(`${base(w)}/phases`)).body.items;
    expect(list[0]).toMatchObject({
      name: phase,
      taskCount: n,
      deletable: false,
      deleteBlockedReason: `This phase has ${n} task${n === 1 ? '' : 's'}; delete or move ${n === 1 ? 'it' : 'them'} first.`,
    });
    const res = await w.pm.agent
      .delete(`${base(w)}/phases?name=${encodeURIComponent(phase)}`)
      .set(CSRF);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHASE_HAS_TASKS');
  });

  it('once its tasks are gone the phase stays (its folder) and can be deleted; documents block it', async () => {
    const w = await world(app);
    const ts = await tasks(w);
    const phase = ts[0]!.phase!;
    // Open Documents so the phase folders exist, then delete the phase's tasks.
    await w.pm.agent.get(`${base(w)}/folders`);
    for (const t of ts.filter((x) => x.phase === phase)) {
      expect((await del(w.pm.agent, t.id)).status).toBe(204);
    }
    const folder = (await FolderModel.findOne({
      projectId: w.project.id,
      kind: 'PHASE',
      phase,
    }).lean())!;
    expect(folder).toBeTruthy();
    const ph = (await w.pm.agent.get(`${base(w)}/phases`)).body.items.find(
      (p: { name: string }) => p.name === phase,
    );
    expect(ph).toMatchObject({ taskCount: 0, documentCount: 0, deletable: true });
    // A document in the phase folder blocks it.
    const sample = await DocumentModel.create({
      projectId: w.project.id,
      folderId: folder._id,
      name: 'Notes',
      nameKey: 'notes',
      createdBy: w.pm.user._id,
    } as never).catch((e: unknown) => {
      throw e;
    });
    {
      const blocked = await w.pm.agent
        .delete(`${base(w)}/phases?name=${encodeURIComponent(phase)}`)
        .set(CSRF);
      expect(blocked.body.error.code).toBe('PHASE_HAS_DOCUMENTS');
      await DocumentModel.deleteOne({ _id: (sample as unknown as { _id: string })._id });
    }
    expect(
      (await w.member.agent.delete(`${base(w)}/phases?name=${encodeURIComponent(phase)}`).set(CSRF))
        .status,
    ).toBe(403);
    const ok = await w.pm.agent
      .delete(`${base(w)}/phases?name=${encodeURIComponent(phase)}`)
      .set(CSRF);
    expect(ok.status).toBe(204);
    expect(await FolderModel.exists({ _id: folder._id })).toBeNull();
    expect(
      await ActivityLogModel.exists({ action: 'phase_deleted', 'meta.phase': phase }),
    ).toBeTruthy();
    const after = (await w.pm.agent.get(`${base(w)}/phases`)).body.items;
    expect(after.map((p: { name: string }) => p.name)).not.toContain(phase);
    expect(
      (await w.pm.agent.delete(`${base(w)}/phases?name=${encodeURIComponent(phase)}`).set(CSRF))
        .status,
    ).toBe(404);
  });
});
