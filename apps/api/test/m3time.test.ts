import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectModel, TaskModel } from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';

/** Time logging (doc 12 FR-TIME-01..08). "Now" is Wed Oct 14, 2026 11:00 Manila time. */
useDatabase();
const app = makeApp();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T03:00:00Z'));
});
afterEach(() => vi.useRealTimers());

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

const log = (agent: Agent, taskId: string, workDate: string, hours: number, extra = {}) =>
  agent
    .post('/api/v1/time')
    .set(CSRF)
    .send({ taskId, workDate, hours, ...extra });

async function setup() {
  const w = await world(app);
  const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
    id: string;
  }[];
  return { w, t1: tasks[0]!.id, t2: tasks[1]!.id };
}

describe('FR-TIME-01/02/07: logging', () => {
  it('a member logs time; task actual hours are the sum of entries; the week view totals', async () => {
    const { w, t1 } = await setup();
    const a = await log(w.member.agent, t1, '2026-10-13', 2.5, { type: 'REWORK', notes: 'Fixes' });
    expect(a.status).toBe(201);
    expect(a.body.entry).toMatchObject({
      hours: 2.5,
      type: 'REWORK',
      workDate: '2026-10-13',
      locked: false,
    });
    expect((await log(w.pm.agent, t1, '2026-10-14', 1)).status).toBe(201);
    expect((await TaskModel.findById(t1).lean())!.actualHours).toBe(3.5);
    const week = (await w.member.agent.get('/api/v1/time')).body;
    expect(week).toMatchObject({ weekStart: '2026-10-12', weekEnd: '2026-10-18', total: 2.5 });
    const opts = (await w.member.agent.get('/api/v1/time/options')).body.items;
    expect(opts.map((p: { project: { id: string } }) => p.project.id)).toContain(w.project.id);
    // Project Time tab: PM sees everyone; the member only their own.
    expect((await w.pm.agent.get(`/api/v1/projects/${w.project.id}/time`)).body).toMatchObject({
      total: 3.5,
      scope: 'ALL',
    });
    expect((await w.member.agent.get(`/api/v1/projects/${w.project.id}/time`)).body).toMatchObject({
      total: 2.5,
      scope: 'OWN',
    });
  });

  it('people not on the project get 403 NOT_A_MEMBER (Admin too); outsiders can’t see it at all', async () => {
    const { w, t1 } = await setup();
    const admin = await log(w.admin.agent, t1, '2026-10-13', 1);
    expect(admin.status).toBe(403);
    expect(admin.body.error.code).toBe('NOT_A_MEMBER');
    expect((await log(w.outsider.agent, t1, '2026-10-13', 1)).status).toBe(404);
    expect((await log(w.viewer.agent, t1, '2026-10-13', 1)).status).toBe(403);
  });

  it('hours are 0.25–24 in quarter steps; no future dates; 24 h a day at most', async () => {
    const { w, t1, t2 } = await setup();
    for (const hours of [0, 0.1, 24.25])
      expect((await log(w.member.agent, t1, '2026-10-13', hours)).status, `${hours}`).toBe(400);
    expect((await log(w.member.agent, t1, '2026-10-15', 1)).status).toBe(400);
    expect((await log(w.member.agent, t1, '2026-10-13', 20)).status).toBe(201);
    const over = await log(w.member.agent, t2, '2026-10-13', 4.25);
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('DAILY_LIMIT');
    expect((await log(w.member.agent, t2, '2026-10-13', 4)).status).toBe(201);
  });

  it('closed projects and cancelled tasks refuse time', async () => {
    const { w, t1, t2 } = await setup();
    await TaskModel.updateOne({ _id: t2 }, { $set: { status: 'CANCELLED' } });
    expect((await log(w.member.agent, t2, '2026-10-13', 1)).body.error.code).toBe('TASK_CANCELLED');
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'ON_HOLD' } });
    const res = await log(w.member.agent, t1, '2026-10-13', 1);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PROJECT_CLOSED');
  });
});

describe('FR-TIME-04/06: weekly lock and own entries', () => {
  it('last week is locked for members from Monday 12:00 Manila; PMs can still fix theirs', async () => {
    const { w, t1 } = await setup();
    const locked = await log(w.member.agent, t1, '2026-10-09', 1);
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe('TIME_LOCKED');
    expect((await log(w.pm.agent, t1, '2026-10-09', 1)).status).toBe(201);
    // Monday 11:59 Manila: last week is still open.
    vi.setSystemTime(new Date('2026-10-12T03:59:00Z'));
    expect((await log(w.member.agent, t1, '2026-10-09', 1)).status).toBe(201);
  });

  it('only the author edits or deletes an entry; totals follow', async () => {
    const { w, t1 } = await setup();
    const e = (await log(w.member.agent, t1, '2026-10-13', 2)).body.entry;
    expect(
      (await w.pm.agent.patch(`/api/v1/time/${e.id}`).set(CSRF).send({ hours: 3 })).status,
    ).toBe(404);
    const ok = await w.member.agent.patch(`/api/v1/time/${e.id}`).set(CSRF).send({ hours: 3 });
    expect(ok.status).toBe(200);
    expect((await TaskModel.findById(t1).lean())!.actualHours).toBe(3);
    // Members have no Delete on time entries in the default grid (VCE); PMs delete their own.
    expect((await w.member.agent.delete(`/api/v1/time/${e.id}`).set(CSRF)).status).toBe(403);
    const mine = (await log(w.pm.agent, t1, '2026-10-13', 1)).body.entry;
    expect((await TaskModel.findById(t1).lean())!.actualHours).toBe(4);
    expect((await w.pm.agent.delete(`/api/v1/time/${mine.id}`).set(CSRF)).status).toBe(204);
    expect((await TaskModel.findById(t1).lean())!.actualHours).toBe(3);
  });

  it('a task with logged time can’t be deleted', async () => {
    const { w, t1 } = await setup();
    await log(w.member.agent, t1, '2026-10-13', 1);
    const del = await w.pm.agent.delete(`/api/v1/tasks/${t1}`).set(CSRF);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('TASK_HAS_TIME');
  });
});
