import {
  ACCESS_DEFAULT_CHANGES,
  DEFAULT_ACCESS_RULES,
  defaultPermissions,
  type AccessDefaultChange,
} from '@xc8/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AccessRuleModel, ActivityLogModel, MigrationModel } from '../src/models/index.js';
import {
  addMissingRecordTypes,
  applyAccessDefaultChanges,
} from '../src/services/accessDefaults.js';
import { ensureDefaultAccessRules } from '../src/services/accessRules.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';

useDatabase();
const app = makeApp();
const MEMBER_TIME = '2026-10-09-member-time-delete';

afterEach(async () => {
  await AccessRuleModel.deleteMany({});
  await MigrationModel.deleteMany({});
  await ActivityLogModel.deleteMany({ entityType: { $in: ['accessRule', 'migration'] } });
});

/** Production as it was before v0.6.8: seeded with Member time = VCE, then saved a few times. */
async function oldProductionGrid(version = 3) {
  await ensureDefaultAccessRules();
  await AccessRuleModel.updateOne(
    { role: 'MEMBER' },
    { $set: { 'permissions.time.delete': false, version } },
  );
}

const memberTimeDelete = async () =>
  (await AccessRuleModel.findOne({ role: 'MEMBER' }).lean())!.permissions as unknown as {
    time: { delete: boolean };
  };

