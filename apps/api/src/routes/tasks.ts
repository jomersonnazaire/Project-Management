import {
  OPEN_TASK_STATUSES,
  reorderTasksSchema,
  TASK_STATUS_LABELS,
  TASK_TRANSITIONS,
  approveTaskSchema,
  createTaskSchema,
  daysBetween,
  findCycle,
  followUpSchema,
  isOverdue,
  myTasksQuerySchema,
  parseDateOnly,
  rejectTaskSchema,
  phaseDeleteBlockedReason,
  phaseNotEmptyMessage,
  activityBlockedBy,
  activityInUseMessage,
  PROJECT_NOT_PLANNING_MESSAGE,
  renamePhaseSchema,
  createPhaseSchema,
  taskDeleteBlockedReason,
  todayPH,
  todaySection,
  workingDaysSince,
  taskStatusSchema,
  taskVersionSchema,
  toDateOnly,
  updateTaskSchema,
  type MyTaskDto,
  type HolidayType,
  type NotificationType,
  type PermissionGrid,
  type PhaseDto,
  PHASE_NAME_DUPLICATE,
  UNKNOWN_PHASE_MESSAGE,
  ACTUAL_FINISH_BEFORE_START,
  saveBaselineSchema,
  PHASE_TARGET_STATUSES,
  savePhaseListSchema,
  type SavePhaseListInput,
  type TimelineDto,
  type TimelinePhaseDto,
  type TaskDto,
  type TaskRecordCounts,
  type TaskStatus,
} from '@xc8/shared';
import type { Request, Response } from 'express';
import mongoose, { Types, type FilterQuery } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { conflictWith, unprocessable } from '../lib/http422.js';
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { now as clockNow } from '../lib/clock.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import {
  ActivityLogModel,
  ClientContactModel,
  DocumentModel,
  FolderModel,
  HolidayModel,
  ProjectModel,
  TaskModel,
  TeamModel,
  UserModel,
  type Project,
  type Task,
} from '../models/index.js';
import { audit, auditMany } from '../services/audit.js';
import { loadCalendar } from '../services/calendar.js';
import { taskRecordCounts } from '../services/taskRecords.js';
import { phaseKey, syncProjectPhases } from '../services/phases.js';
import { followUpUnseenCounts, markFollowUpsSeen } from '../services/followUpSeen.js';
import { renumberProjectTasks } from '../services/taskOrder.js';
import { notify } from '../services/notify.js';
import type { AppConfig } from '../config.js';
import { followUpRecipientIds, saveEmail } from '../services/actionEmail.js';
import { useMobileEmailReturn } from '../services/msSendReturn.js';
import { dateOrNull, recomputeProject, userRefs } from '../services/projectService.js';
import {
  canAddProjectMembers,
  canEditProjectScope,
  isPlanner,
  isProjectPm,
  projectScopeFilter,
  type ScopeUser,
} from '../services/scope.js';
import { assertNotArchived, assertPlanOpen, loadProject } from './projects.js';
import { canEditDeliverables } from '../services/checklistAccess.js';
import {
  deliverableItemDtos,
  legacyDeliverable,
  newTaskItems,
  rejectLegacyDeliverable,
} from '../services/deliverableItems.js';

/**
 * Tasks: board, checklist, task details and My tasks (FR-TSK-01..14, workflow §2). The gate checks
 * `tasks.*` / `approvals.edit`; on top of that (fixed scope, FR-ACL-07, FR-TSK-14):
 *   - only planners (Admin, the managing PM) add, delete or re-plan tasks;
 *   - others change status, evidence and notes only on tasks they own or are assigned to;
 *   - approvals: Admin, the managing PM, or the task's designated reviewer.
 */
type Id = Types.ObjectId;
export type TaskDoc = Task & { _id: Id };
type ProjectDoc = Project & { _id: Id };

const isMine = (user: ScopeUser, t: TaskDoc) =>
  Boolean(t.ownerId?.equals(user._id)) || (t.assigneeIds ?? []).some((id) => id.equals(user._id));

export function taskCan(
  user: ScopeUser,
  perms: PermissionGrid,
  project: ProjectDoc,
  t: TaskDoc,
): TaskDto['can'] {
  const open = !project.archived && project.status !== 'COMPLETED';
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
  return {
    edit: status,
    plan,
    status,
    approve,
    deliverables: canEditDeliverables(user, perms, project, t),
  };
}

export { phaseKey };

export interface ProjectPhase {
  /** Phase record id (CR-22 FR-TL-23); null when the phase only exists as task or folder text. */
  id: Types.ObjectId | null;
  name: string;
  targetDate: Date | null;
  taskCount: number;
  documentCount: number;
  folderIds: Types.ObjectId[];
  /** Every spelling of this phase on tasks and folders (same phaseKey). */
  variants: string[];
}

/**
 * A project's phases (CR-22 FR-TL-23): the saved phase list in its order, then phases that only
 * exist as task text in plan order, then phases that only have an evidence folder left (their
 * tasks were deleted). Names match ignoring case and spaces. Counts tasks, and documents in the
 * folder and its sub-folders.
 */
export async function projectPhases(
  projectId: Types.ObjectId,
  session?: mongoose.ClientSession,
): Promise<ProjectPhase[]> {
  const project = await ProjectModel.findById(projectId)
    .select('phases')
    .session(session ?? null)
    .lean();
  const tasks = await TaskModel.find({ projectId })
    .select('phase phaseId order')
    .sort({ order: 1 })
    .session(session ?? null)
    .lean();
  const folders = await FolderModel.find({ projectId })
    .select('_id parentId kind phase')
    .session(session ?? null)
    .lean();
  const byKey = new Map<string, ProjectPhase>();
  const add = (name: string, rec?: { _id: Types.ObjectId; targetDate?: Date | null }) => {
    const key = phaseKey(name);
    if (!key) return;
    const have = byKey.get(key);
    if (have) {
      if (!have.variants.includes(name)) have.variants.push(name);
      return;
    }
    byKey.set(key, {
      id: rec?._id ?? null,
      name: name.trim(),
      targetDate: rec?.targetDate ?? null,
      taskCount: 0,
      documentCount: 0,
      folderIds: [],
      variants: [name],
    });
  };
  for (const r of project?.phases ?? []) add(r.name, r);
  const recordIds = new Set((project?.phases ?? []).map((r) => r._id.toString()));
  // Lead: tasks belong to their phase record by id; only a task without one (before the phase
  // migration) is matched by its phase text.
  const linked = (t: (typeof tasks)[number]) =>
    Boolean(t.phaseId && recordIds.has(t.phaseId.toString()));
  for (const t of tasks) if (t.phase && !linked(t)) add(t.phase);
  for (const f of folders) if (f.kind === 'PHASE' && f.phase) add(f.phase);
  const out = [...byKey.values()];
  for (const ph of out) {
    const key = phaseKey(ph.name);
    ph.taskCount = tasks.filter((t) =>
      linked(t)
        ? Boolean(ph.id?.equals(t.phaseId!))
        : Boolean(t.phase && phaseKey(t.phase) === key),
    ).length;
    const root = folders
      .filter((f) => f.kind === 'PHASE' && f.phase && phaseKey(f.phase) === key)
      .map((f) => f._id);
    const ids = [...root];
    for (let i = 0; i < ids.length; i++) {
      for (const f of folders) if (f.parentId?.equals(ids[i])) ids.push(f._id);
    }
    ph.folderIds = ids;
    ph.documentCount = ids.length
      ? await DocumentModel.countDocuments({ folderId: { $in: ids } }).session(session ?? null)
      : 0;
  }
  return out;
}

