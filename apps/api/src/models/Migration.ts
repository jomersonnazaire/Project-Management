import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * One-time data migrations that have run (doc 11 §12). `_id` is the migration id, so a second
 * instance starting at the same time can't claim the same migration twice.
 */
const migrationSchema = new Schema(
  {
    _id: { type: String, required: true },
    kind: { type: String, required: true },
    status: { type: String, enum: ['RUNNING', 'DONE'], required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    result: { type: Schema.Types.Mixed, default: null },
  },
  { strict: 'throw', collection: 'migrations', versionKey: false },
);

export type Migration = InferSchemaType<typeof migrationSchema>;
export const MigrationModel = model('Migration', migrationSchema);
