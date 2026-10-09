import { DEFAULT_ACCESS_RULES } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessRuleModel, ActivityLogModel, ProjectModel, TaskModel } from '../src/models/index.js';
import { addMissingCells, addMissingRecordTypes } from '../src/services/accessDefaults.js';
import { ensureDefaultAccessRules } from '../src/services/accessRules.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { grant, world, ptypeId } from './m2helpers.js';
import { entryFields } from './trackerHelpers.js';

/**
 * Doc 11 v0.4.8, FR-ACL-14..17: Reports (View, Export) and Team & workload (View) are Access-rule
 * rows. Defaults reproduce the old behaviour; scope limits stay fixed in code.
 */
useDatabase();
const app = makeApp();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T03:00:00Z'));
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([
    ProjectModel.deleteMany({}),
    TaskModel.deleteMany({}),
    AccessRuleModel.deleteMany({}),
  ]);
});

async function setup() {
  const w = await world(app);
  await ProjectModel.updateOne({ _id: w.project.id }, { status: 'ACTIVE' });
  const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
    id: string;
  }[];
  // A second project the Member doesn't belong to.
  const other = await w.pm2.agent
    .post('/api/v1/projects')
    .set(CSRF)
    .send({
      projectTypeId: await ptypeId(),
      name: 'Other Q',
      clientId: w.other.client.id,
      managerId: w.pm2.user._id.toString(),
      memberIds: [],
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: w.template.id,
    });
  expect(other.status).toBe(201);
  const fields = await entryFields();
  const log = (a: typeof w.pm.agent, hours: number) =>
    a
      .post('/api/v1/time')
      .set(CSRF)
      .send({ taskId: tasks[0]!.id, workDate: '2026-10-20', hours, ...fields });
  expect((await log(w.member.agent, 2)).status).toBe(201);
  expect((await log(w.pm.agent, 3)).status).toBe(201);
  return { w, otherId: other.body.project.id as string };
}

describe('FR-ACL-14: seeded defaults reproduce today’s access', () => {
  it('every role gets Reports View + Export and Team & workload View; Admin is locked full', async () => {
    const { w } = await setup();
    const roles = (await w.admin.agent.get('/api/v1/access-rules')).body.roles as {
      role: string;
      permissions: Record<string, Record<string, boolean>>;
    }[];
    for (const r of roles) {
      expect(r.permissions.reports).toMatchObject({ view: true, export: true });
      expect(r.permissions.reports).toMatchObject({ create: false, edit: false, delete: false });
      expect(r.permissions.workload).toMatchObject({ view: true, export: false });
    }
    const v = roles.find((r) => r.role === 'ADMIN')!;
    const res = await w.admin.agent
      .put('/api/v1/access-rules/ADMIN')
      .set(CSRF)
      .send({
        version: (v as unknown as { version: number }).version,
        permissions: { reports: { export: false } },
      });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('LOCKED_PERMISSION');
  });

  it('the startup migration adds Reports Export and the Team & workload row only, idempotently', async () => {
    await ensureDefaultAccessRules();
    // A database from before this change: no Export cell, no workload row, and an Admin had
    // turned Reports View off for Viewers.
    await AccessRuleModel.updateMany(
      {},
      { $unset: { 'permissions.reports.export': 1, 'permissions.workload': 1 } },
    );
    await AccessRuleModel.updateOne(
      { role: 'VIEWER' },
      { $set: { 'permissions.reports.view': false, 'permissions.clients.view': false } },
    );
    const before = await AccessRuleModel.find().lean();
    const rows = await addMissingRecordTypes();
    const cells = await addMissingCells();
    expect(rows.map((a) => a.record)).toEqual(['workload', 'workload', 'workload', 'workload']);
    expect(cells.map((c) => c.cell)).toEqual(Array(4).fill('reports.export'));
    const after = await AccessRuleModel.find().lean();
    for (const doc of after) {
      const old = before.find((b) => b.role === doc.role)!;
      const p = doc.permissions as unknown as Record<string, Record<string, boolean>>;
      const o = old.permissions as unknown as Record<string, Record<string, boolean>>;
      // Every other cell is untouched.
      for (const k of Object.keys(o)) {
        const { export: _x, ...rest } = p[k]!;
        expect(k === 'reports' ? rest : p[k]).toEqual(o[k]);
      }
      expect(doc.version).toBe(old.version + 2);
      const viewer = doc.role === 'VIEWER';
      expect(p.reports).toMatchObject({ view: !viewer, export: !viewer });
      expect(p.workload!.view).toBe(!viewer);
    }
    expect(
      await ActivityLogModel.countDocuments({
        action: { $in: ['access_rule_row_added', 'access_rule_cell_added'] },
        'meta.recordType': { $in: ['reports', 'workload'] },
      }),
    ).toBe(8);
    // Second start: nothing to do.
    expect(await addMissingRecordTypes()).toEqual([]);
    expect(await addMissingCells()).toEqual([]);
    expect((await AccessRuleModel.find().lean()).map((d) => d.version)).toEqual(
      after.map((d) => d.version),
    );
  });
});