/**
 * Doc 14 FR-PRJ-21 (v1.2.5) / doc 11 FR-ACL-19: Admins, and the Project PM (manager, or a PM on
 * the team list) with Delete on Tasks, delete unattached activities at any project status.
 */
export function canDeleteTasks(user: ScopeUser, perms: PermissionGrid, project: ProjectDoc) {
  if (project.archived || !perms.tasks.delete) return false;
  return user.systemRole === 'ADMIN' || isProjectPm(user, project);
}

/** FR-PRJ-22/23: Admins or the Project PM, with Edit on Projects, may change phases. */
function mayManagePhases(user: ScopeUser, perms: PermissionGrid, project: ProjectDoc) {
  if (project.archived || !perms.projects.edit) return false;
  return user.systemRole === 'ADMIN' || isProjectPm(user, project);
}

/** FR-PRJ-23 (Q-53/Q-55): PMs change phase details only while the project is in Planning. */
export function phaseEditableNow(user: ScopeUser, perms: PermissionGrid, project: ProjectDoc) {
  return (
    mayManagePhases(user, perms, project) &&
    (user.systemRole === 'ADMIN' || project.status === 'PLANNING')
  );
}

/**
 * CR-22 FR-TL-23 (Lean, 2026-11-11 ~12:59 AM SGT): phase target dates may change while the project
 * is Planning, Active or On hold for a PM; Admins any time (not archived).
 */
function phaseTargetsEditableNow(user: ScopeUser, perms: PermissionGrid, project: ProjectDoc) {
  return (
    mayManagePhases(user, perms, project) &&
    (user.systemRole === 'ADMIN' ||
      PHASE_TARGET_STATUSES.includes(project.status as (typeof PHASE_TARGET_STATUSES)[number]))
  );
}

/** FR-TL-31: the Philippine date each task was last marked Completed, from its history. */
async function markedDoneOn(taskIds: Types.ObjectId[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!taskIds.length) return out;
  const logs = await ActivityLogModel.find({
    entityType: 'task',
    entityId: { $in: taskIds },
    changes: { $elemMatch: { field: 'status', new: 'COMPLETED' } },
  })
    .select('entityId at')
    .sort({ at: 1 })
    .lean();
  for (const l of logs) out.set(l.entityId!.toString(), toDateOnly(todayPH(l.at)));
  return out;
}

function timelinePhaseDto(ph: ProjectPhase): TimelinePhaseDto {
  return {
    id: ph.id ? ph.id.toString() : null,
    name: ph.name,
    targetDate: dateOrNull(ph.targetDate),
    taskCount: ph.taskCount,
    documentCount: ph.documentCount,
  };
}

/** Renames a phase everywhere: its tasks, its evidence folder and its phase record. */
async function renamePhase(projectId: Id, src: ProjectPhase, newName: string) {
  // Tasks point at the record by id; their name copy follows the record.
  await TaskModel.updateMany(
    src.id
      ? { projectId, $or: [{ phaseId: src.id }, { phaseId: null, phase: { $in: src.variants } }] }
      : { projectId, phase: { $in: src.variants } },
    { $set: { phase: newName, ...(src.id ? { phaseId: src.id } : {}) }, $inc: { version: 1 } },
  );
  const folders = await FolderModel.find({
    projectId,
    kind: 'PHASE',
    phase: { $in: src.variants },
  });
  for (const f of folders) {
    const oldPhase = f.phase;
    f.phase = newName;
    // Keep a custom folder name; rename the default one when the new name is free.
    const key = newName.trim().toLowerCase();
    const taken = await FolderModel.exists({
      projectId,
      parentId: f.parentId ?? null,
      nameKey: key,
      _id: { $ne: f._id },
    });
    if (f.name === oldPhase && !taken) {
      f.name = newName;
      f.nameKey = key;
    }
    await f.save();
  }
  if (src.id) {
    await ProjectModel.updateOne(
      { _id: projectId, 'phases._id': src.id },
      { $set: { 'phases.$.name': newName } },
    );
  }
}

/** Adds a phase: its record at the end of the list and its (empty) evidence folder. */
async function createPhase(
  projectId: Id,
  existing: ProjectPhase[],
  phaseName: string,
  targetDate: Date | null,
  recordId = new Types.ObjectId(),
  pushRecord = true,
) {
  let name = phaseName;
  for (
    let n = 2;
    await FolderModel.exists({ projectId, parentId: null, nameKey: name.trim().toLowerCase() });
    n++
  ) {
    name = `${phaseName} (${n})`;
  }
  await FolderModel.create({
    projectId,
    name,
    nameKey: name.trim().toLowerCase(),
    parentId: null,
    kind: 'PHASE',
    phase: phaseName,
    order: existing.length + 1,
  });
  if (pushRecord) {
    // Text-only phases that were listed before this one join the list first, so order holds.
    const missing = existing.filter((x) => !x.id);
    await ProjectModel.updateOne(
      { _id: projectId },
      {
        $push: {
          phases: {
            $each: [
              ...missing.map((x) => ({ name: x.name, targetDate: null })),
              { _id: recordId, name: phaseName, targetDate },
            ],
          },
        },
      },
    );
  }
}

/** FR-PRJ-22: only a phase with no tasks and no documents in its folder can be removed. */
function assertPhaseRemovable(ph: ProjectPhase) {
  if (ph.taskCount > 0) {
    // FR-PRJ-22: 409 PHASE_NOT_EMPTY (taskCount kept for older clients).
    throw conflictWith(phaseNotEmptyMessage(ph.taskCount), 'PHASE_NOT_EMPTY', {
      activityCount: ph.taskCount,
      taskCount: ph.taskCount,
      phase: ph.name,
    });
  }
  if (ph.documentCount > 0) {
    throw conflictWith(phaseDeleteBlockedReason(0, ph.documentCount)!, 'PHASE_HAS_DOCUMENTS', {
      documentCount: ph.documentCount,
      phase: ph.name,
    });
  }
}

async function removePhase(projectId: Id, ph: ProjectPhase, session?: mongoose.ClientSession) {
  await FolderModel.deleteMany({ _id: { $in: ph.folderIds } }, { session });
  if (ph.id) {
    await ProjectModel.updateOne(
      { _id: projectId },
      { $pull: { phases: { _id: ph.id } } },
      { session },
    );
  }
}

type PhaseAudit = {
  action: string;
  changes?: { field: string; old: unknown; new: unknown }[];
  meta?: Record<string, unknown>;
};

/**
 * CR-22 FR-TL-23: saves the phase manager's list. Rows match an existing phase by record id, or by
 * `originalName` for a phase that only exists as task text. New rows are added, missing phases
 * removed (only when empty), and the list order and target dates saved. Structural changes (add,
 * rename, reorder, remove) need `namesEditable`; target dates don't. A saved baseline is never
 * touched (FR-TL-23).
 */
