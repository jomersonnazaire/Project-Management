import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Append-only audit trail (FR-AUD-01/03). No route updates or deletes these entries.
 */
const activityLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, required: true },
    changes: {
      type: [
        new Schema(
          { field: String, old: Schema.Types.Mixed, new: Schema.Types.Mixed },
          { _id: false },
        ),
      ],
      default: [],
    },
    reason: { type: String, default: null },
    /** Structured context, e.g. `{ role, recordType, permission }` for access rule changes. */
    meta: { type: Schema.Types.Mixed, default: null },
    at: { type: Date, default: () => new Date() },
  },
  { strict: 'throw', collection: 'activityLogs', versionKey: false },
);

activityLogSchema.index({ projectId: 1, at: -1 });
activityLogSchema.index({ entityType: 1, entityId: 1 });

export type ActivityLog = InferSchemaType<typeof activityLogSchema>;
export const ActivityLogModel = model('ActivityLog', activityLogSchema);
