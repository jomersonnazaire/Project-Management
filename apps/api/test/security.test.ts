import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  CSRF,
  PASSWORD,
  appWithCapturedLogs,
  createUser,
  makeApp,
  signedInAs,
  useDatabase,
} from './helpers.js';

useDatabase();
const app = makeApp();

describe('Security (section K)', () => {
  it('TC-K02 rejects NoSQL operator injection in bodies and query strings', async () => {
    await createUser({ email: 'victim@xceler8.example' });
    const body = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(body.status).toBe(400);
    const where = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: 'victim@xceler8.example', password: PASSWORD, $where: '1' });
    expect(where.status).toBe(400);
    const { agent } = await signedInAs(app, 'ADMIN');
    expect((await agent.get('/api/v1/users?q[$ne]=x')).status).toBe(400);
    expect((await agent.get('/api/v1/users?role[$gt]=')).status).toBe(400);
  });

  it('TC-A10 / NFR-03 rejects state-changing requests without the CSRF header or from other origins', async () => {
    const user = await createUser();
    const noHeader = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe('CSRF_REJECTED');
    const evil = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .set('Origin', 'https://evil.example')
      .send({ email: user.email, password: PASSWORD });
    expect(evil.status).toBe(403);
    const preview = await request(app)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .set('Origin', 'https://xc8-pm-git-feature-x.vercel.app')
      .send({ email: user.email, password: PASSWORD });
    expect(preview.status).toBe(200);
  });

  it('CORS allows only configured origins, with credentials', async () => {
    const ok = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('TC-K05 / NFR-08 sends Helmet security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('uses the consistent error shape for 404 and invalid ids (no leak)', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const missing = await agent.get('/api/v1/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toEqual({ code: 'NOT_FOUND', message: 'Not found.' });
    expect((await agent.get('/api/v1/users/not-an-id')).status).toBe(404);
    expect((await agent.get('/api/v1/users/0123456789abcdef01234567')).status).toBe(404);
    const badJson = await agent
      .post('/api/v1/teams')
      .set(CSRF)
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expect(badJson.status).toBe(400);
  });

  it('TC-K06 / NFR-18 never logs passwords, cookies or invite tokens', async () => {
    const { app: logged, lines } = appWithCapturedLogs();
    const user = await createUser();
    const res = await request(logged)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ email: user.email, password: PASSWORD });
    const sid = String(res.headers['set-cookie']).split(';')[0]!.split('=')[1]!;
    await request(logged).get('/api/v1/auth/me').set('Cookie', `xc8_sid=${sid}`);
    // A stray old-style link with the token in the path (now 404) is redacted too.
    await request(logged).get('/api/v1/auth/invite/secret-invite-token-1234567890');
    await request(logged)
      .post('/api/v1/auth/invite/verify')
      .set(CSRF)
      .send({ token: 'secret-invite-token-1234567890' });
    await request(logged)
      .post('/api/v1/auth/setup-password')
      .set(CSRF)
      .send({ token: 'secret-invite-token-1234567890', password: 'Never-logged-pass-1!' });
    const all = lines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain(sid);
    expect(all).not.toContain('secret-invite-token-1234567890');
    expect(all).not.toContain('Never-logged-pass-1!');
    expect(all).toContain('/api/v1/auth/invite/verify');
  });

  it('TC-K07 stores and returns HTML as plain JSON text (rendered as text by React)', async () => {
    const { agent } = await signedInAs(app, 'ADMIN');
    const res = await agent
      .post('/api/v1/clients')
      .set(CSRF)
      .send({ name: '<img src=x onerror=alert(1)>' });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.client.name).toBe('<img src=x onerror=alert(1)>');
  });
});
