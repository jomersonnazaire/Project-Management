import type { Health, ProjectStatus, Ref } from './projects.js';
import type { JobRole, SystemRole, UserStatus } from './roles.js';

/** API response shapes shared with the web app. */
export interface UserDto {
  id: string;
  name: string;
  email: string;
  systemRole: SystemRole;
  jobRole: JobRole | null;
  teamIds: string[];
  weeklyCapacityHours: number;
  /** Direct supervisor (doc 14 §5); null = "Supervisor needed" (FR-LV-10). */
  supervisorId: string | null;
  /** Report CC emails (FR-DAR-01), Admin-managed. */
  reportCc: string[];
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

/** GET /auth/me/email-status: can the signed-in user send action emails from their Outlook? */
export interface EmailStatusDto {
  /** False while the feature flag is off: the UI shows no email option at all. */
  enabled: boolean;
  /** True when the user's account is linked to Microsoft, so they can send from Outlook. */
  linked: boolean;
}

/**
 * How an action email started with a save went (`email` on the create/update project response).
 * `url` is the Microsoft consent page to continue to; otherwise `error` says why not. The save
 * itself and its in-app notifications always went through.
 */
export interface ActionEmailStartDto {
  url: string | null;
  error: 'EMAIL_DISABLED' | 'MICROSOFT_NOT_LINKED' | 'NO_RECIPIENTS' | null;
  message: string | null;
  recipients: number;
}

/** Shown next to the disabled "Email {name}" checkbox for unlinked users (Lean, 2026-10-20). */
export const ACTION_EMAIL_NOT_LINKED = 'Link your Microsoft account to send emails.';

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
  /** NFR-29: client IP and user agent of the request; only sent to Admins, null for system jobs. */
  ip?: string | null;
  userAgent?: string | null;
}

/** NFR-28: the actor shown for system-made changes (e.g. the 11:59 PM auto-stop). */
export const SYSTEM_ACTOR = { id: 'system', name: 'System' } as const;
