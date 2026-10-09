import { ACCESS_ACTIONS, RECORD_TYPE_KEYS, SYSTEM_ROLES } from '@xc8/shared';
import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * Access rules (doc 11 §8): one document per Access role holding View/Create/Edit/Delete per
 * record type. `version` increments on every save for optimistic concurrency (FR-ACL-12).
 * Read on every request (no cache), so changes apply on each user's next request (FR-ACL-06)
 * and stay correct if the App Service ever runs more than one instance (TD-01).
 */
const grantsSchema = new Schema(
  Object.fromEntries(ACCESS_ACTIONS.map((a) => [a, { type: Boolean, default: false }])),
  { _id: false },
);

const permissionsSchema = new Schema(
  Object.fromEntries(RECORD_TYPE_KEYS.map((r) => [r, { type: grantsSchema, default: () => ({}) }])),
  { _id: false },
);

const accessRuleSchema = new Schema(
  {
    role: { type: String, enum: SYSTEM_ROLES, required: true, unique: true },
    permissions: { type: permissionsSchema, required: true },
    version: { type: Number, required: true, default: 1 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedAt: { type: Date, default: null },
  },
  { strict: 'throw', collection: 'accessRules', versionKey: false },
);

export type AccessRule = InferSchemaType<typeof accessRuleSchema>;
export const AccessRuleModel = model('AccessRule', accessRuleSchema);
export type AccessRuleDoc = ReturnType<(typeof AccessRuleModel)['hydrate']>;
