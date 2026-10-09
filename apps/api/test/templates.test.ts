import { afterEach, describe, expect, it } from 'vitest';
import { TaskModel, TemplateModel } from '../src/models/index.js';
import {
  LAUNCH_TEMPLATE_KEY,
  LAUNCH_TEMPLATE_NAME,
  ensureLaunchTemplate,
} from '../src/services/launchTemplate.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';
import {
  SMALL_TEMPLATE,
  clientWithContacts,
  grant,
  publishedTemplate,
  resetRules,
} from './m2helpers.js';

useDatabase();
const app = makeApp();
afterEach(resetRules);

const projectBody = (clientId: string, managerId: string, templateId: string, extra = {}) => ({
  name: 'Versioned project',
  clientId,
  managerId,
  startDate: '2026-10-12',
  plannedEndDate: '2026-12-18',
  templateId,
  ...extra,
});

describe('Launch template: SAP B1 Implementation (FR-TPL-09, AC-07.3, EC-58)', () => {
  it('is seeded once as published v1 with the 10 blueprint activities in order, proposed dependencies and no estimates', async () => {
    expect(await ensureLaunchTemplate()).toBe(true);
    expect(await ensureLaunchTemplate()).toBe(false);
    expect(await TemplateModel.countDocuments({ templateKey: LAUNCH_TEMPLATE_KEY })).toBe(1);

    const admin = await signedInAs(app, 'ADMIN');
    const list = await admin.agent.get('/api/v1/templates?status=PUBLISHED');
    const sap = list.body.items.find((t: { name: string }) => t.name === LAUNCH_TEMPLATE_NAME);
    expect(sap).toMatchObject({
      status: 'PUBLISHED',
      version: 1,
      activityCount: 10,
      phaseCount: 4,
      dependencyCount: 12,
      deliverableCount: 10,
    });

    const t = (await admin.agent.get(`/api/v1/templates/${sap.id}`)).body.template;
    expect(t.activities.map((a: { name: string }) => a.name)).toEqual([
      'Data gathering',
      'Submit master data template to client',
      'Client master data – Items',
      'Client master data – Business Partners',
      'Validate imported master data',
      'Configure system and validate setup',
      'User acceptance testing (UAT)',
      'End-user training',
      'Cutover preparation',
      'Go-live and post-implementation support',
    ]);
    const deps = Object.fromEntries(
      t.activities.map((a: { id: string; dependsOn: string[] }) => [a.id, a.dependsOn]),
    );
    expect(deps).toEqual({
      a1: [],
      a2: ['a1'],
      a3: ['a2'],
      a4: ['a2'],
      a5: ['a3', 'a4'],
      a6: ['a1'],
      a7: ['a5', 'a6'],
      a8: ['a7'],
      a9: ['a7'],
      a10: ['a8', 'a9'],
    });
    expect(
      t.activities
        .filter((a: { party: string }) => a.party === 'CLIENT')
        .map((a: { id: string }) => a.id),
    ).toEqual(['a3', 'a4']);
    // EC-58: no estimates, stored as null (never 0).
    expect(t.activities.every((a: { estHours: unknown }) => a.estHours === null)).toBe(true);
    const raw = await TemplateModel.findOne({ templateKey: LAUNCH_TEMPLATE_KEY }).lean();
    expect(raw!.activities.every((a) => a.estHours === null)).toBe(true);
  });

  it('never overwrites the template once it exists (e.g. after a new version is published)', async () => {
    await ensureLaunchTemplate();
    const admin = await signedInAs(app, 'ADMIN');
    const v1 = await TemplateModel.findOne({ templateKey: LAUNCH_TEMPLATE_KEY, version: 1 });
    const draft = await admin.agent
      .post(`/api/v1/templates/${v1!._id}/new-version`)
      .set(CSRF)
      .send({});
    await admin.agent
      .patch(`/api/v1/templates/${draft.body.template.id}`)
      .set(CSRF)
      .send({ name: 'SAP B1 Implementation (2027)' });
    const pub = await admin.agent
      .post(`/api/v1/templates/${draft.body.template.id}/publish`)
      .set(CSRF)
      .send({});
    expect(pub.body).toMatchObject({ template: { version: 2 } });
    expect(await ensureLaunchTemplate()).toBe(false);
    const versions = await TemplateModel.find({ templateKey: LAUNCH_TEMPLATE_KEY })
      .sort({ version: 1 })
      .lean();
    expect(versions.map((v) => [v.version, v.status, v.superseded, v.name])).toEqual([
      [1, 'PUBLISHED', true, LAUNCH_TEMPLATE_NAME],
      [2, 'PUBLISHED', false, 'SAP B1 Implementation (2027)'],
    ]);
  });

  it('EC-58: projects generated from it have tasks with null estimates, counted as unestimated', async () => {
    await ensureLaunchTemplate();
    const admin = await signedInAs(app, 'ADMIN');
    const { client } = await clientWithContacts(admin.agent);
    const tpl = await TemplateModel.findOne({
      templateKey: LAUNCH_TEMPLATE_KEY,
      superseded: { $ne: true },
    }).lean();
    const res = await admin.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send(
        projectBody(client.id, admin.user._id.toString(), tpl!._id.toString(), {
          name: 'SAP from launch',
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({
      taskCount: 10,
      unestimatedTaskCount: 10,
      templateName: tpl!.name,
      templateVersion: tpl!.version,
    });
    const tasks = (await admin.agent.get(`/api/v1/projects/${res.body.project.id}/tasks`)).body
      .items;
    expect(tasks.every((t: { estHours: unknown }) => t.estHours === null)).toBe(true);
    expect(await TaskModel.countDocuments({ projectId: res.body.project.id, estHours: null })).toBe(
      10,
    );
    expect(await TaskModel.countDocuments({ projectId: res.body.project.id, estHours: 0 })).toBe(0);
  });
});

describe('Templates: drafts, validation and publishing (US-07, Q-11)', () => {
  it('AC-07.1 saves a draft with phases and activities using every FR-TPL-03 field; a missing estimate stays null', async () => {
    const pm = await signedInAs(app, 'PROJECT_MANAGER');
    const res = await pm.agent
      .post('/api/v1/templates')
      .set(CSRF)
      .send({
        ...SMALL_TEMPLATE,
        activities: [
          {
            id: 'x1',
            phaseId: 'pa',
            name: 'Full',
            taskType: 'Config',
            priority: 'HIGH',
            mandatory: false,
            party: 'CLIENT',
            defaultJobRole: 'CONSULTANT',
            estHours: 4.5,
            offsetDays: 3,
            durationDays: 2,
            deliverable: 'Doc',
            requiresApproval: true,
            isMilestone: true,
            dependsOn: [],
          },
          { id: 'x2', phaseId: 'pb', name: 'No estimate', dependsOn: ['x1'] },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.template).toMatchObject({ status: 'DRAFT', version: 1, activityCount: 2 });
    expect(res.body.template.activities[0]).toMatchObject({
      taskType: 'Config',
      priority: 'HIGH',
      party: 'CLIENT',
      defaultJobRole: 'CONSULTANT',
      estHours: 4.5,
      requiresApproval: true,
      isMilestone: true,
    });
    expect(res.body.template.activities[1].estHours).toBeNull();
  });

  it('accepts the DTO back as-is: the editor resends activities with null optional fields', async () => {
    const pm = await signedInAs(app, 'PROJECT_MANAGER');
    const created = await pm.agent
      .post('/api/v1/templates')
      .set(CSRF)
      .send({ ...SMALL_TEMPLATE, name: 'Round trip' });
    expect(created.status).toBe(201);
    const t = created.body.template;
    expect(t.activities.some((a: { deliverable: string | null }) => a.deliverable === null)).toBe(
      true,
    );
    const res = await pm.agent.patch(`/api/v1/templates/${t.id}`).set(CSRF).send({
      name: t.name,
      type: t.type,
      description: null,
      phases: t.phases,
      activities: t.activities,
    });
    expect(res.status).toBe(200);
    expect(res.body.template.activities).toHaveLength(t.activities.length);
    expect(
      res.body.template.activities.map((a: { estHours: number | null }) => a.estHours),
    ).toEqual(t.activities.map((a: { estHours: number | null }) => a.estHours));
  });

  it('AC-07.2 rejects A→B→A and A→B→C→A cycles, naming the activities; and self-dependencies', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const acts = (deps: Record<string, string[]>) =>
      Object.entries(deps).map(([id, dependsOn]) => ({
        id,
        phaseId: 'pa',
        name: `Act ${id}`,
        dependsOn,
      }));
    const two = await admin.agent
      .post('/api/v1/templates')
      .set(CSRF)
      .send({ ...SMALL_TEMPLATE, activities: acts({ A: ['B'], B: ['A'] }) });
    expect(two.status).toBe(422);
    expect(two.body.error.code).toBe('DEPENDENCY_CYCLE');
    expect(two.body.error.message).toMatch(/Act A → Act B → Act A/);
    const three = await admin.agent
      .post('/api/v1/templates')
      .set(CSRF)
      .send({ ...SMALL_TEMPLATE, activities: acts({ A: ['C'], B: ['A'], C: ['B'] }) });
    expect(three.status).toBe(422);
    expect(three.body.error.details.activities).toHaveLength(4);
    const self = await admin.agent
      .post('/api/v1/templates')
      .set(CSRF)
      .send({ ...SMALL_TEMPLATE, activities: acts({ A: ['A'] }) });
    expect(self.status).toBe(422);
    const dangling = await admin.agent
      .post('/api/v1/templates')
      .set(CSRF)
      .send({ ...SMALL_TEMPLATE, activities: acts({ A: ['Z'] }) });
    expect(dangling.body.error.code).toBe('TEMPLATE_INVALID');
    // Same check on edit.
    const ok = await admin.agent
      .post('/api/v1/templates')
      .set(CSRF)
      .send({ ...SMALL_TEMPLATE, activities: acts({ A: [], B: ['A'] }) });
    const edit = await admin.agent
      .patch(`/api/v1/templates/${ok.body.template.id}`)
      .set(CSRF)
      .send({ activities: acts({ A: ['B'], B: ['A'] }) });
    expect(edit.status).toBe(422);
  });

  it('AC-07.4 publishing needs at least one activity; only drafts are edited, published or deleted', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const empty = await admin.agent
      .post('/api/v1/templates')
      .set(CSRF)
      .send({ name: 'Empty', type: 'OTHER' });
    const pub = await admin.agent
      .post(`/api/v1/templates/${empty.body.template.id}/publish`)
      .set(CSRF)
      .send({});
    expect(pub.status).toBe(422);
    expect(pub.body.error.code).toBe('TEMPLATE_EMPTY');
    const t = await publishedTemplate(admin.agent);
    expect(
      (await admin.agent.patch(`/api/v1/templates/${t.id}`).set(CSRF).send({ name: 'x' })).status,
    ).toBe(409);
    expect(
      (await admin.agent.post(`/api/v1/templates/${t.id}/publish`).set(CSRF).send({})).status,
    ).toBe(409);
    expect((await admin.agent.delete(`/api/v1/templates/${t.id}`).set(CSRF)).status).toBe(409);
    expect(
      (await admin.agent.delete(`/api/v1/templates/${empty.body.template.id}`).set(CSRF)).status,
    ).toBe(204);
  });

  it('TC-D11 / Q-11: PMs publish by default; publishing follows Edit on templates; Members and Viewers can’t', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const draftId = async () =>
      (await admin.agent.post('/api/v1/templates').set(CSRF).send(SMALL_TEMPLATE)).body.template.id;
    const pm = await signedInAs(app, 'PROJECT_MANAGER');
    expect(
      (
        await pm.agent
          .post(`/api/v1/templates/${await draftId()}/publish`)
          .set(CSRF)
          .send({})
      ).status,
    ).toBe(200);

    await grant(app, 'PROJECT_MANAGER', {
      templates: { view: true, create: true, edit: false, delete: true },
    });
    const denied = await pm.agent
      .post(`/api/v1/templates/${await draftId()}/publish`)
      .set(CSRF)
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    await resetRules();

    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const { agent } = await signedInAs(app, role);
      expect(
        (
          await agent
            .post(`/api/v1/templates/${await draftId()}/publish`)
            .set(CSRF)
            .send({})
        ).status,
      ).toBe(403);
      expect((await agent.post('/api/v1/templates').set(CSRF).send(SMALL_TEMPLATE)).status).toBe(
        403,
      );
      expect((await agent.get('/api/v1/templates')).status).toBe(200);
    }
  });

  it('FR-TPL-08 duplicates a template as a new Draft; FR-TPL-06 counts projects using it', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const t = await publishedTemplate(admin.agent);
    const dup = await admin.agent.post(`/api/v1/templates/${t.id}/duplicate`).set(CSRF).send({});
    expect(dup.status).toBe(201);
    expect(dup.body.template).toMatchObject({
      name: 'Copy of Small Template',
      status: 'DRAFT',
      version: 1,
      activityCount: 3,
    });
    expect(dup.body.template.templateKey).not.toBe(t.templateKey);
    const { client } = await clientWithContacts(admin.agent);
    await admin.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send(projectBody(client.id, admin.user._id.toString(), t.id));
    const list = await admin.agent.get('/api/v1/templates');
    expect(list.body.items.find((x: { id: string }) => x.id === t.id).projectCount).toBe(1);
  });
});

