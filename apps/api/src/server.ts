import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { createLogger } from './logger.js';
import {
  addMissingCells,
  addMissingRecordTypes,
  applyAccessDefaultChanges,
} from './services/accessDefaults.js';
import { ensureDefaultAccessRules } from './services/accessRules.js';
import { runIssueSweeps } from './services/issues.js';
import { ensureLaunchTemplate } from './services/launchTemplate.js';
import { migrateModuleText } from './services/moduleText.js';
import { migrateProjectCodes } from './services/projectCodes.js';
import { ensureDefaultLookups, sweepAutoStop } from './services/tracker.js';
import { ensureDefaultLeaveTypes } from './services/leave.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

await connectDb(config.MONGODB_URI, config.MONGODB_DB_NAME);
// Seed the default access rules if a role has none yet (idempotent; never overwrites changes).
await ensureDefaultAccessRules(logger);
// Record types added since the grids were saved (e.g. Issues) get their default row.
await addMissingRecordTypes(logger);
// Doc 11 v0.4.8: Reports Export cells start from each role's current Reports View.
await addMissingCells(logger);
// Apply pending changes to the defaults once (doc 11 §12): only cells still at the old default.
await applyAccessDefaultChanges(logger);
// Seed the SAP B1 launch template once (idempotent; never touches it after that, FR-TPL-09).
await ensureLaunchTemplate(logger);
// DR-23: every project gets a unique code and issues use it as their ID prefix (idempotent).
await migrateProjectCodes(logger);
// M5/M7: seed the Activity types and Locations lists, and the leave types, once.
await ensureDefaultLookups(logger);
// FR-ACT-21: Module is free text; copy old Modules-list names into it (idempotent).
await migrateModuleText(logger);
await ensureDefaultLeaveTypes(logger);
const app = createApp(config, logger);
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
});

// Issue housekeeping (FR-ISS-06 auto-close, FR-ISS-10 overdue reminders): on start, then hourly.
const sweep = () =>
  runIssueSweeps({ force: true, logger }).catch((err: unknown) =>
    logger.error({ err }, 'Issue sweep failed'),
  );
void sweep();
setInterval(() => void sweep(), 60 * 60 * 1000).unref();

// FR-ACT-04, EC-75: timers left running stop at 23:59 PHT. Checked every 5 minutes, and lazily on
// the owner's tracker requests. The recorded end time is capped by stopEntry (23:59, or earlier if
// the day would pass 24 hours), so it doesn't depend on when the sweep runs. Audited as
// `timer_auto_stopped` with a system actor.
const timers = () =>
  sweepAutoStop()
    .then((n) => n && logger.info({ stopped: n }, 'Auto-stopped timers'))
    .catch((err: unknown) => logger.error({ err }, 'Timer sweep failed'));
void timers();
setInterval(() => void timers(), 5 * 60 * 1000).unref();

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void disconnectDb().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
