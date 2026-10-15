import type request from 'supertest';
import {
  DEFAULT_CALENDAR,
  parseDateOnly,
  toDateOnly,
  todayPH,
  type WorkCalendar,
} from '@xc8/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ActivityLogModel,
  DocumentModel,
  FolderModel,
  IssueModel,
  NotificationModel,
  ProjectModel,
  TaskModel,
} from '../src/models/index.js';
import { defaultIssueDue, runIssueSweeps } from '../src/services/issues.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { resetRules, world, ptypeId } from './m2helpers.js';
import { FILES } from './m3helpers.js';

/** Milestone 3.5 issue tracking (doc 13): AC-42.x to AC-45.x, EC-66/69/70, FR-ISS-06/10/13/15. */
useDatabase();
const app = makeApp();
type Agent = ReturnType<typeof request.agent>;
type W = Awaited<ReturnType<typeof world>>;

afterEach(async () => {
  await resetRules();
});

const base = (w: W) => `/api/v1/projects/${w.project.id}`;
const day = (n: number) => toDateOnly(new Date(todayPH().getTime() + n * 86_400_000));

function raise(agent: Agent, w: W, body: Record<string, unknown> = {}) {
  return agent
    .post(`${base(w)}/issues`)
    .set(CSRF)
    .send({
      title: 'Item import fails on missing UoM',
      description: 'Items with no unit of measure fail to import.',
      severity: 'HIGH',
      stage: 'BEFORE_GO_LIVE',
      ...body,
    });
}
async function raised(agent: Agent, w: W, body: Record<string, unknown> = {}) {
  const res = await raise(agent, w, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.issue;
}
const status = (agent: Agent, id: string, body: Record<string, unknown>) =>
  agent.post(`/api/v1/issues/${id}/status`).set(CSRF).send(body);
const patch = (agent: Agent, id: string, body: Record<string, unknown>) =>
  agent.patch(`/api/v1/issues/${id}`).set(CSRF).send(body);

describe('AC-42.1: raising an issue', () => {
  it('needs title, description, severity and stage; a valid one gets the next id', async () => {
    const w = await world(app);
    const bad = await w.pm.agent
      .post(`${base(w)}/issues`)
      .set(CSRF)
      .send({});
    expect(bad.status).toBe(400);
    const paths = bad.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['title', 'description', 'severity', 'stage']));
    const a = await raised(w.pm.agent, w);
    const b = await raised(w.member.agent, w, { severity: 'LOW' });
    expect(a.key).toMatch(/^[A-Z0-9]+-[A-Z0-9]+-ISS-001$/);
    expect(b.key).toBe(a.key.replace('001', '002'));
    expect(a).toMatchObject({ status: 'OPEN', severity: 'HIGH', category: 'OTHER' });
    // Numbers are never reused, even after a delete.
    expect((await w.admin.agent.delete(`/api/v1/issues/${b.id}`).set(CSRF)).status).toBe(204);
    const c = await raised(w.pm.agent, w);
    expect(c.key).toBe(a.key.replace('001', '003'));
  });

  it('title is limited to 150 characters; owner must be on the project; contact must be the client’s', async () => {
    const w = await world(app);
    expect((await raise(w.pm.agent, w, { title: 'x'.repeat(151) })).status).toBe(400);
    const owner = await raise(w.pm.agent, w, { ownerId: w.outsider.user._id.toString() });
    expect(owner.status).toBe(422);
    expect(owner.body.error.code).toBe('INVALID_OWNER');
    const contact = await raise(w.pm.agent, w, { reportedByContactId: w.other.active[0].id });
    expect(contact.body.error.code).toBe('INVALID_CONTACT');
    const ok = await raised(w.pm.agent, w, {
      ownerId: w.member.user._id.toString(),
      reportedByContactId: w.acme.active[0].id,
    });
    expect(ok.owner.id).toBe(w.member.user._id.toString());
    expect(ok.contact).toMatchObject({ id: w.acme.active[0].id, active: true });
    expect(ok.reportedBy.id).toBe(w.pm.user._id.toString());
  });
});

