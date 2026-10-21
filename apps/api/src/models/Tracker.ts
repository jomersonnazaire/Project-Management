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
    /** Stable key for system values (doc 14 FR-ACT-32: `quick_activity`); null for Admin-made ones. */
    key: { type: String, default: null },
    /** System values can't be renamed, deactivated or deleted (NFR-31). */
    system: { type: Boolean, default: false },
  },
  { timestamps: true, strict: 'throw', collection: 'lookups', versionKey: false },
);
lookupSchema.index({ kind: 1, nameKey: 1 }, { unique: true });
lookupSchema.index(
  { kind: 1, key: 1 },
  { unique: true, partialFilterExpression: { key: { $type: 'string' } } },
);
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

/**
 * A saved Daily Accomplishment Report (doc 14 §15, FR-DAR-11 to -16): a read-only copy of exactly
 * what the preview showed. Private to the saver; never updated or deleted.
 */
const savedReportSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true, immutable: true },
    from: { type: String, required: true, immutable: true },
    to: { type: String, required: true, immutable: true },
    savedAt: { type: Date, required: true, immutable: true },
    totalActivities: { type: Number, required: true, immutable: true },
    totalMinutes: { type: Number, required: true, immutable: true },
    /** The DarReportDto as rendered at save time. */
    report: { type: Schema.Types.Mixed, required: true, immutable: true },
    /**
     * Last successful DAR Send (Graph sendMail accepted it). Not part of the snapshot: a
     * re-send overwrites these; a failed send never touches them. Older documents lack them.
     */
    sentAt: { type: Date, default: null },
    sentBy: { type: ObjectId, ref: 'User', default: null },
    /** To + CC count of that send (addresses stay in the audit log only). */
    sentRecipientCount: { type: Number, default: null },
  },
  { strict: 'throw', collection: 'savedReports', versionKey: false },
);
savedReportSchema.index({ userId: 1, savedAt: -1 });
savedReportSchema.index({ userId: 1, from: 1, to: 1, savedAt: -1 });
export type SavedReport = InferSchemaType<typeof savedReportSchema>;
export const SavedReportModel = model('SavedReport', savedReportSchema);
