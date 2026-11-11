import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_IMPORT_TOKEN_HEADER,
  DELIVERABLE_MAX_ITEMS,
  TIMELINE_COLUMNS,
  XLSX_MIME,
  type TaskDto,
  type TimelineDto,
  type TimelineImportCommitDto,
  type TimelineImportPreviewDto,
} from '@xc8/shared';
import { Types } from 'mongoose';
import {
  ActivityLogModel,
  NotificationModel,
  ProjectModel,
  TaskModel,
  TemplateModel,
  UserModel,
} from '../src/models/index.js';
import {
  migrateAllDeliverables,
  restoreLegacyDeliverables,
} from '../scripts/lib/migrateDeliverables.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { resetRules, seedLegacyDeliverable, world } from './m2helpers.js';

/** CR-23: Checklist Excel import (FR-CLX-*) and deliverable checklists (FR-DLV-*), Q-151, Q-168. */
useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

const base = (pid: string) => `/api/v1/projects/${pid}/checklist`;
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
  const q = new URLSearchParams({ fileName: 'cl.xlsx' });
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
async function edit(buf: Buffer, fn: (ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void) {
  const wb = await load(buf);
  fn(wb.getWorksheet('Checklist')!, wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const tl = async (agent: Agent, pid: string) =>
  (await agent.get(`/api/v1/projects/${pid}/timeline`)).body as TimelineDto;
const getTask = async (agent: Agent, id: string) =>
  (await agent.get(`/api/v1/tasks/${id}`)).body.task as TaskDto;
const items = (t: TaskDto) => t.deliverableItems.map((i) => [i.text, i.done]);

/** The project's first task, owned by the member. */
async function ownedTask(w: W) {
  const pid = w.project.id as string;
  const first = (await tl(w.pm.agent, pid)).tasks[0]!;
  await TaskModel.updateOne({ _id: first.id }, { $set: { ownerId: w.member.user._id } });
  return getTask(w.pm.agent, first.id);
}
const add = (agent: Agent, t: { id: string; version: number }, text: string) =>
  agent
    .post(`/api/v1/tasks/${t.id}/deliverable-items`)
    .set(CSRF)
    .send({ text, version: t.version });

describe('CR-23: deliverable items on a task (FR-DLV-01 to 09)', () => {
  it('owner, project PM and Admin add, tick, edit, reorder, remove and restore; each change is audited', async () => {
    const w = await world(app);
    let t = await ownedTask(w);
    const start = t.deliverableItems.length;
    expect(t.can.deliverables).toBe(true);

    let res = await add(w.member.agent, t, '  Signed UAT form ');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    t = res.body.task;
    expect(t.deliverableItems.at(-1)).toMatchObject({ text: 'Signed UAT form', done: false });
    res = await add(w.pm.agent, t, 'Test report');
    t = res.body.task;
    res = await add(w.admin.agent, t, 'Sign-off');
    t = res.body.task;
    expect(t.deliverableItems).toHaveLength(start + 3);

    // Tick every item: the task status doesn't change (FR-DLV-06).
    const status = t.status;
    for (const it of t.deliverableItems) {
      res = await w.member.agent
        .patch(`/api/v1/tasks/${t.id}/deliverable-items/${it.id}`)
        .set(CSRF)
        .send({ done: true, version: t.version });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      t = res.body.task;
    }
    expect(t.deliverableItems.every((i) => i.done)).toBe(true);
    expect(t.deliverableItems[0]!.doneBy?.id).toBe(w.member.user._id.toString());
    expect(t.status).toBe(status);

    // Inline edit and untick in one call.
    const target = t.deliverableItems.at(-1)!;
    res = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}/deliverable-items/${target.id}`)
      .set(CSRF)
      .send({ text: 'Customer sign-off', done: false, version: t.version });
    t = res.body.task;
    expect(t.deliverableItems.at(-1)).toMatchObject({
      text: 'Customer sign-off',
      done: false,
      doneBy: null,
    });

    // Reorder: last item first.
    const ids = t.deliverableItems.map((i) => i.id);
    const order = [ids.at(-1)!, ...ids.slice(0, -1)];
    res = await w.pm.agent
      .post(`/api/v1/tasks/${t.id}/deliverable-items/reorder`)
      .set(CSRF)
      .send({ itemIds: order, version: t.version });
    expect(res.status).toBe(200);
    t = res.body.task;
    expect(t.deliverableItems.map((i) => i.id)).toEqual(order);

    // Remove, then Undo puts it back in place with its tick state.
    const gone = t.deliverableItems[1]!;
    res = await w.member.agent
      .delete(`/api/v1/tasks/${t.id}/deliverable-items/${gone.id}?version=${t.version}`)
      .set(CSRF);
    expect(res.status).toBe(200);
    t = res.body.task;
    expect(t.deliverableItems.map((i) => i.id)).not.toContain(gone.id);
    res = await w.member.agent
      .post(`/api/v1/tasks/${t.id}/deliverable-items/${gone.id}/restore`)
      .set(CSRF)
      .send({ version: t.version });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    t = res.body.task;
    expect(t.deliverableItems[1]).toMatchObject({ id: gone.id, text: gone.text, done: gone.done });

    const actions = (
      await ActivityLogModel.find({ entityType: 'task', entityId: t.id }).sort({ at: 1 }).lean()
    ).map((l) => l.action);
    expect(actions.filter((a) => a === 'deliverable_item_added')).toHaveLength(4); // 3 + restore
    expect(actions.filter((a) => a === 'deliverable_item_ticked')).toHaveLength(start + 3);
    expect(actions).toEqual(
      expect.arrayContaining([
        'deliverable_item_updated',
        'deliverable_item_unticked',
        'deliverable_items_reordered',
        'deliverable_item_deleted',
      ]),
    );
  });

  it('others are read-only: a team member who is not the owner, a Viewer; enforced by the API', async () => {
    const w = await world(app);
    const t = await ownedTask(w);
    // The PM's second task has no owner; the member is on the team but not its owner.
    const other = (await tl(w.pm.agent, w.project.id)).tasks[1]!;
    await TaskModel.updateOne({ _id: other.id }, { $set: { ownerId: null } });
    const o = await getTask(w.member.agent, other.id);
    expect(o.can.deliverables).toBe(false);
    let res = await add(w.member.agent, o, 'Nope');
    expect([res.status, res.body.error.code]).toEqual([403, 'DELIVERABLES_READ_ONLY']);
    res = await add(w.viewer.agent, t, 'Nope');
    expect([403, 404]).toContain(res.status);
    // A PM of another project doesn't see it.
    res = await add(w.pm2.agent, t, 'Nope');
    expect(res.status).toBe(404);
  });

  it('limits: 50 items, 200 characters for new or edited text; migrated long text is kept', async () => {
    const w = await world(app);
    let t = await ownedTask(w);
    let res = await add(w.pm.agent, t, 'x'.repeat(201));
    expect([res.status, res.body.error.code]).toEqual([422, 'DELIVERABLE_TOO_LONG']);
    expect(res.body.error.message).toBe(
      'A deliverable can be up to 200 characters (this one has 201).',
    );
    expect((await add(w.pm.agent, t, 'x'.repeat(200))).status).toBe(201);

    const long = 'L'.repeat(300);
    const filler = Array.from({ length: DELIVERABLE_MAX_ITEMS - 1 }, (_, n) => ({
      _id: new Types.ObjectId(),
      text: `Item ${n + 2}`,
      order: n + 2,
    }));
    await TaskModel.updateOne(
      { _id: t.id },
      {
        $set: {
          deliverableItems: [{ _id: new Types.ObjectId(), text: long, order: 1 }, ...filler],
        },
      },
    );
    t = await getTask(w.pm.agent, t.id);
    expect(t.deliverableItems).toHaveLength(DELIVERABLE_MAX_ITEMS);
    res = await add(w.pm.agent, t, 'One more');
    expect([res.status, res.body.error.code]).toEqual([422, 'DELIVERABLE_LIMIT']);
    // Ticking the long migrated item is fine; editing it must bring it under 200.
    res = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}/deliverable-items/${t.deliverableItems[0]!.id}`)
      .set(CSRF)
      .send({ done: true, version: t.version });
    expect(res.status).toBe(200);
    t = res.body.task;
    expect(t.deliverableItems[0]!.text).toBe(long);
    res = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}/deliverable-items/${t.deliverableItems[0]!.id}`)
      .set(CSRF)
      .send({ text: `${long}!`, version: t.version });
    expect(res.status).toBe(422);
  });

  it('a stale version is a 409; Completed, Cancelled and archived projects are read-only', async () => {
    const w = await world(app);
    const t = await ownedTask(w);
    let res = await add(w.pm.agent, { id: t.id, version: t.version + 5 }, 'Stale');
    expect([res.status, res.body.error.code]).toEqual([409, 'VERSION_CONFLICT']);
    for (const [set, code, status] of [
      [{ status: 'COMPLETED' }, 'PROJECT_COMPLETED', 422],
      [{ status: 'CANCELLED' }, 'PROJECT_CANCELLED', 422],
      [{ status: 'ACTIVE', archived: true }, 'PROJECT_ARCHIVED', 409],
    ] as const) {
      await ProjectModel.updateOne({ _id: w.project.id }, { $set: set });
      res = await add(w.admin.agent, t, 'Locked');
      expect([res.status, res.body.error.code]).toEqual([status, code]);
      expect((await getTask(w.admin.agent, t.id)).can.deliverables).toBe(false);
    }
  });

  it('the old deliverable text field is refused with a clear message', async () => {
    const w = await world(app);
    const t = await ownedTask(w);
    const res = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ deliverable: 'Old', version: t.version });
    expect([res.status, res.body.error.code]).toEqual([422, 'DELIVERABLE_FIELD_REMOVED']);
  });

  it('a project generated from a template copies the activity items, unticked', async () => {
    const w = await world(app);
    const tasks = await TaskModel.find({ projectId: w.project.id }).lean();
    const withItems = tasks.filter((t) => (t.deliverableItems ?? []).length);
    expect(withItems.length).toBeGreaterThan(0);
    expect(withItems.flatMap((t) => t.deliverableItems!).every((i) => !i.done)).toBe(true);
  });
});

describe('CR-23: deliverables in the Checklist Excel file (FR-CLX-04, 10 to 13)', () => {
  it('export writes one item per line with [x] for done; the file is the Checklist sheet', async () => {
    const w = await world(app);
    let t = await ownedTask(w);
    await TaskModel.updateOne({ _id: t.id }, { $set: { deliverableItems: [] } });
    t = await getTask(w.pm.agent, t.id);
    t = (await add(w.pm.agent, t, 'Form')).body.task;
    t = (await add(w.pm.agent, t, 'Report')).body.task;
    await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}/deliverable-items/${t.deliverableItems[0]!.id}`)
      .set(CSRF)
      .send({ done: true, version: t.version });
    const wb = await load(await exported(w.pm.agent, w.project.id));
    const ws = wb.getWorksheet('Checklist')!;
    expect(ws.getRow(1).getCell(col('deliverables')).value).toBe('Deliverables');
    expect(ws.getRow(2).getCell(col('deliverables')).value).toBe('[x] Form\nReport');
  });

  it('re-upload replaces the list: added, ticked, unticked and removed are previewed and saved', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    let t = await ownedTask(w);
    await TaskModel.updateOne({ _id: t.id }, { $set: { deliverableItems: [] } });
    t = await getTask(w.pm.agent, t.id);
    for (const x of ['A', 'B', 'C']) t = (await add(w.pm.agent, t, x)).body.task;
    t = (
      await w.pm.agent
        .patch(`/api/v1/tasks/${t.id}/deliverable-items/${t.deliverableItems[2]!.id}`)
        .set(CSRF)
        .send({ done: true, version: t.version })
    ).body.task;
    const keptId = t.deliverableItems[0]!.id;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      // A stays, B is removed, C is unticked, D is new and done.
      ws.getRow(2).getCell(col('deliverables')).value = 'A\nC\n[x] D';
    });
    const p = await preview(w.pm.agent, pid, file);
    const row = p.rows[0]!;
    expect(row.deliverables).toMatchObject({ added: 1, removed: 1, ticked: 0, unticked: 1 });
    expect(row.deliverables!.lines.map((l) => [l.kind, l.text])).toEqual([
      ['same', 'A'],
      ['unticked', 'C'],
      ['added', 'D'],
      ['removed', 'B'],
    ]);
    expect(p.counts.losesDeliverables).toBe(1);
    const { done } = await commit(w.pm.agent, pid, file);
    expect(done.deliverables).toEqual({ added: 1, removed: 1, ticked: 0, unticked: 1 });
    t = await getTask(w.pm.agent, t.id);
    expect(items(t)).toEqual([
      ['A', false],
      ['C', false],
      ['D', true],
    ]);
    // A kept its id; D was ticked by the import (no person).
    expect(t.deliverableItems[0]!.id).toBe(keptId);
    expect(t.deliverableItems[2]).toMatchObject({ doneBy: null, doneFromImport: true });
    // The import's one task_updated entry carries the item changes and their totals.
    const log = await ActivityLogModel.findOne({
      entityId: t.id,
      action: 'task_updated',
      'meta.via': 'checklist_import',
    }).lean();
    expect(log!.changes.map((c) => c.field)).toContain('deliverableItems');
    expect(log!.meta).toMatchObject({
      deliverables: { added: 1, removed: 1, ticked: 0, unticked: 1 },
    });
  });

  it('a blank cell clears the items; a too-long line and over 50 items are row errors', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    let t = await ownedTask(w);
    t = (await add(w.pm.agent, t, 'Keep me?')).body.task;
    const base0 = await exported(w.pm.agent, pid);
    const bad = await edit(base0, (ws) => {
      ws.getRow(2).getCell(col('deliverables')).value = `ok\n${'y'.repeat(201)}`;
      ws.getRow(3).getCell(col('deliverables')).value = Array.from(
        { length: 51 },
        (_, i) => `i${i}`,
      ).join('\n');
    });
    const p = await preview(w.pm.agent, pid, bad);
    expect(p.rows[0]!.errors.map((e) => e.message)).toContain(
      'Deliverables: line 2 is longer than 200 characters (it has 201).',
    );
    expect(p.rows[1]!.errors.map((e) => e.message)).toContain(
      'Deliverables: this task would have 51 items. The most is 50.',
    );
    const blank = await edit(base0, (ws) => {
      ws.getRow(2).getCell(col('deliverables')).value = null;
    });
    await commit(w.pm.agent, pid, blank);
    expect((await getTask(w.pm.agent, t.id)).deliverableItems).toEqual([]);
  });

  it('changed since export covers deliverables: an item ticked after export is flagged', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    let t = await ownedTask(w);
    t = (await add(w.pm.agent, t, 'Z')).body.task;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('deliverables')).value = 'Z\nNew';
    });
    t = (
      await w.member.agent
        .patch(`/api/v1/tasks/${t.id}/deliverable-items/${t.deliverableItems.at(-1)!.id}`)
        .set(CSRF)
        .send({ done: true, version: t.version })
    ).body.task;
    const p = await preview(w.pm.agent, pid, file);
    expect(p.counts.changed).toBe(1);
    const { done } = await commit(w.pm.agent, pid, file);
    expect(done.leftUnconfirmed).toBe(1);
    expect(items(await getTask(w.pm.agent, t.id)).at(-1)).toEqual(['Z', true]);
  });

  it('an older Timeline-sheet file still imports and leaves deliverables alone', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    let t = await ownedTask(w);
    t = (await add(w.pm.agent, t, 'Untouched')).body.task;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.name = 'Timeline';
      ws.spliceColumns(col('deliverables'), 1);
      ws.getRow(2).getCell(col('name')).value = 'Renamed';
    });
    const p = await preview(w.pm.agent, pid, file);
    expect(p.noDeliverablesColumn).toBe(true);
    await commit(w.pm.agent, pid, file);
    const after = await getTask(w.pm.agent, t.id);
    expect(after.name).toBe('Renamed');
    expect(after.deliverableItems.map((i) => i.text)).toEqual(
      t.deliverableItems.map((i) => i.text),
    );
  });

  it('import is disabled on Completed, Cancelled and archived projects; download still works', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const file = await exported(w.pm.agent, pid);
    for (const set of [
      { status: 'COMPLETED' },
      { status: 'CANCELLED' },
      { status: 'ACTIVE', archived: true },
    ]) {
      await ProjectModel.updateOne({ _id: pid }, { $set: set });
      expect((await send(w.pm.agent, pid, 'preview', file)).status).not.toBe(200);
      expect((await fileOf(w.pm.agent, `${base(pid)}/export`)).status).toBe(200);
      expect((await fileOf(w.pm.agent, `${base(pid)}/template`)).status).toBe(200);
      const can = (await w.pm.agent.get(`/api/v1/projects/${pid}`)).body.project.can;
      expect([can.checklistExcel, can.checklistImport]).toEqual([true, false]);
    }
  });
});

