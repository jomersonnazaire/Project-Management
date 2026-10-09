import {
  OPEN_ISSUE_STATUSES,
  ISSUE_AUTO_CLOSE_DAYS,
  ISSUE_SEVERITY_DUE_DAYS,
  ISSUE_TRANSITIONS,
  addWorkingDays,
  isIssueOpen,
  isIssueOverdue,
  issuePrefix,
  issueTransition,
  phDateOf,
  parseDateOnly,
  toDateOnly,
  todayPH,
  type IssueActivityDto,
  type IssueCategory,
  type IssueDto,
  type IssueRowDto,
  type IssueSeverity,
  type IssueStage,
  type IssueStatus,
  type PermissionGrid,
  type WorkCalendar,
} from '@xc8/shared';
import type { Logger } from 'pino';
import { Types } from 'mongoose';
import {
  ActivityLogModel,
  ClientContactModel,
  ClientModel,
  IssueCommentModel,
  IssueModel,
  MessageModel,
  ProjectModel,
  TaskModel,
  type Issue,
  type Project,
} from '../models/index.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { userRefs } from './projectService.js';
import { isPlanner, isProjectMember, type ScopeUser } from './scope.js';

type Id = Types.ObjectId;
export type IssueDoc = Issue & { _id: Id; createdAt: Date; updatedAt: Date };
export type IssueProject = Project & { _id: Id };

/**
 * Access to issues (doc 13 §7, FR-ISS-12/13/14). The access rules gate each route first; these
 * fixed scope rules apply on top:
 *   - Viewing follows the project: Members only see projects they're on (404 otherwise).
 *   - Raising and commenting: the project's people (Admin, the managing PM, members).
 *   - Editing: planners (Admin, the managing PM) and Members who own or reported the issue.
 *   - Archived projects are read-only; Completed and On Hold projects keep issues open.
 */
export function canRaiseIssue(user: ScopeUser, perms: PermissionGrid, p: IssueProject): boolean {
  return !p.archived && perms.issues.create && (isPlanner(user, p) || isProjectMember(user, p));
}

export function canEditIssue(
  user: ScopeUser,
  perms: PermissionGrid,
  p: IssueProject,
  issue: Pick<IssueDoc, 'ownerId' | 'reportedById'>,
): boolean {
  if (p.archived || !perms.issues.edit) return false;
  if (isPlanner(user, p)) return true;
  return (
    isProjectMember(user, p) &&
    (Boolean(issue.ownerId?.equals(user._id)) || issue.reportedById.equals(user._id))
  );
}

export function canCommentIssue(user: ScopeUser, perms: PermissionGrid, p: IssueProject): boolean {
  return (
    !p.archived &&
    (perms.issues.create || perms.issues.edit) &&
    (isPlanner(user, p) || isProjectMember(user, p))
  );
}

export function canDeleteIssue(user: ScopeUser, perms: PermissionGrid, p: IssueProject): boolean {
  return perms.issues.delete && isPlanner(user, p) && !p.archived;
}

/** Statuses the user may move this issue to now (§5 plus who may confirm or reopen). */
export function allowedTransitions(
  user: ScopeUser,
  perms: PermissionGrid,
  p: IssueProject,
  issue: Pick<IssueDoc, 'ownerId' | 'reportedById' | 'status'>,
): IssueStatus[] {
  if (!canEditIssue(user, perms, p, issue)) return [];
  const from = issue.status as IssueStatus;
  const planner = isPlanner(user, p);
  return ISSUE_TRANSITIONS[from].filter((to) => {
    const rule = issueTransition(from, to);
    if (rule.plannerOnly && !planner) return false;
    if (rule.confirmer && !planner && !issue.reportedById.equals(user._id)) return false;
    return true;
  });
}

/** Completed projects default to "After go-live" (§3). */
export const defaultStage = (p: { status?: string | null }): IssueStage =>
  p.status === 'COMPLETED' ? 'AFTER_GO_LIVE' : 'BEFORE_GO_LIVE';

/** Default due date: N working days after the day it was raised (Philippine date, §4). */
export function defaultIssueDue(severity: IssueSeverity, raisedAt: Date, cal: WorkCalendar): Date {
  return addWorkingDays(parseDateOnly(phDateOf(raisedAt)), ISSUE_SEVERITY_DUE_DAYS[severity], cal);
}

