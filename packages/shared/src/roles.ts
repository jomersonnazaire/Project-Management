/**
 * Access (system) roles decide what a user can do (FR-USR-02, 07 §4).
 * Job roles only describe what a user does and never grant permissions (FR-USR-03).
 */
export const SYSTEM_ROLES = ['ADMIN', 'PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const SYSTEM_ROLE_LABELS: Record<SystemRole, string> = {
  ADMIN: 'Admin',
  PROJECT_MANAGER: 'Project Manager',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

export const JOB_ROLES = [
  'CONSULTANT',
  'DEVELOPER',
  'RESEARCHER_BA',
  'SUPPORT',
  'QA_TESTER',
  'TECHNICAL_DATA',
  'PROJECT_MANAGER',
] as const;
export type JobRole = (typeof JOB_ROLES)[number];

export const JOB_ROLE_LABELS: Record<JobRole, string> = {
  CONSULTANT: 'Consultant',
  DEVELOPER: 'Developer',
  RESEARCHER_BA: 'Researcher / BA',
  SUPPORT: 'Support',
  QA_TESTER: 'QA / Tester',
  TECHNICAL_DATA: 'Technical / Data Specialist',
  PROJECT_MANAGER: 'Project Manager',
};

export type UserStatus = 'ACTIVE' | 'INVITED' | 'DEACTIVATED';

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Active',
  INVITED: 'Invited',
  DEACTIVATED: 'Deactivated',
};
