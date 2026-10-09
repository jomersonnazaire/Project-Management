import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityLogModel,
  HolidayModel,
  LeaveEntitlementModel,
  LeaveModel,
  LeaveTypeModel,
  LookupModel,
  MigrationModel,
  NotificationModel,
  ProjectModel,
  TimeEntryModel,
  TimesheetDayModel,
  UserModel,
} from '../src/models/index.js';
import { buildDar } from '../src/services/dar.js';
import { ensureDefaultLeaveTypes } from '../src/services/leave.js';
import { leaveLabelFor } from '../src/services/leaveHook.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';
import { lookups } from './trackerHelpers.js';

/**
 * M7 Leave (doc 14 §4, §12 Q-46, §16 FR-LV-11; QA 06 TC-S01..S10).
 * "Now" is Wed Oct 14, 2026 10:00 Manila time.
 */
useDatabase();
const app = makeApp({ SESSION_IDLE_MINUTES: '1440' });
const at = (iso: string) => vi.setSystemTime(new Date(iso));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-10-14T02:00:00Z');
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    [
      LeaveModel,
      LeaveEntitlementModel,
      LeaveTypeModel,
      HolidayModel,
      TimeEntryModel,
      TimesheetDayModel,
      NotificationModel,
      ActivityLogModel,
      LookupModel,
      MigrationModel,
    ].map((m) => (m as typeof LeaveModel).deleteMany({})),
  );
});

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

async function setup() {
  const w = await world(app);
  await ensureDefaultLeaveTypes();
  const types = await LeaveTypeModel.find().lean();
  const t = (name: string) => types.find((x) => x.name === name)!._id.toString();
  await UserModel.updateOne({ _id: w.member.user._id }, { supervisorId: w.pm.user._id });
  const member = w.member.user._id.toString();
  const ent = (userId: string, leaveTypeId: string, days: number, year = 2026, carryOver = 0) =>
    w.admin.agent
      .put('/api/v1/leave/entitlements')
      .set(CSRF)
      .send({ userId, leaveTypeId, year, days, carryOver });
  const vacation = t('Vacation');
  const sick = t('Sick');
  await ent(member, vacation, 10);
  await ent(member, sick, 5);
  return { w, member, vacation, sick, emergency: t('Emergency'), unpaid: t('Unpaid'), ent };
}

const record = (a: Agent, body: object) => a.post('/api/v1/leave').set(CSRF).send(body);
const balance = async (a: Agent, typeId: string, year = 2026) =>
  (
    (await a.get(`/api/v1/leave/balances?year=${year}`)).body.items as {
      type: { id: string };
      balance: number | null;
      recorded: number;
      negative: boolean;
    }[]
  ).find((b) => b.type.id === typeId)!;

