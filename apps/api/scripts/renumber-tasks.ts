/**
 * CR-20 FR-TSK-31 (one-time renumber): renumbers every project's tasks to #1…n in their current order (scripts/lib/
 * renumberTasks.ts). DRY RUN by default: lists what would change and writes nothing. Pass --apply
 * to write; each changed project gets one `tasks_renumbered` audit entry with the old and new
 * numbers. Safe to re-run: a second --apply changes nothing.
 *
 * Usage: `npm run renumber:tasks --workspace @xc8/api [-- --apply]` with MONGODB_URI set.
 */
import mongoose from 'mongoose';
import { renumberAllProjects } from './lib/renumberTasks.js';

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
  const r = await renumberAllProjects({ apply });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${r.projectsChecked} projects checked`);
  for (const p of r.changed) {
    console.log(`\n${p.projectName} (${p.projectId}): ${p.tasks.length} tasks renumbered`);
    for (const t of p.tasks) console.log(`  #${t.from ?? '–'} → #${t.to}  ${t.name}`);
  }
  console.log(
    r.changed.length
      ? `\n${r.changed.length} project(s) ${apply ? 'renumbered and audited' : 'would change; re-run with --apply to write'}.`
      : '\nEvery project is already numbered 1…n; nothing to do.',
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
