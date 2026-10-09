import { randomUUID } from 'node:crypto';
import {
  ACCESS_ACTIONS,
  DEFAULT_ACCESS_RULES,
  RECORD_TYPE_KEYS,
  SYSTEM_ROLES,
  actionApplies,
  type AccessAction,
  type PermissionGrid,
  type RecordType,
  type SystemRole,
} from '@xc8/shared';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ActivityLogModel, AccessRuleModel } from '../src/models/index.js';
import { ensureDefaultAccessRules } from '../src/services/accessRules.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';

useDatabase();
const app = makeApp();
type Agent = ReturnType<typeof request.agent>;

afterEach(async () => {
  // Each test starts from the seeded defaults and an empty access-rules audit trail.
  await AccessRuleModel.deleteMany({});
  await ActivityLogModel.deleteMany({ entityType: 'accessRule' });
});

async function rulesFor(agent: Agent, role: SystemRole) {
  const res = await agent.get('/api/v1/access-rules');
  expect(res.status).toBe(200);
  return res.body.roles.find((r: { role: string }) => r.role === role) as {
    role: SystemRole;
    version: number;
    permissions: PermissionGrid;
  };
}

async function putRules(agent: Agent, role: SystemRole, permissions: unknown, version?: number) {
  const v = version ?? (await rulesFor(agent, role)).version;
  return agent.put(`/api/v1/access-rules/${role}`).set(CSRF).send({ version: v, permissions });
}

describe('Seeded defaults (FR-ACL-01/02, doc 11 §6)', () => {
  it('GET /access-rules returns the §6 defaults for all four roles at version 1', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const res = await agent.get('/api/v1/access-rules');
    expect(res.status).toBe(200);
    expect(res.body.roles.map((r: { role: string }) => r.role)).toEqual([...SYSTEM_ROLES]);
    for (const r of res.body.roles) {
      expect(r.permissions).toEqual(DEFAULT_ACCESS_RULES[r.role as SystemRole]);
      expect(r).toMatchObject({ version: 1, updatedBy: null, updatedAt: null });
    }
  });

  it('every role sees its own effective permissions on /auth/me and /auth/me/permissions', async () => {
    for (const role of SYSTEM_ROLES) {
      const { agent } = await signedInAs(app, role);
      const me = await agent.get('/api/v1/auth/me');
      expect(me.body.permissions).toEqual(DEFAULT_ACCESS_RULES[role]);
      const mine = await agent.get('/api/v1/auth/me/permissions');
      expect(mine.body).toEqual({ role, permissions: DEFAULT_ACCESS_RULES[role] });
    }
  });

  it('seeding is idempotent and never overwrites changed rules', async () => {
    expect(await ensureDefaultAccessRules()).toBe(4);
    expect(await ensureDefaultAccessRules()).toBe(0);
    await AccessRuleModel.updateOne(
      { role: 'VIEWER' },
      { $set: { 'permissions.reports.view': false }, $inc: { version: 1 } },
    );
    await Promise.all([ensureDefaultAccessRules(), ensureDefaultAccessRules()]);
    expect(await AccessRuleModel.countDocuments()).toBe(4);
    const viewer = await AccessRuleModel.findOne({ role: 'VIEWER' }).lean();
    expect(viewer?.permissions.reports?.view).toBe(false);
    expect(viewer?.version).toBe(2);
  });
});

/**
 * Full grid enforcement against the defaults: every role × record type × applicable action.
 * A probe route per cell is declared through the same registry and gate as the real routes.
 */
