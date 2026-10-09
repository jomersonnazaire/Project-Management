import {
  DEFAULT_ACCESS_RULES,
  type AccessRulesDto,
  type ClientDto,
  type ContactDto,
  type DashboardDto,
  type IssueSummaryDto,
  type PermissionGrid,
  type SystemRole,
  type UserDto,
} from '@xc8/shared';

export const makeUser = (over: Partial<UserDto> = {}): UserDto => ({
  id: 'u1',
  name: 'Maria Member',
  email: 'member@xceler8.example',
  systemRole: 'MEMBER',
  jobRole: 'CONSULTANT',
  teamIds: [],
  weeklyCapacityHours: 40,
  status: 'ACTIVE',
  active: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

export function meBody(role: SystemRole, permissions?: PermissionGrid) {
  return {
    user: makeUser({ id: `me-${role}`, name: `Me ${role}`, systemRole: role }),
    permissions: permissions ?? structuredClone(DEFAULT_ACCESS_RULES[role]),
  };
}

export const ACME: ClientDto = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  name: 'Acme Trading Corp.',
  industry: 'Retail',
  address: null,
  notes: null,
  active: true,
  contactCount: 2,
  projectCount: 0,
};

export const contact = (over: Partial<ContactDto> = {}): ContactDto => ({
  id: 'c1',
  clientId: ACME.id,
  clientName: ACME.name,
  name: 'R. Santos',
  department: 'Finance',
  position: 'Finance Manager',
  email: 'rsantos@acme.example',
  phone: '+63 917 555 0101',
  notes: null,
  active: true,
  pendingCount: 0,
  overdueCount: 0,
  ...over,
});

export function rulesBody(version = 1): { roles: AccessRulesDto[] } {
  return {
    roles: (Object.keys(DEFAULT_ACCESS_RULES) as SystemRole[]).map((role) => ({
      role,
      permissions: structuredClone(DEFAULT_ACCESS_RULES[role]),
      version,
      updatedAt: null,
      updatedBy: null,
    })),
  };
}

export const emptyIssueSummary = (): IssueSummaryDto => ({
  open: 0,
  overdue: 0,
  bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  byStage: { BEFORE_GO_LIVE: 0, AFTER_GO_LIVE: 0 },
  avgDaysToResolve: null,
  resolvedCount: 0,
  perClient: [],
});

/** An empty M4 dashboard body (FR-DASH-01..06). */
export const emptyDashboard = (over: Partial<DashboardDto> = {}): DashboardDto => ({
  kpis: {
    activeProjects: 0,
    delayedProjects: 0,
    overdueTasks: 0,
    overdueWaitingOnClient: 0,
    hoursThisWeek: 0,
    teamUtilizationPct: null,
  },
  activeProjects: [],
  waitingOnClient: [],
  upcomingMilestones: [],
  issues: emptyIssueSummary(),
  myProjects: false,
  ...over,
});
