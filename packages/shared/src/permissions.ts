import type { SystemRole } from './roles.js';

/**
 * Permission matrix for the actions that exist in Milestone 1 (07 §4).
 * The API enforces these in middleware; the web app only uses them to hide controls.
 */
export const PERMISSIONS = {
  /** Manage users, roles, teams, settings */
  'users:manage': ['ADMIN'],
  'teams:manage': ['ADMIN'],
  'settings:manage': ['ADMIN'],
  /** Read the team list (needed to show team names) */
  'teams:read': ['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'],
  /** Manage clients and client contacts */
  'clients:manage': ['ADMIN', 'PROJECT_MANAGER'],
  /**
   * View all clients and contacts. Members may only view clients of their own projects
   * (07 §4); projects arrive in a later milestone, so Members currently see none.
   */
  'clients:read:all': ['ADMIN', 'PROJECT_MANAGER', 'VIEWER'],
} as const satisfies Record<string, readonly SystemRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: SystemRole | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly SystemRole[]).includes(role);
}
