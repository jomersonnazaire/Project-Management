import { RECORD_TYPE_KEYS } from '@xc8/shared';
import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AccessRuleModel,
  MigrationModel,
  SavedReportModel,
  TimeEntryModel,
} from '../src/models/index.js';
import {
  addMissingCells,
  addMissingRecordTypes,
  applyAccessDefaultChanges,
} from '../src/services/accessDefaults.js';
import { ensureDefaultAccessRules } from '../src/services/accessRules.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';
import { grant, resetRules } from './m2helpers.js';

/** Queen's M8 round 2 defects DEF-011..014 (bodies match except the per-request requestId). */
useDatabase();
const app = makeApp();
afterEach(async () => {
  await resetRules();
  await MigrationModel.deleteMany({});
});

describe('DEF-011: seeded access rules apply without a grid save', () => {
  it('a grid seeded and migrated at startup is enforced on the next request, exactly as shown', async () => {
    // An older production grid: no Team & workload row and no Reports Export cell yet.
    await ensureDefaultAccessRules();
    await AccessRuleModel.updateMany(
      {},
      { $unset: { 'permissions.workload': 1, 'permissions.reports.export': 1 } },
    );
    await ensureDefaultAccessRules();
    await addMissingRecordTypes();
    await addMissingCells();
    await applyAccessDefaultChanges();
    const viewer = await signedInAs(app, 'VIEWER');
    // No grid save anywhere: the viewer's Reports View applies straight away.
    expect((await viewer.agent.get('/api/v1/reports/project-status')).status).toBe(200);
    const admin = await signedInAs(app, 'ADMIN');
    const grid = (await admin.agent.get('/api/v1/access-rules')).body.roles as {
      role: string;
      permissions: Record<string, Record<string, boolean>>;
    }[];
    for (const role of ['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const) {
      const me = await signedInAs(app, role);
      const enforced = (await me.agent.get('/api/v1/auth/me')).body.permissions;
      const shown = grid.find((g) => g.role === role)!.permissions;
      for (const record of RECORD_TYPE_KEYS) {
        expect(enforced[record], `${role}.${record}`).toEqual(shown[record]);
      }
    }
  });
});

describe('DEF-011: an empty access-rules collection', () => {
  it('a Viewer gets 200 on Reports with no stored rules, and the defaults get seeded', async () => {
    await AccessRuleModel.deleteMany({});
    expect(await AccessRuleModel.countDocuments()).toBe(0);
    const viewer = await signedInAs(app, 'VIEWER');
    expect((await viewer.agent.get('/api/v1/reports/filters')).status).toBe(200);
    expect((await viewer.agent.get('/api/v1/reports/project-status')).status).toBe(200);
    // Requests fall back to the defaults without writing them; the startup seed stores them.
    await ensureDefaultAccessRules();
    expect((await viewer.agent.get('/api/v1/reports/project-status')).status).toBe(200);
    const roles = (await AccessRuleModel.find().lean()).map((d) => d.role).sort();
    expect(roles).toEqual(['ADMIN', 'MEMBER', 'PROJECT_MANAGER', 'VIEWER']);
    const viewerDoc = (await AccessRuleModel.findOne({ role: 'VIEWER' }).lean())!;
    expect((viewerDoc.permissions as unknown as { reports: { view: boolean } }).reports.view).toBe(
      true,
    );
  });
});

describe('DEF-012: Reports Export needs View', () => {
  it('clears Export when View is off (in the same change or already off)', async () => {
    await ensureDefaultAccessRules();
    const admin = await signedInAs(app, 'ADMIN');
    const put = async (permissions: object) => {
      const roles = (await admin.agent.get('/api/v1/access-rules')).body.roles;
      const version = roles.find((r: { role: string }) => r.role === 'VIEWER').version;
      return admin.agent
        .put('/api/v1/access-rules/VIEWER')
        .set(CSRF)
        .send({ version, permissions });
    };
    const both = await put({ reports: { view: false, export: true } });
    expect(both.status).toBe(200);
    expect(both.body.rules.permissions.reports).toMatchObject({ view: false, export: false });
    const onlyExport = await put({ reports: { export: true } });
    expect(onlyExport.status).toBe(200);
    expect(onlyExport.body.rules.permissions.reports).toMatchObject({
      view: false,
      export: false,
    });
    const stored = (await AccessRuleModel.findOne({ role: 'VIEWER' }).lean())!
      .permissions as unknown as { reports: { export: boolean } };
    expect(stored.reports.export).toBe(false);
  });
});

describe('NFR-25: owner-only records answer 404 to everyone else', () => {
  it('DEF-013: a saved DAR is 404 with the same body for a real and a made-up id', async () => {
    const owner = await signedInAs(app, 'MEMBER');
    const doc = await SavedReportModel.create({
      userId: owner.user._id,
      from: '2026-10-13',
      to: '2026-10-13',
      savedAt: new Date(),
      totalActivities: 0,
      totalMinutes: 0,
      report: { rows: [] },
    });
    const real = doc._id.toString();
    const fake = new Types.ObjectId().toString();
    for (const role of ['VIEWER', 'MEMBER', 'PROJECT_MANAGER', 'ADMIN'] as const) {
      const other = await signedInAs(app, role);
      for (const suffix of ['', '/export/pdf']) {
        const a = await other.agent.get(`/api/v1/dar/saved/${real}${suffix}`);
        const b = await other.agent.get(`/api/v1/dar/saved/${fake}${suffix}`);
        const c = await other.agent.get(`/api/v1/dar/saved/not-an-id${suffix}`);
        expect(a.status, `${role}${suffix}`).toBe(404);
        expect(a.body.error).toEqual(b.body.error);
        expect(a.body.error).toEqual(c.body.error);
        expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
      }
    }
    expect((await owner.agent.get(`/api/v1/dar/saved/${real}`)).status).toBe(200);
  });

  it("DEF-014: PATCH/DELETE on another user's tracker entry is 404, like /time", async () => {
    const owner = await signedInAs(app, 'MEMBER');
    const e = await TimeEntryModel.collection.insertOne({
      userId: owner.user._id,
      workDate: new Date('2026-10-13T00:00:00Z'),
      kind: 'QUICK',
      title: 'Mine',
      hours: 1,
    });
    const id = e.insertedId.toString();
    const fake = new Types.ObjectId().toString();
    const check = async (agent: Awaited<ReturnType<typeof signedInAs>>['agent']) => {
      const real = await agent
        .patch(`/api/v1/tracker/entries/${id}`)
        .set(CSRF)
        .send({ notes: 'x' });
      const made = await agent
        .patch(`/api/v1/tracker/entries/${fake}`)
        .set(CSRF)
        .send({ notes: 'x' });
      expect(real.status).toBe(404);
      expect(real.body.error).toEqual(made.body.error);
      const del = await agent.delete(`/api/v1/tracker/entries/${id}`).set(CSRF);
      expect(del.status).toBe(404);
      expect(del.body.error).toEqual(
        (await agent.delete(`/api/v1/tracker/entries/${fake}`).set(CSRF)).body.error,
      );
      expect((await agent.patch(`/api/v1/time/${id}`).set(CSRF).send({ hours: 1 })).status).toBe(
        404,
      );
    };
    await check((await signedInAs(app, 'VIEWER')).agent);
    await check((await signedInAs(app, 'PROJECT_MANAGER')).agent);
    await grant(app, 'VIEWER', { activities: { view: true, edit: true, delete: true } });
    await check((await signedInAs(app, 'VIEWER')).agent);
    expect(await TimeEntryModel.exists({ _id: e.insertedId })).toBeTruthy();
  });
});
