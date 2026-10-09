import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import type { RouteEntry } from '../src/access/registry.js';
import { SCOPED_COLLECTIONS } from '../src/access/recordScope.js';
import { NotificationModel, TaskModel, TimeEntryModel, UploadModel } from '../src/models/index.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';

/**
 * NFR-25 (DEF-005, DEF-006): every route that addresses a record by id answers 404 NOT_FOUND to a
 * user outside that record's scope, whatever the method and whatever the access rules say. 403 is
 * kept for records the user can see but lacks the action for.
 */
useDatabase();
const app = makeApp();

async function records() {
  const w = await world(app);
  const issue = await w.pm.agent
    .post(`/api/v1/projects/${w.project.id}/issues`)
    .set(CSRF)
    .send({ title: 'Scope probe', description: 'x', severity: 'LOW', stage: 'BEFORE_GO_LIVE' });
  expect(issue.status, JSON.stringify(issue.body)).toBe(201);
  const task = await TaskModel.findOne({ projectId: w.project.id }).lean();
  // Person-owned records (time entries, uploads, notifications) belong to the project Member; only
  // the owner field matters to the scope check, so they are inserted raw.
  const owned = { userId: w.member.user._id, projectId: new Types.ObjectId(w.project.id) };
  const time = await TimeEntryModel.collection.insertOne({ ...owned, taskId: task!._id });
  const upload = await UploadModel.collection.insertOne({ ...owned });
  const notification = await NotificationModel.collection.insertOne({ ...owned });
  const ids: Record<string, string> = {
    projects: w.project.id,
    tasks: task!._id.toString(),
    issues: issue.body.issue.id,
    time: time.insertedId.toString(),
    uploads: upload.insertedId.toString(),
    notifications: notification.insertedId.toString(),
    clients: w.acme.client.id,
    contacts: w.acme.active[0].id,
  };
  return { w, ids };
}

describe('NFR-25: records outside the caller’s scope answer 404 on every route', () => {
  it('an outsider gets 404 NOT_FOUND from every record route, for every method', async () => {
    const { w, ids } = await records();
    const entries = (app.locals.routes as RouteEntry[]).filter((e) => {
      const [, collection, param] = e.path.split('/');
      return param === ':id' && SCOPED_COLLECTIONS.includes(collection!);
    });
    // Every scoped collection has a resolver and at least one route (no silent gaps).
    expect(new Set(entries.map((e) => e.path.split('/')[1]))).toEqual(new Set(SCOPED_COLLECTIONS));
    expect(entries.length).toBeGreaterThan(60);

    const results: string[] = [];
    for (const e of entries) {
      const collection = e.path.split('/')[1]!;
      const url =
        '/api/v1' +
        e.path
          .replace(':id', ids[collection]!)
          .replace(/:[A-Za-z]+/g, () => new Types.ObjectId().toString());
      const method = e.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
      let req = w.outsider.agent[method](url);
      if (method !== 'get') req = req.set(CSRF).send({});
      const res = await req;
      results.push(`${e.method} ${e.path} -> ${res.status} ${res.body?.error?.code ?? ''}`.trim());
    }
    expect(results.filter((r) => !r.endsWith('-> 404 NOT_FOUND'))).toEqual([]);
  });

  it('DEF-006: an outsider deleting an issue gets 404; a Viewer who can see it gets 403', async () => {
    const { w, ids } = await records();
    const outsider = await w.outsider.agent.delete(`/api/v1/issues/${ids.issues}`).set(CSRF);
    expect([outsider.status, outsider.body.error?.code]).toEqual([404, 'NOT_FOUND']);
    const viewer = await w.viewer.agent.delete(`/api/v1/issues/${ids.issues}`).set(CSRF);
    expect([viewer.status, viewer.body.error?.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('visible but not allowed stays 403 (project Member, Viewer)', async () => {
    const { w, ids } = await records();
    const del = await w.member.agent.delete(`/api/v1/projects/${ids.projects}`).set(CSRF);
    expect(del.status).toBe(403);
    const edit = await w.viewer.agent
      .patch(`/api/v1/tasks/${ids.tasks}`)
      .set(CSRF)
      .send({ name: 'x' });
    expect(edit.status).toBe(403);
    // Someone else's time entry is not theirs to see: 404 even for a teammate.
    const time = await w.pm.agent.delete(`/api/v1/time/${ids.time}`).set(CSRF);
    expect(time.status).toBe(404);
  });

  it('a missing record also answers 404, never 403, even without the permission', async () => {
    const { w } = await records();
    const missing = new Types.ObjectId().toString();
    const res = await w.viewer.agent.delete(`/api/v1/issues/${missing}`).set(CSRF);
    expect(res.status).toBe(404);
  });
});