describe('TC-S01: record Full day, Half day AM, Half day PM', () => {
  it('deducts 1, 0.5, 0.5; shows on leave; the supervisor gets a notice', async () => {
    const s = await setup();
    const { w, vacation } = s;
    const full = await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2026-10-19',
      to: '2026-10-19',
      reason: 'Family trip',
    });
    expect(full.status).toBe(201);
    expect(full.body.item).toMatchObject({ days: 1, status: 'RECORDED', reason: 'Family trip' });
    expect(full.body.notified).toBe(1);
    expect((await balance(w.member.agent, vacation)).balance).toBe(9);
    await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'AM',
      from: '2026-10-20',
      to: '2026-10-20',
    });
    expect((await balance(w.member.agent, vacation)).balance).toBe(8.5);
    await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'PM',
      from: '2026-10-21',
      to: '2026-10-21',
    });
    expect((await balance(w.member.agent, vacation)).balance).toBe(8);

    const notes = await NotificationModel.find({
      userId: w.pm.user._id,
      type: 'LEAVE_RECORDED',
    }).lean();
    expect(notes).toHaveLength(3);
    expect(notes[0]!.message).toBe(
      `${w.member.user.name} recorded Vacation leave for Oct 19 (Full day).`,
    );
    expect(await ActivityLogModel.countDocuments({ action: 'leave_recorded' })).toBe(3);

    // Shows as on leave in the tracker and the report (FR-LV-06).
    const label = (d: string) => leaveLabelFor(w.member.user._id, new Date(`${d}T00:00:00Z`));
    expect(await label('2026-10-19')).toBe('On leave');
    expect(await label('2026-10-20')).toBe('Half day leave (AM)');
    expect(await label('2026-10-21')).toBe('Half day leave (PM)');
    at('2026-10-21T10:00:00Z');
    const dar = await buildDar(w.member.user._id, '2026-10-19', '2026-10-21');
    expect(dar.rows.map((r) => r.remarks)).toEqual([
      'On leave',
      'Half day leave (AM)',
      'Half day leave (PM)',
    ]);
  });

  it('half days only on half-day types and a single date', async () => {
    const s = await setup();
    const { w, emergency, vacation } = s;
    await s.ent(s.member, emergency, 3);
    const bad = await record(w.member.agent, {
      leaveTypeId: emergency,
      dayPart: 'AM',
      from: '2026-10-19',
      to: '2026-10-19',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].message).toBe(
      'Emergency is taken in full days. Choose Full day.',
    );
    const range = await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'PM',
      from: '2026-10-19',
      to: '2026-10-20',
    });
    expect(range.body.error.details[0].message).toBe(
      'A half day is on a single date. Set "To" to the same date.',
    );
    const back = await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2026-10-20',
      to: '2026-10-19',
    });
    expect(back.body.error.details[0].message).toBe(
      'Pick a "To" date on or after the "From" date.',
    );
    // No medical fields: unknown keys are refused (FR-LV-07).
    const extra = await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2026-10-19',
      to: '2026-10-19',
      diagnosis: 'x',
    });
    expect(extra.status).toBe(400);
  });
});

describe('TC-S02: weekends and holidays are not deducted (EC-78)', () => {
  it('counts only working days', async () => {
    const s = await setup();
    await HolidayModel.create({
      date: new Date('2026-10-30T00:00:00Z'),
      year: 2026,
      name: 'Test Regular',
      type: 'REGULAR',
    });
    // Thu Oct 29 – Tue Nov 3: Fri Oct 30 holiday, Oct 31 – Nov 1 weekend → Oct 29, Nov 2, Nov 3.
    const res = await record(s.w.member.agent, {
      leaveTypeId: s.vacation,
      dayPart: 'FULL',
      from: '2026-10-29',
      to: '2026-11-03',
    });
    expect(res.body.item.days).toBe(3);
    const weekend = await record(s.w.member.agent, {
      leaveTypeId: s.vacation,
      dayPart: 'FULL',
      from: '2026-10-24',
      to: '2026-10-25',
    });
    expect(weekend.status).toBe(422);
    expect(weekend.body.error.message).toBe('This range has no working days. Pick working days.');
  });
});

describe('TC-S03: over balance', () => {
  it('refuses a paid type with the plural-correct message; unpaid is allowed', async () => {
    const s = await setup();
    const { w, sick, unpaid, emergency } = s;
    const over = await record(w.member.agent, {
      leaveTypeId: sick,
      dayPart: 'FULL',
      from: '2026-10-19',
      to: '2026-10-26',
    });
    expect(over.status).toBe(422);
    expect(over.body.error.message).toBe(
      'You have 5 days of Sick left, and this needs 6 days. Choose fewer days or another leave type.',
    );
    await record(w.member.agent, {
      leaveTypeId: sick,
      dayPart: 'FULL',
      from: '2026-10-19',
      to: '2026-10-22',
    });
    const one = await record(w.member.agent, {
      leaveTypeId: sick,
      dayPart: 'FULL',
      from: '2026-10-26',
      to: '2026-10-27',
    });
    expect(one.body.error.message).toBe(
      'You have 1 day of Sick left, and this needs 2 days. Choose fewer days or another leave type.',
    );
    const none = await record(w.member.agent, {
      leaveTypeId: emergency,
      dayPart: 'FULL',
      from: '2026-10-26',
      to: '2026-10-26',
    });
    expect(none.body.error.message).toBe(
      'You have 0 days of Emergency left, and this needs 1 day. Choose fewer days or another leave type.',
    );
    const u = await record(w.member.agent, {
      leaveTypeId: unpaid,
      dayPart: 'FULL',
      from: '2026-11-02',
      to: '2026-11-20',
    });
    expect(u.status).toBe(201);
    expect((await balance(w.member.agent, unpaid)).balance).toBeNull();
  });
});

