import type { Health, ProjectStatus, Ref } from './projects.js';
import type { JobRole, SystemRole, UserStatus } from './roles.js';

/** API response shapes shared with the web app. */
export interface UserDto {
  id: string;
  name: string;
  email: string;
  systemRole: SystemRole;
  jobRole: JobRole;
  teamIds: string[];
  weeklyCapacityHours: number;
  /** Direct supervisor (doc 14 §5); null = "Supervisor needed" (FR-LV-10). */
  supervisorId: string | null;
  status: UserStatus;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface TeamDto {
  id: string;
  name: string;
  archived: boolean;
  memberCount: number;
}

export interface ClientDto {
  id: string;
  name: string;
  industry: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  contactCount: number;
  /** Projects of this client within the caller's project scope (FR-CLI-12). */
  projectCount: number;
}

export interface ContactDto {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  department: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  /** Open client-party tasks tagged to this contact (FR-CLI-05). */
  pendingCount: number;
  overdueCount: number;
  /** Projects (in the caller's scope) where this contact is active (doc 11 deviation 7, M2). */
  projects?: Ref[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface InviteInfoDto {
  name: string;
  email: string;
  invitedByName: string | null;
  purpose: 'INVITE' | 'RESET';
}

export interface InviteResultDto {
  user: UserDto;
  inviteUrl: string;
  inviteExpiresAt: string;
  /** INVITE for users who haven't set a password yet, RESET for active users. */
  purpose: 'INVITE' | 'RESET';
  /** True when an earlier unused link existed and has now been cancelled. */
  replacedPrevious: boolean;
}

/** A row in Clients › Projects (FR-CLI-11). */
export interface ProjectSummaryDto {
  id: string;
  name: string;
  clientId: string;
  managerName: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  progress: number;
  status: ProjectStatus;
  archived: boolean;
  /** Added in Milestone 2. */
  health?: Health;
  managerId?: string | null;
}

export interface AuditEntryDto {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  entityType: string;
  entityId: string;
  action: string;
  changes: { field: string; old: unknown; new: unknown }[];
  meta: Record<string, unknown> | null;
}
