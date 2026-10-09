/**
 * QA seed: one project where every task already has an accountable owner, so it can be moved to
 * Active straight away (AC-10.3) and then On Hold to check that time logging is blocked.
 *
 * Idempotent: the project is matched by name. If it exists, only tasks still missing an owner get
 * one; nothing else is changed. People come from env vars (never committed):
 *   MONGODB_URI, MONGODB_DB_NAME     database
 *   QA_PM_EMAIL                      project manager (also a member)
 *   QA_MEMBER_EMAIL                  owner of every task (a Member, so they can log time)
 *   QA_SEED_CLIENT (optional)        client name; defaults to the first client with an active contact
 * Usage: npm run seed:qa-project --workspace @xc8/api
 */
import { connectDb, disconnectDb } from '../src/db.js';
import { need, qaPeople, seedReadyProject } from './lib/qaSeeds.js';

export { QA_PROJECT_NAME } from './lib/qaSeeds.js';

async function main() {
  await connectDb(need('MONGODB_URI'), process.env.MONGODB_DB_NAME);
  const people = await qaPeople(need('QA_PM_EMAIL'), need('QA_MEMBER_EMAIL'));
  await seedReadyProject(people, process.env.QA_SEED_CLIENT);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
