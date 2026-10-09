import {
  OPEN_ISSUE_STATUSES,
  createIssueSchema,
  issueCommentSchema,
  issueKey,
  issueListQuerySchema,
  issueStatusSchema,
  issueTransition,
  parseDateOnly,
  toDateOnly,
  todayPH,
  updateIssueSchema,
  ISSUE_SEVERITIES,
  ISSUE_STATUS_LABELS,
  type IssueListDto,
  type IssueOptionsDto,
  type IssueSeverity,
  type IssueStatus,
} from '@xc8/shared';
import type { Request } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { conflictWith, unprocessable } from '../lib/http422.js';
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import {
  ClientContactModel,
  IssueCommentModel,
  IssueModel,
  MessageModel,
  ProjectModel,
  TaskModel,
  type Issue,
} from '../models/index.js';
import { audit } from '../services/audit.js';
import { loadCalendar } from '../services/calendar.js';
import {
  canCommentIssue,
  canDeleteIssue,
  canEditIssue,
  canRaiseIssue,
  allowedTransitions,
  defaultIssueDue,
  defaultStage,
  issueActivity,
  nextIssueNumber,
  runIssueSweeps,
  toIssueDto,
  toIssueRows,
  type IssueDoc,
  type IssueProject,
} from '../services/issues.js';
import { notify } from '../services/notify.js';
import { userRefs } from '../services/projectService.js';
import { projectScopeFilter } from '../services/scope.js';
import { assertNotArchived, loadProject } from './projects.js';

/**
 * Project issue tracking (doc 13, Milestone 3.5). Routes:
 *   GET  /projects/:id/issues, /projects/:id/issue-options, POST /projects/:id/issues
 *   GET  /issues (All issues), GET/PATCH/DELETE /issues/:id
 *   POST /issues/:id/status, GET /issues/:id/activity, POST /issues/:id/comments
 * Attachments use the M3 upload flow (routes/documents.ts, purpose ISSUE).
 */
type Id = Types.ObjectId;

const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Loads an issue and its project; outside the caller's project scope it's 404 (AC-43.1). */
export async function loadIssue(req: Request, id = idParam(req)) {
  const issue = (await IssueModel.findById(id).lean()) as IssueDoc | null;
  if (!issue) throw notFound();
  const project = (
    await loadProject(req, 'view', issue.projectId.toString())
  ).toObject() as IssueProject;
  return { issue, project };
}

/** The write gate shared by edit, status, attachments: archived → 409, else must be allowed. */
export function assertCanEditIssue(req: Request, project: IssueProject, issue: IssueDoc) {
  assertNotArchived(project);
  if (!canEditIssue(currentUser(req), currentPermissions(req), project, issue)) {
    throw forbidden('Only the issue’s owner, its reporter or the project manager can change it.');
  }
}

async function assertOwner(project: IssueProject, ownerId: string | null | undefined) {
  if (!ownerId) return;
  const onProject =
    project.managerId?.toString() === ownerId ||
    (project.memberIds ?? []).some((m) => m.toString() === ownerId);
  const user = onProject ? (await userRefs([new Types.ObjectId(ownerId)])).get(ownerId) : null;
  if (!user?.active) {
    throw unprocessable('The owner must be an active person on this project.', 'INVALID_OWNER', [
      { path: 'ownerId', message: 'Choose someone on this project.' },
    ]);
  }
}

async function assertContact(project: IssueProject, contactId: string | null | undefined) {
  if (!contactId) return;
  const c = await ClientContactModel.findOne({
    _id: contactId,
    clientId: project.clientId,
    active: true,
  }).lean();
  if (!c) {
    throw unprocessable('Choose an active contact of this project’s client.', 'INVALID_CONTACT', [
      { path: 'reportedByContactId', message: 'Choose an active contact of this client.' },
    ]);
  }
}