describe('CR-23 Q-151: owners named in the file', () => {
  it('an active user not on the team is added, listed in the preview, audited and told once', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const email = w.outsider.user.email;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('owner')).value = email;
      ws.getRow(3).getCell(col('owner')).value = email.toUpperCase();
    });
    const { preview: p, done } = await commit(w.pm.agent, pid, file);
    expect(p.addMembers).toEqual([email]);
    expect(done.addedMembers).toBe(1);
    const project = await ProjectModel.findById(pid).lean();
    expect(project!.memberIds.map(String)).toContain(w.outsider.user._id.toString());
    expect(
      await ActivityLogModel.countDocuments({
        projectId: pid,
        action: 'project_member_added',
        'meta.via': 'checklist_import',
      }),
    ).toBe(1);
    const ts = (await tl(w.pm.agent, pid)).tasks;
    expect(ts.slice(0, 2).map((t) => t.owner?.id ?? null)).toEqual([
      w.outsider.user._id.toString(),
      w.outsider.user._id.toString(),
    ]);
    const notes = await NotificationModel.find({
      userId: w.outsider.user._id,
      projectId: pid,
    }).lean();
    expect(notes.filter((n) => n.type === 'ADDED_TO_PROJECT')).toHaveLength(1);
    expect(notes.filter((n) => n.type === 'ASSIGNED')).toHaveLength(1);
  });

  it('an unknown or deactivated email imports the row without an owner, with a note', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    await UserModel.updateOne({ _id: w.outsider.user._id }, { $set: { active: false } });
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('owner')).value = 'ghost@xceler8.example';
      ws.getRow(3).getCell(col('owner')).value = w.outsider.user.email;
    });
    const p = await preview(w.pm.agent, pid, file);
    expect(p.rows[0]!.errors).toEqual([]);
    expect(p.rows[0]!.warnings.map((x) => x.message)).toContain(
      "Email ghost@xceler8.example doesn't exist.",
    );
    expect(p.rows[1]!.warnings.map((x) => x.message)).toContain(
      `Email ${w.outsider.user.email} doesn't exist.`,
    );
    expect(p.addMembers).toEqual([]);
    await commit(w.pm.agent, pid, file);
    const ts = (await tl(w.pm.agent, pid)).tasks;
    expect([ts[0]!.owner, ts[1]!.owner]).toEqual([null, null]);
  });

  it('Lean: a Viewer named as owner is not added and the row imports ownerless with "can\'t own tasks"', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const viewer = w.viewer.user.email;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('owner')).value = viewer;
    });
    const p = await preview(w.pm.agent, pid, file);
    expect(p.rows[0]!.errors).toEqual([]);
    expect(p.rows[0]!.warnings.map((x) => x.message)).toContain(`${viewer} can't own tasks.`);
    expect(p.addMembers).toEqual([]);
    const { done } = await commit(w.pm.agent, pid, file);
    expect(done.addedMembers).toBe(0);
    const project = await ProjectModel.findById(pid).lean();
    expect(project!.memberIds.map(String)).not.toContain(w.viewer.user._id.toString());
    expect((await tl(w.pm.agent, pid)).tasks[0]!.owner).toBeNull();
    expect(
      await NotificationModel.countDocuments({ userId: w.viewer.user._id, projectId: pid }),
    ).toBe(0);
  });

  it('Lean: a Viewer already on the team named as owner also imports ownerless with the note', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    await ProjectModel.updateOne({ _id: pid }, { $addToSet: { memberIds: w.viewer.user._id } });
    const viewer = w.viewer.user.email;
    const file = await edit(await exported(w.pm.agent, pid), (ws) => {
      ws.getRow(2).getCell(col('owner')).value = viewer;
    });
    const p = await preview(w.pm.agent, pid, file);
    expect(p.rows[0]!.errors).toEqual([]);
    expect(p.rows[0]!.warnings.map((x) => x.message)).toContain(`${viewer} can't own tasks.`);
    await commit(w.pm.agent, pid, file);
    expect((await tl(w.pm.agent, pid)).tasks[0]!.owner).toBeNull();
    expect(
      await NotificationModel.countDocuments({
        userId: w.viewer.user._id,
        projectId: pid,
        type: 'ASSIGNED',
      }),
    ).toBe(0);
  });
});