describe('TC-S04: overlaps on one day (FR-LV-11)', () => {
  it('AM + PM of one type is a full day; different types 0.5 each; repeats refused', async () => {
    const s = await setup();
    const { w, vacation, sick } = s;
    const one = (dayPart: string, leaveTypeId: string, date: string) =>
      record(w.member.agent, { leaveTypeId, dayPart, from: date, to: date });
    expect((await one('AM', vacation, '2026-10-19')).status).toBe(201);
    expect((await one('PM', vacation, '2026-10-19')).status).toBe(201);
    expect((await balance(w.member.agent, vacation)).recorded).toBe(1);
    expect(await leaveLabelFor(w.member.user._id, new Date('2026-10-19T00:00:00Z'))).toBe(
      'On leave',
    );

    expect((await one('AM', vacation, '2026-10-20')).status).toBe(201);
    expect((await one('PM', sick, '2026-10-20')).status).toBe(201);
    expect((await balance(w.member.agent, vacation)).recorded).toBe(1.5);
    expect((await balance(w.member.agent, sick)).recorded).toBe(0.5);

    const am2 = await one('AM', sick, '2026-10-20');
    expect(am2.status).toBe(422);
    expect(am2.body.error.message).toBe('You already have leave recorded for this morning.');
    const pm2 = await one('PM', vacation, '2026-10-20');
    expect(pm2.body.error.message).toBe('You already have leave recorded for this afternoon.');
    const fullOnHalf = await one('FULL', vacation, '2026-10-20');
    expect(fullOnHalf.body.error.message).toBe('You already have leave filed for Oct 20.');

    await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2026-10-26',
      to: '2026-10-28',
    });
    const halfOnFull = await one('PM', sick, '2026-10-27');
    expect(halfOnFull.body.error.message).toBe('You already have leave filed for Oct 26 – Oct 28.');
    const range = await record(w.member.agent, {
      leaveTypeId: sick,
      dayPart: 'FULL',
      from: '2026-10-28',
      to: '2026-10-29',
    });
    expect(range.body.error.code).toBe('LEAVE_OVERLAP');
    expect(range.body.error.message).toBe('You already have leave filed for Oct 26 – Oct 28.');
  });
});

