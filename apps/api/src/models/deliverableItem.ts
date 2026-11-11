import { Schema } from 'mongoose';

/**
 * CR-23 B2 (FR-DLV-01 to 05): one deliverable checklist item, a subdocument on a task and on a
 * template activity (A-58). No max length here: the 200-character cap applies to typed text only
 * (NFR-56), and migrated or template-copied text is kept in full (Q-160).
 */
export const deliverableItemSchema = new Schema({
  text: { type: String, required: true, trim: true },
  done: { type: Boolean, default: false },
  /** Who ticked it; null when unticked, migrated, or ticked from a file (FR-DLV-11). */
  doneBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  doneAt: { type: Date, default: null },
  /** FR-DLV-11: ticked by a Checklist import ("Done · from import, {date}"). */
  doneViaImport: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  /** Null for migrated and template-copied items (no original author). */
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: () => new Date() },
});
