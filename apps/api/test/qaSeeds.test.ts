import { describe, expect, it } from 'vitest';
import {
  QA_COMPLETED_PROJECT_NAME,
  qaPeople,
  seedCompletedProject,
} from '../scripts/lib/qaSeeds.js';
import {
  ClientContactModel,
  ClientModel,
  IssueModel,
  ProjectModel,
  TaskModel,
} from '../src/models/index.js';
import { ensureLaunchTemplate } from '../src/services/launchTemplate.js';
import { CSRF, makeApp, signedInAs, useDatabase } from './helpers.js';

/** The AC-44.1 Completed QA project seed (re-runnable). */
useDatabase();
const app = makeApp();

describe('QA seeds', () => {
  it('AC-44.1 seed: a fully Completed project with one open issue; re-running changes nothing', async () => {
    await ensureLaunchTemplate();
    const pm = await signedInAs(app, 'PROJECT_MANAGER');
    const member = await signedInAs(app, 'MEMBER');
    const client = await ClientModel.create({ name: 'Seed Co', nameKey: 'seed co' });
    await ClientContactModel.create({ clientId: client._id, name: 'Rosa', active: true });
    const people = await qaPeople(pm.user.email, member.user.email);

    const first = await seedCompletedProject(people, 'Seed Co');
    const second = await seedCompletedProject(people, 'Seed Co');
    expect(second.project._id.toString()).toBe(first.project._id.toString());
    expect(second.issue.key).toBe(first.issue.key);

    const project = await ProjectModel.findOne({ name: QA_COMPLETED_PROJECT_NAME }).lean();
    expect(project?.status).toBe('COMPLETED');
    expect(project?.progress).toBe(100);
    const tasks = await TaskModel.find({ projectId: project!._id }).lean();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.status === 'COMPLETED' && t.ownerId)).toBe(true);
    expect(await IssueModel.countDocuments({ projectId: project!._id, status: 'OPEN' })).toBe(1);

    // The app shows it as Completed with the support banner context: the issue is still open.
    const res = await pm.agent.get(`/api/v1/issues/${first.issue.id}`).set(CSRF);
    expect(res.status).toBe(200);
    expect(res.body.issue).toMatchObject({ status: 'OPEN', projectStatus: 'COMPLETED' });
  });
});
