/**
 * Idempotent seed with the Milestone 1 subset of the QA seed data (docs/qa/01_TEST_PLAN.md §4):
 * one user per access role, a second PM, a Member who isn't on the test project, a
 * deactivated user, teams, and two clients with three contacts each (one inactive).
 *
 * Passwords come from env vars and are never committed:
 *   SEED_ADMIN_PASSWORD  password for admin@xceler8.example
 *   SEED_USER_PASSWORD   password for every other seeded user
 * If a variable is missing, those users are created as "Invited" and a one-time setup
 * link is printed instead. Existing passwords are only replaced when SEED_RESET_PASSWORDS=true.
 *
 * Re-running the script updates the same records (matched by email / name); it never duplicates.
 */
import {
  isPasswordValid,
  PASSWORD_POLICY_MESSAGE,
  type JobRole,
  type SystemRole,
} from '@xc8/shared';
import { connectDb, disconnectDb } from '../src/db.js';
import { ClientContactModel, ClientModel, TeamModel, UserModel } from '../src/models/index.js';
import { ensureDefaultAccessRules } from '../src/services/accessRules.js';
import { hashPassword } from '../src/services/passwords.js';
import { newToken, sha256 } from '../src/services/tokens.js';

const DOMAIN = 'xceler8.example';

const TEAMS = ['Management', 'Consulting', 'Development', 'Support', 'QA', 'Technical'];

interface SeedUser {
  key: string;
  name: string;
  systemRole: SystemRole;
  jobRole: JobRole;
  teams: string[];
  active?: boolean;
}

const USERS: SeedUser[] = [
  {
    key: 'admin',
    name: 'Ada Admin',
    systemRole: 'ADMIN',
    jobRole: 'PROJECT_MANAGER',
    teams: ['Management'],
  },
  {
    key: 'pm',
    name: 'Paolo PM',
    systemRole: 'PROJECT_MANAGER',
    jobRole: 'PROJECT_MANAGER',
    teams: ['Management', 'Consulting'],
  },
  {
    key: 'pm2',
    name: 'Petra PM2',
    systemRole: 'PROJECT_MANAGER',
    jobRole: 'PROJECT_MANAGER',
    teams: ['Management'],
  },
  {
    key: 'member',
    name: 'Maria Member',
    systemRole: 'MEMBER',
    jobRole: 'CONSULTANT',
    teams: ['Consulting'],
  },
  // Member who will not be on the QA test project (Outsider in 02_TEST_CASES.md).
  {
    key: 'outsider',
    name: 'Oscar Outsider',
    systemRole: 'MEMBER',
    jobRole: 'DEVELOPER',
    teams: ['Development'],
  },
  {
    key: 'viewer',
    name: 'Vera Viewer',
    systemRole: 'VIEWER',
    jobRole: 'PROJECT_MANAGER',
    teams: ['Management'],
  },
  {
    key: 'deactivated',
    name: 'Dan Deactivated',
    systemRole: 'MEMBER',
    jobRole: 'SUPPORT',
    teams: ['Support'],
    active: false,
  },
];

