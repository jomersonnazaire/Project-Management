import { afterEach, describe, expect, it, vi } from 'vitest';
import { HolidayModel, ProjectModel, SettingModel, TaskModel } from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

/**
 * My tasks › Today (doc 12 v0.6.9 FR-TSK-22..25; TC-N22..N31 in docs/qa/05_M3_TEST_CASES.md).
 * The week used: Mon Oct 5 – Sun Oct 11, 2026. "Now" is Thu Oct 8, 10:00 Manila unless set.
 */
useDatabase();
const app = makeApp();
type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
};
const THU_10AM = '2026-10-08T02:00:00Z';

afterEach(async () => {
  vi.useRealTimers();
  await resetRules();
  await HolidayModel.deleteMany({});
  await SettingModel.deleteMany({});
});

interface Row {
  id: string;
  section: 'AGING' | 'PLANNED' | null;
  ageDays: number | null;
  overdue: boolean;
  status: string;
}
async function today(agent: Agent) {
  const res = await agent.get('/api/v1/tasks/mine?view=today');
  expect(res.status).toBe(200);
  return res.body as { items: Row[]; counts: { today: number; due: number } };
}
async function due(agent: Agent) {
  return (await agent.get('/api/v1/tasks/mine?view=due')).body as { items: Row[] };
}
const byId = (items: Row[], id: string) => items.find((x) => x.id === id);

/** The world's first few tasks, all owned by the member, pushed out of the way (future dates). */
async function setup() {
  const w = await world(app);
  const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
    id: string;
  }[];
  await TaskModel.updateMany(
    { projectId: w.project.id },
    {
      $set: { plannedStart: d('2026-11-30'), dueDate: d('2026-12-04'), ownerId: w.pm.user._id },
      $pull: { assigneeIds: w.member.user._id },
    },
  );
  const plan = async (
    i: number,
    plannedStart: string,
    dueDate: string,
    status = 'TODO',
    extra: Record<string, unknown> = {},
  ) => {
    await TaskModel.updateOne(
      { _id: tasks[i]!.id },
      {
        $set: {
          ownerId: w.member.user._id,
          plannedStart: d(plannedStart),
          dueDate: d(dueDate),
          status,
          ...extra,
        },
      },
    );
    return tasks[i]!.id;
  };
  return { w, tasks, plan };
}
async function setDays(agent: Agent, days: number[]) {
  const { version } = (await agent.get('/api/v1/settings/calendar')).body;
  const res = await agent.put('/api/v1/settings/working-days').set(CSRF).send({ days, version });
  expect(res.status).toBe(200);
}
const addHoliday = (agent: Agent, date: string, type: string) =>
  agent
    .post('/api/v1/settings/holidays')
    .set(CSRF)
    .send({ date, name: `Day ${date}`, type });

describe('TC-N22: tabs', () => {
  it('Today and Due are separate views with their own counts; a task can be in both', async () => {
    const { w, plan } = await setup();
    const late = await plan(0, '2026-09-28', '2026-10-02', 'IN_PROGRESS');
    at(THU_10AM);
    const t = await today(w.member.agent);
    expect(t.counts).toMatchObject({ today: 1, due: 1 });
    expect(byId(t.items, late)!.section).toBe('AGING');
    expect(byId((await due(w.member.agent)).items, late)).toMatchObject({ overdue: true });
  });
});

describe('TC-N23 / AC-TODAY-2: Aging vs Planned for today', () => {
  it('planned Monday, Not started, checked Thursday: Aging, 3 working days; In progress → Planned', async () => {
    const { w, plan, tasks } = await setup();
    const id = await plan(0, '2026-10-05', '2026-10-13');
    at(THU_10AM);
    let t = await today(w.member.agent);
    expect(byId(t.items, id)).toMatchObject({ section: 'AGING', ageDays: 3 });
    await TaskModel.updateOne({ _id: tasks[0]!.id }, { $set: { status: 'IN_PROGRESS' } });
    t = await today(w.member.agent);
    expect(byId(t.items, id)).toMatchObject({ section: 'PLANNED' });
    // Each task appears once.
    const ids = t.items.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Planned for today first, then Aging oldest first', async () => {
    const { w, plan } = await setup();
    const planned = await plan(0, '2026-10-08', '2026-10-09');
    const newer = await plan(1, '2026-10-07', '2026-10-13');
    const older = await plan(2, '2026-09-24', '2026-10-13');
    at(THU_10AM);
    const t = await today(w.member.agent);
    expect(t.items.map((x) => x.id)).toEqual([planned, older, newer]);
  });
});

describe('TC-N24 / AC-TODAY-3: planned last week and past due', () => {
  it('is Aging on Today and overdue on Due', async () => {
    const { w, plan } = await setup();
    const id = await plan(0, '2026-09-29', '2026-10-06', 'IN_PROGRESS');
    at(THU_10AM);
    expect(byId((await today(w.member.agent)).items, id)).toMatchObject({
      section: 'AGING',
      ageDays: 7,
    });
    expect(byId((await due(w.member.agent)).items, id)).toMatchObject({ overdue: true });
  });
});

