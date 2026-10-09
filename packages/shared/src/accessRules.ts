import { z } from 'zod';
import { SYSTEM_ROLES, type SystemRole } from './roles.js';

/**
 * Access rules (doc 11, Milestone 1.5). Permissions are set per Access role × record type ×
 * action. The API enforces them on every request; the web app only uses them to hide controls.
 * Record type keys are shared by the API and the web app so they stay in step (doc 11 §8).
 */
export const ACCESS_ACTIONS = ['view', 'create', 'edit', 'delete'] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export const ACCESS_ACTION_LABELS: Record<AccessAction, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
};

export interface RecordTypeInfo {
  key: string;
  label: string;
  /** Actions that exist for this record type; the others are "n/a" in the grid. */
  actions: readonly AccessAction[];
  notes?: string;
}

const ALL = ACCESS_ACTIONS;
const VIEW_EDIT = ['view', 'edit'] as const;
const VIEW_ONLY = ['view'] as const;
const EDIT_ONLY = ['edit'] as const;

/** The 14 record types of doc 11 §3, in grid order. */
export const RECORD_TYPES = [
  {
    key: 'users',
    label: 'Users & invites',
    actions: ALL,
    notes: 'Includes invite and reset links',
  },
  { key: 'teams', label: 'Teams', actions: ALL },
  { key: 'settings', label: 'Settings', actions: VIEW_EDIT },
  { key: 'accessRules', label: 'Access rules', actions: VIEW_EDIT, notes: 'This screen' },
  { key: 'clients', label: 'Clients', actions: ALL },
  { key: 'contacts', label: 'Client contacts', actions: ALL },
  { key: 'templates', label: 'Templates', actions: ALL, notes: 'Publish counts as Edit' },
  {
    key: 'projects',
    label: 'Projects',
    actions: ALL,
    notes: 'Includes plan, dates, owners, dependencies, active contacts',
  },
  { key: 'tasks', label: 'Tasks', actions: ALL, notes: 'Includes status, evidence, notes' },
  {
    key: 'approvals',
    label: 'Task approvals',
    actions: EDIT_ONLY,
    notes: 'Only Edit applies (approve/reject)',
  },
  { key: 'time', label: 'Time entries', actions: ALL },
  {
    key: 'documents',
    label: 'Documents & folders',
    actions: ALL,
    notes: 'Signed versions stay locked regardless',
  },
  { key: 'reports', label: 'Reports & dashboard', actions: VIEW_ONLY },
  {
    key: 'audit',
    label: 'Audit log',
    actions: VIEW_ONLY,
    notes: 'Never editable or deletable by anyone',
  },
] as const satisfies readonly RecordTypeInfo[];

export type RecordType = (typeof RECORD_TYPES)[number]['key'];
export const RECORD_TYPE_KEYS = RECORD_TYPES.map((r) => r.key) as RecordType[];

const RECORD_INFO = new Map<string, RecordTypeInfo>(RECORD_TYPES.map((r) => [r.key, r]));

export function recordTypeInfo(key: RecordType): RecordTypeInfo {
  return RECORD_INFO.get(key)!;
}

export function isRecordType(key: string): key is RecordType {
  return RECORD_INFO.has(key);
}

/** True when the action exists for the record type (e.g. Delete on Settings doesn't). */
export function actionApplies(record: RecordType, action: AccessAction): boolean {
  return (RECORD_INFO.get(record)?.actions ?? []).includes(action);
}

export type ActionGrants = Record<AccessAction, boolean>;
export type PermissionGrid = Record<RecordType, ActionGrants>;
export type AccessRulesByRole = Record<SystemRole, PermissionGrid>;

function grants(spec: string): ActionGrants {
  return {
    view: spec.includes('V'),
    create: spec.includes('C'),
    edit: spec.includes('E'),
    delete: spec.includes('D'),
  };
}

/**
 * Seeded defaults: today's fixed matrix (doc 11 §6, doc 07 §4). Scope limits apply on top and
 * are fixed in code (FR-ACL-07): Members only within their projects, PMs edit only projects
 * they manage. Projects: PM gets VCE and archives (archive counts as Edit); only Admins delete (Q-26).
 */
