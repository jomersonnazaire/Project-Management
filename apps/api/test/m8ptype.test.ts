import { DEFAULT_PROJECT_TYPES } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityLogModel,
  LookupModel,
  MigrationModel,
  ProjectModel,
  ProjectTypeModel,
  TimeEntryModel,
} from '../src/models/index.js';
import { PROJECT_TYPES_SEED_ID, ensureDefaultProjectTypes } from '../src/services/projectTypes.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { ptypeId, resetRules, world } from './m2helpers.js';
import { lookups } from './trackerHelpers.js';

/** Project types (doc 14 v1.1.1 FR-PTY-01..07; mockup v0.9.2 Admin › Project types). */
useDatabase();
const app = makeApp({ SESSION_IDLE_MINUTES: '1440' });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T02:00:00Z'));
});
afterEach(async () => {
  vi.useRealTimers();
  await resetRules();
});

type W = Awaited<ReturnType<typeof world>>;
const all = (w: W) => w.admin.agent.get('/api/v1/project-types/all');
const create = (w: W, body: object) =>
  w.admin.agent.post('/api/v1/project-types').set(CSRF).send(body);
const patch = (w: W, id: string, body: object) =>
  w.admin.agent.patch(`/api/v1/project-types/${id}`).set(CSRF).send(body);
const actId = async (name: string) =>
  (await LookupModel.findOne({ kind: 'ACTIVITY_TYPE', name }).lean())!._id.toString();

describe('FR-PTY-01 seed (Q-51)', () => {
  it('seeds the nine types with defaults matched by name, once, without "Legacy (example)"', async () => {
    await ensureDefaultProjectTypes();
    expect(await ensureDefaultProjectTypes()).toBe(0);
    const docs = await ProjectTypeModel.find().lean();
    expect(docs.map((d) => d.name).sort()).toEqual(DEFAULT_PROJECT_TYPES.map((t) => t.name).sort());
    expect(docs.some((d) => /legacy/i.test(d.name))).toBe(false);
    const acts = await LookupModel.find({ kind: 'ACTIVITY_TYPE' }).lean();
    const nameOf = (id: unknown) => acts.find((a) => String(a._id) === String(id))?.name ?? null;
    const defaults = Object.fromEntries(docs.map((d) => [d.name, nameOf(d.defaultActivityTypeId)]));
    expect(defaults).toEqual({
      Implementation: 'Configuration',
      Integration: 'Integration',
      Configuration: 'Configuration',
      Development: 'Development',
      Support: 'Support',
      Upgrade: 'Configuration',
      Migration: 'Data migration',
      Training: 'Training',
      Consulting: 'Client meeting',
    });
    // Running again (even without the marker) never duplicates or overwrites a type.
    await ProjectTypeModel.updateOne({ nameKey: 'support' }, { defaultActivityTypeId: null });
    await MigrationModel.deleteOne({ _id: PROJECT_TYPES_SEED_ID });
    await ensureDefaultProjectTypes();
    expect(await ProjectTypeModel.countDocuments()).toBe(9);
    expect(
      (await ProjectTypeModel.findOne({ nameKey: 'support' }).lean())!.defaultActivityTypeId,
    ).toBeNull();
  });

  it('leaves the default blank when no active Activity type has that name', async () => {
    await ProjectTypeModel.deleteMany({});
    await MigrationModel.deleteOne({ _id: PROJECT_TYPES_SEED_ID });
    await lookups();
    await LookupModel.updateOne(
      { kind: 'ACTIVITY_TYPE', name: 'Client meeting' },
      { active: false },
    );
    await LookupModel.updateOne(
      { kind: 'ACTIVITY_TYPE', name: 'Training' },
      { name: 'Coaching', nameKey: 'coaching' },
    );
    await ensureDefaultProjectTypes();
    const by = async (n: string) => (await ProjectTypeModel.findOne({ nameKey: n }).lean())!;
    expect((await by('consulting')).defaultActivityTypeId).toBeNull();
    expect((await by('training')).defaultActivityTypeId).toBeNull();
    expect((await by('implementation')).defaultActivityTypeId).not.toBeNull();
    await LookupModel.updateOne(
      { kind: 'ACTIVITY_TYPE', name: 'Client meeting' },
      { active: true },
    );
    await LookupModel.updateOne(
      { kind: 'ACTIVITY_TYPE', name: 'Coaching' },
      { name: 'Training', nameKey: 'training' },
    );
  });
});

