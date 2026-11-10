import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_IMPORT_TOKEN_HEADER,
  TIMELINE_COLUMNS,
  XLSX_MIME,
  type TimelineDto,
  type TimelineImportCommitDto,
  type TimelineImportPreviewDto,
} from '@xc8/shared';
import {
  ActivityLogModel,
  FolderModel,
  NotificationModel,
  ProjectModel,
  TaskModel,
} from '../src/models/index.js';
import { CSRF, createUser, makeApp, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

/** CR-22 Part B slice 3: timeline Excel template, export and import (FR-TL-15 to 22, 25, 26; AC-74.x). */
useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

const base = (pid: string) => `/api/v1/projects/${pid}/timeline`;
const fileOf = (agent: Agent, path: string) =>
  agent
    .get(path)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
const send = (
  agent: Agent,
  pid: string,
  step: 'preview' | 'commit',
  buf: Buffer,
  opts: { token?: string; confirm?: number[] } = {},
) => {
  const q = new URLSearchParams({ fileName: 'tl.xlsx' });
  if (opts.confirm?.length) q.set('confirm', opts.confirm.join(','));
  const req = agent
    .post(`${base(pid)}/import/${step}?${q.toString()}`)
    .set(CSRF)
    .set('Content-Type', XLSX_MIME);
  if (opts.token) req.set(CLIENT_IMPORT_TOKEN_HEADER, opts.token);
  return req.send(buf);
};
async function preview(agent: Agent, pid: string, buf: Buffer) {
  const res = await send(agent, pid, 'preview', buf);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as TimelineImportPreviewDto;
}
async function commit(agent: Agent, pid: string, buf: Buffer, confirm: number[] = []) {
  const p = await preview(agent, pid, buf);
  const res = await send(agent, pid, 'commit', buf, { token: p.token, confirm });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { preview: p, done: res.body as TimelineImportCommitDto };
}
async function exported(agent: Agent, pid: string) {
  const res = await fileOf(agent, `${base(pid)}/export`);
  expect(res.status).toBe(200);
  return res.body as Buffer;
}
async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}
const col = (field: (typeof TIMELINE_COLUMNS)[number]['field']) =>
  TIMELINE_COLUMNS.findIndex((c) => c.field === field) + 1;
