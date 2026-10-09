import type { TimeType } from '@xc8/shared';

export interface EntryFieldValues {
  activityTypeId: string;
  moduleId: string;
  /** '' = the day's location (FR-ACT-17). */
  locationId: string;
  billable: boolean;
  type: TimeType;
  notes: string;
}

export const emptyFields = (kind: 'TASK' | 'QUICK'): EntryFieldValues => ({
  activityTypeId: '',
  moduleId: '',
  locationId: '',
  billable: kind === 'TASK',
  type: 'EXECUTION',
  notes: '',
});

/** Client-side checks matching the API (FR-ACT-15: Activity type always; Module on project tasks). */
export function fieldErrors(v: EntryFieldValues, kind: 'TASK' | 'QUICK') {
  const e: Record<string, string> = {};
  if (!v.activityTypeId) e.activityTypeId = 'Choose an activity type.';
  if (kind === 'TASK' && !v.moduleId) e.moduleId = 'Choose a module.';
  return e;
}

/** The API body for the fields, for a new entry or an edit. */
export function fieldsBody(v: EntryFieldValues, kind: 'TASK' | 'QUICK') {
  return {
    activityTypeId: v.activityTypeId,
    moduleId: v.moduleId || null,
    locationId: v.locationId || null,
    billable: v.billable,
    ...(kind === 'TASK' ? { type: v.type } : {}),
    notes: v.notes.trim() || null,
  };
}
