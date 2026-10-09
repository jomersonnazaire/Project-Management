import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IssueModel,
  NotificationModel,
  ProjectModel,
  SettingModel,
  TaskModel,
  TimeEntryModel,
  UserModel,
} from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';
import { entryFields } from './trackerHelpers.js';

/**
 * Milestone 4: dashboard (FR-DASH, AC-20.x), My projects (doc 14 FR-PMV-01..04), workload
 * (FR-WL, AC-21.x), reports (FR-RPT, AC-22.x), issue reports (FR-ISS-16), time lock setting
 * (Q-09), EC-66 and EC-68. "Now" is Wed Oct 21, 2026 11:00 Manila time.
 */
useDatabase();
const app = makeApp();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T03:00:00Z'));
});
afterEach(async () => {
  vi.useRealTimers();
  // The database is shared by the tests in this file and PMs see every project: start clean.
  await Promise.all(
    [SettingModel, ProjectModel, TaskModel, IssueModel, TimeEntryModel, NotificationModel].map(
      (m) => (m as typeof ProjectModel).deleteMany({}),
    ),
  );
});

type W = Awaited<ReturnType<typeof world>>;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Active project: Kickoff (overdue, member), Design (blocked, member), Client sign-off (client, overdue). */
async function setup() {
  const w = await world(app);
  await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'ACTIVE' } });
  const tasks = await TaskModel.find({ projectId: w.project.id }).sort({ order: 1 }).lean();
  const [kickoff, design, signoff] = tasks;
  await TaskModel.updateOne(
    { _id: kickoff!._id },
    {
      $set: { ownerId: w.member.user._id, estHours: 8, actualHours: 12, dueDate: d('2026-10-13') },
    },
  );
  await TaskModel.updateOne(
    { _id: design!._id },
    {
      $set: {
        ownerId: w.member.user._id,
        status: 'BLOCKED',
        blockerReason: 'Waiting',
        estHours: 16,
        actualHours: 14,
        plannedStart: d('2026-10-14'),
        dueDate: d('2026-10-23'),
      },
    },
  );
  await TaskModel.updateOne(
    { _id: signoff!._id },
    {
      $set: {
        ownerId: w.pm.user._id,
        clientContactId: new Types.ObjectId(w.acme.active[0].id),
        dueDate: d('2026-10-19'),
        isMilestone: false,
      },
    },
  );
  return { w, kickoff: kickoff!, design: design!, signoff: signoff! };
}