describe('AC-42.2 / FR-ISS-05: due dates follow severity in working days', () => {
  const cal: WorkCalendar = { ...DEFAULT_CALENDAR, holidays: { '2026-10-12': 'REGULAR' } };
  it('Critical raised on a Friday is due the next working day (skipping a holiday)', () => {
    const friday = new Date('2026-10-09T02:00:00Z'); // Fri 10:00 Manila
    expect(toDateOnly(defaultIssueDue('CRITICAL', friday, DEFAULT_CALENDAR))).toBe('2026-10-12');
    expect(toDateOnly(defaultIssueDue('CRITICAL', friday, cal))).toBe('2026-10-13');
    expect(toDateOnly(defaultIssueDue('HIGH', friday, DEFAULT_CALENDAR))).toBe('2026-10-14');
    expect(toDateOnly(defaultIssueDue('MEDIUM', friday, DEFAULT_CALENDAR))).toBe('2026-10-20');
    expect(toDateOnly(defaultIssueDue('LOW', friday, DEFAULT_CALENDAR))).toBe('2026-10-30');
  });

  it('a severity change recalculates the default due date, but not one set by hand (with a reason)', async () => {
    const w = await world(app);
    const i = await raised(w.pm.agent, w, { severity: 'LOW' });
    const created = new Date((await IssueModel.findById(i.id).lean())!.createdAt);
    const high = await patch(w.pm.agent, i.id, { version: i.version, severity: 'HIGH' });
    expect(high.status).toBe(200);
    expect(high.body.issue.dueDate).toBe(
      toDateOnly(defaultIssueDue('HIGH', created, DEFAULT_CALENDAR)),
    );
    const noReason = await patch(w.pm.agent, i.id, {
      version: high.body.issue.version,
      dueDate: day(40),
    });
    expect(noReason.status).toBe(400);
    const manual = await patch(w.pm.agent, i.id, {
      version: high.body.issue.version,
      dueDate: day(40),
      dueReason: 'Client go-live moved',
    });
    expect(manual.body.issue).toMatchObject({ dueDate: day(40), dueManual: true });
    const crit = await patch(w.pm.agent, i.id, {
      version: manual.body.issue.version,
      severity: 'CRITICAL',
    });
    expect(crit.body.issue.dueDate).toBe(day(40));
    const log = await ActivityLogModel.findOne({
      entityId: i.id,
      action: 'issue_updated',
      reason: 'Client go-live moved',
    }).lean();
    expect(log!.changes).toEqual([{ field: 'dueDate', old: expect.any(String), new: day(40) }]);
  });
});

