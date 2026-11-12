import {
  MAX_MENTIONS,
  MENTION_LIMIT_MESSAGE,
  conversationSeenSchema,
  hideMessageSchema,
  mentionExcerpt,
  mentionTokenIds,
  messageQuerySchema,
  parseDateOnly,
  postMessageSchema,
  type MessageDto,
  type MessageListDto,
  type MessageType,
  type PermissionGrid,
} from '@xc8/shared';
import type { Request } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { unprocessable } from '../lib/http422.js';
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import {
  ClientContactModel,
  MessageModel,
  NotificationModel,
  TaskModel,
  UserModel,
  type Message,
  type Project,
} from '../models/index.js';
import { audit } from '../services/audit.js';
import {
  conversationUnreadCounts,
  lastReadAt,
  markConversationRead,
} from '../services/conversationRead.js';
import { notify } from '../services/notify.js';
import { userRefs } from '../services/projectService.js';
import { canEditProjectScope, isProjectMember, type ScopeUser } from '../services/scope.js';
import { assertNotArchived, loadProject } from './projects.js';

/**
 * Project Conversation (FR-CNV-01..08). Anyone who can view the project reads (outsiders get 404
 * from the project scope); posting needs Create on conversations AND Edit on the project or
 * membership of it (FR-CNV-04). Messages are permanent: there is no edit or delete route, so
 * PATCH/DELETE answer 404 (AC-41.2). Admins can hide an abusive message; the hide is audited and
 * the text is withheld from everyone (Q-31). Text is plain text; the web never renders HTML.
 */
type Id = Types.ObjectId;
type MessageDoc = Message & { _id: Id };
type ProjectDoc = Project & { _id: Id };

function canPost(user: ScopeUser, perms: PermissionGrid, project: ProjectDoc) {
  return (
    !project.archived &&
    perms.conversations.create &&
    (canEditProjectScope(user, project) || isProjectMember(user, project))
  );
}

/**
 * CR-24 FR-CNV-13 (Lean L-3/L-4, Q-177..Q-179, EC-241): the message's `<@id>` tokens. More than 10
 * distinct people is refused (422 MENTION_LIMIT). Every token stays in the text. Only active PM or
 * team members other than the author are saved as `mentionIds` (and notified): a self-mention, a
 * non-member, a deactivated or an unknown id is ignored and the message still saves. Returns the
 * mention ids and every named user's name (for the bell excerpt).
 */
async function resolveMentions(text: string, project: ProjectDoc, authorId: Id) {
  const ids = mentionTokenIds(text);
  if (ids.length > MAX_MENTIONS) {
    throw unprocessable(MENTION_LIMIT_MESSAGE, 'MENTION_LIMIT');
  }
  if (!ids.length) return { mentionIds: [] as Id[], names: new Map<string, string>() };
  const team = new Set(
    [project.managerId, ...(project.memberIds ?? [])].filter(Boolean).map(String),
  );
  const users = await UserModel.find({ _id: { $in: ids } })
    .select('name active')
    .lean();
  const names = new Map(users.map((u) => [u._id.toString(), u.name]));
  const ok = new Set(
    users
      .filter((u) => u.active && team.has(u._id.toString()) && !u._id.equals(authorId))
      .map((u) => u._id.toString()),
  );
  return {
    mentionIds: ids.filter((id) => ok.has(id)).map((id) => new Types.ObjectId(id)),
    names,
  };
}

async function toDtos(docs: MessageDoc[]): Promise<MessageDto[]> {
  // Every token's person, so the web shows the CURRENT name (L-3).
  const tokenIds = docs.flatMap((d) => (d.hidden ? [] : mentionTokenIds(d.text)));
  const users = await userRefs([
    ...docs.flatMap((d) => [d.authorId, d.hidden?.by]),
    ...tokenIds.map((id) => new Types.ObjectId(id)),
  ]);
  const [tasks, contacts] = await Promise.all([
    TaskModel.find({ _id: { $in: docs.map((d) => d.taskId).filter(Boolean) } })
      .select('name')
      .lean(),
    ClientContactModel.find({ _id: { $in: docs.flatMap((d) => d.contactIds ?? []) } })
      .select('name active')
      .lean(),
  ]);
  const tn = new Map(tasks.map((t) => [t._id.toString(), t.name]));
  const cn = new Map(contacts.map((c) => [c._id.toString(), c]));
  return docs.map((d) => {
    const hiddenBy = d.hidden?.by ? users.get(d.hidden.by.toString()) : null;
    return {
      id: d._id.toString(),
      text: d.hidden ? null : d.text,
      type: d.type as MessageType,
      author: users.get(d.authorId.toString()) ?? null,
      at: d.createdAt.toISOString(),
      task: d.taskId
        ? { id: d.taskId.toString(), name: tn.get(d.taskId.toString()) ?? '(deleted task)' }
        : null,
      contacts: (d.contactIds ?? []).map((id) => {
        const c = cn.get(id.toString());
        return {
          id: id.toString(),
          name: c?.name ?? 'Unknown contact',
          active: Boolean(c?.active),
        };
      }),
      hidden: d.hidden
        ? {
            by: hiddenBy ? { id: hiddenBy.id, name: hiddenBy.name } : null,
            at: (d.hidden.at ?? new Date()).toISOString(),
            reason: d.hidden.reason ?? '',
          }
        : null,
      // A hidden message withholds its mentions with its text. A chip is a saved mention or the
      // author's own; anyone else named is plain "@Name"; an id with no user isn't listed.
      mentions: d.hidden
        ? []
        : mentionTokenIds(d.text).flatMap((id) => {
            const u = users.get(id);
            if (!u) return [];
            const chip =
              d.authorId.toString() === id || (d.mentionIds ?? []).some((m) => m.toString() === id);
            return [{ id: u.id, name: u.name, active: u.active, chip }];
          }),
    };
  });
}

