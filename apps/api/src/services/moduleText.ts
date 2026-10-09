import { MODULE_MAX, graphemeSlice } from '@xc8/shared';
import type { Logger } from 'pino';
import { LookupModel, MigrationModel, TimeEntryModel } from '../models/index.js';

/**
 * Doc 14 FR-ACT-21: Module became free text. Copies each entry's old Modules-list name into the
 * new `module` text field, so every entry keeps its label (saved reports already hold the text).
 *
 * Runs once (DEF-010): the `module-free-text` marker in `migrations` is checked first and written
 * when the copy finishes, so a restart never copies again (before, it re-ran on every start and
 * brought back modules users had cleared). Within a run only entries that still have a legacy
 * `moduleId` and no text are touched; saving any Module (blank included) clears `moduleId`, so
 * even a forced re-run can't restore a cleared module. The Modules list is left as it was
 * (FR-ACT-22).
 */
export const MODULE_MIGRATION_ID = 'module-free-text';

export async function migrateModuleText(logger?: Logger): Promise<number> {
  const done = await MigrationModel.exists({ _id: MODULE_MIGRATION_ID, status: 'DONE' });
  if (done) return 0;
  const pending = {
    moduleId: { $ne: null },
    $or: [{ module: null }, { module: { $exists: false } }],
  };
  const ids = (await TimeEntryModel.distinct('moduleId', pending)) as unknown[];
  let updated = 0;
  if (ids.length) {
    const names = await LookupModel.find({ _id: { $in: ids } })
      .select('name')
      .lean();
    for (const l of names) {
      const res = await TimeEntryModel.updateMany(
        { ...pending, moduleId: l._id },
        { $set: { module: graphemeSlice(l.name.trim(), MODULE_MAX) || null } },
        { timestamps: false },
      );
      updated += res.modifiedCount;
    }
  }
  await MigrationModel.updateOne(
    { _id: MODULE_MIGRATION_ID },
    {
      $set: { kind: 'data', status: 'DONE', finishedAt: new Date(), result: { updated } },
      $setOnInsert: { startedAt: new Date() },
    },
    { upsert: true },
  ).catch(() => undefined);
  if (updated) logger?.info({ updated }, 'Copied module names into the free-text field');
  return updated;
}
