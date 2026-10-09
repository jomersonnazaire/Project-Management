import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityLogModel,
  LookupModel,
  MigrationModel,
  NotificationModel,
  ProjectModel,
  SavedReportModel,
  TimeEntryModel,
  TimesheetDayModel,
  UserModel,
} from '../src/models/index.js';
import { buildDar } from '../src/services/dar.js';
import { darToPdf, darToXlsx } from '../src/services/darExport.js';
import { setLeaveLabeler } from '../src/services/leaveHook.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';
import { lookups } from './trackerHelpers.js';

/**
 * M6 Daily Accomplishment Report (doc 14 §3, §14, §15; QA 06 TC-R01..R10).
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
  setLeaveLabeler(async () => null);
  await Promise.all(
    [
      TimeEntryModel,
      TimesheetDayModel,
      NotificationModel,
      ActivityLogModel,
      LookupModel,
      MigrationModel,
      SavedReportModel,
    ].map((m) => (m as typeof TimeEntryModel).deleteMany({})),
  );
});

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

async function setup() {
  const w = await world(app);
  const l = await lookups();
  await ProjectModel.updateOne({ _id: w.project.id }, { status: 'ACTIVE' });
  const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
    id: string;
  }[];
  await UserModel.updateOne({ _id: w.member.user._id }, { supervisorId: w.pm.user._id });
  const project = await ProjectModel.findById(w.project.id).populate('clientId', 'name').lean();
  const clientName = (project!.clientId as unknown as { name: string }).name;
  return { w, l, t1: tasks[0]!.id, clientName };
}

const manual = (a: Agent, body: object) => a.post('/api/v1/tracker/entries').set(CSRF).send(body);
const dar = (a: Agent, from: string, to: string) => a.get(`/api/v1/dar?from=${from}&to=${to}`);
const save = (a: Agent, from: string, to: string) =>
  a.post('/api/v1/dar/saved').set(CSRF).send({ from, to });

/** Jomerson's sample day: one project entry and one quick activity. */
async function sampleDay(s: Awaited<ReturnType<typeof setup>>, date = '2026-10-13') {
  const { w, l, t1 } = s;
  const a = await manual(w.member.agent, {
    taskId: t1,
    activityTypeId: l.integration,
    moduleId: l.financials,
    date,
    timeIn: '08:00',
    timeOut: '12:00',
    dayLocationId: l.wfh,
    notes: 'Checked JAEIA Logs Issue',
  });
  expect(a.status).toBe(201);
  const b = await manual(w.member.agent, {
    title: 'Client meeting',
    activityTypeId: l.internalMeeting,
    date,
    timeIn: '13:00',
    timeOut: '14:07',
    locationId: l.onsite,
    notes: 'Acme weekly status call',
  });
  expect(b.status).toBe(201);
  return { project: a.body.entry, quick: b.body.entry };
}

describe('TC-R01/R02: preview matches the sample', () => {
  it('has the header, 11 columns, 12-hour times, HH:MM, totals and the mapping', async () => {
    const s = await setup();
    await sampleDay(s);
    const res = await dar(s.w.member.agent, '2026-10-13', '2026-10-13');
    expect(res.status).toBe(200);
    const r = res.body.report;
    expect(r).toMatchObject({
      from: '2026-10-13',
      to: '2026-10-13',
      shownTo: '2026-10-13',
      totalActivities: 2,
      totalMinutes: 307,
      totalRendered: '05:07',
      supervisor: { id: s.w.pm.user._id.toString() },
    });
    expect(r.rows[0]).toEqual({
      date: '2026-10-13',
      timeIn: '08:00 AM',
      timeOut: '12:00 PM',
      minutes: 240,
      rendered: '04:00',
      client: s.clientName,
      project: 'Rollout P',
      activityType: 'Integration',
      location: 'WFH',
      billable: 'Yes',
      module: 'Financials',
      remarks: 'Checked JAEIA Logs Issue',
    });
    // Quick activity: Activity Type set, Client and Project blank, Remarks separate from Module.
    expect(r.rows[1]).toMatchObject({
      timeIn: '01:00 PM',
      timeOut: '02:07 PM',
      rendered: '01:07',
      client: '',
      project: '',
      activityType: 'Internal meeting',
      location: 'Onsite',
      billable: 'No',
      module: '',
      remarks: 'Client meeting – Acme weekly status call',
    });
    // No Time type column in the report (FR-ACT-18).
    expect(Object.keys(r.rows[0])).not.toContain('type');
  });

  it('defaults to today; Members only see their own report', async () => {
    const s = await setup();
    const res = await s.w.member.agent.get('/api/v1/dar');
    expect(res.body.report).toMatchObject({ from: '2026-10-14', to: '2026-10-14', rows: [] });
    expect(
      (await s.w.member.agent.get(`/api/v1/dar?from=2026-10-14&to=2026-10-14&userId=x`)).status,
    ).toBe(400);
  });
});

