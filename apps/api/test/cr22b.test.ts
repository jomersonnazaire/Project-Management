import { afterEach, describe, expect, it } from 'vitest';
import type { TimelineDto } from '@xc8/shared';
import { PHASE_MIGRATION_AUDIT_ACTION, migrateAllPhases } from '../scripts/lib/migratePhases.js';
import { ActivityLogModel, FolderModel, ProjectModel, TaskModel } from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { resetRules, world } from './m2helpers.js';

/** CR-22 Part B slice 1: timeline data, phase list with target dates, migration (FR-TL-01..07, 14, 23, 24). */
useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];

const timeline = async (agent: Agent, id: string) => {
  const res = await agent.get(`/api/v1/projects/${id}/timeline`);
  return res;
};
const savePhases = (agent: Agent, id: string, phases: unknown[]) =>
  agent.put(`/api/v1/projects/${id}/phase-list`).set(CSRF).send({ phases });
/** Data as it was before the phase migration: text phases only, no records, no phaseId. */
const preMigration = async (pid: string) => {
  await ProjectModel.updateOne({ _id: pid }, { $set: { phases: [] } });
  await TaskModel.updateMany({ projectId: pid }, { $set: { phaseId: null } });
};
const listOf = (tl: TimelineDto) =>
  tl.phases.map((p) => ({
    id: p.id,
    originalName: p.id ? null : p.name,
    name: p.name,
    targetDate: p.targetDate,
  }));

describe('CR-22 B: GET /projects/:id/timeline', () => {
  it('returns tasks, phases in order, calendar and today; planners get edit rights', async () => {
    const w = await world(app);
    const res = await timeline(w.pm.agent, w.project.id);
    expect(res.status).toBe(200);
    const tl = res.body as TimelineDto;
    expect(tl.project.plannedEndDate).toBe('2026-12-18');
    expect(tl.phases.map((p) => p.name)).toEqual(['Phase A', 'Phase B']);
    expect(tl.phases.map((p) => p.taskCount)).toEqual([2, 1]);
    expect(tl.tasks).toHaveLength(3);
    expect(tl.tasks[1]).toMatchObject({ name: 'Design', phase: 'Phase A' });
    expect(tl.tasks[1]!.dependsOn).toEqual([tl.tasks[0]!.id]);
    expect(tl.tasks[0]!.plannedStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tl.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tl.calendar.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(tl.can).toEqual({
      plan: true,
      editPhaseTargets: true,
      editPhaseNames: true,
      saveBaseline: true,
      excel: true,
      importExcel: true,
    });
  });

  it('FR-TL-14 / Q-142: members and viewers read it with no edit rights; outsiders get 404', async () => {
    const w = await world(app);
    const member = await timeline(w.member.agent, w.project.id);
    expect(member.status).toBe(200);
    expect(member.body.can).toEqual({
      plan: false,
      editPhaseTargets: false,
      editPhaseNames: false,
      saveBaseline: false,
      excel: false,
      importExcel: false,
    });
    const viewer = await timeline(w.viewer.agent, w.project.id);
    expect(viewer.status).toBe(200);
    expect(viewer.body.can.plan).toBe(false);
    expect((await timeline(w.outsider.agent, w.project.id)).status).toBe(404);
    // Part A: a PM not on the project doesn't see it (FR-PRJ-37).
    expect((await timeline(w.pm2.agent, w.project.id)).status).toBe(404);
  });

  it('Active project: PM may edit phase targets but not names; Completed: no rights', async () => {
    const w = await world(app);
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'ACTIVE' } });
    expect((await timeline(w.pm.agent, w.project.id)).body.can).toEqual({
      plan: true,
      editPhaseTargets: true,
      editPhaseNames: false,
      saveBaseline: true,
      excel: true,
      importExcel: true,
    });
    expect((await timeline(w.admin.agent, w.project.id)).body.can.editPhaseNames).toBe(true);
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'COMPLETED' } });
    expect((await timeline(w.pm.agent, w.project.id)).body.can).toEqual({
      plan: false,
      editPhaseTargets: false,
      editPhaseNames: false,
      saveBaseline: false,
      // CR-22 B3: a planner can still download the timeline of a completed project.
      excel: true,
      importExcel: false,
    });
  });
});

