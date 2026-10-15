import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ActivityLogModel,
  FolderModel,
  LookupModel,
  MigrationModel,
  ProjectModel,
  ProjectTypeModel,
  TaskModel,
  TimeEntryModel,
  UserModel,
} from '../src/models/index.js';
import { ensureDefaultLookups, ensureQuickActivityType } from '../src/services/tracker.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';
import { SMALL_TEMPLATE, grant, publishedTemplate, resetRules, world } from './m2helpers.js';
import { FILES, uploadEvidence } from './m3helpers.js';
import { lookups } from './trackerHelpers.js';

/**
 * m8-polish (doc 14 v1.2.4 §A, B, E, F; doc 11 v0.4.13 FR-ACL-19..22).
 * "Now" is Wed Oct 14, 2026 10:00 Manila time (mocked in specific tests that need it).
 */
useDatabase();
const app = makeApp();
type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

// Set fake timers AFTER database connection is established
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T02:00:00Z')); // Oct 14, 2026 10:00 AM PHT
});

afterEach(async () => {
  await resetRules();
  await TimeEntryModel.deleteMany({});
  await LookupModel.deleteMany({});
  await MigrationModel.deleteMany({});
  // Reset to the base mocked time after each test
  vi.setSystemTime(new Date('2026-10-14T02:00:00Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

const base = (w: W) => `/api/v1/projects/${w.project.id}`;
async function tasks(w: W, agent: Agent = w.pm.agent) {
  return (await agent.get(`${base(w)}/tasks`)).body.items as {
    id: string;
    phase: string | null;
    deletable: boolean;
    deleteBlockedReason: string | null;
    deleteBlockedBy: string[];
  }[];
}
const del = (agent: Agent, id: string) => agent.delete(`/api/v1/tasks/${id}`).set(CSRF);
const setStatus = (w: W, status: string) =>
  ProjectModel.updateOne({ _id: w.project.id }, { $set: { status } });
const time = (w: W, taskId: string) =>
  TimeEntryModel.create({
    userId: w.member.user._id,
    projectId: w.project.id,
    taskId,
    workDate: new Date('2026-10-13T00:00:00Z'),
    hours: 1,
  });

describe('FR-PRJ-21: activity delete (Project PM or Admin; ACTIVITY_IN_USE)', () => {
  it('a PM on the team list may delete; a PM outside the project gets 404 (DEF-015); Members 403', async () => {
    const w = await world(app);
    const [a, b] = await tasks(w);
    // DEF-015 (NFR-25): a PM neither manager nor on the team list gets 404 with the same body.
    const outside = await del(w.pm2.agent, a!.id);
    expect(outside.status).toBe(404);
    expect(outside.body.error.code).toBe('NOT_FOUND');
    expect((await del(w.member.agent, a!.id)).status).toBe(403);
    await ProjectModel.updateOne({ _id: w.project.id }, { $push: { memberIds: w.pm2.user._id } });
    expect((await tasks(w, w.pm2.agent))[0]!.deletable).toBe(true);
    expect((await del(w.pm2.agent, a!.id)).status).toBe(204);
    // EC-83: no manager set, team-list PMs can still delete.
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { managerId: null } });
    expect((await del(w.pm2.agent, b!.id)).status).toBe(204);
  });

  it('blockedBy lists time, evidence, documents, issues in fixed order; Admins too; not audited', async () => {
    const w = await world(app);
    const [t, u] = await tasks(w);
    await time(w, t!.id);
    expect((await uploadEvidence(w.pm.agent, t!.id, 'a.pdf', FILES.pdf())).status).toBe(201);
    for (const agent of [w.pm.agent, w.admin.agent]) {
      const res = await del(agent, t!.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ACTIVITY_IN_USE');
      expect(res.body.error.details.blockedBy).toEqual(['time', 'evidence']);
      expect(res.body.error.message).toBe(
        "Can't delete: this activity has logged time and evidence files.",
      );
    }
    const row = (await tasks(w)).find((x) => x.id === t!.id)!;
    expect(row).toMatchObject({ deletable: false, deleteBlockedBy: ['time', 'evidence'] });
    expect(await TaskModel.exists({ _id: t!.id })).not.toBeNull();
    expect(await ActivityLogModel.exists({ entityId: t!.id, action: 'task_deleted' })).toBeNull();
    // issues + time on u → ["time","issues"]
    await time(w, u!.id);
    const issue = await w.pm.agent
      .post(`${base(w)}/issues`)
      .set(CSRF)
      .send({
        title: 'Linked',
        description: 'x',
        severity: 'LOW',
        stage: 'BEFORE_GO_LIVE',
        taskIds: [u!.id],
      });
    expect(issue.status).toBe(201);
    const r2 = await del(w.admin.agent, u!.id);
    expect(r2.body.error.details.blockedBy).toEqual(['time', 'issues']);
    expect(r2.body.error.message).toBe("Can't delete: this activity has logged time and issues.");
  });

  it('AC-46.4: Admins and the PM delete unattached activities on a Completed project', async () => {
    const w = await world(app);
    const [t, u, v] = await tasks(w);
    await setStatus(w, 'COMPLETED');
    expect((await del(w.pm.agent, v!.id)).status).toBe(204);
    expect((await del(w.admin.agent, t!.id)).status).toBe(204);
    await time(w, u!.id);
    expect((await del(w.admin.agent, u!.id)).body.error.code).toBe('ACTIVITY_IN_USE');
  });
});

describe('FR-PRJ-22/23: phase editing (PMs only in Planning)', () => {
  it('a PM renames a phase in Planning (audited); outside Planning 422; back in Planning it reopens', async () => {
    const w = await world(app);
    const phase = (await tasks(w))[0]!.phase!;
    const ph = (await w.pm.agent.get(`${base(w)}/phases`)).body.items[0];
    expect(ph.editable).toBe(true);
    const ren = await w.pm.agent
      .patch(`${base(w)}/phases`)
      .set(CSRF)
      .send({ name: phase, newName: 'Renamed phase' });
    expect(ren.status).toBe(200);
    expect((await tasks(w)).some((t) => t.phase === 'Renamed phase')).toBe(true);
    expect(await ActivityLogModel.exists({ action: 'phase_updated' })).not.toBeNull();
    await setStatus(w, 'ACTIVE');
    const ph2 = (await w.pm.agent.get(`${base(w)}/phases`)).body.items[0];
    expect(ph2).toMatchObject({ editable: false, deletable: false, deleteBlockedReason: null });
    const locked = await w.pm.agent
      .patch(`${base(w)}/phases`)
      .set(CSRF)
      .send({ name: 'Renamed phase', newName: 'X' });
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe('PROJECT_NOT_PLANNING');
    expect(locked.body.error.message).toBe(
      'Phase details can only be changed while the project is in Planning.',
    );
    const delPh = await w.pm.agent
      .delete(`${base(w)}/phases?name=${encodeURIComponent('Renamed phase')}`)
      .set(CSRF);
    expect(delPh.body.error.code).toBe('PROJECT_NOT_PLANNING');
    // Adding an activity still works outside Planning (Q-64).
    const add = await w.pm.agent
      .post(`${base(w)}/tasks`)
      .set(CSRF)
      .send({ name: 'Extra', phase: 'Renamed phase' });
    expect(add.status).toBe(201);
    // Admins at any status (AC-47.3).
    await setStatus(w, 'COMPLETED');
    expect(
      (
        await w.admin.agent
          .patch(`${base(w)}/phases`)
          .set(CSRF)
          .send({ name: 'Renamed phase', newName: 'Admin name' })
      ).status,
    ).toBe(200);
    // Q-55: back to Planning reopens it for the PM.
    await setStatus(w, 'PLANNING');
    expect(
      (
        await w.pm.agent
          .patch(`${base(w)}/phases`)
          .set(CSRF)
          .send({ name: 'Admin name', newName: 'PM again' })
      ).status,
    ).toBe(200);
  });

  it('other PMs get 404 (DEF-015), Members 403; duplicate name 409; unknown phase 404', async () => {
    const w = await world(app);
    const all = await tasks(w);
    const names = [...new Set(all.map((t) => t.phase).filter(Boolean))] as string[];
    const send = (a: Agent, body: object) =>
      a
        .patch(`${base(w)}/phases`)
        .set(CSRF)
        .send(body);
    expect((await send(w.pm2.agent, { name: names[0], newName: 'Z' })).status).toBe(404);
    expect(
      (
        await w.pm2.agent
          .post(`${base(w)}/phases`)
          .set(CSRF)
          .send({ name: 'New one' })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.pm2.agent
          .delete(`${base(w)}/phases`)
          .set(CSRF)
          .send({ name: names[0] })
      ).status,
    ).toBe(404);
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'PLANNING' } });
    expect(
      (
        await w.pm2.agent
          .post(`${base(w)}/apply-template`)
          .set(CSRF)
          .send({ templateId: w.template.id })
      ).status,
    ).toBe(404);
    expect((await send(w.member.agent, { name: names[0], newName: 'Z' })).status).toBe(403);
    expect((await send(w.pm.agent, { name: 'Nope', newName: 'Z' })).status).toBe(404);
    if (names.length > 1) {
      const dup = await send(w.pm.agent, { name: names[0], newName: names[1] });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('DUPLICATE_NAME');
    }
  });
});

