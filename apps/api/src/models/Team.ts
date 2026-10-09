import { Schema, model, type InferSchemaType } from 'mongoose';

const teamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** Lower-cased name for case-insensitive uniqueness. */
    nameKey: { type: String, required: true, unique: true },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true, strict: 'throw' },
);

export type Team = InferSchemaType<typeof teamSchema>;
export const TeamModel = model('Team', teamSchema);