/** Edits the Timeline sheet of a workbook and returns the new file. */
async function edit(buf: Buffer, fn: (ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void) {
  const wb = await load(buf);
  fn(wb.getWorksheet('Timeline')!, wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const tl = async (agent: Agent, pid: string) =>
  (await agent.get(`/api/v1/projects/${pid}/timeline`)).body as TimelineDto;

describe('CR-22 B3: template and export (FR-TL-15, 16; AC-74.1, 74.2, 74.5)', () => {
  it('template has the three sheets, headers only and no project id (A-54)', async () => {
    const w = await world(app);
    const res = await fileOf(w.pm.agent, `${base(w.project.id)}/template`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(XLSX_MIME);
    expect(res.headers['content-disposition']).toContain('OpsTrack-timeline-template.xlsx');
    const wb = await load(res.body as Buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Instructions', 'Timeline', '_meta']);
    expect(wb.getWorksheet('_meta')!.state).toBe('hidden');
    const ws = wb.getWorksheet('Timeline')!;
    expect(TIMELINE_COLUMNS.map((_, i) => ws.getRow(1).getCell(i + 1).value)).toEqual(
      TIMELINE_COLUMNS.map((c) => c.header),
    );
    expect(ws.getColumn(11).hidden).toBe(true);
    expect(ws.getRow(2).getCell(2).value).toBeNull();
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 2, ySplit: 1 });
    const meta = wb.getWorksheet('_meta')!;
    expect(meta.getCell('A2').value).toBe('template');
    expect(meta.getCell('B2').value).toBe('opstrack-timeline');
    expect(meta.getCell('B4').value).toBeFalsy(); // projectId empty
  });

  it('export writes every task with its hidden Task ID; an unchanged re-import saves nothing', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const before = await tl(w.pm.agent, pid);
    const buf = await exported(w.pm.agent, pid);
    const wb = await load(buf);
    const ws = wb.getWorksheet('Timeline')!;
    expect(ws.getRow(2).getCell(col('taskId')).value).toBe(before.tasks[0]!.id);
    expect(ws.getRow(3).getCell(col('dependsOn')).value).toBe(String(before.tasks[0]!.order));
    expect(ws.getRow(2).getCell(col('start')).value).toBeInstanceOf(Date);
    expect(wb.getWorksheet('_meta')!.getCell('B4').value).toBe(pid);
    // Milliseconds kept, so a save in the same second just before the export isn't "changed after".
    expect(String(wb.getWorksheet('_meta')!.getCell('B6').value)).toMatch(/\.\d{3}Z$/);
    expect(
      await ActivityLogModel.countDocuments({ projectId: pid, action: 'timeline_exported' }),
    ).toBe(1);

    const p = await preview(w.pm.agent, pid, buf);
    expect(p.counts).toMatchObject({ total: 3, unchanged: 3, new: 0, update: 0, error: 0 });
    expect(p.exported?.at).toBeTruthy();
    const versions = (await TaskModel.find({ projectId: pid }).lean()).map((t) => t.version);
    const res = await send(w.pm.agent, pid, 'commit', buf, { token: p.token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: [], updated: 0, unchanged: 3 });
    expect((await TaskModel.find({ projectId: pid }).lean()).map((t) => t.version)).toEqual(
      versions,
    );
  });

  it('AC-74.5: Members and Viewers get 403, a PM outside the project 404', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const buf = await exported(w.pm.agent, pid);
    for (const agent of [w.member.agent, w.viewer.agent]) {
      expect((await fileOf(agent, `${base(pid)}/template`)).status).toBe(403);
      expect((await fileOf(agent, `${base(pid)}/export`)).status).toBe(403);
      expect((await send(agent, pid, 'preview', buf)).status).toBe(403);
      expect((await send(agent, pid, 'commit', buf, { token: 'x.y' })).status).toBe(403);
    }
    expect((await fileOf(w.pm2.agent, `${base(pid)}/export`)).status).toBe(404);
    expect((await send(w.pm2.agent, pid, 'preview', buf)).status).toBe(404);
  });
});

describe('CR-22 B3: import (FR-TL-17 to 21; AC-74.3, 74.4, 74.6, 74.10 to 74.12)', () => {
  it('updates matched rows, lists and applies clears, ignores baselines, audits each task', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    // A baseline and an owner first, so the file has baseline values and something to clear.
    let t = await tl(w.pm.agent, pid);
    await TaskModel.updateOne({ _id: t.tasks[1]!.id }, { $set: { ownerId: w.member.user._id } });
    expect(
      (await w.pm.agent.post(`/api/v1/projects/${pid}/baseline`).set(CSRF).send({})).status,
    ).toBe(201);
    t = await tl(w.pm.agent, pid);
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('finish')).value = new Date('2026-12-01T00:00:00Z');
      ws.getRow(2).getCell(col('baselineFinish')).value = new Date('2027-01-01T00:00:00Z');
      ws.getRow(3).getCell(col('owner')).value = null;
      ws.getRow(3).getCell(col('start')).value = null;
      ws.getRow(3).getCell(col('dependsOn')).value = null;
    });
    const { preview: p, done } = await commit(w.pm.agent, pid, file);
    expect(p.baselineFilled).toBe(true);
    const [r2, r3] = [p.rows[0]!, p.rows[1]!];
    expect(r2).toMatchObject({ result: 'UPDATE', changes: ['finish'], clears: [] });
    expect(r2.old.finish).toBe(t.tasks[0]!.dueDate);
    expect(r3.result).toBe('UPDATE');
    expect(r3.clears.sort()).toEqual(['dependsOn', 'owner', 'start']);
    expect(done).toMatchObject({ created: [], updated: 2, unchanged: 1, leftUnconfirmed: 0 });

    const after = await tl(w.pm.agent, pid);
    expect(after.tasks[0]!.dueDate).toBe('2026-12-01');
    expect(after.tasks[1]).toMatchObject({ owner: null, plannedStart: null, dependsOn: [] });
    expect(after.tasks[1]!.dueDate).toBe(t.tasks[1]!.dueDate); // nothing else changed
    // AC-74.10: baselines unchanged.
    expect(after.tasks[0]!.baselineFinish).toBe(t.tasks[0]!.baselineFinish);
    // AC-74.6: one entry per task plus a summary.
    const logs = await ActivityLogModel.find({
      projectId: pid,
      'meta.importId': done.importId,
    }).lean();
    expect(logs.filter((l) => l.action === 'task_updated')).toHaveLength(2);
    const summary = logs.find((l) => l.action === 'timeline_imported')!;
    expect(summary.meta).toMatchObject({ counts: { added: 0, updated: 2, unchanged: 1 } });
    // EC-194: the same file again is all Unchanged.
    expect((await preview(w.pm.agent, pid, file)).counts.unchanged).toBe(3);
  });

  it('AC-74.11: new rows go to the end with final numbers and their links kept', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(5).values = [21, 'Go-live prep', 'Phase B', 'N', '2026-12-01', '2026-12-03', '1'];
      ws.getRow(6).values = [22, 'Go-live', 'Phase B', 'Y', '2026-12-04', '2026-12-04', '21'];
    });
    const { preview: p, done } = await commit(w.pm.agent, pid, file);
    expect(p.rows.filter((r) => r.result === 'NEW').map((r) => r.willBe)).toEqual([4, 5]);
    expect(done.created).toEqual([4, 5]);
    const after = await tl(w.pm.agent, pid);
    const [a, b] = [after.tasks[3]!, after.tasks[4]!];
    expect(a).toMatchObject({ order: 4, name: 'Go-live prep', phase: 'Phase B' });
    expect(a.dependsOn).toEqual([after.tasks[0]!.id]);
    expect(b).toMatchObject({ order: 5, isMilestone: true, dependsOn: [a.id] });
    expect(b.phaseId).toBe(after.phases.find((ph) => ph.name === 'Phase B')!.id);
    const created = await ActivityLogModel.countDocuments({
      'meta.importId': done.importId,
      action: 'task_created',
    });
    expect(created).toBe(2);
  });

  it('AC-74.3: every §B5 row error is reported and nothing is saved', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const before = await TaskModel.find({ projectId: pid }).lean();
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('name')).value = null; // missing name
      ws.getRow(2).getCell(col('dependsOn')).value = '3'; // 1 → 3 → 2 → 1 cycle
      ws.getRow(3).getCell(col('finish')).value = new Date('2020-01-01T00:00:00Z');
      ws.getRow(4).getCell(col('dependsOn')).value = '2; 42';
      ws.getRow(5).values = [
        'x',
        'Bad number',
        '',
        'maybe',
        '2026-11-31',
        '',
        'FS 3',
        'nobody@xceler8.example',
      ];
      ws.getRow(6).values = [7, 'Dup', '', '', '', '', '7', w.outsider.user.email];
      ws.getRow(7).values = [7, 'Dup 2'];
      ws.getRow(8).values = [
        8,
        'Foreign id',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'aaaaaaaaaaaaaaaaaaaaaaaa',
      ];
    });
    const p = await preview(w.pm.agent, pid, file);
    const msgs = (row: number) => p.rows.find((r) => r.row === row)!.errors.map((e) => e.message);
    expect(msgs(2)).toContain('Task name is required.');
    expect(msgs(2).some((m) => m.startsWith('Depends on: circular dependency'))).toBe(true);
    expect(msgs(3)).toContain("Finish can't be before Start.");
    expect(msgs(4)).toContain("Depends on: 42 isn't a task in this project or this file.");
    expect(msgs(5)).toEqual(
      expect.arrayContaining([
        'Task number must be a whole number of 1 or more.',
        'Milestone must be Y or N.',
        "Start isn't a valid date. Use a date cell or YYYY-MM-DD.",
        'Depends on: use task numbers only, e.g. 3, 5.',
        "Owner nobody@xceler8.example isn't an active internal user.",
      ]),
    );
    expect(msgs(6)).toEqual(
      expect.arrayContaining([
        'Task number 7 appears more than once in the file.',
        "Depends on: a task can't depend on itself.",
        `${w.outsider.user.email} isn't a member of this project. Add them to the project first.`,
      ]),
    );
    expect(msgs(8)).toContain("Task ID aaaaaaaaaaaaaaaaaaaaaaaa isn't a task in this project.");
    expect(p.counts.error).toBeGreaterThanOrEqual(6);
    // Q-146: any row error blocks the commit.
    const res = await send(w.pm.agent, pid, 'commit', file, { token: p.token });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IMPORT_HAS_ERRORS');
    const after = await TaskModel.find({ projectId: pid }).lean();
    expect(after.map((t) => [t.name, t.version])).toEqual(before.map((t) => [t.name, t.version]));
  });

  it('file errors: not .xlsx, columns out of order, another project (FR-TL-26), UIE sample', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    let res = await send(w.pm.agent, pid, 'preview', Buffer.from('a,b\n1,2\n'));
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('NOT_XLSX');
    const swapped = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(1).getCell(3).value = 'Finish';
      ws.getRow(1).getCell(6).value = 'Phase';
    });
    res = await send(w.pm.agent, pid, 'preview', swapped);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe(
      'Some columns are missing or out of order: Phase, Finish. Keep row 1 of the template as it is, then try again. Nothing was imported.',
    );
    // FR-TL-26 / Q26: a made-up project id (no such project) is refused like another project's.
    const madeUp = await edit(await exported(w.pm.agent, pid), (_ws, wb) => {
      wb.getWorksheet('_meta')!.getCell('B4').value = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    });
    res = await send(w.pm.agent, pid, 'preview', madeUp);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OTHER_PROJECT');
    expect(res.body.error.message).toContain('Export the timeline from Rollout P');
  });

  it('AC-74.8 / AC-74.9: a Task ID of another project is a row error; matching survives renumbering', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const other = await w.pm.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send({
        name: 'Other P',
        projectTypeId: (await ProjectModel.findById(pid).lean())!.projectTypeId!.toString(),
        clientId: w.acme.client.id,
        managerId: w.pm.user._id.toString(),
        startDate: '2026-10-12',
        plannedEndDate: '2026-12-18',
        templateId: w.template.id,
      });
    expect(other.status).toBe(201);
    const otherTask = (await tl(w.pm.agent, other.body.project.id)).tasks[0]!;
    const t = await tl(w.pm.agent, pid);
    const file = await exported(w.pm.agent, pid);
    // CR-20: deleting task #1 renumbers the others (#2 → #1, #3 → #2).
    await TaskModel.updateOne({ _id: t.tasks[1]!.id }, { $set: { dependsOn: [] } });
    const del = await w.pm.agent.delete(`/api/v1/tasks/${t.tasks[0]!.id}`).set(CSRF);
    expect(del.status, JSON.stringify(del.body)).toBe(204);
    const renamed = await edit(file, (ws) => {
      ws.getRow(3).getCell(col('dependsOn')).value = null;
      ws.getRow(4).getCell(col('name')).value = 'Renamed third';
    });
    let p = await preview(w.pm.agent, pid, renamed);
    expect(p.rows[0]!.errors[0]!.message).toBe(
      `Task ID ${t.tasks[0]!.id} isn't a task in this project.`,
    );
    const foreign = await edit(renamed, (ws) => {
      ws.spliceRows(2, 1);
      ws.getRow(4).values = [9, 'Foreign', '', '', '', '', '', '', '', '', otherTask.id];
    });
    p = await preview(w.pm.agent, pid, foreign);
    expect(p.rows.find((r) => r.values.name === 'Foreign')!.errors[0]!.message).toBe(
      `Task ID ${otherTask.id} isn't a task in this project.`,
    );
    const ok = await edit(renamed, (ws) => ws.spliceRows(2, 1));
    const { done } = await commit(w.pm.agent, pid, ok);
    expect(done.updated).toBe(1);
    const after = await tl(w.pm.agent, pid);
    expect(after.tasks.map((x) => x.name)).toEqual([t.tasks[1]!.name, 'Renamed third']);
  });
});

