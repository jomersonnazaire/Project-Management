import {
  ACCESS_ACTIONS,
  ACCESS_DEFAULT_CHANGES,
  RECORD_TYPE_KEYS,
  defaultPermissions,
  type AccessDefaultChange,
  type SystemRole,
} from '@xc8/shared';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import { AccessRuleModel, ActivityLogModel, MigrationModel } from '../models/index.js';
import { audit } from './audit.js';

/** A claim older than this is treated as abandoned (the instance died mid-run) and retaken. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

export type CellOutcome = 'switched' | 'already' | 'admin_changed' | 'no_rules';

export interface DefaultChangeResult {
  id: string;
  status: 'applied' | 'skipped';
  cells: { role: SystemRole; cell: string; outcome: CellOutcome }[];
}

async function claim(change: AccessDefaultChange): Promise<boolean> {
  const now = new Date();
  try {
    await MigrationModel.create({
      _id: change.id,
      kind: 'access_default_change',
      status: 'RUNNING',
      startedAt: now,
    });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
  const retaken = await MigrationModel.findOneAndUpdate(
    {
      _id: change.id,
      status: 'RUNNING',
      startedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) },
    },
    { $set: { startedAt: now } },
  );
  return Boolean(retaken);
}

/**
 * True when an Admin has ever set this cell by hand. "Reset to defaults" doesn't count: it only
 * restores the (old) default. Such cells are left alone even if they're back at the old value.
 */
async function adminChanged(role: SystemRole, record: string, action: string): Promise<boolean> {
  const hit = await ActivityLogModel.exists({
    entityType: 'accessRule',
    action: 'access_rule_changed',
    'meta.role': role,
    'meta.recordType': record,
    'meta.permission': action,
  });
  return Boolean(hit);
}

/**
 * Applies one default change: each cell is switched only if the saved grid still holds the old
 * default and no Admin has set it. The conditional update is atomic and bumps the grid version,
 * so an Admin with the grid open gets the usual 409 and reloads. One audit entry per switched
 * cell, plus one summary entry per migration.
 */
export async function applyDefaultChange(
  change: AccessDefaultChange,
): Promise<DefaultChangeResult> {
  const cells: DefaultChangeResult['cells'] = [];
  for (const c of change.cells) {
    const path = `permissions.${c.record}.${c.action}`;
    const cell = `${c.record}.${c.action}`;
    const doc = await AccessRuleModel.findOne({ role: c.role }).lean();
    if (!doc) {
      // Not seeded yet: the new defaults will be seeded as they are.
      cells.push({ role: c.role, cell, outcome: 'no_rules' });
      continue;
    }
    const stored = (doc.permissions as Record<string, Record<string, boolean> | undefined>)?.[
      c.record
    ]?.[c.action];
    // A missing cell already follows the current default.
    if (stored === undefined || stored === c.to) {
      cells.push({ role: c.role, cell, outcome: 'already' });
      continue;
    }
    if (stored !== c.from || (await adminChanged(c.role, c.record, c.action))) {
      cells.push({ role: c.role, cell, outcome: 'admin_changed' });
      continue;
    }
    const saved = await AccessRuleModel.findOneAndUpdate(
      { role: c.role, [path]: c.from },
      { $set: { [path]: c.to }, $inc: { version: 1 } },
      { new: true },
    );
    if (!saved) {
      cells.push({ role: c.role, cell, outcome: 'admin_changed' });
      continue;
    }
    await audit({
      actorId: null,
      entityType: 'accessRule',
      entityId: saved._id,
      action: 'access_rule_default_migrated',
      changes: [{ field: cell, old: c.from, new: c.to }],
      reason: change.reason,
      meta: { role: c.role, recordType: c.record, permission: c.action, migration: change.id },
    });
    cells.push({ role: c.role, cell, outcome: 'switched' });
  }
  await audit({
    actorId: null,
    entityType: 'migration',
    entityId: new Types.ObjectId(),
    action: 'access_defaults_migrated',
    reason: change.reason,
    meta: { migration: change.id, cells },
  });
  return { id: change.id, status: 'applied', cells };
}

/**
 * Runs every pending default change once (FR-ACL-02, doc 11 §12). Called on API start after the
 * defaults are seeded, and by the seed script. Idempotent: finished ids are skipped, and a cell
 * already at the new value is never touched twice.
 */
export async function applyAccessDefaultChanges(
  logger?: Logger,
  changes: readonly AccessDefaultChange[] = ACCESS_DEFAULT_CHANGES,
): Promise<DefaultChangeResult[]> {
  const results: DefaultChangeResult[] = [];
  for (const change of changes) {
    if (!(await claim(change))) {
      results.push({ id: change.id, status: 'skipped', cells: [] });
      continue;
    }
    const result = await applyDefaultChange(change);
    await MigrationModel.updateOne(
      { _id: change.id },
      { $set: { status: 'DONE', finishedAt: new Date(), result: { cells: result.cells } } },
    );
    logger?.info({ migration: change.id, cells: result.cells }, 'Applied access default change');
    results.push(result);
  }
  return results;
}

const spec = (row: Record<string, boolean>) =>
  ACCESS_ACTIONS.filter((a) => row[a])
    .map((a) => a[0]!.toUpperCase())
    .join('') || '–';

/**
 * A record type added after go-live (e.g. `issues` in M3.5) has no row in the saved grids yet.
 * Mongoose would fill such a row with "all off" when a grid is loaded for editing, so the Access
 * rules screen would show it unticked and the next save would store that. This writes the seeded
 * default row once, only where the row is missing (never over an Admin's values), bumps the
 * version and audits each added row. Runs on API start before the default changes.
 */
export async function addMissingRecordTypes(
  logger?: Logger,
): Promise<{ role: SystemRole; record: string }[]> {
  const added: { role: SystemRole; record: string }[] = [];
  const docs = await AccessRuleModel.find().select('role permissions').lean();
  for (const doc of docs) {
    const role = doc.role as SystemRole;
    const stored = (doc.permissions ?? {}) as Record<string, unknown>;
    const missing = RECORD_TYPE_KEYS.filter((k) => stored[k] === undefined);
    if (!missing.length) continue;
    const defaults = defaultPermissions(role);
    for (const record of missing) {
      const path = `permissions.${record}`;
      const saved = await AccessRuleModel.findOneAndUpdate(
        { _id: doc._id, [path]: { $exists: false } },
        { $set: { [path]: defaults[record] }, $inc: { version: 1 } },
        { new: true },
      );
      if (!saved) continue; // added concurrently
      await audit({
        actorId: null,
        entityType: 'accessRule',
        entityId: saved._id,
        action: 'access_rule_row_added',
        changes: [{ field: record, old: null, new: spec(defaults[record]) }],
        reason: 'New record type: seeded default row',
        meta: { role, recordType: record },
      });
      added.push({ role, record });
    }
  }
  if (added.length) logger?.info({ added }, 'Added default rows for new record types');
  return added;
}
