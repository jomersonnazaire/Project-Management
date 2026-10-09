/**
 * Local MongoDB for development without Docker: a single-node replica set
 * (transactions need a replica set) via mongodb-memory-server, with data kept in
 * `.data/mongo` so it survives restarts. Prints the connection string to use as MONGODB_URI.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const port = Number(process.env.DEV_DB_PORT ?? 27027);
const dbPath = resolve(process.env.DEV_DB_PATH ?? '../../.data/mongo');
mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  instanceOpts: [{ port, dbPath }],
});

const uri = replSet.getUri();
console.log('\nMongoDB replica set running (data in ' + dbPath + ').');
console.log(`MONGODB_URI=${uri}\n`);
console.log('Press Ctrl+C to stop.');

const stop = async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
