import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityLogModel,
  LookupModel,
  MigrationModel,
  NotificationModel,
  ProjectModel,
  TimeEntryModel,
  TimesheetDayModel,
  UserModel,
} from '../src/models/index.js';
import { sweepAutoStop } from '../src/services/tracker.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';
import { lookups } from './trackerHelpers.js';

/**
 * M5 Activity Tracker (doc 14 §2, §10, §12; QA 06 TC-Q01..Q14). "Now" is Wed Oct 14, 2026
 * 10:00 Manila time; the weekly lock (Monday 12:00) has locked last week.
 */
useDatabase();
// Timers run for hours in these tests: keep the test sessions alive meanwhile.
const app = makeApp({ SESSION_IDLE_MINUTES: '1440' });
const at = (iso: string) => vi.setSystemTime(new Date(iso));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-10-14T02:00:00Z');
});
afterEach(async () => {
  vi.useRealTimers();
  // The database is shared by the tests in this file: start each one clean.
  await Promise.all(
    [
      TimeEntryModel,
      TimesheetDayModel,
      NotificationModel,
      ActivityLogModel,
      LookupModel,
      MigrationModel,
    ].map((m) => (m as typeof TimeEntryModel).deleteMany({})),
  );
});

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];
type L = Awaited<ReturnType<typeof lookups>>;

async function setup() {
  const w = await world(app);
  const l = await lookups();
  const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
    id: string;
  }[];
  // Member reports to PM (doc 14 §5).
  await UserModel.updateOne({ _id: w.member.user._id }, { supervisorId: w.pm.user._id });
  return { w, l, t1: tasks[0]!.id, t2: tasks[1]!.id };
}

const task = (l: L, taskId: string, extra = {}) => ({
  taskId,
  activityTypeId: l.configuration,
  moduleId: l.financials,
  ...extra,
});
const start = (a: Agent, body: object) => a.post('/api/v1/tracker/start').set(CSRF).send(body);
const stop = (a: Agent) => a.post('/api/v1/tracker/stop').set(CSRF).send({});
const manual = (a: Agent, body: object) => a.post('/api/v1/tracker/entries').set(CSRF).send(body);
const day = (a: Agent, date: string, userId?: string) =>
  a.get(`/api/v1/tracker/day?date=${date}${userId ? `&userId=${userId}` : ''}`);