describe('TC-S05: cancel', () => {
  it('own future leave restores the balance and notifies; past leave is Admin only', async () => {
    const s = await setup();
    const { w, vacation } = s;
    const future = (
      await record(w.member.agent, {
        leaveTypeId: vacation,
        dayPart: 'FULL',
        from: '2026-10-19',
        to: '2026-10-20',
      })
    ).body.item;
    const today = (
      await record(w.member.agent, {
        leaveTypeId: vacation,
        dayPart: 'FULL',
        from: '2026-10-14',
        to: '2026-10-14',
      })
    ).body.item;
    expect((await balance(w.member.agent, vacation)).balance).toBe(7);
    expect(future.can.cancel).toBe(true);
    expect(today.can.cancel).toBe(false);

    const c = await w.member.agent.post(`/api/v1/leave/${future.id}/cancel`).set(CSRF).send({});
    expect(c.status).toBe(200);
    expect(c.body.item.status).toBe('CANCELLED');
    expect((await balance(w.member.agent, vacation)).balance).toBe(9);
    expect(
      await NotificationModel.countDocuments({ userId: w.pm.user._id, type: 'LEAVE_CANCELLED' }),
    ).toBe(1);
    expect(await ActivityLogModel.countDocuments({ action: 'leave_cancelled' })).toBe(1);

    const past = await w.member.agent.post(`/api/v1/leave/${today.id}/cancel`).set(CSRF).send({});
    expect(past.status).toBe(422);
    expect(past.body.error.code).toBe('PAST_LEAVE');
    expect(
      (await w.pm.agent.post(`/api/v1/leave/${today.id}/cancel`).set(CSRF).send({})).status,
    ).toBe(403);
    const admin = await w.admin.agent.post(`/api/v1/leave/${today.id}/cancel`).set(CSRF).send({});
    expect(admin.status).toBe(200);
    expect(
      await NotificationModel.countDocuments({
        userId: w.member.user._id,
        type: 'LEAVE_CANCELLED',
      }),
    ).toBe(1);
    expect((await balance(w.member.agent, vacation)).balance).toBe(10);
  });
});

describe('TC-S06: privacy', () => {
  it('the reason is for the user, supervisor and Admins; others get 404', async () => {
    const s = await setup();
    const { w, vacation } = s;
    const item = (
      await record(w.member.agent, {
        leaveTypeId: vacation,
        dayPart: 'FULL',
        from: '2026-10-19',
        to: '2026-10-19',
        reason: 'Personal appointment',
      })
    ).body.item;
    for (const who of [w.member, w.pm, w.admin]) {
      const r = await who.agent.get(`/api/v1/leave/${item.id}`);
      expect(r.status).toBe(200);
      expect(r.body.item.reason).toBe('Personal appointment');
    }
    for (const who of [w.pm2, w.outsider, w.viewer]) {
      expect((await who.agent.get(`/api/v1/leave/${item.id}`)).status).toBe(404);
      expect((await who.agent.get(`/api/v1/leave?userId=${s.member}`)).status).toBe(404);
      expect((await who.agent.get(`/api/v1/leave/balances?userId=${s.member}`)).status).toBe(404);
      expect(
        (await who.agent.post(`/api/v1/leave/${item.id}/cancel`).set(CSRF).send({})).status,
      ).toBe(404);
    }
    const team = await w.pm.agent.get('/api/v1/leave/team');
    expect(team.body.items.map((i: { id: string }) => i.id)).toEqual([item.id]);
    expect(team.body.items[0].reason).toBe('Personal appointment');
    expect((await w.pm2.agent.get('/api/v1/leave/team')).body.items).toEqual([]);
    const stored = await LeaveModel.findById(item.id).lean();
    expect(Object.keys(stored!)).not.toEqual(expect.arrayContaining(['diagnosis', 'medical']));
  });
});

describe('TC-S07: entitlement below what is taken (EC-79)', () => {
  it('is allowed with a warning; the balance is negative, flagged and audited', async () => {
    const s = await setup();
    const { w, vacation, member } = s;
    await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2026-10-19',
      to: '2026-10-26',
    });
    const res = await s.ent(member, vacation, 4);
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ taken: 6, balance: -2, negative: true });
    expect(res.body.warning).toBe(
      `${w.member.user.name} has already taken 6 days of Vacation. Setting 4 makes the balance -2. The balance is flagged (EC-79).`,
    );
    expect((await balance(w.member.agent, vacation)).negative).toBe(true);
    expect(
      await ActivityLogModel.countDocuments({
        action: 'leave_entitlement_changed',
        entityId: w.member.user._id,
      }),
    ).toBeGreaterThanOrEqual(2);
    const list = await w.admin.agent.get(
      `/api/v1/leave/entitlements?year=2026&leaveTypeId=${vacation}`,
    );
    expect(
      list.body.items.find((r: { user: { id: string } }) => r.user.id === member),
    ).toMatchObject({ negative: true });
    // Carry-over limit (Vacation: 5) and Admin-only.
    const carry = await s.ent(member, vacation, 10, 2026, 6);
    expect(carry.body.error.details[0].message).toBe(
      'Carry-over for Vacation can be up to 5 days.',
    );
    expect(
      (
        await w.member.agent
          .put('/api/v1/leave/entitlements')
          .set(CSRF)
          .send({ userId: member, leaveTypeId: vacation, year: 2026, days: 30 })
      ).status,
    ).toBe(403);
  });
});

