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
  /** Open client-party tasks tagged to this contact (FR-CLI-05). Tasks arrive in a later milestone. */
  pendingCount: number;
  overdueCount: number;
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