/** Next running number and the project's fixed prefix (atomic; numbers are never reused). */
export async function nextIssueNumber(
  p: IssueProject,
): Promise<{ number: number; prefix: string }> {
  let prefix = p.issuePrefix;
  if (!prefix) {
    const client = await ClientModel.findById(p.clientId).select('name').lean();
    prefix = issuePrefix(client?.name ?? p.name, p.type);
    await ProjectModel.updateOne(
      { _id: p._id, issuePrefix: null },
      { $set: { issuePrefix: prefix } },
    );
    prefix =
      (await ProjectModel.findById(p._id).select('issuePrefix').lean())?.issuePrefix ?? prefix;
  }
  const updated = await ProjectModel.findOneAndUpdate(
    { _id: p._id },
    { $inc: { issueSeq: 1 } },
    { new: true, projection: { issueSeq: 1 } },
  );
  return { number: updated!.issueSeq ?? 1, prefix };
}

/** Rows and full DTOs. Project, client, people, contacts, links resolved in a few queries. */
export async function toIssueRows(docs: IssueDoc[]): Promise<IssueRowDto[]> {
  if (!docs.length) return [];
  const projectIds = [...new Set(docs.map((d) => d.projectId.toString()))];
  const projects = (await ProjectModel.find({ _id: { $in: projectIds } })
    .select('name clientId managerId memberIds')
    .lean()) as IssueProject[];
  const pm = new Map(projects.map((p) => [p._id.toString(), p]));
  const [clients, users, contacts] = await Promise.all([
    ClientModel.find({ _id: { $in: projects.map((p) => p.clientId) } })
      .select('name')
      .lean(),
    userRefs(docs.map((d) => d.ownerId)),
    ClientContactModel.find({
      _id: { $in: docs.map((d) => d.reportedByContactId).filter(Boolean) },
    })
      .select('name active')
      .lean(),
  ]);
  const cm = new Map(clients.map((c) => [c._id.toString(), c.name]));
  const contactMap = new Map(contacts.map((c) => [c._id.toString(), c]));
  const today = toDateOnly(todayPH());
  return docs.map((d) => {
    const p = pm.get(d.projectId.toString());
    const owner = d.ownerId ? (users.get(d.ownerId.toString()) ?? null) : null;
    const status = d.status as IssueStatus;
    const due = d.dueDate ? toDateOnly(d.dueDate) : null;
    const onProject = Boolean(
      owner && p && isProjectMember({ _id: d.ownerId!, systemRole: '' }, p),
    );
    const contact = d.reportedByContactId ? contactMap.get(d.reportedByContactId.toString()) : null;
    return {
      id: d._id.toString(),
      key: d.key,
      title: d.title,
      project: { id: d.projectId.toString(), name: p?.name ?? '' },
      client: p?.clientId
        ? { id: p.clientId.toString(), name: cm.get(p.clientId.toString()) ?? '' }
        : null,
      stage: d.stage as IssueStage,
      category: d.category as IssueCategory,
      severity: d.severity as IssueSeverity,
      status,
      owner,
      ownerNeeded: isIssueOpen(status) && (!owner || !owner.active || !onProject),
      contact: contact
        ? { id: contact._id.toString(), name: contact.name, active: Boolean(contact.active) }
        : null,
      dueDate: due,
      overdue: isIssueOverdue(due, status, today),
      updatedAt: (d.updatedAt ?? d.createdAt).toISOString(),
    };
  });
}

