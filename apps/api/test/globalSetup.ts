import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/** One in-memory MongoDB replica set for the whole run; each test file uses its own database. */
export default async function setup(project: TestProject) {
  const replSet = await MongoMemoryReplSet.create({
    // Tests pin the injectable clock (setTestTime), often to past dates, so documents such as
    // sessions get expiresAt values that are already in the past by REAL time. mongod's TTL
    // monitor deletes by real wall-clock time (~every 60 s), which removed live test sessions
    // mid-test and surfaced as random 401s. No test relies on TTL deletion, so turn it off.
    instanceOpts: [{ args: ['--setParameter', 'ttlMonitorEnabled=false'] }],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
