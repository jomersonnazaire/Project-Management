import type { Types } from 'mongoose';
import { now as clockNow } from '../lib/clock.js';
import { FollowUpSeenModel } from '../models/index.js';

type Id = Types.ObjectId;

/** The parts of a task the follow-up badge needs. */
interface FollowUpsOf {
  _id: Id;
  followUps?: { authorId?: Id | null; at?: Date | null }[] | null;
}

/**
 * CR-20 FR-NTF-09..13 (follow-up badge): per task, how many follow-ups are new for this user, i.e. added
 * after they last opened the task's follow-ups list, by someone else (their own always count as
 * seen). One query for the whole list, never one per task.
 */
export async function followUpUnseenCounts(
  userId: Id,
  tasks: FollowUpsOf[],
): Promise<Map<string, number>> {
  const withFollowUps = tasks.filter((t) => (t.followUps ?? []).length > 0);
  const out = new Map<string, number>();
  if (!withFollowUps.length) return out;
  const seen = await FollowUpSeenModel.find(
    { userId, taskId: { $in: withFollowUps.map((t) => t._id) } },
    { taskId: 1, seenAt: 1 },
  ).lean();
  const seenAt = new Map(seen.map((s) => [s.taskId.toString(), s.seenAt.getTime()]));
  for (const t of withFollowUps) {
    const since = seenAt.get(t._id.toString()) ?? -Infinity;
    const unseen = (t.followUps ?? []).filter(
      (f) => !f.authorId?.equals(userId) && (f.at ? f.at.getTime() : 0) > since,
    ).length;
    out.set(t._id.toString(), unseen);
  }
  return out;
}

/**
 * CR-20 FR-NTF-09..13 (follow-up badge): the user opened the task's follow-ups list, so every follow-up on
 * it now is seen. Stores the newest follow-up's time (not the clock), so one posted a moment later
 * is still new; `$max` keeps a stale request from moving it back.
 */
export async function markFollowUpsSeen(userId: Id, task: FollowUpsOf): Promise<void> {
  const times = (task.followUps ?? []).map((f) => (f.at ? f.at.getTime() : 0));
  const seenAt = new Date(times.length ? Math.max(...times) : clockNow().getTime());
  await FollowUpSeenModel.updateOne(
    { userId, taskId: task._id },
    { $max: { seenAt } },
    { upsert: true },
  );
}