describe('NFR-30: My tasks return plannedStart', () => {
  it('Today, Due and Assigned to me items carry plannedStart (or null)', async () => {
    const w = await world(app);
    const [t, u] = await tasks(w);
    await TaskModel.updateOne(
      { _id: t!.id },
      {
        $set: {
          assigneeIds: [w.member.user._id],
          plannedStart: new Date('2026-10-13T00:00:00Z'),
          dueDate: new Date('2026-10-13T00:00:00Z'),
          status: 'TODO',
        },
      },
    );
    await TaskModel.updateOne(
      { _id: u!.id },
      {
        $set: {
          assigneeIds: [w.member.user._id],
          plannedStart: null,
          dueDate: new Date('2026-10-13T00:00:00Z'),
          status: 'TODO',
        },
      },
    );
    for (const view of ['today', 'due', 'assigned']) {
      const res = await w.member.agent.get(`/api/v1/tasks/mine?view=${view}`);
      expect(res.status).toBe(200);
      const items = res.body.items as { id: string; plannedStart: string | null }[];
      expect(items.find((i) => i.id === t!.id)?.plannedStart, view).toBe('2026-10-13');
      for (const i of items) expect(i).toHaveProperty('plannedStart');
      if (view !== 'today') expect(items.find((i) => i.id === u!.id)?.plannedStart).toBeNull();
    }
  });
});

