import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Short-lived Microsoft mobile sign-in state (pending OAuth) and one-time exchange codes.
 * State and one-time codes are stored only as SHA-256 hashes (keyHash). The Microsoft PKCE
 * verifier and nonce for the pending phase are stored as-is (the server needs them for the token
 * exchange) and expire with the pending doc (10 minutes).
 */
const mobileAuthCodeSchema = new Schema(
  {
    phase: { type: String, enum: ['pending', 'code'], required: true },
    keyHash: { type: String, required: true, unique: true },
    codeChallenge: { type: String, required: true },
    msCodeVerifier: { type: String, default: null },
    nonce: { type: String, default: null },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: { type: Date, required: true },
  },
  { strict: 'throw', versionKey: false },
);

mobileAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type MobileAuthCode = InferSchemaType<typeof mobileAuthCodeSchema>;
export const MobileAuthCodeModel = model('MobileAuthCode', mobileAuthCodeSchema, 'mobileAuthCodes');