async function savePhaseList(
  project: ProjectDoc,
  input: SavePhaseListInput,
  namesEditable: boolean,
): Promise<{ audits: PhaseAudit[]; targetsOnly: boolean }> {
  // Lead: every phase gets its record (and its tasks a phaseId) before the list changes.
  await syncProjectPhases(project._id, { apply: true });
  const current = await projectPhases(project._id);
  const used = new Set<ProjectPhase>();
  const rows = input.phases.map((row, index) => {
    let match: ProjectPhase | undefined;
    if (row.id) {
      match = current.find((c) => c.id?.toString() === row.id);
      if (!match) {
        throw conflict('The phase list changed. Refresh to see the latest.', 'PHASES_CHANGED');
      }
    } else if (row.originalName) {
      match = current.find((c) => phaseKey(c.name) === phaseKey(row.originalName!));
      if (!match) {
        throw conflict('The phase list changed. Refresh to see the latest.', 'PHASES_CHANGED');
      }
    }
    if (match) {
      if (used.has(match)) {
        throw conflict('The phase list changed. Refresh to see the latest.', 'PHASES_CHANGED');
      }
      used.add(match);
    }
    return { index, row: { ...row, name: row.name.trim() }, match };
  });
  // UIE §2.7: names unique ignoring case and spaces.
  const seen = new Map<string, number>();
  const fieldErrors: { path: string; message: string }[] = [];
  for (const r of rows) {
    const k = phaseKey(r.row.name);
    if (seen.has(k)) {
      fieldErrors.push({ path: `phases.${r.index}.name`, message: PHASE_NAME_DUPLICATE });
    } else seen.set(k, r.index);
  }
  if (fieldErrors.length) {
    throw badRequest(PHASE_NAME_DUPLICATE, fieldErrors, 'DUPLICATE_NAME');
  }
  const removed = current.filter((c) => !used.has(c));
  const added = rows.filter((r) => !r.match);
  const renamed = rows.filter((r) => r.match && r.match.name !== r.row.name);
  const keptBefore = current.filter((c) => used.has(c));
  const keptAfter = rows.filter((r) => r.match).map((r) => r.match!);
  const reordered = keptBefore.some((c, i) => keptAfter[i] !== c);
  const structural = removed.length > 0 || added.length > 0 || renamed.length > 0 || reordered;
  if (structural && !namesEditable) {
    throw unprocessable(PROJECT_NOT_PLANNING_MESSAGE, 'PROJECT_NOT_PLANNING');
  }
  for (const ph of removed) assertPhaseRemovable(ph);

  const audits: PhaseAudit[] = [];
  for (const ph of removed) {
    await removePhase(project._id, ph);
    audits.push({
      action: 'phase_deleted',
      meta: { phase: ph.name, folderIds: ph.folderIds.map(String), via: 'phase_manager' },
    });
  }
  for (const r of renamed) {
    await renamePhase(project._id, r.match!, r.row.name);
    audits.push({
      action: 'phase_updated',
      changes: [{ field: 'name', old: r.match!.name, new: r.row.name }],
      meta: { via: 'phase_manager' },
    });
  }
  const ids = new Map<number, Types.ObjectId>();
  for (const r of added) {
    const id = new Types.ObjectId();
    ids.set(r.index, id);
    await createPhase(project._id, current, r.row.name, null, id, false);
    audits.push({
      action: 'phase_created',
      changes: [{ field: 'name', old: null, new: r.row.name }],
      meta: { via: 'phase_manager' },
    });
  }
  for (const r of rows) {
    const old = r.match ? dateOrNull(r.match.targetDate) : null;
    const next = r.row.targetDate ?? null;
    if (old !== next) {
      audits.push({
        action: 'phase_updated',
        changes: [{ field: 'targetDate', old, new: next }],
        meta: { phase: r.row.name, via: 'phase_manager' },
      });
    }
  }
  if (reordered) {
    audits.push({
      action: 'phases_reordered',
      changes: [
        { field: 'order', old: keptBefore.map((c) => c.name), new: rows.map((r) => r.row.name) },
      ],
    });
  }
  await ProjectModel.updateOne(
    { _id: project._id },
    {
      $set: {
        phases: rows.map((r) => ({
          _id: r.match?.id ?? ids.get(r.index) ?? new Types.ObjectId(),
          name: r.row.name,
          targetDate: r.row.targetDate ? parseDateOnly(r.row.targetDate) : null,
        })),
      },
    },
  );
  return { audits, targetsOnly: !structural };
}

/**
 * DEF-015 (NFR-25): a PM who is neither the manager nor on the team list gets 404 on project-PM
 * actions, the same as anyone outside the project.
 */
export function assertNotOutsidePm(user: ScopeUser, project: ProjectDoc) {
  if (user.systemRole === 'PROJECT_MANAGER' && !isProjectPm(user, project)) throw notFound();
}

function assertPhaseEdit(user: ScopeUser, perms: PermissionGrid, project: ProjectDoc) {
  assertNotArchived(project);
  assertNotOutsidePm(user, project);
  if (!mayManagePhases(user, perms, project)) {
    throw forbidden("Only an Admin or this project's PM can change its phases.");
  }
  if (!phaseEditableNow(user, perms, project)) {
    throw unprocessable(PROJECT_NOT_PLANNING_MESSAGE, 'PROJECT_NOT_PLANNING');
  }
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
    ...(t.deliverableItems ?? []).flatMap((i) => [i.doneBy, i.createdBy]),
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
    return u ? { id: u.id, name: u.name, avatarUpdatedAt: u.avatarUpdatedAt ?? null } : null;
  };
  // DEF-017: overdue is judged on the Philippine calendar date, not the UTC instant.
  const today = todayPH(clockNow());
  // M3.5: planners may delete a task only while nothing is recorded under it.
  const mayDelete = canDeleteTasks(user, perms, project);
  const records = mayDelete ? await taskRecordCounts(tasks.map((t) => t._id)) : null;
  // CR-20 FR-NTF-09..13: the follow-up badge's "new" count, one query for the whole list.
  const unseen = await followUpUnseenCounts(user._id, tasks);
  return tasks.map((t) => {
    const status = t.status as TaskStatus;
    const rc = records?.get(t._id.toString()) ?? {};
    const blockedBy = records ? activityBlockedBy(rc) : [];
    const blocked = !records
      ? null
      : blockedBy.length
        ? activityInUseMessage(blockedBy)
        : taskDeleteBlockedReason(rc);
    const overdue = isOverdue({ status, dueDate: t.dueDate }, today);
    return {
      id: t._id.toString(),
      projectId: t.projectId.toString(),
      order: t.order ?? 0,
      name: t.name,
      phaseId: t.phaseId ? t.phaseId.toString() : null,
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
      actualStart: dateOrNull(t.actualStart),
      actualFinish: dateOrNull(t.actualFinish),
      estHours: typeof t.estHours === 'number' ? t.estHours : null,
      actualHours: t.actualHours ?? 0,
      status,
      previousStatus: (t.previousStatus ?? null) as TaskStatus | null,
      dependsOn: (t.dependsOn ?? []).map(String),
      deliverableItems: deliverableItemDtos(t.deliverableItems, nameRef, legacyDeliverable(t)),
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
        type: (e.type === 'FILE' ? 'FILE' : 'LINK') as 'FILE' | 'LINK',
        name: e.name ?? '',
        url: e.type === 'FILE' ? null : (e.url ?? ''),
        documentId: e.documentId ? e.documentId.toString() : null,
        size: typeof e.size === 'number' ? e.size : null,
        mimeType: e.mimeType ?? null,
        addedBy: nameRef(e.addedBy),
        at: (e.at ?? new Date()).toISOString(),
      })),
      followUps: (t.followUps ?? []).map((f) => ({
        id: f._id.toString(),
        note: f.note ?? '',
        author: nameRef(f.authorId),
        contact: f.contactId ? (contactMap.get(f.contactId.toString()) ?? null) : null,
        at: (f.at ?? new Date()).toISOString(),
        emailedAt: f.emailedAt ? f.emailedAt.toISOString() : null,
      })),
      followUpsUnseen: unseen.get(t._id.toString()) ?? 0,
      isMilestone: Boolean(t.isMilestone),
      overdue,
      daysLate: overdue && t.dueDate ? daysBetween(t.dueDate, today) : 0,
      version: t.version ?? 0,
      can: taskCan(user, perms, project, t),
      deletable: mayDelete && !blocked,
      deleteBlockedReason: blocked,
      deleteBlockedBy: blockedBy,
    };
  });
}

