import {
  OPEN_TASK_STATUSES,
  TASK_STATUS_LABELS,
  TASK_TRANSITIONS,
  approveTaskSchema,
  createTaskSchema,
  daysBetween,
  evidenceLinkSchema,
  findCycle,
  followUpSchema,
  isOverdue,
  myTasksQuerySchema,
  parseDateOnly,
  rejectTaskSchema,
  taskStatusSchema,
  taskVersionSchema,
  todayUtc,
  updateTaskSchema,
  type MyTaskDto,
  type PermissionGrid,
  type TaskDto,
  type TaskStatus,
} from '@xc8/shared';
import type { Request, Response } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { conflictWith, unprocessable } from '../lib/http422.js';
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import {
  ActivityLogModel,
  ClientContactModel,
  ProjectModel,
  TaskModel,
  TeamModel,
  UserModel,
  type Project,
  type Task,
} from '../models/index.js';
import { audit } from '../services/audit.js';
import { dateOrNull, recomputeProject, userRefs } from '../services/projectService.js';
import {
  canEditProjectScope,
  isPlanner,
  projectScopeFilter,
  type ScopeUser,
} from '../services/scope.js';
import { assertNotArchived, loadProject } from './projects.js';

/**
 * Tasks: board, checklist, task details and My tasks (FR-TSK-01..14, workflow §2). The gate checks
 * `tasks.*` / `approvals.edit`; on top of that (fixed scope, FR-ACL-07, FR-TSK-14):
 *   - only planners (Admin, the managing PM) add, delete or re-plan tasks;
 *   - others change status, evidence and notes only on tasks they own or are assigned to;
 *   - approvals: Admin, the managing PM, or the task's designated reviewer.
 */
type Id = Types.ObjectId;
type TaskDoc = Task & { _id: Id };
type ProjectDoc = Project & { _id: Id };

const isMine = (user: ScopeUser, t: TaskDoc) =>
  Boolean(t.ownerId?.equals(user._id)) || (t.assigneeIds ?? []).some((id) => id.equals(user._id));

function taskCan(
  user: ScopeUser,
  perms: PermissionGrid,
  project: ProjectDoc,
  t: TaskDoc,
): TaskDto['can'] {
  const open = !project.archived;
  const plan = open && perms.tasks.edit && isPlanner(user, project);
  const status = open && perms.tasks.edit && (plan || isMine(user, t));
  const reviewer = Boolean(t.approval?.reviewerId?.equals(user._id));
  const approve =
    open &&
    perms.approvals.edit &&
    t.status === 'FOR_REVIEW' &&
    (user.systemRole === 'ADMIN' ||
      (user.systemRole === 'PROJECT_MANAGER' && canEditProjectScope(user, project)) ||
      reviewer);
  return { edit: status, plan, status, approve };
}