const DEFAULT_SPEC: Record<SystemRole, Record<RecordType, string>> = {
  ADMIN: {
    users: 'VCED',
    teams: 'VCED',
    settings: 'VE',
    accessRules: 'VE',
    clients: 'VCED',
    contacts: 'VCED',
    templates: 'VCED',
    projects: 'VCED',
    tasks: 'VCED',
    approvals: 'E',
    time: 'VCED',
    documents: 'VCED',
    reports: 'V',
    audit: 'V',
  },
  PROJECT_MANAGER: {
    users: '',
    teams: '',
    settings: '',
    accessRules: '',
    clients: 'VCED',
    contacts: 'VCED',
    templates: 'VCED',
    projects: 'VCE',
    tasks: 'VCED',
    approvals: 'E',
    time: 'VCED',
    documents: 'VCED',
    reports: 'V',
    audit: '',
  },
  MEMBER: {
    users: '',
    teams: '',
    settings: '',
    accessRules: '',
    clients: 'V',
    contacts: 'V',
    templates: 'V',
    projects: 'V',
    tasks: 'VE',
    approvals: 'E',
    time: 'VCE',
    documents: 'VC',
    reports: 'V',
    audit: '',
  },
  VIEWER: {
    users: '',
    teams: '',
    settings: '',
    accessRules: '',
    clients: 'V',
    contacts: 'V',
    templates: 'V',
    projects: 'V',
    tasks: 'V',
    approvals: '',
    time: '',
    documents: 'V',
    reports: 'V',
    audit: '',
  },
};

function buildGrid(spec: Record<RecordType, string>): PermissionGrid {
  return Object.fromEntries(RECORD_TYPE_KEYS.map((k) => [k, grants(spec[k])])) as PermissionGrid;
}

export function defaultPermissions(role: SystemRole): PermissionGrid {
  return buildGrid(DEFAULT_SPEC[role]);
}

export const DEFAULT_ACCESS_RULES: AccessRulesByRole = Object.fromEntries(
  SYSTEM_ROLES.map((r) => [r, defaultPermissions(r)]),
) as AccessRulesByRole;

/**
 * Safety rule 1 (FR-ACL-05): Admin's access to Users and Access rules is locked on so nobody
 * can lock every Admin out. The API refuses changes with 422.
 */
export const LOCKED_ADMIN_RECORDS: readonly RecordType[] = ['users', 'accessRules'];

export function isLockedOn(role: SystemRole, record: RecordType, action: AccessAction): boolean {
  return role === 'ADMIN' && LOCKED_ADMIN_RECORDS.includes(record) && actionApplies(record, action);
}

/** Q-26: only Admins delete projects (PMs archive instead). Fixed in code, can't be granted. */
export function isLockedOff(role: SystemRole, record: RecordType, action: AccessAction): boolean {
  return role !== 'ADMIN' && record === 'projects' && action === 'delete';
}

export const LOCKED_ON_REASON = 'Locked so nobody can lock every Admin out';
export const LOCKED_OFF_REASON = 'Only Admins can delete projects (Q-26)';
export const NOT_APPLICABLE_REASON = "Doesn't apply to this record type";

/** Read-only "Scope (fixed)" column: limits fixed in code that a grant can never widen (FR-ACL-07). */
export const FIXED_SCOPES: Partial<Record<SystemRole, Partial<Record<RecordType, string>>>> = {
  PROJECT_MANAGER: {
    projects: 'Edit and archive only projects they manage',
    approvals: 'Own projects only',
  },
  MEMBER: {
    clients: 'Clients of projects they belong to',
    contacts: 'Clients of projects they belong to',
    projects: 'Only projects they belong to',
    tasks: 'Own tasks only',
    approvals: 'Designated reviewer only',
    time: 'Own entries only',
    documents: 'Projects they belong to',
  },
};

/**
 * The permissions that actually apply: stored values, with fixed rules on top
 * (n/a actions off, locked cells forced, Create/Edit/Delete imply View).
 */
