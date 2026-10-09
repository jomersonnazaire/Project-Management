import { Schema, model, type InferSchemaType } from 'mongoose';

const { ObjectId } = Schema.Types;

/**
 * Project types (doc 14 FR-PTY-01): an Admin list. Projects store the type by ID, so a rename
 * shows everywhere live (FR-PTY-06). The default Activity type is preselected at Time in.
 */
const projectTypeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    /** Lower-case, whitespace-collapsed name; unique (duplicates ignore case and extra spaces). */
    nameKey: { type: String, required: true, unique: true },
    defaultActivityTypeId: { type: ObjectId, ref: 'Lookup', default: null },
    active: { type: Boolean, default: true },
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: { type: ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw', collection: 'projectTypes', versionKey: false },
);

export type ProjectType = InferSchemaType<typeof projectTypeSchema>;
export const ProjectTypeModel = model('ProjectType', projectTypeSchema);