async function raise(w: W, body: Record<string, unknown> = {}) {
  const res = await w.pm.agent
    .post(`/api/v1/projects/${w.project.id}/issues`)
    .set(CSRF)
    .send({ title: 'Issue', description: 'x', severity: 'HIGH', stage: 'BEFORE_GO_LIVE', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.issue as { id: string; key: string; version: number };
}

describe('Dashboard (FR-DASH-01..06, AC-20.1..20.4)', () => {
  it('KPIs, active projects, waiting on client and issue summary match the data', async () => {
    const { w, signoff } = await setup();
    await raise(w, { severity: 'CRITICAL' });
    await TimeEntryModel.create({
      userId: w.member.user._id,
      projectId: w.project.id,
      taskId: signoff._id,
      workDate: d('2026-10-20'),
      hours: 6,
      type: 'EXECUTION',
    });
    const res = await w.pm.agent.get('/api/v1/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({
      activeProjects: 1,
      overdueTasks: 2,
      overdueWaitingOnClient: 1,
      hoursThisWeek: 6,
    });
    expect(res.body.activeProjects[0]).toMatchObject({
      name: 'Rollout P',
      client: { name: w.acme.client.name },
      progress: 0,
    });
    expect(res.body.waitingOnClient).toEqual([
      expect.objectContaining({
        name: signoff.name,
        contact: expect.objectContaining({ name: 'Ana Active' }),
        daysOverdue: 2,
      }),
    ]);
    expect(res.body.issues).toMatchObject({ open: 1, bySeverity: { CRITICAL: 1 } });
    expect(res.body.myProjects).toBe(true);
  });

  it('AC-20.4: a Member only sees their projects; an outsider sees nothing', async () => {
    const { w } = await setup();
    const member = await w.member.agent.get('/api/v1/dashboard');
    expect(member.body.kpis.activeProjects).toBe(1);
    expect(member.body.myProjects).toBe(false);
    const outsider = await w.outsider.agent.get('/api/v1/dashboard');
    expect(outsider.body.kpis).toMatchObject({ activeProjects: 0, overdueTasks: 0 });
    expect(outsider.body.waitingOnClient).toEqual([]);
  });
});

describe('My projects (doc 14 FR-PMV-01..04)', () => {
  it('one row per managed project with days late, blocked, issues and who needs a follow-up', async () => {
    const { w, kickoff, design, signoff } = await setup();
    await raise(w, { severity: 'HIGH' });
    await raise(w, { severity: 'LOW' });
    const res = await w.pm.agent.get('/api/v1/dashboard/my-projects');
    expect(res.status).toBe(200);
    const row = res.body.items[0];
    expect(row).toMatchObject({
      name: 'Rollout P',
      overdueTasks: 2,
      blockedTasks: 1,
      openIssues: 2,
      openCriticalHighIssues: 1,
      waitingOnClient: 1,
    });
    // Baseline end Dec 18; forecast Oct 23 (Design) → 56 days early, so not late.
    expect(row).toMatchObject({
      baselineEnd: '2026-12-18',
      forecastEnd: '2026-10-23',
      daysLate: -56,
    });
    // Internal: Member with one overdue (Kickoff) and one aging (Design: started, blocked, not due).
    expect(row.followUps.people).toEqual([
      expect.objectContaining({
        person: expect.objectContaining({ id: w.member.user._id.toString() }),
        overdue: 1,
        items: expect.arrayContaining([
          expect.objectContaining({ id: kickoff._id.toString(), reason: 'OVERDUE' }),
        ]),
      }),
    ]);
    expect(row.followUps.people[0].items.map((i: { id: string }) => i.id)).not.toContain(
      design._id.toString(),
    );
    // Client contact with the overdue sign-off task.
    expect(row.followUps.contacts).toEqual([
      expect.objectContaining({
        contact: expect.objectContaining({ name: 'Ana Active' }),
        overdueTasks: 1,
        items: [expect.objectContaining({ id: signoff._id.toString(), kind: 'TASK' })],
      }),
    ]);
  });

  it('FR-PMV-04: PMs see only projects they manage; Viewers and Admins all; Members get 403', async () => {
    const { w } = await setup();
    expect((await w.pm2.agent.get('/api/v1/dashboard/my-projects')).body.items).toEqual([]);
    expect((await w.viewer.agent.get('/api/v1/dashboard/my-projects')).body.items).toHaveLength(1);
    expect((await w.admin.agent.get('/api/v1/dashboard/my-projects')).body.items).toHaveLength(1);
    expect((await w.member.agent.get('/api/v1/dashboard/my-projects')).status).toBe(403);
  });
});

describe('Workload (FR-WL-01..03, AC-21.1..21.3)', () => {
  it('assigned = remaining estimates due in the week; recorded and waiting are separate', async () => {
    const { w, design, signoff } = await setup();
    // Design is due Fri Oct 23 (this week): remaining 16 − 14 = 2h. Make it 52h to over-assign.
    await TaskModel.updateOne({ _id: design._id }, { $set: { estHours: 66 } });
    await TimeEntryModel.create([
      {
        userId: w.member.user._id,
        projectId: w.project.id,
        taskId: signoff._id,
        workDate: d('2026-10-19'),
        hours: 15,
        type: 'EXECUTION',
      },
      {
        userId: w.member.user._id,
        projectId: w.project.id,
        taskId: signoff._id,
        workDate: d('2026-10-20'),
        hours: 15,
        type: 'EXECUTION',
      },
      {
        userId: w.member.user._id,
        projectId: w.project.id,
        taskId: signoff._id,
        workDate: d('2026-10-20'),
        hours: 4,
        type: 'REWORK',
      },
      {
        userId: w.member.user._id,
        projectId: w.project.id,
        taskId: signoff._id,
        workDate: d('2026-10-20'),
        hours: 3,
        type: 'WAITING',
      },
      {
        userId: w.member.user._id,
        projectId: w.project.id,
        taskId: signoff._id,
        workDate: d('2026-10-12'),
        hours: 8,
        type: 'EXECUTION',
      },
    ]);
    const res = await w.pm.agent.get('/api/v1/workload?week=2026-10-21');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ weekStart: '2026-10-19', weekEnd: '2026-10-25' });
    expect(res.body.note).toMatch(/aren't used as a performance score/);
    const maria = res.body.items.find(
      (r: { person: { id: string } }) => r.person.id === w.member.user._id.toString(),
    );
    expect(maria).toMatchObject({
      capacityHours: 40,
      assignedHours: 52,
      recordedHours: 34,
      waitingHours: 3,
      utilizationPct: 85,
      assignedPct: 130,
      overAssigned: true,
    });
    // Members only see their own row; Viewers aren't listed.
    const own = await w.member.agent.get('/api/v1/workload?week=2026-10-21');
    expect(own.body.items.map((r: { person: { id: string } }) => r.person.id)).toEqual([
      w.member.user._id.toString(),
    ]);
    expect(
      res.body.items.some(
        (r: { person: { id: string } }) => r.person.id === w.viewer.user._id.toString(),
      ),
    ).toBe(false);
  });
});