describe('Template versioning (FR-TPL-04, AC-08.1..08.3, workflow §6)', () => {
  it('republishing creates v2; v1 stays readable; existing projects keep v1; only new projects use v2', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const { client } = await clientWithContacts(admin.agent);
    const me = admin.user._id.toString();
    const v1 = await publishedTemplate(admin.agent);
    const p1 = (
      await admin.agent
        .post('/api/v1/projects')
        .set(CSRF)
        .send(projectBody(client.id, me, v1.id, { name: 'From v1' }))
    ).body.project;
    expect(p1).toMatchObject({ templateVersion: 1, taskCount: 3 });

    // "Edit" a published template: a draft of v2. Asking again returns the same draft.
    const draft = await admin.agent
      .post(`/api/v1/templates/${v1.id}/new-version`)
      .set(CSRF)
      .send({});
    expect(draft.status).toBe(201);
    expect(draft.body.template).toMatchObject({
      version: 2,
      status: 'DRAFT',
      templateKey: v1.templateKey,
    });
    expect(
      (await admin.agent.post(`/api/v1/templates/${v1.id}/new-version`).set(CSRF).send({})).body
        .template.id,
    ).toBe(draft.body.template.id);
    // While the draft exists, v1 is still the version used for new projects.
    expect((await admin.agent.get(`/api/v1/templates/${v1.id}`)).body.template.draftId).toBe(
      draft.body.template.id,
    );

    const v2Acts = [
      ...SMALL_TEMPLATE.activities!,
      { id: 'a4', phaseId: 'pb', name: 'Go-live', estHours: 2, offsetDays: 6, dependsOn: ['a3'] },
    ];
    v2Acts[0] = { ...v2Acts[0]!, name: 'Kickoff (v2)', estHours: 10 };
    await admin.agent
      .patch(`/api/v1/templates/${draft.body.template.id}`)
      .set(CSRF)
      .send({
        activities: v2Acts,
        phases: [
          { id: 'pa', name: 'Phase A v2' },
          { id: 'pb', name: 'Phase B' },
        ],
      });
    const v2 = await admin.agent
      .post(`/api/v1/templates/${draft.body.template.id}/publish`)
      .set(CSRF)
      .send({});
    expect(v2.body.template).toMatchObject({ version: 2, status: 'PUBLISHED', superseded: false });

    // v1 is read-only but readable, and out of the picker.
    const old = await admin.agent.get(`/api/v1/templates/${v1.id}`);
    expect(old.status).toBe(200);
    expect(old.body.template).toMatchObject({ version: 1, superseded: true });
    expect(old.body.template.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const picker = await admin.agent.get('/api/v1/templates?status=PUBLISHED');
    expect(
      picker.body.items
        .filter((t: { templateKey: string }) => t.templateKey === v1.templateKey)
        .map((t: { version: number }) => t.version),
    ).toEqual([2]);
    expect(
      (await admin.agent.post(`/api/v1/templates/${v1.id}/archive`).set(CSRF).send({})).status,
    ).toBe(409);

    // AC-08.2: the v1 project is unchanged.
    const p1After = (await admin.agent.get(`/api/v1/projects/${p1.id}`)).body.project;
    expect(p1After).toMatchObject({ templateVersion: 1, taskCount: 3 });
    const p1Tasks = (await admin.agent.get(`/api/v1/projects/${p1.id}/tasks`)).body.items;
    expect(
      p1Tasks.map((t: { name: string; estHours: number | null; phase: string }) => [
        t.name,
        t.estHours,
        t.phase,
      ]),
    ).toEqual([
      ['Kickoff', 8, 'Phase A'],
      ['Design', 16, 'Phase A'],
      ['Client sign-off', null, 'Phase B'],
    ]);

    // New projects use v2; an old preview (v1 id or version) gets 409 and the current version.
    const stale = await admin.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send(projectBody(client.id, me, v1.id));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'TEMPLATE_CHANGED',
      details: { templateId: v2.body.template.id, version: 2 },
    });
    const mismatch = await admin.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send(projectBody(client.id, me, v2.body.template.id, { templateVersion: 1 }));
    expect(mismatch.status).toBe(409);
    const p2 = (
      await admin.agent
        .post('/api/v1/projects')
        .set(CSRF)
        .send(
          projectBody(client.id, me, v2.body.template.id, { name: 'From v2', templateVersion: 2 }),
        )
    ).body.project;
    expect(p2).toMatchObject({ templateVersion: 2, taskCount: 4 });
    const p2Tasks = (await admin.agent.get(`/api/v1/projects/${p2.id}/tasks`)).body.items;
    expect(p2Tasks[0]).toMatchObject({ name: 'Kickoff (v2)', estHours: 10, phase: 'Phase A v2' });
    // Both projects count toward the template (any version).
    const list = await admin.agent.get('/api/v1/templates');
    expect(
      list.body.items.find((t: { id: string }) => t.id === v2.body.template.id).projectCount,
    ).toBe(2);
  });

  it('AC-08.3 / FR-TPL-05/10: drafts and archived templates can’t create projects; archived projects keep their snapshot', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const { client } = await clientWithContacts(admin.agent);
    const me = admin.user._id.toString();
    const draft = (await admin.agent.post('/api/v1/templates').set(CSRF).send(SMALL_TEMPLATE)).body
      .template;
    const r1 = await admin.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send(projectBody(client.id, me, draft.id));
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('TEMPLATE_NOT_PUBLISHED');
    const t = await publishedTemplate(admin.agent);
    const p = (
      await admin.agent
        .post('/api/v1/projects')
        .set(CSRF)
        .send(projectBody(client.id, me, t.id))
    ).body.project;
    expect(
      (await admin.agent.post(`/api/v1/templates/${t.id}/archive`).set(CSRF).send({})).body.template
        .status,
    ).toBe('ARCHIVED');
    expect(
      (
        await admin.agent
          .post('/api/v1/projects')
          .set(CSRF)
          .send(projectBody(client.id, me, t.id))
      ).status,
    ).toBe(422);
    const picker = await admin.agent.get('/api/v1/templates?status=PUBLISHED');
    expect(picker.body.items.some((x: { id: string }) => x.id === t.id)).toBe(false);
    expect((await admin.agent.get(`/api/v1/projects/${p.id}`)).body.project.templateVersion).toBe(
      1,
    );
    expect(
      (await admin.agent.post(`/api/v1/templates/${t.id}/restore`).set(CSRF).send({})).body.template
        .status,
    ).toBe('PUBLISHED');
  });
});
