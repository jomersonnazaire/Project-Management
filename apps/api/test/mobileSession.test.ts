import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { SessionModel } from '../src/models/index.js';
import { CSRF, PASSWORD, createUser, makeApp, useDatabase } from './helpers.js';

useDatabase();
const app = makeApp();
const HOUR = 3_600_000;

describe('Mobile sessions (X-Client: mobile): sliding 3-day idle window', () => {
  it('gets a 72 h idle expiry that slides on activity; web keeps the 30 min default', async () => {
    const user = await createUser({ systemRole: 'MEMBER' });
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/login')
      .set(CSRF)
      .set('X-Client', 'mobile')
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    const s = await SessionModel.findOne({ userId: user._id }).lean();
    expect(s!.idleMinutes).toBe(72 * 60);
    expect(s!.expiresAt.getTime() - s!.lastSeenAt.getTime()).toBe(72 * HOUR);

    // Two days later the session is still alive and its expiry slides forward.
    const later = new Date(s!.lastSeenAt.getTime() + 48 * HOUR);
    vi.useFakeTimers({ now: later, toFake: ['Date'] });
    try {
      expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
      const s2 = await SessionModel.findById(s!._id).lean();
      expect(s2!.expiresAt.getTime()).toBe(later.getTime() + 72 * HOUR);
      // 72 h + 1 min of inactivity ends it.
      vi.setSystemTime(new Date(later.getTime() + 72 * HOUR + 60_000));
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }

    const web = await createUser({ systemRole: 'MEMBER' });
    await request(app).post('/api/v1/auth/login').set(CSRF).send({ email: web.email, password: PASSWORD });
    const w = await SessionModel.findOne({ userId: web._id }).lean();
    expect(w!.idleMinutes).toBeNull();
    expect(w!.expiresAt.getTime() - w!.lastSeenAt.getTime()).toBe(30 * 60_000);
  });
});