describe('AC-42.3 / FR-ISS-04: status workflow', () => {
  it('Open → Resolved is 422; Resolved needs a resolution; In progress needs an owner', async () => {
    const w = await world(app);
    const i = await raised(w.pm.agent, w);
    const skip = await status(w.pm.agent, i.id, {
      version: i.version,
      status: 'RESOLVED',
      resolution: 'x',
    });
    expect(skip.status).toBe(422);
    expect(skip.body.error.code).toBe('INVALID_TRANSITION');
    const noOwner = await status(w.pm.agent, i.id, { version: i.version, status: 'IN_PROGRESS' });
    expect(noOwner.body.error.code).toBe('OWNER_REQUIRED');
    const owned = await patch(w.pm.agent, i.id, {
      version: i.version,
      ownerId: w.member.user._id.toString(),
    });
    const started = await status(w.member.agent, i.id, {
      version: owned.body.issue.version,
      status: 'IN_PROGRESS',
    });
    expect(started.status).toBe(200);
    const noText = await status(w.member.agent, i.id, {
      version: started.body.issue.version,
      status: 'RESOLVED',
    });
    expect(noText.status).toBe(422);
    expect(noText.body.error.code).toBe('RESOLUTION_REQUIRED');
    const resolved = await status(w.member.agent, i.id, {
      version: started.body.issue.version,
      status: 'RESOLVED',
      resolution: 'Mapped the legacy codes',
    });
    expect(resolved.body.issue).toMatchObject({
      status: 'RESOLVED',
      resolution: 'Mapped the legacy codes',
    });
    // The owner (not the reporter) can't confirm; the PM (reporter) can.
    expect(resolved.body.issue.can.transitions).toEqual(['IN_PROGRESS']);
    const closed = await status(w.pm.agent, i.id, {
      version: resolved.body.issue.version,
      status: 'CLOSED',
    });
    expect(closed.body.issue.status).toBe('CLOSED');
    // Reopening a closed issue: PM/Admin only, with a reason.
    const v = closed.body.issue.version;
    expect(
      (await status(w.member.agent, i.id, { version: v, status: 'IN_PROGRESS', reason: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (await status(w.pm.agent, i.id, { version: v, status: 'IN_PROGRESS' })).body.error.code,
    ).toBe('REASON_REQUIRED');
    const reopened = await status(w.pm.agent, i.id, {
      version: v,
      status: 'IN_PROGRESS',
      reason: 'Came back',
    });
    expect(reopened.body.issue).toMatchObject({ status: 'IN_PROGRESS', closedAt: null });
  });

  it('Open → Closed (duplicate) needs a reason', async () => {
    const w = await world(app);
    const i = await raised(w.pm.agent, w);
    expect((await status(w.pm.agent, i.id, { version: i.version, status: 'CLOSED' })).status).toBe(
      422,
    );
    const ok = await status(w.pm.agent, i.id, {
      version: i.version,
      status: 'CLOSED',
      reason: 'Duplicate of 001',
    });
    expect(ok.body.issue).toMatchObject({ status: 'CLOSED', closedReason: 'Duplicate of 001' });
  });

  it('EC-70: two people change status at once; the second gets 409', async () => {
    const w = await world(app);
    const i = await raised(w.pm.agent, w);
    const a = await status(w.pm.agent, i.id, {
      version: i.version,
      status: 'CLOSED',
      reason: 'Dup',
    });
    const b = await status(w.admin.agent, i.id, {
      version: i.version,
      status: 'CLOSED',
      reason: 'Dup',
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(409);
  });
});

describe('AC-43.x: lists and scope', () => {
  it('All issues for a Member lists only their projects; another project’s issue is 404', async () => {
    const w = await world(app);
    const mine = await raised(w.member.agent, w);
    // A second project the member isn't on.
    const other = await w.pm.agent
      .post('/api/v1/projects')
      .set(CSRF)
      .send({
        projectTypeId: await ptypeId(),
        name: 'Rollout Q',
        clientId: w.acme.client.id,
        managerId: w.pm.user._id.toString(),
        memberIds: [],
        startDate: '2026-10-12',
        plannedEndDate: '2026-12-18',
        templateId: w.template.id,
      });
    const hidden = (
      await w.pm.agent
        .post(`/api/v1/projects/${other.body.project.id}/issues`)
        .set(CSRF)
        .send({ title: 'Hidden', description: 'x', severity: 'LOW', stage: 'BEFORE_GO_LIVE' })
    ).body.issue;
    const list = await w.member.agent.get('/api/v1/issues?status=ALL');
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([mine.id]);
    expect((await w.member.agent.get(`/api/v1/issues/${hidden.id}`)).status).toBe(404);
    expect((await w.outsider.agent.get(`${base(w)}/issues`)).status).toBe(404);
    const pmList = await w.pm.agent.get('/api/v1/issues?status=ALL');
    const ids = pmList.body.items.map((x: { id: string }) => x.id);
    expect(ids).toEqual(expect.arrayContaining([mine.id, hidden.id]));
    expect(pmList.body.items[0]).toMatchObject({ project: { name: expect.any(String) } });
  });

  it('AC-43.2: past due and not resolved is overdue; counts and filters', async () => {
    const w = await world(app);
    const late = await raised(w.pm.agent, w, { severity: 'CRITICAL' });
    await raised(w.pm.agent, w, { severity: 'LOW', stage: 'AFTER_GO_LIVE' });
    await IssueModel.updateOne({ _id: late.id }, { $set: { dueDate: parseDateOnly(day(-2)) } });
    const res = await w.pm.agent.get(`${base(w)}/issues`);
    expect(res.body.counts).toMatchObject({ open: 2, critical: 1, high: 0, overdue: 1 });
    expect(res.body.items[0]).toMatchObject({ id: late.id, overdue: true, severity: 'CRITICAL' });
    const after = await w.pm.agent.get(`${base(w)}/issues?stage=AFTER_GO_LIVE`);
    expect(after.body.items).toHaveLength(1);
    const q = await w.pm.agent.get(`${base(w)}/issues?q=${encodeURIComponent(late.key)}`);
    expect(q.body.items.map((x: { id: string }) => x.id)).toEqual([late.id]);
  });
});

describe('AC-44.x: completed, on hold and archived projects', () => {
  it('Completed: issues can be raised and updated while the plan is read-only (422)', async () => {
    const w = await world(app);
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'COMPLETED' } });
    const opts = await w.pm.agent.get(`${base(w)}/issue-options`);
    expect(opts.body.defaultStage).toBe('AFTER_GO_LIVE');
    const i = await raised(w.member.agent, w, { stage: 'AFTER_GO_LIVE' });
    expect(
      (await patch(w.member.agent, i.id, { version: i.version, title: 'Renamed' })).status,
    ).toBe(200);
    const task = (await TaskModel.findOne({ projectId: w.project.id }).lean())!;
    const res = await w.pm.agent
      .post(`/api/v1/tasks/${task._id}/status`)
      .set(CSRF)
      .send({ status: 'IN_PROGRESS', version: task.version });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PROJECT_COMPLETED');
  });

  it('On Hold: issues can still be raised (FR-ISS-14)', async () => {
    const w = await world(app);
    await ProjectModel.updateOne({ _id: w.project.id }, { $set: { status: 'ON_HOLD' } });
    expect((await raise(w.member.agent, w)).status).toBe(201);
  });

  it('Archived: creating or updating an issue is refused; archiving warns about open issues', async () => {
    const w = await world(app);
    const i = await raised(w.pm.agent, w);
    const warn = await w.pm.agent
      .post(`${base(w)}/archive`)
      .set(CSRF)
      .send({});
    expect(warn.status).toBe(409);
    expect(warn.body.error).toMatchObject({ code: 'OPEN_ISSUES', details: { issues: [i.key] } });
    const ok = await w.pm.agent
      .post(`${base(w)}/archive`)
      .set(CSRF)
      .send({ confirmOpenIssues: true });
    expect(ok.status).toBe(200);
    expect((await raise(w.pm.agent, w)).status).toBe(409);
    expect((await patch(w.pm.agent, i.id, { version: i.version, title: 'x' })).status).toBe(409);
    const read = await w.pm.agent.get(`/api/v1/issues/${i.id}`);
    expect(read.body.issue.can).toMatchObject({ edit: false, comment: false, transitions: [] });
  });
});

describe('AC-45.x: notifications, access and attachments', () => {
  it('AC-45.1: assigning notifies the new owner once; the assigner gets nothing', async () => {
    const w = await world(app);
    const i = await raised(w.member.agent, w);
    // Raised by the member: the PM hears about it.
    expect(
      await NotificationModel.countDocuments({
        issueId: i.id,
        userId: w.pm.user._id,
        type: 'ISSUE_CREATED',
      }),
    ).toBe(1);
    await patch(w.pm.agent, i.id, { version: i.version, ownerId: w.member.user._id.toString() });
    expect(
      await NotificationModel.countDocuments({
        issueId: i.id,
        userId: w.member.user._id,
        type: 'ISSUE_ASSIGNED',
      }),
    ).toBe(1);
    expect(
      await NotificationModel.countDocuments({
        issueId: i.id,
        userId: w.pm.user._id,
        type: 'ISSUE_ASSIGNED',
      }),
    ).toBe(0);
    // Comments notify owner, reporter and PM except the author.
    const c = await w.pm.agent
      .post(`/api/v1/issues/${i.id}/comments`)
      .set(CSRF)
      .send({ text: 'Any update?' });
    expect(c.status).toBe(201);
    expect(
      await NotificationModel.countDocuments({
        issueId: i.id,
        userId: w.member.user._id,
        type: 'ISSUE_COMMENT',
      }),
    ).toBe(1);
    const bell = await w.member.agent.get('/api/v1/notifications');
    expect(bell.body.items[0].issue).toMatchObject({ id: i.id, key: i.key });
    const activity = await w.pm.agent.get(`/api/v1/issues/${i.id}/activity`);
    expect(
      activity.body.items.map((a: { kind: string; action: string | null }) => a.action ?? a.kind),
    ).toEqual(['issue_created', 'issue_updated', 'COMMENT']);
  });

  it('DR-18: history shows the owner by name, never a raw id', async () => {
    const w = await world(app);
    const i = await raised(w.pm.agent, w);
    const res = await patch(w.pm.agent, i.id, {
      version: i.version,
      ownerId: w.member.user._id.toString(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const activity = await w.pm.agent.get(`/api/v1/issues/${i.id}/activity`);
    const changes = activity.body.items.flatMap(
      (a: { changes: { field: string; old: unknown; new: unknown }[] }) => a.changes,
    );
    expect(changes).toContainEqual({ field: 'ownerId', old: null, new: w.member.user.name });
    expect(JSON.stringify(activity.body)).not.toContain(w.member.user._id.toString() + '"');
  });

  it('AC-45.2: a Viewer reads issues but every write is 403; Members edit only issues they own or reported', async () => {
    const w = await world(app);
    const i = await raised(w.pm.agent, w);
    expect((await w.viewer.agent.get(`/api/v1/issues/${i.id}`)).status).toBe(200);
    expect((await raise(w.viewer.agent, w)).status).toBe(403);
    expect((await patch(w.viewer.agent, i.id, { version: i.version, title: 'x' })).status).toBe(
      403,
    );
    expect(
      (await status(w.viewer.agent, i.id, { version: i.version, status: 'CLOSED', reason: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (await w.viewer.agent.post(`/api/v1/issues/${i.id}/comments`).set(CSRF).send({ text: 'x' }))
        .status,
    ).toBe(403);
    expect((await w.viewer.agent.delete(`/api/v1/issues/${i.id}`).set(CSRF)).status).toBe(403);
    // The member didn't raise it and doesn't own it.
    expect((await patch(w.member.agent, i.id, { version: i.version, title: 'x' })).status).toBe(
      403,
    );
    // PMs can't delete by default (Admin only, FR-ISS-15).
    expect((await w.pm.agent.delete(`/api/v1/issues/${i.id}`).set(CSRF)).status).toBe(403);
    // Another PM can read but not raise on a project they don't manage.
    expect((await w.pm2.agent.get(`/api/v1/issues/${i.id}`)).status).toBe(200);
    expect((await raise(w.pm2.agent, w)).status).toBe(403);
  });

  it('AC-45.3: attachments follow the M3 rules and land in the project’s Issues folder', async () => {
    const w = await world(app);
    const i = await raised(w.pm.agent, w);
    const ticket = (name: string, size: number) =>
      w.pm.agent
        .post(`/api/v1/issues/${i.id}/attachments/uploads`)
        .set(CSRF)
        .send({ files: [{ name, size }] });
    expect((await ticket('setup.exe', 100)).status).toBe(422);
    expect((await ticket('photo.png', 100)).status).toBe(422);
    expect((await ticket('big.pdf', 26 * 1024 * 1024)).status).toBe(413);
    async function upload(name: string, data: Buffer) {
      const t = await ticket(name, data.length);
      expect(t.status).toBe(201);
      const up = t.body.uploads[0];
      await w.pm.agent
        .put(up.uploadUrl)
        .set(CSRF)
        .set('Content-Type', 'application/octet-stream')
        .send(data);
      return w.pm.agent.post(`/api/v1/uploads/${up.id}/complete`).set(CSRF).send({});
    }
    const fake = await upload('fake.pdf', FILES.exe());
    expect(fake.status).toBe(422);
    expect(fake.body.error.code).toBe('INVALID_FILE_TYPE');
    const ok = await upload('BP_TaxCode.pdf', FILES.pdf());
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.issue.attachments).toHaveLength(1);
    const doc = (await DocumentModel.findById(ok.body.issue.attachments[0].documentId).lean())!;
    const folder = (await FolderModel.findById(doc.folderId).lean())!;
    expect(folder).toMatchObject({ name: 'Issues', kind: 'ISSUES' });
    expect(doc.source).toBe('ISSUE');
    const dl = await w.member.agent.get(
      `/api/v1/issues/${i.id}/attachments/${doc._id.toString()}/download`,
    );
    expect(dl.status).toBe(200);
    expect(dl.body.url).toBeTruthy();
    // A Member who neither owns nor reported it can't attach.
    expect(
      (
        await w.member.agent
          .post(`/api/v1/issues/${i.id}/attachments/uploads`)
          .set(CSRF)
          .send({ files: [{ name: 'a.pdf', size: 10 }] })
      ).status,
    ).toBe(403);
  });
});

describe('Edge cases and scheduled work', () => {
  it('EC-66: an owner removed from the project shows "Owner needed"; EC-69: a removed task shows as removed', async () => {
    const w = await world(app);
    const task = (await TaskModel.findOne({ projectId: w.project.id }).lean())!;
    const i = await raised(w.pm.agent, w, {
      ownerId: w.member.user._id.toString(),
      taskIds: [task._id.toString()],
    });
    expect(i.ownerNeeded).toBe(false);
    expect(i.links.tasks[0]).toMatchObject({ id: task._id.toString(), name: task.name });
    await ProjectModel.updateOne(
      { _id: w.project.id },
      { $pull: { memberIds: w.member.user._id } },
    );
    await TaskModel.deleteOne({ _id: task._id });
    const after = (await w.pm.agent.get(`/api/v1/issues/${i.id}`)).body.issue;
    expect(after.ownerNeeded).toBe(true);
    expect(after.links.tasks[0]).toMatchObject({ id: task._id.toString(), name: null });
    // Links must be in the same project.
    const bad = await raise(w.pm.agent, w, { taskIds: ['0'.repeat(24)] });
    expect(bad.body.error.code).toBe('INVALID_LINK');
  });

  it('FR-ISS-06: resolved issues close after 7 days; FR-ISS-10: one overdue reminder a day', async () => {
    const w = await world(app);
    const a = await raised(w.pm.agent, w, { ownerId: w.member.user._id.toString() });
    const b = await raised(w.pm.agent, w, { ownerId: w.member.user._id.toString() });
    await IssueModel.updateOne(
      { _id: a.id },
      {
        $set: {
          status: 'RESOLVED',
          resolution: 'Fixed',
          resolvedAt: new Date(Date.now() - 8 * 86_400_000),
        },
      },
    );
    await IssueModel.updateOne({ _id: b.id }, { $set: { dueDate: parseDateOnly(day(-1)) } });
    const first = await runIssueSweeps({ force: true });
    expect(first.closed).toBeGreaterThanOrEqual(1);
    expect((await IssueModel.findById(a.id).lean())!.status).toBe('CLOSED');
    expect(
      await ActivityLogModel.countDocuments({ entityId: a.id, action: 'issue_auto_closed' }),
    ).toBe(1);
    expect(
      await NotificationModel.countDocuments({
        issueId: b.id,
        userId: w.member.user._id,
        type: 'ISSUE_OVERDUE',
      }),
    ).toBe(1);
    await runIssueSweeps({ force: true });
    expect(await NotificationModel.countDocuments({ issueId: b.id, type: 'ISSUE_OVERDUE' })).toBe(
      1,
    );
  });

  it('FR-ISS-11: changes are in the project Activity log', async () => {
    const w = await world(app);
    const i = await raised(w.pm.agent, w);
    await patch(w.pm.agent, i.id, { version: i.version, category: 'DATA' });
    const log = await ActivityLogModel.find({
      projectId: w.project.id,
      entityType: 'issue',
    })
      .sort({ _id: 1 })
      .lean();
    expect(log.map((l) => l.action)).toEqual(['issue_created', 'issue_updated']);
  });
});