describe('FR-ACL-21 / NFR-32: GET /me/permissions', () => {
  it('returns myTasksTabs and defaultTab (always present) plus Setup children; old fields kept', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const a = (await admin.agent.get('/api/v1/auth/me/permissions')).body;
    expect(a.role).toBe('ADMIN');
    expect(a.permissions.tasks.view).toBe(true);
    expect(a.myTasksTabs).toEqual([
      'today',
      'day-timesheet',
      'due',
      'assigned',
      'accountable',
      'review',
      'completed',
    ]);
    expect(a.defaultTab).toBe('today');
    expect(a.setupItems).toEqual([
      'templates',
      'clients',
      'workload',
      'reports',
      'admin',
      'accessRules',
    ]);
    expect(a).toMatchObject({ canCreateProject: true, canCreateTask: true });
    // AC-51.4: the seeded Viewer has tasks.view but no time.view → Due.
    const viewer = await signedInAs(app, 'VIEWER');
    const v = (await viewer.agent.get('/api/v1/auth/me/permissions')).body;
    expect(v.myTasksTabs).toEqual(['due', 'assigned', 'accountable', 'completed']);
    expect(v.defaultTab).toBe('due');
    expect(v.setupItems).toEqual(['templates', 'clients', 'workload', 'reports']);
    expect(v.canCreateProject).toBe(false);
  });

  it('AC-51.5 / AC-50.3: no tab or Setup child allowed → [], null, []', async () => {
    await grant(app, 'VIEWER', {
      tasks: { view: false },
      time: { view: false },
      templates: { view: false },
      clients: { view: false },
      contacts: { view: false },
      workload: { view: false },
      reports: { view: false, export: false },
    });
    const viewer = await signedInAs(app, 'VIEWER');
    const v = (await viewer.agent.get('/api/v1/auth/me/permissions')).body;
    expect(v.myTasksTabs).toEqual([]);
    expect(v.defaultTab).toBeNull();
    expect(v.setupItems).toEqual([]);
  });
});