describe('TC-Q01/Q02: Time in and Time out', () => {
  it('records server times in exact minutes; a client start is refused', async () => {
    const { w, l, t1 } = await setup();
    const forged = await start(w.member.agent, {
      ...task(l, t1),
      dayLocationId: l.onsite,
      startAt: '2026-10-14T00:00:00Z',
    });
    expect(forged.status).toBe(400);
    const a = await start(w.member.agent, { ...task(l, t1), dayLocationId: l.onsite });
    expect(a.status).toBe(201);
    expect(a.body.entry).toMatchObject({
      running: true,
      startAt: '2026-10-14T02:00:00.000Z',
      type: 'EXECUTION',
      billable: true,
      date: '2026-10-14',
    });
    at('2026-10-14T02:07:00Z');
    const s = await stop(w.member.agent);
    expect(s.body.entry).toMatchObject({
      running: false,
      minutes: 7,
      endAt: '2026-10-14T02:07:00.000Z',
    });
    expect((await stop(w.member.agent)).body.error.code).toBe('NO_TIMER');
  });

  it("Time in then Time out puts the entry on that day's timesheet and DAR, nothing typed", async () => {
    const { w, l, t1 } = await setup();
    // The body is what the Time in dialog sends with its prefilled values: no times at all.
    expect((await start(w.member.agent, { ...task(l, t1), dayLocationId: l.onsite })).status).toBe(
      201,
    );
    at('2026-10-14T03:25:00Z');
    expect((await stop(w.member.agent)).status).toBe(200);
    const d = (await day(w.member.agent, '2026-10-14')).body.day;
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({
      kind: 'TASK',
      task: { id: t1 },
      date: '2026-10-14',
      startAt: '2026-10-14T02:00:00.000Z',
      endAt: '2026-10-14T03:25:00.000Z',
      minutes: 85,
      running: false,
      timed: true,
      location: { id: l.onsite },
    });
    expect(d.totalMinutes).toBe(85);
    const dar = (await w.member.agent.get('/api/v1/dar?from=2026-10-14&to=2026-10-14')).body.report;
    expect(dar.rows).toHaveLength(1);
    expect(dar.rows[0]).toMatchObject({
      timeIn: '10:00 AM',
      timeOut: '11:25 AM',
      rendered: '01:25',
    });
  });

  it('starting B stops A at the same moment; only one runs', async () => {
    const { w, l, t1, t2 } = await setup();
    const a = await start(w.member.agent, { ...task(l, t1), dayLocationId: l.onsite });
    at('2026-10-14T02:30:00Z');
    const b = await start(w.member.agent, task(l, t2));
    expect(b.body.stopped).toBe(a.body.entry.id);
    const first = await TimeEntryModel.findById(a.body.entry.id).lean();
    expect(first!.endAt!.toISOString()).toBe(b.body.entry.startAt);
    expect(first!.minutes).toBe(30);
    expect(await TimeEntryModel.countDocuments({ running: true })).toBe(1);
    const running = await w.member.agent.get('/api/v1/tracker/running');
    expect(running.body.entry.task.id).toBe(t2);
    expect(running.body.now).toBe('2026-10-14T02:30:00.000Z');
  });
});

describe('TC-Q03: auto-stop at 23:59 PHT (EC-75)', () => {
  it('a timer left running stops at 23:59 of its day, flagged, never past midnight', async () => {
    const { w, l, t1 } = await setup();
    at('2026-10-13T15:00:00Z'); // 23:00 PHT Tue
    await start(w.member.agent, { ...task(l, t1), dayLocationId: l.onsite });
    at('2026-10-13T16:30:00Z'); // 00:30 PHT Wed
    expect(await sweepAutoStop()).toBe(1);
    const e = await TimeEntryModel.findOne({ userId: w.member.user._id }).lean();
    expect(e).toMatchObject({ running: false, autoStopped: true, minutes: 59 });
    expect(e!.endAt!.toISOString()).toBe('2026-10-13T15:59:00.000Z');
    expect((await w.member.agent.get('/api/v1/tracker/running')).body.entry).toBeNull();
    const d = await day(w.member.agent, '2026-10-13');
    expect(d.body.day.entries[0].autoStopped).toBe(true);
  });

  it('a request after midnight stops it lazily too', async () => {
    const { w, l, t1 } = await setup();
    at('2026-10-13T15:30:00Z');
    await start(w.member.agent, { ...task(l, t1), dayLocationId: l.onsite });
    at('2026-10-14T01:00:00Z');
    expect((await w.member.agent.get('/api/v1/tracker/running')).body.entry).toBeNull();
    const e = await TimeEntryModel.findOne({ userId: w.member.user._id }).lean();
    expect(e!.endAt!.toISOString()).toBe('2026-10-13T15:59:00.000Z');
  });
});

