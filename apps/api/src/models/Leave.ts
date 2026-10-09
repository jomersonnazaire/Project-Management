import { DAY_PARTS, LEAVE_STATUSES, LEAVE_UNITS } from '@xc8/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';

const ObjectId = Schema.Types.ObjectId;

/** Admin-defined leave types (FR-LV-01). Deactivated, never deleted. */
const leaveTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true },
    paid: { type: Boolean, required: true },
    unit: { type: String, enum: LEAVE_UNITS, required: true },
    needsDocument: { type: Boolean, default: false },
    carryOverLimit: { type: Number, default: null },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, strict: 'throw', collection: 'leaveTypes', versionKey: false },
);
leaveTypeSchema.index({ nameKey: 1 }, { unique: true });
export type LeaveType = InferSchemaType<typeof leaveTypeSchema>;
export const LeaveTypeModel = model('LeaveType', leaveTypeSchema);

/** Yearly entitlement per user and type, with carry-over (FR-LV-02). */
const leaveEntitlementSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    leaveTypeId: { type: ObjectId, ref: 'LeaveType', required: true },
    year: { type: Number, required: true },
    days: { type: Number, required: true, min: 0 },
    carryOver: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, strict: 'throw', collection: 'leaveEntitlements', versionKey: false },
);
leaveEntitlementSchema.index({ userId: 1, leaveTypeId: 1, year: 1 }, { unique: true });
export const LeaveEntitlementModel = model('LeaveEntitlement', leaveEntitlementSchema);

/**
 * A recorded leave (Q-46: no approval). `dates` are the working dates it covers (EC-78);
 * `days` and `byYear` are what it deducts (FR-LV-02, FR-LV-11).
 */
const leaveSchema = new Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    leaveTypeId: { type: ObjectId, ref: 'LeaveType', required: true },
    dayPart: { type: String, enum: DAY_PARTS, required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    dates: { type: [Date], default: [] },
    days: { type: Number, required: true },
    byYear: {
      type: [new Schema({ year: Number, days: Number }, { _id: false })],
      default: [],
    },
    reason: { type: String, default: null, maxlength: 500 },
    status: { type: String, enum: LEAVE_STATUSES, default: 'RECORDED' },
    recordedBy: { type: ObjectId, ref: 'User', required: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'leaves', versionKey: false },
);
leaveSchema.index({ userId: 1, status: 1, from: 1, to: 1 });
export type Leave = InferSchemaType<typeof leaveSchema>;
export const LeaveModel = model('Leave', leaveSchema);
