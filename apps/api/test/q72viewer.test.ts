import { ACCESS_DEFAULT_CHANGES, defaultPermissions } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AccessRuleModel,
  ActivityLogModel,
  LeaveModel,
  LeaveTypeModel,
  MigrationModel,
  UserModel,
} from '../src/models/index.js';
import { applyAccessDefaultChanges } from '../src/services/accessDefaults.js';
import { ensureDefaultAccessRules } from '../src/services/accessRules.js';
import { ensureDefaultLeaveTypes } from '../src/services/leave.js';
import { resetTestTime, setTestTime } from '../src/lib/clock.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';

/** Q-72 No (Jomerson; doc 14 FR-ACT-35, AC-56.1, EC-113): Viewers have no leave access. */
useDatabase();
const app = makeApp({ SESSION_IDLE_MINUTES: '1440' });
const ID = '2026-10-13-viewer-no-leave';

beforeEach(() => {
  setTestTime('2026-10-14T02:00:00Z');
});
afterEach(async () => {
  resetTestTime();
  await AccessRuleModel.deleteMany({});
  await MigrationModel.deleteMany({});
  await LeaveModel.deleteMany({});
  await LeaveTypeModel.deleteMany({});
  await ActivityLogModel.deleteMany({});
});

/** A Viewer (reporting to the PM) with a leave record from before Q-72. */
async function setup() {
  const w = await world(app);
  await ensureDefaultLeaveTypes();
  const vacation = (await LeaveTypeModel.findOne({ name: 'Vacation' }).lean())!._id;
  await UserModel.updateOne({ _id: w.viewer.user._id }, { supervisorId: w.pm.user._id });
  const day = new Date('2026-10-20T00:00:00Z');
  const leave = await LeaveModel.create({
    userId: w.viewer.user._id,
    leaveTypeId: vacation,
    dayPart: 'FULL',
    from: day,
    to: day,
    dates: [day],
    days: 1,
    byYear: [{ year: 2026, days: 1 }],
    reason: 'Before Q-72',
    recordedBy: w.viewer.user._id,
  });
  return { w, vacation: vacation.toString(), leaveId: leave._id.toString() };
}

