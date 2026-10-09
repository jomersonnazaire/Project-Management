import { afterEach, describe, expect, it } from 'vitest';
import { ActivityLogModel, TaskModel } from '../src/models/index.js';
import { FILES, uploadEvidence } from './m3helpers.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

async function tasksOf(agent: Agent, projectId: string) {
  return (await agent.get(`/api/v1/projects/${projectId}/tasks`)).body.items as {
    id: string;
    name: string;
    version: number;
    status: string;
    party: string;
    dependsOn: string[];
  }[];
}

/** Gives every task an owner (Member) and the client task a contact, then returns fresh tasks. */
async function staffed(w: W) {
  for (const t of await tasksOf(w.pm.agent, w.project.id)) {
    const body: Record<string, unknown> = {
      version: t.version,
      ownerId: w.member.user._id.toString(),
    };
    if (t.party === 'CLIENT') body.clientContactId = w.acme.active[0].id;
    const res = await w.pm.agent.patch(`/api/v1/tasks/${t.id}`).set(CSRF).send(body);
    expect(res.status).toBe(200);
  }
  return tasksOf(w.pm.agent, w.project.id);
}

async function move(agent: Agent, id: string, body: Record<string, unknown>) {
  const current = (await agent.get(`/api/v1/tasks/${id}`)).body.task;
  return agent
    .post(`/api/v1/tasks/${id}/status`)
    .set(CSRF)
    .send({ version: current.version, ...body });
}