describe('CR-22 B: phase manager PUT /projects/:id/phase-list (FR-TL-23, AC-72.6, AC-73.14)', () => {
  it('Planning PM: sets targets, reorders, renames and adds; all audited; tasks follow renames', async () => {
    const w = await world(app);
    const tl = (await timeline(w.pm.agent, w.project.id)).body as TimelineDto;
    const [a, b] = listOf(tl);
    const res = await savePhases(w.pm.agent, w.project.id, [
      { ...b, targetDate: '2026-11-20' },
      { ...a, name: 'Initiation', targetDate: '2026-10-30' },
      { name: 'Go-live', targetDate: '2026-12-14' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.targetsOnly).toBe(false);
    const after = (await timeline(w.pm.agent, w.project.id)).body as TimelineDto;
    expect(after.phases.map((p) => [p.name, p.targetDate])).toEqual([
      ['Phase B', '2026-11-20'],
      ['Initiation', '2026-10-30'],
      ['Go-live', '2026-12-14'],
    ]);
    expect(after.phases.every((p) => p.id)).toBe(true);
    expect(after.tasks.filter((t) => t.phase === 'Initiation')).toHaveLength(2);
    expect(
      await FolderModel.exists({ projectId: w.project.id, kind: 'PHASE', phase: 'Go-live' }),
    ).toBeTruthy();
    const logs = await ActivityLogModel.find({
      projectId: w.project.id,
      'meta.via': 'phase_manager',
    }).lean();
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual([
      'phase_created',
      'phase_updated',
      'phase_updated',
      'phase_updated',
      'phase_updated',
    ]);
    const target = logs.find(
      (l) => l.action === 'phase_updated' && (l.meta as { phase?: string })?.phase === 'Go-live',
    );
    expect(target?.changes).toEqual([{ field: 'targetDate', old: null, new: '2026-12-14' }]);
    expect(
      await ActivityLogModel.exists({ projectId: w.project.id, action: 'phases_reordered' }),
    ).toBeTruthy();
  });

  it('Active / On hold PM: target dates save (audited old → new, baseline untouched); structure is refused', async () => {
    const w = await world(app);
    const first = listOf((await timeline(w.pm.agent, w.project.id)).body);
    expect(
      (
        await savePhases(
          w.pm.agent,
          w.project.id,
          first.map((p, i) => ({ ...p, targetDate: `2026-11-1${i}` })),
        )
      ).status,
    ).toBe(200);
    const baselineBefore = (await ProjectModel.findById(w.project.id).lean())!.baselineHistory;
    for (const status of ['ACTIVE', 'ON_HOLD']) {
      await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status } });
      const cur = listOf((await timeline(w.pm.agent, w.project.id)).body);
      const ok = await savePhases(w.pm.agent, w.project.id, [
        { ...cur[0], targetDate: status === 'ACTIVE' ? '2026-11-24' : '2026-11-25' },
        cur[1],
      ]);
      expect(ok.status).toBe(200);
      expect(ok.body.targetsOnly).toBe(true);
      const renamed = await savePhases(w.pm.agent, w.project.id, [
        { ...cur[0], name: 'Renamed' },
        cur[1],
      ]);
      expect(renamed.status).toBe(422);
      expect(renamed.body.error.code).toBe('PROJECT_NOT_PLANNING');
      const reordered = await savePhases(w.pm.agent, w.project.id, [cur[1], cur[0]]);
      expect(reordered.body.error.code).toBe('PROJECT_NOT_PLANNING');
      const added = await savePhases(w.pm.agent, w.project.id, [
        ...cur,
        { name: 'New', targetDate: null },
      ]);
      expect(added.body.error.code).toBe('PROJECT_NOT_PLANNING');
    }
    const log = await ActivityLogModel.findOne({
      projectId: w.project.id,
      action: 'phase_updated',
      'changes.new': '2026-11-25',
    }).lean();
    expect(log?.changes).toEqual([{ field: 'targetDate', old: '2026-11-24', new: '2026-11-25' }]);
    expect((await ProjectModel.findById(w.project.id).lean())!.baselineHistory).toEqual(
      baselineBefore,
    );
    // Admin can restructure any time.
    const cur = listOf((await timeline(w.admin.agent, w.project.id)).body);
    expect((await savePhases(w.admin.agent, w.project.id, [cur[1], cur[0]])).status).toBe(200);
  });

  it('refuses removing a phase with tasks, duplicate names, members, and other PMs', async () => {
    const w = await world(app);
    const cur = listOf((await timeline(w.pm.agent, w.project.id)).body);
    const removed = await savePhases(w.pm.agent, w.project.id, [cur[0]]);
    expect(removed.status).toBe(409);
    expect(removed.body.error.code).toBe('PHASE_NOT_EMPTY');
    const dup = await savePhases(w.pm.agent, w.project.id, [
      cur[0],
      { ...cur[1], name: ' phase a ' },
    ]);
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe('DUPLICATE_NAME');
    expect((await savePhases(w.member.agent, w.project.id, cur)).status).toBe(403);
    expect((await savePhases(w.pm2.agent, w.project.id, cur)).status).toBe(404);
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'COMPLETED' } });
    expect((await savePhases(w.pm.agent, w.project.id, cur)).body.error.code).toBe('PHASES_LOCKED');
  });

  it('removes an empty phase from the list; stale ids are refused', async () => {
    const w = await world(app);
    const cur = listOf((await timeline(w.pm.agent, w.project.id)).body);
    expect(
      (await savePhases(w.pm.agent, w.project.id, [...cur, { name: 'Spare', targetDate: null }]))
        .status,
    ).toBe(200);
    const withSpare = listOf((await timeline(w.pm.agent, w.project.id)).body);
    expect(withSpare.map((p) => p.name)).toEqual(['Phase A', 'Phase B', 'Spare']);
    expect((await savePhases(w.pm.agent, w.project.id, withSpare.slice(0, 2))).status).toBe(200);
    const after = listOf((await timeline(w.pm.agent, w.project.id)).body);
    expect(after.map((p) => p.name)).toEqual(['Phase A', 'Phase B']);
    expect(
      await ActivityLogModel.exists({ projectId: w.project.id, action: 'phase_deleted' }),
    ).toBeTruthy();
    const stale = await savePhases(w.pm.agent, w.project.id, [
      ...after,
      { id: '0123456789abcdef01234567', name: 'Gone', targetDate: null },
    ]);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('PHASES_CHANGED');
  });

  it('existing phase routes keep the list in step; task phase text uses the list spelling', async () => {
    const w = await world(app);
    expect(
      (
        await w.pm.agent
          .post(`/api/v1/projects/${w.project.id}/phases`)
          .set(CSRF)
          .send({ name: 'Extra' })
      ).status,
    ).toBe(201);
    let tl = (await timeline(w.pm.agent, w.project.id)).body as TimelineDto;
    expect(tl.phases.map((p) => [p.name, Boolean(p.id)])).toEqual([
      ['Phase A', true],
      ['Phase B', true],
      ['Extra', true],
    ]);
    expect(
      (
        await w.pm.agent
          .patch(`/api/v1/projects/${w.project.id}/phases`)
          .set(CSRF)
          .send({ name: 'extra', newName: 'Extras' })
      ).status,
    ).toBe(200);
    const created = await w.pm.agent
      .post(`/api/v1/projects/${w.project.id}/tasks`)
      .set(CSRF)
      .send({ name: 'New one', phase: '  extras ' });
    expect(created.status).toBe(201);
    expect(created.body.task.phase).toBe('Extras');
    expect(created.body.task.phaseId).toBe(tl.phases[2]!.id);
    tl = (await timeline(w.pm.agent, w.project.id)).body as TimelineDto;
    expect(tl.phases.find((p) => p.name === 'Extras')?.taskCount).toBe(1);
    await TaskModel.deleteOne({ _id: created.body.task.id });
    expect(
      (await w.pm.agent.delete(`/api/v1/projects/${w.project.id}/phases?name=Extras`).set(CSRF))
        .status,
    ).toBe(204);
    tl = (await timeline(w.pm.agent, w.project.id)).body as TimelineDto;
    expect(tl.phases.map((p) => p.name)).toEqual(['Phase A', 'Phase B']);
  });
});

