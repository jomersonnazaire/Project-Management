import { z } from 'zod';
import { JOB_ROLES, SYSTEM_ROLES } from './roles.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_POLICY_MESSAGE, isPasswordValid } from './password.js';

/**
 * Request schemas. All objects are strict: unknown fields (e.g. `role`, `isAdmin`,
 * `password` on a contact) are rejected with 400 (NFR-04, TC-K03, EC-22).
 */

const trimmed = (max: number) => z.string().trim().max(max);
const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required.`).max(max);
const optionalText = (max = 2000) => trimmed(max).optional();
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Enter a valid email address.'));

export const optionalEmailSchema = z
  .union([z.literal(''), emailSchema])
  .optional()
  .transform((v) => (v ? v : undefined));

export const newPasswordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH, PASSWORD_POLICY_MESSAGE)
  .refine(isPasswordValid, PASSWORD_POLICY_MESSAGE);

// ---------- Auth ----------
export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(1, 'Email is required.').max(254),
  password: z.string().min(1, 'Password is required.').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const setupPasswordSchema = z.strictObject({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});
export type SetupPasswordInput = z.infer<typeof setupPasswordSchema>;

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: newPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------- Users ----------
export const systemRoleSchema = z.enum(SYSTEM_ROLES, 'Choose an access role.');
export const jobRoleSchema = z.enum(JOB_ROLES, 'Choose a job role.');
const capacitySchema = z.number().min(0).max(80);

export const inviteUserSchema = z.strictObject({
  name: requiredText('Full name', 120),
  email: emailSchema,
  systemRole: systemRoleSchema,
  jobRole: jobRoleSchema,
  teamIds: z.array(objectId).max(50).default([]),
  weeklyCapacityHours: capacitySchema.default(40),
});
export type InviteUserInput = z.input<typeof inviteUserSchema>;

export const updateUserSchema = z
  .strictObject({
    name: requiredText('Full name', 120).optional(),
    systemRole: systemRoleSchema.optional(),
    jobRole: jobRoleSchema.optional(),
    teamIds: z.array(objectId).max(50).optional(),
    weeklyCapacityHours: capacitySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ---------- Teams ----------
export const teamSchema = z.strictObject({ name: requiredText('Team name', 80) });
export type TeamInput = z.infer<typeof teamSchema>;

// ---------- Clients ----------
export const clientSchema = z.strictObject({
  name: requiredText('Client name', 160),
  industry: optionalText(120),
  address: optionalText(500),
  notes: optionalText(2000),
});
export type ClientInput = z.input<typeof clientSchema>;
export const updateClientSchema = clientSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

// ---------- Client contacts (records only: no password, role, or session; FR-CLI-03) ----------
export const contactSchema = z.strictObject({
  name: requiredText('Name', 120),
  department: optionalText(120),
  position: optionalText(120),
  email: optionalEmailSchema,
  phone: optionalText(40),
  notes: optionalText(2000),
});
export type ContactInput = z.input<typeof contactSchema>;
export const updateContactSchema = contactSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

// ---------- Lists ----------
export const listQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: trimmed(100).optional(),
  status: z.string().max(20).optional(),
  role: z.string().max(40).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  clientId: objectId.optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
