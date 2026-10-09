/**
 * QA seed for AC-44.1: a fully Completed project with one open issue (QA project in production,
 * like "QA M3 – Ready to activate"; owned by the QA Member, managed by the QA PM).
 * Re-runnable: matched by name; re-runs only complete what is left and re-raise a missing issue.
 *   MONGODB_URI, MONGODB_DB_NAME     database
 *   QA_PM_EMAIL, QA_MEMBER_EMAIL     project manager and task owner
 *   QA_SEED_CLIENT (optional)        client name; defaults to the first client with an active contact
 * Usage: npm run seed:qa-completed --workspace @xc8/api
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { need, qaPeople, seedCompletedProject } from './lib/qaSeeds.js';

async function main() {
  await connectDb(need('MONGODB_URI'), process.env.MONGODB_DB_NAME);
  const people = await qaPeople(need('QA_PM_EMAIL'), need('QA_MEMBER_EMAIL'));
  await seedCompletedProject(people, process.env.QA_SEED_CLIENT);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