async function assertLinks(project: IssueProject, taskIds?: string[], messageIds?: string[]) {
  if (taskIds?.length) {
    const n = await TaskModel.countDocuments({ _id: { $in: taskIds }, projectId: project._id });
    if (n !== new Set(taskIds).size)
      throw unprocessable('Linked tasks must belong to this project.', 'INVALID_LINK', [
        { path: 'taskIds', message: 'Linked tasks must belong to this project.' },
      ]);
  }
  if (messageIds?.length) {
    const n = await MessageModel.countDocuments({
      _id: { $in: messageIds },
      projectId: project._id,
    });
    if (n !== new Set(messageIds).size)
      throw unprocessable('Linked messages must belong to this project.', 'INVALID_LINK', [
        { path: 'messageIds', message: 'Linked messages must belong to this project.' },
      ]);
  }
}

const ids = (xs?: string[]) => [...new Set(xs ?? [])].map((x) => new Types.ObjectId(x));
const dateStr = (d?: Date | null) => (d ? toDateOnly(d) : null);

function listFilter(q: ReturnType<typeof parseQuery<typeof issueListQuerySchema>>) {
  const f: FilterQuery<Issue> = {};
  const status = q.status ?? 'OPEN_ALL';
  if (status === 'OPEN_ALL') f.status = { $in: [...OPEN_ISSUE_STATUSES] };
  else if (status !== 'ALL') f.status = status;
  if (q.severity) f.severity = q.severity;
  if (q.stage) f.stage = q.stage;
  if (q.category) f.category = q.category;
  if (q.ownerId) f.ownerId = q.ownerId === 'none' ? null : new Types.ObjectId(q.ownerId);
  if (q.taskId) f.taskIds = new Types.ObjectId(q.taskId);
  if (q.q) {
    const re = new RegExp(escapeRegex(q.q), 'i');
    f.$or = [{ title: re }, { key: re }, { description: re }];
  }
  return f;
}

/** Sorted by severity, then due date (mockup: "Sorted by severity, then due date"). */
function sortRows<T extends { severity: string; dueDate: string | null; key: string }>(rows: T[]) {
  return rows.sort(
    (a, b) =>
      severityRank[a.severity]! - severityRank[b.severity]! ||
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
      a.key.localeCompare(b.key),
  );
}

async function counts(filter: FilterQuery<Issue>): Promise<IssueListDto['counts']> {
  const open = { ...filter, status: { $in: [...OPEN_ISSUE_STATUSES] } };
  const [o, c, h, overdue, waiting] = await Promise.all([
    IssueModel.countDocuments(open),
    IssueModel.countDocuments({ ...open, severity: 'CRITICAL' }),
    IssueModel.countDocuments({ ...open, severity: 'HIGH' }),
    IssueModel.countDocuments({ ...open, dueDate: { $lt: todayPH() } }),
    IssueModel.countDocuments({ ...filter, status: 'WAITING_ON_CLIENT' }),
  ]);
  return { open: o, critical: c, high: h, overdue, waiting };
}

function notifyPeople(
  type: 'ISSUE_STATUS' | 'ISSUE_COMMENT',
  project: IssueProject,
  issue: IssueDoc,
  actorId: Id,
) {
  return notify({
    type,
    project,
    issueId: issue._id,
    actorId,
    recipients: [issue.ownerId, issue.reportedById, project.managerId],
  });
}

