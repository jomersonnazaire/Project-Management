import { PROJECT_CODE_LOCKED, PROJECT_CODE_TAKEN } from '@xc8/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { IssueModel, MigrationModel, ProjectModel } from '../src/models/index.js';
import { migrateProjectCodes } from '../src/services/projectCodes.js';
import { CSRF, makeApp, useDatabase } from './helpers.js';
import { world, ptypeId } from './m2helpers.js';

/** DR-23: issue IDs use the project code; codes are unique ignoring case and lock once issues exist. */
useDatabase();
const app = makeApp();
afterEach(async () => {
  await Promise.all([ProjectModel.deleteMany({}), IssueModel.deleteMany({})]);
});

type W = Awaited<ReturnType<typeof world>>;
const raise = (w: W, projectId = w.project.id) =>
  w.pm.agent.post(`/api/v1/projects/${projectId}/issues`).set(CSRF).send({
    title: 'Posting fails',
    description: 'Journal entries fail to post.',
    severity: 'HIGH',
    stage: 'BEFORE_GO_LIVE',
  });
const create = async (w: W, body: Record<string, unknown>) =>
  w.pm.agent
    .post('/api/v1/projects')
    .set(CSRF)
    .send({
      projectTypeId: await ptypeId(),
      name: 'Second rollout',
      clientId: w.acme.client.id,
      managerId: w.pm.user._id.toString(),
      startDate: '2026-10-12',
      plannedEndDate: '2026-12-18',
      templateId: w.template.id,
      ...body,
    });

describe('DR-23 project codes', () => {
  it('suggests a code, refuses duplicates ignoring case, and prefixes issue IDs with the code', async () => {
    const w = await world(app);
    expect(w.project.code).toMatch(/^[A-Z0-9-]+$/);
    expect(w.project.codeLocked).toBe(false);

    const dup = await create(w, { code: w.project.code.toLowerCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({
      code: 'PROJECT_CODE_TAKEN',
      message: PROJECT_CODE_TAKEN,
      details: [{ path: 'code', message: PROJECT_CODE_TAKEN }],
    });

    const second = await create(w, { code: 'acme-b1' });
    expect(second.status).toBe(201);
    expect(second.body.project.code).toBe('ACME-B1');

    // Two projects for the same client no longer share issue IDs.
    const a = await raise(w);
    const b = await raise(w, second.body.project.id);
    expect(a.body.issue.key).toBe(`${w.project.code}-ISS-001`);
    expect(b.body.issue.key).toBe('ACME-B1-ISS-001');

    const bad = await create(w, { code: 'no spaces!' });
    expect(bad.status).toBe(400);
  });

  it('a code can change until the project has issues, then it is read-only', async () => {
    const w = await world(app);
    const patch = (body: Record<string, unknown>) =>
      w.pm.agent.patch(`/api/v1/projects/${w.project.id}`).set(CSRF).send(body);
    const renamed = await patch({ code: 'roll-p' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.project.code).toBe('ROLL-P');

    const other = await create(w, { code: 'OTHER-1' });
    expect((await patch({ code: 'other-1' })).status).toBe(409);
    expect(other.status).toBe(201);

    await raise(w);
    const locked = await patch({ code: 'NEW-CODE' });
    expect(locked.status).toBe(422);
    expect(locked.body.error).toMatchObject({
      code: 'PROJECT_CODE_LOCKED',
      message: PROJECT_CODE_LOCKED,
    });
    const view = await w.pm.agent.get(`/api/v1/projects/${w.project.id}`);
    expect(view.body.project).toMatchObject({ code: 'ROLL-P', codeLocked: true });
    // Sending the same code is not a change.
    expect((await patch({ code: 'ROLL-P', name: 'Rollout P2' })).status).toBe(200);
  });

  it('the startup migration gives legacy projects unique codes and renumbers issues, idempotently', async () => {
    const w = await world(app);
    const second = await create(w, { name: 'Legacy two' });
    // Make both look like pre-DR-23 data: no code, same client prefix on their issues.
    const a = (await raise(w)).body.issue;
    const b = (await raise(w, second.body.project.id)).body.issue;
    await ProjectModel.updateMany({}, { $set: { code: null, issuePrefix: 'ACME-SAP' } });
    await IssueModel.updateOne({ _id: a.id }, { $set: { key: 'ACME-SAP-ISS-001' } });
    await IssueModel.updateOne({ _id: b.id }, { $set: { key: 'ACME-SAP-ISS-001' } });

    const first = await migrateProjectCodes();
    expect(first).toEqual({ coded: 2, renumbered: 1 });
    const keys = (await IssueModel.find({}).sort({ createdAt: 1 }).lean()).map((i) => i.key);
    expect(keys).toEqual(['ACME-SAP-ISS-001', 'ACME-SAP-2-ISS-001']);
    const codes = (await ProjectModel.find({}).sort({ createdAt: 1 }).lean()).map((p) => p.code);
    expect(codes).toEqual(['ACME-SAP', 'ACME-SAP-2']);
    expect(await MigrationModel.findById('dr23-project-codes').lean()).toMatchObject({
      status: 'DONE',
    });

    expect(await migrateProjectCodes()).toEqual({ coded: 0, renumbered: 0 });
    // New issues continue the running number with the new prefix.
    const next = await raise(w, second.body.project.id);
    expect(next.body.issue.key).toBe('ACME-SAP-2-ISS-002');
  });
});