describe('FR-ACL-16: the central check gates the routes (403 when off)', () => {
  it('Reports View, Reports Export and Team & workload View are independent', async () => {
    const { w } = await setup();
    const pm = w.pm.agent;
    expect((await pm.get('/api/v1/reports/overdue')).status).toBe(200);
    expect((await pm.get('/api/v1/reports/overdue/export')).status).toBe(200);
    expect((await pm.get('/api/v1/workload')).status).toBe(200);

    await grant(app, 'PROJECT_MANAGER', { reports: { export: false } });
    expect((await pm.get('/api/v1/reports/overdue')).status).toBe(200);
    expect((await pm.get('/api/v1/reports/overdue/export')).status).toBe(403);

    await grant(app, 'PROJECT_MANAGER', { workload: { view: false } });
    expect((await pm.get('/api/v1/workload')).status).toBe(403);
    expect((await pm.get('/api/v1/reports/project-status')).status).toBe(200);

    // FR-ACL-15: View off also turns Export off, and both changes are audited.
    await grant(app, 'PROJECT_MANAGER', { reports: { export: true } });
    const auditsBefore = await ActivityLogModel.countDocuments({ action: 'access_rule_changed' });
    await grant(app, 'PROJECT_MANAGER', { reports: { view: false } });
    const rule = (await AccessRuleModel.findOne({ role: 'PROJECT_MANAGER' }).lean())!;
    const p = rule.permissions as unknown as Record<string, Record<string, boolean>>;
    expect(p.reports).toMatchObject({ view: false, export: false });
    const changed = await ActivityLogModel.find({ action: 'access_rule_changed' })
      .sort({ _id: -1 })
      .limit(2)
      .lean();
    expect(
      (await ActivityLogModel.countDocuments({ action: 'access_rule_changed' })) - auditsBefore,
    ).toBe(2);
    expect(changed.map((c) => c.meta?.permission).sort()).toEqual(['export', 'view']);
    for (const path of ['effort-variance', 'overdue', 'timesheets', 'project-status', 'issues']) {
      expect((await pm.get(`/api/v1/reports/${path}`)).status).toBe(403);
      expect((await pm.get(`/api/v1/reports/${path}/export`)).status).toBe(403);
    }
    // The dashboard sits under Reports View; Team & workload has its own row.
    expect((await pm.get('/api/v1/dashboard')).status).toBe(403);
    await grant(app, 'PROJECT_MANAGER', { workload: { view: true } });
    expect((await pm.get('/api/v1/workload')).status).toBe(200);
  });

  it('an export returns the same scoped rows and is audited', async () => {
    const { w } = await setup();
    const view = await w.member.agent.get('/api/v1/reports/timesheets');
    const exp = await w.member.agent.get('/api/v1/reports/timesheets/export?from=2026-10-19');
    expect(exp.status).toBe(200);
    expect(exp.body.items).toEqual(view.body.items);
    const log = await ActivityLogModel.findOne({
      action: 'report_exported',
      actorId: w.member.user._id,
    }).lean();
    expect(log).toMatchObject({ entityType: 'report' });
    expect(log!.actorId!.toString()).toBe(w.member.user._id.toString());
    expect(log!.meta).toMatchObject({
      report: 'timesheets',
      filters: { from: '2026-10-19' },
      rows: 1,
    });
  });
});