export function issuesRouter(registry: RouteRegistry) {
  const p = registry.router('/projects');
  const r = registry.router('/issues');

  // ----- Project Issues tab (FR-ISS-01) -----
  p.get('/:id/issues', perm('issues', 'view'), async (req, res) => {
    void runIssueSweeps({ logger: req.log });
    const q = parseQuery(issueListQuerySchema, req);
    const project = (await loadProject(req, 'view')).toObject() as IssueProject;
    const base = { projectId: project._id };
    const docs = (await IssueModel.find({ ...listFilter(q), ...base })
      .limit(1000)
      .lean()) as IssueDoc[];
    const body: IssueListDto = {
      items: sortRows(await toIssueRows(docs)),
      counts: await counts(base),
      can: { create: canRaiseIssue(currentUser(req), currentPermissions(req), project) },
    };
    res.json(body);
  });

  p.get('/:id/issue-options', perm('issues', 'view'), async (req, res) => {
    const project = (await loadProject(req, 'view')).toObject() as IssueProject;
    const people = [
      ...new Set([project.managerId, ...(project.memberIds ?? [])].filter(Boolean).map(String)),
    ];
    const [users, contacts, tasks, messages, cal] = await Promise.all([
      userRefs(people.map((x) => new Types.ObjectId(x))),
      ClientContactModel.find({ clientId: project.clientId, active: true })
        .sort({ name: 1 })
        .select('name active')
        .lean(),
      TaskModel.find({ projectId: project._id }).sort({ order: 1 }).select('name phase').lean(),
      MessageModel.find({ projectId: project._id, hidden: null })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('text type createdAt')
        .lean(),
      loadCalendar(),
    ]);
    const now = new Date();
    const body: IssueOptionsDto = {
      users: [...users.values()]
        .filter((u) => u.active)
        .sort((a, b) => a.name.localeCompare(b.name)),
      contacts: contacts.map((c) => ({ id: c._id.toString(), name: c.name, active: true })),
      tasks: tasks.map((t) => ({ id: t._id.toString(), name: t.name, phase: t.phase ?? null })),
      messages: messages.map((m) => ({
        id: m._id.toString(),
        excerpt: m.text.slice(0, 80),
        type: m.type,
        at: m.createdAt.toISOString(),
      })),
      defaultStage: defaultStage(project),
      defaultDue: Object.fromEntries(
        ISSUE_SEVERITIES.map((s) => [s, toDateOnly(defaultIssueDue(s, now, cal))]),
      ) as Record<IssueSeverity, string>,
    };
    res.json(body);
  });

  // ----- Raise an issue (FR-ISS-03, AC-42.1/42.2) -----
  p.post('/:id/issues', perm('issues', 'create'), async (req, res) => {
    const input = parseBody(createIssueSchema, req);
    const project = (await loadProject(req, 'view')).toObject() as IssueProject;
    assertNotArchived(project);
    const user = currentUser(req);
    if (!canRaiseIssue(user, currentPermissions(req), project)) {
      throw forbidden('Only people on this project can raise issues.');
    }
    await assertOwner(project, input.ownerId);
    await assertContact(project, input.reportedByContactId);
    await assertLinks(project, input.taskIds, input.messageIds);
    const now = new Date();
    const dueDate = input.dueDate
      ? parseDateOnly(input.dueDate)
      : defaultIssueDue(input.severity, now, await loadCalendar());
    const { number, prefix } = await nextIssueNumber(project);
    const issue = await IssueModel.create({
      projectId: project._id,
      number,
      key: issueKey(prefix, number),
      title: input.title,
      description: input.description,
      stage: input.stage,
      category: input.category,
      severity: input.severity,
      status: 'OPEN',
      reportedById: user._id,
      reportedByContactId: input.reportedByContactId ?? null,
      ownerId: input.ownerId ?? null,
      dueDate,
      dueManual: Boolean(input.dueDate),
      taskIds: ids(input.taskIds),
      messageIds: ids(input.messageIds),
      createdBy: user._id,
    });
    await audit({
      actorId: user._id,
      entityType: 'issue',
      entityId: issue._id,
      projectId: project._id,
      action: 'issue_created',
      changes: [
        { field: 'severity', old: null, new: input.severity },
        { field: 'dueDate', old: null, new: toDateOnly(dueDate) },
      ],
      meta: { key: issue.key, title: issue.title },
    });
    // FR-ISS-10: the owner hears they were assigned; the PM hears it was raised.
    const doc = issue.toObject() as IssueDoc;
    if (doc.ownerId)
      await notify({
        type: 'ISSUE_ASSIGNED',
        project,
        issueId: doc._id,
        actorId: user._id,
        recipients: [doc.ownerId],
      });
    if (!doc.ownerId?.equals(project.managerId ?? undefined))
      await notify({
        type: 'ISSUE_CREATED',
        project,
        issueId: doc._id,
        actorId: user._id,
        recipients: [project.managerId],
      });
    res.status(201).json({ issue: await toIssueDto(user, currentPermissions(req), project, doc) });
  });

  // ----- All issues (FR-ISS-02) -----
  r.get('/', perm('issues', 'view'), async (req, res) => {
    void runIssueSweeps({ logger: req.log });
    const q = parseQuery(issueListQuerySchema, req);
    const user = currentUser(req);
    const projectFilter: FilterQuery<IssueProject> = { ...projectScopeFilter(user) };
    if (q.clientId) projectFilter.clientId = new Types.ObjectId(q.clientId);
    if (q.projectId) projectFilter._id = new Types.ObjectId(q.projectId);
    const projectIds = (await ProjectModel.find(projectFilter).select('_id').lean()).map(
      (x) => x._id,
    );
    const base = { projectId: { $in: projectIds } };
    const docs = (await IssueModel.find({ ...listFilter(q), ...base })
      .limit(2000)
      .lean()) as IssueDoc[];
    const body: IssueListDto = {
      items: sortRows(await toIssueRows(docs)),
      counts: await counts(base),
      can: { create: false },
    };
    res.json(body);
  });

  r.get('/:id', perm('issues', 'view'), async (req, res) => {
    void runIssueSweeps({ logger: req.log });
    const { issue, project } = await loadIssue(req);
    res.json({
      issue: await toIssueDto(currentUser(req), currentPermissions(req), project, issue),
    });
  });

  r.get('/:id/activity', perm('issues', 'view'), async (req, res) => {
    const { issue } = await loadIssue(req);
    res.json({ items: await issueActivity(issue._id) });
  });

  // ----- Edit (FR-ISS-03/05/11) -----
  r.patch('/:id', perm('issues', 'edit'), async (req, res) => {
    const input = parseBody(updateIssueSchema, req);
    const { issue, project } = await loadIssue(req);
    assertCanEditIssue(req, project, issue);
    if (issue.version !== input.version) throw staleIssue();
    const user = currentUser(req);
    const set: Record<string, unknown> = {};
    const changes: { field: string; old: unknown; new: unknown }[] = [];
    let reason: string | undefined;
    const change = (field: keyof IssueDoc, old: unknown, val: unknown, shown = val) => {
      set[field] = val;
      changes.push({ field, old, new: shown });
    };
    for (const f of ['title', 'description', 'stage', 'category'] as const) {
      if (input[f] !== undefined && input[f] !== issue[f]) change(f, issue[f], input[f]);
    }
    if (
      input.ownerId !== undefined &&
      (input.ownerId ?? null) !== (issue.ownerId?.toString() ?? null)
    ) {
      // In progress and Waiting on client need an owner (§3).
      if (
        input.ownerId === null &&
        (issue.status === 'IN_PROGRESS' || issue.status === 'WAITING_ON_CLIENT')
      ) {
        throw unprocessable('An issue in progress needs an owner.', 'OWNER_REQUIRED', [
          { path: 'ownerId', message: 'An issue in progress needs an owner.' },
        ]);
      }
      await assertOwner(project, input.ownerId);
      change(
        'ownerId',
        issue.ownerId?.toString() ?? null,
        input.ownerId ? new Types.ObjectId(input.ownerId) : null,
        input.ownerId ?? null,
      );
    }
    if (
      input.reportedByContactId !== undefined &&
      (input.reportedByContactId ?? null) !== (issue.reportedByContactId?.toString() ?? null)
    ) {
      await assertContact(project, input.reportedByContactId);
      change(
        'reportedByContactId',
        issue.reportedByContactId?.toString() ?? null,
        input.reportedByContactId ? new Types.ObjectId(input.reportedByContactId) : null,
        input.reportedByContactId ?? null,
      );
    }
    if (input.taskIds !== undefined || input.messageIds !== undefined) {
      await assertLinks(project, input.taskIds, input.messageIds);
      if (input.taskIds)
        change('taskIds', issue.taskIds.map(String), ids(input.taskIds), input.taskIds);
      if (input.messageIds)
        change('messageIds', issue.messageIds.map(String), ids(input.messageIds), input.messageIds);
    }
    // Due date: by hand needs a reason; null goes back to the severity default; a severity
    // change recalculates from the day it was raised unless set by hand (FR-ISS-05, EC-72).
    const severity = (input.severity ?? issue.severity) as IssueSeverity;
    if (input.severity && input.severity !== issue.severity)
      change('severity', issue.severity, input.severity);
    let due: Date | null | undefined;
    let manual = Boolean(issue.dueManual);
    if (input.dueDate !== undefined) {
      if (input.dueDate === null) {
        manual = false;
        due = defaultIssueDue(severity, issue.createdAt, await loadCalendar());
      } else if (input.dueDate !== dateStr(issue.dueDate)) {
        if (!input.dueReason) {
          throw badRequest('Give a reason for changing the due date.', [
            { path: 'dueReason', message: 'Give a reason for changing the due date.' },
          ]);
        }
        manual = true;
        due = parseDateOnly(input.dueDate);
        reason = input.dueReason;
      }
    } else if (set.severity && !manual) {
      due = defaultIssueDue(severity, issue.createdAt, await loadCalendar());
    }
    if (due !== undefined && dateStr(due) !== dateStr(issue.dueDate)) {
      change('dueDate', dateStr(issue.dueDate), due, dateStr(due));
    }
    if (manual !== Boolean(issue.dueManual)) set.dueManual = manual;
    if (!changes.length) {
      return res.json({ issue: await toIssueDto(user, currentPermissions(req), project, issue) });
    }
    const saved = (await IssueModel.findOneAndUpdate(
      { _id: issue._id, version: input.version },
      { $set: set, $inc: { version: 1 } },
      { new: true },
    ).lean()) as IssueDoc | null;
    if (!saved) throw staleIssue();
    await audit({
      actorId: user._id,
      entityType: 'issue',
      entityId: issue._id,
      projectId: project._id,
      action: 'issue_updated',
      changes,
      reason,
      meta: { key: issue.key },
    });
    if (set.ownerId)
      await notify({
        type: 'ISSUE_ASSIGNED',
        project,
        issueId: issue._id,
        actorId: user._id,
        recipients: [set.ownerId as Id],
      });
    res.json({ issue: await toIssueDto(user, currentPermissions(req), project, saved) });
  });

  // ----- Status workflow (FR-ISS-04, AC-42.3, EC-70) -----
  r.post('/:id/status', perm('issues', 'edit'), async (req, res) => {
    const input = parseBody(issueStatusSchema, req);
    const { issue, project } = await loadIssue(req);
    assertCanEditIssue(req, project, issue);
    if (issue.version !== input.version) throw staleIssue();
    const user = currentUser(req);
    const from = issue.status as IssueStatus;
    const to = input.status;
    const rule = issueTransition(from, to);
    if (!rule.allowed) {
      throw unprocessable(
        `An issue can’t move from ${ISSUE_STATUS_LABELS[from]} to ${ISSUE_STATUS_LABELS[to]}.`,
        'INVALID_TRANSITION',
      );
    }
    if (!allowedTransitions(user, currentPermissions(req), project, issue).includes(to)) {
      throw forbidden(
        rule.plannerOnly
          ? 'Only the project manager or an Admin can reopen a closed issue.'
          : 'Only the project manager, an Admin or the reporter can confirm a resolution.',
      );
    }
    if (rule.resolution && !input.resolution) {
      throw unprocessable('Enter the resolution.', 'RESOLUTION_REQUIRED', [
        { path: 'resolution', message: 'Enter the resolution.' },
      ]);
    }
    if (rule.reason && !input.reason) {
      throw unprocessable('Give a reason.', 'REASON_REQUIRED', [
        { path: 'reason', message: 'Give a reason.' },
      ]);
    }
    if (rule.owner && !issue.ownerId) {
      throw unprocessable('Choose an owner before starting work on this issue.', 'OWNER_REQUIRED', [
        { path: 'ownerId', message: 'Choose an owner first.' },
      ]);
    }
    const now = new Date();
    const set: Record<string, unknown> = { status: to };
    if (to === 'RESOLVED') Object.assign(set, { resolution: input.resolution, resolvedAt: now });
    if (to === 'CLOSED')
      Object.assign(set, { closedAt: now, closedBy: user._id, closedReason: input.reason ?? null });
    if (to === 'IN_PROGRESS' && (from === 'RESOLVED' || from === 'CLOSED'))
      Object.assign(set, { resolvedAt: null, closedAt: null, closedBy: null, closedReason: null });
    const saved = (await IssueModel.findOneAndUpdate(
      { _id: issue._id, version: input.version, status: from },
      { $set: set, $inc: { version: 1 } },
      { new: true },
    ).lean()) as IssueDoc | null;
    if (!saved) throw staleIssue();
    const changes: { field: string; old: unknown; new: unknown }[] = [
      { field: 'status', old: from, new: to },
    ];
    if (to === 'RESOLVED') changes.push({ field: 'resolution', old: null, new: input.resolution });
    await audit({
      actorId: user._id,
      entityType: 'issue',
      entityId: issue._id,
      projectId: project._id,
      action: rule.reason && to === 'IN_PROGRESS' ? 'issue_reopened' : 'issue_status_changed',
      changes,
      reason: input.reason,
      meta: { key: issue.key },
    });
    await notifyPeople('ISSUE_STATUS', project, saved, user._id);
    res.json({ issue: await toIssueDto(user, currentPermissions(req), project, saved) });
  });

  // ----- Comments (FR-ISS-07) -----
  r.post('/:id/comments', perm('issues', 'view'), async (req, res) => {
    const input = parseBody(issueCommentSchema, req);
    const { issue, project } = await loadIssue(req);
    assertNotArchived(project);
    const user = currentUser(req);
    if (!canCommentIssue(user, currentPermissions(req), project)) throw forbidden();
    const c = await IssueCommentModel.create({
      issueId: issue._id,
      projectId: project._id,
      authorId: user._id,
      text: input.text,
    });
    await IssueModel.updateOne({ _id: issue._id }, { $set: { updatedAt: new Date() } });
    await notifyPeople('ISSUE_COMMENT', project, issue, user._id);
    const users = await userRefs([user._id]);
    res.status(201).json({
      comment: {
        id: c._id.toString(),
        kind: 'COMMENT',
        actor: { id: user._id.toString(), name: users.get(user._id.toString())?.name ?? '' },
        at: c.createdAt.toISOString(),
        text: c.text,
        action: null,
        changes: [],
        reason: null,
      },
    });
  });

  // ----- Delete: Admins only by default (FR-ISS-15) -----
  r.delete('/:id', perm('issues', 'delete'), async (req, res) => {
    const { issue, project } = await loadIssue(req);
    assertNotArchived(project);
    if (!canDeleteIssue(currentUser(req), currentPermissions(req), project)) throw forbidden();
    await IssueModel.deleteOne({ _id: issue._id });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'issue',
      entityId: issue._id,
      projectId: project._id,
      action: 'issue_deleted',
      meta: { key: issue.key, title: issue.title },
    });
    res.status(204).end();
  });

  return [p.router, r.router];
}

function staleIssue() {
  return conflictWith(
    'Someone else changed this issue. Reload to see the latest.',
    'VERSION_CONFLICT',
  );
}

/** Open issues of a project, for the archive warning (FR-ISS-13). */
export async function openIssueKeys(projectId: Id): Promise<string[]> {
  const docs = await IssueModel.find({ projectId, status: { $in: [...OPEN_ISSUE_STATUSES] } })
    .sort({ number: 1 })
    .select('key')
    .lean();
  return docs.map((d) => d.key);
}