describe('FR-ACT-32/33: Quick Activity system type and FUTURE_DATE', () => {
  it('seeds quick_activity once with key/system; rename, deactivate, delete → 422 SYSTEM_ACTIVITY_TYPE', async () => {
    await ensureDefaultLookups();
    await ensureDefaultLookups();
    expect(await LookupModel.countDocuments({ key: 'quick_activity' })).toBe(1);
    const admin = await signedInAs(app, 'ADMIN');
    const opts = (await admin.agent.get('/api/v1/lookups')).body.activityTypes as {
      id: string;
      key: string | null;
      system: boolean;
      name: string;
    }[];
    const qa = opts.find((o) => o.key === 'quick_activity')!;
    expect(qa).toMatchObject({ name: 'Quick Activity', system: true });
    expect(opts.find((o) => o.name === 'Configuration')).toMatchObject({
      key: null,
      system: false,
    });
    const all = (await admin.agent.get('/api/v1/lookups/activity-types/all')).body.items;
    expect(all.find((i: { id: string }) => i.id === qa.id)).toMatchObject({ system: true });
    for (const body of [{ name: 'QA' }, { active: false }]) {
      const r = await admin.agent.patch(`/api/v1/lookups/${qa.id}`).set(CSRF).send(body);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('SYSTEM_ACTIVITY_TYPE');
    }
    const d = await admin.agent.delete(`/api/v1/lookups/${qa.id}`).set(CSRF);
    expect(d.body.error.code).toBe('SYSTEM_ACTIVITY_TYPE');
    // Can't be a project type default.
    const pt = await ProjectTypeModel.create({ name: 'PT x', nameKey: 'pt x', active: true });
    const r = await admin.agent
      .patch(`/api/v1/project-types/${pt._id.toString()}`)
      .set(CSRF)
      .send({ defaultActivityTypeId: qa.id });
    expect(r.status).toBe(422);
  });

  it('EC-90: an Admin-made "Quick Activity" is renamed "Quick Activity (custom)" (idempotent, audited)', async () => {
    const custom = await LookupModel.create({
      kind: 'ACTIVITY_TYPE',
      name: 'Quick Activity',
      nameKey: 'quick activity',
    });
    expect(await ensureQuickActivityType()).toBe(1);
    expect(await ensureQuickActivityType()).toBe(0);
    expect((await LookupModel.findById(custom._id).lean())!.name).toBe('Quick Activity (custom)');
    expect(await LookupModel.countDocuments({ key: 'quick_activity', system: true })).toBe(1);
    const log = await ActivityLogModel.findOne({ entityId: custom._id }).lean();
    expect(log).toMatchObject({ actorId: null, action: 'lookup_updated' });
  });

  it('a quick activity with Quick Activity is not billable by default; future dates → 422 FUTURE_DATE', async () => {
    const w = await world(app);
    const l = await lookups();
    await UserModel.updateOne({ _id: w.member.user._id }, { supervisorId: w.pm.user._id });
    const qa = (await LookupModel.findOne({ key: 'quick_activity' }).lean())!._id.toString();
    // Oct 13 is yesterday (still within the 2-day lock window).
    const ok = await w.member.agent.post('/api/v1/tracker/entries').set(CSRF).send({
      title: 'Email triage',
      activityTypeId: qa,
      date: '2026-10-13',
      timeIn: '08:00',
      timeOut: '09:00',
      dayLocationId: l.onsite,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.entry.billable).toBe(false);
    // Future date: 2099-01-01 is far in the future.
    const fut = await w.member.agent.post('/api/v1/tracker/entries').set(CSRF).send({
      title: 'Tomorrow',
      activityTypeId: qa,
      date: '2099-01-01',
      timeIn: '08:00',
      timeOut: '09:00',
      dayLocationId: l.onsite,
    });
    expect(fut.status).toBe(422);
    expect(fut.body.error.code).toBe('FUTURE_DATE');
    const [t] = await tasks(w);
    const ft = await w.member.agent.post('/api/v1/time').set(CSRF).send({
      taskId: t!.id,
      workDate: '2099-01-01',
      hours: 1,
      activityTypeId: l.configuration,
      module: l.financials,
    });
    expect(ft.status).toBe(422);
    expect(ft.body.error.code).toBe('FUTURE_DATE');
  });
});

describe('m8-polish: optional template, add phase, apply template', () => {
  async function blank(w: W, extra: object = {}) {
    const res = await w.pm.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send({
        name: 'Blank P',
        projectTypeId: (await ProjectModel.findById(
          w.project.id,
        ).lean())!.projectTypeId!.toString(),
        clientId: w.acme.client.id,
        managerId: w.pm.user._id.toString(),
        memberIds: [w.pm2.user._id.toString()],
        startDate: '2026-10-12',
        plannedEndDate: '2026-12-18',
        ...extra,
      });
    expect(res.status).toBe(201);
    return res.body.project as { id: string; templateId: string | null };
  }

  it('creates a project with no template (omitted or null): empty plan', async () => {
    const w = await world(app);
    const p = await blank(w);
    expect(p.templateId).toBeNull();
    expect(await TaskModel.countDocuments({ projectId: p.id })).toBe(0);
    const p2 = await blank(w, { name: 'Blank 2', templateId: null });
    expect(await TaskModel.countDocuments({ projectId: p2.id })).toBe(0);
  });

  it('a team-list PM adds a phase and activities in Planning, then applies nothing twice', async () => {
    const w = await world(app);
    const p = await blank(w);
    const url = `/api/v1/projects/${p.id}`;
    // pm2 is on the team list (not the manager): a Project PM.
    const add = await w.pm2.agent.post(`${url}/phases`).set(CSRF).send({ name: 'Discovery' });
    expect(add.status).toBe(201);
    expect(
      (await w.pm2.agent.post(`${url}/phases`).set(CSRF).send({ name: 'discovery' })).status,
    ).toBe(409);
    const phases = (await w.pm2.agent.get(`${url}/phases`)).body.items;
    expect(phases).toEqual([expect.objectContaining({ name: 'Discovery', editable: true })]);
    const t = await w.pm2.agent
      .post(`${url}/tasks`)
      .set(CSRF)
      .send({ name: 'Kickoff', phase: 'Discovery' });
    expect(t.status).toBe(201);
    const edit = await w.pm2.agent
      .patch(`/api/v1/tasks/${t.body.task.id}`)
      .set(CSRF)
      .send({ name: 'Kickoff call', version: t.body.task.version });
    expect(edit.status).toBe(200);
    // Members can't add phases.
    expect(
      (await w.member.agent.post(`${url}/phases`).set(CSRF).send({ name: 'X' })).status,
    ).not.toBe(201);
    // Outside Planning: adding a phase is locked, adding an activity isn't.
    await ProjectModel.updateOne({ _id: p.id }, { $set: { status: 'ACTIVE' } });
    const locked = await w.pm2.agent.post(`${url}/phases`).set(CSRF).send({ name: 'Later' });
    expect(locked.body.error.code).toBe('PROJECT_NOT_PLANNING');
    expect(
      (await w.pm2.agent.post(`${url}/tasks`).set(CSRF).send({ name: 'More', phase: 'Discovery' }))
        .status,
    ).toBe(201);
  });

  it('FR-PRJ-32: a team-list PM renames and deletes phases in Planning; PHASE_NOT_EMPTY blocks Admins too', async () => {
    const w = await world(app);
    const p = await blank(w);
    const url = `/api/v1/projects/${p.id}`;
    const admin = await signedInAs(app, 'ADMIN');
    expect((await w.pm2.agent.post(`${url}/phases`).set(CSRF).send({ name: 'Build' })).status).toBe(
      201,
    );
    const rename = await w.pm2.agent
      .patch(`${url}/phases`)
      .set(CSRF)
      .send({ name: 'Build', newName: 'Discovery' });
    expect(rename.status).toBe(200);
    const t = await w.pm2.agent
      .post(`${url}/tasks`)
      .set(CSRF)
      .send({ name: 'K', phase: 'Discovery' });
    expect(t.status).toBe(201);
    for (const agent of [w.pm2.agent, admin.agent]) {
      const res = await agent.delete(`${url}/phases`).set(CSRF).send({ name: 'Discovery' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHASE_NOT_EMPTY');
      expect(res.body.error.details.activityCount).toBe(1);
      expect(res.body.error.message).toBe(
        "Can't delete: this phase still has 1 activity. Delete it first.",
      );
    }
    expect(await ActivityLogModel.exists({ action: 'phase_deleted' })).toBeNull();
    expect(
      (await w.pm2.agent.delete(`${url}/phases`).set(CSRF).send({ name: 'Nope' })).status,
    ).toBe(404);
    expect(
      (await w.member.agent.delete(`${url}/phases`).set(CSRF).send({ name: 'Discovery' })).status,
    ).not.toBe(204);
    expect((await w.pm2.agent.delete(`/api/v1/tasks/${t.body.task.id}`).set(CSRF)).status).toBe(
      204,
    );
    // Outside Planning the lock applies to PMs only.
    await ProjectModel.updateOne({ _id: p.id }, { $set: { status: 'ACTIVE' } });
    const locked = await w.pm2.agent.delete(`${url}/phases`).set(CSRF).send({ name: 'Discovery' });
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe('PROJECT_NOT_PLANNING');
    await ProjectModel.updateOne({ _id: p.id }, { $set: { status: 'PLANNING' } });
    const ok = await w.pm2.agent.delete(`${url}/phases`).set(CSRF).send({ name: 'Discovery' });
    expect(ok.status).toBe(204);
    expect(await FolderModel.exists({ projectId: p.id, kind: 'PHASE' })).toBeNull();
    expect(await ActivityLogModel.exists({ action: 'phase_deleted' })).not.toBeNull();
    expect((await w.pm2.agent.get(`${url}/phases`)).body.items).toEqual([]);
    // Admins delete at any status.
    await admin.agent.post(`${url}/phases`).set(CSRF).send({ name: 'Late' });
    await ProjectModel.updateOne({ _id: p.id }, { $set: { status: 'ACTIVE' } });
    expect((await admin.agent.delete(`${url}/phases?name=Late`).set(CSRF)).status).toBe(204);
  });

  it('FR-PRJ-21: a team-list PM (not the manager) applies a template', async () => {
    const w = await world(app);
    const p = await blank(w);
    const res = await w.pm2.agent
      .post(`/api/v1/projects/${p.id}/apply-template`)
      .set(CSRF)
      .send({ templateId: w.template.id });
    expect(res.status).toBe(200);
    expect(res.body.phasesAdded).toBeGreaterThan(0);
  });

  it('DEF-016: empty template phases are saved and listed; a second apply adds 0 phases', async () => {
    const w = await world(app);
    const tpl = await publishedTemplate(w.admin.agent, {
      ...SMALL_TEMPLATE,
      name: 'Four phases',
      phases: [
        ...(SMALL_TEMPLATE.phases ?? []),
        { id: 'pc', name: 'Go-live' },
        { id: 'pd', name: 'Hypercare' },
      ],
    });
    const p = await blank(w);
    const url = `/api/v1/projects/${p.id}`;
    const first = await w.pm.agent
      .post(`${url}/apply-template`)
      .set(CSRF)
      .send({ templateId: tpl.id });
    expect(first.body).toMatchObject({ phasesAdded: 4, phasesMerged: 0, tasksAdded: 3 });
    const names = (await w.pm.agent.get(`${url}/phases`)).body.items.map(
      (x: { name: string }) => x.name,
    );
    expect(names).toEqual(['Phase A', 'Phase B', 'Go-live', 'Hypercare']);
    const folders = await FolderModel.countDocuments({ projectId: p.id });
    const second = await w.pm.agent
      .post(`${url}/apply-template`)
      .set(CSRF)
      .send({ templateId: tpl.id });
    expect(second.body).toMatchObject({
      phasesAdded: 0,
      phasesMerged: 4,
      tasksAdded: 0,
      alreadyApplied: true,
    });
    expect((await w.pm.agent.get(`${url}/phases`)).body.items).toHaveLength(4);
    expect(await FolderModel.countDocuments({ projectId: p.id })).toBe(folders);
    expect(await TaskModel.countDocuments({ projectId: p.id })).toBe(3);
    // Invariant: added + merged == template phases, with one phase already there (name differs
    // only by case and spaces).
    const p2 = await blank(w, { name: 'Blank one phase' });
    const url2 = `/api/v1/projects/${p2.id}`;
    await w.pm.agent.post(`${url2}/phases`).set(CSRF).send({ name: ' phase a ' });
    const mixed = await w.pm.agent
      .post(`${url2}/apply-template`)
      .set(CSRF)
      .send({ templateId: tpl.id });
    expect(mixed.body).toMatchObject({ phasesAdded: 3, phasesMerged: 1 });
    expect((await w.pm.agent.get(`${url2}/phases`)).body.items).toHaveLength(4);
  });

  it('DEF-016: 2-phase template: added + merged == 2 on empty, one-match and second apply', async () => {
    const w = await world(app);
    const p = await blank(w);
    const url = `/api/v1/projects/${p.id}`;
    const apply = async () =>
      (await w.pm.agent.post(`${url}/apply-template`).set(CSRF).send({ templateId: w.template.id }))
        .body as { phasesAdded: number; phasesMerged: number };
    expect(await apply()).toMatchObject({ phasesAdded: 2, phasesMerged: 0 });
    expect(await apply()).toMatchObject({ phasesAdded: 0, phasesMerged: 2 });
    expect((await w.pm.agent.get(`${url}/phases`)).body.items).toHaveLength(2);
    const p2 = await blank(w, { name: 'One match' });
    await w.pm.agent.post(`/api/v1/projects/${p2.id}/phases`).set(CSRF).send({ name: 'PHASE B' });
    const one = await w.pm.agent
      .post(`/api/v1/projects/${p2.id}/apply-template`)
      .set(CSRF)
      .send({ templateId: w.template.id });
    expect(one.body).toMatchObject({ phasesAdded: 1, phasesMerged: 1 });
  });

  it('applies a template (append only, Q-67), keeps the starting template (Q-68), creates phase folders', async () => {
    const w = await world(app);
    const p = await blank(w);
    const url = `/api/v1/projects/${p.id}/apply-template`;
    expect(
      (await w.member.agent.post(url).set(CSRF).send({ templateId: w.template.id })).status,
    ).toBe(404);
    // An existing hand-made phase and activity come first.
    await w.pm.agent
      .post(`/api/v1/projects/${p.id}/tasks`)
      .set(CSRF)
      .send({ name: 'Mine', phase: 'Own phase' });
    const ok = await w.pm.agent.post(url).set(CSRF).send({ templateId: w.template.id });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      alreadyApplied: false,
      phasesMerged: 0,
      template: { id: w.template.id },
    });
    const tplPhases = ok.body.phasesAdded as number;
    expect(tplPhases).toBeGreaterThan(0);
    expect(ok.body.project.templateId).toBeNull();
    const n = ok.body.tasksAdded as number;
    expect(n).toBeGreaterThan(0);
    const all = await TaskModel.find({ projectId: p.id }).sort({ order: 1 }).lean();
    expect(all).toHaveLength(n + 1);
    expect(all[0]!.name).toBe('Mine');
    expect(await FolderModel.countDocuments({ projectId: p.id, kind: 'PHASE' })).toBeGreaterThan(1);
    expect(
      await ActivityLogModel.exists({ entityId: p.id, action: 'template_applied' }),
    ).not.toBeNull();
    // EC-95 / DEF-016: applying again adds nothing; no new phases, tasks or folders.
    const folders = await FolderModel.countDocuments({ projectId: p.id });
    const again = await w.pm.agent.post(url).set(CSRF).send({ templateId: w.template.id });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      alreadyApplied: true,
      phasesAdded: 0,
      phasesMerged: tplPhases,
      tasksAdded: 0,
    });
    expect(await TaskModel.countDocuments({ projectId: p.id })).toBe(n + 1);
    expect(await FolderModel.countDocuments({ projectId: p.id })).toBe(folders);
    expect((await w.pm.agent.get(`/api/v1/projects/${p.id}/phases`)).body.items).toHaveLength(
      tplPhases + 1,
    );
    // A deleted activity comes back on reapply; a renamed one counts as different.
    const tpl = await TaskModel.find({ projectId: p.id, name: { $ne: 'Mine' } })
      .sort({ order: 1 })
      .lean();
    await TaskModel.deleteOne({ _id: tpl[0]!._id });
    await TaskModel.updateOne({ _id: tpl[1]!._id }, { $set: { name: `  ${tpl[1]!.name} (mine)` } });
    // Case and outer spaces don't make a new activity.
    await TaskModel.updateOne(
      { _id: tpl[2]!._id },
      { $set: { name: ` ${tpl[2]!.name.toUpperCase()} ` } },
    );
    const third = await w.pm.agent.post(url).set(CSRF).send({ templateId: w.template.id });
    expect(third.body).toMatchObject({ phasesAdded: 0, tasksAdded: 2 });
    const back = await TaskModel.find({
      projectId: p.id,
      name: { $in: [tpl[0]!.name, tpl[1]!.name] },
    }).lean();
    expect(back.map((t) => t.phase).sort()).toEqual([tpl[0]!.phase, tpl[1]!.phase].sort());
    expect(await TaskModel.countDocuments({ projectId: p.id })).toBe(n + 2);
    const p2 = await blank(w, { name: 'Blank 3' });
    await ProjectModel.updateOne({ _id: p2.id }, { $set: { status: 'ACTIVE' } });
    const np = await w.admin.agent
      .post(`/api/v1/projects/${p2.id}/apply-template`)
      .set(CSRF)
      .send({ templateId: w.template.id });
    expect(np.status).toBe(422);
    expect(np.body.error.code).toBe('PROJECT_NOT_PLANNING');
  });
});