async function toTaskDtos(req: Request, project: ProjectDoc, tasks: TaskDoc[]): Promise<TaskDto[]> {
  const user = currentUser(req);
  const perms = currentPermissions(req);
  const userIds = tasks.flatMap((t) => [
    t.ownerId,
    t.approval?.reviewerId,
    t.approval?.decidedBy,
    ...(t.assigneeIds ?? []),
    ...(t.evidence ?? []).map((e) => e.addedBy),
    ...(t.followUps ?? []).map((f) => f.authorId),
  ]);
  const contactIds = tasks
    .flatMap((t) => [t.clientContactId, ...(t.followUps ?? []).map((f) => f.contactId)])
    .filter(Boolean);
  const [users, contacts] = await Promise.all([
    userRefs(userIds),
    ClientContactModel.find({ _id: { $in: contactIds } })
      .select('name active')
      .lean(),
  ]);
  const contactMap = new Map(
    contacts.map((c) => [
      c._id.toString(),
      { id: c._id.toString(), name: c.name, active: Boolean(c.active) },
    ]),
  );
  const ref = (id?: Id | null) => (id ? (users.get(id.toString()) ?? null) : null);
  const nameRef = (id?: Id | null) => {
    const u = ref(id);
    return u ? { id: u.id, name: u.name } : null;
  };
  const today = todayUtc();
  return tasks.map((t) => {
    const status = t.status as TaskStatus;
    const overdue = isOverdue({ status, dueDate: t.dueDate }, today);
    return {
      id: t._id.toString(),
      projectId: t.projectId.toString(),
      order: t.order ?? 0,
      name: t.name,
      phase: t.phase ?? null,
      taskType: t.taskType ?? null,
      priority: t.priority as TaskDto['priority'],
      mandatory: Boolean(t.mandatory),
      party: t.party as TaskDto['party'],
      teamId: t.teamId ? t.teamId.toString() : null,
      owner: ref(t.ownerId),
      assignees: (t.assigneeIds ?? [])
        .map((id) => ref(id))
        .filter((u): u is NonNullable<typeof u> => Boolean(u)),
      clientContact: t.clientContactId
        ? (contactMap.get(t.clientContactId.toString()) ?? null)
        : null,
      plannedStart: dateOrNull(t.plannedStart),
      dueDate: dateOrNull(t.dueDate),
      estHours: typeof t.estHours === 'number' ? t.estHours : null,
      actualHours: t.actualHours ?? 0,
      status,
      previousStatus: (t.previousStatus ?? null) as TaskStatus | null,
      dependsOn: (t.dependsOn ?? []).map(String),
      deliverable: t.deliverable ?? null,
      blockerReason: t.blockerReason ?? null,
      requiresApproval: Boolean(t.requiresApproval),
      reviewer: ref(t.approval?.reviewerId),
      approval: {
        state: (t.approval?.state ?? 'NONE') as TaskDto['approval']['state'],
        decidedBy: nameRef(t.approval?.decidedBy),
        decidedAt: t.approval?.decidedAt ? t.approval.decidedAt.toISOString() : null,
        comment: t.approval?.comment ?? null,
      },
      evidence: (t.evidence ?? []).map((e) => ({
        id: e._id.toString(),
        type: 'LINK' as const,
        name: e.name ?? '',
        url: e.url ?? '',
        addedBy: nameRef(e.addedBy),
        at: (e.at ?? new Date()).toISOString(),
      })),
      followUps: (t.followUps ?? []).map((f) => ({
        id: f._id.toString(),
        note: f.note ?? '',
        author: nameRef(f.authorId),
        contact: f.contactId ? (contactMap.get(f.contactId.toString()) ?? null) : null,
        at: (f.at ?? new Date()).toISOString(),
      })),
      isMilestone: Boolean(t.isMilestone),
      overdue,
      daysLate: overdue && t.dueDate ? daysBetween(t.dueDate, today) : 0,
      version: t.version ?? 0,
      can: taskCan(user, perms, project, t),
    };
  });
}

/** Loads a task and its project, applying the project's view scope (404 outside it). */
async function loadTask(req: Request) {
  const task = await TaskModel.findById(idParam(req));
  if (!task) throw notFound();
  const project = await loadProject(req, 'view', task.projectId.toString());
  return { task, project };
}

function assertVersion(task: { version?: number | null }, version: number) {
  if ((task.version ?? 0) !== version) {
    throw conflict('This task changed, refresh to see the latest version.', 'VERSION_CONFLICT');
  }
}

function assertCan(req: Request, project: ProjectDoc, task: TaskDoc, what: keyof TaskDto['can']) {
  assertNotArchived(project);
  if (!taskCan(currentUser(req), currentPermissions(req), project, task)[what]) {
    throw forbidden(
      what === 'plan'
        ? 'Only the project manager can change the plan (dates, estimates, owners, dependencies).'
        : undefined,
    );
  }
}

async function respondTask(
  req: Request,
  res: Response,
  project: ProjectDoc,
  taskId: Id,
  status = 200,
) {
  const fresh = (await TaskModel.findById(taskId).lean()) as TaskDoc;
  const [dto] = await toTaskDtos(req, project, [fresh]);
  res.status(status).json({ task: dto });
}