describe('CR-22 B3: changed since export, phases, status (FR-TL-20, 25; Q-141)', () => {
  it('AC-74.7: a task edited after export is flagged and saved only when confirmed', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('finish')).value = new Date('2026-12-15T00:00:00Z');
    });
    const t = await tl(w.pm.agent, pid);
    const current = (await w.pm.agent.get(`/api/v1/tasks/${t.tasks[0]!.id}`)).body.task;
    const patch = await w.pm.agent
      .patch(`/api/v1/tasks/${t.tasks[0]!.id}`)
      .set(CSRF)
      .send({ version: current.version, ownerId: w.member.user._id.toString() });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    let p = await preview(w.pm.agent, pid, file);
    const row = p.rows[0]!;
    expect(row.result).toBe('CHANGED');
    expect(row.changedSince).toMatch(
      new RegExp(`^Changed in OpsTrack after export: Owner set to ${w.member.user.email} by `),
    );
    // Not confirmed: left as it is.
    let res = await send(w.pm.agent, pid, 'commit', file, { token: p.token });
    expect(res.body).toMatchObject({ updated: 0, leftUnconfirmed: 1 });
    expect((await tl(w.pm.agent, pid)).tasks[0]!.owner?.id).toBe(w.member.user._id.toString());
    // Confirmed: the file wins (Owner back to blank, Finish moved).
    p = await preview(w.pm.agent, pid, file);
    res = await send(w.pm.agent, pid, 'commit', file, { token: p.token, confirm: [2] });
    expect(res.body).toMatchObject({ updated: 1, leftUnconfirmed: 0 });
    const after = (await tl(w.pm.agent, pid)).tasks[0]!;
    expect(after).toMatchObject({ dueDate: '2026-12-15', owner: null });
  });

  it('a preview goes stale when the project changes before the commit (409 PREVIEW_STALE)', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('name')).value = 'Kickoff (renamed)';
    });
    const p = await preview(w.pm.agent, pid, file);
    await TaskModel.updateOne({ projectId: pid, order: 2 }, { $inc: { version: 1 } });
    const res = await send(w.pm.agent, pid, 'commit', file, { token: p.token });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PREVIEW_STALE');
    expect(await TaskModel.countDocuments({ projectId: pid, name: 'Kickoff (renamed)' })).toBe(0);
  });

  it('Q-141: a new phase is added at the end in Planning (PM) or by an Admin; else a row error', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(5).values = [4, 'Hypercare', 'Support', 'N', '2026-12-10', '2026-12-17'];
    });
    await ProjectModel.updateOne({ _id: pid }, { $set: { status: 'ACTIVE' } });
    const pmActive = await preview(w.pm.agent, pid, file);
    expect(pmActive.rows[3]!.errors[0]!.message).toBe(
      "You can't add phase Support while the project is Active.",
    );
    const admin = await preview(w.admin.agent, pid, file);
    expect(admin.newPhases).toEqual(['Support']);
    await ProjectModel.updateOne({ _id: pid }, { $set: { status: 'PLANNING' } });
    const { preview: p, done } = await commit(w.pm.agent, pid, file);
    expect(p.newPhases).toEqual(['Support']);
    expect(done.newPhases).toEqual(['Support']);
    const after = await tl(w.pm.agent, pid);
    expect(after.phases.map((ph) => ph.name)).toEqual(['Phase A', 'Phase B', 'Support']);
    expect(after.tasks[3]!.phaseId).toBe(after.phases[2]!.id);
    expect(
      await FolderModel.countDocuments({ projectId: pid, kind: 'PHASE', phase: 'Support' }),
    ).toBe(1);
    expect(
      await ActivityLogModel.countDocuments({
        projectId: pid,
        action: 'phase_created',
        'meta.via': 'timeline_import',
      }),
    ).toBe(1);
  });

  it('Q-141: import is refused for Completed, Cancelled and archived projects', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const file = await exported(w.pm.agent, pid);
    await ProjectModel.updateOne({ _id: pid }, { $set: { status: 'COMPLETED' } });
    let res = await send(w.pm.agent, pid, 'preview', file);
    expect([res.status, res.body.error.code]).toEqual([422, 'PROJECT_COMPLETED']);
    // A planner can still download a completed project's timeline.
    expect((await fileOf(w.pm.agent, `${base(pid)}/export`)).status).toBe(200);
    await ProjectModel.updateOne({ _id: pid }, { $set: { status: 'CANCELLED' } });
    res = await send(w.pm.agent, pid, 'preview', file);
    expect([res.status, res.body.error.code]).toEqual([422, 'PROJECT_NOT_IMPORTABLE']);
    await ProjectModel.updateOne({ _id: pid }, { $set: { status: 'ACTIVE', archived: true } });
    res = await send(w.pm.agent, pid, 'preview', file);
    expect([res.status, res.body.error.code]).toEqual([409, 'PROJECT_ARCHIVED']);
  });
});

