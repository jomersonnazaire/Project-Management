/**
 * CR-22 FR-TL-24 (one-time phase migration): moves every project's text phases into its phase
 * list (scripts/lib/migratePhases.ts). DRY RUN by default: lists what would change and writes
 * nothing. Pass --apply to write; each changed project gets one `phases_migrated` audit entry.
 * Safe to re-run: a second --apply changes nothing. Run on staging first; on live only with
 * Jomerson's OK (as CR-20's renumber).
 *
 * Usage (built, e.g. App Service / Kudu, from the app folder): `node dist/scripts/migrate-phases.js
 * [--apply]`, or `npm run migrate:phases [-- --apply]`. From a checkout without building:
 * `npm run migrate:phases:dev --workspace @xc8/api [-- --apply]`. Needs MONGODB_URI (and
 * MONGODB_DB_NAME when the URI has no database).
 */
import mongoose from 'mongoose';
import { migrateAllPhases } from './lib/migratePhases.js';

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
  const r = await migrateAllPhases({ apply });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${r.projectsChecked} projects checked`);
  for (const p of r.changed) {
    console.log(
      `\n${p.projectName} (${p.projectId}): ${p.added.length} phase(s) added` +
        `${p.added.length ? `: ${p.added.join(', ')}` : ''}; ${p.tasksLinked.length} task(s) linked and ${p.foldersRespelled} folder(s) respelled`,
    );
    // Say what changes: the link to a phase record, and the spelling only when it differs.
    for (const t of p.tasksLinked) {
      if (t.toId !== t.fromId)
        console.log(
          t.toId
            ? `  task ${t.taskId}: linked to phase "${t.to ?? ''}" (${t.toId})`
            : `  task ${t.taskId}: unlinked from phase (${t.fromId ?? ''})`,
        );
      if ((t.from ?? '') !== (t.to ?? ''))
        console.log(`  task ${t.taskId}: phase respelled "${t.from ?? ''}" → "${t.to ?? ''}"`);
    }
  }
  console.log(
    r.changed.length
      ? `\n${r.changed.length} project(s) ${apply ? 'migrated and audited' : 'would change; re-run with --apply to write'}.`
      : '\nEvery project already has its phase list; nothing to do.',
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