export async function toIssueDto(
  user: ScopeUser,
  perms: PermissionGrid,
  p: IssueProject,
  d: IssueDoc,
): Promise<IssueDto> {
  const [row] = await toIssueRows([d]);
  const [users, tasks, messages] = await Promise.all([
    userRefs([d.reportedById, d.closedBy, ...d.attachments.map((a) => a.uploadedBy)]),
    TaskModel.find({ _id: { $in: d.taskIds }, projectId: p._id })
      .select('name status')
      .lean(),
    MessageModel.find({ _id: { $in: d.messageIds }, projectId: p._id })
      .select('text type createdAt hidden')
      .lean(),
  ]);
  const tm = new Map(tasks.map((t) => [t._id.toString(), t]));
  const mm = new Map(messages.map((m) => [m._id.toString(), m]));
  const ref = (id?: Id | null) => {
    const u = id ? users.get(id.toString()) : null;
    return u ? { id: u.id, name: u.name } : null;
  };
  const editable = canEditIssue(user, perms, p, d);
  return {
    ...row!,
    description: d.description,
    reportedBy: users.get(d.reportedById.toString()) ?? null,
    dueManual: Boolean(d.dueManual),
    resolution: d.resolution ?? null,
    resolvedAt: d.resolvedAt ? d.resolvedAt.toISOString() : null,
    closedAt: d.closedAt ? d.closedAt.toISOString() : null,
    closedBy: ref(d.closedBy),
    closedReason: d.closedReason ?? null,
    createdAt: d.createdAt.toISOString(),
    version: d.version,
    projectStatus: p.status ?? 'PLANNING',
    projectArchived: Boolean(p.archived),
    // EC-69: a removed task shows as "Task removed"; the issue is unaffected.
    links: {
      tasks: d.taskIds.map((id) => {
        const t = tm.get(id.toString());
        return { id: id.toString(), name: t?.name ?? null, status: t?.status ?? null };
      }),
      messages: d.messageIds.map((id) => {
        const m = mm.get(id.toString());
        return {
          id: id.toString(),
          excerpt: m && !m.hidden ? m.text.slice(0, 80) : null,
          type: m?.type ?? null,
          at: m?.createdAt ? m.createdAt.toISOString() : null,
        };
      }),
    },
    attachments: d.attachments.map((a) => ({
      documentId: a.documentId.toString(),
      name: a.name,
      size: a.size,
      mimeType: a.mimeType,
      uploadedBy: ref(a.uploadedBy),
      at: a.at.toISOString(),
    })),
    can: {
      edit: editable,
      comment: canCommentIssue(user, perms, p),
      attach: editable,
      delete: canDeleteIssue(user, perms, p),
      transitions: allowedTransitions(user, perms, p, d),
    },
  };
}

