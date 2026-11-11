/**
 * CR-23 FR-DLV-04 (one-time deliverable migration): moves every task's and template activity's old
 * Deliverable text into its first checklist item (scripts/lib/migrateDeliverables.ts). DRY RUN by
 * default: lists what would change and writes nothing. Pass --apply to write; each changed task or
 * template gets one `deliverables_migrated` audit entry. Safe to re-run: a second --apply changes
 * nothing. Run on staging first; on live only with Jomerson's OK (A-60), right after the CR-23
 * deploy (until it runs, old Deliverable text isn't shown).
 *
 * Usage (built, e.g. App Service / Kudu, from the app folder): `node dist/scripts/migrate-deliverables.js
 * [--apply]`, or `npm run migrate:deliverables [-- --apply]`. From a checkout without building:
 * `npm run migrate:deliverables:dev --workspace @xc8/api [-- --apply]`. Needs MONGODB_URI (and
 * MONGODB_DB_NAME when the URI has no database).
 */
import mongoose from 'mongoose';
import { migrateAllDeliverables } from './lib/migrateDeliverables.js';

const show = (t: string | null) =>
  t ? `"${t.length > 80 ? `${t.slice(0, 80)}…` : t}"` : '(empty, old field dropped)';

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--apply' && a !== '--dry-run');
  if (unknown.length)
    throw new Error(`Unknown option ${unknown.join(' ')} (use --dry-run or --apply).`);
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
      ? `\n${n} task(s) and ${m} template activit${m === 1 ? 'y' : 'ies'} ${apply ? 'migrated' : 'would change; re-run with --apply to write'}.`
      : '\nNo old Deliverable text left; nothing to do.',
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