describe('CR-23 FR-DLV-04: migrating the old Deliverable text (Lean: old field kept)', () => {
  it('dry run writes nothing; apply copies the text into a first unticked item, keeps the old field (text and empty), re-run changes nothing', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const [a, b] = await TaskModel.find({ projectId: pid }).sort({ order: 1 }).limit(2).lean();
    const long = 'Q'.repeat(450);
    await seedLegacyDeliverable({ taskId: a!._id.toString() }, `  ${long} `);
    await TaskModel.collection.updateOne(
      { _id: b!._id },
      { $set: { deliverable: '', deliverableItems: [] } },
    );
    await seedLegacyDeliverable({ templateId: w.template.id, activity: 0 }, 'Workshop minutes');
    const raw = async (id: Types.ObjectId) => (await TaskModel.collection.findOne({ _id: id }))!;
    const vA = (await raw(a!._id)).version;

    const dry = await migrateAllDeliverables({ apply: false });
    expect(dry.tasks.map((t) => t.text)).toEqual([long]);
    expect(dry.templates[0]!.activities).toEqual([
      { id: expect.any(String), text: 'Workshop minutes' },
    ]);
    expect((await raw(a!._id)).deliverableItems).toEqual([]);

    const done = await migrateAllDeliverables({ apply: true });
    expect(done.tasks).toHaveLength(1);
    const ra = await raw(a!._id);
    expect(ra.deliverable).toBe(`  ${long} `); // untouched, for a rollback
    expect(ra.deliverableLegacyMoved).toBe(true);
    expect(ra.deliverableItems).toHaveLength(1);
    expect(ra.deliverableItems[0]).toMatchObject({
      text: long,
      done: false,
      order: 1,
      createdBy: null,
    });
    const rb = await raw(b!._id);
    expect(rb.deliverable).toBe(''); // empty strings are not cleared either
    expect(rb.deliverableItems).toEqual([]);
    const rt = await TemplateModel.collection.findOne({ _id: new Types.ObjectId(w.template.id) });
    expect(rt!.activities[0].deliverable).toBe('Workshop minutes');
    expect(rt!.activities[0].deliverableItems.map((i: { text: string }) => i.text)).toEqual([
      'Workshop minutes',
    ]);
    expect(await ActivityLogModel.countDocuments({ action: 'deliverables_migrated' })).toBe(2);
    const t = await getTask(w.pm.agent, a!._id.toString());
    expect(t.deliverableItems.map((i) => [i.text, i.legacy])).toEqual([[long, false]]);

    // Re-run: nothing changes (decided by the items / marker, not by the old field).
    const again = await migrateAllDeliverables({ apply: true });
    expect([again.tasks.length, again.templates.length]).toEqual([0, 0]);
    expect((await raw(a!._id)).version).toBe(vA + 1);
    expect(await ActivityLogModel.countDocuments({ action: 'deliverables_migrated' })).toBe(2);

    // Emptying the list later doesn't bring the old text back (marker), and a re-run leaves it.
    await TaskModel.collection.updateOne({ _id: a!._id }, { $set: { deliverableItems: [] } });
    expect((await migrateAllDeliverables({ apply: true })).tasks).toHaveLength(0);
    expect((await getTask(w.pm.agent, a!._id.toString())).deliverableItems).toEqual([]);
  });
});