export function effectivePermissions(
  role: SystemRole,
  stored?: Partial<Record<string, Partial<ActionGrants> | undefined>> | null,
): PermissionGrid {
  const defaults = defaultPermissions(role);
  const out = {} as PermissionGrid;
  for (const record of RECORD_TYPE_KEYS) {
    const row = {} as ActionGrants;
    for (const action of ACCESS_ACTIONS) {
      let v: boolean;
      if (!actionApplies(record, action)) v = false;
      else if (isLockedOn(role, record, action)) v = true;
      else if (isLockedOff(role, record, action)) v = false;
      else v = stored?.[record]?.[action] ?? defaults[record][action];
      row[action] = Boolean(v);
    }
    if (actionApplies(record, 'view') && (row.create || row.edit || row.delete)) row.view = true;
    out[record] = row;
  }
  return out;
}

export function hasPermission(
  grid: PermissionGrid | null | undefined,
  record: RecordType,
  action: AccessAction,
): boolean {
  return Boolean(grid?.[record]?.[action]);
}

// ---------- Validation of a change (UI and API share it) ----------

export interface AccessRuleIssue {
  code:
    | 'UNKNOWN_RECORD_TYPE'
    | 'UNKNOWN_ACTION'
    | 'NOT_APPLICABLE'
    | 'LOCKED_PERMISSION'
    | 'VIEW_REQUIRED';
  path: string;
  message: string;
}

/**
 * Checks a full grid that is about to be saved for `role`. Returns an empty list when valid.
 */
export function validatePermissionGrid(role: SystemRole, grid: PermissionGrid): AccessRuleIssue[] {
  const issues: AccessRuleIssue[] = [];
  for (const record of RECORD_TYPE_KEYS) {
    const row = grid[record];
    for (const action of ACCESS_ACTIONS) {
      const path = `${record}.${action}`;
      const v = Boolean(row?.[action]);
      if (!actionApplies(record, action)) {
        if (v)
          issues.push({
            code: 'NOT_APPLICABLE',
            path,
            message: `${ACCESS_ACTION_LABELS[action]} doesn't apply to ${recordTypeInfo(record).label}.`,
          });
      } else if (isLockedOn(role, record, action) && !v) {
        issues.push({
          code: 'LOCKED_PERMISSION',
          path,
          message: `Admin access to ${recordTypeInfo(record).label} is locked so nobody can lock every Admin out.`,
        });
      } else if (isLockedOff(role, record, action) && v) {
        issues.push({ code: 'LOCKED_PERMISSION', path, message: LOCKED_OFF_REASON + '.' });
      }
    }
    if (actionApplies(record, 'view') && !row?.view && (row?.create || row?.edit || row?.delete)) {
      issues.push({
        code: 'VIEW_REQUIRED',
        path: `${record}.view`,
        message: 'View is included in Create, Edit and Delete. Untick those first.',
      });
    }
  }
  return issues;
}

/** Ticking Create/Edit/Delete ticks View (FR-ACL-04). Returns a new grid. */
export function setGrant(
  grid: PermissionGrid,
  record: RecordType,
  action: AccessAction,
  value: boolean,
): PermissionGrid {
  const row = { ...grid[record], [action]: value };
  if (value && action !== 'view' && actionApplies(record, 'view')) row.view = true;
  return { ...grid, [record]: row };
}

export function gridsEqual(a: PermissionGrid, b: PermissionGrid): boolean {
  return RECORD_TYPE_KEYS.every((r) => ACCESS_ACTIONS.every((x) => a[r][x] === b[r][x]));
}

// ---------- Request / response shapes ----------

const grantsPatch = z.record(z.string(), z.unknown());

/**
 * PUT /access-rules/:role body. Record types and actions are checked by the route so that unknown
 * keys answer 422 (EC-57). Any subset of record types may be sent; the rest stay as they are.
 */
export const updateAccessRulesSchema = z.strictObject({
  version: z.number().int().min(0),
  permissions: z.record(z.string(), grantsPatch),
});
export type UpdateAccessRulesInput = {
  version: number;
  permissions: Partial<Record<RecordType, Partial<ActionGrants>>>;
};

export const resetAccessRulesSchema = z.strictObject({ version: z.number().int().min(0) });

export interface AccessRulesDto {
  role: SystemRole;
  permissions: PermissionGrid;
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export interface MyPermissionsDto {
  role: SystemRole;
  permissions: PermissionGrid;
}
