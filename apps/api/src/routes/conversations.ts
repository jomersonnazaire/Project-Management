import {
  hideMessageSchema,
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
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import {
  ClientContactModel,
  MessageModel,
  TaskModel,
  type Message,
  type Project,
} from '../models/index.js';
import { audit } from '../services/audit.js';
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

async function toDtos(docs: MessageDoc[]): Promise<MessageDto[]> {
  const users = await userRefs(docs.flatMap((d) => [d.authorId, d.hidden?.by]));
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
    const body: MessageListDto = {
      items: await toDtos(docs),
      can: {
        post: canPost(user, currentPermissions(req), project),
        hide: user.systemRole === 'ADMIN',
      },
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
    const msg = await MessageModel.create({
      projectId: project._id,
      authorId: user._id,
      type: input.type,
      text: input.text,
      taskId: input.taskId ?? null,
      contactIds: [...new Set(input.contactIds)],
    });
    await audit({
      actorId: user._id,
      entityType: 'message',
      entityId: msg._id,
      projectId: project._id,
      action: 'message_posted',
      meta: { type: input.type, taskId: input.taskId ?? null },
    });
    const [dto] = await toDtos([msg.toObject() as MessageDoc]);
    res.status(201).json({ message: dto });
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
      }
      const [dto] = await toDtos([msg.toObject() as MessageDoc]);
      res.json({ message: dto });
    },
  );

  return p.router;
}
