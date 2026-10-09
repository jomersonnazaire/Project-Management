import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectModel, TaskModel } from '../src/models/index.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';
import { clientWithContacts, grant, publishedTemplate, resetRules, world } from './m2helpers.js';

useDatabase();
const app = makeApp();
afterEach(async () => {
  vi.restoreAllMocks();
  await resetRules();
});

const names = (res: { body: { items: { name: string }[] } }) => res.body.items.map((p) => p.name);

describe('Create a project from a template (US-09, FR-PRJ-01..05)', () => {
  it('AC-09.1 / AC-09.2 required fields and baseline order are enforced by the API', async () => {
    const { admin, template, acme } = await world(app);
    const base = {
      name: 'X',
      clientId: acme.client.id,
      managerId: admin.user._id.toString(),
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: template.id,
    };
    for (const field of Object.keys(base)) {
      const body: Record<string, unknown> = { ...base };
      delete body[field];
      const res = await admin.agent.post('/api/v1/projects').set(CSRF).send(body);
      expect(res.status, field).toBe(400);
    }
    for (const end of ['2026-10-12', '2026-10-01']) {
      const res = await admin.agent
        .post('/api/v1/projects')
        .set(CSRF)
        .send({ ...base, plannedEndDate: end });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toContainEqual({
        path: 'plannedEndDate',
        message: 'End date must be after the start date.',
      });
    }
    // Managers must be Admins or PMs; members must be active internal users.
    const member = await signedInAs(app, 'MEMBER');
    expect(
      (
        await admin.agent
          .post('/api/v1/projects')
          .set(CSRF)
          .send({ ...base, managerId: member.user._id.toString() })
      ).status,
    ).toBe(422);
    expect(
      (
        await admin.agent
          .post('/api/v1/projects')
          .set(CSRF)
          .send({ ...base, memberIds: [acme.active[0].id] })
      ).status,
    ).toBe(422);
  });

  it('AC-09.4 / AC-09.5 generates exactly N tasks with mapped dependencies and working-day dates, in Planning with the snapshot', async () => {
    const { pm, project, template } = await world(app);
    expect(project).toMatchObject({
      status: 'PLANNING',
      templateId: template.id,
      templateVersion: 1,
      taskCount: 3,
      progress: 0,
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
    });
    const tasks = (await pm.agent.get(`/api/v1/projects/${project.id}/tasks`)).body.items;
    expect(tasks.map((t: { name: string }) => t.name)).toEqual([
      'Kickoff',
      'Design',
      'Client sign-off',
    ]);
    // Mon 2026-10-12: Kickoff offset 0, 2 days → Oct 12–13; Design offset 2, 3 days → Oct 14–16;
    // sign-off offset 5 → Mon Oct 19 (weekend skipped).
    expect(
      tasks.map((t: { plannedStart: string; dueDate: string }) => [t.plannedStart, t.dueDate]),
    ).toEqual([
      ['2026-10-12', '2026-10-13'],
      ['2026-10-14', '2026-10-16'],
      ['2026-10-19', '2026-10-19'],
    ]);
    expect(tasks[1].dependsOn).toEqual([tasks[0].id]);
    expect(tasks[2].dependsOn).toEqual([tasks[1].id]);
    expect(tasks[2]).toMatchObject({
      party: 'CLIENT',
      requiresApproval: true,
      mandatory: true,
      status: 'TODO',
      estHours: null,
    });
    const stored = await ProjectModel.findById(project.id).lean();
    expect(stored!.templateSnapshot).toMatchObject({ version: 1, name: 'Small Template' });
    expect((stored!.templateSnapshot!.copy as { activities: unknown[] }).activities).toHaveLength(
      3,
    );
    expect(stored!.memberIds.map(String)).toContain(pm.user._id.toString());
  });

  it('AC-09.6 generation is atomic: a failure leaves no project or tasks', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const t = await publishedTemplate(admin.agent);
    const { client } = await clientWithContacts(admin.agent);
    vi.spyOn(TaskModel, 'insertMany').mockRejectedValueOnce(new Error('boom'));
    const res = await admin.agent.post('/api/v1/projects').set(CSRF).send({
      name: 'Atomic',
      clientId: client.id,
      managerId: admin.user._id.toString(),
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: t.id,
    });
    expect(res.status).toBe(500);
    expect(await ProjectModel.countDocuments({ name: 'Atomic' })).toBe(0);
  });

  it('EC-13 / EC-27 / EC-29 warn but still create', async () => {
    const { admin, template, acme } = await world(app);
    const res = await admin.agent.post('/api/v1/projects').set(CSRF).send({
      name: 'rollout p',
      clientId: acme.client.id,
      managerId: admin.user._id.toString(),
      startDate: '2020-01-06',
      plannedEndDate: '2020-01-08',
      templateId: template.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([
      'Plan exceeds baseline end by 5 days.',
      'The baseline end is in the past.',
      'This client already has a project with this name.',
    ]);
  });

  it('only roles with Create on projects create them (Member, Viewer: 403)', async () => {
    const { member, viewer, template, acme } = await world(app);
    for (const u of [member, viewer]) {
      const res = await u.agent.post('/api/v1/projects').set(CSRF).send({
        name: 'Nope',
        clientId: acme.client.id,
        managerId: u.user._id.toString(),
        startDate: '2026-10-12',
        plannedEndDate: '2026-12-18',
        templateId: template.id,
      });
      expect(res.status).toBe(403);
    }
  });
});

describe('Project scope (FR-ACL-07, Q-12, Q-26)', () => {
  it('Members see only their projects (404 otherwise); PMs and Viewers see all', async () => {
    const { pm2, member, outsider, viewer, project } = await world(app);
    for (const u of [pm2, viewer, member]) {
      expect((await u.agent.get(`/api/v1/projects/${project.id}`)).status).toBe(200);
      expect(names(await u.agent.get('/api/v1/projects'))).toContain('Rollout P');
    }
    expect((await outsider.agent.get(`/api/v1/projects/${project.id}`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/v1/projects/${project.id}/tasks`)).status).toBe(404);
    expect((await outsider.agent.get('/api/v1/projects')).body.items).toEqual([]);
  });

  it('TC-D12 / Q-12: a PM edits and archives only projects they manage, but views the others', async () => {
    const { pm, pm2, project } = await world(app);
    const view = await pm2.agent.get(`/api/v1/projects/${project.id}`);
    expect(view.status).toBe(200);
    expect(view.body.project.can).toEqual({
      edit: false,
      archive: false,
      delete: false,
      planTasks: false,
      addMembers: false,
      // doc 11 §12: PMs read the Activity log of any project they can view.
      activity: true,
    });
    expect(
      (await pm2.agent.patch(`/api/v1/projects/${project.id}`).set(CSRF).send({ name: 'Hijack' }))
        .status,
    ).toBe(403);
    expect(
      (await pm2.agent.post(`/api/v1/projects/${project.id}/archive`).set(CSRF).send({})).status,
    ).toBe(403);
    const own = await pm.agent
      .patch(`/api/v1/projects/${project.id}`)
      .set(CSRF)
      .send({ name: 'Rollout P2' });
    expect(own.status).toBe(200);
    expect(own.body.project.can).toEqual({
      edit: true,
      archive: true,
      delete: false,
      planTasks: true,
      addMembers: true,
      activity: true,
    });
  });

  it('AC-33.3 / TC-M14: a Member granted Edit on projects still can’t edit a project they aren’t on', async () => {
    const { member, outsider, project } = await world(app);
    await grant(app, 'MEMBER', { projects: { view: true, edit: true } });
    expect(
      (await outsider.agent.patch(`/api/v1/projects/${project.id}`).set(CSRF).send({ name: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (
        await member.agent
          .patch(`/api/v1/projects/${project.id}`)
          .set(CSRF)
          .send({ description: 'ok' })
      ).status,
    ).toBe(200);
    await resetRules();
    expect(
      (
        await member.agent
          .patch(`/api/v1/projects/${project.id}`)
          .set(CSRF)
          .send({ description: 'x' })
      ).status,
    ).toBe(403);
  });

  it('archive vs delete: PMs archive their own projects; only Admins delete (Q-26)', async () => {
    const { admin, pm, member, viewer, project } = await world(app);
    expect(
      (await member.agent.post(`/api/v1/projects/${project.id}/archive`).set(CSRF).send({})).status,
    ).toBe(403);
    expect(
      (await viewer.agent.post(`/api/v1/projects/${project.id}/archive`).set(CSRF).send({})).status,
    ).toBe(403);
    const archived = await pm.agent
      .post(`/api/v1/projects/${project.id}/archive`)
      .set(CSRF)
      .send({});
    expect(archived.body.project.archived).toBe(true);
    // Hidden from lists unless Archived is chosen; changes are refused until restored.
    const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((p) => p.id);
    expect(ids(await pm.agent.get('/api/v1/projects?pageSize=100'))).not.toContain(project.id);
    expect(ids(await pm.agent.get('/api/v1/projects?status=ARCHIVED&pageSize=100'))).toContain(
      project.id,
    );
    expect(
      (await pm.agent.patch(`/api/v1/projects/${project.id}`).set(CSRF).send({ name: 'x' })).status,
    ).toBe(409);
    expect(
      (await pm.agent.post(`/api/v1/projects/${project.id}/unarchive`).set(CSRF).send({})).body
        .project.archived,
    ).toBe(false);

    for (const u of [pm, member, viewer]) {
      expect((await u.agent.delete(`/api/v1/projects/${project.id}`).set(CSRF)).status).toBe(403);
    }
    expect((await admin.agent.delete(`/api/v1/projects/${project.id}`).set(CSRF)).status).toBe(204);
    expect(await ProjectModel.exists({ _id: project.id })).toBeNull();
    expect(await TaskModel.countDocuments({ projectId: project.id })).toBe(0);
  });
});

describe('Project lifecycle and edits (FR-PRJ-05/12, AC-10.3, EC-24)', () => {
  it('AC-10.3 activation is blocked while tasks lack an accountable owner, and the message lists them', async () => {
    const { pm, member, project } = await world(app);
    const res = await pm.agent
      .patch(`/api/v1/projects/${project.id}`)
      .set(CSRF)
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TASKS_WITHOUT_OWNER');
    expect(res.body.error.message).toMatch(/Kickoff, Design, Client sign-off/);
    const tasks = (await pm.agent.get(`/api/v1/projects/${project.id}/tasks`)).body.items;
    for (const t of tasks) {
      const body: Record<string, unknown> = {
        version: t.version,
        ownerId: member.user._id.toString(),
      };
      if (t.party === 'CLIENT')
        body.clientContactId = (
          await pm.agent.get(`/api/v1/projects/${project.id}/contact-options`)
        ).body.items[0].id;
      expect((await pm.agent.patch(`/api/v1/tasks/${t.id}`).set(CSRF).send(body)).status).toBe(200);
    }
    const ok = await pm.agent
      .patch(`/api/v1/projects/${project.id}`)
      .set(CSRF)
      .send({ status: 'ACTIVE' });
    expect(ok.body.project.status).toBe('ACTIVE');
    expect(
      (
        await pm.agent
          .patch(`/api/v1/projects/${project.id}`)
          .set(CSRF)
          .send({ status: 'PLANNING' })
      ).status,
    ).toBe(422);
    expect(
      (
        await pm.agent
          .patch(`/api/v1/projects/${project.id}`)
          .set(CSRF)
          .send({ status: 'COMPLETED' })
      ).body.error.code,
    ).toBe('OPEN_TASKS');
    expect(
      (await pm.agent.patch(`/api/v1/projects/${project.id}`).set(CSRF).send({ status: 'ON_HOLD' }))
        .body.project,
    ).toMatchObject({ status: 'ON_HOLD', health: 'ON_HOLD' });
  });

  it('FR-PRJ-12 re-baselining needs a reason and keeps the previous baseline', async () => {
    const { pm, project } = await world(app);
    const noReason = await pm.agent
      .patch(`/api/v1/projects/${project.id}`)
      .set(CSRF)
      .send({ plannedEndDate: '2027-01-15' });
    expect(noReason.status).toBe(422);
    expect(
      (
        await pm.agent
          .patch(`/api/v1/projects/${project.id}`)
          .set(CSRF)
          .send({ plannedEndDate: '2026-10-01', reason: 'x' })
      ).status,
    ).toBe(400);
    const ok = await pm.agent
      .patch(`/api/v1/projects/${project.id}`)
      .set(CSRF)
      .send({ plannedEndDate: '2027-01-15', reason: 'Client delay' });
    expect(ok.body.project.plannedEndDate).toBe('2027-01-15');
    expect(ok.body.project.baselineHistory).toMatchObject([
      { startDate: '2026-10-12', plannedEndDate: '2026-12-18', reason: 'Client delay' },
    ]);
  });

  it('FR-PRJ-13 / EC-24 changing the client asks to clear active contacts, and is blocked while tasks tag contacts', async () => {
    const { pm, member, project, acme, other } = await world(app);
    await pm.agent
      .post(`/api/v1/projects/${project.id}/contacts`)
      .set(CSRF)
      .send({ contactId: acme.active[0].id });
    const ask = await pm.agent
      .patch(`/api/v1/projects/${project.id}`)
      .set(CSRF)
      .send({ clientId: other.client.id });
    expect(ask.status).toBe(409);
    expect(ask.body.error.code).toBe('CONFIRM_CLEAR_CONTACTS');
    const tasks = (await pm.agent.get(`/api/v1/projects/${project.id}/tasks`)).body.items;
    const signoff = tasks[2];
    await pm.agent.patch(`/api/v1/tasks/${signoff.id}`).set(CSRF).send({
      version: signoff.version,
      clientContactId: acme.active[1].id,
      ownerId: member.user._id.toString(),
    });
    const blocked = await pm.agent
      .patch(`/api/v1/projects/${project.id}`)
      .set(CSRF)
      .send({ clientId: other.client.id, confirmClearContacts: true });
    expect(blocked.body.error.code).toBe('CLIENT_CONTACTS_TAGGED');
    await TaskModel.updateMany(
      { projectId: project.id },
      { $set: { clientContactId: null, party: 'INTERNAL' } },
    );
    const ok = await pm.agent
      .patch(`/api/v1/projects/${project.id}`)
      .set(CSRF)
      .send({ clientId: other.client.id, confirmClearContacts: true });
    expect(ok.status).toBe(200);
    expect(ok.body.project).toMatchObject({ clientId: other.client.id, activeContacts: [] });
  });
});

describe('Project Active contacts (FR-PRJ-11..13, AC-36.1)', () => {
  it('the picker lists only the project client’s active contacts; other clients’ or inactive contacts are refused with 422', async () => {
    const { admin, pm, member, project, acme, other } = await world(app);
    const options = await pm.agent.get(`/api/v1/projects/${project.id}/contact-options`);
    expect(options.body.items.map((c: { name: string }) => c.name)).toEqual([
      'Ana Active',
      'Ben Active',
    ]);
    const foreign = await pm.agent
      .post(`/api/v1/projects/${project.id}/contacts`)
      .set(CSRF)
      .send({ contactId: other.active[0].id });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error.code).toBe('CONTACT_NOT_IN_CLIENT');
    expect(
      (
        await pm.agent
          .post(`/api/v1/projects/${project.id}/contacts`)
          .set(CSRF)
          .send({ contactId: acme.inactive.id })
      ).body.error.code,
    ).toBe('CONTACT_INACTIVE');
    const added = await pm.agent
      .post(`/api/v1/projects/${project.id}/contacts`)
      .set(CSRF)
      .send({ contactId: acme.active[0].id });
    expect(added.body.project.activeContacts).toEqual([
      {
        id: acme.active[0].id,
        name: 'Ana Active',
        position: 'CFO',
        email: 'ana@client.example',
        phone: null,
        active: true,
      },
    ]);
    expect(
      (await pm.agent.get(`/api/v1/projects/${project.id}/contact-options`)).body.items[0].added,
    ).toBe(true);
    // Editing the list needs Edit on projects (Member: 403; the outsider can't even see it).
    expect(
      (
        await member.agent
          .post(`/api/v1/projects/${project.id}/contacts`)
          .set(CSRF)
          .send({ contactId: acme.active[1].id })
      ).status,
    ).toBe(403);
    expect((await member.agent.get(`/api/v1/projects/${project.id}/contact-options`)).status).toBe(
      403,
    );
    // Deactivated contacts stay on the project marked inactive, and leave the picker (FR-PRJ-13).
    await admin.agent.post(`/api/v1/contacts/${acme.active[0].id}/deactivate`).set(CSRF).send({});
    const detail = await member.agent.get(`/api/v1/projects/${project.id}`);
    expect(detail.body.project.activeContacts[0]).toMatchObject({
      name: 'Ana Active',
      active: false,
    });
    expect(
      (await pm.agent.get(`/api/v1/projects/${project.id}/contact-options`)).body.items.map(
        (c: { name: string }) => c.name,
      ),
    ).toEqual(['Ben Active']);
    const removed = await pm.agent
      .delete(`/api/v1/projects/${project.id}/contacts/${acme.active[0].id}`)
      .set(CSRF);
    expect(removed.body.project.activeContacts).toEqual([]);
  });

  it('contacts show a Projects column (scoped) and pending / overdue counts of open client tasks', async () => {
    const { admin, pm, member, outsider, project, acme, template } = await world(app);
    // A second project for the same client that the Member isn't on.
    const secret = await pm.agent.post('/api/v1/projects').set(CSRF).send({
      name: 'Secret Rollout',
      clientId: acme.client.id,
      managerId: pm.user._id.toString(),
      startDate: '2020-01-06',
      plannedEndDate: '2020-03-06',
      templateId: template.id,
    });
    for (const p of [project.id, secret.body.project.id]) {
      await pm.agent
        .post(`/api/v1/projects/${p}/contacts`)
        .set(CSRF)
        .send({ contactId: acme.active[0].id });
    }
    // Tag Ana on the (overdue) client task of the secret project.
    const st = (await pm.agent.get(`/api/v1/projects/${secret.body.project.id}/tasks`)).body
      .items[2];
    await pm.agent
      .patch(`/api/v1/tasks/${st.id}`)
      .set(CSRF)
      .send({ version: st.version, clientContactId: acme.active[0].id });

    const asAdmin = await admin.agent.get(`/api/v1/clients/${acme.client.id}/contacts`);
    const ana = asAdmin.body.items.find((c: { name: string }) => c.name === 'Ana Active');
    expect(ana.projects.map((p: { name: string }) => p.name)).toEqual([
      'Rollout P',
      'Secret Rollout',
    ]);
    expect(ana).toMatchObject({ pendingCount: 1, overdueCount: 1 });
    const asMember = await member.agent.get(`/api/v1/clients/${acme.client.id}/contacts`);
    const anaM = asMember.body.items.find((c: { name: string }) => c.name === 'Ana Active');
    expect(anaM.projects.map((p: { name: string }) => p.name)).toEqual(['Rollout P']);
    expect(anaM).toMatchObject({ pendingCount: 0, overdueCount: 0 });
    expect(
      (await member.agent.get('/api/v1/contacts')).body.items.find(
        (c: { name: string }) => c.name === 'Ana Active',
      ).projects,
    ).toHaveLength(1);
    expect((await outsider.agent.get(`/api/v1/clients/${acme.client.id}/contacts`)).status).toBe(
      404,
    );
  });
});

describe('Clients › Projects tab with real projects (FR-CLI-11/12, AC-35.2, TC-M14)', () => {
  it('Members see and count only their own projects; filters by status, health and archived', async () => {
    const { admin, pm, member, viewer, acme, project, template } = await world(app);
    const mk = async (name: string, extra = {}) =>
      (
        await pm.agent
          .post('/api/v1/projects')
          .set(CSRF)
          .send({
            name,
            clientId: acme.client.id,
            managerId: pm.user._id.toString(),
            startDate: '2026-10-12',
            plannedEndDate: '2026-12-18',
            templateId: template.id,
            ...extra,
          })
      ).body.project;
    const late = await mk('Late Project', {
      startDate: '2020-01-06',
      plannedEndDate: '2020-02-03',
    });
    const old = await mk('Old Project');
    await pm.agent.post(`/api/v1/projects/${old.id}/archive`).set(CSRF).send({});
    // Activate the late one (owners first) so it reports Delayed.
    const lt = (await pm.agent.get(`/api/v1/projects/${late.id}/tasks`)).body.items;
    for (const t of lt)
      await pm.agent
        .patch(`/api/v1/tasks/${t.id}`)
        .set(CSRF)
        .send({
          version: t.version,
          ownerId: pm.user._id.toString(),
          ...(t.party === 'CLIENT' ? { clientContactId: acme.active[0].id } : {}),
        });
    await pm.agent.patch(`/api/v1/projects/${late.id}`).set(CSRF).send({ status: 'ACTIVE' });

    for (const u of [admin, viewer, pm]) {
      const res = await u.agent.get(`/api/v1/clients/${acme.client.id}/projects`);
      expect(names(res)).toEqual(['Late Project', 'Rollout P']);
      expect(
        (await u.agent.get(`/api/v1/clients/${acme.client.id}`)).body.client.projectCount,
      ).toBe(2);
    }
    const tab = await member.agent.get(`/api/v1/clients/${acme.client.id}/projects`);
    expect(tab.body).toMatchObject({ total: 1 });
    expect(tab.body.items[0]).toMatchObject({
      id: project.id,
      name: 'Rollout P',
      managerName: pm.user.name,
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      progress: 0,
      status: 'PLANNING',
      archived: false,
    });
    expect(
      (await member.agent.get(`/api/v1/clients/${acme.client.id}`)).body.client.projectCount,
    ).toBe(1);
    expect(
      names(await member.agent.get(`/api/v1/clients/${acme.client.id}/projects?status=ARCHIVED`)),
    ).toEqual([]);
    expect(
      (await member.agent.get('/api/v1/projects')).body.items.map((p: { id: string }) => p.id),
    ).toEqual([project.id]);

    expect(
      names(await admin.agent.get(`/api/v1/clients/${acme.client.id}/projects?status=ARCHIVED`)),
    ).toEqual(['Old Project']);
    expect(
      names(await admin.agent.get(`/api/v1/clients/${acme.client.id}/projects?status=DELAYED`)),
    ).toEqual(['Late Project']);
    expect(
      names(await admin.agent.get(`/api/v1/clients/${acme.client.id}/projects?status=PLANNING`)),
    ).toEqual(['Rollout P']);
    const list = await admin.agent.get(`/api/v1/projects?clientId=${acme.client.id}`);
    expect(list.body.counts).toMatchObject({
      ALL: 2,
      ARCHIVED: 1,
      PLANNING: 1,
      ACTIVE: 1,
      DELAYED: 1,
    });
  });
});

describe('People picker (AC-04.2)', () => {
  it('lists active internal users with names and roles only; never contacts or emails', async () => {
    const { member, outsider, acme } = await world(app);
    const res = await member.agent.get('/api/v1/people');
    expect(res.status).toBe(200);
    const item = res.body.items.find((u: { id: string }) => u.id === outsider.user._id.toString());
    expect(Object.keys(item).sort()).toEqual(['id', 'jobRole', 'name', 'systemRole']);
    expect(res.body.items.some((u: { name: string }) => u.name === acme.active[0].name)).toBe(
      false,
    );
  });
});