describe('CR-23 (Lean): read-only fallback for the old Deliverable text', () => {
  it('DTO shows the old text as one read-only open item; it cannot be ticked; the first add converts it', async () => {
    const w = await world(app);
    const t0 = await ownedTask(w);
    await seedLegacyDeliverable({ taskId: t0.id }, ' Old sign-off sheet ');
    let t = await getTask(w.pm.agent, t0.id);
    expect(t.deliverableItems).toEqual([
      expect.objectContaining({
        id: 'legacy',
        text: 'Old sign-off sheet',
        done: false,
        legacy: true,
      }),
    ]);
    // Not a real item: tick / edit / remove are refused.
    const tick = await w.member.agent
      .patch(`/api/v1/tasks/${t.id}/deliverable-items/legacy`)
      .set(CSRF)
      .send({ done: true, version: t.version });
    expect([400, 404]).toContain(tick.status);
    const del = await w.member.agent
      .delete(`/api/v1/tasks/${t.id}/deliverable-items/legacy?version=${t.version}`)
      .set(CSRF);
    expect([400, 404]).toContain(del.status);

    const res = await add(w.member.agent, t, 'Signed UAT form');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    t = res.body.task;
    expect(t.deliverableItems.map((i) => [i.text, i.done, i.legacy])).toEqual([
      ['Old sign-off sheet', false, false],
      ['Signed UAT form', false, false],
    ]);
    expect(t.deliverableItems[0]!.createdBy).toBeNull();
    const raw = await TaskModel.collection.findOne({ _id: new Types.ObjectId(t.id) });
    expect(raw!.deliverable).toBe(' Old sign-off sheet '); // left untouched for rollback
    expect(raw!.deliverableLegacyMoved).toBe(true);
    const conv = await ActivityLogModel.findOne({
      entityId: t.id,
      action: 'deliverables_migrated',
    }).lean();
    expect(conv?.actorId?.toString()).toBe(w.member.user._id.toString());

    // Removing every item later leaves the list empty (the old text doesn't come back).
    for (const i of [...t.deliverableItems]) {
      const r = await w.member.agent
        .delete(`/api/v1/tasks/${t.id}/deliverable-items/${i.id}?version=${t.version}`)
        .set(CSRF);
      expect(r.status).toBe(200);
      t = r.body.task;
    }
    expect(t.deliverableItems).toEqual([]);
  });

  it('Excel: a not-yet-migrated task exports the old text as an open line; the unchanged file changes nothing; adding a line converts', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    const first = (await tl(w.pm.agent, pid)).tasks[0]!;
    await seedLegacyDeliverable({ taskId: first.id }, 'Old minutes');
    const file = await exported(w.pm.agent, pid);
    const ws = (await load(file)).getWorksheet('Checklist')!;
    expect(String(ws.getRow(2).getCell(col('deliverables')).value)).toBe('Old minutes');

    const same = await preview(w.pm.agent, pid, file);
    expect(same.rows[0]!.changes).not.toContain('deliverables');
    expect((await getTask(w.pm.agent, first.id)).deliverableItems[0]!.legacy).toBe(true);

    const more = await edit(file, (s) => {
      s.getRow(2).getCell(col('deliverables')).value = 'Old minutes\n[x] Agenda';
    });
    await commit(w.pm.agent, pid, more);
    const t = await getTask(w.pm.agent, first.id);
    expect(t.deliverableItems.map((i) => [i.text, i.done, i.legacy])).toEqual([
      ['Old minutes', false, false],
      ['Agenda', true, false],
    ]);
    const raw = await TaskModel.collection.findOne({ _id: new Types.ObjectId(first.id) });
    expect(raw!.deliverable).toBe('Old minutes');
    expect(raw!.deliverableLegacyMoved).toBe(true);
  });

  it('templates: the activity shows the old text read-only; saving it unchanged keeps the fallback; new projects get it as an item', async () => {
    const w = await world(app);
    await seedLegacyDeliverable({ templateId: w.template.id, activity: 0 }, 'Kick-off deck');
    const get = async () =>
      (await w.admin.agent.get(`/api/v1/templates/${w.template.id}`)).body.template;
    const tpl = await get();
    expect(tpl.activities[0].deliverableItems).toEqual([
      { id: 'legacy', text: 'Kick-off deck', legacy: true },
    ]);

    // A draft saved with the old-text item as it came keeps the fallback and the old field.
    await TemplateModel.collection.updateOne(
      { _id: new Types.ObjectId(w.template.id) },
      { $set: { status: 'DRAFT' } },
    );
    const save = await w.admin.agent
      .patch(`/api/v1/templates/${w.template.id}`)
      .set(CSRF)
      .send({ activities: tpl.activities });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    let raw = await TemplateModel.collection.findOne({ _id: new Types.ObjectId(w.template.id) });
    expect(raw!.activities[0]).toMatchObject({
      deliverable: 'Kick-off deck',
      deliverableItems: [],
    });
    await TemplateModel.collection.updateOne(
      { _id: new Types.ObjectId(w.template.id) },
      { $set: { status: 'PUBLISHED' } },
    );

    // A project made from it gets the text as a real first item.
    const res = await w.pm.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send({
        name: 'From old template',
        projectTypeId: w.project.projectType?.id ?? w.project.projectTypeId,
        clientId: w.acme.client.id,
        managerId: w.pm.user._id.toString(),
        startDate: '2026-10-12',
        plannedEndDate: '2026-12-18',
        templateId: w.template.id,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tasks = (await tl(w.pm.agent, res.body.project.id)).tasks;
    const first = await getTask(w.pm.agent, tasks[0]!.id);
    expect(first.deliverableItems.map((i) => [i.text, i.legacy])).toEqual([
      ['Kick-off deck', false],
    ]);

    // Editing the list (adding an item) turns the old text into a real item.
    await TemplateModel.collection.updateOne(
      { _id: new Types.ObjectId(w.template.id) },
      { $set: { status: 'DRAFT' } },
    );
    const acts = (await get()).activities;
    acts[0].deliverableItems = [...acts[0].deliverableItems, { text: 'Attendance list' }];
    expect(
      (
        await w.admin.agent
          .patch(`/api/v1/templates/${w.template.id}`)
          .set(CSRF)
          .send({ activities: acts })
      ).status,
    ).toBe(200);
    raw = await TemplateModel.collection.findOne({ _id: new Types.ObjectId(w.template.id) });
    expect(raw!.activities[0].deliverable).toBe('Kick-off deck');
    expect(raw!.activities[0].deliverableItems.map((i: { text: string }) => i.text)).toEqual([
      'Kick-off deck',
      'Attendance list',
    ]);
    expect(
      (await get()).activities[0].deliverableItems.map((i: { legacy?: boolean }) =>
        Boolean(i.legacy),
      ),
    ).toEqual([false, false]);
  });
});

describe('CR-23 --restore-legacy: reverting the first (f73cf65) migration on staging', () => {
  /** What the f73cf65 script left: field unset, one authorless item, an actor-less audit entry. */
  async function oldMigrated(taskId: Types.ObjectId, projectId: string, text: string, at: Date) {
    await TaskModel.collection.updateOne(
      { _id: taskId },
      {
        $unset: { deliverable: '', deliverableLegacyMoved: '' },
        $set: {
          deliverableItems: [
            {
              _id: new Types.ObjectId(),
              text,
              done: false,
              doneBy: null,
              doneAt: null,
              doneViaImport: false,
              order: 1,
              createdBy: null,
              createdAt: at,
            },
          ],
        },
      },
    );
    await ActivityLogModel.create({
      actorId: null,
      entityType: 'task',
      entityId: taskId,
      projectId,
      action: 'deliverables_migrated',
      changes: [{ field: 'deliverableItems', old: null, new: text }],
      at,
    });
  }

  it('unchanged items: text back and item removed (as before any migration); changed items: text back, items kept (skipped-items); others untouched; dry run and re-run write nothing', async () => {
    // Earlier tests in this file leave migration entries behind; start from staging's shape.
    await ActivityLogModel.deleteMany({ action: 'deliverables_migrated' });
    const w = await world(app);
    const pid = w.project.id as string;
    const [a, b, c] = await TaskModel.find({ projectId: pid }).sort({ order: 1 }).limit(3).lean();
    const at = new Date(Date.now() - 60_000);
    await oldMigrated(a!._id, pid, 'Old A', at);
    await oldMigrated(b!._id, pid, 'Old B', at);
    // B was ticked by a user after the migration.
    await TaskModel.collection.updateOne(
      { _id: b!._id },
      { $set: { 'deliverableItems.0.done': true } },
    );
    await ActivityLogModel.create({
      actorId: w.pm.user._id,
      entityType: 'task',
      entityId: b!._id,
      projectId: pid,
      action: 'deliverable_item_ticked',
      changes: [{ field: 'deliverableItems', old: false, new: true }],
    });
    // C still has its field (current migration): named in an entry but never touched.
    await seedLegacyDeliverable({ taskId: c!._id.toString() }, 'Old C');
    await ActivityLogModel.create({
      actorId: null,
      entityType: 'task',
      entityId: c!._id,
      projectId: pid,
      action: 'deliverables_migrated',
      changes: [{ field: 'deliverableItems', old: null, new: 'Old C' }],
      at,
    });
    // A template activity the old script migrated.
    const tid = new Types.ObjectId(w.template.id);
    const tpl = await TemplateModel.collection.findOne({ _id: tid });
    const actId = String(tpl!.activities[0].id);
    await TemplateModel.collection.updateOne(
      { _id: tid },
      {
        $unset: { 'activities.0.deliverable': '' },
        $set: {
          'activities.0.deliverableItems': [
            { _id: new Types.ObjectId(), text: 'Old T', done: false, order: 1, createdBy: null },
          ],
        },
      },
    );
    await ActivityLogModel.create({
      actorId: null,
      entityType: 'template',
      entityId: tid,
      action: 'deliverables_migrated',
      changes: [{ field: `activities.${actId}.deliverableItems`, old: null, new: 'Old T' }],
      at,
    });
    const raw = async (id: Types.ObjectId) => (await TaskModel.collection.findOne({ _id: id }))!;
    const before = { a: await raw(a!._id), c: await raw(c!._id) };

    const dry = await restoreLegacyDeliverables({ apply: false });
    expect(dry.tasks.map((t) => t.text)).toEqual(['Old A']);
    expect(dry.skippedItems.map((s) => s.text)).toEqual(['Old B']);
    expect(dry.templates).toEqual([
      { templateId: w.template.id, activities: [{ id: actId, text: 'Old T' }] },
    ]);
    expect(dry.leftAlone).toBe(1);
    expect(await raw(a!._id)).toEqual(before.a);

    await restoreLegacyDeliverables({ apply: true });
    const ra = await raw(a!._id);
    expect(ra).toMatchObject({ deliverable: 'Old A', deliverableItems: [] });
    expect('deliverableLegacyMoved' in ra).toBe(false);
    expect(ra.version).toBe(before.a.version + 1);
    const rb = await raw(b!._id);
    expect(rb.deliverable).toBe('Old B');
    expect(rb.deliverableItems).toHaveLength(1);
    expect(rb.deliverableLegacyMoved).toBe(true);
    expect(await raw(c!._id)).toEqual(before.c);
    const rt = await TemplateModel.collection.findOne({ _id: tid });
    expect(rt!.activities[0]).toMatchObject({ deliverable: 'Old T', deliverableItems: [] });

    // Fallback shows on A; B shows its kept items.
    expect((await getTask(w.pm.agent, a!._id.toString())).deliverableItems[0]).toMatchObject({
      text: 'Old A',
      legacy: true,
    });
    expect((await getTask(w.pm.agent, b!._id.toString())).deliverableItems[0]).toMatchObject({
      text: 'Old B',
      done: true,
      legacy: false,
    });

    // Idempotent.
    const settled = { a: await raw(a!._id), b: await raw(b!._id) };
    const again = await restoreLegacyDeliverables({ apply: true });
    expect([again.tasks.length, again.skippedItems.length, again.templates.length]).toEqual([
      0, 0, 0,
    ]);
    expect({ a: await raw(a!._id), b: await raw(b!._id) }).toEqual(settled);

    // The current migration can then run again and keeps the restored field.
    const m = await migrateAllDeliverables({ apply: true });
    expect(m.tasks.map((t) => t.text)).toEqual(expect.arrayContaining(['Old A', 'Old C']));
    expect((await raw(a!._id)).deliverable).toBe('Old A');
    expect((await raw(b!._id)).deliverableItems).toHaveLength(1);
  });
});