describe('CR-22 B: one-time phase migration (FR-TL-24, AC-72.7)', () => {
  it('dry run writes nothing; --apply creates records in task order, respells variants, audits once; re-run is a no-op', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    await preMigration(pid);
    const tasks = await TaskModel.find({ projectId: pid }).sort({ order: 1 });
    await TaskModel.updateOne({ _id: tasks[1]!._id }, { $set: { phase: ' phase a' } });
    const dry = await migrateAllPhases({ apply: false });
    const mine = dry.changed.find((p) => p.projectId === pid)!;
    expect(mine.added).toEqual(['Phase A', 'Phase B']);
    expect(mine.tasksLinked).toEqual([
      { taskId: tasks[0]!._id.toString(), from: 'Phase A', to: 'Phase A' },
      { taskId: tasks[1]!._id.toString(), from: ' phase a', to: 'Phase A' },
      { taskId: tasks[2]!._id.toString(), from: 'Phase B', to: 'Phase B' },
    ]);
    expect((await TaskModel.find({ projectId: pid }).lean()).every((t) => !t.phaseId)).toBe(true);
    expect((await ProjectModel.findById(pid).lean())!.phases).toEqual([]);

    const applied = await migrateAllPhases({ apply: true });
    expect(applied.changed.map((p) => p.projectId)).toContain(pid);
    const project = (await ProjectModel.findById(pid).lean())!;
    expect(project.phases.map((p) => [p.name, p.targetDate])).toEqual([
      ['Phase A', null],
      ['Phase B', null],
    ]);
    const after = await TaskModel.find({ projectId: pid }).sort({ order: 1 }).lean();
    expect(after.map((t) => t.phase)).toEqual(['Phase A', 'Phase A', 'Phase B']);
    const [a, b] = project.phases.map((p) => p._id.toString());
    expect(after.map((t) => t.phaseId?.toString())).toEqual([a, a, b]);
    expect(
      await ActivityLogModel.countDocuments({
        projectId: pid,
        action: PHASE_MIGRATION_AUDIT_ACTION,
      }),
    ).toBe(1);

    const again = await migrateAllPhases({ apply: true });
    expect(again.changed.find((p) => p.projectId === pid)).toBeUndefined();
    expect(
      await ActivityLogModel.countDocuments({
        projectId: pid,
        action: PHASE_MIGRATION_AUDIT_ACTION,
      }),
    ).toBe(1);
  });
});

