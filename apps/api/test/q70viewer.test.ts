import { ACCESS_DEFAULT_CHANGES, defaultPermissions } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccessRuleModel,
  ActivityLogModel,
  MigrationModel,
  TimeEntryModel,
} from '../src/models/index.js';
import { applyAccessDefaultChanges } from '../src/services/accessDefaults.js';
import { ensureDefaultAccessRules } from '../src/services/accessRules.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';
import { lookups } from './trackerHelpers.js';

/** Q-70 option B (Jomerson): Viewers have no time and no activity tracker access. */
useDatabase();
const app = makeApp();
const ID = '2026-10-13-viewer-no-tracker';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T03:00:00Z'));
});
afterEach(async () => {
  vi.useRealTimers();
  await AccessRuleModel.deleteMany({});
  await MigrationModel.deleteMany({});
  await ActivityLogModel.deleteMany({ entityType: { $in: ['accessRule', 'migration'] } });
});

describe('Q-70: Viewer has no time or tracker access', () => {
  it('defaults: time, activities and leave off, the rest as before', () => {
    const p = defaultPermissions('VIEWER');
    for (const a of ['view', 'create', 'edit', 'delete'] as const) {
      expect(p.time[a]).toBe(false);
      expect(p.activities[a]).toBe(false);
      expect(p.leave[a]).toBe(false); // Q-72
    }
    expect(p.reports.view && p.reports.export).toBe(true);
    expect(p.workload.view).toBe(true);
    expect(p.issues).toMatchObject({ view: true, create: false, edit: false, delete: false });
  });

  it('AC-56.1: API answers 403 to a Viewer on every own time and tracker endpoint', async () => {
    const v = await signedInAs(app, 'VIEWER');
    const viewer = v.agent;
    const l = await lookups();
    // An own entry put straight in the DB (e.g. from before the change): still no access.
    const own = await TimeEntryModel.collection.insertOne({
      userId: v.user._id,
      workDate: new Date('2026-10-20'),
      hours: 1,
    });
    const labels = [
      'GET /time',
      'GET /time/options',
      'POST /time',
      'PATCH /time/:id',
      'GET /tracker/day',
      'GET /tracker/running',
      'GET /tracker/people',
      'POST /tracker/start',
      'POST /tracker/stop',
      'POST /tracker/entries',
      'PATCH /tracker/entries/:id',
      'DELETE /tracker/entries/:id',
      'POST /tracker/days/:date/submit',
    ];
    const calls = [
      viewer.get('/api/v1/time'),
      viewer.get('/api/v1/time/options'),
      viewer.post('/api/v1/time').set(CSRF).send({ hours: 1, workDate: '2026-10-20' }),
      viewer.patch(`/api/v1/time/${own.insertedId}`).set(CSRF).send({ hours: 2 }),
      viewer.get('/api/v1/tracker/day?date=2026-10-20'),
      viewer.get('/api/v1/tracker/running'),
      viewer.get('/api/v1/tracker/people'),
      viewer.post('/api/v1/tracker/start').set(CSRF).send({ activityTypeId: l.configuration }),
      viewer.post('/api/v1/tracker/stop').set(CSRF).send({}),
      viewer
        .post('/api/v1/tracker/entries')
        .set(CSRF)
        .send({ date: '2026-10-20', timeIn: '09:00', timeOut: '10:00' }),
      viewer.patch(`/api/v1/tracker/entries/${own.insertedId}`).set(CSRF).send({ notes: 'x' }),
      viewer.delete(`/api/v1/tracker/entries/${own.insertedId}`).set(CSRF),
      viewer.post('/api/v1/tracker/days/2026-10-20/submit').set(CSRF).send({}),
    ];
    const results = await Promise.all(calls);
    results.forEach((res, i) => expect(res.status, labels[i]).toBe(403));
  });

  it('EC-111: a Viewer gets 403 on their own old time entry and it is kept', async () => {
    const v = await signedInAs(app, 'VIEWER');
    const own = await TimeEntryModel.collection.insertOne({
      userId: v.user._id,
      workDate: new Date('2026-10-20'),
      hours: 1,
    });
    expect((await v.agent.delete(`/api/v1/time/${own.insertedId}`).set(CSRF)).status).toBe(403);
    expect(await TimeEntryModel.exists({ _id: own.insertedId })).toBeTruthy();
  });

  const change = ACCESS_DEFAULT_CHANGES.filter((c) => c.id === ID);
  const OLD = { view: true, create: true, edit: true, delete: true };
  const OFF = { view: false, create: false, edit: false, delete: false };
  const viewerActivities = async () =>
    (await AccessRuleModel.findOne({ role: 'VIEWER' }).lean())!.permissions.activities;
  /** Production before Q-70: Viewer activities at the old default VCED. */
  async function oldGrid() {
    await ensureDefaultAccessRules();
    await AccessRuleModel.updateOne(
      { role: 'VIEWER' },
      { $set: { 'permissions.activities': OLD, version: 3 } },
    );
  }

  it('EC-112 migration: a seeded Viewer row at the old default is switched off, once', async () => {
    expect(change).toHaveLength(1);
    await oldGrid();
    const [r] = await applyAccessDefaultChanges(undefined, change);
    expect(r!.status).toBe('applied');
    expect(r!.cells.every((c) => c.outcome === 'switched')).toBe(true);
    expect(await viewerActivities()).toMatchObject(OFF);
    const member = (await AccessRuleModel.findOne({ role: 'MEMBER' }).lean())!;
    expect(member.permissions.activities?.create).toBe(true);
    const [again] = await applyAccessDefaultChanges(undefined, change);
    expect(again!.status).toBe('skipped');
  });

  it('EC-112 migration: a row reset by an Admin (touched, but still at the old value) is switched off', async () => {
    await oldGrid();
    const admin = await signedInAs(app, 'ADMIN');
    const rule = (await AccessRuleModel.findOne({ role: 'VIEWER' }).lean())!;
    await AccessRuleModel.updateOne({ role: 'VIEWER' }, { $set: { updatedBy: admin.user._id } });
    // QA's reset and earlier hand edits of these cells are in the audit log.
    await ActivityLogModel.insertMany([
      {
        actorId: admin.user._id,
        entityType: 'accessRule',
        entityId: rule._id,
        action: 'access_rules_reset',
        meta: { role: 'VIEWER' },
      },
      ...(['view', 'create', 'edit', 'delete'] as const).map((permission) => ({
        actorId: admin.user._id,
        entityType: 'accessRule',
        entityId: rule._id,
        action: 'access_rule_changed',
        meta: { role: 'VIEWER', recordType: 'activities', permission },
      })),
    ]);
    const [r] = await applyAccessDefaultChanges(undefined, change);
    expect(r!.cells.map((c) => c.outcome)).toEqual(Array(4).fill('switched'));
    expect(await viewerActivities()).toMatchObject(OFF);
  });

  it('EC-112 migration: a customised Viewer value (differs from the old default) is left alone', async () => {
    await oldGrid();
    const custom = { view: true, create: false, edit: false, delete: false };
    await AccessRuleModel.updateOne(
      { role: 'VIEWER' },
      { $set: { 'permissions.activities': custom } },
    );
    const [r] = await applyAccessDefaultChanges(undefined, change);
    // view still equals the old default (true) so it is switched; the cells an Admin changed
    // to a different value are already "off" and stay as they are.
    expect(r!.cells.find((c) => c.cell === 'activities.view')!.outcome).toBe('switched');
    for (const a of ['create', 'edit', 'delete'])
      expect(r!.cells.find((c) => c.cell === `activities.${a}`)!.outcome).toBe('already');
    expect(await viewerActivities()).toMatchObject(OFF);
  });
});
