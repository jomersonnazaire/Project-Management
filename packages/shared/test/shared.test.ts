import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCESS_RULES,
  RECORD_TYPE_KEYS,
  SYSTEM_ROLES,
  actionApplies,
  effectivePermissions,
  gridsEqual,
  hasPermission,
  isLockedOff,
  isLockedOn,
  setGrant,
  validatePermissionGrid,
  type AccessAction,
  type RecordType,
  type SystemRole,
  checkPassword,
  contactSchema,
  inviteTokenSchema,
  inviteUserSchema,
  isPasswordValid,
  loginSchema,
} from '../src/index.js';

describe('access rules defaults and fixed rules (doc 11 §3, §6)', () => {
  const g = (role: SystemRole) => DEFAULT_ACCESS_RULES[role];
  const spec = (row: Record<AccessAction, boolean>) =>
    (row.view ? 'V' : '') +
    (row.create ? 'C' : '') +
    (row.edit ? 'E' : '') +
    (row.delete ? 'D' : '');

  it('has the 14 record types of §3 plus M3 conversations and notifications and M3.5 issues, in order', () => {
    expect(RECORD_TYPE_KEYS).toEqual([
      'users',
      'teams',
      'settings',
      'accessRules',
      'clients',
      'contacts',
      'templates',
      'projects',
      'tasks',
      'approvals',
      'time',
      'documents',
      'issues',
      'conversations',
      'notifications',
      'reports',
      'audit',
    ]);
  });

  it('seeds the §6 matrix (equal to the M1 fixed rules)', () => {
    const table: Record<string, [string, string, string, string]> = {
      users: ['VCED', '', '', ''],
      teams: ['VCED', '', '', ''],
      settings: ['VE', '', '', ''],
      accessRules: ['VE', '', '', ''],
      clients: ['VCED', 'VCED', 'V', 'V'],
      contacts: ['VCED', 'VCED', 'V', 'V'],
      templates: ['VCED', 'VCED', 'V', 'V'],
      projects: ['VCED', 'VCE', 'V', 'V'],
      tasks: ['VCED', 'VCED', 'VE', 'V'],
      approvals: ['E', 'E', 'E', ''],
      time: ['VCED', 'VCED', 'VCED', ''],
      documents: ['VCED', 'VCED', 'VC', 'V'],
      issues: ['VCED', 'VCE', 'VCE', 'V'],
      conversations: ['VC', 'VC', 'VC', 'V'],
      notifications: ['V', 'V', 'V', 'V'],
      reports: ['V', 'V', 'V', 'V'],
      audit: ['V', '', '', ''],
    };
    for (const [record, expected] of Object.entries(table)) {
      const got = SYSTEM_ROLES.map((r) => spec(g(r)[record as RecordType]));
      expect([record, ...got]).toEqual([record, ...expected]);
    }
  });

  it('defaults pass their own validation and equal the effective grid', () => {
    for (const role of SYSTEM_ROLES) {
      expect(validatePermissionGrid(role, g(role))).toEqual([]);
      expect(effectivePermissions(role, null)).toEqual(g(role));
    }
  });

  it('n/a actions are never granted, even if stored', () => {
    const eff = effectivePermissions('ADMIN', {
      settings: { create: true, delete: true },
      approvals: { view: true },
      audit: { edit: true, delete: true },
    });
    expect(eff.settings).toMatchObject({ create: false, delete: false });
    expect(eff.approvals.view).toBe(false);
    expect(eff.audit).toEqual({ view: true, create: false, edit: false, delete: false });
    expect(actionApplies('reports', 'edit')).toBe(false);
  });

  it('FR-ACL-05 locks Admin users/accessRules on; Q-26 locks project delete off for non-Admins', () => {
    const eff = effectivePermissions('ADMIN', {
      users: { view: false, create: false, edit: false, delete: false },
      accessRules: { view: false, edit: false },
    });
    expect(eff.users).toEqual({ view: true, create: true, edit: true, delete: true });
    expect(eff.accessRules).toMatchObject({ view: true, edit: true });
    const bad = validatePermissionGrid('ADMIN', {
      ...g('ADMIN'),
      users: { view: true, create: true, edit: true, delete: false },
    });
    expect(bad).toEqual([
      expect.objectContaining({ code: 'LOCKED_PERMISSION', path: 'users.delete' }),
    ]);
    for (const role of ['PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const) {
      expect(isLockedOff(role, 'projects', 'delete')).toBe(true);
      expect(effectivePermissions(role, { projects: { delete: true } }).projects.delete).toBe(
        false,
      );
    }
    expect(isLockedOn('PROJECT_MANAGER', 'users', 'view')).toBe(false);
  });

  it('FR-ACL-04 Create/Edit/Delete imply View', () => {
    const grid = setGrant(g('VIEWER'), 'teams', 'edit', true);
    expect(grid.teams).toMatchObject({ view: true, edit: true });
    const issues = validatePermissionGrid('VIEWER', {
      ...g('VIEWER'),
      teams: { view: false, create: false, edit: true, delete: false },
    });
    expect(issues.map((i) => i.code)).toEqual(['VIEW_REQUIRED']);
    // Approvals has no View, so Edit alone is valid there.
    expect(validatePermissionGrid('MEMBER', g('MEMBER'))).toEqual([]);
    expect(hasPermission(g('MEMBER'), 'approvals', 'edit')).toBe(true);
    expect(hasPermission(null, 'reports', 'view')).toBe(false);
    expect(gridsEqual(g('ADMIN'), effectivePermissions('ADMIN', {}))).toBe(true);
  });
});

describe('password policy (FR-AUTH-02, mockup v0.4)', () => {
  it('requires 8+ chars, a number and a symbol', () => {
    expect(isPasswordValid('short1!')).toBe(false); // 7 chars
    expect(isPasswordValid('Short1!x')).toBe(true); // exactly 8
    expect(isPasswordValid('abcdefg1')).toBe(false); // no symbol
    expect(isPasswordValid('abcdefg!')).toBe(false); // no number
    expect(isPasswordValid('longpassword!!')).toBe(false);
    expect(isPasswordValid('longpassword12')).toBe(false);
    expect(isPasswordValid('Long-password-12')).toBe(true);
    expect(checkPassword('abc').map((c) => c.ok)).toEqual([false, false, false]);
  });
});

describe('schemas (NFR-04)', () => {
  it('rejects unknown fields and operator objects on login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x', role: 'ADMIN' }).success).toBe(
      false,
    );
    expect(loginSchema.safeParse({ email: { $ne: null }, password: 'x' }).success).toBe(false);
  });

  it('normalises email to lowercase', () => {
    const r = inviteUserSchema.parse({
      name: 'A. Reyes',
      email: ' AReyes@Xceler8.Example ',
      systemRole: 'MEMBER',
      jobRole: 'DEVELOPER',
    });
    expect(r.email).toBe('areyes@xceler8.example');
    expect(r.weeklyCapacityHours).toBe(40);
  });

  it('rejects password or role on a client contact (EC-22)', () => {
    expect(contactSchema.safeParse({ name: 'R. Santos', password: 'x' }).success).toBe(false);
    expect(contactSchema.safeParse({ name: 'R. Santos', systemRole: 'ADMIN' }).success).toBe(false);
    expect(contactSchema.safeParse({ name: 'R. Santos', email: 'bad' }).success).toBe(false);
    expect(contactSchema.safeParse({ name: 'R. Santos', email: '' }).success).toBe(true);
  });

  it('accepts only a token string in the invite verify body (FR-AUTH-04/05)', () => {
    const token = 'a'.repeat(43);
    expect(inviteTokenSchema.safeParse({ token }).success).toBe(true);
    expect(inviteTokenSchema.safeParse({}).success).toBe(false);
    expect(inviteTokenSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(inviteTokenSchema.safeParse({ token: { $ne: null } }).success).toBe(false);
    expect(inviteTokenSchema.safeParse({ token, password: 'x' }).success).toBe(false);
  });
});

describe('M3.5 task and phase delete messages', () => {
  it('says what blocks it, in plain words', async () => {
    const { taskDeleteBlockedReason, phaseDeleteBlockedReason } = await import('../src/index.js');
    expect(taskDeleteBlockedReason({})).toBeNull();
    expect(taskDeleteBlockedReason({ timeEntries: 3 })).toBe(
      'This task has 3 time entries; remove them first.',
    );
    expect(taskDeleteBlockedReason({ followUps: 1 })).toBe(
      'This task has 1 follow-up; remove it first.',
    );
    expect(taskDeleteBlockedReason({ timeEntries: 1, comments: 2, issues: 1 })).toBe(
      'This task has 1 time entry, 2 comments and 1 linked issue; remove them first.',
    );
    expect(phaseDeleteBlockedReason(0, 0)).toBeNull();
    expect(phaseDeleteBlockedReason(1, 4)).toBe('This phase has 1 task; delete or move it first.');
  });
});
