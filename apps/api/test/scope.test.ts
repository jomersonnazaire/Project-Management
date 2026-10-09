import { describe, expect, it } from 'vitest';
import { AccessRuleModel, ProjectModel } from '../src/models/index.js';
import { assertProjectScope } from '../src/services/scope.js';
import { CSRF, createUser, makeApp, signedInAs, useDatabase } from './helpers.js';

useDatabase();
const app = makeApp();

async function grant(role: string, permissions: Record<string, Record<string, boolean>>) {
  const admin = await signedInAs(app, 'ADMIN');
  const current = await admin.agent.get('/api/v1/access-rules');
  const version = current.body.roles.find((r: { role: string }) => r.role === role).version;
  const res = await admin.agent
    .put(`/api/v1/access-rules/${role}`)
    .set(CSRF)
    .send({ version, permissions });
  expect(res.status).toBe(200);
}

describe('Fixed project scope (FR-ACL-07, A-12)', () => {
  it('AC-33.3 Member with Edit on projects still can’t act on a project they aren’t on (404)', async () => {
    const member = await createUser({ systemRole: 'MEMBER' });
    const other = await createUser({ systemRole: 'MEMBER' });
    const mine = { memberIds: [member._id], managerId: null };
    const notMine = { memberIds: [other._id], managerId: null };
    expect(() => assertProjectScope(member, mine, 'edit')).not.toThrow();
    expect(() => assertProjectScope(member, notMine, 'edit')).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => assertProjectScope(member, notMine, 'view')).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    // Q-26: even inside their own project, only Admins delete.
    expect(() => assertProjectScope(member, mine, 'delete')).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('PM edits and archives only projects they manage; only Admins delete (Q-26)', async () => {
    const pm = await createUser({ systemRole: 'PROJECT_MANAGER' });
    const pm2 = await createUser({ systemRole: 'PROJECT_MANAGER' });
    const admin = await createUser({ systemRole: 'ADMIN' });
    const own = { managerId: pm._id, memberIds: [] };
    const others = { managerId: pm2._id, memberIds: [] };
    expect(() => assertProjectScope(pm, own, 'edit')).not.toThrow();
    expect(() => assertProjectScope(pm, own, 'archive')).not.toThrow();
    expect(() => assertProjectScope(pm, others, 'view')).not.toThrow();
    expect(() => assertProjectScope(pm, others, 'edit')).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => assertProjectScope(pm, others, 'archive')).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => assertProjectScope(pm, own, 'delete')).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => assertProjectScope(admin, others, 'delete')).not.toThrow();
    expect(() => assertProjectScope(admin, others, 'edit')).not.toThrow();
  });
});

