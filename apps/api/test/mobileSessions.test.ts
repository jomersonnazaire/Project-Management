import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionModel } from '../src/models/index.js';
import { CSRF, PASSWORD, createUser, login, makeApp, useDatabase } from './helpers.js';

useDatabase();
const app = makeApp();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const mobileLogin = (email: string, headers: Record<string, string> = {}) =>
  request(app)
    .post('/api/v1/auth/mobile/login')
    .set(CSRF)
    .set(headers)
    .send({ email, password: PASSWORD });
const me = (token: string, headers: Record<string, string> = {}) =>
  request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).set(headers);
const refresh = (token: string) =>
  request(app)
    .post('/api/v1/auth/mobile/refresh')
    .set(CSRF)
    .set('Authorization', `Bearer ${token}`);

/** Moves the clock; the API reads Date.now(). */
function at(ms: number) {
  vi.useFakeTimers({ now: ms, toFake: ['Date'] });
}
afterEach(() => vi.useRealTimers());

describe('Mobile sessions (FR-AUTH-03 mobile exception)', () => {
  it('mobile login returns a body token (no cookie), stored hashed, 3-day sliding window, no cap', async () => {
    const u = await createUser();
    const res = await mobileLogin(u.email);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.id).toBe(u._id.toString());
    const s = await SessionModel.findOne({ userId: u._id }).lean();
    expect(s!.kind).toBe('mobile');
    expect(s!.tokenHash).not.toBe(res.body.token);
    expect(s!.tokenHash).toHaveLength(64);
    expect(s!.expiresAt.getTime() - s!.lastSeenAt.getTime()).toBe(72 * HOUR);
    expect(s!.absoluteExpiresAt.getUTCFullYear()).toBe(9999);
    expect((await me(res.body.token)).status).toBe(200);
  });

  it('idle expiry: 3 days + 1 min without activity → 401', async () => {
    const u = await createUser();
    const { body } = await mobileLogin(u.email);
    at(Date.now() + 3 * DAY + 60_000);
    const r = await me(body.token);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('SESSION_EXPIRED');
    expect((await refresh(body.token)).status).toBe(401);
  });

  it('refresh and API activity extend the window by 3 days, beyond the web 12 h max', async () => {
    const u = await createUser();
    const { body } = await mobileLogin(u.email);
    let t = Date.now();
    for (let i = 0; i < 4; i++) {
      t += 2 * DAY; // 8 days in total, each gap < 3 days
      at(t);
      const r = await refresh(body.token);
      expect(r.status).toBe(200);
      expect(new Date(r.body.expiresAt).getTime()).toBe(t + 3 * DAY);
    }
    t += 2 * DAY;
    at(t);
    expect((await me(body.token)).status).toBe(200); // plain activity also slides
    const s = await SessionModel.findOne({ userId: u._id }).lean();
    expect(s!.expiresAt.getTime()).toBe(t + 3 * DAY);
  });

  it('optional hard cap via MOBILE_SESSION_MAX_DAYS', async () => {
    const capped = makeApp({ MOBILE_SESSION_MAX_DAYS: '5' });
    const u = await createUser();
    const { body } = await request(capped)
      .post('/api/v1/auth/mobile/login')
      .set(CSRF)
      .send({ email: u.email, password: PASSWORD });
    const t0 = Date.now();
    at(t0 + 2 * DAY);
    await request(capped)
      .post('/api/v1/auth/mobile/refresh')
      .set(CSRF)
      .set('Authorization', `Bearer ${body.token}`);
    at(t0 + 4 * DAY);
    const r = await request(capped)
      .post('/api/v1/auth/mobile/refresh')
      .set(CSRF)
      .set('Authorization', `Bearer ${body.token}`);
    expect(new Date(r.body.expiresAt).getTime()).toBeLessThanOrEqual(t0 + 5 * DAY + 1000);
    at(t0 + 5 * DAY + 60_000);
    expect(
      (await request(capped).get('/api/v1/auth/me').set('Authorization', `Bearer ${body.token}`))
        .status,
    ).toBe(401);
  });

  it.each([
    ['Origin', { Origin: 'http://localhost:5173' }],
    ['Sec-Fetch-Mode', { 'Sec-Fetch-Mode': 'cors' }],
    ['Sec-Fetch-Site', { 'Sec-Fetch-Site': 'same-origin' }],
    ['Cookie', { Cookie: 'a=b' }],
    ['Referer', { Referer: 'http://localhost:5173/' }],
  ])('a browser cannot opt in: mobile login with %s is refused', async (_n, h) => {
    const u = await createUser();
    const r = await mobileLogin(u.email, h);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MOBILE_ONLY');
    expect(await SessionModel.countDocuments({ userId: u._id })).toBe(0);
  });

  it('a browser cannot use a mobile token, and X-Client does nothing', async () => {
    const u = await createUser();
    const { body } = await mobileLogin(u.email);
    expect((await me(body.token, { Origin: 'http://localhost:5173' })).status).toBe(401);
    expect((await me(body.token, { 'Sec-Fetch-Mode': 'cors' })).status).toBe(401);
    // Mobile token as a cookie is rejected; web cookie as a bearer is rejected.
    const asCookie = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `xc8_sid=${body.token}`);
    expect(asCookie.status).toBe(401);
    const web = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .set('X-Client', 'mobile')
      .send({ email: u.email, password: PASSWORD });
    const sid = String(web.headers['set-cookie']).match(/xc8_sid=([^;]+)/)![1]!;
    expect((await me(sid)).status).toBe(401);
    const ws = await SessionModel.findOne({ userId: u._id, kind: 'web' }).lean();
    expect(ws!.expiresAt.getTime() - ws!.lastSeenAt.getTime()).toBe(30 * 60_000);
    // CORS never allows the Authorization header.
    const pre = await request(app)
      .options('/api/v1/auth/me')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(String(pre.headers['access-control-allow-headers'] ?? '')).not.toMatch(/authorization/i);
  });

  it('web sessions unaffected: 30 min idle, 12 h max', async () => {
    const u = await createUser();
    const agent = await login(app, u.email);
    const s = await SessionModel.findOne({ userId: u._id }).lean();
    expect(s!.kind).toBe('web');
    expect(s!.absoluteExpiresAt.getTime() - s!.lastSeenAt.getTime()).toBe(12 * HOUR);
    at(Date.now() + 31 * 60_000);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('web cookie session cannot call refresh; mobile logout ends the session', async () => {
    const u = await createUser();
    const agent = await login(app, u.email);
    expect((await agent.post('/api/v1/auth/mobile/refresh').set(CSRF)).status).toBe(403);
    const { body } = await mobileLogin(u.email);
    const out = await request(app)
      .post('/api/v1/auth/mobile/logout')
      .set(CSRF)
      .set('Authorization', `Bearer ${body.token}`);
    expect(out.status).toBe(204);
    expect((await me(body.token)).status).toBe(401);
  });
});
