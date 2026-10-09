import type { AccessAction, SystemRole } from '@xc8/shared';
import type { FilterQuery, Types } from 'mongoose';
import { forbidden, notFound } from '../lib/errors.js';
import { ProjectModel, type Project } from '../models/index.js';

/**
 * Fixed scope limits (FR-ACL-07, A-12). They apply on top of the access rules and no grant in the
 * grid can widen them:
 *   - Members only ever see or act within projects they belong to (and the clients of those projects).
 *   - PMs edit and archive only projects they manage (Q-12 still open; until then "manage" = managerId).
 *   - Only Admins delete projects (Q-26), whatever the grid says.
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
  const isMember = (project.memberIds ?? []).some((id) => id.equals(user._id));
  const isManager = project.managerId?.equals(user._id) ?? false;
  if (r === 'MEMBER' && !isMember && !isManager) throw notFound();
  if (action === 'delete' && r !== 'ADMIN') throw forbidden();
  if (r === 'PROJECT_MANAGER' && (action === 'edit' || action === 'archive') && !isManager) {
    throw forbidden();
  }
}