describe("CR-22 B3: Lead's slice-3 rulings (Q20 notices, phase targets)", () => {
  const assignedTo = (userId: unknown, pid: string) =>
    NotificationModel.find({ userId, projectId: pid, type: 'ASSIGNED' }).lean();

  it('Q20: each new owner gets ONE assignment notice per import listing their tasks; never the importer', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const member = w.member.user.email;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('owner')).value = member; // owner change
      ws.getRow(3).getCell(col('owner')).value = member; // owner change
      ws.getRow(5).values = [4, 'Go-live', 'Phase B', 'Y', '2026-12-04', '2026-12-04', '', member];
      ws.getRow(6).values = [
        5,
        'Own task',
        'Phase B',
        'N',
        '2026-12-07',
        '2026-12-08',
        '',
        w.pm.user.email,
      ];
    });
    const { done } = await commit(w.pm.agent, pid, file);
    expect(done.created).toEqual([4, 5]);

    const notes = await assignedTo(w.member.user._id, pid);
    expect(notes).toHaveLength(1);
    const ids = (await TaskModel.find({ projectId: pid, order: { $in: [1, 2, 4] } }).lean())
      .map((t) => t._id.toString())
      .sort();
    expect(notes[0]!.taskIds!.map(String).sort()).toEqual(ids);
    expect(notes[0]).toMatchObject({ taskId: null, link: `/projects/${pid}/timeline` });
    expect(String(notes[0]!.actorId)).toBe(w.pm.user._id.toString());
    // The importer made themself owner of task 5: no notice (notify() never tells the actor).
    expect(await assignedTo(w.pm.user._id, pid)).toHaveLength(0);

    // The member's bell lists the tasks in the usual "assigned you to" notice.
    const bell = await w.member.agent.get('/api/v1/notifications');
    const item = bell.body.items.find((n: { type: string }) => n.type === 'ASSIGNED');
    expect(item.task).toBeNull();
    expect(item.tasks.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining(['Go-live']),
    );
    expect(item.tasks).toHaveLength(3);

    // Re-importing with the same owners (other edits only) tells nobody again.
    const again = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('finish')).value = new Date('2026-12-02T00:00:00Z');
    });
    expect((await commit(w.pm.agent, pid, again)).done.updated).toBe(1);
    expect(await assignedTo(w.member.user._id, pid)).toHaveLength(1);
  });

  it('Q20: one task reads exactly like a normal assignment notice (task set, no list)', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(3).getCell(col('owner')).value = w.member.user.email;
    });
    await commit(w.admin.agent, pid, file);
    const notes = await assignedTo(w.member.user._id, pid);
    expect(notes).toHaveLength(1);
    const t2 = await TaskModel.findOne({ projectId: pid, order: 2 }).lean();
    expect(String(notes[0]!.taskId)).toBe(t2!._id.toString());
    expect(notes[0]!.taskIds ?? []).toHaveLength(0);
    expect(notes[0]!.link).toBeNull();
    expect(String(notes[0]!.actorId)).toBe(w.admin.user._id.toString());
  });

  it('phase target dates are not importable: an import leaves every phase target as it was', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const before = await tl(w.pm.agent, pid);
    const saved = await w.pm.agent
      .put(`/api/v1/projects/${pid}/phase-list`)
      .set(CSRF)
      .send({
        phases: before.phases.map((ph, i) => ({
          id: ph.id,
          originalName: ph.id ? null : ph.name,
          name: ph.name,
          targetDate: `2026-11-2${i}`,
        })),
      });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const targets = (await tl(w.pm.agent, pid)).phases.map((ph) => [ph.name, ph.targetDate]);
    expect(targets.every(([, d]) => d)).toBe(true);
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('phase')).value = 'Phase B'; // move a task between phases
      ws.getRow(3).getCell(col('finish')).value = new Date('2026-12-30T00:00:00Z');
      ws.getRow(5).values = [4, 'Hypercare', 'Support', 'N', '2026-12-10', '2026-12-17'];
    });
    await commit(w.admin.agent, pid, file);
    const after = (await tl(w.pm.agent, pid)).phases.map((ph) => [ph.name, ph.targetDate]);
    expect(after).toEqual([...targets, ['Support', null]]);
  });
});

