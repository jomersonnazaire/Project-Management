import { describe, expect, it } from 'vitest';
import {
  ActivityLogModel,
  ClientContactModel,
  ClientModel,
  TeamModel,
} from '../src/models/index.js';
import { CSRF, createUser, login, makeApp, signedInAs, useDatabase } from './helpers.js';

useDatabase();
const app = makeApp();

const invite = (overrides: Record<string, unknown> = {}) => ({
  name: 'New Person',
  email: `new-${Math.random().toString(36).slice(2, 8)}@xceler8.example`,
  systemRole: 'MEMBER',
  jobRole: 'DEVELOPER',
  ...overrides,
});

describe('User administration (US-02)', () => {
  it('AC-02.1 / TC-B01 rejects a duplicate email regardless of case', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const first = await agent
      .post('/api/v1/users')
      .set(CSRF)
      .send(invite({ email: 'dupe@xceler8.example' }));
    expect(first.status).toBe(201);
    const second = await agent
      .post('/api/v1/users')
      .set(CSRF)
      .send(invite({ email: 'DUPE@Xceler8.example' }));
    expect(second.status).toBe(409);
    expect(second.body.error.message).toBe('Email already in use');
  });

  it('TC-B09 / FR-USR-02/03 stores access role and job role as separate validated fields', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const team = await TeamModel.create({ name: 'Development', nameKey: 'development' });
    const ok = await agent
      .post('/api/v1/users')
      .set(CSRF)
      .send(invite({ systemRole: 'VIEWER', jobRole: 'QA_TESTER', teamIds: [team._id.toString()] }));
    expect(ok.status).toBe(201);
    expect(ok.body.user).toMatchObject({
      systemRole: 'VIEWER',
      jobRole: 'QA_TESTER',
      teamIds: [team._id.toString()],
      weeklyCapacityHours: 40,
    });

    // A job role is not an access role and vice versa.
    expect(
      (
        await agent
          .post('/api/v1/users')
          .set(CSRF)
          .send(invite({ systemRole: 'DEVELOPER' }))
      ).status,
    ).toBe(400);
    expect(
      (
        await agent
          .post('/api/v1/users')
          .set(CSRF)
          .send(invite({ jobRole: 'ADMIN' }))
      ).status,
    ).toBe(400);
    // Unknown team ids are rejected.
    expect(
      (
        await agent
          .post('/api/v1/users')
          .set(CSRF)
          .send(invite({ teamIds: ['0123456789abcdef01234567'] }))
      ).status,
    ).toBe(400);
  });

  it('AC-02.3 / TC-B02 returns 403 to PM, Member and Viewer on user create, list and role change', async () => {
    const target = await createUser();
    for (const role of ['PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const) {
      const { agent } = await signedInAs(app, role);
      expect((await agent.post('/api/v1/users').set(CSRF).send(invite())).status).toBe(403);
      expect((await agent.get('/api/v1/users')).status).toBe(403);
      expect(
        (await agent.patch(`/api/v1/users/${target._id}`).set(CSRF).send({ systemRole: 'ADMIN' }))
          .status,
      ).toBe(403);
      expect(
        (await agent.post(`/api/v1/users/${target._id}/deactivate`).set(CSRF).send({})).status,
      ).toBe(403);
    }
  });

  it('AC-02.4 / TC-B03 returns 403 when a user changes their own access role (PM and Admin)', async () => {
    const pm = await signedInAs(app, 'PROJECT_MANAGER');
    const r1 = await pm.agent
      .patch(`/api/v1/users/${pm.user._id}`)
      .set(CSRF)
      .send({ systemRole: 'ADMIN' });
    expect(r1.status).toBe(403);
    const admin = await signedInAs(app, 'ADMIN');
    const r2 = await admin.agent
      .patch(`/api/v1/users/${admin.user._id}`)
      .set(CSRF)
      .send({ systemRole: 'MEMBER' });
    expect(r2.status).toBe(403);
    expect(r2.body.error.code).toBe('SELF_ROLE_CHANGE');
    // Admin may still edit their own name.
    expect(
      (
        await admin.agent
          .patch(`/api/v1/users/${admin.user._id}`)
          .set(CSRF)
          .send({ name: 'Renamed Admin' })
      ).status,
    ).toBe(200);
  });

  it('Admin changes another user role; the change is audited (FR-AUD-01)', async () => {
    const { agent, user: admin } = await signedInAs(app, 'ADMIN');
    const target = await createUser({ systemRole: 'MEMBER' });
    const res = await agent
      .patch(`/api/v1/users/${target._id}`)
      .set(CSRF)
      .send({ systemRole: 'PROJECT_MANAGER', jobRole: 'PROJECT_MANAGER' });
    expect(res.status).toBe(200);
    expect(res.body.user.systemRole).toBe('PROJECT_MANAGER');
    const log = await ActivityLogModel.findOne({
      entityId: target._id,
      action: 'role_changed',
    }).lean();
    expect(log?.actorId?.toString()).toBe(admin._id.toString());
    expect(log?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'systemRole', old: 'MEMBER', new: 'PROJECT_MANAGER' }),
      ]),
    );
  });

  it('TC-B05 / EC-26 an Admin cannot deactivate themselves', async () => {
    const { agent, user } = await signedInAs(app, 'ADMIN');
    const res = await agent.post(`/api/v1/users/${user._id}/deactivate`).set(CSRF).send({});
    expect(res.status).toBe(409);
  });

  it('FR-AUTH-06 deactivate keeps the record (status Deactivated) and reactivation restores access', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const target = await createUser();
    const res = await agent.post(`/api/v1/users/${target._id}/deactivate`).set(CSRF).send({});
    expect(res.body.user.status).toBe('DEACTIVATED');
    const list = await agent.get('/api/v1/users?status=DEACTIVATED&pageSize=100');
    expect(list.body.items.map((u: { id: string }) => u.id)).toContain(target._id.toString());
    await agent.post(`/api/v1/users/${target._id}/reactivate`).set(CSRF).send({}).expect(200);
    await login(app, target.email);
  });

  it('TC-K03 rejects unknown fields such as isAdmin or passwordHash', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const target = await createUser();
    expect(
      (await agent.patch(`/api/v1/users/${target._id}`).set(CSRF).send({ isAdmin: true })).status,
    ).toBe(400);
    expect(
      (await agent.patch(`/api/v1/users/${target._id}`).set(CSRF).send({ passwordHash: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (
        await agent
          .post('/api/v1/users')
          .set(CSRF)
          .send(invite({ active: false }))
      ).status,
    ).toBe(400);
  });

  it('AC-04.2 / TC-C02 client contacts never appear in the user list', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const client = await ClientModel.create({ name: 'List Co', nameKey: 'list co' });
    await ClientContactModel.create({
      clientId: client._id,
      name: 'Contact Person',
      email: 'contact.person@list.example',
    });
    const res = await agent.get('/api/v1/users?pageSize=100');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('contact.person@list.example');
    expect(res.body.items.every((u: Record<string, unknown>) => !('passwordHash' in u))).toBe(true);
  });

  it('paginates with pageSize capped at 100', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    expect((await agent.get('/api/v1/users?pageSize=101')).status).toBe(400);
    const res = await agent.get('/api/v1/users?pageSize=2&page=1');
    expect(res.body.items.length).toBeLessThanOrEqual(2);
    expect(res.body.total).toBeGreaterThan(2);
  });
});

