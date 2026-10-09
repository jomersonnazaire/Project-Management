import { PM_PROJECT_EDIT_SCOPE, type AccessAction, type SystemRole } from '@xc8/shared';
import type { FilterQuery, Types } from 'mongoose';
import { forbidden, notFound } from '../lib/errors.js';
import { ProjectModel, type Project } from '../models/index.js';

/**
 * Fixed scope limits (FR-ACL-07, A-12). They apply on top of the access rules and no grant in the
 * grid can widen them:
 *   - Members only ever see or act within projects they belong to (and the clients of those projects).
 *   - PMs view all projects but edit and archive only projects they manage (Q-12, resolved;
 *     switch with PM_PROJECT_EDIT_SCOPE in @xc8/shared).
 *   - Only Admins delete projects (Q-26), whatever the grid says.
 *   - Only the project's planners (Admin, or a PM who may edit the project) change the plan:
 *     tasks, dates, estimates, owners and dependencies (FR-TSK-14, AC-10.4).
 * Records outside the caller's scope answer 404, so their existence never leaks (FR-ACL-09).
 */
export interface ScopeUser {
  _id: Types.ObjectId;
  systemRole: string;
}

const role = (u: ScopeUser) => u.systemRole as SystemRole;

/** Mongo filter limiting a projects query to what the user may see. */
export function projectScopeFilter(user: ScopeUser): FilterQuery<Project> {
  return role(user) === 'MEMBER' ? { memberIds: user._id } : {};
}

/**
 * Client ids visible to the user, or `null` for "all clients". Members only see clients of the
 * projects they belong to (07 §4, FR-ACL-07).
 */
export async function visibleClientIds(user: ScopeUser): Promise<Types.ObjectId[] | null> {
  if (role(user) !== 'MEMBER') return null;
  return ProjectModel.distinct('clientId', projectScopeFilter(user));
}

export async function clientInScope(user: ScopeUser, clientId: Types.ObjectId | string) {
  const ids = await visibleClientIds(user);
  return ids === null || ids.some((id) => id.toString() === clientId.toString());
}

interface ProjectLike {
  managerId?: Types.ObjectId | null;
  memberIds?: Types.ObjectId[] | null;
}

export function isProjectMember(user: ScopeUser, project: ProjectLike): boolean {
  return (
    (project.memberIds ?? []).some((id) => id.equals(user._id)) ||
    (project.managerId?.equals(user._id) ?? false)
  );
}

/** True when the fixed scope lets the user edit (and archive) this project (Q-12). */
export function canEditProjectScope(user: ScopeUser, project: ProjectLike): boolean {
  const r = role(user);
  if (r === 'ADMIN') return true;
  if (r === 'PROJECT_MANAGER') {
    return PM_PROJECT_EDIT_SCOPE === 'ALL' || (project.managerId?.equals(user._id) ?? false);
  }
  // Members only within projects they belong to; Viewers never (whatever the grid says).
  return r === 'MEMBER' && isProjectMember(user, project);
}

/**
 * Throws unless the user's fixed scope allows `action` on `project`. Call AFTER the access rules
 * (the central gate) have granted the action, e.g. `projects.edit` for an archive.
 */
export function assertProjectScope(
  user: ScopeUser,
  project: ProjectLike,
  action: AccessAction | 'archive',
): void {
  const r = role(user);
  if (r === 'MEMBER' && !isProjectMember(user, project)) throw notFound();
  if (action === 'delete' && r !== 'ADMIN') throw forbidden();
  if ((action === 'edit' || action === 'archive') && !canEditProjectScope(user, project)) {
    throw forbidden();
  }
}

/**
 * Planners change a project's plan (tasks, dates, estimates, owners, dependencies): Admins, and
 * PMs who may edit the project. Members never plan, even with extra grants (FR-TSK-14).
 */
export function isPlanner(user: ScopeUser, project: ProjectLike): boolean {
  const r = role(user);
  return r === 'ADMIN' || (r === 'PROJECT_MANAGER' && canEditProjectScope(user, project));
}

/**
 * Who may add people to a project's members from the task form (FR-PRJ-19, DEF-003): Admins and
 * PMs who may edit the project (Q-12 scope), with Edit on projects in the access rules.
 */
export function canAddProjectMembers(
  user: ScopeUser,
  perms: { projects: { edit: boolean } },
  project: ProjectLike & { archived?: boolean | null },
): boolean {
  return !project.archived && perms.projects.edit && isPlanner(user, project);
}
