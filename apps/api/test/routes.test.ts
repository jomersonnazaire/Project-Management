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
      'GET /templates templates.view',
      'GET /templates/:id templates.view',
      'POST /templates templates.create',
      'PATCH /templates/:id templates.edit',
      'POST /templates/:id/new-version templates.edit',
      'POST /templates/:id/publish templates.edit',
      'POST /templates/:id/duplicate templates.create',
      'POST /templates/:id/archive templates.edit',
      'POST /templates/:id/restore templates.edit',
      'DELETE /templates/:id templates.delete',
      'GET /projects/:id/tasks tasks.view',
      'GET /projects/:id/phases tasks.view',
      'DELETE /projects/:id/phases tasks.delete',
      'POST /projects/:id/tasks tasks.create',
      'POST /projects/:id/tasks/reorder tasks.edit',
      'GET /tasks/mine tasks.view',
      'GET /tasks/:id tasks.view',
      'GET /tasks/:id/history tasks.view',
      'PATCH /tasks/:id tasks.edit',
      'POST /tasks/:id/status tasks.edit',
      'POST /tasks/:id/unblock tasks.edit',
      'POST /tasks/:id/approve approvals.edit',
      'POST /tasks/:id/reject approvals.edit',
      'POST /tasks/:id/evidence tasks.edit',
      'DELETE /tasks/:id/evidence/:evidenceId tasks.edit',
      'POST /tasks/:id/follow-ups tasks.edit',
      'DELETE /tasks/:id tasks.delete',
      'GET /people projects.view',
      'GET /projects projects.view',
      'GET /projects/:id projects.view',
      'POST /projects projects.create',
      'PATCH /projects/:id projects.edit',
      'POST /projects/:id/archive projects.edit',
      'POST /projects/:id/unarchive projects.edit',
      'DELETE /projects/:id projects.delete',
      'GET /projects/:id/contact-options projects.edit',
      'POST /projects/:id/contacts projects.edit',
      'DELETE /projects/:id/contacts/:contactId projects.edit',
      'GET /projects/:id/activity projects.view',
      'GET /access-rules accessRules.view',
      'PUT /access-rules/:role accessRules.edit',
      'POST /access-rules/:role/reset accessRules.edit',
      'GET /audit audit.view',
      'GET /settings/calendar settings.view',
      'PUT /settings/working-days settings.edit',
      'GET /settings/holidays/impact settings.view',
      'POST /settings/holidays settings.edit',
      'PATCH /settings/holidays/:id settings.edit',
      'DELETE /settings/holidays/:id settings.edit',
      'POST /settings/holidays/copy settings.edit',
      'POST /settings/holidays/official settings.edit',
      'GET /time time.view',
      'GET /time/options time.create',
      'POST /time time.create',
      'PATCH /time/:id time.edit',
      'DELETE /time/:id authenticated',
      'GET /projects/:id/time time.view',
      'GET /projects/:id/folders documents.view',
      'POST /projects/:id/folders documents.create',
      'PATCH /projects/:id/folders/:folderId documents.edit',
      'DELETE /projects/:id/folders/:folderId documents.delete',
      'PUT /projects/:id/folders/:folderId/access documents.edit',
      'GET /projects/:id/documents documents.view',
      'GET /projects/:id/documents/:docId documents.view',
      'POST /projects/:id/documents/uploads documents.create',
      'GET /projects/:id/request-parties documents.view',
      'POST /projects/:id/documents/requests documents.create',
      'POST /projects/:id/documents/:docId/cancel documents.create',
      'GET /projects/:id/documents/:docId/download documents.view',
      'PATCH /projects/:id/documents/:docId documents.edit',
      'POST /projects/:id/documents/:docId/archive documents.edit',
      'POST /projects/:id/documents/:docId/restore documents.edit',
      'POST /tasks/:id/evidence/uploads tasks.edit',
      'GET /tasks/:id/evidence/:evidenceId/download tasks.view',
      'POST /issues/:id/attachments/uploads issues.edit',
      'GET /issues/:id/attachments/:documentId/download issues.view',
      'PUT /uploads/:id/blob authenticated',
      'POST /uploads/:id/complete authenticated',
      'GET /document-requests/waiting-on-client reports.view',
      'GET /document-requests/mine documents.view',
      'GET /notifications notifications.view',
      'GET /notifications/unread-count notifications.view',
      'POST /notifications/read-all notifications.view',
      'POST /notifications/:id/read notifications.view',
      'GET /projects/:id/messages conversations.view',
      'POST /projects/:id/messages conversations.create',
      'POST /projects/:id/messages/:messageId/hide conversations.view',
      'GET /projects/:id/issues issues.view',
      'GET /projects/:id/issue-options issues.view',
      'POST /projects/:id/issues issues.create',
      'GET /issues issues.view',
      'GET /issues/:id issues.view',
      'GET /issues/:id/activity issues.view',
      'PATCH /issues/:id issues.edit',
      'POST /issues/:id/status issues.edit',
      'POST /issues/:id/comments issues.view',
      'DELETE /issues/:id issues.delete',
    ]);
  });
});
