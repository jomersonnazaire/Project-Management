import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Server-side sessions. The cookie holds a random token; only its SHA-256 hash is stored.
 * `expiresAt` slides forward on activity (idle timeout) and is capped by `absoluteExpiresAt`.
 */
const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: true, strict: 'throw' },
);

// MongoDB removes expired sessions automatically; the API also checks expiry on every request.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type Session = InferSchemaType<typeof sessionSchema>;
export const SessionModel = model('Session', sessionSchema);
