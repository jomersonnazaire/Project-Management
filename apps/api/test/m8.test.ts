import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityLogModel,
  LookupModel,
  MigrationModel,
  NotificationModel,
  TimeEntryModel,
  TimesheetDayModel,
  UserModel,
} from '../src/models/index.js';
import { migrateModuleText } from '../src/services/moduleText.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';
import { lookups } from './trackerHelpers.js';

/**
 * Doc 14 v0.9.7 FR-ACT-20..23 (mockup v0.8.9): Module is optional free text, the old Modules
 * list is migrated and left untouched, and Time out is idempotent. "Now" is Wed Oct 14, 2026
 * 10:00 Manila time.
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
      TimeEntryModel,
      TimesheetDayModel,
      NotificationModel,
      ActivityLogModel,
      LookupModel,
      MigrationModel,
    ].map((m) => (m as typeof TimeEntryModel).deleteMany({})),
  );
});

async function setup() {
  const w = await world(app);
  const l = await lookups();
  const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
    id: string;
  }[];
  await UserModel.updateOne({ _id: w.member.user._id }, { supervisorId: w.pm.user._id });
  return { w, l, t1: tasks[0]!.id };
}
type Agent = Awaited<ReturnType<typeof world>>['member']['agent'];
const manual = (a: Agent, body: object) => a.post('/api/v1/tracker/entries').set(CSRF).send(body);

describe('FR-ACT-20: Module is optional free text', () => {
  it('trims, saves blank as blank, caps at 100 and keeps HTML as text', async () => {
    const { w, l, t1 } = await setup();
    const base = {
      taskId: t1,
      activityTypeId: l.configuration,
      date: '2026-10-13',
      dayLocationId: l.onsite,
    };
    // Optional on project tasks too.
    const none = await manual(w.member.agent, { ...base, timeIn: '08:00', timeOut: '09:00' });
    expect(none.status).toBe(201);
    expect(none.body.entry.module).toBeNull();
    const spaces = await manual(w.member.agent, {
      ...base,
      timeIn: '09:00',
      timeOut: '10:00',
      module: '    ',
    });
    expect(spaces.body.entry.module).toBeNull();
    const trimmed = await manual(w.member.agent, {
      ...base,
      timeIn: '10:00',
      timeOut: '11:00',
      module: `  ${'m'.repeat(100)}  `,
    });
    expect(trimmed.status).toBe(201);
    expect(trimmed.body.entry.module).toBe('m'.repeat(100));
    const long = await manual(w.member.agent, {
      ...base,
      timeIn: '11:00',
      timeOut: '12:00',
      module: 'm'.repeat(101),
    });
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(long.body.error)).toContain('Keep the module under 100 characters.');
    const html = '<b>ADFS</b> <img src=x onerror=alert(1)>';
    const h = await manual(w.member.agent, {
      ...base,
      timeIn: '12:00',
      timeOut: '13:00',
      module: html,
    });
    expect(h.body.entry.module).toBe(html);
    // Edit: change, then clear.
    const id = h.body.entry.id as string;
    const edit = (body: object) =>
      w.member.agent.patch(`/api/v1/tracker/entries/${id}`).set(CSRF).send(body);
    expect((await edit({ module: ' Banking ' })).body.entry.module).toBe('Banking');
    expect((await edit({ module: '' })).body.entry.module).toBeNull();
    expect((await edit({ module: 'x'.repeat(101) })).status).toBe(400);
    // Log time (hours only) takes the same text.
    const hours = await w.member.agent.post('/api/v1/time').set(CSRF).send({
      taskId: t1,
      workDate: '2026-10-13',
      hours: 1,
      activityTypeId: l.configuration,
      module: '  Sales ',
    });
    expect(hours.status).toBe(201);
    expect(hours.body.entry.module).toBe('Sales');
    expect(
      (
        await w.member.agent
          .post('/api/v1/time')
          .set(CSRF)
          .send({
            taskId: t1,
            workDate: '2026-10-13',
            hours: 1,
            activityTypeId: l.configuration,
            module: 's'.repeat(101),
          })
      ).status,
    ).toBe(400);
  });

  it('a blank module shows "–" in the PDF and Excel; the text shows as text', async () => {
    const { w, l, t1 } = await setup();
    const base = {
      taskId: t1,
      activityTypeId: l.configuration,
      date: '2026-10-13',
      dayLocationId: l.onsite,
    };
    await manual(w.member.agent, { ...base, timeIn: '08:00', timeOut: '09:00' });
    await manual(w.member.agent, {
      ...base,
      timeIn: '09:00',
      timeOut: '10:00',
      module: '<i>ADFS Remote</i>',
    });
    const preview = (await w.member.agent.get('/api/v1/dar?from=2026-10-13&to=2026-10-13')).body
      .report;
    expect(preview.rows.map((r: { module: string }) => r.module)).toEqual([
      '',
      '<i>ADFS Remote</i>',
    ]);
    const x = await w.member.agent
      .get('/api/v1/dar/export/xlsx?from=2026-10-13&to=2026-10-13')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as never);
    const ws = wb.getWorksheet('Report')!;
    expect(ws.getCell('J5').value).toBe('Module');
    expect(ws.getCell('J6').value).toBe('–');
    expect(ws.getCell('J7').value).toBe('<i>ADFS Remote</i>');
    const pdf = await w.member.agent
      .get('/api/v1/dar/export/pdf?from=2026-10-13&to=2026-10-13')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
  });
});

describe('FR-ACT-21/22: migration; the Modules list stays untouched', () => {
  it('copies each old module name into the text, once, and leaves the list alone', async () => {
    const { w, l, t1 } = await setup();
    const fin = await LookupModel.create({
      kind: 'MODULE',
      name: 'Financials',
      nameKey: 'financials',
      order: 0,
    });
    const inv = await LookupModel.create({
      kind: 'MODULE',
      name: 'Inventory',
      nameKey: 'inventory',
      order: 1,
      active: false,
    });
    const before = await LookupModel.find({ kind: 'MODULE' }).sort({ name: 1 }).lean();
    const made = await Promise.all(
      ['08:00', '09:00', '10:00'].map((timeIn, i) =>
        manual(w.member.agent, {
          taskId: t1,
          activityTypeId: l.configuration,
          date: '2026-10-13',
          dayLocationId: l.onsite,
          timeIn,
          timeOut: `${String(9 + i).padStart(2, '0')}:00`,
        }),
      ),
    );
    const [a, b, c] = made.map((r) => new Types.ObjectId(r.body.entry.id as string));
    // Legacy rows: a and b point at the old list; c already has text that must be kept.
    await TimeEntryModel.collection.updateOne(
      { _id: a },
      { $set: { moduleId: fin._id }, $unset: { module: '' } },
    );
    await TimeEntryModel.collection.updateOne(
      { _id: b },
      { $set: { moduleId: inv._id, module: null } },
    );
    await TimeEntryModel.collection.updateOne(
      { _id: c },
      { $set: { moduleId: fin._id, module: 'Kept' } },
    );

    expect(await migrateModuleText()).toBe(2);
    const after = await TimeEntryModel.find({ _id: { $in: [a, b, c] } })
      .sort({ startAt: 1 })
      .lean();
    expect(after.map((e) => e.module)).toEqual(['Financials', 'Inventory', 'Kept']);
    expect(after.map((e) => e.moduleId?.toString())).toEqual([fin.id, inv.id, fin.id]);
    // Idempotent: a second run changes nothing.
    expect(await migrateModuleText()).toBe(0);
    expect(await MigrationModel.findById('module-free-text').lean()).toMatchObject({
      status: 'DONE',
    });
    // The list itself is exactly as it was.
    expect(await LookupModel.find({ kind: 'MODULE' }).sort({ name: 1 }).lean()).toEqual(before);
    // The day timesheet and the DAR show the migrated text.
    const day = (await w.member.agent.get('/api/v1/tracker/day?date=2026-10-13')).body.day;
    expect(day.entries.map((e: { module: string | null }) => e.module)).toEqual([
      'Financials',
      'Inventory',
      'Kept',
    ]);
    const dar = (await w.member.agent.get('/api/v1/dar?from=2026-10-13&to=2026-10-13')).body.report;
    expect(dar.rows.map((r: { module: string }) => r.module)).toEqual([
      'Financials',
      'Inventory',
      'Kept',
    ]);
  });

  it('DEF-010: a cleared Module stays cleared after the migration re-runs (restart)', async () => {
    const { w, l, t1 } = await setup();
    const fin = await LookupModel.create({
      kind: 'MODULE',
      name: 'Financials',
      nameKey: 'financials',
      order: 0,
    });
    const timed = await manual(w.member.agent, {
      taskId: t1,
      activityTypeId: l.configuration,
      date: '2026-10-13',
      dayLocationId: l.onsite,
      timeIn: '08:00',
      timeOut: '09:00',
    });
    const hoursOnly = await w.member.agent
      .post('/api/v1/time')
      .set(CSRF)
      .send({ taskId: t1, workDate: '2026-10-13', hours: 1, activityTypeId: l.configuration });
    expect(hoursOnly.status).toBe(201);
    const ids = [timed.body.entry.id as string, hoursOnly.body.entry.id as string].map(
      (id) => new Types.ObjectId(id),
    );
    // Legacy rows pointing at the old list, no text yet.
    await TimeEntryModel.collection.updateMany(
      { _id: { $in: ids } },
      { $set: { moduleId: fin._id, module: null } },
    );
    expect(await migrateModuleText()).toBe(2);
    // The user clears the Module on both (Day timesheet and Time logging).
    expect(
      (
        await w.member.agent
          .patch(`/api/v1/tracker/entries/${ids[0]!.toString()}`)
          .set(CSRF)
          .send({ module: '' })
      ).status,
    ).toBe(200);
    expect(
      (
        await w.member.agent
          .patch(`/api/v1/time/${ids[1]!.toString()}`)
          .set(CSRF)
          .send({ module: '   ' })
      ).status,
    ).toBe(200);
    const cleared = await TimeEntryModel.find({ _id: { $in: ids } }).lean();
    expect(cleared.map((e) => [e.module, e.moduleId])).toEqual([
      [null, null],
      [null, null],
    ]);
    // Restart: the marker makes the migration skip.
    expect(await migrateModuleText()).toBe(0);
    // Even a forced re-run (marker gone) finds nothing to restore.
    await MigrationModel.deleteOne({ _id: 'module-free-text' });
    expect(await migrateModuleText()).toBe(0);
    const after = await TimeEntryModel.find({ _id: { $in: ids } }).lean();
    expect(after.map((e) => e.module)).toEqual([null, null]);
  });

  it('DEF-010: the 100-character Module limit counts user-visible characters', async () => {
    const { w, l, t1 } = await setup();
    const family = '👨‍👩‍👧'; // one character on screen, 8 UTF-16 units
    const body = (module: string, timeIn: string, timeOut: string) => ({
      taskId: t1,
      activityTypeId: l.configuration,
      date: '2026-10-13',
      dayLocationId: l.onsite,
      timeIn,
      timeOut,
      module,
    });
    const ok = await manual(w.member.agent, body(family.repeat(100), '08:00', '09:00'));
    expect(ok.status).toBe(201);
    expect(ok.body.entry.module).toBe(family.repeat(100));
    const long = await manual(w.member.agent, body(family.repeat(101), '09:00', '10:00'));
    expect(long.status).toBe(400);
    expect(long.body.error.details).toEqual([
      { path: 'module', message: 'Keep the module under 100 characters.' },
    ]);
  });

  it("no Modules screen or list in the API; old values can't be edited or deleted", async () => {
    const { w } = await setup();
    const mod = await LookupModel.create({
      kind: 'MODULE',
      name: 'Banking',
      nameKey: 'banking',
      order: 0,
    });
    const forms = (await w.member.agent.get('/api/v1/lookups')).body;
    expect(Object.keys(forms).sort()).toEqual(['activityTypes', 'locations']);
    expect((await w.admin.agent.get('/api/v1/lookups/modules/all')).status).toBe(404);
    expect(
      (await w.admin.agent.post('/api/v1/lookups/modules').set(CSRF).send({ name: 'X' })).status,
    ).toBe(404);
    expect(
      (await w.admin.agent.patch(`/api/v1/lookups/${mod.id}`).set(CSRF).send({ name: 'Y' })).status,
    ).toBe(404);
    expect((await w.admin.agent.delete(`/api/v1/lookups/${mod.id}`).set(CSRF)).status).toBe(404);
    expect(await LookupModel.findById(mod._id).lean()).toMatchObject({
      name: 'Banking',
      active: true,
    });
  });
});

describe('FR-ACT-23: Time out is idempotent', () => {
  it('two Time outs on the same entry stop it once; the second returns it unchanged', async () => {
    const { w, l, t1 } = await setup();
    const started = await w.member.agent
      .post('/api/v1/tracker/start')
      .set(CSRF)
      .send({ taskId: t1, activityTypeId: l.configuration, dayLocationId: l.onsite });
    const id = started.body.entry.id as string;
    at('2026-10-14T02:47:00Z');
    const stop = () => w.member.agent.post('/api/v1/tracker/stop').set(CSRF).send({ entryId: id });
    // Day timesheet and top bar at the same moment.
    const [one, two] = await Promise.all([stop(), stop()]);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    for (const r of [one, two])
      expect(r.body.entry).toMatchObject({
        id,
        running: false,
        endAt: '2026-10-14T02:47:00.000Z',
        minutes: 47,
      });
    // A later click changes nothing.
    at('2026-10-14T03:30:00Z');
    const late = await stop();
    expect(late.status).toBe(200);
    expect(late.body.entry).toMatchObject({ endAt: '2026-10-14T02:47:00.000Z', minutes: 47 });
    expect(await ActivityLogModel.countDocuments({ action: 'timer_stopped' })).toBe(1);
    const day = (await w.member.agent.get('/api/v1/tracker/day?date=2026-10-14')).body.day;
    expect(day.entries).toHaveLength(1);
    expect(day.totalMinutes).toBe(47);
    // Someone else's entry isn't theirs to stop; no id and no timer is still NO_TIMER.
    expect(
      (await w.pm.agent.post('/api/v1/tracker/stop').set(CSRF).send({ entryId: id })).status,
    ).toBe(404);
    const none = await w.member.agent.post('/api/v1/tracker/stop').set(CSRF).send({});
    expect(none.body.error.code).toBe('NO_TIMER');
  });
});

describe('FR-ACT-24: one lock rule on every route', () => {
  it('a locked week refuses everyone with 422 DAY_LOCKED on /time and /tracker until reopened', async () => {
    const { w, l, t1 } = await setup();
    // Friday Oct 9 (last week) while it was still open.
    at('2026-10-09T08:00:00Z');
    const logTime = (a: Agent, date: string) =>
      a.post('/api/v1/time').set(CSRF).send({
        taskId: t1,
        workDate: date,
        hours: 1,
        activityTypeId: l.configuration,
      });
    const pmHours = (await logTime(w.pm.agent, '2026-10-09')).body.entry.id as string;
    const pmTimed = (
      await manual(w.pm.agent, {
        taskId: t1,
        activityTypeId: l.configuration,
        date: '2026-10-09',
        dayLocationId: l.onsite,
        timeIn: '08:00',
        timeOut: '09:00',
      })
    ).body.entry.id as string;
    // Wed Oct 14: last week is past the Monday 12:00 lock.
    at('2026-10-14T02:00:00Z');
    const locked = (res: { status: number; body: { error?: { code?: string } } }) => {
      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe('DAY_LOCKED');
    };
    for (const a of [w.member.agent, w.pm.agent]) locked(await logTime(a, '2026-10-09'));
    // The bug: a PM could change or delete their own locked entry through /time.
    locked(await w.pm.agent.patch(`/api/v1/time/${pmHours}`).set(CSRF).send({ hours: 2 }));
    locked(await w.pm.agent.delete(`/api/v1/time/${pmHours}`).set(CSRF));
    locked(
      await w.pm.agent
        .patch(`/api/v1/tracker/entries/${pmTimed}`)
        .set(CSRF)
        .send({ timeOut: '09:30' }),
    );
    locked(await w.pm.agent.delete(`/api/v1/tracker/entries/${pmTimed}`).set(CSRF));
    locked(
      await manual(w.pm.agent, {
        title: 'Late note',
        activityTypeId: l.internalMeeting,
        date: '2026-10-09',
        timeIn: '10:00',
        timeOut: '10:30',
      }),
    );
    expect(await TimeEntryModel.countDocuments({ userId: w.pm.user._id })).toBe(2);
    // Time logging marks the entry locked (the UI shows the lock instead of Delete).
    const weekView = (await w.pm.agent.get('/api/v1/time?week=2026-10-05')).body;
    expect(weekView.items.find((e: { id: string }) => e.id === pmHours).locked).toBe(true);
    // An Admin reopens the day; then the PM can fix it.
    const reopen = await w.admin.agent
      .post('/api/v1/tracker/days/2026-10-09/reopen')
      .set(CSRF)
      .send({ userId: w.pm.user._id.toString(), reason: 'Wrong hours' });
    expect(reopen.status).toBe(200);
    expect(
      (await w.pm.agent.patch(`/api/v1/time/${pmHours}`).set(CSRF).send({ hours: 2 })).status,
    ).toBe(200);
    const after = (await w.pm.agent.get('/api/v1/time?week=2026-10-05')).body;
    expect(after.items.find((e: { id: string }) => e.id === pmHours).locked).toBe(false);
  });

  it('a submitted day is locked on /time too, for its owner whatever the role', async () => {
    const { w, l, t1 } = await setup();
    await manual(w.pm.agent, {
      taskId: t1,
      activityTypeId: l.configuration,
      date: '2026-10-13',
      dayLocationId: l.onsite,
      timeIn: '08:00',
      timeOut: '09:00',
    });
    expect(
      (await w.pm.agent.post('/api/v1/tracker/days/2026-10-13/submit').set(CSRF).send({})).status,
    ).toBe(200);
    const res = await w.pm.agent.post('/api/v1/time').set(CSRF).send({
      taskId: t1,
      workDate: '2026-10-13',
      hours: 1,
      activityTypeId: l.configuration,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DAY_LOCKED');
  });
});

describe('FR-ACT-25: user-targeted requests outside scope are 404', () => {
  it('reopen: 404 outside scope (existing or not), 403 only for someone the caller can see', async () => {
    const { w } = await setup();
    const reopen = (a: Agent, userId: string) =>
      a.post('/api/v1/tracker/days/2026-10-09/reopen').set(CSRF).send({ userId, reason: 'Please' });
    const ghost = new Types.ObjectId().toString();
    // Member: other people (real or not) are not found; their own day is visible but not theirs to reopen.
    expect((await reopen(w.member.agent, w.pm2.user._id.toString())).status).toBe(404);
    expect((await reopen(w.member.agent, w.outsider.user._id.toString())).status).toBe(404);
    expect((await reopen(w.member.agent, ghost)).status).toBe(404);
    const own = await reopen(w.member.agent, w.member.user._id.toString());
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('NOT_SUPERVISOR');
    // PM (the member's supervisor): outsiders and ghosts look the same.
    const a = await reopen(w.pm.agent, w.outsider.user._id.toString());
    const b = await reopen(w.pm.agent, ghost);
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(a.body.error).toEqual(b.body.error);
    // The supervisor is in scope for their report.
    expect((await reopen(w.pm.agent, w.member.user._id.toString())).status).not.toBe(404);
    // Other per-user reads follow the same rule.
    for (const id of [w.outsider.user._id.toString(), ghost]) {
      expect(
        (await w.member.agent.get(`/api/v1/tracker/day?date=2026-10-13&userId=${id}`)).status,
      ).toBe(404);
      expect((await w.member.agent.get(`/api/v1/leave/balances?userId=${id}`)).status).toBe(404);
    }
  });
});
