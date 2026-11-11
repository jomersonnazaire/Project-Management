import { DELIVERABLE_LOCKED_COPY, type PermissionGrid } from '@xc8/shared';
import type { Types } from 'mongoose';
import { conflict } from '../lib/errors.js';
import { unprocessable } from '../lib/http422.js';
import { isPlanner, isProjectPm, type ScopeUser } from './scope.js';

/**
 * CR-23 access rules for the Checklist Excel file (FR-CLX-01, 03) and deliverable items (FR-DLV-02,
 * 03, 06). The API checks these on every request; the DTOs carry the same answers for the UI.
 */
type ProjectLike = Parameters<typeof isPlanner>[1] & {
  archived?: boolean | null;
  status?: string | null;
};

/** A PM who is neither the manager nor on the team list isn't this project's PM (NFR-25). */
const outsidePm = (user: ScopeUser, project: ProjectLike) =>
  user.systemRole === 'PROJECT_MANAGER' && !isProjectPm(user, project);

/**
 * FR-CLX-01: the project's PM and Admins (planners with Edit on tasks) use Excel. AC-75.13: the
 * downloads also work on Completed, Cancelled and archived projects.
 */
export function checklistExcelAllowed(
  user: ScopeUser,
  perms: PermissionGrid,
  project: ProjectLike,
) {
  return perms.tasks.edit && isPlanner(user, project) && !outsidePm(user, project);
}

/** FR-CLX-03 / Q-141: import while Planning, Active or On hold, never on an archived project. */
export const CHECKLIST_IMPORT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD'] as const;
export function checklistImportAllowed(
  user: ScopeUser,
  perms: PermissionGrid,
  project: ProjectLike,
) {
  return (
    checklistExcelAllowed(user, perms, project) &&
    !project.archived &&
    (CHECKLIST_IMPORT_STATUSES as readonly string[]).includes(project.status ?? '')
  );
}

/** FR-DLV-06 / Q-155: Completed, Cancelled and archived projects are read-only for items. */
export function deliverablesLocked(project: ProjectLike) {
  return (
    Boolean(project.archived) || project.status === 'COMPLETED' || project.status === 'CANCELLED'
  );
}

/** The refusal for a locked project: archived 409, Completed / Cancelled 422 (FR-DLV-06). */
export function assertDeliverablesOpen(project: ProjectLike) {
  if (project.archived) throw conflict(DELIVERABLE_LOCKED_COPY.ARCHIVED, 'PROJECT_ARCHIVED');
  if (project.status === 'COMPLETED')
    throw unprocessable(DELIVERABLE_LOCKED_COPY.COMPLETED, 'PROJECT_COMPLETED');
  if (project.status === 'CANCELLED')
    throw unprocessable(DELIVERABLE_LOCKED_COPY.CANCELLED, 'PROJECT_CANCELLED');
}

/**
 * FR-DLV-02/03 (Q-153, Q-166): the task's owner, the project's PM and Admins add, tick, untick,
 * edit, reorder and remove items. Assignees, other Members and Viewers are read-only.
 */
export function deliverablesEditor(
  user: ScopeUser,
  perms: PermissionGrid,
  project: ProjectLike,
  task: { ownerId?: Types.ObjectId | null },
) {
  if (!perms.tasks.edit) return false;
  if (user.systemRole === 'ADMIN') return true;
  if (isProjectPm(user, project)) return true;
  return Boolean(task.ownerId?.equals(user._id));
}

export function canEditDeliverables(
  user: ScopeUser,
  perms: PermissionGrid,
  project: ProjectLike,
  task: { ownerId?: Types.ObjectId | null },
) {
  return !deliverablesLocked(project) && deliverablesEditor(user, perms, project, task);
}

/**
 * CR-23 Q-151 (Jomerson): an Owner email in the Checklist file that matches an ACTIVE user who
 * isn't on the project adds that user to the team on import. Q-168 (Viewers and Admins) is open
 * with Lean: until it closes, this follows FR-PRJ-19 (anyone active joins as an ordinary project
 * member; their app role doesn't change). Change only this function when Q-168 closes.
 */
export function canAutoAddToTeam(user: { active: boolean; systemRole: string }): boolean {
  return user.active && canOwnFromImport(user);
}

/**
 * Lean (2026-11-11): in the Checklist import only, a Viewer named as Owner never owns the task
 * (and isn't added to the team); the row imports without an owner and says so. The task form's
 * owner rule (validatePlan) is unchanged.
 */
export function canOwnFromImport(user: { systemRole: string }): boolean {
  return user.systemRole !== 'VIEWER';
}