describe('TC-S08: no supervisor', () => {
  it('notices go to all Admins; self and cyclic supervisors are refused', async () => {
    const s = await setup();
    const { w, vacation } = s;
    await UserModel.updateOne({ _id: w.member.user._id }, { supervisorId: null });
    const res = await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2026-10-19',
      to: '2026-10-19',
    });
    const admins = await UserModel.countDocuments({ systemRole: 'ADMIN', active: true });
    expect(res.body.notified).toBe(admins);
    expect(
      await NotificationModel.countDocuments({ userId: w.admin.user._id, type: 'LEAVE_RECORDED' }),
    ).toBe(1);
    const bal = await w.member.agent.get('/api/v1/leave/balances');
    expect(bal.body.supervisor).toBeNull();
    // Deactivated supervisor counts as none (EC-77).
    await UserModel.updateOne({ _id: w.member.user._id }, { supervisorId: w.pm2.user._id });
    await UserModel.updateOne({ _id: w.pm2.user._id }, { active: false });
    await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2026-10-20',
      to: '2026-10-20',
    });
    expect(
      await NotificationModel.countDocuments({ userId: w.admin.user._id, type: 'LEAVE_RECORDED' }),
    ).toBe(2);
    await UserModel.updateOne({ _id: w.pm2.user._id }, { active: true });

    const url = (id: unknown) => `/api/v1/users/${String(id)}`;
    const self = await w.admin.agent
      .patch(url(w.member.user._id))
      .set(CSRF)
      .send({ supervisorId: w.member.user._id.toString() });
    expect(self.status).toBe(400);
    await w.admin.agent
      .patch(url(w.member.user._id))
      .set(CSRF)
      .send({ supervisorId: w.pm.user._id.toString() });
    const cycle = await w.admin.agent
      .patch(url(w.pm.user._id))
      .set(CSRF)
      .send({ supervisorId: w.member.user._id.toString() });
    expect(cycle.status).toBe(400);
  });
});

describe('TC-S09: timer on a leave day (FR-LV-06)', () => {
  it('refuses on a full day; warns on a half day and allows after confirming', async () => {
    const s = await setup();
    const { w, vacation } = s;
    const l = await lookups();
    await ProjectModel.updateOne({ _id: w.project.id }, { status: 'ACTIVE' });
    const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
      id: string;
    }[];
    const start = (extra = {}) =>
      w.member.agent
        .post('/api/v1/tracker/start')
        .set(CSRF)
        .send({
          taskId: tasks[0]!.id,
          activityTypeId: l.configuration,
          moduleId: l.financials,
          dayLocationId: l.wfh,
          ...extra,
        });
    // Today (Oct 14) is a half day AM.
    await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'AM',
      from: '2026-10-14',
      to: '2026-10-14',
    });
    expect((await w.member.agent.get('/api/v1/tracker/day?date=2026-10-14')).body.day.leave).toBe(
      'Half day leave (AM)',
    );
    const warn = await start();
    expect(warn.status).toBe(409);
    expect(warn.body.error).toMatchObject({
      code: 'HALF_DAY_LEAVE',
      message: 'You have half-day leave (AM) on Oct 14. Log time anyway?',
    });
    expect((await start({ confirmLeave: true })).status).toBe(201);
    await w.member.agent.post('/api/v1/tracker/stop').set(CSRF).send({});

    // Full day on Oct 13 (past): manual entries are refused, even confirmed.
    await LeaveModel.create({
      userId: w.member.user._id,
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: new Date('2026-10-13T00:00:00Z'),
      to: new Date('2026-10-13T00:00:00Z'),
      dates: [new Date('2026-10-13T00:00:00Z')],
      days: 1,
      byYear: [{ year: 2026, days: 1 }],
      recordedBy: w.member.user._id,
    });
    const manual = await w.member.agent.post('/api/v1/tracker/entries').set(CSRF).send({
      taskId: tasks[0]!.id,
      activityTypeId: l.configuration,
      moduleId: l.financials,
      date: '2026-10-13',
      timeIn: '08:00',
      timeOut: '09:00',
      dayLocationId: l.wfh,
      confirmLeave: true,
    });
    expect(manual.status).toBe(422);
    expect(manual.body.error).toMatchObject({
      code: 'ON_LEAVE',
      message: "You're on leave on Oct 13. Cancel the leave first to log time.",
    });
  });
});

