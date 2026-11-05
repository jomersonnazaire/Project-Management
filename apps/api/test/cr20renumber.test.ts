import { describe, expect, it } from 'vitest';
import { RENUMBER_AUDIT_ACTION, renumberAllProjects } from '../scripts/lib/renumberTasks.js';
import { ActivityLogModel, TaskModel } from '../src/models/index.js';
import { makeApp, useDatabase } from './helpers.js';
import { world } from './m2helpers.js';

/** CR-20 FR-TSK-31 (one-time renumber): the one-time renumber script (scripts/renumber-tasks.ts). */
useDatabase();
const app = makeApp();

const orders = async (projectId: string) =>
  (await TaskModel.find({ projectId }).sort({ order: 1, _id: 1 }).lean()).map((t) => ({
    id: t._id.toString(),
    order: t.order,
  }));

describe('CR-20 FR-TSK-31 (one-time renumber): renumber every project to #1…n', () => {
  it('dry run reports and writes nothing; --apply renumbers, audits changed projects once, and re-running changes nothing', async () => {
    const messy = await world(app);
    const clean = await world(app);
    const pid = messy.project.id as string;
    const n = await TaskModel.countDocuments({ projectId: pid });
    // Gaps and duplicates, as left by deletes before FR-TSK-31.
    const gap = await TaskModel.create({ projectId: pid, name: 'Gap', order: n + 5 });
    const dupA = await TaskModel.create({ projectId: pid, name: 'Dup A', order: n + 9 });
    const dupB = await TaskModel.create({ projectId: pid, name: 'Dup B', order: n + 9 });
    const before = await orders(pid);
    const cleanBefore = await orders(clean.project.id);
    expect(cleanBefore.map((t) => t.order)).toEqual(cleanBefore.map((_, i) => i + 1));
    const audits = () => ActivityLogModel.find({ action: RENUMBER_AUDIT_ACTION }).lean();

    const dry = await renumberAllProjects({ apply: false });
    expect(dry.apply).toBe(false);
    expect(dry.changed.map((p) => p.projectId)).toEqual([pid]);
    expect(dry.changed[0]!.tasks.map((t) => [t.name, t.from, t.to])).toEqual([
      ['Gap', n + 5, n + 1],
      ['Dup A', n + 9, n + 2],
      ['Dup B', n + 9, n + 3],
    ]);
    expect(await orders(pid)).toEqual(before);
    expect(await audits()).toHaveLength(0);

    const applied = await renumberAllProjects({ apply: true });
    expect(applied.changed.map((p) => p.projectId)).toEqual([pid]);
    const after = await orders(pid);
    // Same order as before (order, then _id), numbered 1…n.
    expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id));
    expect(after.map((t) => t.order)).toEqual(after.map((_, i) => i + 1));
    expect(
      after.filter((t) => [gap, dupA, dupB].some((x) => x.id === t.id)).map((t) => t.order),
    ).toEqual([n + 1, n + 2, n + 3]);
    expect(await orders(clean.project.id)).toEqual(cleanBefore);

    const [entry, ...more] = await audits();
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      entityType: 'project',
      actorId: null,
      changes: [{ field: 'order', old: [n + 5, n + 9, n + 9], new: [n + 1, n + 2, n + 3] }],
    });
    expect(entry!.entityId.toString()).toBe(pid);
    expect(
      (entry!.meta as { tasks: { taskId: string; from: number; to: number }[] }).tasks.map(
        (t) => t.taskId,
      ),
    ).toEqual([gap.id, dupA.id, dupB.id]);

    // Idempotent: a second run finds nothing and audits nothing.
    const again = await renumberAllProjects({ apply: true });
    expect(again.changed).toEqual([]);
    expect(again.projectsChecked).toBe(2);
    expect(await orders(pid)).toEqual(after);
    expect(await audits()).toHaveLength(1);
  });
});
