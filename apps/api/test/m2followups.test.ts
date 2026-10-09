import { afterEach, describe, expect, it } from 'vitest';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { SMALL_TEMPLATE, grant, resetRules, world } from './m2helpers.js';

/** Milestone 2 follow-ups decided in doc 11 §12. */
useDatabase();
const app = makeApp();
afterEach(resetRules);

describe('Project Activity log (doc 11 §12, FR-AUD-02)', () => {
  it('PMs read it on any project they can view, without the global Audit log; Members and Viewers cannot', async () => {
    const { admin, pm, pm2, member, viewer, outsider, project } = await world(app);
    const path = `/api/v1/projects/${project.id}/activity`;

    const own = await pm.agent.get(path);
    expect(own.status).toBe(200);
    expect(own.body.items.map((e: { action: string }) => e.action)).toContain('project_created');
    // Another PM's project: viewable, so the log is readable too.
    expect((await pm2.agent.get(path)).status).toBe(200);
    expect((await admin.agent.get(path)).status).toBe(200);
    // The global Audit log stays Admin-only (Audit permission).
    expect((await pm.agent.get('/api/v1/audit')).status).toBe(403);

    expect((await member.agent.get(path)).status).toBe(403);
    expect((await viewer.agent.get(path)).status).toBe(403);
    // Out of scope stays 404, never revealing the project.
    expect((await outsider.agent.get(path)).status).toBe(404);

    // The project DTO tells the web whether to show the tab.
    const can = async (a: typeof pm) =>
      (await a.agent.get(`/api/v1/projects/${project.id}`)).body.project.can.activity;
    expect([
      await can(admin),
      await can(pm),
      await can(pm2),
      await can(member),
      await can(viewer),
    ]).toEqual([true, true, true, false, false]);
  });

  it('a Member given View on audit by the access rules can read it', async () => {
    const { member, project } = await world(app);
    await grant(app, 'MEMBER', { audit: { view: true } });
    expect((await member.agent.get(`/api/v1/projects/${project.id}/activity`)).status).toBe(200);
  });
});

describe('Draft templates are visible only with Edit on templates (doc 11 §12)', () => {
  it('Members and Viewers see published templates only, in the list and in detail', async () => {
    const { admin, pm, member, viewer, template } = await world(app);
    const draft = (
      await admin.agent
        .post('/api/v1/templates')
        .set(CSRF)
        .send({ ...SMALL_TEMPLATE, name: 'Secret draft' })
    ).body.template;
    // A draft of the next version of a published template.
    const next = (
      await admin.agent.post(`/api/v1/templates/${template.id}/new-version`).set(CSRF).send({})
    ).body.template;
    // An archived template.
    const arch = (
      await admin.agent
        .post('/api/v1/templates')
        .set(CSRF)
        .send({ ...SMALL_TEMPLATE, name: 'Old archived' })
    ).body.template;
    await admin.agent.post(`/api/v1/templates/${arch.id}/publish`).set(CSRF).send({});
    await admin.agent.post(`/api/v1/templates/${arch.id}/archive`).set(CSRF).send({});

    for (const who of [member, viewer]) {
      const list = await who.agent.get('/api/v1/templates');
      expect(list.status).toBe(200);
      const items = list.body.items as { id: string; status: string; draftId: string | null }[];
      expect(items.every((t) => t.status === 'PUBLISHED')).toBe(true);
      expect(items.some((t) => t.id === draft.id || t.id === arch.id)).toBe(false);
      expect(items.find((t) => t.id === template.id)?.draftId).toBeNull();
      for (const status of ['DRAFT', 'ARCHIVED']) {
        expect((await who.agent.get(`/api/v1/templates?status=${status}`)).body.items).toEqual([]);
      }
      expect((await who.agent.get(`/api/v1/templates/${draft.id}`)).status).toBe(404);
      expect((await who.agent.get(`/api/v1/templates/${next.id}`)).status).toBe(404);
      expect((await who.agent.get(`/api/v1/templates/${arch.id}`)).status).toBe(404);
      const detail = await who.agent.get(`/api/v1/templates/${template.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.template.draftId).toBeNull();
      expect(detail.body.template.versions.map((v: { status: string }) => v.status)).toEqual([
        'PUBLISHED',
      ]);
    }

    // PMs (Edit on templates) see everything.
    const pmList = (await pm.agent.get('/api/v1/templates')).body.items as { id: string }[];
    expect(pmList.some((t) => t.id === draft.id)).toBe(true);
    expect((await pm.agent.get(`/api/v1/templates/${next.id}`)).status).toBe(200);

    // It follows the access rules on every request: a PM without Edit loses drafts.
    await grant(app, 'PROJECT_MANAGER', {
      templates: { view: true, create: false, edit: false, delete: false },
    });
    expect((await pm.agent.get(`/api/v1/templates/${draft.id}`)).status).toBe(404);
    await resetRules();
    // ...and a Member given Edit gains them.
    await grant(app, 'MEMBER', { templates: { view: true, edit: true } });
    expect((await member.agent.get(`/api/v1/templates/${draft.id}`)).status).toBe(200);
  });
});

describe('PM handover (doc 11 §12)', () => {
  it('a PM can hand a project they manage to another PM; it is audited and they lose edit', async () => {
    const { admin, pm, pm2, project } = await world(app);
    const res = await pm.agent
      .patch(`/api/v1/projects/${project.id}`)
      .set(CSRF)
      .send({ managerId: pm2.user._id.toString() });
    expect(res.status).toBe(200);
    expect(res.body.project.manager.id).toBe(pm2.user._id.toString());
    expect(res.body.project.can.edit).toBe(false);

    const log = (await admin.agent.get(`/api/v1/projects/${project.id}/activity`)).body.items as {
      action: string;
      actor: { id: string };
      changes: { field: string; old: string; new: string }[];
    }[];
    const handover = log.find((e) => e.action === 'project_handover')!;
    expect(handover.actor.id).toBe(pm.user._id.toString());
    expect(handover.changes).toEqual([
      { field: 'managerId', old: pm.user._id.toString(), new: pm2.user._id.toString() },
    ]);
    // The old manager can still view; can't edit or hand it back.
    expect((await pm.agent.get(`/api/v1/projects/${project.id}`)).status).toBe(200);
    expect(
      (
        await pm.agent
          .patch(`/api/v1/projects/${project.id}`)
          .set(CSRF)
          .send({ managerId: pm.user._id.toString() })
      ).status,
    ).toBe(403);
    expect((await pm2.agent.get(`/api/v1/projects/${project.id}`)).body.project.can.edit).toBe(
      true,
    );
  });

  it('creating a project with another PM as manager is audited as a handover', async () => {
    const { pm, pm2, template, acme } = await world(app);
    const res = await pm.agent.post('/api/v1/projects').set(CSRF).send({
      name: 'Handed over at creation',
      clientId: acme.client.id,
      managerId: pm2.user._id.toString(),
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: template.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.project.can.edit).toBe(false);
    const log = (await pm.agent.get(`/api/v1/projects/${res.body.project.id}/activity`)).body
      .items as { action: string; changes: { field: string; new: string }[] }[];
    expect(log.find((e) => e.action === 'project_handover')?.changes[0]).toMatchObject({
      field: 'managerId',
      new: pm2.user._id.toString(),
    });
  });
});
