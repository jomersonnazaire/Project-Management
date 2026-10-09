import { Schema, model, type InferSchemaType } from 'mongoose';

const clientSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    nameKey: { type: String, required: true, unique: true },
    industry: { type: String, trim: true, maxlength: 120, default: null },
    address: { type: String, trim: true, maxlength: 500, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, strict: 'throw' },
);

export type Client = InferSchemaType<typeof clientSchema>;
export const ClientModel = model('Client', clientSchema);