/** Comments and audited changes in one timeline, oldest first (FR-ISS-07, FR-ISS-11). */
export async function issueActivity(issueId: Id): Promise<IssueActivityDto[]> {
  const [comments, logs] = await Promise.all([
    IssueCommentModel.find({ issueId }).sort({ createdAt: 1 }).lean(),
    ActivityLogModel.find({ entityType: 'issue', entityId: issueId }).sort({ at: 1 }).lean(),
  ]);
  // DR-18: owner and reporter changes show people's names, not raw ids (resolved at read time, so
  // older history entries read correctly too).
  const changeIds = (field: string) =>
    logs.flatMap((l) =>
      (l.changes ?? [])
        .filter((c) => c.field === field)
        .flatMap((c) => [c.old, c.new])
        .filter((v): v is string => typeof v === 'string' && Types.ObjectId.isValid(v)),
    );
  const [users, contacts] = await Promise.all([
    userRefs([
      ...comments.map((c) => c.authorId),
      ...logs.map((l) => l.actorId),
      ...changeIds('ownerId').map((v) => new Types.ObjectId(v)),
    ]),
    ClientContactModel.find({ _id: { $in: changeIds('reportedByContactId') } })
      .select('name')
      .lean(),
  ]);
  const contactNames = new Map(contacts.map((c) => [c._id.toString(), c.name]));
  const ref = (id?: Id | null) => {
    const u = id ? users.get(id.toString()) : null;
    return u ? { id: u.id, name: u.name } : null;
  };
  const shown = (field: string, v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    if (field === 'ownerId') return users.get(v)?.name ?? 'Former user';
    if (field === 'reportedByContactId') return contactNames.get(v) ?? 'Former contact';
    return v;
  };
  return [
    ...comments.map((c) => ({
      id: c._id.toString(),
      kind: 'COMMENT' as const,
      actor: ref(c.authorId),
      at: c.createdAt.toISOString(),
      text: c.text,
      action: null,
      changes: [],
      reason: null,
    })),
    ...logs.map((l) => ({
      id: l._id.toString(),
      kind: 'EVENT' as const,
      actor: ref(l.actorId),
      at: l.at.toISOString(),
      text: null,
      action: l.action,
      changes: (l.changes ?? []).map((c) => ({
        field: c.field ?? '',
        old: shown(c.field ?? '', c.old),
        new: shown(c.field ?? '', c.new),
      })),
      reason: l.reason ?? null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

// ---------- Scheduled work: auto-close (FR-ISS-06) and daily overdue reminders (FR-ISS-10) ----------
let lastSweep = 0;
const SWEEP_EVERY_MS = 10 * 60 * 1000;

/**
 * Runs at most every 10 minutes per instance: on API start, on an hourly timer and lazily when
 * issues are read. Both steps are conditional updates, so several instances never double up.
 */
export async function runIssueSweeps(opts: { force?: boolean; logger?: Logger; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  if (!opts.force && now.getTime() - lastSweep < SWEEP_EVERY_MS) return { closed: 0, reminded: 0 };
  lastSweep = now.getTime();
  let closed = 0;
  let reminded = 0;
  const cutoff = new Date(now.getTime() - ISSUE_AUTO_CLOSE_DAYS * 86_400_000);
  const stale = await IssueModel.find({ status: 'RESOLVED', resolvedAt: { $lte: cutoff } })
    .select('_id projectId')
    .lean();
  for (const s of stale) {
    const done = await IssueModel.findOneAndUpdate(
      { _id: s._id, status: 'RESOLVED', resolvedAt: { $lte: cutoff } },
      {
        $set: {
          status: 'CLOSED',
          closedAt: now,
          closedBy: null,
          closedReason: `Closed automatically ${ISSUE_AUTO_CLOSE_DAYS} days after it was resolved`,
        },
        $inc: { version: 1 },
      },
    );
    if (!done) continue;
    closed += 1;
    await audit({
      actorId: null,
      entityType: 'issue',
      entityId: s._id,
      projectId: s.projectId,
      action: 'issue_auto_closed',
      changes: [{ field: 'status', old: 'RESOLVED', new: 'CLOSED' }],
    });
  }
  const today = todayPH();
  const overdue = await IssueModel.find({
    status: { $in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CLIENT'] },
    dueDate: { $lt: today },
    ownerId: { $ne: null },
    $or: [{ remindedOn: null }, { remindedOn: { $lt: today } }],
  })
    .select('_id projectId ownerId')
    .lean();
  const projects = new Map<string, IssueProject>();
  for (const i of overdue) {
    const claimed = await IssueModel.findOneAndUpdate(
      { _id: i._id, $or: [{ remindedOn: null }, { remindedOn: { $lt: today } }] },
      { $set: { remindedOn: today } },
    );
    if (!claimed) continue;
    const key = i.projectId.toString();
    if (!projects.has(key)) {
      const p = (await ProjectModel.findById(i.projectId).lean()) as IssueProject | null;
      if (p) projects.set(key, p);
    }
    const p = projects.get(key);
    if (!p || p.archived) continue;
    reminded += await notify({
      type: 'ISSUE_OVERDUE',
      project: p,
      issueId: i._id,
      actorId: null,
      recipients: [i.ownerId],
    });
  }
  if (closed || reminded) opts.logger?.info({ closed, reminded }, 'Issue sweeps');
  return { closed, reminded };
}

/**
 * EC-66: when an issue owner is deactivated or removed from the project, their open issues show
 * "Owner needed" (computed on read) and the project's PM is notified once per issue.
 */
export async function notifyOwnerNeeded(opts: {
  ownerIds: Id[];
  projectId?: Id;
  actorId: Id | null;
}): Promise<number> {
  if (!opts.ownerIds.length) return 0;
  const issues = await IssueModel.find({
    ownerId: { $in: opts.ownerIds },
    status: { $in: OPEN_ISSUE_STATUSES },
    ...(opts.projectId ? { projectId: opts.projectId } : {}),
  })
    .select('_id projectId')
    .lean();
  if (!issues.length) return 0;
  const projects = await ProjectModel.find({
    _id: { $in: issues.map((i) => i.projectId) },
    archived: { $ne: true },
  })
    .select('managerId memberIds')
    .lean();
  const byId = new Map(projects.map((p) => [p._id.toString(), p]));
  let sent = 0;
  for (const i of issues) {
    const project = byId.get(i.projectId.toString());
    if (!project?.managerId) continue;
    sent += await notify({
      type: 'ISSUE_OWNER_NEEDED',
      project,
      issueId: i._id,
      actorId: opts.actorId,
      recipients: [project.managerId],
    });
  }
  return sent;
}