/** Loads a task and its project, applying the project's view scope (404 outside it). */
export async function loadTask(req: Request, id = idParam(req)) {
  const task = await TaskModel.findById(id);
  if (!task) throw notFound();
  const project = await loadProject(req, 'view', task.projectId.toString());
  return { task, project };
}

function assertVersion(task: { version?: number | null }, version: number) {
  if ((task.version ?? 0) !== version) {
    throw conflict('This task changed, refresh to see the latest version.', 'VERSION_CONFLICT');
  }
}

export function assertCan(
  req: Request,
  project: ProjectDoc,
  task: TaskDoc,
  what: keyof TaskDto['can'],
) {
  assertNotArchived(project);
  assertPlanOpen(project);
  if (!taskCan(currentUser(req), currentPermissions(req), project, task)[what]) {
    throw forbidden(
      what === 'plan'
        ? 'Only the project manager can change the plan (dates, estimates, owners, dependencies).'
        : undefined,
    );
  }
}

export async function respondTask(
  req: Request,
  res: Response,
  project: ProjectDoc,
  taskId: Id,
  status = 200,
  emailNew?: { config: AppConfig; people: (Id | string)[]; optIn: boolean | undefined },
) {
  const fresh = (await TaskModel.findById(taskId).lean()) as TaskDoc;
  // Action emails: "You were assigned" only to the people this save newly gave the task
  // (the route's own before/after diff), and only when ticked. Never blocks the save.
  const email = emailNew?.optIn
    ? await saveEmail(
        emailNew.config,
        res,
        currentUser(req),
        (await ProjectModel.findById(project._id).lean()) ?? project,
        fresh,
        'TASK_ASSIGNED',
        emailNew.people,
        true,
      )
    : null;
  const [dto] = await toTaskDtos(req, project, [fresh]);
  res.status(status).json({ task: dto, ...(email ? { email } : {}) });
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

/**
 * FR-PRJ-19 (DEF-003): people a planner adds to the project in the same save that assigns them.
 * Returns the ids that aren't members yet, after checking the caller may add members (Admin, or a
 * PM who may edit the project, with Edit on projects) and that each one is an active internal user
 * who is actually given a role on this task (so this is never a bare member add).
 */
async function prepareMemberAdds(
  req: Request,
  project: ProjectDoc,
  input: {
    addMemberIds?: string[];
    ownerId?: string | null;
    assigneeIds?: string[];
    reviewerId?: string | null;
  },
): Promise<string[]> {
  const requested = [...new Set(input.addMemberIds ?? [])];
  if (!requested.length) return [];
  const current = new Set(
    [...(project.memberIds ?? []).map(String), project.managerId?.toString()].filter(Boolean),
  );
  const toAdd = requested.filter((id) => !current.has(id));
  if (!toAdd.length) return [];
  if (!canAddProjectMembers(currentUser(req), currentPermissions(req), project)) {
    throw forbidden(
      'Only Admins and the project manager can add people to this project.',
      'CANNOT_ADD_MEMBERS',
    );
  }
  const assigned = new Set(
    [input.ownerId, input.reviewerId, ...(input.assigneeIds ?? [])].filter(Boolean),
  );
  if (toAdd.some((id) => !assigned.has(id))) {
    throw badRequest(
      'People added to the project here must be assigned to this task.',
      undefined,
      'ADD_MEMBER_NOT_ASSIGNED',
    );
  }
  const active = await UserModel.countDocuments({ _id: { $in: toAdd }, active: true });
  if (active !== toAdd.length) {
    throw unprocessable('Project members must be active internal users.', 'INVALID_USER');
  }
  return toAdd;
}

/** With the members about to be added, so validatePlan accepts them as owners or assignees. */
const withMembers = (project: ProjectDoc, add: string[]): ProjectDoc =>
  add.length
    ? {
        ...project,
        memberIds: [...(project.memberIds ?? []), ...add.map((id) => new Types.ObjectId(id))],
      }
    : project;

/** One audit entry per person, as a project member add (same action as the project form). */
async function auditMemberAdds(req: Request, project: ProjectDoc, add: string[], taskId: Id) {
  // In-app "added you to" for people joining through the task form (they're also told they
  // were assigned). Fresh members, since the project just gained them.
  if (add.length) {
    const fresh = await ProjectModel.findById(project._id).select('managerId memberIds').lean();
    if (fresh)
      await notify({
        type: 'ADDED_TO_PROJECT',
        project: fresh,
        actorId: currentUser(req)._id,
        recipients: add.map((a) => new Types.ObjectId(a)),
      });
  }
  for (const id of add) {
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'project',
      entityId: project._id,
      projectId: project._id,
      action: 'project_member_added',
      changes: [{ field: 'memberIds', old: null, new: id }],
      meta: { via: 'task_assign', taskId: taskId.toString() },
    });
  }
}

/**
 * Runs the task write and the member add in one transaction, so a failed save (e.g. a version
 * conflict) never leaves someone added to the project.
 */
async function writeWithMembers(
  project: ProjectDoc,
  add: string[],
  write: (session: mongoose.ClientSession | undefined) => Promise<void>,
) {
  if (!add.length) return write(undefined);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await ProjectModel.updateOne(
        { _id: project._id },
        { $addToSet: { memberIds: { $each: add.map((id) => new Types.ObjectId(id)) } } },
        { session },
      );
      await write(session);
    });
  } finally {
    await session.endSession();
  }
}

/**
 * CR-22 (Lead): a task's phase is one of its project's phase records. `phaseId` picks it (null =
 * No phase); an older client's `phase` name must match a phase ignoring case and spaces (doc 14
 * §J). Anything else is 422 UNKNOWN_PHASE: new phases come only from the phase manager (or a
 * Planning import). Sets both `phaseId` and the `phase` name copy on the update.
 */
async function resolveTaskPhase(projectId: Types.ObjectId, plan: Record<string, unknown>) {
  if (!('phaseId' in plan) && !('phase' in plan)) return;
  const byId = 'phaseId' in plan;
  const wanted = byId ? (plan.phaseId as string | null) : (plan.phase as string | null);
  delete plan.phaseId;
  delete plan.phase;
  if (!wanted || !wanted.trim()) {
    plan.phaseId = null;
    plan.phase = null;
    return;
  }
  const find = async () =>
    (await projectPhases(projectId)).find((ph) =>
      byId ? ph.id?.toString() === wanted : phaseKey(ph.name) === phaseKey(wanted),
    );
  let match = await find();
  if (match && !match.id) {
    // A phase known only from task text (before the migration) gets its record now.
    await syncProjectPhases(projectId, { apply: true });
    match = await find();
  }
  if (!match?.id) {
    throw unprocessable(UNKNOWN_PHASE_MESSAGE, 'UNKNOWN_PHASE', [
      { path: byId ? 'phaseId' : 'phase', message: UNKNOWN_PHASE_MESSAGE },
    ]);
  }
  plan.phaseId = match.id;
  plan.phase = match.name;
}

/** CR-22 FR-TL-10: the PM's actual dates stay in order with the ones not being changed. */
function assertActualsInOrder(
  task: { actualStart?: Date | null; actualFinish?: Date | null },
  update: Record<string, unknown>,
) {
  const start = ('actualStart' in update ? update.actualStart : task.actualStart) as Date | null;
  const finish = (
    'actualFinish' in update ? update.actualFinish : task.actualFinish
  ) as Date | null;
  if (start && finish && finish.getTime() < start.getTime()) {
    throw badRequest(
      'Some fields are invalid.',
      [{ path: 'actualFinish', message: ACTUAL_FINISH_BEFORE_START }],
      'VALIDATION_ERROR',
    );
  }
}

