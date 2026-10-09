import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { createLogger } from './logger.js';
import { addMissingRecordTypes, applyAccessDefaultChanges } from './services/accessDefaults.js';
import { ensureDefaultAccessRules } from './services/accessRules.js';
import { runIssueSweeps } from './services/issues.js';
import { ensureLaunchTemplate } from './services/launchTemplate.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

await connectDb(config.MONGODB_URI, config.MONGODB_DB_NAME);
// Seed the default access rules if a role has none yet (idempotent; never overwrites changes).
await ensureDefaultAccessRules(logger);
// Record types added since the grids were saved (e.g. Issues) get their default row.
await addMissingRecordTypes(logger);
// Apply pending changes to the defaults once (doc 11 §12): only cells still at the old default.
await applyAccessDefaultChanges(logger);
// Seed the SAP B1 launch template once (idempotent; never touches it after that, FR-TPL-09).
await ensureLaunchTemplate(logger);
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

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void disconnectDb().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
