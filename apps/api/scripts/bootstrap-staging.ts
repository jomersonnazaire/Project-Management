/**
 * Staging bootstrap (NFR-26): prepares the separate staging database (e.g. pm-staging on the same
 * Atlas cluster) that previews and QA use, so production holds real data only.
 *
 * Idempotent; refuses to run unless MONGODB_DB_NAME contains "staging". It:
 *   1. seeds the default access rules and the SAP B1 launch template (as the API does on start);
 *   2. creates or updates the QA test accounts from the env (QA_<KEY>_EMAIL / QA_<KEY>_ROLE for
 *      ADMIN, PM, PM2, MEMBER, OUTSIDER, VIEWER, DEACTIVATED, sharing QA_TEST_PASSWORD), the same
 *      variables as qa-test-accounts.env; passwords are reset to QA_TEST_PASSWORD on every run;
 *   3. loads the official Philippine holidays for 2026 and 2027;
 *   4. creates a QA client with an active contact and the QA projects: "QA M3 – Ready to activate"
 *      (AC-10.3) and "QA M3.5 – Completed with open issue" (AC-44.1).
 * Nothing secret is printed. Usage (env file never committed):
 *   node --env-file=staging.env bootstrap-staging.mjs      (bundled)
 *   npm run bootstrap:staging --workspace @xc8/api          (from source, reads apps/api/.env)
 */
import {
  OFFICIAL_HOLIDAY_YEARS,
  PASSWORD_POLICY_MESSAGE,
  SYSTEM_ROLES,
  isPasswordValid,
  type JobRole,
  type SystemRole,
} from '@xc8/shared';
import { connectDb, disconnectDb } from '../src/db.js';
import { ClientContactModel, ClientModel, UserModel } from '../src/models/index.js';
import {
  addMissingRecordTypes,
  applyAccessDefaultChanges,
} from '../src/services/accessDefaults.js';
import { ensureDefaultAccessRules } from '../src/services/accessRules.js';
import { ensureLaunchTemplate } from '../src/services/launchTemplate.js';
import { loadOfficialHolidays } from '../src/services/officialHolidays.js';
import { hashPassword } from '../src/services/passwords.js';
import {
  assertStagingDb,
  need,
  qaPeople,
  seedCompletedProject,
  seedReadyProject,
} from './lib/qaSeeds.js';

const ACCOUNTS: { key: string; name: string; jobRole: JobRole; active?: boolean }[] = [
  { key: 'ADMIN', name: 'Ana Admin', jobRole: 'PROJECT_MANAGER' },
  { key: 'PM', name: 'Paolo PM', jobRole: 'PROJECT_MANAGER' },
  { key: 'PM2', name: 'Pia PM', jobRole: 'PROJECT_MANAGER' },
  { key: 'MEMBER', name: 'Maria Member', jobRole: 'CONSULTANT' },
  { key: 'OUTSIDER', name: 'Oscar Outsider', jobRole: 'DEVELOPER' },
  { key: 'VIEWER', name: 'Vera Viewer', jobRole: 'SUPPORT' },
  { key: 'DEACTIVATED', name: 'Dino Deactivated', jobRole: 'CONSULTANT', active: false },
];
export const QA_STAGING_CLIENT = 'QA Staging Client';

/** Accepts "PROJECT_MANAGER" or the label form used in qa-test-accounts.env ("Project Manager",
 * "Member (deactivated, cannot sign in)"). */
export function parseRole(raw: string | undefined): SystemRole | null {
  const key = (raw ?? '')
    .split('(')[0]!
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return (SYSTEM_ROLES as readonly string[]).includes(key) ? (key as SystemRole) : null;
}

async function seedAccounts() {
  const password = need('QA_TEST_PASSWORD');
  if (!isPasswordValid(password)) throw new Error(`QA_TEST_PASSWORD: ${PASSWORD_POLICY_MESSAGE}`);
  const hash = await hashPassword(password);
  let n = 0;
  for (const a of ACCOUNTS) {
    const email = process.env[`QA_${a.key}_EMAIL`]?.trim().toLowerCase();
    if (!email) {
      console.log(`QA account ${a.key}: skipped (QA_${a.key}_EMAIL not set)`);
      continue;
    }
    const role = parseRole(process.env[`QA_${a.key}_ROLE`]);
    if (!role) throw new Error(`QA_${a.key}_ROLE must be a system role.`);
    const active = a.active ?? true;
    await UserModel.updateOne(
      { email },
      {
        $set: {
          systemRole: role,
          jobRole: a.jobRole,
          active,
          deactivatedAt: active ? null : new Date(),
          passwordHash: hash,
          mustChangePassword: false,
          invite: null,
          failedLogins: 0,
          lockedUntil: null,
        },
        $setOnInsert: { email, name: process.env[`QA_${a.key}_NAME`] ?? a.name },
      },
      { upsert: true },
    );
    n += 1;
    console.log(`QA account ${a.key}: ${role}${active ? '' : ' (deactivated)'}`);
  }
  return n;
}

async function seedClient() {
  const nameKey = QA_STAGING_CLIENT.toLowerCase();
  const client = await ClientModel.findOneAndUpdate(
    { nameKey },
    {
      $set: { name: QA_STAGING_CLIENT, active: true },
      $setOnInsert: { nameKey, industry: 'Distribution', address: 'Cebu City' },
    },
    { upsert: true, new: true },
  );
  await ClientContactModel.updateOne(
    { clientId: client._id, name: 'Rosa Santos' },
    {
      $set: { active: true, position: 'Finance Manager', email: 'rosa.santos@client.example' },
    },
    { upsert: true },
  );
  return client;
}

async function main() {
  const db = assertStagingDb(process.env.MONGODB_DB_NAME);
  await connectDb(need('MONGODB_URI'), db);
  console.log(`Bootstrapping staging database "${db}"`);

  const rules = await ensureDefaultAccessRules();
  await addMissingRecordTypes();
  await applyAccessDefaultChanges();
  console.log(`Access rules: ${rules ? `seeded ${rules} role(s)` : 'already present'}`);
  console.log(`Launch template: ${(await ensureLaunchTemplate()) ? 'seeded' : 'already present'}`);

  console.log(`QA accounts: ${await seedAccounts()} created or updated`);

  for (const year of OFFICIAL_HOLIDAY_YEARS) {
    const r = await loadOfficialHolidays(year);
    console.log(`Philippine holidays ${year}: ${r.added} added, ${r.skipped} already there`);
  }

  await seedClient();
  const people = await qaPeople(need('QA_PM_EMAIL'), need('QA_MEMBER_EMAIL'));
  await seedReadyProject(people, QA_STAGING_CLIENT);
  await seedCompletedProject(people, QA_STAGING_CLIENT);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
