import {
  SYSTEM_ROLES,
  defaultPermissions,
  effectivePermissions,
  type AccessRulesDto,
  type PermissionGrid,
  type SystemRole,
} from '@xc8/shared';
import type { Logger } from 'pino';
import { AccessRuleModel, UserModel, type AccessRuleDoc } from '../models/index.js';

/**
 * Seeds the default access rules (doc 11 §6) for every role that has none yet. Idempotent and
 * safe to run concurrently: `$setOnInsert` never overwrites rules an Admin has changed, and the
 * unique index on `role` stops duplicates. Runs on every API start (FR-ACL-02).
 */
export async function ensureDefaultAccessRules(logger?: Logger): Promise<number> {
  const results = await AccessRuleModel.bulkWrite(
    SYSTEM_ROLES.map((role) => ({
      updateOne: {
        filter: { role },
        update: {
          $setOnInsert: {
            role,
            permissions: defaultPermissions(role),
            version: 1,
            updatedBy: null,
            updatedAt: null,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  const seeded = results.upsertedCount;
  if (seeded > 0) logger?.info({ seeded }, 'Seeded default access rules');
  return seeded;
}

/**
 * The permissions that apply to `role` right now. Read from the database on every request (one
 * small indexed document), so a saved change applies on the user's very next request (FR-ACL-06).
 * If the role's document is missing (not seeded yet), the defaults apply.
 */
export async function permissionsFor(role: SystemRole): Promise<PermissionGrid> {
  const doc = await AccessRuleModel.findOne({ role }).select('permissions').lean();
  return effectivePermissions(role, (doc?.permissions as Partial<PermissionGrid>) ?? null);
}

export async function getRuleDoc(role: SystemRole): Promise<AccessRuleDoc> {
  const doc = await AccessRuleModel.findOne({ role });
  if (doc) return doc;
  await ensureDefaultAccessRules();
  return (await AccessRuleModel.findOne({ role }))!;
}

export function storedGrid(doc: AccessRuleDoc): PermissionGrid {
  return effectivePermissions(
    doc.role as SystemRole,
    doc.toObject().permissions as Partial<PermissionGrid>,
  );
}

export async function toAccessRulesDtos(docs: AccessRuleDoc[]): Promise<AccessRulesDto[]> {
  const ids = docs.map((d) => d.updatedBy).filter(Boolean);
  const users = await UserModel.find({ _id: { $in: ids } })
    .select('name')
    .lean();
  const names = new Map(users.map((u) => [u._id.toString(), u.name]));
  const order = new Map(SYSTEM_ROLES.map((r, i) => [r, i]));
  return [...docs]
    .sort((a, b) => order.get(a.role as SystemRole)! - order.get(b.role as SystemRole)!)
    .map((d) => ({
      role: d.role as SystemRole,
      permissions: storedGrid(d),
      version: d.version,
      updatedAt: d.updatedAt ? d.updatedAt.toISOString() : null,
      updatedBy: d.updatedBy
        ? { id: d.updatedBy.toString(), name: names.get(d.updatedBy.toString()) ?? 'Unknown user' }
        : null,
    }));
}
