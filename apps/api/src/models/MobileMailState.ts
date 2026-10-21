import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Pending Microsoft Mail.Send round trip started from the mobile app (DAR Send, action emails).
 * The web keeps this in a signed cookie; the system browser the app opens has no API cookie, so
 * the same data is kept here instead, keyed by the SHA-256 of the OAuth state (the raw state is
 * not stored). Single use (the callback deletes it) and gone after 10 minutes.
 */
const mobileMailStateSchema = new Schema(
  {
    keyHash: { type: String, required: true, unique: true },
    flow: { type: String, enum: ['dar', 'action'], required: true },
    /** The cookie payload without `state` (PKCE verifier, nonce, user and item ids). */
    data: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { strict: 'throw', versionKey: false },
);

mobileMailStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type MobileMailState = InferSchemaType<typeof mobileMailStateSchema>;
export const MobileMailStateModel = model(
  'MobileMailState',
  mobileMailStateSchema,
  'mobileMailStates',
);
