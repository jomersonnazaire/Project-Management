import type { Types } from 'mongoose';
import { now as clockNow } from '../lib/clock.js';
import {
  AppMarkerModel,
  CONVERSATION_READ_CUTOFF,
  ConversationReadModel,
  MessageModel,
} from '../models/index.js';

type Id = Types.ObjectId;

/**
 * CR-24 Q-170: write the Conversation unread cutoff once, on the first start of this release, so
 * every message before it counts as read for everyone (no last-read rows are pre-created).
 * Idempotent: later starts keep the first value.
 */
export async function ensureConversationReadCutoff(): Promise<Date> {
  const doc = await AppMarkerModel.findOneAndUpdate(
    { _id: CONVERSATION_READ_CUTOFF },
    { $setOnInsert: { at: clockNow() } },
    { upsert: true, new: true },
  ).lean();
  return doc!.at;
}

/** The cutoff, or none (every message counts) when it was never written, e.g. in tests. */
async function cutoff(): Promise<number> {
  const doc = await AppMarkerModel.findById(CONVERSATION_READ_CUTOFF).lean();
  return doc ? doc.at.getTime() : -Infinity;
}

/** Per project, the time after which other people's messages are unread for this user. */
async function readSince(userId: Id, projectIds: Id[]): Promise<Map<string, number>> {
  const [rows, c] = await Promise.all([
    ConversationReadModel.find(
      { userId, projectId: { $in: projectIds } },
      { projectId: 1, lastReadAt: 1 },
    ).lean(),
    cutoff(),
  ]);
  const read = new Map(rows.map((r) => [r.projectId.toString(), r.lastReadAt.getTime()]));
  return new Map(
    projectIds.map((p) => [p.toString(), Math.max(c, read.get(p.toString()) ?? -Infinity)]),
  );
}

/** The divider point for one project: last-read (or the cutoff), null when nothing is read yet. */
export async function lastReadAt(userId: Id, projectId: Id): Promise<Date | null> {
  const since = (await readSince(userId, [projectId])).get(projectId.toString())!;
  return Number.isFinite(since) ? new Date(since) : null;
}

/**
 * CR-24 FR-CNV-10/11/12/14/15: unread Conversation messages per project for this user, counted on
 * the server: by someone else (never your own, even a self-mention), not hidden, after both the
 * release cutoff and your last-read. One aggregate
 * for the whole list (NFR-60), never one query per project.
 */
export async function conversationUnreadCounts(
  userId: Id,
  projectIds: Id[],
): Promise<Map<string, number>> {
  const out = new Map(projectIds.map((p) => [p.toString(), 0]));
  if (!projectIds.length) return out;
  const since = await readSince(userId, projectIds);
  const rows = await MessageModel.aggregate<{ _id: Id; unread: number }>([
    {
      $match: {
        $or: projectIds.map((p) => {
          const t = since.get(p.toString())!;
          return Number.isFinite(t)
            ? { projectId: p, createdAt: { $gt: new Date(t) } }
            : { projectId: p };
        }),
        authorId: { $ne: userId },
        hidden: null,
      },
    },
    {
      $group: {
        _id: '$projectId',
        unread: { $sum: 1 },
      },
    },
  ]);
  for (const r of rows) out.set(r._id.toString(), r.unread);
  return out;
}

/**
 * FR-CNV-10: the user read the Conversation up to `at` (the newest message they were shown), or,
 * without `at`, up to the newest visible message (now when there are none). Never later than now,
 * and `$max` keeps a stale request from moving it back (EC-238).
 */
export async function markConversationRead(userId: Id, projectId: Id, at?: Date): Promise<void> {
  const now = clockNow();
  let lastReadAt: Date;
  if (at) lastReadAt = at.getTime() > now.getTime() ? now : at;
  else {
    const newest = await MessageModel.findOne({ projectId, hidden: null })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();
    lastReadAt = newest?.createdAt ?? now;
  }
  await ConversationReadModel.updateOne(
    { userId, projectId },
    { $max: { lastReadAt } },
    { upsert: true },
  );
}
