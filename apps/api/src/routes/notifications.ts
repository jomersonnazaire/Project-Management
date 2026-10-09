import type { NotificationDto, NotificationListDto, NotificationType } from '@xc8/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { notFound } from '../lib/errors.js';
import { idParam } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import { NotificationModel, ProjectModel, TaskModel } from '../models/index.js';
import { userRefs } from '../services/projectService.js';
import { projectScopeFilter } from '../services/scope.js';

/**
 * In-app notifications (FR-NTF-01..06). Always the caller's own (`notifications` is fixed on and
 * scoped to self); another user's notification answers 404. Access is re-checked at read time
 * (FR-NTF-04): notifications of projects the user can no longer see are left out.
 */
async function visibleFilter(req: Request) {
  const user = currentUser(req);
  const projects = await ProjectModel.find(projectScopeFilter(user)).select('_id').lean();
  return {
    userId: user._id,
    projectId: { $in: projects.map((p) => p._id) },
    createdAt: { $gte: new Date(Date.now() - 90 * 86_400_000) },
  };
}

export function notificationsRouter(registry: RouteRegistry) {
  const r = registry.router('/notifications');

  r.get('/', perm('notifications', 'view'), async (req, res) => {
    const filter = await visibleFilter(req);
    const [docs, unread] = await Promise.all([
      NotificationModel.find(filter).sort({ createdAt: -1 }).limit(50).lean(),
      NotificationModel.countDocuments({ ...filter, readAt: null }),
    ]);
    const [users, tasks, projects] = await Promise.all([
      userRefs(docs.map((d) => d.actorId)),
      TaskModel.find({ _id: { $in: docs.map((d) => d.taskId).filter(Boolean) } })
        .select('name')
        .lean(),
      ProjectModel.find({ _id: { $in: docs.map((d) => d.projectId) } })
        .select('name')
        .lean(),
    ]);
    const tn = new Map(tasks.map((t) => [t._id.toString(), t.name]));
    const pn = new Map(projects.map((p) => [p._id.toString(), p.name]));
    const items: NotificationDto[] = docs.map((d) => {
      const actor = d.actorId ? users.get(d.actorId.toString()) : null;
      return {
        id: d._id.toString(),
        type: d.type as NotificationType,
        actor: actor ? { id: actor.id, name: actor.name } : null,
        task:
          d.taskId && tn.has(d.taskId.toString())
            ? { id: d.taskId.toString(), name: tn.get(d.taskId.toString())! }
            : null,
        project: { id: d.projectId.toString(), name: pn.get(d.projectId.toString()) ?? '' },
        read: Boolean(d.readAt),
        at: d.createdAt.toISOString(),
      };
    });
    const body: NotificationListDto = { items, unread };
    res.json(body);
  });

  r.get('/unread-count', perm('notifications', 'view'), async (req, res) => {
    const filter = await visibleFilter(req);
    res.json({ unread: await NotificationModel.countDocuments({ ...filter, readAt: null }) });
  });

  r.post('/read-all', perm('notifications', 'view'), async (req, res) => {
    await NotificationModel.updateMany(
      { userId: currentUser(req)._id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ unread: 0 });
  });

  r.post('/:id/read', perm('notifications', 'view'), async (req, res) => {
    const filter = await visibleFilter(req);
    const n = await NotificationModel.findOneAndUpdate(
      { ...filter, _id: new Types.ObjectId(idParam(req)) },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!n) throw notFound();
    res.json({ unread: await NotificationModel.countDocuments({ ...filter, readAt: null }) });
  });

  return r.router;
}
