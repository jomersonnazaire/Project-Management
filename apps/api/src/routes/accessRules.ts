import {
  ACCESS_ACTIONS,
  actionApplies,
  SYSTEM_ROLES,
  defaultPermissions,
  isRecordType,
  resetAccessRulesSchema,
  updateAccessRulesSchema,
  validatePermissionGrid,
  type AccessAction,
  type AccessRuleIssue,
  type PermissionGrid,
  type SystemRole,
} from '@xc8/shared';
import type { Request } from 'express';
import { perm, type RouteRegistry } from '../access/registry.js';
import { HttpError, notFound } from '../lib/errors.js';
import { formatIssues } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import { AccessRuleModel, type AccessRuleDoc } from '../models/index.js';
import {
  ensureDefaultAccessRules,
  getRuleDoc,
  storedGrid,
  toAccessRulesDtos,
} from '../services/accessRules.js';
import { auditMany } from '../services/audit.js';

const unprocessable = (message: string, code: string, details?: unknown) =>
  new HttpError(422, code, message, details);

function roleParam(req: Request): SystemRole {
  const role = req.params.role;
  if (typeof role !== 'string' || !(SYSTEM_ROLES as readonly string[]).includes(role)) {
    throw notFound();
  }
  return role as SystemRole;
}

function parseOrThrow<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
  req: Request,
): T {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    throw unprocessable(
      'The access rules in this request are invalid.',
      'INVALID_ACCESS_RULES',
      formatIssues(result.error as Parameters<typeof formatIssues>[0]),
    );
  }
  return result.data as T;
}

/**
 * Merges a partial `{ recordType: { action: boolean } }` payload onto the current grid.
 * Unknown record types or actions, or non-boolean values, answer 422 and save nothing (EC-57).
 */
function mergePatch(current: PermissionGrid, patch: Record<string, Record<string, unknown>>) {
  const issues: AccessRuleIssue[] = [];
  const next = structuredClone(current);
  for (const [record, row] of Object.entries(patch)) {
    if (!isRecordType(record)) {
      issues.push({ code: 'UNKNOWN_RECORD_TYPE', path: record, message: 'Unknown record type.' });
      continue;
    }
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      issues.push({ code: 'UNKNOWN_ACTION', path: record, message: 'Expected an object.' });
      continue;
    }
    for (const [action, value] of Object.entries(row)) {
      if (!(ACCESS_ACTIONS as readonly string[]).includes(action)) {
        issues.push({
          code: 'UNKNOWN_ACTION',
          path: `${record}.${action}`,
          message: 'Unknown action.',
        });
      } else if (typeof value !== 'boolean') {
        issues.push({
          code: 'UNKNOWN_ACTION',
          path: `${record}.${action}`,
          message: 'Expected true or false.',
        });
      } else {
        next[record][action as AccessAction] = value;
      }
    }
    // FR-ACL-15: Export needs View. Turning View off also unticks Export; ticking Export
    // (with View not turned off in the same change) ticks View, as the grid does.
    const r = next[record];
    if (actionApplies(record, 'export') && r.export && !r.view) {
      if ((row as Record<string, unknown>).view === false) r.export = false;
      else r.view = true;
    }
  }
  return { next, issues };
}

function changedCells(before: PermissionGrid, after: PermissionGrid) {
  const cells: { record: string; action: AccessAction; old: boolean; new: boolean }[] = [];
  for (const record of Object.keys(after) as (keyof PermissionGrid)[]) {
    for (const action of ACCESS_ACTIONS) {
      if (before[record][action] !== after[record][action]) {
        cells.push({ record, action, old: before[record][action], new: after[record][action] });
      }
    }
  }
  return cells;
}

/**
 * Saves `next` for the role if the stored version is still `version` (optimistic concurrency,
 * FR-ACL-12), then writes one audit entry per changed cell (FR-ACL-10, AC-33.4).
 */
async function saveGrid(
  req: Request,
  doc: AccessRuleDoc,
  version: number,
  next: PermissionGrid,
  auditAction: 'access_rule_changed' | 'access_rules_reset',
) {
  const role = doc.role as SystemRole;
  if (doc.version !== version) throw versionConflict();
  const before = storedGrid(doc);
  const cells = changedCells(before, next);
  if (!cells.length) return doc;
  const actor = currentUser(req);
  const saved = await AccessRuleModel.findOneAndUpdate(
    { role, version },
    {
      $set: { permissions: next, updatedBy: actor._id, updatedAt: new Date() },
      $inc: { version: 1 },
    },
    { new: true },
  );
  if (!saved) throw versionConflict();
  await auditMany(
    cells.map((c) => ({
      actorId: actor._id,
      entityType: 'accessRule',
      entityId: saved._id,
      action: auditAction,
      changes: [{ field: `${c.record}.${c.action}`, old: c.old, new: c.new }],
      meta: { role, recordType: c.record, permission: c.action },
    })),
  );
  req.log?.info(
    { accessRules: { role, changed: cells.length, version: saved.version } },
    'access rules saved',
  );
  return saved;
}

function versionConflict() {
  return new HttpError(
    409,
    'VERSION_CONFLICT',
    'Someone else saved these rules while you were editing. Reload to see their changes, then make yours again.',
  );
}

/** Access rules screen (doc 11). Admin-only by default (Q-27); Admin rows on users/accessRules locked. */
export function accessRulesRouter(registry: RouteRegistry) {
  const r = registry.router('/access-rules');

  r.get('/', perm('accessRules', 'view'), async (_req, res) => {
    await ensureDefaultAccessRules();
    const docs = await AccessRuleModel.find({ role: { $in: SYSTEM_ROLES } });
    res.json({ roles: await toAccessRulesDtos(docs) });
  });

  r.put('/:role', perm('accessRules', 'edit'), async (req, res) => {
    const role = roleParam(req);
    const body = parseOrThrow<{
      version: number;
      permissions: Record<string, Record<string, unknown>>;
    }>(updateAccessRulesSchema, req);
    const doc = await getRuleDoc(role);
    const { next, issues } = mergePatch(storedGrid(doc), body.permissions);
    issues.push(...validatePermissionGrid(role, next));
    if (issues.length) {
      const locked = issues.find((i) => i.code === 'LOCKED_PERMISSION');
      throw unprocessable(
        locked ? locked.message : 'The access rules in this request are invalid.',
        locked ? 'LOCKED_PERMISSION' : 'INVALID_ACCESS_RULES',
        issues,
      );
    }
    const saved = await saveGrid(req, doc, body.version, next, 'access_rule_changed');
    res.json({ rules: (await toAccessRulesDtos([saved]))[0] });
  });

  /** "Reset to defaults" for one role (FR-ACL-02, AC-33.6). */
  r.post('/:role/reset', perm('accessRules', 'edit'), async (req, res) => {
    const role = roleParam(req);
    const body = parseOrThrow<{ version: number }>(resetAccessRulesSchema, req);
    const doc = await getRuleDoc(role);
    const saved = await saveGrid(
      req,
      doc,
      body.version,
      defaultPermissions(role),
      'access_rules_reset',
    );
    res.json({ rules: (await toAccessRulesDtos([saved]))[0] });
  });

  return r.router;
}