/**
 * CR-22 FR-TL-10 (Q-147): actual dates that follow a status change, on the Philippine date.
 * Actual start is set the first time work starts (In Progress, or straight to For review or
 * Completed); Completed sets actual finish; leaving Completed (Reopen) clears it and keeps the start.
 */
export function actualsForStatus(
  task: { actualStart?: Date | null; actualFinish?: Date | null },
  from: TaskStatus,
  to: TaskStatus,
  today: Date,
): Record<string, Date | null> {
  const set: Record<string, Date | null> = {};
  if (!task.actualStart && (to === 'IN_PROGRESS' || to === 'FOR_REVIEW' || to === 'COMPLETED'))
    set.actualStart = today;
  if (to === 'COMPLETED') set.actualFinish = today;
  else if (from === 'COMPLETED' && task.actualFinish) set.actualFinish = null;
  return set;
}

const actualChanges = (
  task: { actualStart?: Date | null; actualFinish?: Date | null },
  set: Record<string, Date | null>,
) =>
  (['actualStart', 'actualFinish'] as const)
    .filter((f) => f in set)
    .map((f) => ({ field: f, old: fmt(task[f] ?? null), new: fmt(set[f]) }));

function toPlanUpdate(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (
      v === undefined ||
      k === 'version' ||
      k === 'reviewerId' ||
      k === 'addMemberIds' ||
      k === 'emailNewAssignees' ||
      k === 'emailReturn' ||
      k === 'code_challenge' ||
      k === 'code_challenge_method'
    )
      continue;
    if (k === 'plannedStart' || k === 'dueDate' || k === 'actualStart' || k === 'actualFinish')
      out[k] = v ? parseDateOnly(v as string) : null;
    else if (k === 'deliverableItems') continue;
    else if (k === 'phase' || k === 'taskType') out[k] = v || null;
    else if (k === 'phaseId') out[k] = v || null;
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

/** Notifies against the project's CURRENT members (it may have just gained someone). */
async function notifyFresh(
  type: NotificationType,
  projectId: Id,
  taskId: Id,
  actorId: Id,
  recipients: (Id | string | null | undefined)[],
) {
  const project = await ProjectModel.findById(projectId).select('managerId memberIds').lean();
  if (!project) return;
  await notify({
    type,
    project,
    taskId,
    actorId,
    recipients: recipients.filter(Boolean).map((r) => new Types.ObjectId(String(r))),
  });
}

export function tasksRouter(registry: RouteRegistry, config: AppConfig) {
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

  // M3.5: phases (task groups plus their evidence folder). Planners delete an empty phase.
  p.get('/:id/phases', perm('tasks', 'view'), async (req, res) => {
    const project = await loadProject(req, 'view');
    const editable = phaseEditableNow(currentUser(req), currentPermissions(req), project);
    const phases = await projectPhases(project._id);
    res.json({
      items: phases.map((ph): PhaseDto => {
        const reason = phaseDeleteBlockedReason(ph.taskCount, ph.documentCount);
        return {
          id: ph.id ? ph.id.toString() : null,
          name: ph.name,
          taskCount: ph.taskCount,
          documentCount: ph.documentCount,
          deletable: editable && !reason,
          deleteBlockedReason: editable ? reason : null,
          editable,
        };
      }),
    });
  });

  // FR-PRJ-22/23: rename a phase (its tasks and evidence folder follow). PMs only in Planning.
  p.patch('/:id/phases', perm('projects', 'edit'), async (req, res) => {
    const input = parseBody(renamePhaseSchema, req);
    const project = await loadProject(req, 'view');
    const user = currentUser(req);
    assertPhaseEdit(user, currentPermissions(req), project);
    await syncProjectPhases(project._id, { apply: true });
    const phases = await projectPhases(project._id);
    // Doc 14 §J: phase names match ignoring case and leading/trailing spaces.
    const src = phases.find((x) => phaseKey(x.name) === phaseKey(input.name));
    if (!src) throw notFound('Phase not found');
    input.name = src.name;
    input.newName = input.newName.trim();
    if (input.newName !== input.name) {
      if (phases.some((x) => x !== src && phaseKey(x.name) === phaseKey(input.newName))) {
        const msg = `"${input.newName}" already exists.`;
        throw conflictWith(msg, 'DUPLICATE_NAME', [{ path: 'newName', message: msg }]);
      }
      await renamePhase(project._id, src, input.newName);
      await audit({
        actorId: user._id,
        entityType: 'project',
        entityId: project._id,
        projectId: project._id,
        action: 'phase_updated',
        changes: [{ field: 'name', old: input.name, new: input.newName }],
      });
    }
    res.json({ name: input.newName });
  });

  // m8-polish: add an (empty) phase; it shows on the Checklist and gets its evidence folder.
  p.post('/:id/phases', perm('projects', 'edit'), async (req, res) => {
    const input = parseBody(createPhaseSchema, req);
    const project = await loadProject(req, 'view');
    const user = currentUser(req);
    assertPhaseEdit(user, currentPermissions(req), project);
    await syncProjectPhases(project._id, { apply: true });
    const phases = await projectPhases(project._id);
    if (phases.some((x) => phaseKey(x.name) === phaseKey(input.name))) {
      const msg = `"${input.name}" already exists.`;
      throw conflictWith(msg, 'DUPLICATE_NAME', [{ path: 'name', message: msg }]);
    }
    await createPhase(project._id, phases, input.name, null);
    await audit({
      actorId: user._id,
      entityType: 'project',
      entityId: project._id,
      projectId: project._id,
      action: 'phase_created',
      changes: [{ field: 'name', old: null, new: input.name }],
    });
    res.status(201).json({ name: input.name });
  });

  p.delete('/:id/phases', perm('projects', 'edit'), async (req, res) => {
    const project = await loadProject(req, 'view');
    // FR-PRJ-23: Admins at any status; the Project PM only in Planning (422 PROJECT_NOT_PLANNING).
    assertPhaseEdit(currentUser(req), currentPermissions(req), project);
    // FR-PRJ-32: the phase is identified by `name` in the body or the ?name= query.
    const bodyName = (req.body as { name?: unknown } | undefined)?.name;
    const raw = typeof bodyName === 'string' ? bodyName : req.query.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw badRequest('Say which phase to delete.');
    await syncProjectPhases(project._id, { apply: true });
    const session = await mongoose.startSession();
    let folderIds: Types.ObjectId[] = [];
    let deleted = name;
    try {
      await session.withTransaction(async () => {
        const ph = (await projectPhases(project._id, session)).find(
          (x) => phaseKey(x.name) === phaseKey(name),
        );
        if (!ph) throw notFound('Phase not found');
        deleted = ph.name;
        assertPhaseRemovable(ph);
        folderIds = ph.folderIds;
        await removePhase(project._id, ph, session);
      });
    } finally {
      await session.endSession();
    }
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'project',
      entityId: project._id,
      projectId: project._id,
      action: 'phase_deleted',
      meta: { phase: deleted, folderIds: folderIds.map(String) },
    });
    res.status(204).end();
  });

  // CR-22 FR-TL-23: the phase manager saves the whole list (order, names, target dates) at once.
  // PMs change target dates in Planning, Active or On hold; adding, renaming, reordering and
  // removing stay Planning-only for PMs; Admins any time. Every change is audited.
  p.put('/:id/phase-list', perm('projects', 'edit'), async (req, res) => {
    const input = parseBody(savePhaseListSchema, req);
    const project = await loadProject(req, 'view');
    const user = currentUser(req);
    const perms = currentPermissions(req);
    assertNotArchived(project);
    assertNotOutsidePm(user, project);
    if (!mayManagePhases(user, perms, project)) {
      throw forbidden("Only an Admin or this project's PM can change its phases.");
    }
    if (!phaseTargetsEditableNow(user, perms, project)) {
      throw unprocessable(
        'Phase target dates can be changed while the project is in Planning, Active or On hold.',
        'PHASES_LOCKED',
      );
    }
    const result = await savePhaseList(project, input, phaseEditableNow(user, perms, project));
    if (result.audits.length) {
      await auditMany(
        result.audits.map((a) => ({
          actorId: user._id,
          entityType: 'project',
          entityId: project._id,
          projectId: project._id,
          ...a,
        })),
      );
    }
    const phases = await projectPhases(project._id);
    res.json({
      items: phases.map((ph) => timelinePhaseDto(ph)),
      targetsOnly: result.targetsOnly,
      changed: result.audits.length,
    });
  });

  // CR-22 FR-TL-01 to 07, 14: the Timeline tab's data. Anyone who can view the project's tasks
  // sees it (read-only unless a planner, Q-142). The chart itself is computed by the shared
  // buildTimeline() from these inputs (NFR-50).
  p.get('/:id/timeline', perm('tasks', 'view'), async (req, res) => {
    const project = await loadProject(req, 'view');
    const user = currentUser(req);
    const perms = currentPermissions(req);
    const [tasks, phases, cal, holidays] = await Promise.all([
      TaskModel.find({ projectId: project._id })
        .select(
          'order name phase phaseId status plannedStart dueDate isMilestone dependsOn ownerId actualStart actualFinish baseline',
        )
        .sort({ order: 1 })
        .lean(),
      projectPhases(project._id),
      loadCalendar(),
      HolidayModel.find().select('date name').lean(),
    ]);
    const baselines = [...(project.timelineBaselines ?? [])].reverse();
    const owners = await userRefs([
      ...tasks.map((t) => t.ownerId),
      ...baselines.map((b) => b.savedBy),
    ]);
    const doneOn = await markedDoneOn(
      tasks.filter((t) => t.status === 'COMPLETED' && !t.actualFinish).map((t) => t._id),
    );
    const open = !project.archived && project.status !== 'COMPLETED';
    const planner = open && perms.tasks.edit && isPlanner(user, project);
    const dto: TimelineDto = {
      project: {
        id: project._id.toString(),
        name: project.name,
        status: project.status as TimelineDto['project']['status'],
        archived: Boolean(project.archived),
        plannedEndDate: dateOrNull(project.plannedEndDate),
      },
      today: toDateOnly(todayPH(clockNow())),
      calendar: {
        workingDays: [...cal.workingDays],
        holidays: { ...(cal.holidays ?? {}) },
        holidayNames: Object.fromEntries(holidays.map((h) => [toDateOnly(h.date), h.name ?? ''])),
      },
      phases: phases.map((ph) => timelinePhaseDto(ph)),
      tasks: tasks.map((t) => {
        const o = t.ownerId ? owners.get(t.ownerId.toString()) : null;
        return {
          id: t._id.toString(),
          order: t.order ?? 0,
          name: t.name,
          phaseId: t.phaseId ? t.phaseId.toString() : null,
          phase: t.phase ?? null,
          status: t.status as TaskStatus,
          plannedStart: dateOrNull(t.plannedStart),
          dueDate: dateOrNull(t.dueDate),
          isMilestone: Boolean(t.isMilestone),
          dependsOn: (t.dependsOn ?? []).map(String),
          owner: o ? { id: o.id, name: o.name } : null,
          actualStart: dateOrNull(t.actualStart),
          actualFinish: dateOrNull(t.actualFinish),
          baselineStart: dateOrNull(t.baseline?.start),
          baselineFinish: dateOrNull(t.baseline?.finish),
          doneOn: doneOn.get(t._id.toString()) ?? null,
        };
      }),
      baselines: baselines.map((b) => {
        const by = b.savedBy ? owners.get(b.savedBy.toString()) : null;
        return {
          id: b._id.toString(),
          savedAt: b.savedAt.toISOString(),
          savedBy: by ? { id: by.id, name: by.name } : null,
          reason: b.reason ?? null,
          taskCount: b.taskCount ?? 0,
        };
      }),
      can: {
        plan: planner,
        editPhaseTargets: phaseTargetsEditableNow(user, perms, project),
        editPhaseNames: phaseEditableNow(user, perms, project),
        saveBaseline: planner,
      },
    };
    res.json(dto);
  });

  // CR-22 FR-TL-08 (Q-133): Save baseline copies every task's planned dates into its baseline and
  // adds a Baseline history entry. Admin or a PM on the project; the reason is optional.
  p.post('/:id/baseline', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(saveBaselineSchema, req);
    const project = await loadProject(req, 'view');
    const user = currentUser(req);
    assertNotArchived(project);
    assertPlanOpen(project);
    if (!isPlanner(user, project)) {
      throw forbidden("Only an Admin or this project's PM can save the baseline.");
    }
    const tasks = await TaskModel.find({ projectId: project._id })
      .select('plannedStart dueDate')
      .lean();
    const scheduled = tasks.filter(
      (t) => t.plannedStart && t.dueDate && t.dueDate >= t.plannedStart,
    );
    const ids = new Set(scheduled.map((t) => t._id.toString()));
    const entry = {
      _id: new Types.ObjectId(),
      savedAt: clockNow(),
      savedBy: user._id,
      reason: input.reason || null,
      taskCount: scheduled.length,
    };
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (tasks.length) {
          await TaskModel.bulkWrite(
            tasks.map((t) => ({
              updateOne: {
                filter: { _id: t._id },
                update: {
                  $set: {
                    baseline: ids.has(t._id.toString())
                      ? { start: t.plannedStart, finish: t.dueDate }
                      : { start: null, finish: null },
                  },
                },
              },
            })),
            { session },
          );
        }
        await ProjectModel.updateOne(
          { _id: project._id },
          { $push: { timelineBaselines: entry } },
          { session },
        );
        await auditMany(
          [
            {
              actorId: user._id,
              entityType: 'project',
              entityId: project._id,
              projectId: project._id,
              action: 'baseline_saved',
              reason: entry.reason ?? undefined,
              meta: {
                baselineId: entry._id.toString(),
                taskCount: scheduled.length,
                unscheduledCount: tasks.length - scheduled.length,
              },
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    res.status(201).json({
      baseline: {
        id: entry._id.toString(),
        savedAt: entry.savedAt.toISOString(),
        savedBy: { id: user._id.toString(), name: user.name },
        reason: entry.reason,
        taskCount: entry.taskCount,
      },
    });
  });

  p.post('/:id/tasks', perm('tasks', 'create'), async (req, res) => {
    rejectLegacyDeliverable(req);
    const input = parseBody(createTaskSchema, req);
    if (input.emailReturn === 'mobile') useMobileEmailReturn(res, input.code_challenge!);
    const project = await loadProject(req, 'view');
    assertNotArchived(project);
    assertPlanOpen(project);
    if (!isPlanner(currentUser(req), project)) {
      throw forbidden('Only the project manager can add tasks.');
    }
    const _id = new Types.ObjectId();
    const items = newTaskItems(input.deliverableItems ?? [], currentUser(req)._id);
    const add = await prepareMemberAdds(req, project, input);
    await validatePlan(withMembers(project, add), input, { _id, party: input.party });
    const last = await TaskModel.findOne({ projectId: project._id })
      .sort({ order: -1 })
      .select('order')
      .lean();
    const plan = toPlanUpdate(input);
    await resolveTaskPhase(project._id, plan);
    await writeWithMembers(project, add, async (session) => {
      await TaskModel.create(
        [
          {
            _id,
            projectId: project._id,
            order: (last?.order ?? 0) + 1,
            ...plan,
            deliverableItems: items,
            approval: { reviewerId: input.reviewerId ?? null },
          },
        ],
        { session },
      );
    });
    await recomputeProject(project._id);
    await auditMemberAdds(req, project, add, _id);
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'task',
      entityId: _id,
      projectId: project._id,
      action: 'task_created',
    });
    // FR-NTF-05: tell the people given the task.
    const given = [input.ownerId, ...(input.assigneeIds ?? [])].filter((x): x is string =>
      Boolean(x),
    );
    await notifyFresh('ASSIGNED', project._id, _id, currentUser(req)._id, given);
    await respondTask(req, res, project, _id, 201, {
      config,
      people: given,
      optIn: input.emailNewAssignees,
    });
  });

  // Reorder one phase's tasks (Checklist drag-and-drop / Move up/down). Edit on tasks, and only the
  // project's planners (Admin, the managing PM, Q-12). Dependencies are untouched: they use ids.
  p.post('/:id/tasks/reorder', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(reorderTasksSchema, req);
    const project = await loadProject(req, 'view');
    assertNotArchived(project);
    assertPlanOpen(project);
    if (!isPlanner(currentUser(req), project)) {
      throw forbidden('Only the project manager can reorder tasks.');
    }
    const phaseTasks = await TaskModel.find({
      projectId: project._id,
      phase: input.phase === null ? { $in: [null, ''] } : input.phase,
    })
      .select('_id order')
      .sort({ order: 1 })
      .lean();
    const current = phaseTasks.map((t) => t._id.toString());
    const wanted = input.taskIds;
    if (
      new Set(wanted).size !== wanted.length ||
      wanted.length !== current.length ||
      !wanted.every((id) => current.includes(id))
    ) {
      throw conflict('The task list changed. Refresh to see the latest order.', 'ORDER_CHANGED');
    }
    // Reuse the phase's existing order numbers so tasks in other phases keep theirs.
    const slots = phaseTasks.map((t) => t.order);
    const ops = wanted
      .map((id, i) => ({ id, order: slots[i]! }))
      .filter(({ id, order }) => phaseTasks.find((t) => t._id.toString() === id)!.order !== order)
      .map(({ id, order }) => ({
        updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: { order } } },
      }));
    if (ops.length) {
      await TaskModel.bulkWrite(ops);
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'project',
        entityId: project._id,
        projectId: project._id,
        action: 'tasks_reordered',
        meta: { phase: input.phase, taskIds: wanted },
      });
    }
    const tasks = (await TaskModel.find({ projectId: project._id })
      .sort({ order: 1 })
      .lean()) as TaskDoc[];
    res.json({ items: await toTaskDtos(req, project, tasks) });
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
      .select('name managerId memberIds status')
      .lean();
    const projectIds = projects.map((p) => p._id);
    // FR-TSK-25: tasks on On Hold projects are hidden from Today and Due.
    const onHold = new Set(
      projects.filter((p) => p.status === 'ON_HOLD').map((p) => p._id.toString()),
    );
    const active = (t: TaskDoc) => !onHold.has(t.projectId.toString());
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
    const today = todayPH(clockNow());
    const weekEnd = new Date(today.getTime() + 7 * 86_400_000);
    const isOpen = (t: TaskDoc) => (OPEN_TASK_STATUSES as string[]).includes(t.status);
    const isReview = (t: TaskDoc) =>
      t.status === 'FOR_REVIEW' &&
      (Boolean(t.approval?.reviewerId?.equals(user._id)) ||
        managed.some((id) => id.equals(t.projectId)));
    // FR-TSK-20/21/22: Due = my open tasks overdue or due on today's PHILIPPINE date.
    const isDue = (t: TaskDoc) =>
      isMine(user, t) && isOpen(t) && active(t) && Boolean(t.dueDate) && t.dueDate! <= today;
    // FR-TSK-23: Today = Aging + Planned for today, from plannedStart and the due date.
    const sectionOf = (t: TaskDoc) =>
      isMine(user, t) && isOpen(t) && active(t)
        ? todaySection(
            { status: t.status as TaskStatus, plannedStart: t.plannedStart, dueDate: t.dueDate },
            today,
          )
        : null;
    const isToday = (t: TaskDoc) => sectionOf(t) !== null;
    const counts = {
      today: all.filter(isToday).length,
      due: all.filter(isDue).length,
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
      case 'today':
        list = all.filter(isToday);
        break;
      case 'due':
        list = all.filter(isDue);
        break;
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
    // FR-TSK-24: age in working days (Working days setting + holidays).
    const calendar = q.view === 'today' ? await loadCalendar() : null;
    // CR-20 FR-NTF-09..13: follow-up badge counts for the whole list in one query.
    const unseen = await followUpUnseenCounts(user._id, list);
    const items: MyTaskDto[] = list.map((t) => {
      const status = t.status as TaskStatus;
      const overdue = isOverdue({ status, dueDate: t.dueDate }, today);
      const section = q.view === 'today' ? sectionOf(t) : null;
      return {
        id: t._id.toString(),
        name: t.name,
        project: { id: t.projectId.toString(), name: names.get(t.projectId.toString()) ?? '' },
        phase: t.phase ?? null,
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
        plannedStart: dateOrNull(t.plannedStart),
        section,
        ageDays:
          section && t.plannedStart && calendar
            ? workingDaysSince(t.plannedStart, today, calendar)
            : null,
        followUps: (t.followUps ?? []).length,
        followUpsUnseen: unseen.get(t._id.toString()) ?? 0,
      };
    });
    if (q.view === 'today') {
      // Planned for today by planned start; Aging oldest first (earliest planned start).
      items.sort((a, b) => {
        if (a.section !== b.section) return a.section === 'PLANNED' ? -1 : 1;
        if (a.section === 'AGING' && (a.ageDays ?? 0) !== (b.ageDays ?? 0)) {
          return (b.ageDays ?? 0) - (a.ageDays ?? 0);
        }
        return (a.plannedStart ?? '').localeCompare(b.plannedStart ?? '');
      });
    } else
      // Overdue first (most days late first), then by due date (undated last).
      items.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.overdue && b.overdue && a.daysLate !== b.daysLate) return b.daysLate - a.daysLate;
        if (!a.dueDate || !b.dueDate) return a.dueDate ? -1 : b.dueDate ? 1 : 0;
        return a.dueDate.localeCompare(b.dueDate);
      });
    const h = await HolidayModel.findOne({ date: today }).select('name type').lean();
    res.json({
      items,
      counts,
      today: toDateOnly(today),
      holiday: h ? { name: h.name, type: h.type as HolidayType } : null,
    });
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
    rejectLegacyDeliverable(req);
    const input = parseBody(updateTaskSchema, req);
    if (input.emailReturn === 'mobile') useMobileEmailReturn(res, input.code_challenge!);
    const { task, project } = await loadTask(req);
    assertCan(req, project, task.toObject() as TaskDoc, 'plan');
    assertVersion(task, input.version);
    const add = await prepareMemberAdds(req, project, input);
    await validatePlan(withMembers(project, add), input as PlanInput, task.toObject() as TaskDoc);
    const update = toPlanUpdate(input as Record<string, unknown>);
    await resolveTaskPhase(project._id, update);
    assertActualsInOrder(task, update);
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
    await writeWithMembers(project, add, async (session) => {
      const updated = await TaskModel.updateOne(
        { _id: task._id, version: input.version },
        { $set: update, $inc: { version: 1 } },
        { session },
      );
      if (!updated.modifiedCount) assertVersion({ version: -1 }, input.version);
    });
    await recomputeProject(project._id);
    await auditMemberAdds(req, project, add, task._id);
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
    // FR-NTF-05: newly assigned people (new owner or added assignees) are told.
    const before0 = new Set(
      [task.ownerId, ...(task.assigneeIds ?? [])].filter(Boolean).map(String),
    );
    const now = [
      input.ownerId !== undefined ? input.ownerId : task.ownerId?.toString(),
      ...(input.assigneeIds ?? (task.assigneeIds ?? []).map(String)),
    ].filter((x): x is string => Boolean(x) && !before0.has(x as string));
    await notifyFresh('ASSIGNED', project._id, task._id, currentUser(req)._id, now);
    await respondTask(req, res, project, task._id, 200, {
      config,
      people: now,
      optIn: input.emailNewAssignees,
    });
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
          'Upload evidence (a PDF, Word or Excel file) before submitting this task for review.',
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
    const actuals = actualsForStatus(task, from, to, todayPH(clockNow()));
    Object.assign(set, actuals);
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
      changes: [{ field: 'status', old: from, new: to }, ...actualChanges(task, actuals)],
      reason,
      meta: Object.keys(meta).length ? meta : null,
    });
    if (to === 'FOR_REVIEW') {
      // FR-NTF-05: the designated reviewer (or the PM when there is none).
      await notifyFresh('FOR_REVIEW', project._id, task._id, user._id, [
        task.approval?.reviewerId ?? project.managerId,
      ]);
    }
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
    const actuals = actualsForStatus(task, 'BLOCKED', back, todayPH(clockNow()));
    await TaskModel.updateOne(
      { _id: task._id, version },
      {
        $set: { status: back, previousStatus: null, blockerReason: null, ...actuals },
        $inc: { version: 1 },
      },
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
        ...actualChanges(task, actuals),
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
      const actuals = actualsForStatus(task, 'FOR_REVIEW', to, todayPH(clockNow()));
      await TaskModel.updateOne(
        { _id: task._id, version: input.version },
        {
          $set: {
            ...actuals,
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
        changes: [{ field: 'status', old: 'FOR_REVIEW', new: to }, ...actualChanges(task, actuals)],
        reason: input.comment || undefined,
        // EC-20: self-approval is allowed (Q-14) and flagged.
        meta: task.ownerId?.equals(user._id) ? { selfApproval: true } : null,
      });
      await notifyFresh(
        decision === 'approve' ? 'APPROVED' : 'REJECTED',
        project._id,
        task._id,
        user._id,
        [task.ownerId],
      );
      await respondTask(req, res, project, task._id);
    });
  }

  // FR-EVD-01 / AC-39.1: links are no longer accepted as new evidence; files are uploaded via
  // POST /tasks/:id/evidence/uploads (routes/documents.ts). Kept to answer with a clear message.
  r.post('/:id/evidence', perm('tasks', 'edit'), async (req) => {
    await loadTask(req);
    throw unprocessable(
      'Evidence must be an uploaded PDF, Word or Excel file. Links can no longer be added.',
      'EVIDENCE_FILES_ONLY',
    );
  });

  // EC-31: evidence on a Completed task is removed only by the PM/Admin, and audited.
  r.delete('/:id/evidence/:evidenceId', perm('tasks', 'edit'), async (req, res) => {
    const { task, project } = await loadTask(req);
    const t = task.toObject() as TaskDoc;
    assertCan(req, project, t, task.status === 'COMPLETED' ? 'plan' : 'status');
    const evidenceId = idParam(req, 'evidenceId');
    const item = task.evidence.find((e) => e._id.toString() === evidenceId);
    if (!item) throw notFound();
    // FR-EVD-07: files on a task in For Review or Completed stay until the task is reopened.
    if (item.type === 'FILE' && (task.status === 'FOR_REVIEW' || task.status === 'COMPLETED')) {
      throw conflict(
        'This task is in review or completed. Reopen it before removing its evidence.',
        'EVIDENCE_LOCKED',
      );
    }
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
      meta: item.documentId ? { documentId: item.documentId.toString() } : null,
    });
    if (item.documentId) {
      // The file stays in Documents (no hard deletes, FR-DOC-32); it is just unlinked from the task.
      await DocumentModel.updateOne(
        { _id: item.documentId, projectId: project._id },
        {
          $set: { taskId: null },
          $push: {
            events: { event: 'UNLINKED_FROM_TASK', actorId: currentUser(req)._id, at: new Date() },
          },
        },
      );
    }
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
      at: clockNow(),
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
    // FR-NTF-01 / AC-40.1: owner, every assignee, the reviewer and the PM, except the author.
    await notify({
      type: 'FOLLOW_UP',
      project,
      taskId: task._id,
      actorId: currentUser(req)._id,
      recipients: followUpRecipientIds(task, project),
    });
    await respondTask(req, res, project, task._id, 201);
  });

  // CR-20 FR-NTF-09..13: the web calls this when the user opens the task's follow-ups list; every follow-up on
  // the task now counts as seen for them (the badge goes grey). Anyone who can view the task may,
  // archived projects too: it only records what this user has read. Notifications never call it.
  r.post('/:id/follow-ups/seen', perm('tasks', 'view'), async (req, res) => {
    const { task } = await loadTask(req);
    await markFollowUpsSeen(currentUser(req)._id, task);
    res.json({ followUps: task.followUps.length, followUpsUnseen: 0 });
  });

  // M3.5: Admins and the project's PM delete a task only while nothing is recorded under it.
  // Checked and deleted in one transaction, so a time entry logged meanwhile can't be orphaned.
  r.delete('/:id', perm('tasks', 'delete'), async (req, res) => {
    const { task, project } = await loadTask(req);
    assertNotArchived(project);
    assertNotOutsidePm(currentUser(req), project);
    // FR-PRJ-21 (v1.2.5): unattached activities can be deleted at any status (no Completed lock).
    if (!canDeleteTasks(currentUser(req), currentPermissions(req), project)) {
      throw forbidden('Only an Admin or this project’s PM can delete its tasks.');
    }
    const session = await mongoose.startSession();
    let counts: TaskRecordCounts | undefined;
    try {
      await session.withTransaction(async () => {
        counts = (await taskRecordCounts([task._id], session)).get(task._id.toString());
        // FR-PRJ-21: time, evidence, documents, issues → 409 ACTIVITY_IN_USE (Admins too). Nothing
        // is changed or audited.
        const blockedBy = activityBlockedBy(counts ?? {});
        if (blockedBy.length) {
          throw conflictWith(activityInUseMessage(blockedBy), 'ACTIVITY_IN_USE', {
            blockedBy,
            counts,
          });
        }
        // Other records (follow-ups, comments, subtasks) still block as before (M3.5).
        const reason = taskDeleteBlockedReason(counts ?? {});
        if (reason) throw conflictWith(reason, 'TASK_HAS_RECORDS', { counts });
        await TaskModel.updateMany(
          { projectId: project._id, dependsOn: task._id },
          { $pull: { dependsOn: task._id }, $inc: { version: 1 } },
          { session },
        );
        const gone = await TaskModel.deleteOne({ _id: task._id }, { session });
        if (!gone.deletedCount) throw notFound('Task not found');
        // CR-20 FR-TSK-31 (Jomerson Nov 5): renumber the project's remaining tasks 1…n in their
        // current order, so a delete also clears any old gaps or duplicate numbers.
        await renumberProjectTasks(project._id, { session });
      });
    } finally {
      await session.endSession();
    }
    await recomputeProject(project._id);
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'task',
      entityId: task._id,
      projectId: project._id,
      action: 'task_deleted',
      meta: { name: task.name, phase: task.phase ?? null },
    });
    res.status(204).end();
  });

  return [p.router, r.router];
}