describe('FR-PTY-01 Admin › Settings › Project types', () => {
  it('adds with trimmed names, rejects blank, too long and case-insensitive duplicates (409)', async () => {
    const w = await world(app);
    const ok = await create(w, {
      name: '  Hyper   care  ',
      defaultActivityTypeId: await actId('Support'),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.item).toMatchObject({
      name: 'Hyper care',
      active: true,
      usedBy: 0,
      defaultActivityType: { name: 'Support', active: true },
    });
    const blank = await create(w, { name: '   ' });
    expect(blank.status).toBe(400);
    expect(JSON.stringify(blank.body)).toContain('Add a name.');
    const long = await create(w, { name: 'x'.repeat(51) });
    expect(long.status).toBe(400);
    expect(JSON.stringify(long.body)).toContain('Keep the name under 50 characters.');
    expect((await create(w, { name: 'y'.repeat(50) })).status).toBe(201);
    const dup = await create(w, { name: 'hyper CARE' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('A project type with this name already exists.');
    // Inactive types count for the duplicate check too.
    await patch(w, ok.body.item.id, { active: false });
    expect((await create(w, { name: 'Hyper  Care' })).status).toBe(409);
    // A default must be an active Activity type.
    const other = await LookupModel.create({
      kind: 'ACTIVITY_TYPE',
      name: 'Recruiting',
      nameKey: 'recruiting',
      active: false,
    });
    expect(
      (await create(w, { name: 'Bad', defaultActivityTypeId: other._id.toString() })).status,
    ).toBe(422);
    const logs = await ActivityLogModel.find({ entityId: ok.body.item.id }).lean();
    expect(logs.map((l) => l.action)).toEqual(['project_type_created', 'project_type_deactivated']);
  });

  it('renames, changes the default, deactivates, reactivates; all audited; settings access only', async () => {
    const w = await world(app);
    const id = await ptypeId('Upgrade');
    const rn = await patch(w, id, { name: 'Upgrade project' });
    expect(rn.status).toBe(200);
    expect(rn.body.item.name).toBe('Upgrade project');
    expect((await patch(w, id, { name: 'implementation' })).status).toBe(409);
    expect((await patch(w, id, { name: '' })).status).toBe(400);
    const dev = await actId('Development');
    expect(
      (await patch(w, id, { defaultActivityTypeId: dev })).body.item.defaultActivityType.name,
    ).toBe('Development');
    expect(
      (await patch(w, id, { defaultActivityTypeId: null })).body.item.defaultActivityType,
    ).toBeNull();
    const off = await patch(w, id, { active: false });
    expect(off.body.item).toMatchObject({
      active: false,
      deactivatedBy: { id: w.admin.user._id.toString() },
    });
    expect((await patch(w, id, { active: true })).body.item.active).toBe(true);
    await patch(w, id, { name: 'Upgrade' });
    const actions = (
      await ActivityLogModel.find({ entityType: 'projectType', entityId: id })
        .sort({ createdAt: 1, _id: 1 })
        .lean()
    ).map((l) => l.action);
    expect(actions).toEqual([
      'project_type_renamed',
      'project_type_default_changed',
      'project_type_default_changed',
      'project_type_deactivated',
      'project_type_reactivated',
      'project_type_renamed',
    ]);
    // The `settings` access row (doc 11): Admin only by default; the picker list is open.
    expect((await w.pm.agent.get('/api/v1/project-types/all')).status).toBe(403);
    expect(
      (await w.pm.agent.post('/api/v1/project-types').set(CSRF).send({ name: 'Z' })).status,
    ).toBe(403);
    expect(
      (await w.pm.agent.patch(`/api/v1/project-types/${id}`).set(CSRF).send({ active: false }))
        .status,
    ).toBe(403);
    const picker = await w.member.agent.get('/api/v1/project-types');
    expect(picker.status).toBe(200);
    expect(picker.body.items.every((t: { active: boolean }) => t.active)).toBe(true);
  });

  it('deletes only unused types; in-use ones answer 409; the inactive default shows as inactive', async () => {
    const w = await world(app);
    const listed = (await all(w)).body.items as { name: string; usedBy: number; id: string }[];
    expect(listed.find((t) => t.name === 'Implementation')!.usedBy).toBeGreaterThanOrEqual(1);
    const used = await w.admin.agent.delete(`/api/v1/project-types/${await ptypeId()}`).set(CSRF);
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('PROJECT_TYPE_IN_USE');
    const tmp = await create(w, { name: 'Temporary' });
    expect(
      (await w.admin.agent.delete(`/api/v1/project-types/${tmp.body.item.id}`).set(CSRF)).status,
    ).toBe(204);
    expect(
      await ActivityLogModel.exists({ entityId: tmp.body.item.id, action: 'project_type_deleted' }),
    ).toBeTruthy();
    const rec = await LookupModel.create({
      kind: 'ACTIVITY_TYPE',
      name: 'Vendor call',
      nameKey: 'vendor call',
    });
    const t = await create(w, { name: 'Vendor', defaultActivityTypeId: rec._id.toString() });
    await LookupModel.updateOne({ _id: rec._id }, { active: false });
    const row = ((await all(w)).body.items as { id: string; defaultActivityType: unknown }[]).find(
      (x) => x.id === t.body.item.id,
    );
    expect(row!.defaultActivityType).toEqual({
      id: rec._id.toString(),
      name: 'Vendor call',
      active: false,
    });
  });
});

describe('FR-PTY-02/03 project information', () => {
  it('is required on create, picks active types only, shows on the project and list (filterable)', async () => {
    const w = await world(app);
    expect(w.project.projectType).toMatchObject({ name: 'Implementation', active: true });
    const body = {
      name: 'Typed',
      clientId: w.acme.client.id,
      managerId: w.pm.user._id.toString(),
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: w.template.id,
    };
    const missing = await w.pm.agent.post('/api/v1/projects').set(CSRF).send(body);
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain('Choose a project type.');
    const off = await create(w, { name: 'Retired type' });
    await patch(w, off.body.item.id, { active: false });
    const inactive = await w.pm.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send({ ...body, projectTypeId: off.body.item.id });
    expect(inactive.status).toBe(422);
    const support = await ptypeId('Support');
    const made = await w.pm.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send({ ...body, projectTypeId: support });
    expect(made.status).toBe(201);
    expect(made.body.project.projectType).toEqual({ id: support, name: 'Support', active: true });
    const filtered = await w.pm.agent.get(`/api/v1/projects?projectTypeId=${support}`);
    expect(filtered.body.items.map((p: { name: string }) => p.name)).toEqual(['Typed']);
    // Renames show live (stored by ID, FR-PTY-06).
    await patch(w, support, { name: 'Support desk' });
    expect(
      (await w.pm.agent.get(`/api/v1/projects/${made.body.project.id}`)).body.project.projectType
        .name,
    ).toBe('Support desk');
    await patch(w, support, { name: 'Support' });
  });

  it('existing projects show Not set and must pick a type on their next save; an inactive type stays valid', async () => {
    const w = await world(app);
    const pid = w.project.id;
    await ProjectModel.updateOne({ _id: pid }, { projectTypeId: null });
    const p = await w.pm.agent.get(`/api/v1/projects/${pid}`);
    expect(p.body.project.projectType).toBeNull();
    expect(
      (await w.pm.agent.get('/api/v1/projects?projectTypeId=none')).body.items.map(
        (x: { id: string }) => x.id,
      ),
    ).toContain(pid);
    const blocked = await w.pm.agent
      .patch(`/api/v1/projects/${pid}`)
      .set(CSRF)
      .send({ name: 'Renamed' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('PROJECT_TYPE_REQUIRED');
    expect(blocked.body.error.message).toBe('Choose a project type.');
    const tmp = await create(w, { name: 'Soon inactive' });
    const ok = await w.pm.agent
      .patch(`/api/v1/projects/${pid}`)
      .set(CSRF)
      .send({ name: 'Renamed', projectTypeId: tmp.body.item.id });
    expect(ok.status).toBe(200);
    expect(ok.body.project.projectType.name).toBe('Soon inactive');
    const log = await ActivityLogModel.findOne({ entityId: pid, action: 'project_updated' })
      .sort({ _id: -1 })
      .lean();
    expect(JSON.stringify(log?.changes ?? [])).toContain('projectTypeId');
    await patch(w, tmp.body.item.id, { active: false });
    // Keeps the deactivated type: still valid, with or without sending it.
    const keep = await w.pm.agent
      .patch(`/api/v1/projects/${pid}`)
      .set(CSRF)
      .send({ description: 'x' });
    expect(keep.status).toBe(200);
    expect(keep.body.project.projectType).toMatchObject({ name: 'Soon inactive', active: false });
    expect(
      (
        await w.pm.agent
          .patch(`/api/v1/projects/${pid}`)
          .set(CSRF)
          .send({ projectTypeId: tmp.body.item.id, description: 'y' })
      ).status,
    ).toBe(200);
    // Switching to another inactive type is refused; to an active one is fine.
    const other = await create(w, { name: 'Also inactive' });
    await patch(w, other.body.item.id, { active: false });
    expect(
      (
        await w.pm.agent
          .patch(`/api/v1/projects/${pid}`)
          .set(CSRF)
          .send({ projectTypeId: other.body.item.id })
      ).status,
    ).toBe(422);
    expect(
      (
        await w.pm.agent
          .patch(`/api/v1/projects/${pid}`)
          .set(CSRF)
          .send({ projectTypeId: await ptypeId() })
      ).status,
    ).toBe(200);
  });
});

describe('FR-PTY-04/05 Time in preselect; entries never change', () => {
  it('preselects the type default; blank for no type, no default or an inactive default', async () => {
    const w = await world(app);
    const l = await lookups();
    const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
      id: string;
    }[];
    const pre = async () =>
      (await w.member.agent.get(`/api/v1/project-types/preselect?taskId=${tasks[0]!.id}`)).body
        .preselect;
    const impl = await ptypeId();
    await ProjectModel.updateOne({ _id: w.project.id }, { projectTypeId: impl });
    await ProjectTypeModel.updateOne({ _id: impl }, { defaultActivityTypeId: l.configuration });
    expect(await pre()).toEqual({
      projectName: 'Rollout P',
      projectType: { id: impl, name: 'Implementation', active: true },
      activityType: { id: l.configuration, name: 'Configuration' },
      inactiveDefault: null,
    });
    // An inactive project type still applies its (active) default.
    await ProjectTypeModel.updateOne({ _id: impl }, { active: false });
    expect((await pre()).activityType).toEqual({ id: l.configuration, name: 'Configuration' });
    await ProjectTypeModel.updateOne({ _id: impl }, { active: true });
    // Default Activity type deactivated: nothing preselected.
    await LookupModel.updateOne({ _id: l.configuration }, { active: false });
    expect(await pre()).toMatchObject({ activityType: null, inactiveDefault: 'Configuration' });
    await LookupModel.updateOne({ _id: l.configuration }, { active: true });
    // No default.
    await ProjectTypeModel.updateOne({ _id: impl }, { defaultActivityTypeId: null });
    expect(await pre()).toMatchObject({ activityType: null, inactiveDefault: null });
    // No type.
    await ProjectModel.updateOne({ _id: w.project.id }, { projectTypeId: null });
    expect(await pre()).toMatchObject({ projectType: null, activityType: null });
    // Someone outside the project can't read it.
    const out = await w.outsider.agent.get(
      `/api/v1/project-types/preselect?taskId=${tasks[0]!.id}`,
    );
    expect([403, 404]).toContain(out.status);
    await ProjectModel.updateOne({ _id: w.project.id }, { projectTypeId: impl });
    await ProjectTypeModel.updateOne({ _id: impl }, { defaultActivityTypeId: l.configuration });
  });

  it('changing the project type, a default or deactivating never edits existing entries', async () => {
    const w = await world(app);
    const l = await lookups();
    const tasks = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items as {
      id: string;
    }[];
    const made = await w.member.agent.post('/api/v1/tracker/entries').set(CSRF).send({
      taskId: tasks[0]!.id,
      activityTypeId: l.integration,
      module: 'Financials',
      date: '2026-10-13',
      dayLocationId: l.onsite,
      timeIn: '08:00',
      timeOut: '09:00',
    });
    expect(made.status).toBe(201);
    const impl = await ptypeId();
    await patch(w, impl, { defaultActivityTypeId: l.internalMeeting });
    await patch(w, impl, { active: false });
    await w.pm.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ projectTypeId: await ptypeId('Support') });
    await LookupModel.updateOne({ _id: l.integration }, { active: false });
    const e = await TimeEntryModel.findById(made.body.entry.id).lean();
    expect(e!.activityTypeId!.toString()).toBe(l.integration);
    await LookupModel.updateOne({ _id: l.integration }, { active: true });
    await patch(w, impl, { active: true, defaultActivityTypeId: l.configuration });
  });
});

describe('FR-PTY-07 dashboard and project-status report', () => {
  it('shows the current type name (or null for Not set)', async () => {
    const w = await world(app);
    const status = await w.pm.agent.get('/api/v1/reports/project-status');
    const row = status.body.items.find((r: { id: string }) => r.id === w.project.id);
    expect(row.projectType).toBe('Implementation');
    await ProjectModel.updateOne({ _id: w.project.id }, { status: 'ACTIVE' });
    const dash = await w.pm.agent.get('/api/v1/dashboard');
    const d = dash.body.activeProjects.find((r: { id: string }) => r.id === w.project.id);
    expect(d.projectType).toBe('Implementation');
    await ProjectModel.updateOne({ _id: w.project.id }, { projectTypeId: null });
    const again = await w.pm.agent.get('/api/v1/reports/project-status');
    expect(
      again.body.items.find((r: { id: string }) => r.id === w.project.id).projectType,
    ).toBeNull();
  });
});

describe('FR-PTY-07 project list filter options', () => {
  it('the picker list is active-only; includeInactive adds inactive types for the filter', async () => {
    const w = await world(app);
    const t = await create(w, { name: 'Filter only' });
    await patch(w, t.body.item.id, { active: false });
    const active = await w.member.agent.get('/api/v1/project-types');
    expect(active.body.items.map((x: { name: string }) => x.name)).not.toContain('Filter only');
    const withInactive = await w.member.agent.get('/api/v1/project-types?includeInactive=true');
    const row = withInactive.body.items.find((x: { name: string }) => x.name === 'Filter only');
    expect(row).toMatchObject({ active: false, usedBy: null });
  });
});
