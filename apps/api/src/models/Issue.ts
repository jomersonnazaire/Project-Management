import { ISSUE_CATEGORIES, ISSUE_SEVERITIES, ISSUE_STAGES, ISSUE_STATUSES } from '@xc8/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';

const { ObjectId } = Schema.Types;

/**
 * Project issues (doc 13 §3). `number` is the project's running number (never reused); `key` is
 * the display id, e.g. ACME-SAP-ISS-012. `version` increments on every change so two people
 * changing the status at once get a 409 (EC-70). Only Admins delete (FR-ISS-15).
 */
const issueSchema = new Schema(
  {
    projectId: { type: ObjectId, ref: 'Project', required: true },
    number: { type: Number, required: true },
    key: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, required: true, maxlength: 10_000 },
    stage: { type: String, enum: ISSUE_STAGES, required: true },
    category: { type: String, enum: ISSUE_CATEGORIES, default: 'OTHER' },
    severity: { type: String, enum: ISSUE_SEVERITIES, required: true },
    status: { type: String, enum: ISSUE_STATUSES, default: 'OPEN' },
    reportedById: { type: ObjectId, ref: 'User', required: true },
    reportedByContactId: { type: ObjectId, ref: 'ClientContact', default: null },
    ownerId: { type: ObjectId, ref: 'User', default: null },
    dueDate: { type: Date, default: null },
    /** True once someone set the due date by hand: a severity change then keeps it (FR-ISS-05). */
    dueManual: { type: Boolean, default: false },
    taskIds: { type: [ObjectId], ref: 'Task', default: [] },
    messageIds: { type: [ObjectId], ref: 'Message', default: [] },
    attachments: {
      type: [
        new Schema(
          {
            documentId: { type: ObjectId, ref: 'Document', required: true },
            name: { type: String, required: true },
            size: { type: Number, required: true },
            mimeType: { type: String, required: true },
            uploadedBy: { type: ObjectId, ref: 'User', required: true },
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    resolution: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: ObjectId, ref: 'User', default: null },
    closedReason: { type: String, default: null },
    /** Last daily overdue reminder sent to the owner (Philippine date, FR-ISS-10). */
    remindedOn: { type: Date, default: null },
    version: { type: Number, default: 1 },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  { strict: 'throw', collection: 'issues', versionKey: false, timestamps: true },
);
issueSchema.index({ projectId: 1, number: 1 }, { unique: true });
issueSchema.index({ projectId: 1, status: 1, dueDate: 1 });
issueSchema.index({ status: 1, dueDate: 1 });
issueSchema.index({ ownerId: 1, status: 1 });
issueSchema.index({ taskIds: 1 });

export type Issue = InferSchemaType<typeof issueSchema>;
export const IssueModel = model('Issue', issueSchema);

/** Issue comments (FR-ISS-07): plain text, permanent; no route edits or deletes them. */
const issueCommentSchema = new Schema(
  {
    issueId: { type: ObjectId, ref: 'Issue', required: true, index: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    authorId: { type: ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 5000 },
    createdAt: { type: Date, default: () => new Date() },
  },
  { strict: 'throw', collection: 'issueComments', versionKey: false },
);
export type IssueComment = InferSchemaType<typeof issueCommentSchema>;
export const IssueCommentModel = model('IssueComment', issueCommentSchema);
