import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  can,
  checkPassword,
  contactSchema,
  inviteTokenSchema,
  inviteUserSchema,
  isPasswordValid,
  loginSchema,
} from '../src/index.js';

describe('permissions (07 §4, NFR-22)', () => {
  it('only Admin manages users, teams and settings', () => {
    for (const role of SYSTEM_ROLES) {
      expect(can(role, 'users:manage')).toBe(role === 'ADMIN');
      expect(can(role, 'teams:manage')).toBe(role === 'ADMIN');
      expect(can(role, 'settings:manage')).toBe(role === 'ADMIN');
    }
  });

  it('Admin and PM manage clients; Viewer views all; Member does not view all', () => {
    expect(can('ADMIN', 'clients:manage')).toBe(true);
    expect(can('PROJECT_MANAGER', 'clients:manage')).toBe(true);
    expect(can('MEMBER', 'clients:manage')).toBe(false);
    expect(can('VIEWER', 'clients:manage')).toBe(false);
    expect(can('VIEWER', 'clients:read:all')).toBe(true);
    expect(can('MEMBER', 'clients:read:all')).toBe(false);
  });

  it('denies unknown or missing roles', () => {
    expect(can(undefined, 'teams:read')).toBe(false);
    expect(can(null, 'teams:read')).toBe(false);
    expect(Object.keys(PERMISSIONS).length).toBeGreaterThan(0);
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