describe('Reports (FR-RPT-01..05, AC-22.1, FR-ISS-16)', () => {
  it('effort variance: est 8 / act 12 → +4, +50%; est 16 / act 14 → −2, −12.5%', async () => {
    const { w, kickoff, design } = await setup();
    const res = await w.pm.agent.get(`/api/v1/reports/effort-variance?projectId=${w.project.id}`);
    expect(res.status).toBe(200);
    const by = (id: Types.ObjectId) =>
      res.body.items.find((r: { id: string }) => r.id === id.toString());
    expect(by(kickoff._id)).toMatchObject({
      estHours: 8,
      actualHours: 12,
      variance: 4,
      overrunPct: 50,
    });
    expect(by(design._id)).toMatchObject({ variance: -2, overrunPct: -12.5 });
  });

  it('overdue tasks: filters by party, owner and date range', async () => {
    const { w, kickoff, signoff } = await setup();
    const all = await w.pm.agent.get('/api/v1/reports/overdue');
    expect(all.body.items.map((r: { id: string }) => r.id)).toEqual([
      kickoff._id.toString(),
      signoff._id.toString(),
    ]);
    expect(all.body.items[0]).toMatchObject({ daysOverdue: 8, party: 'INTERNAL' });
    const client = await w.pm.agent.get('/api/v1/reports/overdue?party=CLIENT');
    expect(client.body.items).toEqual([
      expect.objectContaining({
        id: signoff._id.toString(),
        contact: expect.objectContaining({ name: 'Ana Active' }),
      }),
    ]);
    const owner = await w.pm.agent.get(`/api/v1/reports/overdue?ownerId=${w.member.user._id}`);
    expect(owner.body.items).toHaveLength(1);
    const range = await w.pm.agent.get('/api/v1/reports/overdue?from=2026-10-15&to=2026-10-20');
    expect(range.body.items.map((r: { id: string }) => r.id)).toEqual([signoff._id.toString()]);
    // AC-22.3: an empty result is just an empty list.
    expect((await w.outsider.agent.get('/api/v1/reports/overdue')).body.items).toEqual([]);
  });

  it('timesheets: totals by type; Members only their own entries; Viewers need View on time', async () => {
    const { w, signoff } = await setup();
    await TimeEntryModel.create([
      {
        userId: w.member.user._id,
        projectId: w.project.id,
        taskId: signoff._id,
        workDate: d('2026-10-19'),
        hours: 2,
        type: 'EXECUTION',
      },
      {
        userId: w.member.user._id,
        projectId: w.project.id,
        taskId: signoff._id,
        workDate: d('2026-10-20'),
        hours: 1.5,
        type: 'WAITING',
      },
      {
        userId: w.pm.user._id,
        projectId: w.project.id,
        taskId: signoff._id,
        workDate: d('2026-10-20'),
        hours: 3,
        type: 'REWORK',
      },
    ]);
    const pm = await w.pm.agent.get('/api/v1/reports/timesheets?from=2026-10-19&to=2026-10-25');
    expect(pm.body.totals).toEqual({ EXECUTION: 2, WAITING: 1.5, REWORK: 3, all: 6.5 });
    expect(pm.body.items[0]).toMatchObject({
      workDate: '2026-10-19',
      task: { name: signoff.name },
    });
    const member = await w.member.agent.get('/api/v1/reports/timesheets');
    expect(member.body.totals.all).toBe(3.5);
    expect((await w.viewer.agent.get('/api/v1/reports/timesheets')).status).toBe(403);
  });

  it('project status and issue reports (FR-RPT-04, FR-ISS-16)', async () => {
    const { w } = await setup();
    const status = await w.pm.agent.get('/api/v1/reports/project-status');
    expect(status.body.items[0]).toMatchObject({
      name: 'Rollout P',
      overdueTasks: 2,
      blockedTasks: 1,
      pendingClientItems: 1,
    });
    const a = await raise(w, { severity: 'CRITICAL', stage: 'AFTER_GO_LIVE' });
    await raise(w, { severity: 'LOW' });
    // Resolved after 2 days.
    await IssueModel.collection.updateOne(
      { _id: new Types.ObjectId(a.id) },
      {
        $set: {
          status: 'RESOLVED',
          createdAt: new Date('2026-10-18T03:00:00Z'),
          resolvedAt: new Date('2026-10-20T03:00:00Z'),
        },
      },
    );
    const res = await w.pm.agent.get('/api/v1/reports/issues');
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      open: 1,
      bySeverity: { CRITICAL: 0, LOW: 1 },
      byStage: { BEFORE_GO_LIVE: 1, AFTER_GO_LIVE: 0 },
      avgDaysToResolve: 2,
      resolvedCount: 1,
      perClient: [
        expect.objectContaining({
          client: expect.objectContaining({ name: w.acme.client.name }),
          open: 1,
        }),
      ],
    });
    const crit = await w.pm.agent.get('/api/v1/reports/issues?severity=CRITICAL');
    expect(crit.body.items).toEqual([expect.objectContaining({ id: a.id, daysToResolve: 2 })]);
  });
});

