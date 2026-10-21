import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Microsoft Mail.Send round trip started from the mobile app (DAR Send).
 * - `pending`: the web keeps this in a signed cookie; the system browser the app opens has no
 *   API cookie, so the same data is kept here, keyed by the SHA-256 of the OAuth state (the raw
 *   state is not stored). 10 minutes, single use.
 * - `result`: the outcome of that send, keyed by the SHA-256 of a one-time code that the app
 *   reads back with its own bearer token (POST /auth/mobile/mail/confirm). Holds no Microsoft
 *   token. 5 minutes, single use.
 */
const mobileMailStateSchema = new Schema(
  {
    phase: { type: String, enum: ['pending', 'result'], required: true },
    keyHash: { type: String, required: true, unique: true },
    flow: { type: String, enum: ['dar', 'action'], required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** pending: the cookie payload without `state`. result: the outcome params. */
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
