/**
 * CR-23 FR-DLV-04 (one-time deliverable migration): copies every task's and template activity's
 * old Deliverable text into its first checklist item (scripts/lib/migrateDeliverables.ts). The old
 * `deliverable` field is left exactly as it is (text or empty), so a rollback to the pre-CR-23 app
 * still shows it. DRY RUN by default: lists what would change and writes nothing. Pass --apply to
 * write; each changed task or template gets one `deliverables_migrated` audit entry. Safe to
 * re-run: a record counts as done once it has items (or `deliverableLegacyMoved`), so a second
 * --apply changes nothing. Run on staging first; on live only with Jomerson's OK (A-60). Until it
 * runs the app shows the old text as a read-only item, so nothing is hidden in between.
 *
 * `--restore-legacy` (one-off staging repair, dry run unless --apply too): reverts what the first
 * CR-23 migration (f73cf65, which unset the old field) did, only on the records its own audit
 * entries name and only where `deliverable` is missing: puts the text back and removes the item it
 * created when that item is unchanged (so the record looks as before any migration); if the items
 * were changed since, puts only the text back and keeps the items (reported as skipped-items).
 * Then re-run this script (without the flag) to migrate again.
 *
 * Usage (built, e.g. App Service / Kudu, from the app folder): `node dist/scripts/migrate-deliverables.js
 * [--apply]`, or `npm run migrate:deliverables [-- --apply]`. From a checkout without building:
 * `npm run migrate:deliverables:dev --workspace @xc8/api [-- --apply]`. Needs MONGODB_URI (and
 * MONGODB_DB_NAME when the URI has no database).
 */
import mongoose from 'mongoose';
import { migrateAllDeliverables, restoreLegacyDeliverables } from './lib/migrateDeliverables.js';

const show = (t: string) => `"${t.length > 80 ? `${t.slice(0, 80)}…` : t}"`;

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !['--apply', '--dry-run', '--restore-legacy'].includes(a));
  if (unknown.length)
    throw new Error(
      `Unknown option ${unknown.join(' ')} (use --dry-run, --apply, --restore-legacy).`,
    );
  if (args.includes('--apply') && args.includes('--dry-run')) {
    throw new Error('Pick one of --dry-run and --apply.');
  }
  const apply = args.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_URI first.');
  // No index builds and no collection creation, so a dry run never writes to the database.
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 10_000,
    autoIndex: false,
    autoCreate: false,
  });
  console.log(`Database: ${mongoose.connection.db?.databaseName ?? '(unknown)'}`);
  if (args.includes('--restore-legacy')) {
    const r = await restoreLegacyDeliverables({ apply });
    console.log(
      `${apply ? 'APPLY' : 'DRY RUN'} --restore-legacy: ${r.entriesChecked} migration audit entr${r.entriesChecked === 1 ? 'y' : 'ies'} checked`,
    );
    for (const t of r.tasks)
      console.log(`  task ${t.taskId}: text back, item removed ${show(t.text)}`);
    for (const t of r.templates)
      for (const a of t.activities)
        console.log(
          `  template ${t.templateId} activity ${a.id}: text back, item removed ${show(a.text)}`,
        );
    for (const s of r.skippedItems)
      console.log(
        `  skipped-items ${s.kind} ${s.id}: items changed since; text back, items kept ${show(s.text)}`,
      );
    const m = r.templates.reduce((k, t) => k + t.activities.length, 0);
    console.log(
      `\n${r.tasks.length} task(s) and ${m} template activit${m === 1 ? 'y' : 'ies'} ${apply ? 'reverted' : 'would be reverted'}; ${r.skippedItems.length} skipped-items; ${r.leftAlone} still had the field (not touched).${apply ? '' : ' Re-run with --apply to write.'}`,
    );
    await mongoose.disconnect();
    return;
  }
  const r = await migrateAllDeliverables({ apply });
  console.log(
    `${apply ? 'APPLY' : 'DRY RUN'}: ${r.tasksChecked} task(s) and ${r.templatesChecked} template(s) with old Deliverable text checked`,
  );
  for (const t of r.tasks)
    console.log(`  task ${t.taskId} (project ${t.projectId}): ${show(t.text)}`);
  for (const t of r.templates) {
    console.log(`  template ${t.name} v${t.version} (${t.templateId}):`);
    for (const a of t.activities) console.log(`    activity ${a.id}: ${show(a.text)}`);
  }
  for (const s of r.skipped)
    console.log(
      `  skipped ${s.kind} ${s.id}: already has items; old text ${show(s.text)} left as is`,
    );
  const n = r.tasks.length;
  const m = r.templates.reduce((k, t) => k + t.activities.length, 0);
  console.log(
    n || m
      ? `\n${n} task(s) and ${m} template activit${m === 1 ? 'y' : 'ies'} ${apply ? 'given a first item from the old text' : 'would get a first item; re-run with --apply to write'}. The old Deliverable field is kept on every record.`
      : '\nNothing left to copy (every old Deliverable text already has items); nothing changed. The old field is kept.',
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