describe('Central gate enforces every cell of the default grid', () => {
  const probeApp = makeApp({}, (registry) => {
    const r = registry.router('/__probe');
    for (const record of RECORD_TYPE_KEYS) {
      for (const action of ACCESS_ACTIONS) {
        if (!actionApplies(record, action)) continue;
        r.get(`/${record}/${action}`, { kind: 'permission', record, action }, (_req, res) =>
          res.json({ ok: true }),
        );
      }
    }
    return r.router;
  });

  it.each(SYSTEM_ROLES)('%s: allowed exactly where §6 grants, 403 elsewhere', async (role) => {
    const { agent } = await signedInAs(probeApp, role);
    const got: Record<string, string> = {};
    const want: Record<string, string> = {};
    for (const record of RECORD_TYPE_KEYS) {
      for (const action of ACCESS_ACTIONS) {
        if (!actionApplies(record, action)) continue;
        const res = await agent.get(`/api/v1/__probe/${record}/${action}`);
        got[`${record}.${action}`] = String(res.status);
        want[`${record}.${action}`] = DEFAULT_ACCESS_RULES[role][record][action] ? '200' : '403';
        if (res.status === 403) expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
    expect(got).toEqual(want);
  });

  it('n/a actions can never be declared on a route', async () => {
    const { perm } = await import('../src/access/registry.js');
    expect(() => perm('settings', 'delete')).toThrow();
    expect(() => perm('audit', 'edit')).toThrow();
    expect(() => perm('approvals', 'view')).toThrow();
    expect(() => perm('nope' as RecordType, 'view')).toThrow();
  });
});

/** The real Milestone 1.5 routes, one probe request per (record type, action) they implement. */
describe('Real routes follow the default grid per role', () => {
  const ids: Record<string, string> = {};
  let adminAgent: Agent;

  beforeAll(async () => {
    const admin = await signedInAs(app, 'ADMIN');
    adminAgent = admin.agent;
    const member = await signedInAs(app, 'MEMBER');
    ids.member = member.user._id.toString();
    ids.team = (
      await adminAgent.post('/api/v1/teams').set(CSRF).send({ name: 'Probe team' })
    ).body.team.id;
    ids.client = (
      await adminAgent.post('/api/v1/clients').set(CSRF).send({ name: 'Probe client' })
    ).body.client.id;
    ids.contact = (
      await adminAgent
        .post(`/api/v1/clients/${ids.client}/contacts`)
        .set(CSRF)
        .send({ name: 'Probe contact' })
    ).body.contact.id;
  });

  const uid = () => randomUUID().slice(0, 8);
  type Probe = (agent: Agent) => Promise<request.Response>;
  // Probes that address a client record the test Member cannot see (NFR-25 answers 404).
  const OUT_OF_SCOPE_FOR_MEMBER = new Set([
    'clients.edit',
    'clients.delete',
    'contacts.create',
    'contacts.edit',
    'contacts.delete',
  ]);
  const probes: [RecordType, AccessAction, Probe][] = [
    ['users', 'view', (a) => a.get('/api/v1/users')],
    [
      'users',
      'create',
      (a) =>
        a
          .post('/api/v1/users')
          .set(CSRF)
          .send({
            name: 'Probe User',
            email: `probe-${uid()}@xceler8.example`,
            systemRole: 'VIEWER',
            jobRole: 'SUPPORT',
          }),
    ],
    [
      'users',
      'edit',
      (a) => a.patch(`/api/v1/users/${ids.member}`).set(CSRF).send({ weeklyCapacityHours: 30 }),
    ],
    ['users', 'delete', (a) => a.post(`/api/v1/users/${ids.member}/reactivate`).set(CSRF).send({})],
    ['teams', 'view', (a) => a.get('/api/v1/teams')],
    [
      'teams',
      'create',
      (a) =>
        a
          .post('/api/v1/teams')
          .set(CSRF)
          .send({ name: `T ${uid()}` }),
    ],
    [
      'teams',
      'edit',
      (a) => a.patch(`/api/v1/teams/${ids.team}`).set(CSRF).send({ name: 'Probe team' }),
    ],
    ['teams', 'delete', (a) => a.post(`/api/v1/teams/${ids.team}/unarchive`).set(CSRF).send({})],
    ['clients', 'view', (a) => a.get('/api/v1/clients')],
    [
      'clients',
      'create',
      (a) =>
        a
          .post('/api/v1/clients')
          .set(CSRF)
          .send({ name: `C ${uid()}` }),
    ],
    [
      'clients',
      'edit',
      (a) => a.patch(`/api/v1/clients/${ids.client}`).set(CSRF).send({ industry: 'Retail' }),
    ],
    [
      'clients',
      'delete',
      (a) => a.post(`/api/v1/clients/${ids.client}/reactivate`).set(CSRF).send({}),
    ],
    ['contacts', 'view', (a) => a.get('/api/v1/contacts')],
    [
      'contacts',
      'create',
      (a) => a.post(`/api/v1/clients/${ids.client}/contacts`).set(CSRF).send({ name: 'New C' }),
    ],
    [
      'contacts',
      'edit',
      (a) => a.patch(`/api/v1/contacts/${ids.contact}`).set(CSRF).send({ phone: '555' }),
    ],
    [
      'contacts',
      'delete',
      (a) => a.post(`/api/v1/contacts/${ids.contact}/reactivate`).set(CSRF).send({}),
    ],
    ['projects', 'view', (a) => a.get(`/api/v1/clients/${ids.client}/projects`)],
    ['accessRules', 'view', (a) => a.get('/api/v1/access-rules')],
    [
      'accessRules',
      'edit',
      async (a) => {
        const v = (await rulesFor(adminAgent, 'VIEWER')).version;
        return a.put('/api/v1/access-rules/VIEWER').set(CSRF).send({ version: v, permissions: {} });
      },
    ],
    ['audit', 'view', (a) => a.get('/api/v1/audit')],
  ];

  it.each(SYSTEM_ROLES)('%s', async (role) => {
    const { agent } = await signedInAs(app, role);
    for (const [record, action, probe] of probes) {
      const res = await probe(agent);
      const allowed = DEFAULT_ACCESS_RULES[role][record][action];
      const label = `${role} ${record}.${action} -> ${res.status}`;
      if (allowed) {
        expect(res.status, label).toBeLessThan(400 + (res.status === 404 ? 5 : 0));
      } else if (role === 'MEMBER' && OUT_OF_SCOPE_FOR_MEMBER.has(`${record}.${action}`)) {
        // NFR-25: the Member is on no project of this client, so its records answer 404, not 403.
        expect([label, res.status, res.body.error?.code]).toEqual([label, 404, 'NOT_FOUND']);
      } else {
        expect([label, res.status, res.body.error?.code]).toEqual([label, 403, 'FORBIDDEN']);
      }
    }
  });

  it('reset is also gated by accessRules.edit', async () => {
    const v = (await rulesFor(adminAgent, 'VIEWER')).version;
    for (const role of ['PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const) {
      const { agent } = await signedInAs(app, role);
      const res = await agent
        .post('/api/v1/access-rules/VIEWER/reset')
        .set(CSRF)
        .send({ version: v });
      expect(res.status).toBe(403);
    }
    const ok = await adminAgent
      .post('/api/v1/access-rules/VIEWER/reset')
      .set(CSRF)
      .send({ version: v });
    expect(ok.status).toBe(200);
  });
});

describe('Changing rules', () => {
  it('AC-33.1 / FR-ACL-06 a change applies on the affected user’s very next request, no sign-out', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const pm = await signedInAs(app, 'PROJECT_MANAGER');
    const c = await admin.agent.post('/api/v1/clients').set(CSRF).send({ name: 'Next request Co' });
    const url = `/api/v1/clients/${c.body.client.id}/deactivate`;
    expect((await pm.agent.post(url).set(CSRF).send({})).status).toBe(200);

    const saved = await putRules(admin.agent, 'PROJECT_MANAGER', { clients: { delete: false } });
    expect(saved.status).toBe(200);
    expect(saved.body.rules.permissions.clients).toEqual({
      view: true,
      create: true,
      edit: true,
      delete: false,
    });
    const denied = await pm.agent
      .post(`/api/v1/clients/${c.body.client.id}/reactivate`)
      .set(CSRF)
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    expect((await pm.agent.get('/api/v1/auth/me')).body.permissions.clients.delete).toBe(false);
    // Still allowed: what wasn't changed.
    expect(
      (await pm.agent.patch(`/api/v1/clients/${c.body.client.id}`).set(CSRF).send({ notes: 'x' }))
        .status,
    ).toBe(200);

    // Granting works the same way: a Viewer gets Create on clients on the next request.
    const viewer = await signedInAs(app, 'VIEWER');
    expect(
      (await viewer.agent.post('/api/v1/clients').set(CSRF).send({ name: 'Viewer Co' })).status,
    ).toBe(403);
    expect((await putRules(admin.agent, 'VIEWER', { clients: { create: true } })).status).toBe(200);
    expect(
      (await viewer.agent.post('/api/v1/clients').set(CSRF).send({ name: 'Viewer Co' })).status,
    ).toBe(201);
  });

  it('AC-34.1 / FR-ACL-05 Admin users & accessRules cells are locked: 422 and nothing saved', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const before = await rulesFor(admin.agent, 'ADMIN');
    for (const patch of [
      { users: { delete: false } },
      { users: { view: false, create: false, edit: false, delete: false } },
      { accessRules: { edit: false } },
      { accessRules: { view: false } },
    ]) {
      const res = await putRules(admin.agent, 'ADMIN', patch, before.version);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('LOCKED_PERMISSION');
    }
    const after = await rulesFor(admin.agent, 'ADMIN');
    expect(after.version).toBe(before.version);
    expect(after.permissions).toEqual(DEFAULT_ACCESS_RULES.ADMIN);
    expect(await ActivityLogModel.countDocuments({ entityType: 'accessRule' })).toBe(0);
    // Re-sending the locked values unchanged is harmless.
    expect(
      (await putRules(admin.agent, 'ADMIN', { users: { view: true, delete: true } })).status,
    ).toBe(200);
    // Admin still manages users afterwards.
    expect((await admin.agent.get('/api/v1/users')).status).toBe(200);
  });

  it('AC-33.2 / FR-ACL-04 Edit without View is 422; with View it is saved and enforced', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const bad = await putRules(admin.agent, 'VIEWER', { teams: { edit: true } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toEqual([
      expect.objectContaining({ code: 'VIEW_REQUIRED', path: 'teams.view' }),
    ]);
    const unview = await putRules(admin.agent, 'PROJECT_MANAGER', { clients: { view: false } });
    expect(unview.status).toBe(422);

    const ok = await putRules(admin.agent, 'VIEWER', { teams: { view: true, edit: true } });
    expect(ok.status).toBe(200);
    const viewer = await signedInAs(app, 'VIEWER');
    const t = await admin.agent.post('/api/v1/teams').set(CSRF).send({ name: 'Viewer team' });
    expect((await viewer.agent.get('/api/v1/teams')).status).toBe(200);
    expect(
      (
        await viewer.agent
          .patch(`/api/v1/teams/${t.body.team.id}`)
          .set(CSRF)
          .send({ name: 'Renamed by viewer' })
      ).status,
    ).toBe(200);
    expect((await viewer.agent.post('/api/v1/teams').set(CSRF).send({ name: 'No' })).status).toBe(
      403,
    );
  });

  it('EC-57 unknown record types, actions, values, n/a cells and roles are rejected; nothing saved', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const v = (await rulesFor(admin.agent, 'PROJECT_MANAGER')).version;
    const cases: unknown[] = [
      { invoices: { view: true } },
      { clients: { archive: true } },
      { clients: { view: 'yes' } },
      { clients: true },
      { settings: { create: true } },
      { reports: { edit: true } },
      { audit: { delete: true } },
      { approvals: { view: true } },
    ];
    for (const permissions of cases) {
      const res = await putRules(admin.agent, 'PROJECT_MANAGER', permissions, v);
      expect([JSON.stringify(permissions), res.status]).toEqual([JSON.stringify(permissions), 422]);
    }
    // Valid cells in the same payload as an invalid one are not saved either.
    const mixed = await putRules(
      admin.agent,
      'PROJECT_MANAGER',
      { teams: { view: true }, invoices: { view: true } },
      v,
    );
    expect(mixed.status).toBe(422);
    const missingVersion = await admin.agent
      .put('/api/v1/access-rules/PROJECT_MANAGER')
      .set(CSRF)
      .send({ permissions: {} });
    expect(missingVersion.status).toBe(422);
    const extra = await admin.agent
      .put('/api/v1/access-rules/PROJECT_MANAGER')
      .set(CSRF)
      .send({ version: v, permissions: {}, role: 'ADMIN' });
    expect(extra.status).toBe(422);
    expect(
      (
        await admin.agent
          .put('/api/v1/access-rules/OWNER')
          .set(CSRF)
          .send({ version: 1, permissions: {} })
      ).status,
    ).toBe(404);
    const after = await rulesFor(admin.agent, 'PROJECT_MANAGER');
    expect(after.version).toBe(v);
    expect(after.permissions).toEqual(DEFAULT_ACCESS_RULES.PROJECT_MANAGER);
  });

  it('AC-33.5 / FR-ACL-12 the second of two simultaneous saves gets 409 and is not applied', async () => {
    const a = await signedInAs(app, 'ADMIN');
    const b = await signedInAs(app, 'ADMIN');
    const v = (await rulesFor(a.agent, 'MEMBER')).version;
    const first = await putRules(a.agent, 'MEMBER', { documents: { edit: true } }, v);
    expect(first.status).toBe(200);
    expect(first.body.rules.version).toBe(v + 1);
    const second = await putRules(b.agent, 'MEMBER', { reports: { view: false } }, v);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('VERSION_CONFLICT');
    expect(second.body.error.message).toMatch(/Someone else saved these rules/);
    const now = await rulesFor(a.agent, 'MEMBER');
    expect(now.permissions.documents.edit).toBe(true);
    expect(now.permissions.reports.view).toBe(true);

    // Truly concurrent saves on the same version: exactly one wins.
    const results = await Promise.all([
      putRules(a.agent, 'MEMBER', { templates: { create: true } }, now.version),
      putRules(b.agent, 'MEMBER', { templates: { edit: true } }, now.version),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('AC-33.4 / FR-ACL-10 one audit entry per changed cell with who, role, record, action, old, new', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    const res = await putRules(admin.agent, 'PROJECT_MANAGER', {
      clients: { delete: false },
      templates: { delete: false },
      reports: { view: true }, // unchanged: no entry
    });
    expect(res.status).toBe(200);
    expect(res.body.rules.updatedBy).toEqual({
      id: admin.user._id.toString(),
      name: admin.user.name,
    });
    const log = await admin.agent.get('/api/v1/audit?entityType=accessRule');
    expect(log.status).toBe(200);
    expect(log.body.total).toBe(2);
    const entries = log.body.items as {
      actor: { id: string };
      action: string;
      changes: { field: string; old: unknown; new: unknown }[];
      meta: Record<string, unknown>;
      at: string;
    }[];
    expect(entries.map((e) => e.changes[0]!.field).sort()).toEqual([
      'clients.delete',
      'templates.delete',
    ]);
    for (const e of entries) {
      expect(e.actor.id).toBe(admin.user._id.toString());
      expect(e.action).toBe('access_rule_changed');
      expect(e.changes[0]).toMatchObject({ old: true, new: false });
      expect(e.meta).toMatchObject({ role: 'PROJECT_MANAGER' });
      expect(Date.parse(e.at)).not.toBeNaN();
    }
    // Saving with no changes writes nothing and keeps the version.
    const v = res.body.rules.version;
    const noop = await putRules(admin.agent, 'PROJECT_MANAGER', { clients: { delete: false } }, v);
    expect(noop.body.rules.version).toBe(v);
    expect(await ActivityLogModel.countDocuments({ entityType: 'accessRule' })).toBe(2);
    // Non-Admins can't read the audit log by default.
    const pm = await signedInAs(app, 'PROJECT_MANAGER');
    expect((await pm.agent.get('/api/v1/audit')).status).toBe(403);
  });

  it('AC-33.6 / FR-ACL-02 Reset to defaults restores §6 for that role only, audited per cell', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    await putRules(admin.agent, 'PROJECT_MANAGER', {
      clients: { delete: false },
      audit: { view: true },
    });
    await putRules(admin.agent, 'VIEWER', { clients: { create: true } });
    const pmRules = await rulesFor(admin.agent, 'PROJECT_MANAGER');
    const stale = await admin.agent
      .post('/api/v1/access-rules/PROJECT_MANAGER/reset')
      .set(CSRF)
      .send({ version: pmRules.version - 1 });
    expect(stale.status).toBe(409);
    const res = await admin.agent
      .post('/api/v1/access-rules/PROJECT_MANAGER/reset')
      .set(CSRF)
      .send({ version: pmRules.version });
    expect(res.status).toBe(200);
    expect(res.body.rules.permissions).toEqual(DEFAULT_ACCESS_RULES.PROJECT_MANAGER);
    expect(res.body.rules.version).toBe(pmRules.version + 1);
    expect((await rulesFor(admin.agent, 'VIEWER')).permissions.clients.create).toBe(true);
    const resets = await ActivityLogModel.find({ action: 'access_rules_reset' }).lean();
    expect(resets.map((e) => e.changes[0]?.field).sort()).toEqual(['audit.view', 'clients.delete']);
  });
});

describe('Fixed rules the grid cannot change', () => {
  it('Q-27 the access rules screen is Admin-only by default', async () => {
    for (const role of ['PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const) {
      const { agent } = await signedInAs(app, role);
      expect((await agent.get('/api/v1/access-rules')).status).toBe(403);
      expect(
        (
          await agent
            .put(`/api/v1/access-rules/${role}`)
            .set(CSRF)
            .send({ version: 1, permissions: {} })
        ).status,
      ).toBe(403);
    }
  });

  it('Q-26 project Delete can’t be granted to non-Admins (422); Admin keeps it configurable', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    for (const role of ['PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const) {
      const res = await putRules(admin.agent, role, { projects: { view: true, delete: true } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('LOCKED_PERMISSION');
    }
    const off = await putRules(admin.agent, 'ADMIN', { projects: { delete: false } });
    expect(off.status).toBe(200);
    expect(off.body.rules.permissions.projects.delete).toBe(false);
  });

  it('a grant on users never lets a non-Admin create, change or remove Admins', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    expect(
      (
        await putRules(admin.agent, 'PROJECT_MANAGER', {
          users: { view: true, create: true, edit: true, delete: true },
        })
      ).status,
    ).toBe(200);
    const pm = await signedInAs(app, 'PROJECT_MANAGER');
    const invite = (systemRole: SystemRole) =>
      pm.agent
        .post('/api/v1/users')
        .set(CSRF)
        .send({
          name: 'Escalation Test',
          email: `esc-${randomUUID().slice(0, 6)}@xceler8.example`,
          systemRole,
          jobRole: 'SUPPORT',
        });
    expect((await invite('ADMIN')).status).toBe(403);
    const member = await invite('MEMBER');
    expect(member.status).toBe(201);
    const memberId = member.body.user.id;
    expect(
      (await pm.agent.patch(`/api/v1/users/${memberId}`).set(CSRF).send({ systemRole: 'ADMIN' }))
        .status,
    ).toBe(403);
    const adminId = admin.user._id.toString();
    expect(
      (await pm.agent.patch(`/api/v1/users/${adminId}`).set(CSRF).send({ name: 'Hacked' })).status,
    ).toBe(403);
    expect(
      (await pm.agent.post(`/api/v1/users/${adminId}/deactivate`).set(CSRF).send({})).status,
    ).toBe(403);
    expect((await pm.agent.post(`/api/v1/users/${adminId}/invite`).set(CSRF).send({})).status).toBe(
      403,
    );
    expect(
      (
        await pm.agent
          .patch(`/api/v1/users/${memberId}`)
          .set(CSRF)
          .send({ weeklyCapacityHours: 20 })
      ).status,
    ).toBe(200);
  });
});

describe('Access gate basics', () => {
  it('anonymous requests to protected routes get 401 before any permission check', async () => {
    expect((await request(app).get('/api/v1/access-rules')).status).toBe(401);
    expect(
      (
        await request(app)
          .put('/api/v1/access-rules/ADMIN')
          .set(CSRF)
          .send({ version: 1, permissions: {} })
      ).status,
    ).toBe(401);
    expect((await request(app).get('/api/v1/auth/me/permissions')).status).toBe(401);
    expect((await request(app).get('/api/v1/audit')).status).toBe(401);
  });

  it('CSRF header is still required for writes (NFR-03)', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const res = await agent
      .put('/api/v1/access-rules/VIEWER')
      .send({ version: 1, permissions: {} });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });
});
