import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityLogModel, HolidayModel, SettingModel, TaskModel } from '../src/models/index.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

/** Working-day calendar and the Today view (doc 12 §3.1b, TC-N16..N20, FR-CAL-01..05). */
useDatabase();
const app = makeApp();
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([HolidayModel.deleteMany({}), SettingModel.deleteMany({}), resetRules()]);
});

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function newProject(w: W, startDate: string) {
  const res = await w.pm.agent
    .post('/api/v1/projects')
    .set(CSRF)
    .send({
      name: `Cal ${startDate} ${Math.random()}`,
      clientId: w.acme.client.id,
      managerId: w.pm.user._id.toString(),
      memberIds: [w.member.user._id.toString()],
      startDate,
      plannedEndDate: '2027-03-31',
      templateId: w.template.id,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const tasks = (await w.pm.agent.get(`/api/v1/projects/${res.body.project.id}/tasks`)).body.items;
  return {
    project: res.body.project,
    tasks: tasks as { id: string; name: string; plannedStart: string; dueDate: string }[],
  };
}

const addHoliday = (agent: Agent, date: string, name: string, type = 'REGULAR') =>
  agent.post('/api/v1/settings/holidays').set(CSRF).send({ date, name, type });

async function setDays(agent: Agent, days: number[]) {
  const { version } = (await agent.get('/api/v1/settings/calendar')).body;
  return agent.put('/api/v1/settings/working-days').set(CSRF).send({ days, version });
}

describe('TC-N16 / AC-TODAY-1: Today uses the Philippine date', () => {
  it('at 00:30 Manila (16:30 UTC the day before) due-today and overdue tasks show, overdue first', async () => {
    const w = await world(app);
    const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items;
    const mine = { ownerId: w.member.user._id };
    // Oct 9 is "today" in Manila; Oct 8 was yesterday; Oct 10 is tomorrow.
    await TaskModel.updateOne(
      { _id: tasks[0].id },
      { $set: { ...mine, dueDate: d('2026-10-09') } },
    );
    await TaskModel.updateOne(
      { _id: tasks[1].id },
      { $set: { ...mine, dueDate: d('2026-10-08') } },
    );
    await TaskModel.updateOne(
      { _id: tasks[2].id },
      { $set: { ...mine, dueDate: d('2026-10-10') } },
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T16:30:00Z'));
    const res = await w.member.agent.get('/api/v1/tasks/mine?view=today');
    expect(res.status).toBe(200);
    expect(res.body.today).toBe('2026-10-09');
    expect(res.body.counts.today).toBe(2);
    expect(res.body.items.map((t: { id: string }) => t.id)).toEqual([tasks[1].id, tasks[0].id]);
    expect(res.body.items[0]).toMatchObject({ overdue: true, daysLate: 1 });
    expect(res.body.items[1].overdue).toBe(false);
    // One minute before midnight Manila it's still Oct 8 there: only the Oct 8 task is "today".
    vi.setSystemTime(new Date('2026-10-08T15:59:00Z'));
    const before = (await w.member.agent.get('/api/v1/tasks/mine?view=today')).body;
    expect(before.today).toBe('2026-10-08');
    expect(before.items.map((t: { id: string }) => t.id)).toEqual([tasks[1].id]);
  });

  it('the holiday banner data comes back when today is a holiday', async () => {
    const w = await world(app);
    await addHoliday(w.admin.agent, '2026-10-09', 'Test Day', 'SPECIAL_NON_WORKING');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T16:30:00Z'));
    const res = await w.member.agent.get('/api/v1/tasks/mine?view=today');
    expect(res.body.holiday).toEqual({ name: 'Test Day', type: 'SPECIAL_NON_WORKING' });
    expect(res.body.items).toEqual([]);
  });
});

describe('TC-N17 / AC-CAL-1: special working days', () => {
  it('a Saturday special working day counts: 1 working day after Friday lands on Saturday', async () => {
    const w = await world(app);
    expect(
      (await addHoliday(w.admin.agent, '2026-10-17', 'Make-up day', 'SPECIAL_WORKING')).status,
    ).toBe(201);
    // Kickoff: offset 0, 2 days → due = start + 1 working day.
    const { tasks } = await newProject(w, '2026-10-16');
    expect(tasks[0]!.plannedStart).toBe('2026-10-16');
    expect(tasks[0]!.dueDate).toBe('2026-10-17');
  });
});

describe('TC-N18 / AC-CAL-3 / FR-CAL-05: working days', () => {
  it('unticking every day is refused with 422 and the old days stay', async () => {
    const w = await world(app);
    const res = await setDays(w.admin.agent, []);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('Keep at least one working day.');
    expect((await w.admin.agent.get('/api/v1/settings/calendar')).body.workingDays).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('only Saturday ticked: Friday’s start rolls to Saturday; changes are audited and existing dates stay', async () => {
    const w = await world(app);
    const before = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items;
    const res = await setDays(w.admin.agent, [6]);
    expect(res.status).toBe(200);
    expect(res.body.workingDays).toEqual([6]);
    const { tasks } = await newProject(w, '2026-10-16');
    expect(tasks[0]!.plannedStart).toBe('2026-10-17');
    expect(tasks[0]!.dueDate).toBe('2026-10-24');
    const after = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items;
    expect(after.map((t: { dueDate: string }) => t.dueDate)).toEqual(
      before.map((t: { dueDate: string }) => t.dueDate),
    );
    expect(await ActivityLogModel.exists({ action: 'working_days_updated' })).toBeTruthy();
    // A stale version is a conflict.
    const stale = await w.admin.agent
      .put('/api/v1/settings/working-days')
      .set(CSRF)
      .send({ days: [1], version: 0 });
    expect(stale.status).toBe(409);
  });
});

describe('TC-N19 / AC-CAL-2: adding a holiday never moves due dates', () => {
  it('shows the count first, keeps existing dates, and new projects skip the day', async () => {
    const w = await world(app);
    const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items;
    const day = tasks[0].dueDate as string; // Kickoff of a project starting Mon Oct 12 → Tue Oct 13.
    expect(day).toBe('2026-10-13');
    const impact = (await w.admin.agent.get(`/api/v1/settings/holidays/impact?date=${day}`)).body;
    expect(impact.count).toBeGreaterThanOrEqual(1);
    expect(impact.tasks.map((t: { id: string }) => t.id)).toContain(tasks[0].id);
    const added = await addHoliday(w.admin.agent, day, 'Surprise holiday');
    expect(added.status).toBe(201);
    expect(added.body.tasksDue).toBe(impact.count);
    const again = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items;
    expect(again[0].dueDate).toBe(day);
    const log = await ActivityLogModel.findOne({ action: 'holiday_added' }).lean();
    expect(log?.meta).toMatchObject({ dueDatesChanged: 0 });
    const { tasks: fresh } = await newProject(w, '2026-10-12');
    expect(fresh[0]!.dueDate).toBe('2026-10-14');
  });
});

describe('TC-N20: duplicates and long holiday runs', () => {
  it('a duplicate date is refused with the existing holiday’s name', async () => {
    const w = await world(app);
    expect((await addHoliday(w.admin.agent, '2026-11-30', 'Bonifacio Day')).status).toBe(201);
    const dup = await addHoliday(w.admin.agent, '2026-11-30', 'Again', 'SPECIAL_NON_WORKING');
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({
      code: 'DUPLICATE_HOLIDAY',
      message: 'Nov 30, 2026 already has a holiday ("Bonifacio Day").',
    });
  });

  it('10 holidays in a row after a weekend still compute quickly', async () => {
    const w = await world(app);
    for (let i = 0; i < 10; i += 1) {
      const date = new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10);
      const type =
        new Date(`${date}T00:00:00Z`).getUTCDay() % 6 === 0 ? 'SPECIAL_NON_WORKING' : 'REGULAR';
      expect((await addHoliday(w.admin.agent, date, `Run ${i}`, type)).status).toBe(201);
    }
    const t0 = Date.now();
    // Starts Saturday Oct 17; Oct 19–28 are holidays → first working day is Thu Oct 29.
    const { tasks } = await newProject(w, '2026-10-17');
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(tasks[0]!.plannedStart).toBe('2026-10-29');
    expect(tasks[0]!.dueDate).toBe('2026-10-30');
  });

  it('only Sunday ticked still computes', async () => {
    const w = await world(app);
    expect((await setDays(w.admin.agent, [0])).status).toBe(200);
    const { tasks } = await newProject(w, '2026-10-16');
    expect(tasks[0]!.plannedStart).toBe('2026-10-18');
    expect(tasks[0]!.dueDate).toBe('2026-10-25');
  });
});

describe('FR-CAL-01/04: holiday admin', () => {
  it('only Admin changes the calendar; PM gets 403; changes are audited', async () => {
    const w = await world(app);
    expect((await addHoliday(w.pm.agent, '2026-12-25', 'Christmas Day')).status).toBe(403);
    expect((await setDays(w.pm.agent, [1, 2, 3, 4, 5, 6])).status).toBe(403);
    const h = (await addHoliday(w.admin.agent, '2026-12-25', 'Christmas Day')).body.holiday;
    const edit = await w.admin.agent
      .patch(`/api/v1/settings/holidays/${h.id}`)
      .set(CSRF)
      .send({ note: 'Fixed' });
    expect(edit.status).toBe(200);
    expect(edit.body.holiday.note).toBe('Fixed');
    expect((await w.admin.agent.delete(`/api/v1/settings/holidays/${h.id}`).set(CSRF)).status).toBe(
      204,
    );
    const actions = (await ActivityLogModel.find({ entityType: 'holiday' }).lean()).map(
      (l) => l.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['holiday_added', 'holiday_updated', 'holiday_removed']),
    );
  });

  it('copies from the previous year, skipping dates that exist and Feb 29', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    await addHoliday(admin.agent, '2028-02-29', 'Leap');
    await addHoliday(admin.agent, '2028-12-25', 'Christmas Day');
    await addHoliday(admin.agent, '2028-01-01', 'New Year');
    await addHoliday(admin.agent, '2029-01-01', 'Already there');
    const res = await admin.agent
      .post('/api/v1/settings/holidays/copy')
      .set(CSRF)
      .send({ fromYear: 2028, toYear: 2029 });
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(1);
    const list = (await admin.agent.get('/api/v1/settings/calendar?year=2029')).body.holidays;
    expect(list.map((h: { date: string; name: string }) => `${h.date} ${h.name}`)).toEqual([
      '2029-01-01 Already there',
      '2029-12-25 Christmas Day',
    ]);
  });
});
