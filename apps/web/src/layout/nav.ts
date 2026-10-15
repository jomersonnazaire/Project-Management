import {
  hasPermission,
  myTasksTabsFor,
  type AccessAction,
  type PermissionGrid,
  type RecordType,
} from '@xc8/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Not built yet in this milestone; shown disabled so the shell matches mockup v0.4. */
  soon?: boolean;
  /** Shown when the role has any of these permissions (doc 11; the API enforces them). */
  any?: [RecordType, AccessAction][];
}

export const MAIN: NavItem[] = [
  // FR-TSK-29: hidden when no My tasks tab is allowed (see visibleItems).
  { to: '/my-tasks', label: 'My tasks', icon: 'bx-check' },
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: 'bx-grid-alt',
    any: [['reports', 'view']],
  },
  { to: '/projects', label: 'Projects', icon: 'bx-briefcase', any: [['projects', 'view']] },
  { to: '/board', label: 'Task board', icon: 'bx-columns', any: [['tasks', 'view']] },
  { to: '/issues', label: 'All issues', icon: 'bx-flag', any: [['issues', 'view']] },
  { to: '/time', label: 'Time logging', icon: 'bx-time-five', any: [['time', 'view']] },
  {
    to: '/dar',
    label: 'Daily Accomplishment Report',
    icon: 'bx-envelope',
    any: [['activities', 'view']],
  },
  {
    to: '/dar/saved',
    label: 'My saved reports',
    icon: 'bx-archive',
    any: [['activities', 'view']],
  },
  { to: '/leave', label: 'Leave', icon: 'bx-sun', any: [['leave', 'view']] },
];

export const SETUP: NavItem[] = [
  {
    to: '/templates',
    label: 'Templates',
    icon: 'bx-book-content',
    any: [['templates', 'view']],
  },
  { to: '/clients', label: 'Clients', icon: 'bx-buildings', any: [['clients', 'view']] },
  { to: '/workload', label: 'Team & workload', icon: 'bx-group', any: [['workload', 'view']] },
  { to: '/reports', label: 'Reports', icon: 'bx-bar-chart-alt-2', any: [['reports', 'view']] },
  {
    to: '/admin',
    label: 'Admin',
    icon: 'bx-cog',
    any: [
      ['users', 'view'],
      ['teams', 'view'],
      ['settings', 'view'],
    ],
  },
  {
    to: '/access-rules',
    label: 'Access rules',
    icon: 'bx-shield-quarter',
    any: [['accessRules', 'view']],
  },
];

/** Sidebar items the grid allows (FR-NAV-01; My tasks needs at least one tab, FR-TSK-29). */
export function visibleItems(items: NavItem[], permissions: PermissionGrid | null | undefined) {
  return items.filter((i) =>
    i.to === '/my-tasks'
      ? myTasksTabsFor(permissions).length > 0
      : !i.any || i.any.some(([r, a]) => hasPermission(permissions, r, a)),
  );
}

/** FR-TSK-29: where sign-in lands when My tasks is hidden: the first page allowed, in sidebar order. */
export function firstAllowedPath(permissions: PermissionGrid | null | undefined): string | null {
  return visibleItems([...MAIN, ...SETUP], permissions)[0]?.to ?? null;
}