describe('Tracked quick activities count toward logged and recorded totals', () => {
  it('Logged this week (loggedTotal) and Team & workload Recorded include quick activities', async () => {
    const w = await world(app);
    for (const [i, h] of [1, 1.5, 1.5].entries()) {
      await TimeEntryModel.create({
        userId: w.member.user._id,
        kind: 'QUICK',
        title: `Quick ${i}`,
        workDate: new Date('2026-10-13T00:00:00Z'),
        hours: h,
        minutes: h * 60,
        billable: false,
      });
    }
    const week = await w.member.agent.get('/api/v1/time?week=2026-10-13');
    expect(week.status).toBe(200);
    expect(week.body).toMatchObject({ total: 0, loggedTotal: 4, items: [] });
    const wl = await w.admin.agent.get('/api/v1/workload?week=2026-10-13');
    expect(wl.status).toBe(200);
    const row = wl.body.items.find(
      (r: { person: { id: string } }) => r.person.id === w.member.user._id.toString(),
    );
    expect(row.recordedHours).toBe(4);
    // Project time adds on top.
    await TimeEntryModel.create({
      userId: w.member.user._id,
      projectId: w.project.id,
      taskId: (await TaskModel.findOne({ projectId: w.project.id }).lean())!._id,
      workDate: new Date('2026-10-13T00:00:00Z'),
      hours: 1,
    });
    expect((await w.member.agent.get('/api/v1/time?week=2026-10-13')).body).toMatchObject({
      total: 1,
      loggedTotal: 5,
    });
  });
});

describe('AC-55.1 (Q-71): task time plus quick activity', () => {
  it('1h task + 30m quick = 1.5h logged this week and 1.5h recorded', async () => {
    const w = await world(app);
    await TimeEntryModel.create({
      userId: w.member.user._id,
      projectId: w.project.id,
      taskId: (await TaskModel.findOne({ projectId: w.project.id }).lean())!._id,
      workDate: new Date('2026-10-13T00:00:00Z'),
      hours: 1,
    });
    await TimeEntryModel.create({
      userId: w.member.user._id,
      kind: 'QUICK',
      title: 'Standup',
      workDate: new Date('2026-10-13T00:00:00Z'),
      hours: 0.5,
      minutes: 30,
      billable: false,
    });
    expect((await w.member.agent.get('/api/v1/time?week=2026-10-13')).body.loggedTotal).toBe(1.5);
    const row = (await w.admin.agent.get('/api/v1/workload?week=2026-10-13')).body.items.find(
      (r: { person: { id: string } }) => r.person.id === w.member.user._id.toString(),
    );
    expect(row.recordedHours).toBe(1.5);
  });
});