describe('TC-R03: range limits', () => {
  it('refuses over 31 days and From after To; leaves out future days; shows leave days', async () => {
    const s = await setup();
    const long = await dar(s.w.member.agent, '2026-09-01', '2026-10-02');
    expect(long.status).toBe(400);
    expect(long.body.error.details[0].message).toBe(
      'The range can be up to 31 days. Pick a shorter range.',
    );
    expect((await dar(s.w.member.agent, '2026-09-01', '2026-10-01')).status).toBe(200);
    const back = await dar(s.w.member.agent, '2026-10-14', '2026-10-13');
    expect(back.body.error.details[0].message).toBe('"From" must be on or before "To".');

    await sampleDay(s);
    setLeaveLabeler(async (_u, d) =>
      d.toISOString().startsWith('2026-10-12') ? 'On leave' : null,
    );
    const r = (await dar(s.w.member.agent, '2026-10-12', '2026-10-20')).body.report;
    expect(r.shownTo).toBe('2026-10-14');
    expect(r.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
    expect(r.days[0].leave).toBe('On leave');
    expect(r.rows[0]).toMatchObject({ date: '2026-10-12', remarks: 'On leave', leave: true });
    expect(r.totalActivities).toBe(2);
    const future = (await dar(s.w.member.agent, '2026-10-15', '2026-10-20')).body.report;
    expect(future).toMatchObject({ shownTo: null, rows: [], days: [], totalActivities: 0 });
  });
});

describe('TC-R04: day status', () => {
  it('shows Submitted, Not submitted or Reopened; a running timer is left out', async () => {
    const s = await setup();
    const { w, l, t1 } = s;
    await sampleDay(s, '2026-10-12');
    await sampleDay(s, '2026-10-13');
    await w.member.agent.post('/api/v1/tracker/days/2026-10-12/submit').set(CSRF).send({});
    await w.member.agent.post('/api/v1/tracker/days/2026-10-13/submit').set(CSRF).send({});
    await w.pm.agent
      .post('/api/v1/tracker/days/2026-10-12/reopen')
      .set(CSRF)
      .send({ userId: w.member.user._id.toString(), reason: 'Fix remarks' });
    await w.member.agent.post('/api/v1/tracker/start').set(CSRF).send({
      taskId: t1,
      activityTypeId: l.configuration,
      moduleId: l.financials,
      dayLocationId: l.wfh,
    });
    at('2026-10-14T03:00:00Z');
    const r = (await dar(w.member.agent, '2026-10-12', '2026-10-14')).body.report;
    expect(r.days.map((d: { status: string }) => d.status)).toEqual([
      'Reopened',
      'Submitted',
      'Not submitted',
    ]);
    expect(r.days[0].reopenedBy).toBe(w.pm.user.name);
    expect(r.runningExcluded).toBe(1);
    expect(r.totalActivities).toBe(4);
  });
});

describe('TC-R05/R10: exports', () => {
  it('PDF and Excel carry the same rows and totals, numeric hours, ñ, and text-only cells', async () => {
    const s = await setup();
    const { w, l, t1 } = s;
    await sampleDay(s);
    const nasty = [
      'Niño visited Parañaque',
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '=HYPERLINK("http://evil.example","click")',
    ];
    for (const [i, notes] of nasty.entries()) {
      const res = await manual(w.member.agent, {
        taskId: t1,
        activityTypeId: l.configuration,
        moduleId: l.financials,
        date: '2026-10-13',
        timeIn: `1${5 + i}:00`,
        timeOut: `1${5 + i}:30`,
        notes,
      });
      expect(res.status).toBe(201);
    }
    const preview = (await dar(w.member.agent, '2026-10-13', '2026-10-13')).body.report;
    expect(preview.totalActivities).toBe(6);
    // The API returns the text as-is; the web app renders it as text (never HTML).
    expect(preview.rows.map((r: { remarks: string }) => r.remarks)).toEqual(
      expect.arrayContaining(nasty),
    );

    const x = await w.member.agent
      .get('/api/v1/dar/export/xlsx?from=2026-10-13&to=2026-10-13')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect(x.headers['content-disposition']).toContain('DAR_2026-10-13.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as never);
    const ws = wb.getWorksheet('Report')!;
    expect(ws.getCell('A1').value).toBe('Daily Accomplishment Report');
    expect(ws.getCell('A2').value).toBe('Generated range: Oct 13, 2026 to Oct 13, 2026');
    expect(ws.getCell('A3').value).toBe('Total Activities: 6');
    expect((ws.getRow(5).values as unknown[]).slice(1)).toEqual([
      'Date',
      'Time In',
      'Time Out',
      'Rendered Hrs',
      'Client Name',
      'Project Name',
      'Activity Type',
      'Location',
      'Billable',
      'Module',
      'Activity Remarks',
    ]);
    // Rendered hours are numbers (fractions of a day, shown as [h]:mm) so Excel can add them.
    expect(ws.getCell('D6').numFmt).toBe('[h]:mm');
    expect(ws.getCell('A12').value).toBe('Total rendered hours');
    const remarks = [6, 7, 8, 9, 10, 11].map((n) => ws.getCell(`K${n}`));
    expect(remarks.map((c) => c.value)).toEqual(
      preview.rows.map((r: { remarks: string }) => r.remarks),
    );
    for (const c of remarks) expect(c.type).toBe(ExcelJS.ValueType.String);
    // No formulas anywhere in the sheet XML.
    const zip = await JSZip.loadAsync(x.body as Buffer);
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).not.toContain('<f>');
    const num = (ref: string) =>
      Number(new RegExp(`<c r="${ref}"[^>]*><v>([^<]+)</v>`).exec(sheet)?.[1]);
    expect(num('D6')).toBeCloseTo(240 / 1440, 6);
    expect(num('D12')).toBeCloseTo(preview.totalMinutes / 1440, 6);
    expect(ws.getCell('A14').value).toBe(
      'This is an automated email. Generated by Project Activity Tracker Application.',
    );

    const p = await w.member.agent.get('/api/v1/dar/export/pdf?from=2026-10-13&to=2026-10-13');
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toBe('application/pdf');
    const report = await buildDar(w.member.user._id, '2026-10-13', '2026-10-13');
    const text = pdfText(await darToPdf(report, { compress: false }));
    for (const s2 of [
      'Daily Accomplishment Report',
      'Total Activities: 6',
      'Activity Remarks',
      'Niño visited Parañaque',
      '<script>alert(1)</script>',
      'Total rendered hours',
      report.totalRendered,
      '08:00 AM',
      'This is an automated email.',
    ])
      expect(text).toContain(s2);
    expect((await darToXlsx(report)).length).toBeGreaterThan(1000);
  });
});

/** The text a pdfkit PDF draws (standard fonts: WinAnsi hex strings in TJ arrays). */
function pdfText(pdf: Buffer): string {
  const src = pdf.toString('latin1');
  const out: string[] = [];
  for (const m of src.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    out.push(
      [...m[1]!.matchAll(/<([0-9a-fA-F]*)>/g)]
        .map((h) => Buffer.from(h[1]!, 'hex').toString('latin1'))
        .join(''),
    );
  }
  // Wrapped cells break lines; join them so words can be found.
  return out.join(' ').replace(/\s+/g, ' ');
}

describe('TC-R06: no Send', () => {
  it('has no send or email endpoint', async () => {
    const s = await setup();
    await sampleDay(s);
    const saved = (await save(s.w.member.agent, '2026-10-13', '2026-10-13')).body.item;
    for (const url of [
      '/api/v1/dar/send',
      `/api/v1/dar/saved/${saved.id}/send`,
      '/api/v1/dar/email',
    ])
      expect((await s.w.member.agent.post(url).set(CSRF).send({ to: 'x@y.example' })).status).toBe(
        404,
      );
  });
});

describe('TC-R07: saved copies, Latest and Earlier version', () => {
  it('keeps the first copy unchanged and flags the changed date', async () => {
    const s = await setup();
    const { w } = s;
    const { project } = await sampleDay(s);
    const first = await save(w.member.agent, '2026-10-13', '2026-10-13');
    expect(first.status).toBe(201);
    expect(first.body.item).toMatchObject({ tag: null, totalActivities: 2, changedDates: [] });
    expect(
      await ActivityLogModel.countDocuments({
        action: 'report_saved',
        entityId: first.body.item.id,
      }),
    ).toBe(1);

    at('2026-10-14T02:10:00Z');
    const edit = await w.member.agent
      .patch(`/api/v1/tracker/entries/${project.id}`)
      .set(CSRF)
      .send({ notes: 'Checked logs and fixed mapping' });
    expect(edit.status).toBe(200);
    at('2026-10-14T02:20:00Z');
    const second = (await save(w.member.agent, '2026-10-13', '2026-10-13')).body.item;
    at('2026-10-14T02:30:00Z');
    const overlap = (await save(w.member.agent, '2026-10-12', '2026-10-13')).body.item;

    const list = (await w.member.agent.get('/api/v1/dar/saved')).body.items;
    expect(list.map((i: { id: string }) => i.id)).toEqual([
      overlap.id,
      second.id,
      first.body.item.id,
    ]);
    expect(list[0]).toMatchObject({ tag: null, changedDates: [] });
    expect(list[1]).toMatchObject({ tag: 'LATEST', changedDates: [] });
    expect(list[2]).toMatchObject({ tag: 'EARLIER', changedDates: ['2026-10-13'] });

    const old = (await w.member.agent.get(`/api/v1/dar/saved/${first.body.item.id}`)).body.item;
    expect(old.report.rows[0].remarks).toBe('Checked JAEIA Logs Issue');
    expect(old.changedDates).toEqual(['2026-10-13']);
    const latest = (await w.member.agent.get(`/api/v1/dar/saved/${second.id}`)).body.item;
    expect(latest.report.rows[0].remarks).toBe('Checked logs and fixed mapping');

    const filtered = await w.member.agent.get('/api/v1/dar/saved?label=EARLIER');
    expect(filtered.body.items.map((i: { id: string }) => i.id)).toEqual([first.body.item.id]);
    const none = await w.member.agent.get('/api/v1/dar/saved?from=2026-10-15');
    expect(none.body.items).toEqual([]);
    const exp = await w.member.agent.get(`/api/v1/dar/saved/${first.body.item.id}/export/pdf`);
    expect(exp.status).toBe(200);
  });
});

describe('TC-R08/R09: privacy and no deletes', () => {
  it('everyone else gets 404; nobody can delete or edit a saved report', async () => {
    const s = await setup();
    const { w } = s;
    await sampleDay(s);
    const id = (await save(w.member.agent, '2026-10-13', '2026-10-13')).body.item.id;
    for (const who of [w.pm, w.admin, w.pm2, w.outsider, w.viewer]) {
      expect((await who.agent.get(`/api/v1/dar/saved/${id}`)).status).toBe(404);
      for (const f of ['pdf', 'xlsx'])
        expect((await who.agent.get(`/api/v1/dar/saved/${id}/export/${f}`)).status).toBe(404);
      expect((await who.agent.get('/api/v1/dar/saved')).body.items ?? []).toEqual([]);
    }
    for (const who of [w.member, w.admin]) {
      expect([404, 405]).toContain(
        (await who.agent.delete(`/api/v1/dar/saved/${id}`).set(CSRF)).status,
      );
      expect([404, 405]).toContain(
        (await who.agent.patch(`/api/v1/dar/saved/${id}`).set(CSRF).send({ from: '2026-10-12' }))
          .status,
      );
    }
    expect(await SavedReportModel.countDocuments({ _id: id })).toBe(1);
  });
});

describe('FR-DAR-01: Report CC emails on the profile', () => {
  it('Admins set up to 5; the report shows them read-only', async () => {
    const s = await setup();
    const { w } = s;
    const url = `/api/v1/users/${w.member.user._id.toString()}`;
    const six = Array.from({ length: 6 }, (_, i) => `cc${i}@acme.example`);
    expect((await w.admin.agent.patch(url).set(CSRF).send({ reportCc: six })).status).toBe(400);
    const bad = await w.admin.agent
      .patch(url)
      .set(CSRF)
      .send({ reportCc: ['nope'] });
    expect(bad.status).toBe(400);
    const ok = await w.admin.agent
      .patch(url)
      .set(CSRF)
      .send({ reportCc: ['Lead@Acme.example', 'hr@xceler8.example'] });
    expect(ok.status).toBe(200);
    expect(ok.body.user.reportCc).toEqual(['lead@acme.example', 'hr@xceler8.example']);
    expect((await w.member.agent.patch(url).set(CSRF).send({ reportCc: [] })).status).toBe(403);
    const r = (await w.member.agent.get('/api/v1/dar')).body.report;
    expect(r.cc).toEqual(['lead@acme.example', 'hr@xceler8.example']);
  });
});