describe('Teams (US-03)', () => {
  it('AC-03.1 Admin creates, renames, archives teams; a user can belong to several', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const a = await agent.post('/api/v1/teams').set(CSRF).send({ name: 'Consulting' });
    const b = await agent.post('/api/v1/teams').set(CSRF).send({ name: 'Support' });
    expect(a.status).toBe(201);
    expect((await agent.post('/api/v1/teams').set(CSRF).send({ name: 'consulting' })).status).toBe(
      409,
    );
    const renamed = await agent
      .patch(`/api/v1/teams/${b.body.team.id}`)
      .set(CSRF)
      .send({ name: 'Customer Support' });
    expect(renamed.body.team.name).toBe('Customer Support');

    const user = await agent
      .post('/api/v1/users')
      .set(CSRF)
      .send(invite({ teamIds: [a.body.team.id, b.body.team.id] }));
    expect(user.body.user.teamIds).toHaveLength(2);

    const archived = await agent.post(`/api/v1/teams/${b.body.team.id}/archive`).set(CSRF).send({});
    expect(archived.body.team.archived).toBe(true);
    const list = await agent.get('/api/v1/teams');
    expect(list.body.items.map((t: { name: string }) => t.name)).not.toContain('Customer Support');
    const all = await agent.get('/api/v1/teams?includeArchived=true');
    expect(all.body.items.map((t: { name: string }) => t.name)).toContain('Customer Support');
  });

  it('non-Admins can read teams but not manage them', async () => {
    for (const role of ['PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const) {
      const { agent } = await signedInAs(app, role);
      expect((await agent.get('/api/v1/teams')).status).toBe(200);
      expect(
        (
          await agent
            .post('/api/v1/teams')
            .set(CSRF)
            .send({ name: `T-${role}` })
        ).status,
      ).toBe(403);
    }
  });
});
