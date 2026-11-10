/**
 * CR-22 FR-TL-24 (one-time phase migration): moves every project's text phases into its phase
 * list (scripts/lib/migratePhases.ts). DRY RUN by default: lists what would change and writes
 * nothing. Pass --apply to write; each changed project gets one `phases_migrated` audit entry.
 * Safe to re-run: a second --apply changes nothing. Run on staging first; on live only with
 * Jomerson's OK (as CR-20's renumber).
 *
 * Usage: `npm run migrate:phases --workspace @xc8/api [-- --apply]` with MONGODB_URI set.
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
  // Plain connect (no index sync), so a dry run never writes to the database.
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 10_000,
  });
  console.log(`Database: ${mongoose.connection.db?.databaseName ?? '(unknown)'}`);
  const r = await migrateAllPhases({ apply });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${r.projectsChecked} projects checked`);
  for (const p of r.changed) {
    console.log(
      `\n${p.projectName} (${p.projectId}): ${p.added.length} phase(s) added` +
        `${p.added.length ? `: ${p.added.join(', ')}` : ''}; ${p.tasksLinked.length} task(s) linked and ${p.foldersRespelled} folder(s) respelled`,
    );
    for (const t of p.tasksLinked)
      console.log(`  task ${t.taskId}: "${t.from ?? ''}" → "${t.to ?? ''}"`);
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