describe('TC-Q04/Q05: overlaps and the 24-hour cap', () => {
  it('refuses an overlap, allows touching edges, leaves hours-only entries alone', async () => {
    const { w, l, t1 } = await setup();
    const base = { ...task(l, t1), date: '2026-10-13', dayLocationId: l.onsite };
    expect(
      (await manual(w.member.agent, { ...base, timeIn: '08:00', timeOut: '12:00' })).status,
    ).toBe(201);
    const bad = await manual(w.member.agent, { ...base, timeIn: '11:30', timeOut: '13:00' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('TIME_OVERLAP');
    expect(bad.body.error.message).toMatch(
      /^This overlaps ".+" \(08:00 AM–12:00 PM\)\. Adjust the times so they don't overlap\.$/,
    );
    const touch = await manual(w.member.agent, { ...base, timeIn: '12:00', timeOut: '13:00' });
    expect(touch.status).toBe(201);
    expect(touch.body.entry.minutes).toBe(60);
    const hoursOnly = await w.member.agent.post('/api/v1/time').set(CSRF).send({
      taskId: t1,
      workDate: '2026-10-13',
      hours: 2,
      activityTypeId: l.configuration,
      moduleId: l.financials,
    });
    expect(hoursOnly.status).toBe(201);
    // A manual entry can't end in the future.
    const future = await manual(w.member.agent, {
      ...base,
      date: '2026-10-14',
      timeIn: '09:00',
      timeOut: '11:00',
    });
    expect(future.status).toBe(400);
  });

  it('refuses a day over 24 hours with HHh MMm and the next step', async () => {
    const { w, l, t1 } = await setup();
    for (const h of [12, 8]) {
      await w.member.agent.post('/api/v1/time').set(CSRF).send({
        taskId: t1,
        workDate: '2026-10-13',
        hours: h,
        activityTypeId: l.configuration,
        moduleId: l.financials,
      });
    }
    const res = await manual(w.member.agent, {
      ...task(l, t1),
      date: '2026-10-13',
      dayLocationId: l.onsite,
      timeIn: '08:00',
      timeOut: '12:30',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe(
      "This would bring your total for 2026-10-13 to 24h 30m. A day can't exceed 24 hours. Shorten or remove an entry.",
    );
  });
});

describe('TC-Q06/Q07: quick activities and their privacy', () => {
  it('needs a title and Activity type; no client, project or time type; not billable', async () => {
    const { w, l } = await setup();
    const q = {
      activityTypeId: l.internalMeeting,
      date: '2026-10-13',
      timeIn: '09:00',
      timeOut: '09:30',
      dayLocationId: l.office,
    };
    expect(
      (await manual(w.member.agent, { ...q, activityTypeId: undefined, title: 'Standup' })).status,
    ).toBe(400);
    expect((await manual(w.member.agent, q)).status).toBe(400);
    expect((await manual(w.member.agent, { ...q, title: 'Standup', type: 'REWORK' })).status).toBe(
      400,
    );
    const ok = await manual(w.member.agent, { ...q, title: 'Standup' });
    expect(ok.status).toBe(201);
    expect(ok.body.entry).toMatchObject({
      kind: 'QUICK',
      title: 'Standup',
      project: null,
      client: null,
      type: null,
      billable: false,
      module: null,
      minutes: 30,
    });
  });

  it('others get 404; the supervisor and Admins view but cannot edit', async () => {
    const { w, l } = await setup();
    const res = await manual(w.member.agent, {
      title: 'Payroll call',
      activityTypeId: l.internalMeeting,
      date: '2026-10-13',
      timeIn: '09:00',
      timeOut: '09:30',
      dayLocationId: l.office,
    });
    const id = res.body.entry.id;
    const uid = w.member.user._id.toString();
    for (const who of [w.outsider, w.pm2, w.viewer]) {
      expect((await day(who.agent, '2026-10-13', uid)).status).toBe(404);
      expect(
        (await who.agent.patch(`/api/v1/tracker/entries/${id}`).set(CSRF).send({ notes: 'x' }))
          .status,
      ).toBe(404);
      expect((await who.agent.delete(`/api/v1/tracker/entries/${id}`).set(CSRF)).status).toBe(404);
    }
    for (const who of [w.pm, w.admin]) {
      const d = await day(who.agent, '2026-10-13', uid);
      expect(d.status).toBe(200);
      expect(d.body.day.entries[0].title).toBe('Payroll call');
      expect(d.body.day.can.edit).toBe(false);
      expect(
        (await who.agent.patch(`/api/v1/tracker/entries/${id}`).set(CSRF).send({ notes: 'x' }))
          .status,
      ).toBe(403);
    }
    const people = await w.pm.agent.get('/api/v1/tracker/people');
    expect(people.body.items.map((p: { id: string }) => p.id)).toContain(uid);
  });
});

describe('TC-Q08: location per day', () => {
  it('the first entry asks, later entries inherit, one entry can differ', async () => {
    const { w, l, t1 } = await setup();
    const first = await start(w.member.agent, task(l, t1));
    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe('LOCATION_NEEDED');
    expect(first.body.error.message).toBe('Where are you working today?');
    const a = await start(w.member.agent, { ...task(l, t1), dayLocationId: l.wfh });
    expect(a.body.entry).toMatchObject({ location: { name: 'WFH' }, locationOverridden: false });
    at('2026-10-14T04:00:00Z');
    await stop(w.member.agent);
    at('2026-10-14T05:00:00Z');
    const b = await start(w.member.agent, task(l, t1, { locationId: l.onsite }));
    expect(b.body.entry).toMatchObject({ location: { name: 'Onsite' }, locationOverridden: true });
    at('2026-10-14T06:00:00Z');
    const c = await start(w.member.agent, task(l, t1));
    expect(c.body.entry.location.name).toBe('WFH');
    // Changing the day's location moves entries that follow it.
    const put = await w.member.agent
      .put('/api/v1/tracker/days/2026-10-14/location')
      .set(CSRF)
      .send({ locationId: l.office });
    expect(put.body.day.location.name).toBe('Office');
    const names = put.body.day.entries.map((e: { location: { name: string } }) => e.location.name);
    expect(names).toEqual(['Office', 'Onsite', 'Office']);
  });
});

describe('TC-Q09: Activity types, Locations and Modules lists', () => {
  it('Admin-only edits; in-use values deactivate, not delete; past entries keep the label', async () => {
    const { w, l, t1 } = await setup();
    expect(
      (await w.member.agent.post('/api/v1/lookups/activity-types').set(CSRF).send({ name: 'X' }))
        .status,
    ).toBe(403);
    expect((await w.pm.agent.get('/api/v1/lookups/modules/all')).status).toBe(403);
    const all = await w.admin.agent.get('/api/v1/lookups/locations/all');
    expect(all.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Onsite',
      'WFH',
      'Office',
    ]);
    const dup = await w.admin.agent
      .post('/api/v1/lookups/locations')
      .set(CSRF)
      .send({ name: 'wfh' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('"WFH" already exists.');
    const created = await w.admin.agent
      .post('/api/v1/lookups/modules')
      .set(CSRF)
      .send({ name: 'Production' });
    expect(created.status).toBe(201);
    expect(
      (await w.admin.agent.delete(`/api/v1/lookups/${created.body.item.id}`).set(CSRF)).status,
    ).toBe(204);

    await manual(w.member.agent, {
      ...task(l, t1),
      date: '2026-10-13',
      timeIn: '08:00',
      timeOut: '09:00',
      dayLocationId: l.onsite,
    });
    const del = await w.admin.agent.delete(`/api/v1/lookups/${l.configuration}`).set(CSRF);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toBe(
      '"Configuration" is used by 1 entry, so it can\'t be deleted. Deactivate it instead.',
    );
    const off = await w.admin.agent
      .patch(`/api/v1/lookups/${l.configuration}`)
      .set(CSRF)
      .send({ active: false });
    expect(off.body.item).toMatchObject({ active: false, usedBy: 1 });
    const d = await day(w.member.agent, '2026-10-13');
    expect(d.body.day.entries[0].activityType.name).toBe('Configuration');
    const forms = await w.member.agent.get('/api/v1/lookups');
    expect(forms.body.activityTypes.map((a: { name: string }) => a.name)).not.toContain(
      'Configuration',
    );
    const again = await manual(w.member.agent, {
      ...task(l, t1),
      date: '2026-10-13',
      timeIn: '10:00',
      timeOut: '11:00',
    });
    expect(again.status).toBe(400);
    expect(await ActivityLogModel.countDocuments({ action: 'lookup_updated' })).toBe(1);
  });
});

describe('TC-Q10/Q11/Q12: submit, reopen and the weekly lock', () => {
  it('submit is refused while a timer runs, then the day is read-only', async () => {
    const { w, l, t1 } = await setup();
    const a = await start(w.member.agent, { ...task(l, t1), dayLocationId: l.onsite });
    const refused = await w.member.agent
      .post('/api/v1/tracker/days/2026-10-14/submit')
      .set(CSRF)
      .send({});
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toBe('Stop the running timer before submitting this day.');
    at('2026-10-14T03:00:00Z');
    await stop(w.member.agent);
    const ok = await w.member.agent
      .post('/api/v1/tracker/days/2026-10-14/submit')
      .set(CSRF)
      .send({});
    expect(ok.body.day).toMatchObject({ status: 'SUBMITTED', can: { edit: false, submit: false } });
    const patch = await w.member.agent
      .patch(`/api/v1/tracker/entries/${a.body.entry.id}`)
      .set(CSRF)
      .send({ notes: 'x' });
    expect(patch.status).toBe(422);
    expect(patch.body.error.message).toBe(
      'This day is locked. Ask your supervisor or an Admin to reopen it.',
    );
    expect((await start(w.member.agent, task(l, t1))).body.error.code).toBe('DAY_LOCKED');
    const time = await w.member.agent.post('/api/v1/time').set(CSRF).send({
      taskId: t1,
      workDate: '2026-10-14',
      hours: 1,
      activityTypeId: l.integration,
      moduleId: l.financials,
    });
    expect(time.body.error.code).toBe('DAY_LOCKED');
    // Late submission of an earlier day this week is fine.
    const late = await w.member.agent
      .post('/api/v1/tracker/days/2026-10-13/submit')
      .set(CSRF)
      .send({});
    expect(late.body.day.status).toBe('SUBMITTED');
  });

  it('only the supervisor or an Admin reopens, with a reason; audited and notified', async () => {
    const { w } = await setup();
    await w.member.agent.post('/api/v1/tracker/days/2026-10-13/submit').set(CSRF).send({});
    const body = { userId: w.member.user._id.toString(), reason: 'Missing afternoon entries' };
    const url = '/api/v1/tracker/days/2026-10-13/reopen';
    expect((await w.member.agent.post(url).set(CSRF).send(body)).status).toBe(403);
    expect((await w.pm2.agent.post(url).set(CSRF).send(body)).status).toBe(403);
    expect(
      (
        await w.pm.agent
          .post(url)
          .set(CSRF)
          .send({ ...body, reason: ' ' })
      ).status,
    ).toBe(400);
    const ok = await w.pm.agent.post(url).set(CSRF).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.day.status).toBe('REOPENED');
    expect(ok.body.day.reopened[0]).toMatchObject({ reason: 'Missing afternoon entries' });
    expect(
      await ActivityLogModel.countDocuments({ action: 'day_reopened', reason: body.reason }),
    ).toBe(1);
    const n = await NotificationModel.findOne({
      userId: w.member.user._id,
      type: 'DAY_REOPENED',
    }).lean();
    expect(n!.message).toBe(
      `${w.pm.user.name} reopened your timesheet for 2026-10-13: Missing afternoon entries. Make your changes and submit it again before the weekly lock.`,
    );
    const list = await w.member.agent.get('/api/v1/notifications');
    expect(list.body.items[0]).toMatchObject({
      type: 'DAY_REOPENED',
      project: null,
      link: '/my-tasks?tab=day&date=2026-10-13',
    });
    expect(
      (await w.member.agent.get('/api/v1/tracker/day?date=2026-10-13')).body.day.can.edit,
    ).toBe(true);
  });

  it('past the weekly lock: unsubmitted days lock as they stand, flagged; only an Admin reopens', async () => {
    const { w, l, t1 } = await setup();
    at('2026-10-09T08:00:00Z'); // Fri last week, 4 PM
    await manual(w.member.agent, {
      ...task(l, t1),
      date: '2026-10-09',
      timeIn: '08:00',
      timeOut: '12:00',
      dayLocationId: l.onsite,
    });
    at('2026-10-14T02:00:00Z');
    const d = await day(w.member.agent, '2026-10-09');
    expect(d.body.day).toMatchObject({
      notSubmitted: true,
      weekLocked: true,
      can: { edit: false, submit: false },
    });
    expect(d.body.day.entries[0].locked).toBe(true);
    const add = await manual(w.member.agent, {
      ...task(l, t1),
      date: '2026-10-09',
      timeIn: '13:00',
      timeOut: '14:00',
    });
    expect(add.body.error.code).toBe('DAY_LOCKED');
    const body = { userId: w.member.user._id.toString(), reason: 'Client sign-off visit' };
    const url = '/api/v1/tracker/days/2026-10-09/reopen';
    const sup = await w.pm.agent.post(url).set(CSRF).send(body);
    expect(sup.status).toBe(403);
    expect(sup.body.error.message).toBe(
      'This day is past the weekly lock. Only an Admin can reopen it.',
    );
    expect((await day(w.pm.agent, '2026-10-09', body.userId)).body.day.can.reopen).toBe(false);
    expect((await day(w.admin.agent, '2026-10-09', body.userId)).body.day.can.reopen).toBe(true);
    expect((await w.admin.agent.post(url).set(CSRF).send(body)).status).toBe(200);
    const again = await manual(w.member.agent, {
      ...task(l, t1),
      date: '2026-10-09',
      timeIn: '13:00',
      timeOut: '14:00',
    });
    expect(again.status).toBe(201);
    const submit = await w.member.agent
      .post('/api/v1/tracker/days/2026-10-09/submit')
      .set(CSRF)
      .send({});
    expect(submit.body.day.status).toBe('SUBMITTED');
  });
});

describe('TC-Q13/Q14: On Hold and the Philippine date', () => {
  it('a project going On Hold stops its timers at that moment', async () => {
    const { w, l, t1 } = await setup();
    await start(w.member.agent, { ...task(l, t1), dayLocationId: l.onsite });
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'ACTIVE' } });
    at('2026-10-14T02:45:00Z');
    const hold = await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ status: 'ON_HOLD' });
    expect(hold.status).toBe(200);
    const e = await TimeEntryModel.findOne({ userId: w.member.user._id }).lean();
    expect(e).toMatchObject({ running: false, minutes: 45 });
    const n = await NotificationModel.findOne({
      userId: w.member.user._id,
      type: 'TIMER_STOPPED',
    }).lean();
    expect(n!.message).toMatch(
      /^Rollout P was put on hold, so your timer on ".+" stopped at 10:45 AM\.$/,
    );
    expect((await start(w.member.agent, task(l, t1))).body.error.code).toBe('PROJECT_CLOSED');
  });

  it('at 00:30 PHT the entry lands on the Philippine date', async () => {
    at('2026-10-14T16:30:00Z');
    const { w, l, t1 } = await setup();
    const a = await start(w.member.agent, { ...task(l, t1), dayLocationId: l.onsite });
    expect(a.body.entry.date).toBe('2026-10-15');
  });
});

