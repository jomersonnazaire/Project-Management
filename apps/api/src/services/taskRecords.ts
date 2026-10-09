import type { TaskRecordCounts } from '@xc8/shared';
import type { ClientSession, Types } from 'mongoose';
import {
  DocumentModel,
  IssueModel,
  MessageModel,
  TaskModel,
  TimeEntryModel,
} from '../models/index.js';

type Id = Types.ObjectId;

const empty = (): TaskRecordCounts => ({
  timeEntries: 0,
  evidence: 0,
  documents: 0,
  followUps: 0,
  comments: 0,
  subtasks: 0,
  issues: 0,
});

async function countBy(
  model: { aggregate: typeof TimeEntryModel.aggregate },
  match: Record<string, unknown>,
  field: string,
  session?: ClientSession,
): Promise<Map<string, number>> {
  const rows = await model
    .aggregate<{ _id: Id; n: number }>([
      { $match: match },
      ...(field === 'taskIds' ? [{ $unwind: '$taskIds' }] : []),
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    ])
    .session(session ?? null);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

/**
 * What has been recorded under each task (M3.5 delete rule): time entries, evidence, documents
 * filed against it, follow-ups, conversation comments, linked issues. Tasks have no subtasks in
 * this data model, so that count is always 0. Archived documents and hidden comments don't block.
 */
export async function taskRecordCounts(
  taskIds: Id[],
  session?: ClientSession,
): Promise<Map<string, TaskRecordCounts>> {
  const out = new Map<string, TaskRecordCounts>(taskIds.map((id) => [id.toString(), empty()]));
  if (!taskIds.length) return out;
  const $in = taskIds;
  const [tasks, time, docs, comments, issues] = await Promise.all([
    TaskModel.find({ _id: { $in } })
      .select('evidence followUps')
      .session(session ?? null)
      .lean(),
    countBy(TimeEntryModel, { taskId: { $in } }, 'taskId', session),
    countBy(
      DocumentModel as never,
      { taskId: { $in }, source: { $ne: 'EVIDENCE' }, archived: { $ne: true } },
      'taskId',
      session,
    ),
    countBy(MessageModel as never, { taskId: { $in }, hidden: null }, 'taskId', session),
    countBy(IssueModel as never, { taskIds: { $in } }, 'taskIds', session),
  ]);
  for (const t of tasks) {
    const c = out.get(t._id.toString());
    if (!c) continue;
    c.evidence = (t.evidence ?? []).length;
    c.followUps = (t.followUps ?? []).length;
  }
  for (const [key, map] of [
    ['timeEntries', time],
    ['documents', docs],
    ['comments', comments],
    ['issues', issues],
  ] as const) {
    for (const [id, n] of map) {
      const c = out.get(id);
      if (c) c[key] = n;
    }
  }
  return out;
}
