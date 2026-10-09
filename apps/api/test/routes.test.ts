import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AUTHENTICATED, PUBLIC, perm, type RouteEntry } from '../src/access/registry.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';

useDatabase();

describe('Unknown routes are denied by default (doc 11 §8)', () => {
  const undeclared = vi.fn((_req, res) => res.json({ leaked: true }));
  const declared = vi.fn((_req, res) => res.json({ ok: true }));
  const app = makeApp({}, (registry) => {
    // A handler added straight on an Express router, without declaring a policy.
    const raw = Router();
    raw.get('/__undeclared', undeclared);
    raw.post('/__undeclared', undeclared);
    raw.delete('/clients/:id', undeclared);
    const secured = registry.router('/__declared');
    secured.get('/', perm('teams', 'view'), declared);
    secured.get('/me', AUTHENTICATED, declared);
    secured.get('/open', PUBLIC, declared);
    // Express merges both; the raw router is mounted after the secured one.
    const both = Router();
    both.use(secured.router, raw);
    return both;
  });

  it('a route without a declared policy never runs, for anyone', async () => {
    const admin = await signedInAs(app, 'ADMIN');
    for (const agent of [admin.agent, request.agent(app)]) {
      const get = await agent.get('/api/v1/__undeclared');
      expect(get.status).toBe(404);
      expect(get.body.error).toEqual({ code: 'NOT_FOUND', message: 'Not found.' });
      expect((await agent.post('/api/v1/__undeclared').set(CSRF).send({})).status).toBe(404);
      // A method that isn't declared on a known path is denied too.
      expect(
        (await agent.delete('/api/v1/clients/0123456789abcdef01234567').set(CSRF)).status,
      ).toBe(404);
    }
    expect(undeclared).not.toHaveBeenCalled();
  });

  it('declared routes apply their policy', async () => {
    expect((await request(app).get('/api/v1/__declared/open')).status).toBe(200);
    expect((await request(app).get('/api/v1/__declared/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/__declared')).status).toBe(401);
    const member = await signedInAs(app, 'MEMBER');
    expect((await member.agent.get('/api/v1/__declared/me')).status).toBe(200);
    expect((await member.agent.get('/api/v1/__declared')).status).toBe(403);
    const admin = await signedInAs(app, 'ADMIN');
    expect((await admin.agent.get('/api/v1/__declared/')).status).toBe(200);
    expect((await admin.agent.head('/api/v1/__declared')).status).toBe(200);
  });

  it('a route can’t be declared twice', () => {
    expect(() =>
      makeApp({}, (registry) => {
        const r = registry.router('/x');
        r.get('/', PUBLIC, declared);
        r.get('/', AUTHENTICATED, declared);
        return r.router;
      }),
    ).toThrow(/declared twice/);
  });
});

describe('Route policy table', () => {
  it('every API route declares its access policy (snapshot of the whole table)', () => {
    const app = makeApp();
    const entries = app.locals.routes as RouteEntry[];
    const table = entries.map((e) => {
      const p = e.policy;
      return `${e.method} ${e.path} ${p.kind === 'permission' ? `${p.record}.${p.action}` : p.kind}`;
    });
    expect(table).toEqual([
      'GET /health public',
      'POST /auth/login public',
      'POST /auth/logout public',
      'GET /auth/me authenticated',
      'GET /auth/me/permissions authenticated',
      'POST /auth/invite/verify public',
      'POST /auth/setup-password public',
      'POST /auth/change-password authenticated',
      'GET /users users.view',
      'GET /users/:id users.view',
      'POST /users users.create',
      'PATCH /users/:id users.edit',
      'POST /users/:id/deactivate users.delete',
      'POST /users/:id/reactivate users.delete',
      'POST /users/:id/invite users.edit',
      'GET /teams teams.view',
      'POST /teams teams.create',
      'PATCH /teams/:id teams.edit',
      'POST /teams/:id/archive teams.delete',
      'POST /teams/:id/unarchive teams.delete',
      'GET /clients clients.view',
      'GET /clients/:id clients.view',
      'POST /clients clients.create',
      'PATCH /clients/:id clients.edit',
      'POST /clients/:id/deactivate clients.delete',
      'POST /clients/:id/reactivate clients.delete',
      'GET /clients/:id/contacts contacts.view',
      'POST /clients/:id/contacts contacts.create',
      'GET /clients/:id/projects projects.view',
      'GET /contacts contacts.view',
      'GET /contacts/:id contacts.view',
      'PATCH /contacts/:id contacts.edit',
      'POST /contacts/:id/deactivate contacts.delete',
      'POST /contacts/:id/reactivate contacts.delete',
      'GET /access-rules accessRules.view',
      'PUT /access-rules/:role accessRules.edit',
      'POST /access-rules/:role/reset accessRules.edit',
      'GET /audit audit.view',
    ]);
  });
});
