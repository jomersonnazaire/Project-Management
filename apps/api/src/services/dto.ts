import type {
  ClientDto,
  ContactDto,
  ProjectStatus,
  ProjectSummaryDto,
  TeamDto,
  UserDto,
  UserStatus,
} from '@xc8/shared';
import type { Types } from 'mongoose';

type Id = Types.ObjectId;

interface UserLike {
  _id: Id;
  name: string;
  email: string;
  systemRole: UserDto['systemRole'];
  jobRole: UserDto['jobRole'];
  teamIds?: Id[] | null;
  weeklyCapacityHours?: number | null;
  supervisorId?: Id | null;
  active?: boolean | null;
  mustChangePassword?: boolean | null;
  passwordHash?: string | null;
  lastLoginAt?: Date | null;
  createdAt?: Date | null;
}

export function userStatus(u: {
  active?: boolean | null;
  passwordHash?: string | null;
}): UserStatus {
  if (!u.active) return 'DEACTIVATED';
  return u.passwordHash ? 'ACTIVE' : 'INVITED';
}

/** `u.passwordHash` is only used to derive status; the hash itself is never returned. */
export function toUserDto(u: UserLike): UserDto {
  return {
    id: u._id.toString(),
    name: u.name,
    email: u.email,
    systemRole: u.systemRole,
    jobRole: u.jobRole,
    teamIds: (u.teamIds ?? []).map((t) => t.toString()),
    weeklyCapacityHours: u.weeklyCapacityHours ?? 40,
    supervisorId: u.supervisorId ? u.supervisorId.toString() : null,
    status: userStatus(u),
    active: Boolean(u.active),
    mustChangePassword: Boolean(u.mustChangePassword),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: (u.createdAt ?? new Date()).toISOString(),
  };
}

export function toTeamDto(
  t: { _id: Id; name: string; archived?: boolean | null },
  memberCount = 0,
): TeamDto {
  return { id: t._id.toString(), name: t.name, archived: Boolean(t.archived), memberCount };
}

export function toClientDto(
  c: {
    _id: Id;
    name: string;
    industry?: string | null;
    address?: string | null;
    notes?: string | null;
    active?: boolean | null;
  },
  contactCount = 0,
  projectCount = 0,
): ClientDto {
  return {
    id: c._id.toString(),
    name: c.name,
    industry: c.industry ?? null,
    address: c.address ?? null,
    notes: c.notes ?? null,
    active: Boolean(c.active),
    contactCount,
    projectCount,
  };
}

export function toContactDto(
  c: {
    _id: Id;
    clientId: Id;
    name: string;
    department?: string | null;
    position?: string | null;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
    active?: boolean | null;
  },
  clientName: string,
): ContactDto {
  return {
    id: c._id.toString(),
    clientId: c.clientId.toString(),
    clientName,
    name: c.name,
    department: c.department ?? null,
    position: c.position ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    notes: c.notes ?? null,
    active: Boolean(c.active),
    pendingCount: 0,
    overdueCount: 0,
  };
}

export function toProjectSummaryDto(
  p: {
    _id: Id;
    name: string;
    clientId: Id;
    startDate?: Date | null;
    plannedEndDate?: Date | null;
    progress?: number | null;
    status?: string | null;
    archived?: boolean | null;
  },
  managerName: string | null,
): ProjectSummaryDto {
  return {
    id: p._id.toString(),
    name: p.name,
    clientId: p.clientId.toString(),
    managerName,
    startDate: p.startDate ? p.startDate.toISOString() : null,
    plannedEndDate: p.plannedEndDate ? p.plannedEndDate.toISOString() : null,
    progress: p.progress ?? 0,
    status: (p.status ?? 'ACTIVE') as ProjectStatus,
    archived: Boolean(p.archived),
  };
}
