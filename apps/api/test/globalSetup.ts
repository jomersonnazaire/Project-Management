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
    // Tests fake "now" (setTestTime) days before the real clock, so session expiresAt is
    // already in the past for mongod. Its TTL monitor would delete live sessions mid-test (401).
    replSet: {
      count: 1,
      storageEngine: 'wiredTiger',
      args: ['--setParameter', 'ttlMonitorEnabled=false'],
    },
  });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
