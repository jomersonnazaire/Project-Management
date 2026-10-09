import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Client contacts are tracked records only (FR-CLI-02/03): there is deliberately no
 * password, role, session, or any link to the users collection. `strict: 'throw'`
 * makes any attempt to persist such a field fail.
 */
const clientContactSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: String, trim: true, maxlength: 120, default: null },
    position: { type: String, trim: true, maxlength: 120, default: null },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      default: null,
      index: true,
    },
    phone: { type: String, trim: true, maxlength: 40, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, strict: 'throw', collection: 'clientContacts' },
);

export type ClientContact = InferSchemaType<typeof clientContactSchema>;
export const ClientContactModel = model('ClientContact', clientContactSchema);
