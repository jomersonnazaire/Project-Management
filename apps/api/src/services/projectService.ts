import {
  computeProject,
  scheduleFromOffsets,
  DEFAULT_CALENDAR,
  type WorkCalendar,
  todayPH,
  toDateOnly,
  type ActiveContactDto,
  canViewProjectActivity,
  type Health,
  type SystemRole,
  type PermissionGrid,
  type ProjectDto,
  type ProjectListItemDto,
  type ProjectStatus,
  type TaskStatus,
  type TemplateType,
  type UserRefDto,
} from '@xc8/shared';
import { Types, type ClientSession } from 'mongoose';
import {
  ClientContactModel,
  ClientModel,
  ProjectModel,
  TaskModel,
  UserModel,
  type Project,
  type Template,
} from '../models/index.js';
import { canAddProjectMembers, canEditProjectScope, isPlanner, type ScopeUser } from './scope.js';

type Id = Types.ObjectId;
export type ProjectDoc = Project & { _id: Id; createdAt?: Date; updatedAt?: Date };

export const dateOrNull = (d?: Date | null) => (d ? toDateOnly(d) : null);

/** Refreshes the stored progress, forecast, variance and health of a project (NFR-13). */
export async function recomputeProject(projectId: Id | string, session?: ClientSession) {
  const project = await ProjectModel.findById(projectId).session(session ?? null);
  if (!project) return;
  const tasks = await TaskModel.find({ projectId: project._id })
    .select('status mandatory plannedStart dueDate')
    .session(session ?? null)
    .lean();
  const baselineEnd = project.plannedEndDate ?? todayPH();
  const c = computeProject(
    project.status as ProjectStatus,
    baselineEnd,
    tasks.map((t) => ({ ...t, status: t.status as TaskStatus })),
    todayPH(),
  );
  await ProjectModel.updateOne(
    { _id: project._id },
    {
      $set: {
        progress: c.progressPct,
        'computed.forecastEnd': c.forecastEnd,
        'computed.scheduleVarianceDays': c.scheduleVarianceDays,
        'computed.health': c.health,
        'computed.updatedAt': new Date(),
      },
    },
    { session },
  );
}

export async function userRefs(ids: (Id | null | undefined)[]): Promise<Map<string, UserRefDto>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await UserModel.find({ _id: { $in: unique } })
    .select('name email active')
    .lean();
  return new Map(
    users.map((u) => [
      u._id.toString(),
      { id: u._id.toString(), name: u.name, email: u.email, active: Boolean(u.active) },
    ]),
  );
}

/** Rows for project lists, with client and manager names resolved in two queries. */
export async function toProjectListItems(projects: ProjectDoc[]): Promise<ProjectListItemDto[]> {
  const [clients, users, counts] = await Promise.all([
    ClientModel.find({ _id: { $in: projects.map((p) => p.clientId) } })
      .select('name')
      .lean(),
    userRefs(projects.map((p) => p.managerId)),
    TaskModel.aggregate<{ _id: Id; n: number; unestimated: number }>([
      { $match: { projectId: { $in: projects.map((p) => p._id) } } },
      {
        $group: {
          _id: '$projectId',
          n: { $sum: 1 },
          unestimated: { $sum: { $cond: [{ $isNumber: '$estHours' }, 0, 1] } },
        },
      },
    ]),
  ]);
  const clientNames = new Map(clients.map((c) => [c._id.toString(), c.name]));
  const taskCounts = new Map(counts.map((c) => [c._id.toString(), c]));
  return projects.map((p) => {
    const manager = p.managerId ? users.get(p.managerId.toString()) : undefined;
    return {
      id: p._id.toString(),
      name: p.name,
      clientId: p.clientId.toString(),
      clientName: clientNames.get(p.clientId.toString()) ?? '',
      managerId: p.managerId ? p.managerId.toString() : null,
      managerName: manager?.name ?? null,
      startDate: dateOrNull(p.startDate),
      plannedEndDate: dateOrNull(p.plannedEndDate),
      forecastEnd: dateOrNull(p.computed?.forecastEnd ?? p.plannedEndDate),
      scheduleVarianceDays: p.computed?.scheduleVarianceDays ?? 0,
      progress: p.progress ?? 0,
      status: (p.status ?? 'ACTIVE') as ProjectStatus,
      health: (p.status === 'ON_HOLD' ? 'ON_HOLD' : (p.computed?.health ?? 'ON_TRACK')) as Health,
      archived: Boolean(p.archived),
      templateName: p.templateSnapshot?.name ?? null,
      templateVersion: p.templateSnapshot?.version ?? null,
      taskCount: taskCounts.get(p._id.toString())?.n ?? 0,
      unestimatedTaskCount: taskCounts.get(p._id.toString())?.unestimated ?? 0,
    };
  });
}