describe('Time lock setting (Q-09)', () => {
  it('defaults to Monday 12:00 PM; an Admin can move or turn it off, which Members feel at once', async () => {
    const { w, kickoff } = await setup();
    const get = await w.admin.agent.get('/api/v1/settings/time-lock');
    expect(get.body).toMatchObject({
      policy: { enabled: true, weekday: 1, hour: 12 },
      boundary: '2026-10-19',
      description: "Last week's entries lock every Monday at 12:00 PM Philippine time.",
    });
    const fields = await entryFields();
    const log = () =>
      w.member.agent
        .post('/api/v1/time')
        .set(CSRF)
        .send({ taskId: kickoff._id.toString(), workDate: '2026-10-16', hours: 1, ...fields });
    expect((await log()).body.error.code).toBe('TIME_LOCKED');
    // Thursday 5 PM: last week is still open on Wednesday.
    const put = await w.admin.agent
      .put('/api/v1/settings/time-lock')
      .set(CSRF)
      .send({ enabled: true, weekday: 4, hour: 17, version: get.body.version });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ boundary: '2026-10-12', version: 1 });
    expect((await log()).status).toBe(201);
    // Stale version → 409; PMs (no Edit on settings) → 403.
    const stale = await w.admin.agent
      .put('/api/v1/settings/time-lock')
      .set(CSRF)
      .send({ enabled: false, weekday: 1, hour: 12, version: 0 });
    expect(stale.status).toBe(409);
    expect(
      (
        await w.pm.agent
          .put('/api/v1/settings/time-lock')
          .set(CSRF)
          .send({ enabled: false, weekday: 1, hour: 12, version: 1 })
      ).status,
    ).toBe(403);
  });
});

describe('EC-66 and EC-68', () => {
  it('EC-66: deactivating or removing an issue owner shows Owner needed and notifies the PM', async () => {
    const { w } = await setup();
    const i = await raise(w, { ownerId: w.member.user._id.toString() });
    await NotificationModel.deleteMany({});
    const off = await w.admin.agent
      .post(`/api/v1/users/${w.member.user._id}/deactivate`)
      .set(CSRF)
      .send({});
    expect(off.status).toBe(200);
    expect(
      await NotificationModel.countDocuments({
        type: 'ISSUE_OWNER_NEEDED',
        userId: w.pm.user._id,
        issueId: i.id,
      }),
    ).toBe(1);
    expect((await w.pm.agent.get(`/api/v1/issues/${i.id}`)).body.issue.ownerNeeded).toBe(true);

    // Removed from the project (owner reactivated first).
    await UserModel.updateOne(
      { _id: w.member.user._id },
      { $set: { active: true, deactivatedAt: null } },
    );
    await NotificationModel.deleteMany({});
    // An Admin removes them, so the PM (not the actor) is told.
    const project = (await w.pm.agent.get(`/api/v1/projects/${w.project.id}`)).body.project;
    const removed = await w.admin.agent
      .patch(`/api/v1/projects/${w.project.id}`)
      .set(CSRF)
      .send({ memberIds: [], version: project.version });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(
      await NotificationModel.countDocuments({ type: 'ISSUE_OWNER_NEEDED', userId: w.pm.user._id }),
    ).toBe(1);
  });

  it('EC-68: changing the client warns with the issues that keep old-client contacts', async () => {
    const { w, signoff } = await setup();
    await TaskModel.updateMany({ projectId: w.project.id }, { $set: { clientContactId: null } });
    void signoff;
    const i = await raise(w, { reportedByContactId: w.acme.active[0].id });
    const change = () => w.pm.agent.patch(`/api/v1/projects/${w.project.id}`).set(CSRF);
    const first = await change().send({ clientId: w.other.client.id, confirmClearContacts: true });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('ISSUE_CONTACTS_OLD_CLIENT');
    expect(first.body.error.details.issues).toEqual([i.key]);
    const ok = await change().send({
      clientId: w.other.client.id,
      confirmClearContacts: true,
      confirmIssueContacts: true,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // The issue keeps its contact.
    expect((await IssueModel.findById(i.id).lean())!.reportedByContactId?.toString()).toBe(
      w.acme.active[0].id,
    );
  });
});
