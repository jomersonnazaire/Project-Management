import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * CR-24 FR-CNV-10 (A-64): when a user last read a project's Conversation. One row per user and
 * project, written with `$max` so a stale request never moves it back. Other people's messages
 * after `lastReadAt` (and after the release cutoff) count as unread. Not `followUpSeen`.
 */
const conversationReadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    lastReadAt: { type: Date, required: true },
  },
  { strict: 'throw', collection: 'conversationRead', versionKey: false },
);
conversationReadSchema.index({ userId: 1, projectId: 1 }, { unique: true });

export type ConversationRead = InferSchemaType<typeof conversationReadSchema>;
export const ConversationReadModel = model('ConversationRead', conversationReadSchema);

/** Q-170: `appMarkers` id for the moment Conversation unread went live (not followUpSeenCutoff). */
export const CONVERSATION_READ_CUTOFF = 'conversationReadCutoff';