describe('Plan edits are PM-only (FR-TSK-14, AC-10.1/10.4, AC-05.*, EC-22)', () => {
  it('AC-10.4 a Member editing due date, estimate, owner or dependencies gets 403', async () => {
    const w = await world(app);
    const [t1, t2] = await staffed(w);
    for (const change of [
      { dueDate: '2026-12-01' },
      { estHours: 3 },
      { ownerId: w.member.user._id.toString() },
      { dependsOn: [] },
    ]) {
      const res = await w.member.agent
        .patch(`/api/v1/tasks/${t2!.id}`)
        .set(CSRF)
        .send({ version: t2!.version, ...change });
      expect(res.status, JSON.stringify(change)).toBe(403);
    }
    // Another PM (not managing) and a Viewer can't either; the outsider can't see it at all.
    expect(
      (
        await w.pm2.agent
          .patch(`/api/v1/tasks/${t1!.id}`)
          .set(CSRF)
          .send({ version: t1!.version, estHours: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await w.viewer.agent
          .patch(`/api/v1/tasks/${t1!.id}`)
          .set(CSRF)
          .send({ version: t1!.version, estHours: 1 })
      ).status,
    ).toBe(403);
    expect(
      (
        await w.outsider.agent
          .patch(`/api/v1/tasks/${t1!.id}`)
          .set(CSRF)
          .send({ version: t1!.version, estHours: 1 })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.member.agent
          .post(`/api/v1/projects/${w.project.id}/tasks`)
          .set(CSRF)
          .send({ name: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (
        await w.pm2.agent
          .post(`/api/v1/projects/${w.project.id}/tasks`)
          .set(CSRF)
          .send({ name: 'x' })
      ).status,
    ).toBe(403);
    expect((await w.member.agent.delete(`/api/v1/tasks/${t1!.id}`).set(CSRF)).status).toBe(403);
  });

  it('AC-10.1 / AC-10.2 the PM edits owners, assignees, estimates, dates and adds/removes tasks; EC-58 estimate can be cleared to null', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    const res = await w.pm.agent
      .patch(`/api/v1/tasks/${t1!.id}`)
      .set(CSRF)
      .send({
        version: t1!.version,
        assigneeIds: [w.pm.user._id.toString()],
        estHours: 12,
        dueDate: '2026-10-20',
        plannedStart: '2026-10-12',
      });
    expect(res.body.task).toMatchObject({
      estHours: 12,
      dueDate: '2026-10-20',
      assignees: [{ id: w.pm.user._id.toString() }],
    });
    const cleared = await w.pm.agent
      .patch(`/api/v1/tasks/${t1!.id}`)
      .set(CSRF)
      .send({ version: res.body.task.version, estHours: null });
    expect(cleared.body.task.estHours).toBeNull();
    expect((await TaskModel.findById(t1!.id).lean())!.estHours).toBeNull();
    const added = await w.pm.agent
      .post(`/api/v1/projects/${w.project.id}/tasks`)
      .set(CSRF)
      .send({ name: 'Extra', dependsOn: [t1!.id] });
    expect(added.status).toBe(201);
    expect(added.body.task).toMatchObject({ order: 4, estHours: null, status: 'TODO' });
    const p = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}`)).body.project;
    expect(p).toMatchObject({ taskCount: 4, unestimatedTaskCount: 3 });
    expect((await w.pm.agent.delete(`/api/v1/tasks/${added.body.task.id}`).set(CSRF)).status).toBe(
      204,
    );
    // Template untouched.
    const tpl = (await w.pm.agent.get(`/api/v1/templates/${w.template.id}`)).body.template;
    expect(tpl.activities[0]).toMatchObject({ name: 'Kickoff', estHours: 8 });
    expect(
      (
        await w.pm.agent
          .patch(`/api/v1/tasks/${t1!.id}`)
          .set(CSRF)
          .send({ version: 99, estHours: 1 })
      ).status,
    ).toBe(409);
  });

  it('owners and assignees must be project members; contacts are never people (EC-22); client tasks need a contact of this client (AC-05.1/05.3)', async () => {
    const w = await world(app);
    const [t1, , t3] = await tasksOf(w.pm.agent, w.project.id);
    const bad = [
      { ownerId: w.outsider.user._id.toString() },
      { ownerId: w.acme.active[0].id },
      { assigneeIds: [w.acme.active[0].id] },
    ];
    for (const b of bad) {
      const res = await w.pm.agent
        .patch(`/api/v1/tasks/${t1!.id}`)
        .set(CSRF)
        .send({ version: t1!.version, ...b });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    }
    const noContact = await w.pm.agent
      .patch(`/api/v1/tasks/${t3!.id}`)
      .set(CSRF)
      .send({ version: t3!.version, ownerId: w.member.user._id.toString() });
    expect(noContact.body.error.code).toBe('CONTACT_REQUIRED');
    for (const c of [w.other.active[0].id, w.acme.inactive.id]) {
      const res = await w.pm.agent
        .patch(`/api/v1/tasks/${t3!.id}`)
        .set(CSRF)
        .send({ version: t3!.version, clientContactId: c });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CONTACT_NOT_IN_CLIENT');
    }
    const ok = await w.pm.agent
      .patch(`/api/v1/tasks/${t3!.id}`)
      .set(CSRF)
      .send({ version: t3!.version, clientContactId: w.acme.active[1].id });
    expect(ok.body.task.clientContact).toMatchObject({ name: 'Ben Active', active: true });
  });

  it('EC-15 a dependency cycle created by edits is rejected', async () => {
    const w = await world(app);
    const [t1] = await tasksOf(w.pm.agent, w.project.id);
    const [, , t3] = await tasksOf(w.pm.agent, w.project.id);
    const res = await w.pm.agent
      .patch(`/api/v1/tasks/${t1!.id}`)
      .set(CSRF)
      .send({ version: t1!.version, dependsOn: [t3!.id] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DEPENDENCY_CYCLE');
    expect(res.body.error.message).toMatch(/Kickoff/);
  });
});

describe('Task state machine (workflow §2, FR-TSK-02..06, TC-F04/F06/F09/F11/F14)', () => {
  it('refuses moves outside the state machine and requires a blocker reason; unblock returns to the previous status', async () => {
    const w = await world(app);
    const [t1] = await staffed(w);
    expect((await move(w.member.agent, t1!.id, { status: 'FOR_REVIEW' })).status).toBe(400);
    expect((await move(w.member.agent, t1!.id, { status: 'TODO' })).status).toBe(400);
    expect((await move(w.member.agent, t1!.id, { status: 'BLOCKED' })).body.error.code).toBe(
      'REASON_REQUIRED',
    );
    expect((await move(w.member.agent, t1!.id, { status: 'IN_PROGRESS' })).body.task.status).toBe(
      'IN_PROGRESS',
    );
    const blocked = await move(w.member.agent, t1!.id, {
      status: 'BLOCKED',
      reason: 'Waiting for client template',
    });
    expect(blocked.body.task).toMatchObject({
      status: 'BLOCKED',
      blockerReason: 'Waiting for client template',
      previousStatus: 'IN_PROGRESS',
    });
    expect((await move(w.member.agent, t1!.id, { status: 'COMPLETED' })).status).toBe(400);
    const v = blocked.body.task.version;
    const unblocked = await w.member.agent
      .post(`/api/v1/tasks/${t1!.id}/unblock`)
      .set(CSRF)
      .send({ version: v });
    expect(unblocked.body.task).toMatchObject({ status: 'IN_PROGRESS', blockerReason: null });
    const history = (await w.member.agent.get(`/api/v1/tasks/${t1!.id}/history`)).body.items;
    expect(
      history.some((h: { changes: { field: string; old: unknown }[] }) =>
        h.changes.some(
          (c) => c.field === 'blockerReason' && c.old === 'Waiting for client template',
        ),
      ),
    ).toBe(true);
    // AC-12.2: each move writes an audit entry.
    expect(
      await ActivityLogModel.countDocuments({
        entityId: t1!.id,
        action: { $in: ['task_status_changed', 'task_unblocked'] },
      }),
    ).toBe(3);
  });

  it('AC-16.1/16.2 predecessors must be done; the PM may override with a reason (logged); Members may not', async () => {
    const w = await world(app);
    const [, t2] = await staffed(w);
    const refused = await move(w.member.agent, t2!.id, { status: 'IN_PROGRESS' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'PREDECESSOR_INCOMPLETE' });
    expect(refused.body.error.message).toMatch(/#1 Kickoff/);
    expect(
      (await move(w.member.agent, t2!.id, { status: 'IN_PROGRESS', overrideReason: 'urgent' }))
        .status,
    ).toBe(403);
    const ok = await move(w.pm.agent, t2!.id, {
      status: 'IN_PROGRESS',
      overrideReason: 'Client approved early start',
    });
    expect(ok.body.task.status).toBe('IN_PROGRESS');
    const log = await ActivityLogModel.findOne({
      entityId: t2!.id,
      action: 'task_status_override',
    }).lean();
    expect(log!.reason).toBe('Client approved early start');
  });

  it('AC-14.2/14.3, AC-15.*: approval tasks need evidence, go to For Review, and only the PM approves; reject needs a comment', async () => {
    const w = await world(app);
    const [t1, t2, t3] = await staffed(w);
    for (const t of [t1!, t2!]) {
      await move(w.member.agent, t.id, { status: 'IN_PROGRESS' });
      await move(w.member.agent, t.id, { status: 'COMPLETED' });
    }
    await move(w.member.agent, t3!.id, { status: 'IN_PROGRESS' });
    const noEvidence = await move(w.member.agent, t3!.id, { status: 'COMPLETED' });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.error.code).toBe('EVIDENCE_REQUIRED');
    // FR-EVD-01: links are refused; evidence is an uploaded file.
    const link = await w.member.agent
      .post(`/api/v1/tasks/${t3!.id}/evidence`)
      .set(CSRF)
      .send({ name: 'Sign-off', url: 'https://files.example/signoff.pdf' });
    expect(link.status).toBe(422);
    expect(link.body.error.code).toBe('EVIDENCE_FILES_ONLY');
    expect((await uploadEvidence(w.member.agent, t3!.id, 'signoff.pdf', FILES.pdf())).status).toBe(
      201,
    );
    const review = await move(w.member.agent, t3!.id, { status: 'COMPLETED' });
    expect(review.body.task).toMatchObject({
      status: 'FOR_REVIEW',
      approval: { state: 'PENDING' },
      can: { approve: false },
    });

    const v = review.body.task.version;
    expect(
      (await w.member.agent.post(`/api/v1/tasks/${t3!.id}/approve`).set(CSRF).send({ version: v }))
        .status,
    ).toBe(403);
    expect(
      (await w.pm2.agent.post(`/api/v1/tasks/${t3!.id}/approve`).set(CSRF).send({ version: v }))
        .status,
    ).toBe(403);
    expect(
      (await w.viewer.agent.post(`/api/v1/tasks/${t3!.id}/approve`).set(CSRF).send({ version: v }))
        .status,
    ).toBe(403);
    expect(
      (await w.pm.agent.post(`/api/v1/tasks/${t3!.id}/reject`).set(CSRF).send({ version: v }))
        .status,
    ).toBe(400);
    const rejected = await w.pm.agent
      .post(`/api/v1/tasks/${t3!.id}/reject`)
      .set(CSRF)
      .send({ version: v, comment: 'Wrong file' });
    expect(rejected.body.task).toMatchObject({
      status: 'IN_PROGRESS',
      approval: { state: 'REJECTED', comment: 'Wrong file' },
    });
    const again = await move(w.member.agent, t3!.id, { status: 'COMPLETED' });
    const approved = await w.pm.agent
      .post(`/api/v1/tasks/${t3!.id}/approve`)
      .set(CSRF)
      .send({ version: again.body.task.version });
    expect(approved.body.task).toMatchObject({
      status: 'COMPLETED',
      approval: { state: 'APPROVED', decidedBy: { id: w.pm.user._id.toString() } },
    });
    // Progress follows (FR-PRJ-08): 3 of 3 completed.
    expect((await w.pm.agent.get(`/api/v1/projects/${w.project.id}`)).body.project.progress).toBe(
      100,
    );
    // EC-31 / FR-EVD-07: a file on a completed task can't be removed without reopening the task.
    const ev = approved.body.task.evidence[0].id;
    expect(
      (await w.member.agent.delete(`/api/v1/tasks/${t3!.id}/evidence/${ev}`).set(CSRF)).status,
    ).toBe(403);
    const locked = await w.pm.agent.delete(`/api/v1/tasks/${t3!.id}/evidence/${ev}`).set(CSRF);
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('EVIDENCE_LOCKED');
  });

  it('FR-TSK-06 Members can’t cancel mandatory tasks; the PM needs a reason; reopening is PM-only', async () => {
    const w = await world(app);
    const [t1, , t3] = await staffed(w);
    expect((await move(w.member.agent, t3!.id, { status: 'CANCELLED' })).status).toBe(403);
    expect((await move(w.pm.agent, t3!.id, { status: 'CANCELLED' })).body.error.code).toBe(
      'REASON_REQUIRED',
    );
    expect(
      (await move(w.pm.agent, t3!.id, { status: 'CANCELLED', reason: 'Out of scope' })).body.task
        .status,
    ).toBe('CANCELLED');
    expect((await move(w.pm.agent, t3!.id, { status: 'TODO' })).status).toBe(400);
    await move(w.member.agent, t1!.id, { status: 'IN_PROGRESS' });
    await move(w.member.agent, t1!.id, { status: 'COMPLETED' });
    expect(
      (await move(w.member.agent, t1!.id, { status: 'IN_PROGRESS', reason: 'x' })).status,
    ).toBe(403);
    expect(
      (await move(w.pm.agent, t1!.id, { status: 'IN_PROGRESS', reason: 'Redo minutes' })).body.task
        .status,
    ).toBe('IN_PROGRESS');
  });

  it('only owners/assignees (or the PM) change status; EC-18 stale versions get 409', async () => {
    const w = await world(app);
    const [t1] = await tasksOf(w.pm.agent, w.project.id); // no owner yet
    expect((await move(w.member.agent, t1!.id, { status: 'IN_PROGRESS' })).status).toBe(403);
    expect((await move(w.pm2.agent, t1!.id, { status: 'IN_PROGRESS' })).status).toBe(403);
    expect((await move(w.viewer.agent, t1!.id, { status: 'IN_PROGRESS' })).status).toBe(403);
    expect(
      (
        await w.outsider.agent
          .post(`/api/v1/tasks/${t1!.id}/status`)
          .set(CSRF)
          .send({ version: t1!.version, status: 'IN_PROGRESS' })
      ).status,
    ).toBe(404);
    const first = await w.pm.agent
      .post(`/api/v1/tasks/${t1!.id}/status`)
      .set(CSRF)
      .send({ version: t1!.version, status: 'IN_PROGRESS' });
    expect(first.status).toBe(200);
    const second = await w.pm.agent
      .post(`/api/v1/tasks/${t1!.id}/status`)
      .set(CSRF)
      .send({ version: t1!.version, status: 'BLOCKED', reason: 'x' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'VERSION_CONFLICT',
      message: 'This task changed, refresh to see the latest version.',
    });
    // Follow-up notes: contact must belong to the project's client.
    await w.pm.agent
      .patch(`/api/v1/tasks/${t1!.id}`)
      .set(CSRF)
      .send({ version: first.body.task.version, assigneeIds: [w.member.user._id.toString()] });
    expect(
      (
        await w.member.agent
          .post(`/api/v1/tasks/${t1!.id}/follow-ups`)
          .set(CSRF)
          .send({ note: 'Called', contactId: w.other.active[0].id })
      ).status,
    ).toBe(400);
    const note = await w.member.agent
      .post(`/api/v1/tasks/${t1!.id}/follow-ups`)
      .set(CSRF)
      .send({ note: 'Called Ana', contactId: w.acme.active[0].id });
    expect(note.body.task.followUps[0]).toMatchObject({
      note: 'Called Ana',
      author: { id: w.member.user._id.toString() },
      contact: { name: 'Ana Active' },
    });
  });
});

describe('Board and My tasks (FR-TSK-10/13, AC-12.4, AC-17.1)', () => {
  it('filters the board by assignee and lists my open tasks across projects, overdue first, scoped to me', async () => {
    const w = await world(app);
    await staffed(w);
    // A second project (past dates → overdue) where the Member is assigned one task.
    const late = (
      await w.pm.agent
        .post('/api/v1/projects')
        .set(CSRF)
        .send({
          name: 'Late One',
          clientId: w.acme.client.id,
          managerId: w.pm.user._id.toString(),
          memberIds: [w.member.user._id.toString()],
          startDate: '2020-01-06',
          plannedEndDate: '2020-03-06',
          templateId: w.template.id,
        })
    ).body.project;
    const [lt1] = await tasksOf(w.pm.agent, late.id);
    await w.pm.agent
      .patch(`/api/v1/tasks/${lt1!.id}`)
      .set(CSRF)
      .send({ version: lt1!.version, assigneeIds: [w.member.user._id.toString()] });

    const board = await w.pm.agent.get(
      `/api/v1/projects/${late.id}/tasks?assignee=${w.member.user._id}`,
    );
    expect(board.body.items.map((t: { name: string }) => t.name)).toEqual(['Kickoff']);
    const mine = await w.member.agent.get('/api/v1/tasks/mine');
    expect(mine.status).toBe(200);
    expect(
      mine.body.items.map((t: { name: string; project: { name: string }; role: string }) => [
        t.name,
        t.project.name,
        t.role,
      ]),
    ).toEqual([
      ['Kickoff', 'Late One', 'ASSIGNEE'],
      ['Kickoff', 'Rollout P', 'ACCOUNTABLE'],
      ['Design', 'Rollout P', 'ACCOUNTABLE'],
      ['Client sign-off', 'Rollout P', 'ACCOUNTABLE'],
    ]);
    expect(mine.body.items[0]).toMatchObject({ overdue: true, estHours: 8 });
    expect(mine.body.items[0].daysLate).toBeGreaterThan(0);
    expect(mine.body.counts).toMatchObject({
      overdue: 1,
      assigned: 4,
      accountable: 3,
      toReview: 0,
    });
    expect(
      (await w.member.agent.get('/api/v1/tasks/mine?view=accountable')).body.items,
    ).toHaveLength(3);
    // The outsider sees nothing; the Viewer has no tasks of their own.
    expect((await w.outsider.agent.get('/api/v1/tasks/mine')).body.items).toEqual([]);
    expect((await w.viewer.agent.get('/api/v1/tasks/mine')).body.items).toEqual([]);
  });
});
