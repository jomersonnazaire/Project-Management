import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { JOB_ROLES, SYSTEM_ROLES } from '@xc8/shared';

/**
 * Internal users (07 §2). Client contacts live in a separate collection and can never
 * authenticate (FR-AUTH-08, FR-CLI-03).
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      unique: true,
    },
    passwordHash: { type: String, default: null, select: false },
    systemRole: { type: String, enum: SYSTEM_ROLES, required: true },
    jobRole: { type: String, enum: JOB_ROLES, required: true },
    teamIds: { type: [Schema.Types.ObjectId], ref: 'Team', default: [], index: true },
    weeklyCapacityHours: { type: Number, min: 0, max: 80, default: 40 },
    active: { type: Boolean, default: true },
    /** True until the user sets their own password (FR-AUTH-04). */
    mustChangePassword: { type: Boolean, default: true },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    invite: {
      type: new Schema(
        {
          tokenHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
          invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          purpose: { type: String, enum: ['INVITE', 'RESET'], default: 'INVITE' },
        },
        { _id: false },
      ),
      default: null,
      select: false,
    },
    lastLoginAt: { type: Date, default: null },
    deactivatedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

userSchema.index({ 'invite.tokenHash': 1 }, { sparse: true });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