describe('CR-22 B3: Q24 copy (UIE §5.1, §5.2) and NFR-52 limits (5 MB, 2,000 rows)', () => {
  const fileError = async (agent: Agent, pid: string, buf: Buffer) => {
    const res = await send(agent, pid, 'preview', buf);
    return [res.status, res.body.error?.code, res.body.error?.message];
  };

  it('empty file, no Timeline sheet and an unreadable file, word for word', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const blank = (await fileOf(w.pm.agent, `${base(pid)}/template`)).body as Buffer;
    expect(await fileError(w.pm.agent, pid, blank)).toEqual([
      422,
      'EMPTY_FILE',
      'This file has no tasks. Add at least one row under the headers on the Timeline sheet and try again. Nothing was imported.',
    ]);
    const renamed = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.name = 'Plan';
    });
    expect(await fileError(w.pm.agent, pid, renamed)).toEqual([
      422,
      'NO_TIMELINE_SHEET',
      'This file has no Timeline sheet. Use the OpsTrack template or a downloaded timeline, and keep the sheet name Timeline. Nothing was imported.',
    ]);
    // A zip header with nothing readable behind it (a damaged workbook).
    const damaged = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(2048, 7)]);
    const [status, code, message] = await fileError(w.pm.agent, pid, damaged);
    expect([status, code]).toEqual([422, 'UNREADABLE_FILE']);
    expect(message).toBe(
      "We couldn't open this file. It may be damaged or password-protected. Open it in Excel, save it again as Excel Workbook (.xlsx), then try again. Nothing was imported.",
    );
  });

  it('more than 2,000 rows is refused with the row count; exactly 2,000 is fine', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const blank = (await fileOf(w.pm.agent, `${base(pid)}/template`)).body as Buffer;
    const rows = (n: number) =>
      edit(blank, (ws) => {
        for (let i = 0; i < n; i++) ws.getRow(i + 2).values = [i + 1, `Task ${i + 1}`];
      });
    expect(await fileError(w.pm.agent, pid, await rows(2001))).toEqual([
      422,
      'TOO_MANY_ROWS',
      'This file has 2,001 rows. You can import up to 2,000 at a time. Split it into smaller files and import them one by one. Nothing was imported.',
    ]);
    const ok = await send(w.pm.agent, pid, 'preview', await rows(2000));
    expect(ok.status, JSON.stringify(ok.body.error)).toBe(200);
    expect(ok.body.counts.total).toBe(2000);
  });

  it('over 5 MB is refused with its size, inside and beyond the upload buffer', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const just = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(5 * 1024 * 1024)]);
    expect(await fileError(w.pm.agent, pid, just)).toEqual([
      413,
      'FILE_TOO_LARGE',
      'This file is 5.1 MB. The limit is 5 MB. Remove extra sheets or images and try again. Nothing was imported.',
    ]);
    const big = Buffer.alloc(7 * 1024 * 1024, 1);
    expect(await fileError(w.pm.agent, pid, big)).toEqual([
      413,
      'FILE_TOO_LARGE',
      'This file is 7 MB. The limit is 5 MB. Remove extra sheets or images and try again. Nothing was imported.',
    ]);
  });

  it('row errors: name, phase and Depends on length limits', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('name')).value = 'n'.repeat(201);
      ws.getRow(3).getCell(col('phase')).value = 'p'.repeat(121);
      ws.getRow(4).getCell(col('dependsOn')).value = Array(200).fill('1').join(', ');
    });
    const p = await preview(w.admin.agent, pid, file);
    const msgs = (row: number) => p.rows.find((r) => r.row === row)!.errors.map((e) => e.message);
    expect(msgs(2)).toEqual(['Task name can be up to 200 characters (this one has 201).']);
    expect(msgs(3)).toEqual(['Phase can be up to 120 characters.']);
    expect(msgs(4)).toEqual(['Depends on is too long. Use task numbers only, e.g. 3, 5.']);
  });

  it("UIE's re-saved sample (blank project and Task IDs, 7dc7dc2) imports as 19 new tasks", async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const people = await Promise.all(
      ['pm', 'ba', 'member', 'dev1', 'dev2', 'qa'].map((n) =>
        createUser({ email: `${n}@xceler8.example` }),
      ),
    );
    await ProjectModel.updateOne(
      { _id: pid },
      { $addToSet: { memberIds: { $each: people.map((u) => u._id) } } },
    );
    const sample = readFileSync(
      new URL('./fixtures/cr22-timeline-template-sample.xlsx', import.meta.url),
    );
    const { preview: p, done } = await commit(w.pm.agent, pid, sample);
    expect(p.exported).toBeNull();
    expect(p.counts).toMatchObject({ total: 19, new: 19, error: 0 });
    expect(p.newPhases).toEqual(['Initiation', 'Design', 'Build and test', 'Go-live']);
    expect(done.created).toEqual(Array.from({ length: 19 }, (_, i) => i + 4));
    const tasks = await TaskModel.find({ projectId: pid, order: { $gte: 4 } })
      .sort({ order: 1 })
      .lean();
    expect(tasks).toHaveLength(19);
    expect(tasks[0]!.name).toBe('Project kickoff');
    // "Data cutover" (sample 17) depends on sample 14, 15, 16 and 19 → #17, #18, #19, #22.
    const byOrder = new Map(tasks.map((t) => [t.order, t._id.toString()]));
    const cutover = tasks.find((t) => t.name === 'Data cutover')!;
    expect(cutover.dependsOn.map(String).sort()).toEqual(
      [17, 18, 19, 22].map((n) => byOrder.get(n)).sort(),
    );
  });
});

