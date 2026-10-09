import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

await connectDb(config.MONGODB_URI, config.MONGODB_DB_NAME);
const app = createApp(config, logger);
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void disconnectDb().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
