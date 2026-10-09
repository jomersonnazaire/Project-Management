import type { AuditEntryDto } from '@xc8/shared';
import { z } from 'zod';
import { perm, type RouteRegistry } from '../access/registry.js';
import { paginate } from '../lib/pagination.js';
import { parseQuery } from '../lib/validate.js';
import { ActivityLogModel, UserModel } from '../models/index.js';

const auditQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  entityType: z
    .string()
    .regex(/^[A-Za-z]{1,40}$/)
    .optional(),
});

/** Read-only audit log (FR-AUD-01/03). Entries are never edited or deleted by any route. */
export function auditRouter(registry: RouteRegistry) {
  const r = registry.router('/audit');

  r.get('/', perm('audit', 'view'), async (req, res) => {
    const q = parseQuery(auditQuerySchema, req);
    const filter = q.entityType ? { entityType: q.entityType } : {};
    const { skip, limit } = paginate(q.page, q.pageSize);
    const [items, total] = await Promise.all([
      ActivityLogModel.find(filter).sort({ at: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      ActivityLogModel.countDocuments(filter),
    ]);
    const actors = await UserModel.find({
      _id: { $in: items.map((i) => i.actorId).filter(Boolean) },
    })
      .select('name')
      .lean();
    const names = new Map(actors.map((u) => [u._id.toString(), u.name]));
    const body: AuditEntryDto[] = items.map((i) => ({
      id: i._id.toString(),
      at: i.at.toISOString(),
      actor: i.actorId
        ? { id: i.actorId.toString(), name: names.get(i.actorId.toString()) ?? 'Unknown user' }
        : null,
      entityType: i.entityType,
      entityId: i.entityId.toString(),
      action: i.action,
      changes: (i.changes ?? []).map((c) => ({ field: c.field ?? '', old: c.old, new: c.new })),
      meta: (i.meta as Record<string, unknown> | null) ?? null,
    }));
    res.json({ items: body, page: q.page, pageSize: q.pageSize, total });
  });

  return r.router;
}