describe('CR-22 B (Lead): tasks reference their phase by phaseId', () => {
  it('a task picks a phase record by id; renaming the phase keeps the task in it', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    let tl = (await timeline(w.pm.agent, pid)).body as TimelineDto;
    const phaseB = tl.phases[1]!;
    const created = await w.pm.agent
      .post(`/api/v1/projects/${pid}/tasks`)
      .set(CSRF)
      .send({ name: 'Picked', phaseId: phaseB.id });
    expect(created.status).toBe(201);
    expect(created.body.task).toMatchObject({ phaseId: phaseB.id, phase: 'Phase B' });
    const rename = listOf(tl).map((p) => (p.id === phaseB.id ? { ...p, name: 'Build' } : p));
    expect((await savePhases(w.pm.agent, pid, rename)).status).toBe(200);
    tl = (await timeline(w.pm.agent, pid)).body as TimelineDto;
    const picked = tl.tasks.find((t) => t.name === 'Picked')!;
    expect(picked).toMatchObject({ phaseId: phaseB.id, phase: 'Build' });
    expect(tl.phases.find((p) => p.id === phaseB.id)).toMatchObject({
      name: 'Build',
      taskCount: 2,
    });
    // Clearing the phase: No phase.
    const cleared = await w.pm.agent
      .patch(`/api/v1/tasks/${picked.id}`)
      .set(CSRF)
      .send({ phaseId: null, version: created.body.task.version + 1 });
    expect(cleared.status).toBe(200);
    expect(cleared.body.task).toMatchObject({ phaseId: null, phase: null });
  });

  it('rejects an unknown phaseId or a phase name that is not in the list (422 UNKNOWN_PHASE)', async () => {
    const w = await world(app);
    const pid = w.project.id as string;
    await preMigration(pid);
    const byId = await w.pm.agent
      .post(`/api/v1/projects/${pid}/tasks`)
      .set(CSRF)
      .send({ name: 'Bad', phaseId: '64b000000000000000000000' });
    expect(byId.status).toBe(422);
    expect(byId.body.error.code).toBe('UNKNOWN_PHASE');
    const byName = await w.pm.agent
      .post(`/api/v1/projects/${pid}/tasks`)
      .set(CSRF)
      .send({ name: 'Bad', phase: 'Not a phase' });
    expect(byName.status).toBe(422);
    expect(byName.body.error.code).toBe('UNKNOWN_PHASE');
    const project = (await ProjectModel.findById(pid).lean())!;
    expect(project.phases.map((p) => p.name)).not.toContain('Not a phase');
    // A name known only as task text (before the migration) still works, and gets its record.
    const ok = await w.pm.agent
      .post(`/api/v1/projects/${pid}/tasks`)
      .set(CSRF)
      .send({ name: 'Fine', phase: 'phase a' });
    expect(ok.status).toBe(201);
    expect(ok.body.task.phase).toBe('Phase A');
    expect(ok.body.task.phaseId).toMatch(/^[0-9a-f]{24}$/);
  });
});