describe('Access default changes (doc 11 §12): Member Delete on time', () => {
  it('the seeded default for Members is VCED on time', () => {
    expect(defaultPermissions('MEMBER').time).toMatchObject({
      view: true,
      create: true,
      edit: true,
      delete: true,
    });
  });

  it('switches a cell still at the old default, bumps the version and audits it; runs once', async () => {
    await oldProductionGrid(3);
    const [r] = await applyAccessDefaultChanges();
    expect(r).toMatchObject({
      id: MEMBER_TIME,
      status: 'applied',
      cells: [{ role: 'MEMBER', cell: 'time.delete', outcome: 'switched' }],
    });
    const doc = (await AccessRuleModel.findOne({ role: 'MEMBER' }).lean())!;
    expect((await memberTimeDelete()).time.delete).toBe(true);
    expect(doc.version).toBe(4);
    const entry = await ActivityLogModel.findOne({
      action: 'access_rule_default_migrated',
    }).lean();
    expect(entry).toMatchObject({
      actorId: null,
      entityType: 'accessRule',
      changes: [{ field: 'time.delete', old: false, new: true }],
      meta: { role: 'MEMBER', recordType: 'time', permission: 'delete', migration: MEMBER_TIME },
    });
    expect(entry!.reason).toMatch(/own time entries/);
    expect(await ActivityLogModel.countDocuments({ action: 'access_defaults_migrated' })).toBe(1);
    expect((await MigrationModel.findById(MEMBER_TIME).lean())!.status).toBe('DONE');

    // Second start-up: nothing changes and nothing is logged again.
    const [again] = await applyAccessDefaultChanges();
    expect(again!.status).toBe('skipped');
    expect((await AccessRuleModel.findOne({ role: 'MEMBER' }).lean())!.version).toBe(4);
    expect(await ActivityLogModel.countDocuments({ action: 'access_rule_default_migrated' })).toBe(
      1,
    );
  });

  it('after the migration a Member’s permissions include Delete on time', async () => {
    await oldProductionGrid();
    const { agent } = await signedInAs(app, 'MEMBER');
    expect((await agent.get('/api/v1/auth/me')).body.permissions.time.delete).toBe(false);
    await applyAccessDefaultChanges();
    expect((await agent.get('/api/v1/auth/me')).body.permissions.time.delete).toBe(true);
  });

  it('leaves a cell an Admin set by hand alone, even when it is back at the old value', async () => {
    await ensureDefaultAccessRules();
    const { agent } = await signedInAs(app, 'ADMIN');
    const roles = (await agent.get('/api/v1/access-rules')).body.roles;
    const member = roles.find((r: { role: string }) => r.role === 'MEMBER');
    // The Admin turns Member Delete on time off on purpose (new seed has it on).
    const off = await agent
      .put('/api/v1/access-rules/MEMBER')
      .set(CSRF)
      .send({ version: member.version, permissions: { time: { delete: false } } });
    expect(off.status).toBe(200);
    const [r] = await applyAccessDefaultChanges();
    expect(r!.cells).toEqual([{ role: 'MEMBER', cell: 'time.delete', outcome: 'admin_changed' }]);
    expect((await memberTimeDelete()).time.delete).toBe(false);
    expect(await ActivityLogModel.countDocuments({ action: 'access_rule_default_migrated' })).toBe(
      0,
    );
    // The summary entry is still written.
    expect(await ActivityLogModel.countDocuments({ action: 'access_defaults_migrated' })).toBe(1);
  });

  it('a fresh database already has the new default: nothing to switch', async () => {
    await ensureDefaultAccessRules();
    const [r] = await applyAccessDefaultChanges();
    expect(r!.cells[0]!.outcome).toBe('already');
    expect((await AccessRuleModel.findOne({ role: 'MEMBER' }).lean())!.version).toBe(1);
  });

  it('two instances starting together apply it once', async () => {
    await oldProductionGrid(2);
    const results = await Promise.all([applyAccessDefaultChanges(), applyAccessDefaultChanges()]);
    expect(results.flat().filter((r) => r.status === 'applied')).toHaveLength(1);
    expect((await AccessRuleModel.findOne({ role: 'MEMBER' }).lean())!.version).toBe(3);
    expect(await ActivityLogModel.countDocuments({ action: 'access_rule_default_migrated' })).toBe(
      1,
    );
  });

  it('retakes a claim abandoned by an instance that died mid-run', async () => {
    await oldProductionGrid();
    await MigrationModel.create({
      _id: MEMBER_TIME,
      kind: 'access_default_change',
      status: 'RUNNING',
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const [r] = await applyAccessDefaultChanges();
    expect(r!.status).toBe('applied');
    expect((await memberTimeDelete()).time.delete).toBe(true);
  });

  it('is reusable for any future default change (several roles and cells)', async () => {
    await ensureDefaultAccessRules();
    await AccessRuleModel.updateOne(
      { role: 'VIEWER' },
      { $set: { 'permissions.time.view': true } },
    );
    const change: AccessDefaultChange = {
      id: 'test-future-change',
      reason: 'Example',
      cells: [
        { role: 'PROJECT_MANAGER', record: 'clients', action: 'delete', from: true, to: false },
        { role: 'VIEWER', record: 'time', action: 'view', from: false, to: true },
      ],
    };
    const [r] = await applyAccessDefaultChanges(undefined, [change]);
    expect(r!.cells.map((c) => c.outcome)).toEqual(['switched', 'already']);
    const pm = (await AccessRuleModel.findOne({ role: 'PROJECT_MANAGER' }).lean())!;
    expect((pm.permissions as unknown as { clients: { delete: boolean } }).clients.delete).toBe(
      false,
    );
  });

  it('every registered change ends at the current seeded default, with a unique id', () => {
    const ids = ACCESS_DEFAULT_CHANGES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of ACCESS_DEFAULT_CHANGES)
      for (const cell of c.cells) {
        expect(DEFAULT_ACCESS_RULES[cell.role][cell.record][cell.action]).toBe(cell.to);
        expect(cell.from).not.toBe(cell.to);
      }
  });
});

describe('New record types after go-live (e.g. Issues)', () => {
  it('adds the default row only where it is missing, keeps Admin values, audits and bumps the version', async () => {
    await ensureDefaultAccessRules();
    // A grid saved before M3.5: no Issues row; an Admin had changed Member View on clients.
    await AccessRuleModel.updateOne(
      { role: 'MEMBER' },
      {
        $unset: { 'permissions.issues': 1 },
        $set: { 'permissions.clients.view': false, version: 5 },
      },
    );
    await AccessRuleModel.updateOne({ role: 'VIEWER' }, { $unset: { 'permissions.issues': 1 } });
    const { agent } = await signedInAs(app, 'ADMIN');
    const added = await addMissingRecordTypes();
    expect(added).toEqual(
      expect.arrayContaining([
        { role: 'MEMBER', record: 'issues' },
        { role: 'VIEWER', record: 'issues' },
      ]),
    );
    expect(added).toHaveLength(2);
    const member = (await AccessRuleModel.findOne({ role: 'MEMBER' }).lean())!;
    expect(member.version).toBe(6);
    const perms = member.permissions as unknown as Record<string, Record<string, boolean>>;
    expect(perms.issues).toMatchObject({ view: true, create: true, edit: true, delete: false });
    expect(perms.clients!.view).toBe(false);
    const roles = (await agent.get('/api/v1/access-rules')).body.roles;
    expect(
      roles.find((r: { role: string }) => r.role === 'VIEWER').permissions.issues,
    ).toMatchObject({
      view: true,
      create: false,
      edit: false,
      delete: false,
    });
    expect(
      await ActivityLogModel.countDocuments({
        action: 'access_rule_row_added',
        'meta.recordType': 'issues',
      }),
    ).toBe(2);
    // Idempotent.
    expect(await addMissingRecordTypes()).toEqual([]);
  });
});
