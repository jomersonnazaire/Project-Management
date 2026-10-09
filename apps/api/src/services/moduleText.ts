import type { Logger } from 'pino';
import { LookupModel, MigrationModel, TimeEntryModel } from '../models/index.js';

/**
 * Doc 14 FR-ACT-21: Module became free text. Copies each entry's old Modules-list name into the
 * new `module` text field, so every entry keeps its label (saved reports already hold the text).
 *
 * Idempotent: only entries that still have a legacy `moduleId` and no text yet are touched, so a
 * re-run (or a second instance starting at the same time) changes nothing. The Modules list
 * itself and each entry's `moduleId` are left exactly as they were (FR-ACT-22).
 */
export async function migrateModuleText(logger?: Logger): Promise<number> {
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
        { $set: { module: l.name.trim().slice(0, 100) || null } },
        { timestamps: false },
      );
      updated += res.modifiedCount;
    }
  }
  await MigrationModel.updateOne(
    { _id: 'module-free-text' },
    {
      $set: { kind: 'data', status: 'DONE', finishedAt: new Date(), result: { updated } },
      $setOnInsert: { startedAt: new Date() },
    },
    { upsert: true },
  ).catch(() => undefined);
  if (updated) logger?.info({ updated }, 'Copied module names into the free-text field');
  return updated;
}
