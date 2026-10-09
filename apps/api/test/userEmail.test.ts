import { describe, expect, it } from 'vitest';
import { ActivityLogModel, SessionModel } from '../src/models/index.js';
import { CSRF, PASSWORD, createUser, login, makeApp, signedInAs, useDatabase } from './helpers.js';

useDatabase();
const app = makeApp();

describe('Admin edits a user email', () => {
  it('lowercases, saves, audits, keeps the password and ends the user’s sessions', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const user = await createUser({ email: 'old.address@xceler8.example' });
    const userAgent = await login(app, user.email);
    expect((await userAgent.get('/api/v1/auth/me')).status).toBe(200);

    const res = await admin.agent
      .patch(`/api/v1/users/${user._id}`)
      .set(CSRF)
      .send({ email: '  New.Address@Xceler8.Example ' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('new.address@xceler8.example');

    const log = await ActivityLogModel.findOne({ entityId: user._id, action: 'user_updated' });
    expect(log?.changes).toEqual([
      expect.objectContaining({
        field: 'email',
        old: 'old.address@xceler8.example',
        new: 'new.address@xceler8.example',
      }),
    ]);

    // Their other sessions end; the password still works with the new address only.
    expect((await userAgent.get('/api/v1/auth/me')).status).toBe(401);
    expect(await SessionModel.countDocuments({ userId: user._id })).toBe(0);
    const again = await login(app, 'new.address@xceler8.example', PASSWORD);
    expect((await again.get('/api/v1/auth/me')).body.user.email).toBe(
      'new.address@xceler8.example',
    );
    await expect(login(app, 'old.address@xceler8.example')).rejects.toThrow(/401/);
    // The acting Admin stays signed in.
    expect((await admin.agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('rejects a bad format with 400 and a taken email (any case) with 409 and a field error', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const user = await createUser();
    const other = await createUser({ email: 'taken@xceler8.example' });
    const bad = await admin.agent
      .patch(`/api/v1/users/${user._id}`)
      .set(CSRF)
      .send({ email: 'not-an-email' });
    expect(bad.status).toBe(400);

    const taken = await admin.agent
      .patch(`/api/v1/users/${user._id}`)
      .set(CSRF)
      .send({ email: 'TAKEN@xceler8.example' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('EMAIL_IN_USE');
    expect(taken.body.error.details).toEqual([{ path: 'email', message: expect.any(String) }]);
    expect(other.email).toBe('taken@xceler8.example');

    // Saving the same email is a no-op, not a conflict with itself.
    const same = await admin.agent
      .patch(`/api/v1/users/${user._id}`)
      .set(CSRF)
      .send({ email: user.email.toUpperCase() });
    expect(same.status).toBe(200);
    expect(await ActivityLogModel.countDocuments({ entityId: user._id })).toBe(0);
  });

  it('FR-USR-06 cancels an unused reset link and audits it', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const user = await createUser();
    const link = await admin.agent.post(`/api/v1/users/${user._id}/invite`).set(CSRF).send({});
    expect(link.status).toBe(200);
    const token = String(link.body.inviteUrl).split('#token=')[1];
    expect(
      (await admin.agent.post('/api/v1/auth/invite/verify').set(CSRF).send({ token })).status,
    ).toBe(200);

    const res = await admin.agent
      .patch(`/api/v1/users/${user._id}`)
      .set(CSRF)
      .send({ email: 'relinked@xceler8.example' });
    expect(res.status).toBe(200);
    expect(
      (await admin.agent.post('/api/v1/auth/invite/verify').set(CSRF).send({ token })).status,
    ).toBe(400);
    const log = await ActivityLogModel.findOne({ entityId: user._id, action: 'user_updated' });
    expect(log?.changes.map((c) => c.field)).toEqual(['email', 'previousLink']);
  });

  it('an Admin changing their own email keeps their current session', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const res = await admin.agent
      .patch(`/api/v1/users/${admin.user._id}`)
      .set(CSRF)
      .send({ email: 'me.renamed@xceler8.example' });
    expect(res.status).toBe(200);
    expect((await admin.agent.get('/api/v1/auth/me')).body.user.email).toBe(
      'me.renamed@xceler8.example',
    );
  });

  it('needs Edit on Users, and non-Admins can never change an Admin’s email', async () => {
    const pm = await signedInAs(app, 'PROJECT_MANAGER');
    const target = await createUser();
    expect(
      (
        await pm.agent
          .patch(`/api/v1/users/${target._id}`)
          .set(CSRF)
          .send({ email: 'x@xceler8.example' })
      ).status,
    ).toBe(403);

    const admin = await signedInAs(app, 'ADMIN');
    const grant = await admin.agent.get('/api/v1/access-rules');
    const pmRules = grant.body.roles.find((r: { role: string }) => r.role === 'PROJECT_MANAGER');
    expect(
      (
        await admin.agent
          .put('/api/v1/access-rules/PROJECT_MANAGER')
          .set(CSRF)
          .send({
            version: pmRules.version,
            permissions: { users: { view: true, create: false, edit: true, delete: false } },
          })
      ).status,
    ).toBe(200);
    expect(
      (
        await pm.agent
          .patch(`/api/v1/users/${admin.user._id}`)
          .set(CSRF)
          .send({ email: 'hijack@xceler8.example' })
      ).status,
    ).toBe(403);
    const ok = await pm.agent
      .patch(`/api/v1/users/${target._id}`)
      .set(CSRF)
      .send({ email: 'granted@xceler8.example' });
    expect(ok.status).toBe(200);
  });
});
