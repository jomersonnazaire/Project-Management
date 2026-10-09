import { PARTIES, PRIORITIES, TASK_STATUSES } from '@xc8/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';

/** Project tasks (FR-TSK-01..14, 07 §2). `version` gives optimistic concurrency (EC-18). */
const taskSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    templateActivityId: { type: String, default: null },
    order: { type: Number, default: 0 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    phase: { type: String, default: null },
    taskType: { type: String, default: null },
    priority: { type: String, enum: PRIORITIES, default: 'MEDIUM' },
    mandatory: { type: Boolean, default: false },
    party: { type: String, enum: PARTIES, default: 'INTERNAL' },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    assigneeIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [], index: true },
    clientContactId: {
      type: Schema.Types.ObjectId,
      ref: 'ClientContact',
      default: null,
      index: true,
    },
    plannedStart: { type: Date, default: null },
    dueDate: { type: Date, default: null, index: true },
    /** null = no estimate (EC-58), never 0. */
    estHours: { type: Number, min: 0, default: null },
    /** Denormalized sum of time entries; time logging arrives in Milestone 3. */
    actualHours: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: TASK_STATUSES, default: 'TODO' },
    previousStatus: { type: String, enum: [...TASK_STATUSES, null], default: null },
    dependsOn: { type: [Schema.Types.ObjectId], ref: 'Task', default: [] },
    deliverable: { type: String, default: null },
    blockerReason: { type: String, default: null },
    requiresApproval: { type: Boolean, default: false },
    approval: {
      type: new Schema(
        {
          state: {
            type: String,
            enum: ['NONE', 'PENDING', 'APPROVED', 'REJECTED'],
            default: 'NONE',
          },
          reviewerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          decidedAt: { type: Date, default: null },
          comment: { type: String, default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    evidence: {
      type: [
        new Schema({
          type: { type: String, enum: ['LINK'], default: 'LINK' },
          name: String,
          url: String,
          addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          at: { type: Date, default: () => new Date() },
        }),
      ],
      default: [],
    },
    followUps: {
      type: [
        new Schema({
          authorId: { type: Schema.Types.ObjectId, ref: 'User' },
          contactId: { type: Schema.Types.ObjectId, ref: 'ClientContact', default: null },
          note: String,
          at: { type: Date, default: () => new Date() },
        }),
      ],
      default: [],
    },
    isMilestone: { type: Boolean, default: false },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, strict: 'throw', collection: 'tasks', versionKey: false },
);
taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ projectId: 1, order: 1 });

export type Task = InferSchemaType<typeof taskSchema>;
export const TaskModel = model('Task', taskSchema);
