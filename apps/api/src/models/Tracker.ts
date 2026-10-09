import { LOOKUP_KINDS } from '@xc8/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';

const ObjectId = Schema.Types.ObjectId;

/**
 * Admin-editable lists (doc 14 FR-ACT-15, -17, FR-DAR-09): Activity types, Locations, Modules.
 * In-use values are deactivated, never deleted, so past entries keep their label.
 */
const lookupSchema = new Schema(
  {
    kind: { type: String, enum: LOOKUP_KINDS, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** Lower-case name, unique per kind. */
    nameKey: { type: String, required: true },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'lookups', versionKey: false },
);
lookupSchema.index({ kind: 1, nameKey: 1 }, { unique: true });
export type Lookup = InferSchemaType<typeof lookupSchema>;
export const LookupModel = model('Lookup', lookupSchema);

/**
 * One user's day in the tracker (FR-ACT-12, -17): the day's location and the submit state.
 * `unlockedPastLock` is set when an Admin reopens a day that is past the weekly lock.
 */
const timesheetDaySchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    locationId: { type: ObjectId, ref: 'Lookup', default: null },
    status: { type: String, enum: ['OPEN', 'SUBMITTED', 'REOPENED'], default: 'OPEN' },
    submittedAt: { type: Date, default: null },
    unlockedPastLock: { type: Boolean, default: false },
    reopened: {
      type: [
        new Schema(
          {
            by: { type: ObjectId, ref: 'User', required: true },
            at: { type: Date, required: true },
            reason: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /** Last change to any entry of the day (DAR saved-copy staleness, FR-DAR-13). */
    changedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'timesheetDays', versionKey: false },
);
timesheetDaySchema.index({ userId: 1, date: 1 }, { unique: true });
export type TimesheetDay = InferSchemaType<typeof timesheetDaySchema>;
export const TimesheetDayModel = model('TimesheetDay', timesheetDaySchema);
