import { afterEach, describe, expect, it } from 'vitest';
import { ActivityLogModel, ProjectModel, TaskModel } from '../src/models/index.js';
import { CSRF, createUser, makeApp, useDatabase } from './helpers.js';
import { grant, resetRules, world } from './m2helpers.js';

useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;

const membersOf = async (id: string) =>
  ((await ProjectModel.findById(id).lean())?.memberIds ?? []).map(String);
const firstTask = async (w: W) =>
  (await w.pm.agent.get(`/api/v1/projects/${w.project.id}/tasks`)).body.items[0] as {
    id: string;
    version: number;
  };

describe('FR-PRJ-19 / DEF-003: add someone to the project and assign them in one save', () => {
  it('without the flag, a non-member still cannot be owner or assignee', async () => {
    const w = await world(app);
    const t = await firstTask(w);
    const res = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t.version, ownerId: w.outsider.user._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
  });

  it('PM editing a task: adds the person to the members, makes them owner, audits both', async () => {
    const w = await world(app);
    const t = await firstTask(w);
    const id = w.outsider.user._id.toString();
    const res = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t.version, ownerId: id, addMemberIds: [id] });
    expect(res.status).toBe(200);
    expect(res.body.task.owner.id).toBe(id);
    expect(await membersOf(w.project.id)).toContain(id);
    const log = await ActivityLogModel.findOne({
      entityId: w.project.id,
      action: 'project_member_added',
    }).lean();
    expect(log).toMatchObject({
      actorId: w.pm.user._id,
      changes: [expect.objectContaining({ field: 'memberIds', old: null, new: id })],
      meta: { via: 'task_assign', taskId: t.id },
    });
    // The new member now sees the project.
    expect((await w.outsider.agent.get(`/api/v1/projects/${w.project.id}`)).status).toBe(200);
  });

  it('Admin adding a task: adds the person as an assignee on create', async () => {
    const w = await world(app);
    const id = w.outsider.user._id.toString();
    const res = await w.admin.agent
      .post(`/api/v1/projects/${w.project.id}/tasks`)
      .set(CSRF)
      .send({ name: 'Extra', assigneeIds: [id], addMemberIds: [id] });
    expect(res.status).toBe(201);
    expect(res.body.task.assignees.map((a: { id: string }) => a.id)).toEqual([id]);
    expect(await membersOf(w.project.id)).toContain(id);
  });

  it('is atomic: a stale version leaves the members unchanged and logs nothing', async () => {
    const w = await world(app);
    const t = await firstTask(w);
    const id = w.outsider.user._id.toString();
    const res = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t.version + 5, ownerId: id, addMemberIds: [id] });
    expect(res.status).toBe(409);
    expect(await membersOf(w.project.id)).not.toContain(id);
    expect(
      await ActivityLogModel.countDocuments({
        entityId: w.project.id,
        action: 'project_member_added',
      }),
    ).toBe(0);
    expect((await TaskModel.findById(t.id).lean())?.ownerId ?? null).toBeNull();
  });

  it('respects PM scope: another PM, a Member and a Viewer cannot add people', async () => {
    const w = await world(app);
    const t = await firstTask(w);
    const id = w.outsider.user._id.toString();
    for (const who of [w.pm2, w.member, w.viewer]) {
      const res = await who.agent
        .patch(`/api/v1/tasks/${t.id}`)
        .set(CSRF)
        .send({ version: t.version, ownerId: id, addMemberIds: [id] });
      expect(res.status).toBe(403);
    }
    expect(await membersOf(w.project.id)).not.toContain(id);
  });

  it('needs Edit on projects: a PM without it can plan but not add people', async () => {
    const w = await world(app);
    await grant(app, 'PROJECT_MANAGER', { projects: { edit: false } });
    const t = await firstTask(w);
    const id = w.outsider.user._id.toString();
    const res = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t.version, ownerId: id, addMemberIds: [id] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_ADD_MEMBERS');
    const project = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}`)).body.project;
    expect(project.can).toMatchObject({ planTasks: true, addMembers: false });
  });

  it('only adds people who are assigned in the same save, and only active internal users', async () => {
    const w = await world(app);
    const t = await firstTask(w);
    const id = w.outsider.user._id.toString();
    const bare = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({ version: t.version, name: 'Renamed', addMemberIds: [id] });
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe('ADD_MEMBER_NOT_ASSIGNED');

    const gone = await createUser({ active: false });
    const inactive = await w.pm.agent
      .patch(`/api/v1/tasks/${t.id}`)
      .set(CSRF)
      .send({
        version: t.version,
        ownerId: gone._id.toString(),
        addMemberIds: [gone._id.toString()],
      });
    expect(inactive.status).toBe(422);
    expect(await membersOf(w.project.id)).toEqual(
      expect.not.arrayContaining([id, gone._id.toString()]),
    );
  });

  it('project DTO exposes can.addMembers for Admin and the managing PM only', async () => {
    const w = await world(app);
    const can = async (who: W['pm']) =>
      (await who.agent.get(`/api/v1/projects/${w.project.id}`)).body.project.can.addMembers;
    expect(await can(w.admin)).toBe(true);
    expect(await can(w.pm)).toBe(true);
    expect(await can(w.pm2)).toBe(false);
    expect(await can(w.member)).toBe(false);
    expect(await can(w.viewer)).toBe(false);
  });
});
