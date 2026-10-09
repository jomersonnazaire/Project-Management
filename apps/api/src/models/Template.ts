import { JOB_ROLES, PARTIES, PRIORITIES, TEMPLATE_STATUSES, TEMPLATE_TYPES } from '@xc8/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Implementation templates (FR-TPL-01..10, 07 §2). One document per version: `templateKey` stays
 * the same across versions. Editing a Published version creates a Draft of v+1; publishing it marks
 * the previous published version `superseded` (read-only, still linked to its projects).
 */
const phaseSchema = new Schema(
  { id: { type: String, required: true }, name: { type: String, required: true, trim: true } },
  { _id: false },
);

const activitySchema = new Schema(
  {
    id: { type: String, required: true },
    phaseId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    taskType: { type: String, default: null },
    priority: { type: String, enum: PRIORITIES, default: 'MEDIUM' },
    mandatory: { type: Boolean, default: true },
    party: { type: String, enum: PARTIES, default: 'INTERNAL' },
    defaultJobRole: { type: String, enum: [...JOB_ROLES, null], default: null },
    defaultTeamId: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    /** null = no estimate (EC-58), never 0. */
    estHours: { type: Number, min: 0, default: null },
    offsetDays: { type: Number, min: 0, default: 0 },
    durationDays: { type: Number, min: 0, default: 1 },
    deliverable: { type: String, default: null },
    requiresApproval: { type: Boolean, default: false },
    isMilestone: { type: Boolean, default: false },
    dependsOn: { type: [String], default: [] },
  },
  { _id: false },
);

const templateSchema = new Schema(
  {
    templateKey: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    type: { type: String, enum: TEMPLATE_TYPES, required: true },
    description: { type: String, default: null },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: TEMPLATE_STATUSES, default: 'DRAFT', index: true },
    superseded: { type: Boolean, default: false },
    phases: { type: [phaseSchema], default: [] },
    activities: { type: [activitySchema], default: [] },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'implementationTemplates' },
);
templateSchema.index({ templateKey: 1, version: 1 }, { unique: true });

export type Template = InferSchemaType<typeof templateSchema>;
export const TemplateModel = model('Template', templateSchema);
