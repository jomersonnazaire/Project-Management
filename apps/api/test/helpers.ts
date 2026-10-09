import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import mongoose from 'mongoose';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, inject } from 'vitest';
import type { JobRole, SystemRole } from '@xc8/shared';
import { createApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { connectDb } from '../src/db.js';
import { UserModel } from '../src/models/index.js';
import { hashPassword } from '../src/services/passwords.js';

export const PASSWORD = 'Correct-horse-42!';
export const CSRF = { 'X-Requested-With': 'xc8-web' } as const;

/** Connects this test file to its own database on the shared replica set. */
export function useDatabase() {
  beforeAll(async () => {
    await connectDb(inject('mongoUri'), `test_${randomUUID().slice(0, 8)}`);
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: inject('mongoUri'),
    COOKIE_SECURE: 'false',
    COOKIE_SAMESITE: 'lax',
    LOG_LEVEL: 'silent',
    AUTH_RATE_LIMIT_MAX: '1000',
    WEB_APP_URL: 'http://localhost:5173',
    CORS_ORIGINS: 'http://localhost:5173,https://xc8-pm-*.vercel.app',
    ...overrides,
  });
}

/** App whose log output is captured, to assert nothing secret is logged (NFR-18). */
export function appWithCapturedLogs(overrides: Record<string, string> = {}) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const logger = pino({ level: 'info' }, stream);
  const app = createApp(testConfig(overrides), logger);
  return { app, lines };
}

export function makeApp(
  overrides: Record<string, string> = {},
  extraRoutes?: Parameters<typeof createApp>[2],
) {
  return createApp(testConfig(overrides), undefined, extraRoutes);
}

let counter = 0;
export async function createUser(
  opts: {
    systemRole?: SystemRole;
    jobRole?: JobRole;
    email?: string;
    name?: string;
    active?: boolean;
    password?: string | null;
  } = {},
) {
  counter += 1;
  const password = opts.password === undefined ? PASSWORD : opts.password;
  return UserModel.create({
    name: opts.name ?? `User ${counter}`,
    email: opts.email ?? `user${counter}-${randomUUID().slice(0, 6)}@xceler8.example`,
    systemRole: opts.systemRole ?? 'MEMBER',
    jobRole: opts.jobRole ?? 'CONSULTANT',
    active: opts.active ?? true,
    passwordHash: password ? await hashPassword(password) : null,
    mustChangePassword: !password,
  });
}

export async function login(
  app: Parameters<typeof request.agent>[0],
  email: string,
  password = PASSWORD,
) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').set(CSRF).send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function signedInAs(app: Parameters<typeof request.agent>[0], systemRole: SystemRole) {
  const user = await createUser({ systemRole });
  const agent = await login(app, user.email);
  return { user, agent };
}
