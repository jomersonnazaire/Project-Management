import {
  END_AFTER_START,
  PROJECT_FILTERS,
  createProjectSchema,
  parseDateOnly,
  projectContactSchema,
  projectListQuerySchema,
  todayUtc,
  toDateOnly,
  updateProjectSchema,
  type ProjectFilter,
  type ProjectStatus,
} from '@xc8/shared';
import type { Request } from 'express';
import mongoose, { Types, type FilterQuery } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { conflictWith, unprocessable } from '../lib/http422.js';
import { paginate } from '../lib/pagination.js';
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import {
  ActivityLogModel,
  ClientContactModel,
  ClientModel,
  ProjectModel,
  TaskModel,
  TemplateModel,
  UserModel,
  type Project,
} from '../models/index.js';
import { audit } from '../services/audit.js';
import {
  buildPlanTasks,
  recomputeProject,
  toProjectDto,
  toProjectListItems,
  type ProjectDoc,
} from '../services/projectService.js';
import { assertProjectScope, projectScopeFilter } from '../services/scope.js';

/**
 * Projects (FR-PRJ-01..13, doc 11 FR-PRJ-11..13). The central gate checks `projects.*`; these
 * handlers add the fixed scope (FR-ACL-07): Members only their projects (404 otherwise), PMs edit
 * and archive only projects they manage (Q-12), only Admins delete (Q-26).
 */

/** Project status moves a project editor may make (FR-PRJ-05, workflow §1). */
const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  PLANNING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'CANCELLED'],
  COMPLETED: ['ACTIVE'],
  CANCELLED: [],
};

export async function loadProject(
  req: Request,
  action: 'view' | 'edit' | 'archive' | 'delete',
  id = idParam(req),
) {
  const project = await ProjectModel.findById(id);
  if (!project) throw notFound();
  assertProjectScope(currentUser(req), project, action);
  return project;
}

export function assertNotArchived(project: { archived?: boolean | null }) {
  if (project.archived) {
    throw conflict(
      'This project is archived. Restore it before making changes.',
      'PROJECT_ARCHIVED',
    );
  }
}

/** Refreshes stored health once a day so "overdue" follows the calendar (NFR-13). */
async function refreshStale(projects: ProjectDoc[]): Promise<ProjectDoc[]> {
  const today = todayUtc();
  const stale = projects.filter((p) => !p.computed?.updatedAt || p.computed.updatedAt < today);
  if (!stale.length) return projects;
  await Promise.all(stale.map((p) => recomputeProject(p._id)));
  const fresh = await ProjectModel.find({ _id: { $in: stale.map((p) => p._id) } }).lean();
  const byId = new Map(fresh.map((p) => [p._id.toString(), p as ProjectDoc]));
  return projects.map((p) => byId.get(p._id.toString()) ?? p);
}

/** Applies a list filter (status, Delayed / At risk health, or Archived) to a project query. */
export function applyProjectFilter(filter: FilterQuery<Project>, status?: string) {
  if (status === 'ARCHIVED') {
    filter.archived = true;
    return;
  }
  filter.archived = { $ne: true };
  if (!status) return;
  if (!(PROJECT_FILTERS as readonly string[]).includes(status)) throw badRequest('Unknown status.');
  const f = status as ProjectFilter;
  if (f === 'DELAYED' || f === 'AT_RISK') {
    filter.status = 'ACTIVE';
    filter['computed.health'] = f;
  } else {
    filter.status = f;
  }
}

async function assertInternalUsers(ids: string[], label: string, roles?: string[]) {
  if (!ids.length) return;
  const q: FilterQuery<unknown> = { _id: { $in: ids }, active: true };
  if (roles) q.systemRole = { $in: roles };
  const n = await UserModel.countDocuments(q);
  if (n !== new Set(ids).size)
    throw unprocessable(`${label} must be active internal users.`, 'INVALID_USER');
}

