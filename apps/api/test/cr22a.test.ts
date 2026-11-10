import { afterEach, describe, expect, it } from 'vitest';
import { ProjectModel, TaskModel } from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { ptypeId, resetRules, world } from './m2helpers.js';

useDatabase();
const app = makeApp();
afterEach(resetRules);

type W = Awaited<ReturnType<typeof world>>;
type Agent = W['pm']['agent'];
interface T {
  id: string;
  name: string;
  version: number;
  dependsOn: string[];
}

const tasksOf = async (agent: Agent, projectId: string) =>
  (await agent.get(`/api/v1/projects/${projectId}/tasks`)).body.items as T[];
const fresh = async (agent: Agent, id: string) =>
  (await agent.get(`/api/v1/tasks/${id}`)).body.task as T;
const setDeps = async (agent: Agent, id: string, dependsOn: string[]) => {
  const t = await fresh(agent, id);
  return agent.patch(`/api/v1/tasks/${id}`).set(CSRF).send({ version: t.version, dependsOn });
};

/** Client tasks need a contact before any plan edit (AC-05.1); give the client task one. */
async function withContact(w: W, t: T) {
  const { version } = await fresh(w.pm.agent, t.id);
  const res = await w.pm.agent
    .patch(`/api/v1/tasks/${t.id}`)
    .set(CSRF)
    .send({ version, clientContactId: w.acme.active[0].id });
  expect(res.status).toBe(200);
}

/** A second project managed by `managerId`, created by the Admin. */
async function secondProject(w: W, managerId: string, memberIds: string[] = []) {
  const res = await w.admin.agent
    .post('/api/v1/projects')
    .set(CSRF)
    .send({
      name: 'Second P',
      projectTypeId: await ptypeId(),
      clientId: w.other.client.id,
      managerId,
      memberIds,
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: w.template.id,
    });
  expect(res.status).toBe(201);
  return res.body.project as { id: string };
}

describe('CR-22 A3: Depends On can be picked, changed and cleared', () => {
  it('adds several, removes one, clears all (empty list saves), and each save sticks', async () => {
    const w = await world(app);
    const [t1, t2, t3] = await tasksOf(w.pm.agent, w.project.id);
    await withContact(w, t3!);
    expect((await setDeps(w.pm.agent, t3!.id, [])).status).toBe(200);
    expect((await setDeps(w.pm.agent, t3!.id, [t1!.id, t2!.id])).body.task.dependsOn).toEqual([
      t1!.id,
      t2!.id,
    ]);
    expect((await fresh(w.pm.agent, t3!.id)).dependsOn).toEqual([t1!.id, t2!.id]);
    expect((await setDeps(w.pm.agent, t3!.id, [t2!.id])).body.task.dependsOn).toEqual([t2!.id]);
    expect((await setDeps(w.pm.agent, t3!.id, [])).body.task.dependsOn).toEqual([]);
    expect((await fresh(w.pm.agent, t3!.id)).dependsOn).toEqual([]);
  });

  it('rejects self, cycles and tasks of another project; nothing is saved', async () => {
    const w = await world(app);
    const [t1, t2] = await tasksOf(w.pm.agent, w.project.id);
    const self = await setDeps(w.pm.agent, t1!.id, [t1!.id]);
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe('DEPENDENCY_CYCLE');
    expect((await setDeps(w.pm.agent, t1!.id, [])).status).toBe(200);
    expect((await setDeps(w.pm.agent, t2!.id, [t1!.id])).status).toBe(200);
    const cycle = await setDeps(w.pm.agent, t1!.id, [t2!.id]);
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.code).toBe('DEPENDENCY_CYCLE');
    const other = await secondProject(w, w.pm.user._id.toString());
    const [o1] = await tasksOf(w.pm.agent, other.id);
    const cross = await setDeps(w.pm.agent, t1!.id, [o1!.id]);
    expect(cross.status).toBe(422);
    expect(cross.body.error.code).toBe('INVALID_DEPENDENCY');
    expect((await fresh(w.pm.agent, t1!.id)).dependsOn).toEqual([]);
  });

  it('deleting a task removes it from its dependents', async () => {
    const w = await world(app);
    const [t1, t2, t3] = await tasksOf(w.pm.agent, w.project.id);
    await withContact(w, t3!);
    expect((await setDeps(w.pm.agent, t2!.id, [])).status).toBe(200);
    expect((await setDeps(w.pm.agent, t3!.id, [t1!.id, t2!.id])).status).toBe(200);
    expect((await w.pm.agent.delete(`/api/v1/tasks/${t2!.id}`).set(CSRF)).status).toBe(204);
    expect((await fresh(w.pm.agent, t3!.id)).dependsOn).toEqual([t1!.id]);
    expect(await TaskModel.countDocuments({ dependsOn: t2!.id })).toBe(0);
  });
});

