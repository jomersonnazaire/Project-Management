import { z } from 'zod';
import type { Ref } from './projects.js';

/**
 * Project types (doc 14 v1.1.1 FR-PTY-01..07): an Admin list (Admin › Settings › Project types,
 * gated by the `settings` access row like the other Admin lists). Each type may name a default
 * Activity type that Time in preselects on that project's tasks.
 */
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.');

export const PROJECT_TYPE_NAME_MAX = 50;
export const PROJECT_TYPE_REQUIRED = 'Choose a project type.';
export const PROJECT_TYPE_DUPLICATE = 'A project type with this name already exists.';
export const PROJECT_TYPE_TOO_LONG = 'Keep the name under 50 characters.';
export const PROJECT_TYPE_INACTIVE_HINT = 'This type is no longer offered for new projects.';
export const PROJECT_TYPE_NOT_SET = 'Not set';
export const PROJECT_TYPE_INACTIVE_PICK = 'This project type is inactive. Choose an active one.';
export const projectTypeHint = (name: string) => `From project type: ${name}. You can change it.`;
export const projectTypeDeadDefaultHint = (activity: string, type: string) =>
  `${activity}, the default activity type for ${type}, is no longer offered. Choose one.`;
export const projectTypeInUseMessage = (name: string, n: number) =>
  `"${name}" is used by ${n} ${n === 1 ? 'project' : 'projects'}, so it can't be deleted. Deactivate it instead.`;

/** Trimmed, inner whitespace collapsed (the duplicate check ignores case and extra spaces). */
export const normalizeProjectTypeName = (v: string) => v.trim().replace(/\s+/g, ' ');
export const projectTypeNameKey = (v: string) => normalizeProjectTypeName(v).toLowerCase();

const nameField = z
  .string()
  .transform(normalizeProjectTypeName)
  .pipe(z.string().min(1, 'Add a name.').max(PROJECT_TYPE_NAME_MAX, PROJECT_TYPE_TOO_LONG));

export const projectTypeSchema = z.strictObject({
  name: nameField,
  defaultActivityTypeId: objectId.nullable().optional(),
});
export type ProjectTypeInput = z.input<typeof projectTypeSchema>;

export const updateProjectTypeSchema = z
  .strictObject({
    name: nameField.optional(),
    defaultActivityTypeId: objectId.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');
export type UpdateProjectTypeInput = z.input<typeof updateProjectTypeSchema>;

export interface ProjectTypeDto {
  id: string;
  name: string;
  active: boolean;
  /** The default Activity type; `active` false shows it as "(inactive)" and Time in skips it. */
  defaultActivityType: (Ref & { active: boolean }) | null;
  /** Projects using it (Admin list only; null on the picker list). */
  usedBy: number | null;
  deactivatedAt: string | null;
  deactivatedBy: Ref | null;
  createdAt: string;
}

/** A project's type as shown on project screens (current name, read by ID: FR-PTY-06). */
export interface ProjectTypeRefDto extends Ref {
  active: boolean;
}

/**
 * Time in / + Add entry preselect for a project task (FR-PTY-04). `activityType` is null when the
 * project has no type, the type has no default, or the default is inactive (`inactiveDefault`).
 */
export interface ProjectTypePreselectDto {
  projectName: string;
  projectType: ProjectTypeRefDto | null;
  activityType: Ref | null;
  /** The default activity type's name when it exists but is inactive (hint only). */
  inactiveDefault: string | null;
}

/** Q-51 seed: the nine starting types and their default Activity type (matched by name). */
export const DEFAULT_PROJECT_TYPES: { name: string; activity: string }[] = [
  { name: 'Implementation', activity: 'Configuration' },
  { name: 'Integration', activity: 'Integration' },
  { name: 'Configuration', activity: 'Configuration' },
  { name: 'Development', activity: 'Development' },
  { name: 'Support', activity: 'Support' },
  { name: 'Upgrade', activity: 'Configuration' },
  { name: 'Migration', activity: 'Data migration' },
  { name: 'Training', activity: 'Training' },
  { name: 'Consulting', activity: 'Client meeting' },
];