type PlanInput = Partial<{
  ownerId: string | null;
  assigneeIds: string[];
  reviewerId: string | null;
  clientContactId: string | null;
  party: 'INTERNAL' | 'CLIENT';
  dependsOn: string[];
  teamId: string | null;
}>;

/** Validates people, contact, team and dependencies of a task against its project. */
async function validatePlan(
  project: ProjectDoc,
  input: PlanInput,
  current: Partial<TaskDoc> & { _id: Id },
) {
  const members = new Set(
    [...(project.memberIds ?? []).map(String), project.managerId?.toString()].filter(Boolean),
  );
  const people = [input.ownerId, input.reviewerId, ...(input.assigneeIds ?? [])].filter(
    Boolean,
  ) as string[];
  if (people.length) {
    const active = await UserModel.countDocuments({ _id: { $in: people }, active: true });
    const unique = new Set(people);
    // Owners and assignees are internal users on the project team (never client contacts, EC-22).
    if (active !== unique.size || [...unique].some((id) => !members.has(id))) {
      throw badRequest(
        'Owners, assignees and reviewers must be active members of this project.',
        undefined,
        'INVALID_ASSIGNEE',
      );
    }
  }
  if (input.teamId && !(await TeamModel.exists({ _id: input.teamId })))
    throw badRequest('Unknown team.');
  const party = input.party ?? current.party;
  const contactId =
    input.clientContactId !== undefined
      ? input.clientContactId
      : (current.clientContactId?.toString() ?? null);
  if (party === 'CLIENT' && !contactId) {
    throw badRequest(
      'Choose the client contact responsible for this task.',
      [{ path: 'clientContactId', message: 'Required when the responsible party is Client.' }],
      'CONTACT_REQUIRED',
    );
  }
  if (input.clientContactId && input.clientContactId !== current.clientContactId?.toString()) {
    const c = await ClientContactModel.findById(input.clientContactId).lean();
    // AC-05.2/05.3: only active contacts of the project's client.
    if (!c || !c.clientId.equals(project.clientId) || !c.active) {
      throw badRequest(
        "Only active contacts of this project's client can be tagged.",
        undefined,
        'CONTACT_NOT_IN_CLIENT',
      );
    }
  }
  if (input.dependsOn) {
    const ids = input.dependsOn;
    if (ids.includes(current._id.toString()))
      throw unprocessable("A task can't depend on itself.", 'DEPENDENCY_CYCLE');
    const all = await TaskModel.find({ projectId: project._id }).select('name dependsOn').lean();
    const known = new Set(all.map((t) => t._id.toString()));
    if (ids.some((id) => !known.has(id)))
      throw unprocessable('Dependencies must be tasks in this project.', 'INVALID_DEPENDENCY');
    const nodes = all.map((t) => ({
      id: t._id.toString(),
      dependsOn: (t.dependsOn ?? []).map(String),
    }));
    const me = nodes.find((n) => n.id === current._id.toString());
    if (me) me.dependsOn = ids;
    else nodes.push({ id: current._id.toString(), dependsOn: ids });
    const cycle = findCycle(nodes);
    if (cycle) {
      const names = new Map(all.map((t) => [t._id.toString(), t.name]));
      const labels = cycle.map((id) => names.get(id) ?? 'this task');
      throw unprocessable(`Circular dependency: ${labels.join(' → ')}.`, 'DEPENDENCY_CYCLE', {
        tasks: labels,
      });
    }
  }
}

function toPlanUpdate(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || k === 'version' || k === 'reviewerId') continue;
    if (k === 'plannedStart' || k === 'dueDate') out[k] = v ? parseDateOnly(v as string) : null;
    else if (k === 'deliverable' || k === 'phase' || k === 'taskType') out[k] = v || null;
    else out[k] = v;
  }
  if ('reviewerId' in input && input.reviewerId !== undefined)
    out['approval.reviewerId'] = input.reviewerId;
  return out;
}