describe('CR-22 A1: a PM sees only projects they manage or are on', () => {
  it('list, detail, tasks, reports, exports and My projects follow the scope; Admin and Viewer see all', async () => {
    const w = await world(app);
    const other = await secondProject(w, w.pm2.user._id.toString());
    const mine = [w.project.id, other.id];
    // Only this test's two projects (the database is shared across the file's tests).
    const names = async (a: Agent) =>
      ((await a.get('/api/v1/projects?pageSize=100')).body.items as { id: string; name: string }[])
        .filter((p) => mine.includes(p.id))
        .map((p) => p.name)
        .sort();
    expect(await names(w.pm.agent)).toEqual(['Rollout P']);
    expect(await names(w.pm2.agent)).toEqual(['Second P']);
    expect(await names(w.admin.agent)).toEqual(['Rollout P', 'Second P']);
    expect(await names(w.viewer.agent)).toEqual(['Rollout P', 'Second P']);
    expect(await names(w.member.agent)).toEqual(['Rollout P']);

    // Direct links outside scope: 404, same as a Member.
    for (const path of [
      `/api/v1/projects/${other.id}`,
      `/api/v1/projects/${other.id}/tasks`,
      `/api/v1/projects/${other.id}/activity`,
    ]) {
      expect((await w.pm.agent.get(path)).status, path).toBe(404);
    }
    const [o1] = await tasksOf(w.pm2.agent, other.id);
    expect((await w.pm.agent.get(`/api/v1/tasks/${o1!.id}`)).status).toBe(404);

    // Reports (and their exports) and My projects only cover in-scope projects.
    const reportIds = async (a: Agent, path: string) =>
      ((await a.get(path)).body.items as { id: string }[]).map((p) => p.id);
    expect(await reportIds(w.pm.agent, '/api/v1/reports/project-status')).toEqual([w.project.id]);
    expect(await reportIds(w.pm.agent, '/api/v1/reports/project-status/export')).toEqual([
      w.project.id,
    ]);
    expect(await reportIds(w.pm.agent, '/api/v1/dashboard/my-projects')).toEqual([w.project.id]);

    // A client's Projects tab is project-based too; the clients list itself is not narrowed.
    const clientProjects = await w.pm.agent.get(`/api/v1/clients/${w.other.client.id}/projects`);
    expect(clientProjects.status).toBe(200);
    expect(clientProjects.body.items).toEqual([]);
    const clients = (await w.pm.agent.get('/api/v1/clients')).body.items as { id: string }[];
    expect(clients.map((c) => c.id)).toContain(w.other.client.id);

    // On the team list (not the manager), the PM sees the project.
    await ProjectModel.updateOne({ _id: other.id }, { $addToSet: { memberIds: w.pm.user._id } });
    expect(await names(w.pm.agent)).toEqual(['Rollout P', 'Second P']);
    expect((await w.pm.agent.get(`/api/v1/projects/${other.id}`)).status).toBe(200);
  });

  it('Viewers and Members are unchanged', async () => {
    const w = await world(app);
    const other = await secondProject(w, w.pm2.user._id.toString());
    expect((await w.viewer.agent.get(`/api/v1/projects/${other.id}`)).status).toBe(200);
    expect((await w.member.agent.get(`/api/v1/projects/${other.id}`)).status).toBe(404);
    expect((await w.outsider.agent.get(`/api/v1/projects/${w.project.id}`)).status).toBe(404);
  });
});