export function conversationsRouter(registry: RouteRegistry) {
  const p = registry.router('/projects');

  p.get('/:id/messages', perm('conversations', 'view'), async (req, res) => {
    const q = parseQuery(messageQuerySchema, req);
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    const filter: FilterQuery<Message> = { projectId: project._id };
    if (q.type) filter.type = q.type;
    if (q.taskId) filter.taskId = new Types.ObjectId(q.taskId);
    if (q.contactId) filter.contactIds = new Types.ObjectId(q.contactId);
    if (q.q) {
      filter.text = new RegExp(escapeRegex(q.q), 'i');
      filter.hidden = null;
    }
    if (q.from || q.to) {
      // Dates are Philippine calendar days (FR-GEN-02).
      filter.createdAt = {
        ...(q.from ? { $gte: new Date(parseDateOnly(q.from).getTime() - 8 * 3_600_000) } : {}),
        ...(q.to ? { $lt: new Date(parseDateOnly(q.to).getTime() + 16 * 3_600_000) } : {}),
      };
    }
    const docs = (await MessageModel.find(filter)
      .sort({ createdAt: 1 })
      .limit(2000)
      .lean()) as MessageDoc[];
    const user = currentUser(req);
    const read = await lastReadAt(user._id, project._id);
    const body: MessageListDto = {
      items: await toDtos(docs),
      can: {
        post: canPost(user, currentPermissions(req), project),
        hide: user.systemRole === 'ADMIN',
      },
      lastReadAt: read ? read.toISOString() : null,
    };
    res.json(body);
  });

  p.post('/:id/messages', perm('conversations', 'create'), async (req, res) => {
    const input = parseBody(postMessageSchema, req);
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    assertNotArchived(project);
    const user = currentUser(req);
    if (!canPost(user, currentPermissions(req), project)) {
      throw forbidden('Only people on this project can post here.');
    }
    if (input.taskId && !(await TaskModel.exists({ _id: input.taskId, projectId: project._id }))) {
      throw badRequest('Tag a task of this project.', undefined, 'INVALID_TASK');
    }
    const active = new Set((project.activeContactIds ?? []).map(String));
    if (input.contactIds.some((id) => !active.has(id))) {
      throw badRequest(
        'Only contacts active on this project can be tagged.',
        undefined,
        'CONTACT_NOT_ACTIVE',
      );
    }
    const mentions = await resolveMentions(input.text, project, user._id);
    const msg = await MessageModel.create({
      projectId: project._id,
      authorId: user._id,
      type: input.type,
      text: input.text,
      taskId: input.taskId ?? null,
      contactIds: [...new Set(input.contactIds)],
      mentionIds: mentions.mentionIds,
    });
    // FR-CNV-11: your own post is read for you on every device.
    await markConversationRead(user._id, project._id, msg.createdAt);
    // FR-NTF-14 / Q-178: only mentioned team members, never the author; in-app only (FR-NTF-15).
    await notify({
      type: 'CONVERSATION_MENTION',
      project,
      actorId: user._id,
      recipients: mentions.mentionIds,
      messageId: msg._id,
      excerpt: mentionExcerpt(input.text, (id) => mentions.names.get(id)),
      link: `/projects/${project._id.toString()}/conversation?message=${msg._id.toString()}`,
    });
    await audit({
      actorId: user._id,
      entityType: 'message',
      entityId: msg._id,
      projectId: project._id,
      action: 'message_posted',
      meta: {
        type: input.type,
        taskId: input.taskId ?? null,
        ...(mentions.mentionIds.length ? { mentionIds: mentions.mentionIds.map(String) } : {}),
      },
    });
    const [dto] = await toDtos([msg.toObject() as MessageDoc]);
    res.status(201).json({ message: dto });
  });

  // CR-24 FR-CNV-10: opening (or watching) the Conversation moves the caller's last-read forward.
  p.post('/:id/messages/seen', perm('conversations', 'view'), async (req, res) => {
    const input = parseBody(conversationSeenSchema, req);
    const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
    const user = currentUser(req);
    await markConversationRead(user._id, project._id, input.at ? new Date(input.at) : undefined);
    const counts = await conversationUnreadCounts(user._id, [project._id]);
    res.json({ unread: counts.get(project._id.toString()) ?? 0 });
  });

  // Q-31: Admins only (fixed in code, not a grid permission), with a reason; audited.
  p.post(
    '/:id/messages/:messageId/hide',
    perm('conversations', 'view'),
    async (req: Request, res) => {
      const input = parseBody(hideMessageSchema, req);
      const project = (await loadProject(req, 'view')).toObject() as ProjectDoc;
      const user = currentUser(req);
      if (user.systemRole !== 'ADMIN') throw forbidden('Only Admins can hide messages.');
      const msg = await MessageModel.findOne({
        _id: idParam(req, 'messageId'),
        projectId: project._id,
      });
      if (!msg) throw notFound();
      if (!msg.hidden) {
        msg.hidden = { by: user._id, at: new Date(), reason: input.reason };
        await msg.save();
        await audit({
          actorId: user._id,
          entityType: 'message',
          entityId: msg._id,
          projectId: project._id,
          action: 'message_hidden',
          reason: input.reason,
        });
        // EC-228: a mention of a hidden message is no longer shown.
        await NotificationModel.deleteMany({
          type: 'CONVERSATION_MENTION',
          messageId: msg._id,
        });
      }
      const [dto] = await toDtos([msg.toObject() as MessageDoc]);
      res.json({ message: dto });
    },
  );

  return p.router;
}