describe('Scope limits stay fixed in code (FR-ACL-07, NFR-25)', () => {
  it('Members: own projects, own time entries, own workload row; others see everyone', async () => {
    const { w, otherId } = await setup();
    const status = async (a: typeof w.pm.agent) =>
      ((await a.get('/api/v1/reports/project-status')).body.items as { id: string }[]).map(
        (p) => p.id,
      );
    expect(await status(w.member.agent)).toEqual([w.project.id]);
    expect((await status(w.pm.agent)).sort()).toEqual([w.project.id, otherId].sort());
    // A filter on a project outside scope just finds nothing, export included.
    for (const url of [
      `/api/v1/reports/overdue?projectId=${otherId}`,
      `/api/v1/reports/overdue/export?projectId=${otherId}`,
    ]) {
      const res = await w.member.agent.get(url);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    }
    // Timesheets: a Member only gets their own entries, even when asking for someone else's.
    const ts = await w.member.agent.get(
      `/api/v1/reports/timesheets/export?userId=${w.pm.user._id.toString()}`,
    );
    expect(ts.body.items.map((i: { user: { id: string } }) => i.user.id)).toEqual([
      w.member.user._id.toString(),
    ]);
    expect((await w.pm.agent.get('/api/v1/reports/timesheets')).body.items).toHaveLength(2);
    // Viewers have no Time view: the Timesheets report stays closed for them.
    expect((await w.viewer.agent.get('/api/v1/reports/timesheets/export')).status).toBe(403);
    // Team & workload: Members only see their own row.
    const mine = (await w.member.agent.get('/api/v1/workload')).body.items;
    expect(mine.map((r: { person: { id: string } }) => r.person.id)).toEqual([
      w.member.user._id.toString(),
    ]);
    expect((await w.pm.agent.get('/api/v1/workload')).body.items.length).toBeGreaterThan(1);
  });

  it('Reports View never exposes anyone else’s saved DARs, Admins included', async () => {
    const { w } = await setup();
    const saved = await w.member.agent
      .post('/api/v1/dar/saved')
      .set(CSRF)
      .send({ from: '2026-10-19', to: '2026-10-20' });
    expect(saved.status).toBe(201);
    const id = saved.body.item.id as string;
    expect(id).toBeTruthy();
    expect(DEFAULT_ACCESS_RULES.ADMIN.reports.view).toBe(true);
    for (const a of [w.admin.agent, w.pm.agent]) {
      expect((await a.get(`/api/v1/dar/saved/${id}`)).status).toBe(404);
      expect((await a.get(`/api/v1/dar/saved/${id}/export/pdf`)).status).toBe(404);
      const list = (await a.get('/api/v1/dar/saved')).body.items as { id: string }[];
      expect(list.map((s) => s.id)).not.toContain(id);
    }
    // No report route serves saved DARs.
    for (const path of ['effort-variance', 'overdue', 'timesheets', 'project-status', 'issues']) {
      const body = JSON.stringify((await w.admin.agent.get(`/api/v1/reports/${path}/export`)).body);
      expect(body).not.toContain(id);
    }
    expect((await w.member.agent.get(`/api/v1/dar/saved/${id}`)).status).toBe(200);
  });
});