export function projectsRouter(registry: RouteRegistry) {
  // People picker for project managers, members and task owners: active internal users, names and
  // roles only (no emails), for anyone who can view projects. Client contacts never appear (AC-04.2).
  const people = registry.router('/people');
  people.get('/', perm('projects', 'view'), async (_req, res) => {
    const users = await UserModel.find({ active: true })
      .select('name systemRole jobRole')
      .sort({ name: 1 })
      .limit(1000)
      .lean();
    res.json({
      items: users.map((u) => ({
        id: u._id.toString(),
        name: u.name,
        systemRole: u.systemRole,
        jobRole: u.jobRole,
      })),
    });
  });

  const r = registry.router('/projects');

  r.get('/', perm('projects', 'view'), async (req, res) => {
    const q = parseQuery(projectListQuerySchema, req);
    const user = currentUser(req);
    const scope = projectScopeFilter(user);
    const filter: FilterQuery<Project> = { ...scope };
    applyProjectFilter(filter, q.status);
    if (q.clientId) filter.clientId = q.clientId;
    if (q.mine === 'true') filter.managerId = user._id;
    if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
    const { skip, limit } = paginate(q.page, q.pageSize);
    const [rows, total, groups] = await Promise.all([
      ProjectModel.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      ProjectModel.countDocuments(filter),
      ProjectModel.aggregate<{
        _id: { status: string; health: string; archived: boolean };
        n: number;
      }>([
        {
          $match: { ...scope, ...(q.clientId ? { clientId: new Types.ObjectId(q.clientId) } : {}) },
        },
        {
          $group: {
            _id: {
              status: '$status',
              health: '$computed.health',
              archived: { $eq: ['$archived', true] },
            },
            n: { $sum: 1 },
          },
        },
      ]),
    ]);
    const counts: Record<string, number> = { ALL: 0, ARCHIVED: 0 };
    for (const f of PROJECT_FILTERS) counts[f] = counts[f] ?? 0;
    for (const g of groups) {
      if (g._id.archived) {
        counts.ARCHIVED! += g.n;
        continue;
      }
      counts.ALL! += g.n;
      counts[g._id.status] = (counts[g._id.status] ?? 0) + g.n;
      if (g._id.status === 'ACTIVE' && (g._id.health === 'DELAYED' || g._id.health === 'AT_RISK')) {
        counts[g._id.health] = (counts[g._id.health] ?? 0) + g.n;
      }
    }
    const items = await toProjectListItems(await refreshStale(rows as ProjectDoc[]));
    res.json({ items, page: q.page, pageSize: q.pageSize, total, counts });
  });

  r.get('/:id', perm('projects', 'view'), async (req, res) => {
    const project = await loadProject(req, 'view');
    const [fresh] = await refreshStale([project.toObject() as ProjectDoc]);
    res.json({ project: await toProjectDto(fresh!, currentUser(req), currentPermissions(req)) });
  });

  // FR-PRJ-01..04, AC-09.*: create the project and generate its plan from a published template in
  // one transaction, so a failure leaves no partial project or tasks (AC-09.6).
  r.post('/', perm('projects', 'create'), async (req, res) => {
    const input = parseBody(createProjectSchema, req);
    const user = currentUser(req);
    const client = await ClientModel.findById(input.clientId).lean();
    if (!client) throw unprocessable('Choose a client.', 'INVALID_CLIENT');
    if (!client.active) throw unprocessable('This client is inactive.', 'INVALID_CLIENT');
    await assertInternalUsers([input.managerId], 'The project manager', [
      'ADMIN',
      'PROJECT_MANAGER',
    ]);
    await assertInternalUsers(input.memberIds, 'Project members');

    const template = await TemplateModel.findById(input.templateId).lean();
    if (!template || template.status !== 'PUBLISHED') {
      throw unprocessable('Choose a published template.', 'TEMPLATE_NOT_PUBLISHED');
    }
    if (
      template.superseded ||
      (input.templateVersion && input.templateVersion !== template.version)
    ) {
      const current = await TemplateModel.findOne({
        templateKey: template.templateKey,
        status: 'PUBLISHED',
        superseded: { $ne: true },
      }).lean();
      throw conflictWith(
        'This template has a newer version. Review the preview again.',
        'TEMPLATE_CHANGED',
        {
          templateId: current?._id.toString() ?? null,
          version: current?.version ?? null,
        },
      );
    }

    const start = parseDateOnly(input.startDate);
    const end = parseDateOnly(input.plannedEndDate);
    const projectId = new Types.ObjectId();
    const managerId = new Types.ObjectId(input.managerId);
    const memberIds = [...new Set([input.managerId, ...input.memberIds])].map(
      (id) => new Types.ObjectId(id),
    );
    const tasks = buildPlanTasks(template, projectId, start);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await ProjectModel.create(
          [
            {
              _id: projectId,
              name: input.name,
              clientId: client._id,
              managerId,
              memberIds,
              type: input.type ?? template.type,
              description: input.description || null,
              status: 'PLANNING',
              startDate: start,
              plannedEndDate: end,
              templateSnapshot: {
                templateId: template._id,
                templateKey: template.templateKey,
                version: template.version,
                name: template.name,
                copy: { phases: template.phases, activities: template.activities },
              },
              createdBy: user._id,
            },
          ],
          { session },
        );
        if (tasks.length) await TaskModel.insertMany(tasks, { session });
        await recomputeProject(projectId, session);
      });
    } finally {
      await session.endSession();
    }
    await audit({
      actorId: user._id,
      entityType: 'project',
      entityId: projectId,
      projectId,
      action: 'project_created',
      meta: {
        templateId: template._id.toString(),
        templateVersion: template.version,
        tasks: tasks.length,
      },
    });

    // Non-blocking warnings (EC-13, EC-27, EC-29).
    const warnings: string[] = [];
    const lastDue = tasks.reduce<Date | null>(
      (m, t) => (!m || t.dueDate > m ? t.dueDate : m),
      null,
    );
    if (lastDue && lastDue > end) {
      const days = Math.round((lastDue.getTime() - end.getTime()) / 86_400_000);
      warnings.push(`Plan exceeds baseline end by ${days} day${days === 1 ? '' : 's'}.`);
    }
    if (end < todayUtc()) warnings.push('The baseline end is in the past.');
    if (
      await ProjectModel.exists({
        _id: { $ne: projectId },
        clientId: client._id,
        name: new RegExp(`^${escapeRegex(input.name)}$`, 'i'),
      })
    ) {
      warnings.push('This client already has a project with this name.');
    }
    const project = await ProjectModel.findById(projectId).lean();
    res.status(201).json({
      project: await toProjectDto(project as ProjectDoc, user, currentPermissions(req)),
      warnings,
    });
  });

  r.patch('/:id', perm('projects', 'edit'), async (req, res) => {
    const input = parseBody(updateProjectSchema, req);
    const user = currentUser(req);
    const project = await loadProject(req, 'edit');
    assertNotArchived(project);
    const changes: { field: string; old: unknown; new: unknown }[] = [];
    const track = (field: string, old: unknown, next: unknown) => {
      if (JSON.stringify(old) !== JSON.stringify(next)) changes.push({ field, old, new: next });
    };

    if (input.name !== undefined) {
      track('name', project.name, input.name);
      project.name = input.name;
    }
    if (input.description !== undefined) {
      track('description', project.description, input.description || null);
      project.description = input.description || null;
    }
    if (input.type !== undefined) {
      track('type', project.type, input.type);
      project.type = input.type;
    }
    if (input.managerId !== undefined && input.managerId !== project.managerId?.toString()) {
      await assertInternalUsers([input.managerId], 'The project manager', [
        'ADMIN',
        'PROJECT_MANAGER',
      ]);
      track('managerId', project.managerId?.toString() ?? null, input.managerId);
      project.managerId = new Types.ObjectId(input.managerId);
    }
    if (input.memberIds !== undefined) {
      const current = project.memberIds.map(String);
      const added = input.memberIds.filter((id) => !current.includes(id));
      await assertInternalUsers(added, 'Project members');
      const next = [
        ...new Set([...input.memberIds, project.managerId?.toString()].filter(Boolean) as string[]),
      ];
      track('memberIds', current.sort(), [...next].sort());
      project.memberIds = next.map((id) => new Types.ObjectId(id));
    } else if (
      project.managerId &&
      !project.memberIds.some((id) => id.equals(project.managerId!))
    ) {
      project.memberIds.push(project.managerId);
    }

    // Changing the client: blocked while tasks tag the old client's contacts (EC-24); clears the
    // active contacts after a confirmation (FR-PRJ-13).
    if (input.clientId !== undefined && input.clientId !== project.clientId.toString()) {
      const client = await ClientModel.findById(input.clientId).lean();
      if (!client || !client.active)
        throw unprocessable('Choose an active client.', 'INVALID_CLIENT');
      if (await TaskModel.exists({ projectId: project._id, clientContactId: { $ne: null } })) {
        throw conflict(
          "Tasks in this project are tagged with the current client's contacts. Clear them first.",
          'CLIENT_CONTACTS_TAGGED',
        );
      }
      if (project.activeContactIds.length && !input.confirmClearContacts) {
        throw conflict(
          "Changing this project's client clears its active contacts. Confirm to continue.",
          'CONFIRM_CLEAR_CONTACTS',
        );
      }
      track('clientId', project.clientId.toString(), input.clientId);
      if (project.activeContactIds.length)
        track('activeContactIds', project.activeContactIds.map(String), []);
      project.clientId = client._id;
      project.activeContactIds = [];
    }

    // Re-baseline: needs a reason; the previous baseline is kept (FR-PRJ-12).
    const newStart =
      input.startDate ?? (project.startDate ? toDateOnly(project.startDate) : undefined);
    const newEnd =
      input.plannedEndDate ??
      (project.plannedEndDate ? toDateOnly(project.plannedEndDate) : undefined);
    const datesChanged =
      (input.startDate !== undefined &&
        input.startDate !== (project.startDate && toDateOnly(project.startDate))) ||
      (input.plannedEndDate !== undefined &&
        input.plannedEndDate !== (project.plannedEndDate && toDateOnly(project.plannedEndDate)));
    if (datesChanged) {
      if (newStart && newEnd && newEnd <= newStart) {
        throw badRequest(
          'Some fields are invalid.',
          [{ path: 'plannedEndDate', message: END_AFTER_START }],
          'VALIDATION_ERROR',
        );
      }
      if (!input.reason)
        throw unprocessable('Give a reason for changing the baseline.', 'REASON_REQUIRED');
      project.baselineHistory.push({
        startDate: project.startDate,
        plannedEndDate: project.plannedEndDate,
        reason: input.reason,
        changedAt: new Date(),
        changedBy: user._id,
      });
      track(
        'startDate',
        project.startDate ? toDateOnly(project.startDate) : null,
        newStart ?? null,
      );
      track(
        'plannedEndDate',
        project.plannedEndDate ? toDateOnly(project.plannedEndDate) : null,
        newEnd ?? null,
      );
      if (newStart) project.startDate = parseDateOnly(newStart);
      if (newEnd) project.plannedEndDate = parseDateOnly(newEnd);
    }

    if (input.status !== undefined && input.status !== project.status) {
      const from = project.status as ProjectStatus;
      if (!PROJECT_TRANSITIONS[from].includes(input.status)) {
        throw unprocessable(
          `A project can't move from ${from} to ${input.status}.`,
          'INVALID_TRANSITION',
        );
      }
      if (input.status === 'ACTIVE' && from === 'PLANNING') {
        // AC-10.3: every task needs an accountable owner before the project goes Active.
        const missing = await TaskModel.find({
          projectId: project._id,
          ownerId: null,
          status: { $ne: 'CANCELLED' },
        })
          .select('name order')
          .sort({ order: 1 })
          .lean();
        if (missing.length) {
          throw unprocessable(
            `Give these tasks an accountable owner first: ${missing.map((t) => t.name).join(', ')}.`,
            'TASKS_WITHOUT_OWNER',
            { tasks: missing.map((t) => ({ id: t._id.toString(), name: t.name })) },
          );
        }
      }
      if (input.status === 'COMPLETED') {
        const open = await TaskModel.countDocuments({
          projectId: project._id,
          status: { $nin: ['COMPLETED', 'CANCELLED'] },
        });
        if (open)
          throw unprocessable(
            `${open} task${open === 1 ? ' is' : 's are'} still open.`,
            'OPEN_TASKS',
          );
      }
      track('status', from, input.status);
      project.status = input.status;
    }

    await project.save();
    await recomputeProject(project._id);
    if (changes.length) {
      await audit({
        actorId: user._id,
        entityType: 'project',
        entityId: project._id,
        projectId: project._id,
        action: 'project_updated',
        changes,
        reason: datesChanged ? (input.reason ?? undefined) : undefined,
      });
    }
    const fresh = await ProjectModel.findById(project._id).lean();
    res.json({ project: await toProjectDto(fresh as ProjectDoc, user, currentPermissions(req)) });
  });

  // Archive counts as Edit on projects (Q-26); PMs archive only projects they manage (Q-12).
  for (const [path, archived] of [
    ['archive', true],
    ['unarchive', false],
  ] as const) {
    r.post(`/:id/${path}`, perm('projects', 'edit'), async (req, res) => {
      const project = await loadProject(req, 'archive');
      if (Boolean(project.archived) !== archived) {
        project.archived = archived;
        project.archivedAt = archived ? new Date() : null;
        await project.save();
        await audit({
          actorId: currentUser(req)._id,
          entityType: 'project',
          entityId: project._id,
          projectId: project._id,
          action: archived ? 'project_archived' : 'project_unarchived',
          changes: [{ field: 'archived', old: !archived, new: archived }],
        });
      }
      res.json({
        project: await toProjectDto(
          project.toObject() as ProjectDoc,
          currentUser(req),
          currentPermissions(req),
        ),
      });
    });
  }

  // Only Admins delete projects (Q-26, fixed in code). Deletes the project's tasks too.
  r.delete('/:id', perm('projects', 'delete'), async (req, res) => {
    const project = await loadProject(req, 'delete');
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await TaskModel.deleteMany({ projectId: project._id }, { session });
        await project.deleteOne({ session });
      });
    } finally {
      await session.endSession();
    }
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'project',
      entityId: project._id,
      projectId: project._id,
      action: 'project_deleted',
      meta: { name: project.name },
    });
    res.status(204).end();
  });

  // ----- Active contacts (FR-PRJ-11..13, AC-36.1): only the project client's active contacts -----
  r.get('/:id/contact-options', perm('projects', 'edit'), async (req, res) => {
    const project = await loadProject(req, 'edit');
    const contacts = await ClientContactModel.find({ clientId: project.clientId, active: true })
      .sort({ name: 1 })
      .lean();
    const added = new Set(project.activeContactIds.map(String));
    res.json({
      items: contacts.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        position: c.position ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        active: true,
        added: added.has(c._id.toString()),
      })),
    });
  });

  r.post('/:id/contacts', perm('projects', 'edit'), async (req, res) => {
    const { contactId } = parseBody(projectContactSchema, req);
    const project = await loadProject(req, 'edit');
    assertNotArchived(project);
    const contact = await ClientContactModel.findById(contactId).lean();
    if (!contact || !contact.clientId.equals(project.clientId)) {
      throw unprocessable(
        "Only contacts from this project's client can be added.",
        'CONTACT_NOT_IN_CLIENT',
      );
    }
    if (!contact.active) throw unprocessable('This contact is inactive.', 'CONTACT_INACTIVE');
    if (!project.activeContactIds.some((id) => id.equals(contact._id))) {
      project.activeContactIds.push(contact._id);
      await project.save();
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'project',
        entityId: project._id,
        projectId: project._id,
        action: 'project_contact_added',
        changes: [{ field: 'activeContactIds', old: null, new: contact._id.toString() }],
      });
    }
    res.json({
      project: await toProjectDto(
        project.toObject() as ProjectDoc,
        currentUser(req),
        currentPermissions(req),
      ),
    });
  });

  r.delete('/:id/contacts/:contactId', perm('projects', 'edit'), async (req, res) => {
    const project = await loadProject(req, 'edit');
    assertNotArchived(project);
    const contactId = idParam(req, 'contactId');
    if (project.activeContactIds.some((id) => id.toString() === contactId)) {
      project.activeContactIds = project.activeContactIds.filter(
        (id) => id.toString() !== contactId,
      );
      await project.save();
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'project',
        entityId: project._id,
        projectId: project._id,
        action: 'project_contact_removed',
        changes: [{ field: 'activeContactIds', old: contactId, new: null }],
      });
    }
    res.json({
      project: await toProjectDto(
        project.toObject() as ProjectDoc,
        currentUser(req),
        currentPermissions(req),
      ),
    });
  });

  // ----- Activity log tab (FR-AUD-02): needs View on audit, plus the project scope -----
  r.get('/:id/activity', perm('audit', 'view'), async (req, res) => {
    const project = await loadProject(req, 'view');
    const entries = await ActivityLogModel.find({ projectId: project._id })
      .sort({ at: -1 })
      .limit(200)
      .lean();
    const users = await UserModel.find({
      _id: { $in: entries.map((e) => e.actorId).filter(Boolean) },
    })
      .select('name')
      .lean();
    const names = new Map(users.map((u) => [u._id.toString(), u.name]));
    res.json({
      items: entries.map((e) => ({
        id: e._id.toString(),
        at: e.at.toISOString(),
        actor: e.actorId
          ? { id: e.actorId.toString(), name: names.get(e.actorId.toString()) ?? 'Unknown user' }
          : null,
        entityType: e.entityType,
        entityId: e.entityId.toString(),
        action: e.action,
        changes: e.changes ?? [],
        reason: e.reason ?? null,
      })),
    });
  });

  return [people.router, r.router];
}
