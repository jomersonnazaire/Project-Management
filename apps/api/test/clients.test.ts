import { describe, expect, it } from 'vitest';
import { ClientContactModel, UserModel } from '../src/models/index.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';

useDatabase();
const app = makeApp();

describe('Clients and contacts (US-04, FR-CLI-01..03, 07 §4)', () => {
  it('Admin and PM create clients and contacts; names are unique per client list', async () => {
    const { agent } = await signedInAs(app, 'PROJECT_MANAGER');
    const c = await agent
      .post('/api/v1/clients')
      .set(CSRF)
      .send({ name: 'Acme Trading', industry: 'Retail' });
    expect(c.status).toBe(201);
    expect(
      (await agent.post('/api/v1/clients').set(CSRF).send({ name: 'ACME trading' })).status,
    ).toBe(409);

    const contact = await agent
      .post(`/api/v1/clients/${c.body.client.id}/contacts`)
      .set(CSRF)
      .send({
        name: 'R. Santos',
        department: 'Finance',
        email: 'RSantos@Acme.example',
        phone: '+63 2 8000 1001',
      });
    expect(contact.status).toBe(201);
    expect(contact.body.contact).toMatchObject({
      clientName: 'Acme Trading',
      email: 'rsantos@acme.example',
      pendingCount: 0,
      overdueCount: 0,
    });

    const admin = await signedInAs(app, 'ADMIN');
    expect(
      (await admin.agent.post('/api/v1/clients').set(CSRF).send({ name: 'Northwind' })).status,
    ).toBe(201);
  });

  it('AC-04.1 / TC-C01 requires a name and validates email', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const c = await agent.post('/api/v1/clients').set(CSRF).send({ name: 'Validation Co' });
    const url = `/api/v1/clients/${c.body.client.id}/contacts`;
    const noName = await agent.post(url).set(CSRF).send({ email: 'a@b.example' });
    expect(noName.status).toBe(400);
    expect(noName.body.error.details[0].path).toBe('name');
    const badEmail = await agent.post(url).set(CSRF).send({ name: 'X', email: 'not-an-email' });
    expect(badEmail.status).toBe(400);
    // Unknown client -> 404 (contacts always belong to an existing client company).
    expect(
      (
        await agent
          .post('/api/v1/clients/0123456789abcdef01234567/contacts')
          .set(CSRF)
          .send({ name: 'X' })
      ).status,
    ).toBe(404);
  });

  it('EC-22 / TC-C08 rejects password, role or session fields on a contact', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const c = await agent.post('/api/v1/clients').set(CSRF).send({ name: 'Isolation Co' });
    const url = `/api/v1/clients/${c.body.client.id}/contacts`;
    for (const extra of [
      { password: 'Secret-pass-123!' },
      { passwordHash: 'x' },
      { systemRole: 'ADMIN' },
      { role: 'MEMBER' },
      { sessionToken: 'x' },
    ]) {
      expect(
        (
          await agent
            .post(url)
            .set(CSRF)
            .send({ name: 'Sneaky', ...extra })
        ).status,
      ).toBe(400);
    }
    const ok = await agent
      .post(url)
      .set(CSRF)
      .send({ name: 'Plain Contact', email: 'plain@iso.example' });
    expect(
      (
        await agent
          .patch(`/api/v1/contacts/${ok.body.contact.id}`)
          .set(CSRF)
          .send({ password: 'x' })
      ).status,
    ).toBe(400);
    // AC-05.4: no user account exists for the contact.
    expect(await UserModel.countDocuments({ email: 'plain@iso.example' })).toBe(0);
    const stored = await ClientContactModel.findById(ok.body.contact.id).lean();
    expect(Object.keys(stored!)).not.toEqual(
      expect.arrayContaining(['password', 'passwordHash', 'systemRole']),
    );
  });

  it('Member and Viewer cannot create or edit clients or contacts (403)', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const c = await admin.agent.post('/api/v1/clients').set(CSRF).send({ name: 'Perm Co' });
    const contact = await admin.agent
      .post(`/api/v1/clients/${c.body.client.id}/contacts`)
      .set(CSRF)
      .send({ name: 'Perm Contact' });
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const { agent } = await signedInAs(app, role);
      // NFR-25: the Member is on no project of this client, so its records answer 404, not 403.
      const recordDenied = role === 'MEMBER' ? 404 : 403;
      expect(
        (
          await agent
            .post('/api/v1/clients')
            .set(CSRF)
            .send({ name: `New ${role}` })
        ).status,
      ).toBe(403);
      expect(
        (await agent.patch(`/api/v1/clients/${c.body.client.id}`).set(CSRF).send({ notes: 'x' }))
          .status,
      ).toBe(recordDenied);
      expect(
        (
          await agent
            .post(`/api/v1/clients/${c.body.client.id}/contacts`)
            .set(CSRF)
            .send({ name: 'X' })
        ).status,
      ).toBe(recordDenied);
      expect(
        (
          await agent
            .patch(`/api/v1/contacts/${contact.body.contact.id}`)
            .set(CSRF)
            .send({ name: 'Y' })
        ).status,
      ).toBe(recordDenied);
      expect(
        (
          await agent
            .post(`/api/v1/contacts/${contact.body.contact.id}/deactivate`)
            .set(CSRF)
            .send({})
        ).status,
      ).toBe(recordDenied);
    }
  });

  it('Viewer reads all clients and contacts; Member (no projects yet) sees none and gets 404 by id (TC-C14, TC-K01)', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const c = await admin.agent.post('/api/v1/clients').set(CSRF).send({ name: 'Visibility Co' });
    const contact = await admin.agent
      .post(`/api/v1/clients/${c.body.client.id}/contacts`)
      .set(CSRF)
      .send({ name: 'Vis Contact', email: 'vis@vis.example', phone: '123' });

    const viewer = await signedInAs(app, 'VIEWER');
    const vList = await viewer.agent.get('/api/v1/contacts?pageSize=100');
    expect(vList.body.items.map((x: { email: string }) => x.email)).toContain('vis@vis.example');
    expect((await viewer.agent.get(`/api/v1/clients/${c.body.client.id}`)).status).toBe(200);

    const member = await signedInAs(app, 'MEMBER');
    expect((await member.agent.get('/api/v1/clients')).body).toMatchObject({ items: [], total: 0 });
    expect((await member.agent.get('/api/v1/contacts')).body).toMatchObject({
      items: [],
      total: 0,
    });
    expect((await member.agent.get(`/api/v1/clients/${c.body.client.id}`)).status).toBe(404);
    expect((await member.agent.get(`/api/v1/contacts/${contact.body.contact.id}`)).status).toBe(
      404,
    );
    expect((await member.agent.get(`/api/v1/clients/${c.body.client.id}/contacts`)).status).toBe(
      404,
    );
  });

  it('FR-CLI-08 contacts are deactivated, not deleted, and hidden from default lists', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const c = await agent.post('/api/v1/clients').set(CSRF).send({ name: 'Deact Co' });
    const contact = await agent
      .post(`/api/v1/clients/${c.body.client.id}/contacts`)
      .set(CSRF)
      .send({ name: 'Old Contact' });
    const res = await agent
      .post(`/api/v1/contacts/${contact.body.contact.id}/deactivate`)
      .set(CSRF)
      .send({});
    expect(res.body.contact.active).toBe(false);
    const active = await agent.get(`/api/v1/clients/${c.body.client.id}/contacts`);
    expect(active.body.items).toHaveLength(0);
    const all = await agent.get(
      `/api/v1/clients/${c.body.client.id}/contacts?includeInactive=true`,
    );
    expect(all.body.items).toHaveLength(1);
    expect(
      (await agent.delete(`/api/v1/contacts/${contact.body.contact.id}`).set(CSRF)).status,
    ).toBe(404);
  });

  it('requires authentication for every client endpoint', async () => {
    const { default: request } = await import('supertest');
    expect((await request(app).get('/api/v1/clients')).status).toBe(401);
    expect((await request(app).get('/api/v1/contacts')).status).toBe(401);
    expect((await request(app).post('/api/v1/clients').set(CSRF).send({ name: 'x' })).status).toBe(
      401,
    );
  });
});