describe('Clients › Projects tab and counts follow the project scope (FR-CLI-11/12, AC-35.2/35.3)', () => {
  it('AC-35.3 a client with no projects shows an empty list for every role that can view it', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const c = await admin.agent
      .post('/api/v1/clients')
      .set(CSRF)
      .send({ name: 'Empty Projects Co' });
    for (const role of ['ADMIN', 'PROJECT_MANAGER', 'VIEWER'] as const) {
      const { agent } = await signedInAs(app, role);
      const res = await agent.get(`/api/v1/clients/${c.body.client.id}/projects`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], total: 0 });
      expect(
        (await agent.get(`/api/v1/clients/${c.body.client.id}`)).body.client.projectCount,
      ).toBe(0);
    }
  });

  it('Members see and count only their own projects; others never leak; archived hidden by default', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const member = await signedInAs(app, 'MEMBER');
    const pm = await createUser({ systemRole: 'PROJECT_MANAGER', name: 'Petra Manager' });
    const acme = (await admin.agent.post('/api/v1/clients').set(CSRF).send({ name: 'Acme Scope' }))
      .body.client.id;
    const other = (
      await admin.agent.post('/api/v1/clients').set(CSRF).send({ name: 'Other Scope' })
    ).body.client.id;
    await admin.agent
      .post(`/api/v1/clients/${acme}/contacts`)
      .set(CSRF)
      .send({ name: 'Acme Person' });
    const otherContact = await admin.agent
      .post(`/api/v1/clients/${other}/contacts`)
      .set(CSRF)
      .send({ name: 'Other Person' });
    await ProjectModel.create([
      {
        name: 'SAP B1 Rollout',
        clientId: acme,
        managerId: pm._id,
        memberIds: [member.user._id],
        status: 'ACTIVE',
        computed: { health: 'DELAYED', updatedAt: new Date() },
        progress: 42,
        startDate: new Date('2026-08-18'),
        plannedEndDate: new Date('2026-11-20'),
      },
      { name: 'Warehouse Add-on', clientId: acme, managerId: pm._id, memberIds: [] },
      { name: '2025 Upgrade', clientId: acme, status: 'COMPLETED', archived: true, memberIds: [] },
      { name: 'Secret Other', clientId: other, memberIds: [] },
    ]);

    // Admin and Viewer see every non-archived project of the client.
    for (const agent of [admin.agent, (await signedInAs(app, 'VIEWER')).agent]) {
      const res = await agent.get(`/api/v1/clients/${acme}/projects`);
      expect(res.body.items.map((p: { name: string }) => p.name)).toEqual([
        'SAP B1 Rollout',
        'Warehouse Add-on',
      ]);
      expect((await agent.get(`/api/v1/clients/${acme}`)).body.client.projectCount).toBe(2);
    }
    const archived = await admin.agent.get(`/api/v1/clients/${acme}/projects?status=ARCHIVED`);
    expect(archived.body.items.map((p: { name: string }) => p.name)).toEqual(['2025 Upgrade']);
    const delayed = await admin.agent.get(`/api/v1/clients/${acme}/projects?status=DELAYED`);
    expect(delayed.body.items).toHaveLength(1);
    expect(delayed.body.items[0]).toMatchObject({
      name: 'SAP B1 Rollout',
      managerName: 'Petra Manager',
      progress: 42,
      status: 'ACTIVE',
      health: 'DELAYED',
      archived: false,
      startDate: '2026-08-18',
    });
    expect((await admin.agent.get(`/api/v1/clients/${acme}/projects?status=NOPE`)).status).toBe(
      400,
    );

    // Member: only the project they belong to, and the count matches.
    const mine = await member.agent.get(`/api/v1/clients/${acme}/projects`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ total: 1 });
    expect(mine.body.items.map((p: { name: string }) => p.name)).toEqual(['SAP B1 Rollout']);
    const detail = await member.agent.get(`/api/v1/clients/${acme}`);
    expect(detail.body.client.projectCount).toBe(1);
    const list = await member.agent.get('/api/v1/clients');
    expect(list.body.items.map((c: { name: string }) => c.name)).toEqual(['Acme Scope']);
    expect(list.body.items[0].projectCount).toBe(1);
    // The other client and its contacts/projects are out of scope: 404, never 403 (FR-ACL-09).
    expect((await member.agent.get(`/api/v1/clients/${other}`)).status).toBe(404);
    expect((await member.agent.get(`/api/v1/clients/${other}/projects`)).status).toBe(404);
    expect((await member.agent.get(`/api/v1/clients/${other}/contacts`)).status).toBe(404);
    expect(
      (await member.agent.get(`/api/v1/contacts/${otherContact.body.contact.id}`)).status,
    ).toBe(404);
    const contacts = await member.agent.get('/api/v1/contacts');
    expect(contacts.body.items.map((c: { name: string }) => c.name)).toEqual(['Acme Person']);
    expect((await member.agent.get(`/api/v1/contacts?clientId=${other}`)).body.total).toBe(0);
    expect((await member.agent.get(`/api/v1/clients/${acme}/contacts`)).body.items).toHaveLength(1);

    // A grant can't widen the scope: Member with Edit on clients still can't touch "Other".
    await grant('MEMBER', { clients: { view: true, edit: true } });
    expect(
      (await member.agent.patch(`/api/v1/clients/${other}`).set(CSRF).send({ notes: 'x' })).status,
    ).toBe(404);
    expect(
      (await member.agent.patch(`/api/v1/clients/${acme}`).set(CSRF).send({ notes: 'ok' })).status,
    ).toBe(200);
    await AccessRuleModel.deleteMany({});

    // Removing View on projects from a role hides the tab's data with 403, not an error (EC-54).
    await grant('VIEWER', { projects: { view: false } });
    const viewer = await signedInAs(app, 'VIEWER');
    expect((await viewer.agent.get(`/api/v1/clients/${acme}/projects`)).status).toBe(403);
    expect((await viewer.agent.get(`/api/v1/clients/${acme}`)).status).toBe(200);
    await AccessRuleModel.deleteMany({});
  });
});