const CLIENTS = [
  {
    name: 'Acme Trading',
    industry: 'Retail & distribution',
    address: 'Makati City, Metro Manila',
    contacts: [
      {
        name: 'R. Santos',
        department: 'Finance',
        position: 'Finance Manager',
        email: 'rsantos@acme.example',
        phone: '+63 2 8000 1001',
      },
      {
        name: 'L. Cruz',
        department: 'IT',
        position: 'IT Lead',
        email: 'lcruz@acme.example',
        phone: '+63 2 8000 1002',
      },
      {
        name: 'P. Gomez',
        department: 'Operations',
        position: 'Ops Supervisor',
        email: 'pgomez@acme.example',
        phone: null,
        active: false,
      },
    ],
  },
  {
    name: 'Northwind Foods',
    industry: 'Food manufacturing',
    address: 'Cebu City',
    contacts: [
      {
        name: 'J. Reyes',
        department: 'Purchasing',
        position: 'Purchasing Head',
        email: 'jreyes@northwind.example',
        phone: '+63 32 400 2001',
      },
      // Same email as an internal user on purpose (EC-21, TC-A06): sign-in must still only match the user.
      {
        name: 'M. Lim',
        department: 'Accounting',
        position: 'Chief Accountant',
        email: `member@${DOMAIN}`,
        phone: '+63 32 400 2002',
      },
      {
        name: 'K. Tan',
        department: 'Warehouse',
        position: 'Warehouse Manager',
        email: 'ktan@northwind.example',
        phone: null,
        active: false,
      },
    ],
  },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const userPassword = process.env.SEED_USER_PASSWORD;
  const reset = process.env.SEED_RESET_PASSWORDS === 'true';
  const webUrl = (process.env.WEB_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  for (const [name, value] of [
    ['SEED_ADMIN_PASSWORD', adminPassword],
    ['SEED_USER_PASSWORD', userPassword],
  ] as const) {
    if (value && !isPasswordValid(value)) throw new Error(`${name}: ${PASSWORD_POLICY_MESSAGE}`);
  }

  await connectDb(uri, process.env.MONGODB_DB_NAME);
  // Default access rules (doc 11 §6); never overwrites rules an Admin has changed.
  const seededRules = await ensureDefaultAccessRules();
  console.log(`Access rules: ${seededRules ? `seeded ${seededRules} role(s)` : 'already present'}`);

  const teamIds = new Map<string, string>();
  for (const name of TEAMS) {
    const team = await TeamModel.findOneAndUpdate(
      { nameKey: name.toLowerCase() },
      { $set: { name, archived: false }, $setOnInsert: { nameKey: name.toLowerCase() } },
      { upsert: true, new: true },
    );
    teamIds.set(name, team._id.toString());
  }

  const hashes = {
    admin: adminPassword ? await hashPassword(adminPassword) : null,
    user: userPassword ? await hashPassword(userPassword) : null,
  };

  const links: string[] = [];
  for (const u of USERS) {
    const email = `${u.key}@${DOMAIN}`;
    const existing = await UserModel.findOne({ email }).select('+passwordHash');
    const hash = u.key === 'admin' ? hashes.admin : hashes.user;
    const set: Record<string, unknown> = {
      name: u.name,
      systemRole: u.systemRole,
      jobRole: u.jobRole,
      teamIds: u.teams.map((t) => teamIds.get(t)),
      weeklyCapacityHours: 40,
      active: u.active ?? true,
      deactivatedAt: u.active === false ? (existing?.deactivatedAt ?? new Date()) : null,
    };
    if (hash && (reset || !existing?.passwordHash)) {
      Object.assign(set, {
        passwordHash: hash,
        mustChangePassword: false,
        invite: null,
        failedLogins: 0,
        lockedUntil: null,
      });
    } else if (!hash && !existing?.passwordHash && (u.active ?? true)) {
      const token = newToken();
      set.invite = {
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 72 * 3_600_000),
        invitedBy: null,
        purpose: 'INVITE',
      };
      links.push(`${email}: ${webUrl}/setup-password#token=${token}`);
    }
    await UserModel.updateOne({ email }, { $set: set, $setOnInsert: { email } }, { upsert: true });
  }

  for (const c of CLIENTS) {
    const client = await ClientModel.findOneAndUpdate(
      { nameKey: c.name.toLowerCase() },
      {
        $set: { name: c.name, industry: c.industry, address: c.address, active: true },
        $setOnInsert: { nameKey: c.name.toLowerCase() },
      },
      { upsert: true, new: true },
    );
    for (const contact of c.contacts) {
      const { active = true, ...fields } = contact;
      await ClientContactModel.updateOne(
        { clientId: client._id, name: contact.name },
        { $set: { ...fields, active } },
        { upsert: true },
      );
    }
  }

  const counts = {
    users: await UserModel.countDocuments(),
    teams: await TeamModel.countDocuments(),
    clients: await ClientModel.countDocuments(),
    contacts: await ClientContactModel.countDocuments(),
  };
  console.log('Seed complete:', counts);
  console.log(`Seeded users: ${USERS.map((u) => `${u.key}@${DOMAIN}`).join(', ')}`);
  if (links.length) {
    console.log('\nNo seed password set for these users. One-time setup links (valid 72 h):');
    for (const l of links) console.log(`  ${l}`);
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
