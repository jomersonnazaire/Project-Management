import type { NotificationType } from '@xc8/shared';
import type { Types } from 'mongoose';
import { NotificationModel, UserModel } from '../models/index.js';

type Id = Types.ObjectId;

/**
 * In-app notifications (FR-NTF-01..05). Channel-agnostic on purpose (FR-NTF-02): an email channel
 * can be added here later (Q-28). Recipients are limited to ACTIVE users who are CURRENTLY on the
 * project (manager or member): someone removed from the project gets nothing new (AC-40.2,
 * TC-N10), and deactivated users get nothing (EC-62). The actor never notifies themself.
 */
export async function notify(input: {
  type: NotificationType;
  project: { _id: Id; managerId?: Id | null; memberIds?: Id[] | null };
  taskId?: Id | null;
  issueId?: Id | null;
  actorId: Id | null;
  recipients: (Id | null | undefined)[];
}): Promise<number> {
  const onProject = new Set(
    [...(input.project.memberIds ?? []), input.project.managerId]
      .filter((x): x is Id => Boolean(x))
      .map(String),
  );
  const wanted = [
    ...new Set(
      input.recipients
        .filter((x): x is Id => Boolean(x))
        .map(String)
        .filter((id) => onProject.has(id) && id !== input.actorId?.toString()),
    ),
  ];
  if (!wanted.length) return 0;
  const active = await UserModel.find({ _id: { $in: wanted }, active: true })
    .select('_id')
    .lean();
  if (!active.length) return 0;
  await NotificationModel.insertMany(
    active.map((u) => ({
      userId: u._id,
      projectId: input.project._id,
      taskId: input.taskId ?? null,
      issueId: input.issueId ?? null,
      type: input.type,
      actorId: input.actorId,
    })),
  );
  return active.length;
}

/**
 * Personal notices not tied to a project (doc 14: day reopened, timer stopped, leave recorded).
 * Each carries its full sentence and in-app link. Inactive users are skipped.
 */
export async function notifyPersonal(input: {
  type: NotificationType;
  actorId: Id | null;
  recipients: (Id | null | undefined)[];
  message: string;
  link: string;
}): Promise<number> {
  const wanted = [
    ...new Set(input.recipients.filter((x): x is Id => Boolean(x)).map(String)),
  ].filter((id) => id !== input.actorId?.toString());
  if (!wanted.length) return 0;
  const active = await UserModel.find({ _id: { $in: wanted }, active: true })
    .select('_id')
    .lean();
  if (!active.length) return 0;
  await NotificationModel.insertMany(
    active.map((u) => ({
      userId: u._id,
      projectId: null,
      type: input.type,
      actorId: input.actorId,
      message: input.message,
      link: input.link,
    })),
  );
  return active.length;
}