describe('TC-N25 / AC-TODAY-4: age follows the calendar', () => {
  it('a Wednesday Regular holiday makes it 2; a Special working Saturday adds one; unticking a day removes one', async () => {
    const { w, plan } = await setup();
    const mon = await plan(0, '2026-10-05', '2026-10-13');
    const fri = await plan(1, '2026-10-02', '2026-10-13');
    expect((await addHoliday(w.admin.agent, '2026-10-07', 'REGULAR')).status).toBe(201);
    at(THU_10AM);
    let t = await today(w.member.agent);
    expect(byId(t.items, mon)!.ageDays).toBe(2);
    // Fri → Thu: Mon, Tue, Thu (Wed is the holiday) = 3.
    expect(byId(t.items, fri)!.ageDays).toBe(3);
    vi.useRealTimers();
    expect((await addHoliday(w.admin.agent, '2026-10-03', 'SPECIAL_WORKING')).status).toBe(201);
    at(THU_10AM);
    t = await today(w.member.agent);
    expect(byId(t.items, fri)!.ageDays).toBe(4);
    vi.useRealTimers();
    await setDays(w.admin.agent, [1, 3, 4, 5]); // untick Tuesday
    at(THU_10AM);
    t = await today(w.member.agent);
    expect(byId(t.items, mon)!.ageDays).toBe(1);
    expect(byId(t.items, fri)!.ageDays).toBe(3);
  });
});

describe('TC-N27 / AC-TODAY-5: Blocked and On Hold', () => {
  it('a Blocked task shows on both tabs; On Hold project tasks show on neither', async () => {
    const { w, plan, tasks } = await setup();
    const blocked = await plan(0, '2026-10-01', '2026-10-07', 'BLOCKED', {
      blockerReason: 'Waiting on data',
    });
    at(THU_10AM);
    expect(byId((await today(w.member.agent)).items, blocked)).toMatchObject({
      status: 'BLOCKED',
      section: 'AGING',
    });
    expect(byId((await due(w.member.agent)).items, blocked)).toBeTruthy();
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'ON_HOLD' } });
    const t = await today(w.member.agent);
    expect(t.items).toEqual([]);
    expect(t.counts).toMatchObject({ today: 0, due: 0 });
    expect((await due(w.member.agent)).items).toEqual([]);
    void tasks;
  });
});

describe('TC-N28: scope', () => {
  it('only my tasks (owner or assignee); Completed and Cancelled hidden', async () => {
    const { w, plan, tasks } = await setup();
    const owned = await plan(0, '2026-10-08', '2026-10-09');
    await plan(1, '2026-10-05', '2026-10-09', 'COMPLETED');
    // Assigned (not owner).
    await TaskModel.updateOne(
      { _id: tasks[2]!.id },
      {
        $set: {
          ownerId: w.pm.user._id,
          assigneeIds: [w.member.user._id],
          plannedStart: d('2026-10-08'),
          dueDate: d('2026-10-08'),
          status: 'TODO',
        },
      },
    );
    at(THU_10AM);
    const ids = (await today(w.member.agent)).items.map((x) => x.id).sort();
    expect(ids).toEqual([owned, tasks[2]!.id].sort());
    // Another user's tasks are never returned.
    expect((await today(w.outsider.agent)).items).toEqual([]);
    const pmIds = (await today(w.pm.agent)).items.map((x) => x.id);
    expect(pmIds).not.toContain(owned);
    // Cancelled is hidden too.
    vi.useRealTimers();
    await TaskModel.updateOne({ _id: tasks[1]!.id }, { $set: { status: 'CANCELLED' } });
    at(THU_10AM);
    expect((await today(w.member.agent)).items.map((x) => x.id)).not.toContain(tasks[1]!.id);
  });
});

describe('TC-N29 / TC-N30: edges', () => {
  it('planned start today → Planned, age 0; future start → neither', async () => {
    const { w, plan } = await setup();
    const now = await plan(0, '2026-10-08', '2026-10-08');
    const later = await plan(1, '2026-10-09', '2026-10-13');
    at(THU_10AM);
    const t = await today(w.member.agent);
    expect(byId(t.items, now)).toMatchObject({ section: 'PLANNED', ageDays: 0 });
    expect(byId(t.items, later)).toBeUndefined();
  });

  it('a weekend or holiday start counts working days only, never negative', async () => {
    const { w, plan } = await setup();
    const sat = await plan(0, '2026-10-03', '2026-10-13');
    const sun = await plan(1, '2026-10-04', '2026-10-13');
    at('2026-10-05T02:00:00Z'); // Mon 10:00 Manila
    let t = await today(w.member.agent);
    expect(byId(t.items, sat)).toMatchObject({ section: 'AGING', ageDays: 1 });
    expect(byId(t.items, sun)).toMatchObject({ section: 'AGING', ageDays: 1 });
    // Checked on the Sunday itself: Saturday start is 0 working days old (not -1, not 1).
    at('2026-10-04T02:00:00Z');
    t = await today(w.member.agent);
    expect(byId(t.items, sat)).toMatchObject({ section: 'AGING', ageDays: 0 });
  });
});

describe('TC-N31: midnight in Manila', () => {
  it('membership and age follow the Philippine date, not UTC', async () => {
    const { w, plan } = await setup();
    const thu = await plan(0, '2026-10-08', '2026-10-09');
    const mon = await plan(1, '2026-10-05', '2026-10-13');
    // 00:30 Thu Manila = 16:30 Wed UTC.
    at('2026-10-07T16:30:00Z');
    let t = await today(w.member.agent);
    expect(byId(t.items, thu)).toMatchObject({ section: 'PLANNED', ageDays: 0 });
    expect(byId(t.items, mon)!.ageDays).toBe(3);
    // 23:59 Wed Manila: Thursday's task isn't planned yet, and Monday's is 2 days old.
    at('2026-10-07T15:59:00Z');
    t = await today(w.member.agent);
    expect(byId(t.items, thu)).toBeUndefined();
    expect(byId(t.items, mon)!.ageDays).toBe(2);
  });
});
