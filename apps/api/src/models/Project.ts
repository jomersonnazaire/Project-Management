import { HEALTH_VALUES, PROJECT_STATUSES, TEMPLATE_TYPES } from '@xc8/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Projects (FR-PRJ-01..13, 07 §2). `startDate` / `plannedEndDate` are the baseline dates (calendar
 * dates stored at UTC midnight). The manager is always in `memberIds`, which drives the Member
 * scope (FR-PRJ-06, FR-ACL-07). Field names from Milestone 1.5 are kept for compatibility.
 */
const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    memberIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [], index: true },
    type: { type: String, enum: [...TEMPLATE_TYPES, null], default: null },
    description: { type: String, default: null },
    status: { type: String, enum: PROJECT_STATUSES, default: 'PLANNING', index: true },
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    /** DR-23: project code, the issue ID prefix. Stored in capitals; unique ignoring case. */
    code: { type: String, default: null, trim: true, uppercase: true },
    /** Issue ids (doc 13 §3): prefix fixed at the first issue, running number never reused. */
    issuePrefix: { type: String, default: null },
    issueSeq: { type: Number, default: 0 },
    startDate: { type: Date, default: null },
    plannedEndDate: { type: Date, default: null },
    baselineHistory: {
      type: [
        new Schema(
          {
            startDate: Date,
            plannedEndDate: Date,
            reason: String,
            changedAt: Date,
            changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    /** Active contacts, chosen only from this project's client (FR-PRJ-11, doc 11). */
    activeContactIds: {
      type: [Schema.Types.ObjectId],
      ref: 'ClientContact',
      default: [],
      index: true,
    },
    /** Copy of the template version used to generate the plan (FR-PRJ-02, AC-08.2). */
    templateSnapshot: {
      type: new Schema(
        {
          templateId: { type: Schema.Types.ObjectId, ref: 'Template' },
          templateKey: String,
          version: Number,
          name: String,
          copy: Schema.Types.Mixed,
        },
        { _id: false },
      ),
      default: null,
    },
    /** Stored calculations (NFR-13), refreshed whenever tasks change. */
    computed: {
      type: new Schema(
        {
          forecastEnd: { type: Date, default: null },
          scheduleVarianceDays: { type: Number, default: 0 },
          health: { type: String, enum: HEALTH_VALUES, default: 'ON_TRACK' },
          updatedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'projects' },
);
projectSchema.index({ 'templateSnapshot.templateKey': 1 });
projectSchema.index({ 'computed.health': 1 });
projectSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: 'string' } }, name: 'code_unique' },
);

export type Project = InferSchemaType<typeof projectSchema>;
export const ProjectModel = model('Project', projectSchema);