export async function toProjectDto(
  project: ProjectDoc,
  user: ScopeUser,
  perms: PermissionGrid,
): Promise<ProjectDto> {
  const [item] = await toProjectListItems([project]);
  const ids = [project.managerId, ...(project.memberIds ?? [])];
  const users = await userRefs(ids);
  const contacts = await ClientContactModel.find({ _id: { $in: project.activeContactIds ?? [] } })
    .select('name position email phone active')
    .sort({ name: 1 })
    .lean();
  const activeContacts: ActiveContactDto[] = contacts.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    position: c.position ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    active: Boolean(c.active),
  }));
  const editScope = canEditProjectScope(user, project);
  return {
    ...item!,
    description: project.description ?? null,
    type: (project.type ?? null) as TemplateType | null,
    manager: project.managerId ? (users.get(project.managerId.toString()) ?? null) : null,
    members: (project.memberIds ?? [])
      .map((id) => users.get(id.toString()))
      .filter((u): u is UserRefDto => Boolean(u))
      .sort((a, b) => a.name.localeCompare(b.name)),
    activeContacts,
    templateId: project.templateSnapshot?.templateId?.toString() ?? null,
    baselineHistory: (project.baselineHistory ?? []).map((b) => ({
      startDate: dateOrNull(b.startDate),
      plannedEndDate: dateOrNull(b.plannedEndDate),
      reason: b.reason ?? '',
      changedAt: (b.changedAt ?? new Date()).toISOString(),
      changedBy: b.changedBy ? b.changedBy.toString() : null,
    })),
    can: {
      edit: perms.projects.edit && editScope,
      archive: perms.projects.edit && editScope,
      delete: perms.projects.delete && user.systemRole === 'ADMIN',
      planTasks: perms.tasks.edit && isPlanner(user, project),
      addMembers: canAddProjectMembers(user, perms, project),
      activity: canViewProjectActivity(user.systemRole as SystemRole, perms),
    },
  };
}

/**
 * Tasks generated from a template version (FR-PRJ-02/03): one per activity, in order, dates from
 * the baseline start + working-day offsets, estimates copied (null stays null, EC-58), and
 * dependencies re-pointed at the new task ids.
 */
export function buildPlanTasks(
  template: Pick<Template, 'phases' | 'activities'>,
  projectId: Types.ObjectId,
  start: Date,
  calendar: WorkCalendar = DEFAULT_CALENDAR,
) {
  const phaseNames = new Map(template.phases.map((p) => [p.id, p.name]));
  const taskIds = new Map(template.activities.map((a) => [a.id, new Types.ObjectId()]));
  return template.activities.map((a, i) => {
    const { plannedStart, dueDate } = scheduleFromOffsets(
      start,
      a.offsetDays ?? 0,
      a.durationDays ?? 1,
      calendar,
    );
    return {
      _id: taskIds.get(a.id)!,
      projectId,
      templateActivityId: a.id,
      order: i + 1,
      name: a.name,
      phase: phaseNames.get(a.phaseId) ?? null,
      taskType: a.taskType ?? null,
      priority: a.priority,
      mandatory: Boolean(a.mandatory),
      party: a.party,
      teamId: a.defaultTeamId ?? null,
      plannedStart,
      dueDate,
      estHours: typeof a.estHours === 'number' ? a.estHours : null,
      dependsOn: (a.dependsOn ?? []).map((d) => taskIds.get(d)!).filter(Boolean),
      deliverable: a.deliverable ?? null,
      requiresApproval: Boolean(a.requiresApproval),
      isMilestone: Boolean(a.isMilestone),
    };
  });
}