const fmt = (v: unknown): unknown =>
  v instanceof Date
    ? v.toISOString().slice(0, 10)
    : v instanceof Types.ObjectId
      ? v.toString()
      : Array.isArray(v)
        ? v.map(fmt)
        : (v ?? null);

export function tasksRouter(registry: RouteRegistry) {
  const p = registry.router('/projects');

  p.get('/:id/tasks', perm('tasks', 'view'), async (req, res) => {
    const project = await loadProject(req, 'view');
    const filter: FilterQuery<Task> = { projectId: project._id };
    const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : undefined;
    if (assignee) {
      if (!/^[a-f0-9]{24}$/i.test(assignee)) throw badRequest('Invalid assignee.');
      filter.$or = [{ ownerId: assignee }, { assigneeIds: assignee }];
    }
    const tasks = (await TaskModel.find(filter).sort({ order: 1 }).lean()) as TaskDoc[];
    res.json({ items: await toTaskDtos(req, project, tasks) });
  });

  p.post('/:id/tasks', perm('tasks', 'create'), async (req, res) => {
    const input = parseBody(createTaskSchema, req);
    const project = await loadProject(req, 'view');
    assertNotArchived(project);
    if (!isPlanner(currentUser(req), project)) {
      throw forbidden('Only the project manager can add tasks.');
    }
    const _id = new Types.ObjectId();
    await validatePlan(project, input, { _id, party: input.party });
    const last = await TaskModel.findOne({ projectId: project._id })
      .sort({ order: -1 })
      .select('order')
      .lean();
    await TaskModel.create({
      _id,
      projectId: project._id,
      order: (last?.order ?? 0) + 1,
      ...toPlanUpdate(input),
      approval: { reviewerId: input.reviewerId ?? null },
    });
    await recomputeProject(project._id);
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'task',
      entityId: _id,
      projectId: project._id,
      action: 'task_created',
    });
    await respondTask(req, res, project, _id, 201);
  });

  const r = registry.router('/tasks');

  // My tasks across projects (FR-TSK-13, AC-17.1): open tasks I own or am assigned to, overdue first.
  r.get('/mine', perm('tasks', 'view'), async (req, res) => {
    const q = parseQuery(myTasksQuerySchema, req);
    const user = currentUser(req);
    const projects = await ProjectModel.find({
      ...projectScopeFilter(user),
      archived: { $ne: true },
    })
      .select('name managerId memberIds')
      .lean();
    const projectIds = projects.map((p) => p._id);
    const managed = projects
      .filter((p) =>
        user.systemRole === 'ADMIN'
          ? p.managerId?.equals(user._id)
          : canEditProjectScope(user, p) && p.managerId?.equals(user._id),
      )
      .map((p) => p._id);
    const mine = { $or: [{ ownerId: user._id }, { assigneeIds: user._id }] };
    const review = {
      status: 'FOR_REVIEW',
      $or: [{ 'approval.reviewerId': user._id }, { projectId: { $in: managed } }],
    };
    const base = { projectId: { $in: projectIds } };
    const all = (await TaskModel.find({ ...base, $or: [mine, review] }).lean()) as TaskDoc[];
    const today = todayUtc();
    const weekEnd = new Date(today.getTime() + 7 * 86_400_000);
    const isOpen = (t: TaskDoc) => (OPEN_TASK_STATUSES as string[]).includes(t.status);
    const isReview = (t: TaskDoc) =>
      t.status === 'FOR_REVIEW' &&
      (Boolean(t.approval?.reviewerId?.equals(user._id)) ||
        managed.some((id) => id.equals(t.projectId)));
    const counts = {
      overdue: all.filter(
        (t) =>
          isMine(user, t) &&
          isOverdue({ status: t.status as TaskStatus, dueDate: t.dueDate }, today),
      ).length,
      dueThisWeek: all.filter(
        (t) =>
          isMine(user, t) && isOpen(t) && t.dueDate && t.dueDate >= today && t.dueDate < weekEnd,
      ).length,
      toReview: all.filter(isReview).length,
      assigned: all.filter((t) => isMine(user, t) && isOpen(t)).length,
      accountable: all.filter((t) => Boolean(t.ownerId?.equals(user._id)) && isOpen(t)).length,
    };
    let list: TaskDoc[];
    switch (q.view) {
      case 'accountable':
        list = all.filter((t) => Boolean(t.ownerId?.equals(user._id)) && isOpen(t));
        break;
      case 'review':
        list = all.filter(isReview);
        break;
      case 'completed':
        list = all.filter((t) => isMine(user, t) && t.status === 'COMPLETED');
        break;
      default:
        list = all.filter((t) => isMine(user, t) && isOpen(t));
    }
    if (q.q) {
      const re = new RegExp(escapeRegex(q.q), 'i');
      list = list.filter((t) => re.test(t.name));
    }
    const names = new Map(projects.map((p) => [p._id.toString(), p.name]));
    const items: MyTaskDto[] = list.map((t) => {
      const status = t.status as TaskStatus;
      const overdue = isOverdue({ status, dueDate: t.dueDate }, today);
      return {
        id: t._id.toString(),
        name: t.name,
        project: { id: t.projectId.toString(), name: names.get(t.projectId.toString()) ?? '' },
        role: t.ownerId?.equals(user._id)
          ? 'ACCOUNTABLE'
          : isMine(user, t)
            ? 'ASSIGNEE'
            : 'REVIEWER',
        dueDate: dateOrNull(t.dueDate),
        overdue,
        daysLate: overdue && t.dueDate ? daysBetween(t.dueDate, today) : 0,
        estHours: typeof t.estHours === 'number' ? t.estHours : null,
        actualHours: t.actualHours ?? 0,
        status,
        party: t.party as MyTaskDto['party'],
      };
    });
    // Overdue first, then by due date (undated last).
    items.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (!a.dueDate || !b.dueDate) return a.dueDate ? -1 : b.dueDate ? 1 : 0;
      return a.dueDate.localeCompare(b.dueDate);
    });
    res.json({ items, counts });
  });

  r.get('/:id', perm('tasks', 'view'), async (req, res) => {
    const { task, project } = await loadTask(req);
    const [dto] = await toTaskDtos(req, project, [task.toObject() as TaskDoc]);
    res.json({ task: dto });
  });

  r.get('/:id/history', perm('tasks', 'view'), async (req, res) => {
    const { task } = await loadTask(req);
    const entries = await ActivityLogModel.find({ entityType: 'task', entityId: task._id })
      .sort({ at: -1 })
      .limit(200)
      .lean();
    const users = await userRefs(entries.map((e) => e.actorId));
    res.json({
      items: entries.map((e) => ({
        id: e._id.toString(),
        at: e.at.toISOString(),
        actor: e.actorId
          ? {
              id: e.actorId.toString(),
              name: users.get(e.actorId.toString())?.name ?? 'Unknown user',
            }
          : null,
        action: e.action,
        changes: e.changes ?? [],
        reason: e.reason ?? null,
      })),
    });
  });

  // Plan fields are PM-only (FR-TSK-14, AC-10.4); the template is never touched (AC-10.2).
  r.patch('/:id', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(updateTaskSchema, req);
    const { task, project } = await loadTask(req);
    assertCan(req, project, task.toObject() as TaskDoc, 'plan');
    assertVersion(task, input.version);
    await validatePlan(project, input as PlanInput, task.toObject() as TaskDoc);
    const update = toPlanUpdate(input as Record<string, unknown>);
    const before = task.toObject() as unknown as Record<string, unknown>;
    const changes = Object.entries(update)
      .map(([field, next]) => ({
        field,
        old: fmt(field === 'approval.reviewerId' ? task.approval?.reviewerId : before[field]),
        new: fmt(next),
      }))
      .filter((c) => JSON.stringify(c.old) !== JSON.stringify(c.new));
    const merged = {
      plannedStart: update.plannedStart ?? task.plannedStart,
      dueDate: update.dueDate ?? task.dueDate,
    } as { plannedStart?: Date | null; dueDate?: Date | null };
    if (merged.plannedStart && merged.dueDate && merged.dueDate < merged.plannedStart) {
      throw badRequest(
        'Some fields are invalid.',
        [{ path: 'dueDate', message: "Due date can't be before the start date." }],
        'VALIDATION_ERROR',
      );
    }
    const updated = await TaskModel.updateOne(
      { _id: task._id, version: input.version },
      { $set: update, $inc: { version: 1 } },
    );
    if (!updated.modifiedCount) assertVersion({ version: -1 }, input.version);
    await recomputeProject(project._id);
    if (changes.length) {
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'task',
        entityId: task._id,
        projectId: project._id,
        action: 'task_updated',
        changes,
      });
    }
    await respondTask(req, res, project, task._id);
  });

  // Status changes follow the state machine (workflow §2, FR-TSK-03..06, TC-F04).
  r.post('/:id/status', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(taskStatusSchema, req);
    const user = currentUser(req);
    const { task, project } = await loadTask(req);
    const t = task.toObject() as TaskDoc;
    assertCan(req, project, t, 'status');
    assertVersion(task, input.version);
    const from = task.status as TaskStatus;
    let to = input.status as TaskStatus;
    const planner = isPlanner(user, project);
    if (from === to)
      throw badRequest(
        `The task is already ${TASK_STATUS_LABELS[to]}.`,
        undefined,
        'INVALID_TRANSITION',
      );
    if (!TASK_TRANSITIONS[from].includes(to)) {
      throw badRequest(
        `A task can't move from ${TASK_STATUS_LABELS[from]} to ${TASK_STATUS_LABELS[to]}.`,
        undefined,
        'INVALID_TRANSITION',
      );
    }
    const set: Record<string, unknown> = {};
    let reason: string | undefined;
    const meta: Record<string, unknown> = {};

    if (to === 'BLOCKED') {
      if (!input.reason)
        throw badRequest(
          'Add a reason so the PM knows what’s needed.',
          [{ path: 'reason', message: 'Blocker reason is required.' }],
          'REASON_REQUIRED',
        );
      set.previousStatus = from;
      set.blockerReason = input.reason;
      reason = input.reason;
    }
    if (to === 'CANCELLED') {
      // FR-TSK-06: mandatory tasks are cancelled only by the PM, with a reason.
      if (task.mandatory && !planner)
        throw forbidden('Only the project manager can cancel a mandatory task.');
      if (task.mandatory && !input.reason)
        throw badRequest('Give a reason for cancelling this task.', undefined, 'REASON_REQUIRED');
      reason = input.reason ?? undefined;
    }
    if (from === 'COMPLETED' && to === 'IN_PROGRESS') {
      if (!planner) throw forbidden('Only the project manager can reopen a completed task.');
      if (!input.reason)
        throw badRequest('Give a reason for reopening this task.', undefined, 'REASON_REQUIRED');
      reason = input.reason;
      set['approval.state'] = 'NONE';
    } else if (to === 'IN_PROGRESS' || to === 'COMPLETED') {
      // FR-TSK-04: predecessors must be Completed (Cancelled counts as satisfied, EC-16).
      const preds = await TaskModel.find({
        _id: { $in: task.dependsOn },
        status: { $nin: ['COMPLETED', 'CANCELLED'] },
      })
        .select('name order status')
        .sort({ order: 1 })
        .lean();
      if (preds.length) {
        if (!input.overrideReason) {
          const names = preds.map((p) => `#${p.order} ${p.name}`).join(', ');
          throw conflictWith(
            `${task.name} depends on ${names}, which isn't completed yet.`,
            'PREDECESSOR_INCOMPLETE',
            {
              predecessors: preds.map((p) => ({
                id: p._id.toString(),
                name: p.name,
                order: p.order,
                status: p.status,
              })),
            },
          );
        }
        if (!planner) throw forbidden('Only the project manager can override dependencies.');
        meta.override = true;
        reason = input.overrideReason;
      }
    }
    if (to === 'COMPLETED' && task.requiresApproval) {
      // FR-TSK-05, AC-14.2/14.3: goes to For Review, and needs evidence first.
      if (!task.evidence.length) {
        throw unprocessable(
          'Add evidence (a link) before submitting this task for review.',
          'EVIDENCE_REQUIRED',
        );
      }
      to = 'FOR_REVIEW';
      set['approval.state'] = 'PENDING';
      set['approval.decidedBy'] = null;
      set['approval.decidedAt'] = null;
      set['approval.comment'] = null;
    }
    set.status = to;
    const updated = await TaskModel.updateOne(
      { _id: task._id, version: input.version },
      { $set: set, $inc: { version: 1 } },
    );
    if (!updated.modifiedCount) assertVersion({ version: -1 }, input.version);
    await recomputeProject(project._id);
    await audit({
      actorId: user._id,
      entityType: 'task',
      entityId: task._id,
      projectId: project._id,
      action: meta.override ? 'task_status_override' : 'task_status_changed',
      changes: [{ field: 'status', old: from, new: to }],
      reason,
      meta: Object.keys(meta).length ? meta : null,
    });
    await respondTask(req, res, project, task._id);
  });

  // "Mark unblocked" returns to the previous status; the reason stays in history (AC-13.2).
  r.post('/:id/unblock', perm('tasks', 'edit'), async (req, res) => {
    const { version } = parseBody(taskVersionSchema, req);
    const { task, project } = await loadTask(req);
    assertCan(req, project, task.toObject() as TaskDoc, 'status');
    assertVersion(task, version);
    if (task.status !== 'BLOCKED')
      throw badRequest('This task isn’t blocked.', undefined, 'INVALID_TRANSITION');
    const back = (task.previousStatus as TaskStatus | null) ?? 'TODO';
    await TaskModel.updateOne(
      { _id: task._id, version },
      { $set: { status: back, previousStatus: null, blockerReason: null }, $inc: { version: 1 } },
    );
    await recomputeProject(project._id);
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'task',
      entityId: task._id,
      projectId: project._id,
      action: 'task_unblocked',
      changes: [
        { field: 'status', old: 'BLOCKED', new: back },
        { field: 'blockerReason', old: task.blockerReason, new: null },
      ],
    });
    await respondTask(req, res, project, task._id);
  });

  // Approve / reject (FR-TSK-05, AC-15.*): needs Edit on approvals plus the approver scope.
  for (const decision of ['approve', 'reject'] as const) {
    r.post(`/:id/${decision}`, perm('approvals', 'edit'), async (req, res) => {
      const input = parseBody(decision === 'approve' ? approveTaskSchema : rejectTaskSchema, req);
      const user = currentUser(req);
      const { task, project } = await loadTask(req);
      if (task.status !== 'FOR_REVIEW')
        throw badRequest(
          'Only tasks in For Review can be approved or rejected.',
          undefined,
          'INVALID_TRANSITION',
        );
      assertCan(req, project, task.toObject() as TaskDoc, 'approve');
      assertVersion(task, input.version);
      const to: TaskStatus = decision === 'approve' ? 'COMPLETED' : 'IN_PROGRESS';
      await TaskModel.updateOne(
        { _id: task._id, version: input.version },
        {
          $set: {
            status: to,
            'approval.state': decision === 'approve' ? 'APPROVED' : 'REJECTED',
            'approval.decidedBy': user._id,
            'approval.decidedAt': new Date(),
            'approval.comment': input.comment || null,
          },
          $inc: { version: 1 },
        },
      );
      await recomputeProject(project._id);
      await audit({
        actorId: user._id,
        entityType: 'task',
        entityId: task._id,
        projectId: project._id,
        action: decision === 'approve' ? 'task_approved' : 'task_rejected',
        changes: [{ field: 'status', old: 'FOR_REVIEW', new: to }],
        reason: input.comment || undefined,
        // EC-20: self-approval is allowed (Q-14) and flagged.
        meta: task.ownerId?.equals(user._id) ? { selfApproval: true } : null,
      });
      await respondTask(req, res, project, task._id);
    });
  }

  // Evidence links (FR-TSK-07). File evidence arrives with documents in Milestone 3.
  r.post('/:id/evidence', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(evidenceLinkSchema, req);
    const { task, project } = await loadTask(req);
    assertCan(req, project, task.toObject() as TaskDoc, 'status');
    task.evidence.push({
      type: 'LINK',
      name: input.name,
      url: input.url,
      addedBy: currentUser(req)._id,
      at: new Date(),
    });
    task.version = (task.version ?? 0) + 1;
    await task.save();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'task',
      entityId: task._id,
      projectId: project._id,
      action: 'task_evidence_added',
      changes: [{ field: 'evidence', old: null, new: input.name }],
    });
    await respondTask(req, res, project, task._id, 201);
  });

  // EC-31: evidence on a Completed task is removed only by the PM/Admin, and audited.
  r.delete('/:id/evidence/:evidenceId', perm('tasks', 'edit'), async (req, res) => {
    const { task, project } = await loadTask(req);
    const t = task.toObject() as TaskDoc;
    assertCan(req, project, t, task.status === 'COMPLETED' ? 'plan' : 'status');
    const evidenceId = idParam(req, 'evidenceId');
    const item = task.evidence.find((e) => e._id.toString() === evidenceId);
    if (!item) throw notFound();
    task.evidence.pull({ _id: item._id });
    task.version = (task.version ?? 0) + 1;
    await task.save();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'task',
      entityId: task._id,
      projectId: project._id,
      action: 'task_evidence_removed',
      changes: [{ field: 'evidence', old: item.name, new: null }],
    });
    await respondTask(req, res, project, task._id);
  });

  // Follow-up notes about a client contact (FR-CLI-06, AC-06.2).
  r.post('/:id/follow-ups', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(followUpSchema, req);
    const { task, project } = await loadTask(req);
    assertCan(req, project, task.toObject() as TaskDoc, 'status');
    if (input.contactId) {
      const c = await ClientContactModel.findById(input.contactId).lean();
      if (!c || !c.clientId.equals(project.clientId)) {
        throw badRequest(
          "Only contacts of this project's client can be named.",
          undefined,
          'CONTACT_NOT_IN_CLIENT',
        );
      }
    }
    task.followUps.push({
      authorId: currentUser(req)._id,
      contactId: input.contactId ?? null,
      note: input.note,
      at: new Date(),
    });
    task.version = (task.version ?? 0) + 1;
    await task.save();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'task',
      entityId: task._id,
      projectId: project._id,
      action: 'task_follow_up_added',
    });
    await respondTask(req, res, project, task._id, 201);
  });

  r.delete('/:id', perm('tasks', 'delete'), async (req, res) => {
    const { task, project } = await loadTask(req);
    assertCan(req, project, task.toObject() as TaskDoc, 'plan');
    // EC-09 (time entries) applies from Milestone 3; for now tasks can be removed by the PM.
    await TaskModel.updateMany(
      { projectId: project._id, dependsOn: task._id },
      { $pull: { dependsOn: task._id }, $inc: { version: 1 } },
    );
    await task.deleteOne();
    await recomputeProject(project._id);
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'task',
      entityId: task._id,
      projectId: project._id,
      action: 'task_deleted',
      meta: { name: task.name },
    });
    res.status(204).end();
  });

  return [p.router, r.router];
}
