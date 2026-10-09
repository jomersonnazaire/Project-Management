import { BRAND, DAR_FOOTER, PRE_BRAND_EXPORT_NAME } from '@xc8/shared';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AccessRuleModel,
  ActivityLogModel,
  LeaveEntitlementModel,
  LeaveModel,
  LeaveTypeModel,
  LookupModel,
  MigrationModel,
  NotificationModel,
  SavedReportModel,
  TimeEntryModel,
  TimesheetDayModel,
  UserModel,
} from '../src/models/index.js';
import { formatIssues } from '../src/lib/validate.js';
import { ensureDefaultAccessRules } from '../src/services/accessRules.js';
import { ensureDefaultLeaveTypes } from '../src/services/leave.js';
import { sweepAutoStop } from '../src/services/tracker.js';
import { CSRF, createUser, login, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';
import { lookups } from './trackerHelpers.js';

/**
 * M8 workforce items (doc 14 v0.9.9): FR-ACT-26 one timer, FR-ACT-27 own timesheet only,
 * FR-ACT-28 field errors, FR-LV-12 leave rows on the Day timesheet. "Now" is Wed Oct 14, 2026.
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

async function setup() {
  const w = await world(app);
  const l = await lookups();
  const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
    id: string;
    name: string;
  }[];
  await UserModel.updateOne({ _id: w.member.user._id }, { supervisorId: w.pm.user._id });
  const task = (i: number, extra = {}) => ({
    taskId: tasks[i]!.id,
    activityTypeId: l.configuration,
    module: l.financials,
    ...extra,
  });
  return { w, l, tasks, task };
}
const start = (a: Agent, body: object) => a.post('/api/v1/tracker/start').set(CSRF).send(body);

describe('FR-ACT-26: one timer per person', () => {
  it('Time in while a timer runs answers 409 naming it; Switch stops it and starts the new one', async () => {
    const { w, l, tasks, task } = await setup();
    const a = await start(w.member.agent, task(0, { dayLocationId: l.onsite }));
    expect(a.status).toBe(201);
    at('2026-10-14T02:20:00Z');
    const refused = await start(w.member.agent, task(1));
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('TIMER_RUNNING');
    expect(refused.body.error.details.running).toEqual({
      id: a.body.entry.id,
      name: tasks[0]!.name,
    });
    // Still only A runs.
    expect(await TimeEntryModel.countDocuments({ running: true })).toBe(1);
    const sw = await start(w.member.agent, task(1, { switchFrom: a.body.entry.id }));
    expect(sw.status).toBe(201);
    expect(sw.body.stopped).toBe(a.body.entry.id);
    const old = await TimeEntryModel.findById(a.body.entry.id).lean();
    expect(old!.running).toBe(false);
    expect(old!.minutes).toBe(20);
    // A stale Switch (A is no longer running) is refused too.
    at('2026-10-14T02:40:00Z');
    const stale = await start(w.member.agent, task(0, { switchFrom: a.body.entry.id }));
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.running.id).toBe(sw.body.entry.id);
    expect(await TimeEntryModel.countDocuments({ running: true })).toBe(1);
  });

  it('two starts at the same moment: one 201, the other 409', async () => {
    const { w, l, task } = await setup();
    // Set the day's location first so both requests take the same path.
    await w.member.agent
      .put('/api/v1/tracker/days/2026-10-14/location')
      .set(CSRF)
      .send({ locationId: l.wfh });
    const results = await Promise.all([
      start(w.member.agent, task(0, { dayLocationId: l.wfh })),
      start(w.member.agent, task(1, { dayLocationId: l.wfh })),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('TIMER_RUNNING');
    expect(await TimeEntryModel.countDocuments({ running: true })).toBe(1);
  });

  it('the database refuses a second running entry for the same person', async () => {
    const { w, l, task } = await setup();
    const a = await start(w.member.agent, task(0, { dayLocationId: l.onsite }));
    const doc = await TimeEntryModel.findById(a.body.entry.id).lean();
    const { _id, ...rest } = doc!;
    void _id;
    await expect(TimeEntryModel.create({ ...rest, createdAt: undefined })).rejects.toMatchObject({
      code: 11000,
    });
  });
});

describe('FR-ACT-27: own timesheet only', () => {
  it('others get 404 on a day timesheet; the supervisor and Admins keep review and reopen', async () => {
    const { w, l, task } = await setup();
    await start(w.member.agent, task(0, { dayLocationId: l.onsite }));
    const member = w.member.user._id.toString();
    const url = `/api/v1/tracker/day?date=2026-10-14&userId=${member}`;
    expect((await w.pm2.agent.get(url)).status).toBe(404);
    expect((await w.viewer.agent.get(url)).status).toBe(404);
    const mine = await w.member.agent.get('/api/v1/tracker/day?date=2026-10-14');
    expect(mine.body.day.user.id).toBe(member);
    // Another member asking for the PM's day: 404 too.
    expect(
      (await w.member.agent.get(`/api/v1/tracker/day?userId=${w.pm.user._id.toString()}`)).status,
    ).toBe(404);
    expect((await w.pm.agent.get(url)).status).toBe(200); // supervisor review
    expect((await w.admin.agent.get(url)).status).toBe(200);
    // Someone else's entry can't be edited or deleted either.
    const entryId = mine.body.day.entries[0].id;
    expect(
      (await w.pm2.agent.delete(`/api/v1/tracker/entries/${entryId}`).set(CSRF).send({})).status,
    ).toBe(404);
    // Time logging lists only the caller's own entries.
    const week = await w.pm2.agent.get('/api/v1/time?week=2026-10-12');
    expect(week.body.items).toHaveLength(0);
    // Reopen is unchanged: supervisor yes, an unrelated PM 404.
    at('2026-10-14T03:00:00Z');
    await w.member.agent.post('/api/v1/tracker/stop').set(CSRF).send({});
    await w.member.agent.post('/api/v1/tracker/days/2026-10-14/submit').set(CSRF).send({});
    const body = { userId: member, reason: 'Fix the afternoon' };
    const reopen = '/api/v1/tracker/days/2026-10-14/reopen';
    expect((await w.pm2.agent.post(reopen).set(CSRF).send(body)).status).toBe(404);
    expect((await w.pm.agent.post(reopen).set(CSRF).send(body)).status).toBe(200);
  });
});

describe('FR-ACT-28: errors name the field', () => {
  it('Start timer with Module blank and Remarks filled works against this API', async () => {
    const { w, l, task } = await setup();
    const res = await start(
      w.member.agent,
      task(0, { module: '', notes: 'Prep the cut-over plan', dayLocationId: l.onsite }),
    );
    expect(res.status).toBe(201);
    expect(res.body.entry.notes).toBe('Prep the cut-over plan');
  });

  it('each failing field comes back with its path; an unknown key is named', async () => {
    const { w, l, task } = await setup();
    const res = await start(
      w.member.agent,
      task(0, { activityTypeId: 'nope', remarks: 'old name', dayLocationId: l.onsite }),
    );
    expect(res.status).toBe(400);
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(['activityTypeId', 'remarks']);
    const issues = formatIssues(
      z.strictObject({ a: z.string() }).safeParse({ a: 'x', b: 1, c: 2 }).error!,
    );
    expect(issues).toEqual([
      { path: 'b', message: "b isn't a field this server accepts." },
      { path: 'c', message: "c isn't a field this server accepts." },
    ]);
  });
});

describe('FR-LV-12: leave on the Day timesheet', () => {
  it('a recorded leave day comes back as a read-only row label', async () => {
    const { w } = await setup();
    await ensureDefaultLeaveTypes();
    const vacation = (await LeaveTypeModel.findOne({ name: 'Vacation' }).lean())!._id.toString();
    await w.admin.agent.put('/api/v1/leave/entitlements').set(CSRF).send({
      userId: w.member.user._id.toString(),
      leaveTypeId: vacation,
      year: 2026,
      days: 10,
    });
    const full = await w.member.agent.post('/api/v1/leave').set(CSRF).send({
      leaveTypeId: vacation,
      dayPart: 'FULL',
      from: '2026-10-19',
      to: '2026-10-19',
    });
    expect(full.status).toBe(201);
    await w.member.agent.post('/api/v1/leave').set(CSRF).send({
      leaveTypeId: vacation,
      dayPart: 'AM',
      from: '2026-10-20',
      to: '2026-10-20',
    });
    const d19 = (await w.member.agent.get('/api/v1/tracker/day?date=2026-10-19')).body.day;
    expect(d19.leaveRows).toEqual([
      expect.objectContaining({ type: 'Vacation', dayPart: 'FULL', label: 'Vacation · Full day' }),
    ]);
    const d20 = (await w.member.agent.get('/api/v1/tracker/day?date=2026-10-20')).body.day;
    expect(d20.leaveRows[0].label).toBe('Vacation · Half day AM');
    const d21 = (await w.member.agent.get('/api/v1/tracker/day?date=2026-10-21')).body.day;
    expect(d21.leaveRows).toEqual([]);
  });
});

describe('timer_auto_stopped audit (FR-ACT-04, EC-75)', () => {
  it('the sweep audits each stop with the system as actor and no request origin', async () => {
    const { w, l, task } = await setup();
    const a = await start(w.member.agent, task(0, { dayLocationId: l.onsite }));
    // Next day, 00:10 PHT: the timer is past 23:59 of its own day.
    const n = await sweepAutoStop(new Date('2026-10-14T16:10:00Z'));
    expect(n).toBe(1);
    const log = await ActivityLogModel.findOne({ action: 'timer_auto_stopped' }).lean();
    expect(log).toMatchObject({
      actorId: null,
      entityType: 'time',
      ip: null,
      userAgent: null,
      meta: { actor: 'system', userId: w.member.user._id.toString() },
    });
    expect(log!.entityId.toString()).toBe(a.body.entry.id);
    expect(log!.projectId!.toString()).toBe(w.project.id);
    expect(log!.changes[0]).toMatchObject({ field: 'endAt', new: '2026-10-14T15:59:00.000Z' });
    expect(log!.meta).toMatchObject({ stoppedAt: '2026-10-14T15:59:00.000Z', autoStopped: true });
    // NFR-28: the audit log shows "System" as the actor.
    const listed = (await w.admin.agent.get('/api/v1/audit?entityType=time')).body.items.find(
      (i: { action: string }) => i.action === 'timer_auto_stopped',
    );
    expect(listed).toMatchObject({
      actor: { id: 'system', name: 'System' },
      entityId: a.body.entry.id,
      ip: null,
      userAgent: null,
    });
    // A second sweep finds nothing to stop and writes nothing.
    expect(await sweepAutoStop(new Date('2026-10-14T16:20:00Z'))).toBe(0);
    expect(await ActivityLogModel.countDocuments({ action: 'timer_auto_stopped' })).toBe(1);
  });
});

describe('audit records the request IP and user agent', () => {
  it('stamps the socket IP and user agent locally; system jobs leave them null', async () => {
    const { w, l, task } = await setup();
    const a = await w.member.agent
      .post('/api/v1/tracker/start')
      .set(CSRF)
      .set('User-Agent', 'QA-Agent/1.0')
      .send(task(0, { dayLocationId: l.onsite }));
    expect(a.status).toBe(201);
    const log = await ActivityLogModel.findOne({
      action: 'timer_started',
      entityId: a.body.entry.id,
    }).lean();
    expect(log!.userAgent).toBe('QA-Agent/1.0');
    expect(log!.ip).toMatch(/^(127\.0\.0\.1|::1)$/);
    // NFR-29: Admins see them in the audit log; others don't get the audit log at all.
    const listed = (await w.admin.agent.get('/api/v1/audit?entityType=time')).body.items.find(
      (i: { action: string }) => i.action === 'timer_started',
    );
    expect(listed).toMatchObject({ userAgent: 'QA-Agent/1.0', ip: log!.ip });
    expect((await w.pm.agent.get('/api/v1/audit')).status).toBe(403);
  });

  it('uses the same trusted client-IP resolution as the rate limiter', async () => {
    const secret = 'edge-secret-for-audit-tests-0123456789abcdef';
    const proxied = makeApp({
      SESSION_IDLE_MINUTES: '1440',
      TRUST_PROXY_HOPS: '1',
      EDGE_PROXY_SECRET: secret,
    });
    const admin = await createUser({ systemRole: 'ADMIN' });
    const agent = await login(proxied, admin.email);
    let n = 0;
    const createClient = async (headers: Record<string, string>) => {
      n += 1;
      const res = await agent
        .post('/api/v1/clients')
        .set(CSRF)
        .set(headers)
        .send({ name: `Audit IP client ${n} ${Date.now()}` });
      expect(res.status).toBe(201);
      return (await ActivityLogModel.findOne({ entityId: res.body.client.id }).lean())!;
    };
    // Direct: a spoofed leading XFF entry is ignored; the proxy-appended entry counts.
    expect(
      await createClient({
        'X-Forwarded-For': '9.9.9.9, 104.28.194.108:45112',
        'User-Agent': 'UA-direct',
      }),
    ).toMatchObject({ ip: '104.28.194.108', userAgent: 'UA-direct' });
    // Via the Vercel edge with the right secret: the edge header wins.
    expect(
      await createClient({
        'X-Forwarded-For': '203.0.113.7, 13.212.8.174:13482',
        'x-xc8-client-ip': '203.0.113.7',
        'x-xc8-edge-secret': secret,
        'User-Agent': 'UA-edge',
      }),
    ).toMatchObject({ ip: '203.0.113.7', userAgent: 'UA-edge' });
    // A forged edge header without the secret is not trusted; long user agents are truncated.
    const forged = await createClient({
      'X-Forwarded-For': '104.28.194.108:45112',
      'x-xc8-client-ip': '6.6.6.6',
      'x-xc8-edge-secret': 'wrong',
      'User-Agent': 'x'.repeat(2000),
    });
    expect(forged.ip).toBe('104.28.194.108');
    expect(forged.userAgent).toHaveLength(512);
  });
});

describe('Branding: DAR exports and saved snapshots', () => {
  it('new reports carry the current name; a saved snapshot keeps the name it was saved with', async () => {
    const { w } = await setup();
    const preview = (await w.member.agent.get('/api/v1/dar?from=2026-10-13&to=2026-10-13')).body
      .report;
    expect(preview.exportName).toBe(BRAND.exportName);
    const saved = await w.member.agent
      .post('/api/v1/dar/saved')
      .set(CSRF)
      .send({ from: '2026-10-13', to: '2026-10-13' });
    expect(saved.status).toBe(201);
    const id = saved.body.item.id as string;
    const footerOf = async () => {
      const x = await w.member.agent
        .get(`/api/v1/dar/saved/${id}/export/xlsx`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(x.body as never);
      const values: string[] = [];
      wb.worksheets[0]!.eachRow((r) => values.push(String(r.getCell(1).value ?? '')));
      return { footer: values.find((v) => v.startsWith('This is an automated email.')), wb };
    };
    expect((await footerOf()).footer).toBe(DAR_FOOTER);
    // Pretend the snapshot was saved under another name (e.g. before a rename).
    await SavedReportModel.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { 'report.exportName': 'Earlier Name' } },
    );
    const renamed = await footerOf();
    expect(renamed.footer).toBe('This is an automated email. Generated by Earlier Name.');
    expect(renamed.wb.creator).toBe('Earlier Name');
    // A snapshot from before reports stored a name keeps the pre-rename name.
    await SavedReportModel.collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $unset: { 'report.exportName': '' } },
    );
    expect((await footerOf()).footer).toBe(
      `This is an automated email. Generated by ${PRE_BRAND_EXPORT_NAME}.`,
    );
  });
});

describe('DR-45: timer times on whole minutes', () => {
  it('01:02:40 → 01:05:10 saves 01:02 → 01:05 and 3 minutes', async () => {
    const { w, l, task } = await setup();
    at('2026-10-13T17:02:40.500Z'); // 01:02:40 PHT, Wed Oct 14
    const a = await start(w.member.agent, task(0, { dayLocationId: l.onsite }));
    expect(a.status).toBe(201);
    expect(a.body.entry.startAt).toBe('2026-10-13T17:02:00.000Z');
    at('2026-10-13T17:05:10.000Z');
    const s = await w.member.agent
      .post('/api/v1/tracker/stop')
      .set(CSRF)
      .send({ entryId: a.body.entry.id });
    expect(s.status).toBe(200);
    expect(s.body.entry).toMatchObject({
      startAt: '2026-10-13T17:02:00.000Z',
      endAt: '2026-10-13T17:05:00.000Z',
      minutes: 3,
    });
  });

  it('a timer that started mid-minute (before this fix) is floored when it stops', async () => {
    const { w, l, task } = await setup();
    const a = await start(w.member.agent, task(0, { dayLocationId: l.onsite }));
    await TimeEntryModel.collection.updateOne(
      { _id: new Types.ObjectId(a.body.entry.id as string) },
      { $set: { startAt: new Date('2026-10-14T01:02:40Z') } },
    );
    at('2026-10-14T01:05:10Z');
    const s = await w.member.agent.post('/api/v1/tracker/stop').set(CSRF).send({});
    expect(s.body.entry).toMatchObject({
      startAt: '2026-10-14T01:02:00.000Z',
      endAt: '2026-10-14T01:05:00.000Z',
      minutes: 3,
    });
  });

  it('the auto-stop still ends at exactly 23:59:00 PHT', async () => {
    at('2026-10-14T15:30:45.900Z'); // 23:30:45 PHT (sign in now: sessions have a maximum age)
    const { w, l, task } = await setup();
    const a = await start(w.member.agent, task(0, { dayLocationId: l.onsite }));
    expect(a.body.entry.startAt).toBe('2026-10-14T15:30:00.000Z');
    // The sweep runs at an odd second the next morning.
    expect(await sweepAutoStop(new Date('2026-10-15T00:07:31.250Z'))).toBe(1);
    const e = await TimeEntryModel.findById(a.body.entry.id).lean();
    expect(e!.endAt!.toISOString()).toBe('2026-10-14T15:59:00.000Z');
    expect(e!.minutes).toBe(29);
    expect(e!.autoStopped).toBe(true);
  });

  it('the 24-hour cap still stops on a whole minute and fills the day exactly', async () => {
    const { w, l, tasks, task } = await setup();
    const hoursOnly = (hours: number) =>
      w.member.agent.post('/api/v1/time').set(CSRF).send({
        taskId: tasks[0]!.id,
        workDate: '2026-10-14',
        hours,
        activityTypeId: l.configuration,
      });
    expect((await hoursOnly(18)).status).toBe(201);
    at('2026-10-14T02:00:37Z'); // 10:00:37 PHT
    const a = await start(w.member.agent, task(0, { dayLocationId: l.onsite }));
    expect(a.body.entry.startAt).toBe('2026-10-14T02:00:00.000Z');
    at('2026-10-14T03:00:00Z');
    expect((await hoursOnly(5)).status).toBe(201); // 18h + 5h + 1h on the timer = 24h
    at('2026-10-14T05:45:59Z'); // 3h45m59s on the timer would pass 24 hours
    const s = await w.member.agent.post('/api/v1/tracker/stop').set(CSRF).send({});
    expect(s.body.entry).toMatchObject({
      startAt: '2026-10-14T02:00:00.000Z',
      endAt: '2026-10-14T03:00:00.000Z',
      minutes: 60,
      autoStopped: true,
    });
    const d = (await w.member.agent.get('/api/v1/tracker/day?date=2026-10-14')).body.day;
    expect(d.totalMinutes).toBe(24 * 60);
  });

  it('manual entries: minutes equal time out minus time in', async () => {
    const { w, l, task } = await setup();
    const m = await w.member.agent
      .post('/api/v1/tracker/entries')
      .set(CSRF)
      .send({
        ...task(0),
        date: '2026-10-13',
        dayLocationId: l.onsite,
        timeIn: '01:02',
        timeOut: '01:05',
      });
    expect(m.status).toBe(201);
    expect(m.body.entry.minutes).toBe(3);
    expect(new Date(m.body.entry.startAt as string).getUTCSeconds()).toBe(0);
  });
});

describe('DR-43: report filter options from the report scope', () => {
  it("a Member gets their projects and those projects' clients, without needing /clients", async () => {
    const { w } = await setup();
    // A second project the Member isn't on, under another client.
    const other = await w.pm.agent.post('/api/v1/projects').set(CSRF).send({
      name: 'Hidden Q',
      clientId: w.other.client.id,
      managerId: w.pm.user._id.toString(),
      memberIds: [],
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: w.template.id,
    });
    expect(other.status).toBe(201);
    const mine = await w.member.agent.get('/api/v1/reports/filters');
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual({
      projects: [{ id: w.project.id, name: 'Rollout P' }],
      clients: [{ id: w.acme.client.id, name: w.acme.client.name }],
    });
    // Works without Clients View (UIE's Member): the options still come back, /clients doesn't.
    await ensureDefaultAccessRules();
    await AccessRuleModel.updateOne(
      { role: 'MEMBER' },
      { $set: { 'permissions.clients.view': false } },
    );
    expect((await w.member.agent.get('/api/v1/clients')).status).toBe(403);
    expect((await w.member.agent.get('/api/v1/reports/filters')).body).toEqual(mine.body);
    await AccessRuleModel.updateOne(
      { role: 'MEMBER' },
      { $set: { 'permissions.clients.view': true } },
    );
    const pm = (await w.pm.agent.get('/api/v1/reports/filters')).body;
    // PMs see every non-archived project (earlier tests' projects included).
    const ids = pm.projects.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([w.project.id, other.body.project.id]));
    expect(pm.clients.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining([w.acme.client.id, w.other.client.id]),
    );
  });
});