describe('Supervisor (doc 14 §5, TC-S08)', () => {
  it('refuses self and loops; Admin › Users shows who has none', async () => {
    const { w } = await setup();
    const id = w.pm.user._id.toString();
    const self = await w.admin.agent
      .patch(`/api/v1/users/${id}`)
      .set(CSRF)
      .send({ supervisorId: id });
    expect(self.status).toBe(400);
    const loop = await w.admin.agent
      .patch(`/api/v1/users/${id}`)
      .set(CSRF)
      .send({ supervisorId: w.member.user._id.toString() });
    expect(loop.status).toBe(400);
    expect(loop.body.error.details[0].path).toBe('supervisorId');
    const ok = await w.admin.agent
      .patch(`/api/v1/users/${id}`)
      .set(CSRF)
      .send({ supervisorId: w.admin.user._id.toString() });
    expect(ok.body.user.supervisorId).toBe(w.admin.user._id.toString());
    const cleared = await w.admin.agent
      .patch(`/api/v1/users/${id}`)
      .set(CSRF)
      .send({ supervisorId: null });
    expect(cleared.body.user.supervisorId).toBeNull();
  });
});

describe('TC-Q05 mixed: hours-only entries, timed entries and a running timer share the 24-hour cap', () => {
  it('counts the running timer, stops it at 24:00 of the day and refuses a new timer', async () => {
    const { w, l, t1 } = await setup();
    const hoursOnly = (hours: number) =>
      w.member.agent.post('/api/v1/time').set(CSRF).send({
        taskId: t1,
        workDate: '2026-10-14',
        hours,
        activityTypeId: l.configuration,
        moduleId: l.financials,
      });
    expect((await hoursOnly(18)).status).toBe(201);
    expect((await start(w.member.agent, { ...task(l, t1), dayLocationId: l.onsite })).status).toBe(
      201,
    );
    at('2026-10-14T06:00:00Z'); // 14:00 PHT: the timer has run 4h, so the day holds 22h
    const over = await hoursOnly(3);
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('DAILY_LIMIT');
    expect(over.body.error.message).toContain('25h 00m');
    expect((await hoursOnly(1)).status).toBe(201); // 23h
    at('2026-10-14T08:30:00Z'); // 16:30 PHT: 6.5h on the timer would make 25.5h
    const stopped = await stop(w.member.agent);
    expect(stopped.status).toBe(200);
    expect(stopped.body.entry).toMatchObject({ minutes: 300, autoStopped: true });
    const d = await day(w.member.agent, '2026-10-14');
    expect(d.body.day.totalMinutes).toBe(24 * 60);
    const again = await start(w.member.agent, { ...task(l, t1) });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('DAILY_LIMIT');
  });
});

