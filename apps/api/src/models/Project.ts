import { PROJECT_STATUSES } from '@xc8/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Projects. Milestone 1.5 only reads them (Clients › Projects tab and the fixed project scope,
 * FR-ACL-07 / FR-CLI-12); creating and editing projects arrives in Milestone 2.
 */
const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    memberIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [], index: true },
    status: { type: String, enum: PROJECT_STATUSES, default: 'ACTIVE' },
    archived: { type: Boolean, default: false },
    startDate: { type: Date, default: null },
    plannedEndDate: { type: Date, default: null },
    progress: { type: Number, min: 0, max: 100, default: 0 },
  },
  { timestamps: true, strict: 'throw', collection: 'projects' },
);

export type Project = InferSchemaType<typeof projectSchema>;
export const ProjectModel = model('Project', projectSchema);
