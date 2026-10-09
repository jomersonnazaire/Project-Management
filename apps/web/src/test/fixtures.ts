import {
  DEFAULT_ACCESS_RULES,
  type AccessRulesDto,
  type ClientDto,
  type ContactDto,
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