describe('FR-ACT-19 (DR-35): deleting your own entries', () => {
  it('deletes a quick activity on an open day, audits it, and refuses others and submitted days', async () => {
    const { w, l } = await setup();
    const q = (timeIn: string, timeOut: string) =>
      manual(w.member.agent, {
        title: 'QA quick activity check',
        activityTypeId: l.internalMeeting,
        date: '2026-10-13',
        timeIn,
        timeOut,
        dayLocationId: l.office,
      });
    const a = (await q('09:00', '09:30')).body.entry.id as string;
    const b = (await q('10:00', '10:30')).body.entry.id as string;
    const del = (who: Agent, id: string) => who.delete(`/api/v1/tracker/entries/${id}`).set(CSRF);
    expect((await del(w.pm.agent, a)).status).toBe(403); // supervisor: view only
    expect((await del(w.pm2.agent, a)).status).toBe(404);
    expect((await del(w.member.agent, a)).status).toBe(204);
    expect(await TimeEntryModel.exists({ _id: a })).toBeNull();
    const log = await ActivityLogModel.findOne({ entityId: a, action: 'time_deleted' }).lean();
    expect(log).toMatchObject({ actorId: w.member.user._id });
    expect(
      (await w.member.agent.post('/api/v1/tracker/days/2026-10-13/submit').set(CSRF).send({}))
        .status,
    ).toBe(200);
    const locked = await del(w.member.agent, b);
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe('DAY_LOCKED');
  });
});
