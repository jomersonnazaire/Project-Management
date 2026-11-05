import type { ClientSession, Types } from 'mongoose';
import { TaskModel } from '../models/index.js';

/** One task whose checklist number changes. */
export interface TaskRenumber {
  taskId: string;
  from: number | null;
  to: number;
}

/**
 * CR-20 FR-TSK-31: numbers a project's tasks 1…n in their current order (order, then _id, so
 * duplicates keep a stable order). Returns only the tasks that change; `apply: false` just reports
 * them. Used after a task delete and by the one-time renumber script (scripts/renumber-tasks.ts).
 */
export async function renumberProjectTasks(
  projectId: Types.ObjectId,
  opts: { session?: ClientSession; apply?: boolean } = {},
): Promise<TaskRenumber[]> {
  const tasks = await TaskModel.find({ projectId }, { _id: 1, order: 1 })
    .sort({ order: 1, _id: 1 })
    .session(opts.session ?? null)
    .lean();
  const changes = tasks
    .map((t, i) => ({ taskId: t._id.toString(), from: t.order ?? null, to: i + 1 }))
    .filter((t) => t.from !== t.to);
  if (changes.length && opts.apply !== false) {
    await TaskModel.bulkWrite(
      changes.map((c) => ({
        updateOne: { filter: { _id: c.taskId }, update: { $set: { order: c.to } } },
      })),
      opts.session ? { session: opts.session } : {},
    );
  }
  return changes;
}