describe('TC-S10: year boundary (FR-LV-02)', () => {
  it('30 Dec 2026 to 4 Jan 2027 deducts from each year', async () => {
    const s = await setup();
    const { w, vacation, member } = s;
    await s.ent(member, vacation, 10, 2027);
    // Dec 30, 31 (Wed, Thu) in 2026; Jan 1 (Fri), Jan 4 (Mon) in 2027; Jan 2–3 weekend.
    const res = await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2026-12-30',
      to: '2027-01-04',
    });
    expect(res.status).toBe(201);
    expect(res.body.item.byYear).toEqual([
      { year: 2026, days: 2 },
      { year: 2027, days: 2 },
    ]);
    expect((await balance(w.member.agent, vacation, 2026)).balance).toBe(8);
    expect((await balance(w.member.agent, vacation, 2027)).balance).toBe(8);
    // Each year is checked on its own: 2027 has 8 left.
    const over = await record(w.member.agent, {
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2027-01-05',
      to: '2027-01-18',
    });
    expect(over.body.error.message).toBe(
      'You have 8 days of Vacation left, and this needs 10 days. Choose fewer days or another leave type.',
    );
    const list2027 = await w.member.agent.get('/api/v1/leave?year=2027');
    expect(list2027.body.items).toHaveLength(1);
  });
});

describe('FR-LV-01: leave types (Admin)', () => {
  it('seeds the starting list; Admins add and deactivate, no delete; duplicates refused', async () => {
    const s = await setup();
    const { w } = s;
    const list = await w.member.agent.get('/api/v1/leave/types');
    expect(list.body.items.map((t: { name: string }) => t.name)).toContain(
      'Service Incentive Leave',
    );
    expect(
      (
        await w.member.agent
          .post('/api/v1/leave/types')
          .set(CSRF)
          .send({ name: 'X', paid: true, unit: 'DAY' })
      ).status,
    ).toBe(403);
    const add = await w.admin.agent
      .post('/api/v1/leave/types')
      .set(CSRF)
      .send({ name: 'Birthday', paid: true, unit: 'DAY' });
    expect(add.status).toBe(201);
    const dup = await w.admin.agent
      .post('/api/v1/leave/types')
      .set(CSRF)
      .send({ name: 'vacation', paid: true, unit: 'DAY' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('"Vacation" already exists.');
    const off = await w.admin.agent
      .patch(`/api/v1/leave/types/${add.body.item.id}`)
      .set(CSRF)
      .send({ active: false });
    expect(off.body.item.active).toBe(false);
    expect([404, 405]).toContain(
      (await w.admin.agent.delete(`/api/v1/leave/types/${add.body.item.id}`).set(CSRF)).status,
    );
    expect(
      (await w.member.agent.get('/api/v1/leave/types')).body.items.map(
        (t: { name: string }) => t.name,
      ),
    ).not.toContain('Birthday');
  });
});
