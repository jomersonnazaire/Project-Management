import { MODULE_MAX, MODULE_TOO_LONG, type TimeType } from '@xc8/shared';

export interface EntryFieldValues {
  activityTypeId: string;
  /** Free text (FR-ACT-20). */
  module: string;
  /** '' = the day's location (FR-ACT-17). */
  locationId: string;
  billable: boolean;
  type: TimeType;
  notes: string;
}

export const emptyFields = (kind: 'TASK' | 'QUICK'): EntryFieldValues => ({
  activityTypeId: '',
  module: '',
  locationId: '',
  billable: kind === 'TASK',
  type: 'EXECUTION',
  notes: '',
});

/** Client-side checks matching the API (FR-ACT-15 Activity type; FR-ACT-20 Module ≤ 100). */
export function fieldErrors(v: EntryFieldValues, _kind: 'TASK' | 'QUICK') {
  const e: Record<string, string> = {};
  if (!v.activityTypeId) e.activityTypeId = 'Choose an activity type.';
  if (v.module.trim().length > MODULE_MAX) e.module = MODULE_TOO_LONG;
  return e;
}

/** The API body for the fields, for a new entry or an edit. */
export function fieldsBody(v: EntryFieldValues, kind: 'TASK' | 'QUICK') {
  return {
    activityTypeId: v.activityTypeId,
    module: v.module.trim() || null,
    locationId: v.locationId || null,
    billable: v.billable,
    ...(kind === 'TASK' ? { type: v.type } : {}),
    notes: v.notes.trim() || null,
  };
}