describe('CR-22 B3: UIE review of 6cc0f3e', () => {
  it('columns are compared by name: a deleted column is the only one listed', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.spliceColumns(col('milestone'), 1);
    });
    const res = await send(w.pm.agent, pid, 'preview', file);
    expect([res.status, res.body.error.code]).toEqual([422, 'COLUMNS']);
    expect(res.body.error.message).toBe(
      'Some columns are missing or out of order: Milestone. Keep row 1 of the template as it is, then try again. Nothing was imported.',
    );
  });

  it('one dependency cycle counts as one error; clears read Owner, then Depends on', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    await TaskModel.updateMany({ projectId: pid }, { $set: { ownerId: w.member.user._id } });
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('dependsOn')).value = '3'; // 1 → 3 → 2 → 1
    });
    const p = await preview(w.pm.agent, pid, file);
    const cycleRows = p.rows.filter((r) =>
      r.errors.some((e) => e.message.startsWith('Depends on: circular dependency')),
    );
    expect(cycleRows.length).toBeGreaterThan(1);
    expect(p.counts.errorMessages).toBe(1);

    const clears = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(3).getCell(col('owner')).value = null;
      ws.getRow(3).getCell(col('dependsOn')).value = null;
    });
    const c = await preview(w.pm.agent, pid, clears);
    expect(c.rows[1]!.clears).toEqual(['owner', 'dependsOn']);
  });
});
