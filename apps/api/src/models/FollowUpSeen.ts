import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * CR-20 FR-NTF-09..13 (follow-up badge): when a user last opened a task's follow-ups list. One row per user
 * and task; follow-ups added after `seenAt` by someone else count as new for that user. A
 * notification alone never writes here.
 */
const followUpSeenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    /** The newest follow-up on the task when the list was opened (or the time, if none). */
    seenAt: { type: Date, required: true },
  },
  { strict: 'throw', collection: 'followUpSeen', versionKey: false },
);
followUpSeenSchema.index({ userId: 1, taskId: 1 }, { unique: true });
followUpSeenSchema.index({ taskId: 1 });

export type FollowUpSeen = InferSchemaType<typeof followUpSeenSchema>;
export const FollowUpSeenModel = model('FollowUpSeen', followUpSeenSchema);

/**
 * CR-20 (Lean, Nov 5): app-wide settings written once. `followUpSeenCutoff` is the moment the
 * follow-up badge first went live: follow-ups posted before it count as seen for everyone, so no
 * per-user rows need backfilling.
 */
const appMarkerSchema = new Schema(
  {
    _id: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { strict: 'throw', collection: 'appMarkers', versionKey: false },
);
export const AppMarkerModel = model('AppMarker', appMarkerSchema);
export const FOLLOW_UP_SEEN_CUTOFF = 'followUpSeenCutoff';