describe('CR-22 handover: keepPreviousManagerOnTeam', () => {
  const membersOf = async (id: string) =>
    ((await ProjectModel.findById(id).lean())!.memberIds ?? []).map(String);
  const handOver = (agent: Agent, id: string, body: Record<string, unknown>) =>
    agent.patch(`/api/v1/projects/${id}`).set(CSRF).send(body);

  it('a PM handing over stays on the team by default, once, and keeps Project PM rights only', async () => {
    const w = await world(app);
    const pm = w.pm.user._id.toString();
    // Even if the outgoing manager wasn't listed as a member, the save adds them (no duplicates).
    await ProjectModel.updateOne({ _id: w.project.id }, { $pull: { memberIds: w.pm.user._id } });
    const res = await handOver(w.pm.agent, w.project.id, { managerId: w.pm2.user._id.toString() });
    expect(res.status).toBe(200);
    const members = await membersOf(w.project.id);
    expect(members.filter((m) => m === pm)).toHaveLength(1);
    expect(members).toContain(w.pm2.user._id.toString());
    // Same behaviour as any PM on the team who isn't the manager: views and plans, can't edit.
    const view = await w.pm.agent.get(`/api/v1/projects/${w.project.id}`);
    expect(view.status).toBe(200);
    expect(view.body.project.can).toMatchObject({ edit: false, archive: false, planTasks: true });
    expect((await handOver(w.pm.agent, w.project.id, { name: 'Mine again' })).status).toBe(403);
    const task = await w.pm.agent
      .post(`/api/v1/projects/${w.project.id}/tasks`)
      .set(CSRF)
      .send({ name: 'Still planning' });
    expect(task.status).toBe(201);
    // Explicit true on a manager who's already on the team: still a single entry.
    const back = await handOver(w.pm2.agent, w.project.id, {
      managerId: pm,
      keepPreviousManagerOnTeam: true,
    });
    expect(back.status).toBe(200);
    const after = await membersOf(w.project.id);
    expect(new Set(after).size).toBe(after.length);
    expect(after).toEqual(expect.arrayContaining([pm, w.pm2.user._id.toString()]));
  });

  it('false takes the outgoing PM off the team (they lose access), audited, and wins over memberIds', async () => {
    const w = await world(app);
    const pm = w.pm.user._id.toString();
    const res = await handOver(w.pm.agent, w.project.id, {
      managerId: w.pm2.user._id.toString(),
      memberIds: [w.member.user._id.toString(), pm],
      keepPreviousManagerOnTeam: false,
    });
    expect(res.status).toBe(200);
    expect(await membersOf(w.project.id)).not.toContain(pm);
    expect((await w.pm.agent.get(`/api/v1/projects/${w.project.id}`)).status).toBe(404);
    const log = (await w.pm2.agent.get(`/api/v1/projects/${w.project.id}/activity`)).body.items as {
      action: string;
      changes: { field: string; old: string[]; new: string[] }[];
    }[];
    const update = log.find((e) => e.action === 'project_updated')!;
    const members = update.changes.find((c) => c.field === 'memberIds')!;
    expect(members.old).toContain(pm);
    expect(members.new).not.toContain(pm);
  });

  it('Admins: omitted keeps the outgoing manager too; false removes them; no manager change ignores the flag', async () => {
    const w = await world(app);
    const pm = w.pm.user._id.toString();
    expect(
      (await handOver(w.admin.agent, w.project.id, { managerId: w.pm2.user._id.toString() }))
        .status,
    ).toBe(200);
    expect(await membersOf(w.project.id)).toContain(pm);
    expect(
      (
        await handOver(w.admin.agent, w.project.id, {
          managerId: pm,
          keepPreviousManagerOnTeam: false,
        })
      ).status,
    ).toBe(200);
    expect(await membersOf(w.project.id)).not.toContain(w.pm2.user._id.toString());
    // Not a manager change: the flag does nothing.
    expect(
      (await handOver(w.admin.agent, w.project.id, { name: 'X', keepPreviousManagerOnTeam: false }))
        .status,
    ).toBe(200);
    expect(await membersOf(w.project.id)).toContain(pm);
  });
});

describe('CR-22 create: keepCreatorOnTeam', () => {
  const create = (w: W, who: W['pm'], body: Record<string, unknown>) =>
    ptypeId().then((projectTypeId) =>
      who.agent
        .post('/api/v1/projects')
        .set(CSRF)
        .send({
          name: `Created ${Math.random()}`,
          projectTypeId,
          clientId: w.acme.client.id,
          startDate: '2026-10-12',
          plannedEndDate: '2026-12-18',
          templateId: w.template.id,
          ...body,
        }),
    );
  const membersOf = async (id: string) =>
    ((await ProjectModel.findById(id).lean())!.memberIds ?? []).map(String);

  it('a PM creating for another PM stays on the team by default, once, with Project PM rights only', async () => {
    const w = await world(app);
    const me = w.pm.user._id.toString();
    const res = await create(w, w.pm, {
      managerId: w.pm2.user._id.toString(),
      memberIds: [me],
    });
    expect(res.status).toBe(201);
    const id = res.body.project.id as string;
    const members = await membersOf(id);
    expect(members.filter((m) => m === me)).toHaveLength(1);
    const view = await w.pm.agent.get(`/api/v1/projects/${id}`);
    expect(view.status).toBe(200);
    expect(view.body.project.can).toMatchObject({ edit: false, archive: false, planTasks: true });
    // Not listed and the flag left out: still added.
    const again = await create(w, w.pm, { managerId: w.pm2.user._id.toString() });
    expect(await membersOf(again.body.project.id)).toContain(me);
  });

  it('false leaves the PM off the team (even if listed): they lose access', async () => {
    const w = await world(app);
    const me = w.pm.user._id.toString();
    const res = await create(w, w.pm, {
      managerId: w.pm2.user._id.toString(),
      memberIds: [me, w.member.user._id.toString()],
      keepCreatorOnTeam: false,
    });
    expect(res.status).toBe(201);
    const id = res.body.project.id as string;
    const members = await membersOf(id);
    expect(members).not.toContain(me);
    expect(members).toContain(w.member.user._id.toString());
    expect((await w.pm.agent.get(`/api/v1/projects/${id}`)).status).toBe(404);
  });

  it('ignored for Admins and when the creator is the manager', async () => {
    const w = await world(app);
    const byAdmin = await create(w, w.admin, {
      managerId: w.pm.user._id.toString(),
      keepCreatorOnTeam: true,
    });
    expect(byAdmin.status).toBe(201);
    expect(await membersOf(byAdmin.body.project.id)).not.toContain(w.admin.user._id.toString());
    const own = await create(w, w.pm, {
      managerId: w.pm.user._id.toString(),
      keepCreatorOnTeam: false,
    });
    expect(own.status).toBe(201);
    expect(await membersOf(own.body.project.id)).toEqual([w.pm.user._id.toString()]);
  });
});