describe('Q-72: Viewer has no leave access', () => {
  it('defaults: Viewer leave all false; other roles unchanged', () => {
    for (const a of ['view', 'create', 'edit', 'delete'] as const)
      expect(defaultPermissions('VIEWER').leave[a]).toBe(false);
    expect(defaultPermissions('MEMBER').leave.view).toBe(true);
    expect(defaultPermissions('PROJECT_MANAGER').leave.view).toBe(true);
  });

  it('AC-56.1: permissions say leave off and every /leave call is 403 for a Viewer', async () => {
    const { w, vacation, leaveId } = await setup();
    const me = await w.viewer.agent.get('/api/v1/auth/me/permissions');
    expect(me.status).toBe(200);
    const leave = me.body.permissions?.leave ?? me.body.leave;
    expect(leave).toMatchObject({ view: false, create: false, edit: false, delete: false });
    const v = w.viewer.agent;
    const labels = [
      'GET /leave/types',
      'GET /leave/balances',
      'GET /leave',
      'GET /leave/team',
      'GET /leave/:id',
      'POST /leave',
      'POST /leave/:id/cancel',
    ];
    const results = await Promise.all([
      v.get('/api/v1/leave/types'),
      v.get('/api/v1/leave/balances'),
      v.get('/api/v1/leave'),
      v.get('/api/v1/leave/team'),
      v.get(`/api/v1/leave/${leaveId}`),
      v.post('/api/v1/leave').set(CSRF).send({
        leaveTypeId: vacation,
        dayPart: 'FULL',
        from: '2026-10-21',
        to: '2026-10-21',
      }),
      v.post(`/api/v1/leave/${leaveId}/cancel`).set(CSRF).send({}),
    ]);
    results.forEach((res, i) => {
      expect(res.status, labels[i]).toBe(403);
      expect(res.body.error?.code ?? res.body.code, labels[i]).toBe('FORBIDDEN');
    });
    // Nothing deleted or cancelled.
    const kept = await LeaveModel.findById(leaveId).lean();
    expect(kept?.status).toBe('RECORDED');
    expect(await LeaveModel.countDocuments({ userId: w.viewer.user._id })).toBe(1);
  });

  it("EC-113: Admins and the Viewer's PM still see the Viewer's existing leave", async () => {
    const { w, leaveId } = await setup();
    const viewerId = w.viewer.user._id.toString();
    for (const who of [w.admin, w.pm]) {
      const one = await who.agent.get(`/api/v1/leave/${leaveId}`);
      expect(one.status).toBe(200);
      expect(one.body.item.id).toBe(leaveId);
      const list = await who.agent.get(`/api/v1/leave?userId=${viewerId}`);
      expect(list.status).toBe(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([leaveId]);
      const team = await who.agent.get('/api/v1/leave/team');
      expect(team.status).toBe(200);
      expect(team.body.items.map((i: { id: string }) => i.id)).toContain(leaveId);
    }
  });

  const change = ACCESS_DEFAULT_CHANGES.filter((c) => c.id === ID);
  const OLD = { view: true, create: true, edit: true, delete: true };
  const OFF = { view: false, create: false, edit: false, delete: false };
  const viewerLeave = async () =>
    (await AccessRuleModel.findOne({ role: 'VIEWER' }).lean())!.permissions.leave;
  /** Production before Q-72: Viewer leave at the old default VCED. */
  async function oldGrid() {
    await ensureDefaultAccessRules();
    await AccessRuleModel.updateOne(
      { role: 'VIEWER' },
      { $set: { 'permissions.leave': OLD, version: 3 } },
    );
  }

  it('migration: is value-only, Viewer leave cells only', () => {
    expect(change).toHaveLength(1);
    expect(change[0]!.valueOnly).toBe(true);
    expect(change[0]!.cells).toHaveLength(4);
    for (const c of change[0]!.cells)
      expect(c).toMatchObject({ role: 'VIEWER', record: 'leave', from: true, to: false });
  });

  it('migration: Viewer leave at the old default is switched off once, and no leave is deleted', async () => {
    const { w } = await setup();
    await oldGrid();
    const before = await LeaveModel.countDocuments({});
    const [r] = await applyAccessDefaultChanges(undefined, change);
    expect(r!.status).toBe('applied');
    expect(r!.cells.map((c) => c.outcome)).toEqual(Array(4).fill('switched'));
    expect(await viewerLeave()).toMatchObject(OFF);
    const member = (await AccessRuleModel.findOne({ role: 'MEMBER' }).lean())!;
    expect(member.permissions.leave?.create).toBe(true);
    expect(await LeaveModel.countDocuments({})).toBe(before);
    expect(await LeaveModel.countDocuments({ userId: w.viewer.user._id })).toBe(1);
    const [again] = await applyAccessDefaultChanges(undefined, change);
    expect(again!.status).toBe('skipped');
  });

  it('migration: an Admin-touched row still at the old value is switched off (value-only)', async () => {
    await oldGrid();
    const { w } = await setup();
    const rule = (await AccessRuleModel.findOne({ role: 'VIEWER' }).lean())!;
    await AccessRuleModel.updateOne({ role: 'VIEWER' }, { $set: { updatedBy: w.admin.user._id } });
    await ActivityLogModel.insertMany(
      (['view', 'create', 'edit', 'delete'] as const).map((permission) => ({
        actorId: w.admin.user._id,
        entityType: 'accessRule',
        entityId: rule._id,
        action: 'access_rule_changed',
        meta: { role: 'VIEWER', recordType: 'leave', permission },
      })),
    );
    const [r] = await applyAccessDefaultChanges(undefined, change);
    expect(r!.cells.map((c) => c.outcome)).toEqual(Array(4).fill('switched'));
    expect(await viewerLeave()).toMatchObject(OFF);
  });

  it('migration: a cell an Admin changed away from the old default is left alone', async () => {
    await oldGrid();
    await AccessRuleModel.updateOne(
      { role: 'VIEWER' },
      { $set: { 'permissions.leave': { view: true, create: false, edit: false, delete: false } } },
    );
    const [r] = await applyAccessDefaultChanges(undefined, change);
    expect(r!.cells.find((c) => c.cell === 'leave.view')!.outcome).toBe('switched');
    for (const a of ['create', 'edit', 'delete'])
      expect(r!.cells.find((c) => c.cell === `leave.${a}`)!.outcome).toBe('already');
  });
});
