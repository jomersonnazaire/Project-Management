import {
  PROJECT_TYPE_DUPLICATE,
  projectTypeInUseMessage,
  projectTypeNameKey,
  projectTypeSchema,
  updateProjectTypeSchema,
  type ProjectTypeDto,
} from '@xc8/shared';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AUTHENTICATED, perm, type RouteRegistry } from '../access/registry.js';
import { notFound } from '../lib/errors.js';
import { conflictWith, unprocessable } from '../lib/http422.js';
import { idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentUser } from '../middleware/auth.js';
import { LookupModel, ProjectModel, ProjectTypeModel, TaskModel } from '../models/index.js';
import { audit } from '../services/audit.js';
import { userRefs } from '../services/projectService.js';
import { ensureDefaultProjectTypes, preselectFor } from '../services/projectTypes.js';
import { loadProject } from './projects.js';

type Id = Types.ObjectId;
interface TypeDoc {
  _id: Id;
  name: string;
  defaultActivityTypeId?: Id | null;
  active?: boolean | null;
  deactivatedAt?: Date | null;
  deactivatedBy?: Id | null;
  createdAt?: Date;
}

const duplicate = () =>
  conflictWith(PROJECT_TYPE_DUPLICATE, 'DUPLICATE_NAME', [
    { path: 'name', message: PROJECT_TYPE_DUPLICATE },
  ]);

/** Projects using each type (archived ones included: they still point at it). */
async function usage(ids: Id[]): Promise<Map<string, number>> {
  const rows = await ProjectModel.aggregate<{ _id: Id; n: number }>([
    { $match: { projectTypeId: { $in: ids } } },
    { $group: { _id: '$projectTypeId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

async function toDtos(docs: TypeDoc[], withUsage: boolean): Promise<ProjectTypeDto[]> {
  const used = withUsage ? await usage(docs.map((d) => d._id)) : null;
  const refs = await userRefs(docs.map((d) => d.deactivatedBy));
  const acts = await LookupModel.find({
    _id: { $in: docs.map((d) => d.defaultActivityTypeId).filter(Boolean) },
  })
    .select('name active')
    .lean();
  const actById = new Map(acts.map((a) => [a._id.toString(), a]));
  return docs.map((d) => {
    const act = d.defaultActivityTypeId ? actById.get(d.defaultActivityTypeId.toString()) : null;
    return {
      id: d._id.toString(),
      name: d.name,
      active: d.active !== false,
      defaultActivityType: act
        ? { id: act._id.toString(), name: act.name, active: act.active !== false }
        : null,
      usedBy: used ? (used.get(d._id.toString()) ?? 0) : null,
      deactivatedAt: d.deactivatedAt ? d.deactivatedAt.toISOString() : null,
      deactivatedBy: d.deactivatedBy
        ? {
            id: d.deactivatedBy.toString(),
            name: refs.get(d.deactivatedBy.toString())?.name ?? 'Unknown user',
          }
        : null,
      createdAt: (d.createdAt ?? new Date()).toISOString(),
    };
  });
}

/** A new default must be an existing, active Activity type. */
async function assertActivityType(id: string) {
  const doc = await LookupModel.findOne({ _id: id, kind: 'ACTIVITY_TYPE' }).lean();
  if (!doc || doc.active === false) {
    throw unprocessable('Choose an active activity type.', 'INVALID_ACTIVITY_TYPE', [
      { path: 'defaultActivityTypeId', message: 'Choose an active activity type.' },
    ]);
  }
  return doc;
}

const listQuery = z.strictObject({ includeInactive: z.enum(['true', 'false']).optional() });
const preselectQuery = z.strictObject({
  taskId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.'),
});

/**
 * Admin › Settings › Project types (doc 14 FR-PTY-01). Gated by the `settings` access row like
 * the other Admin lists (doc 11, FR-PTY-07); the active list is open to any signed-in user for
 * the project form. Every change is audited.
 */
export function projectTypesRouter(registry: RouteRegistry) {
  const r = registry.router('/project-types');

  // Active types for the project form picker; `includeInactive=true` adds the inactive ones (the
  // project list filter, FR-PTY-07). Names only: no usage counts outside Admin.
  r.get('/', AUTHENTICATED, async (req, res) => {
    const q = parseQuery(listQuery, req);
    await ensureDefaultProjectTypes();
    const docs = await ProjectTypeModel.find(q.includeInactive === 'true' ? {} : { active: true })
      .sort({ active: -1, name: 1 })
      .lean();
    res.json({ items: await toDtos(docs, false) });
  });

  r.get('/all', perm('settings', 'view'), async (_req, res) => {
    await ensureDefaultProjectTypes();
    const docs = await ProjectTypeModel.find().sort({ active: -1, name: 1 }).lean();
    res.json({ items: await toDtos(docs, true) });
  });

  // FR-PTY-04: what Time in / + Add entry preselects on a project task.
  r.get('/preselect', perm('activities', 'create'), async (req, res) => {
    const { taskId } = parseQuery(preselectQuery, req);
    const task = await TaskModel.findById(taskId).select('projectId').lean();
    if (!task) throw notFound();
    const project = await loadProject(req, 'view', task.projectId.toString());
    res.json({ preselect: await preselectFor(project) });
  });

  r.post('/', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(projectTypeSchema, req);
    const nameKey = projectTypeNameKey(input.name);
    if (await ProjectTypeModel.exists({ nameKey })) throw duplicate();
    const act = input.defaultActivityTypeId
      ? await assertActivityType(input.defaultActivityTypeId)
      : null;
    const doc = await ProjectTypeModel.create({
      name: input.name,
      nameKey,
      defaultActivityTypeId: act?._id ?? null,
    }).catch((e: unknown) => {
      if ((e as { code?: number }).code === 11000) throw duplicate();
      throw e;
    });
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'projectType',
      entityId: doc._id,
      action: 'project_type_created',
      changes: [
        { field: 'name', old: null, new: input.name },
        ...(act ? [{ field: 'defaultActivityTypeId', old: null, new: act._id.toString() }] : []),
      ],
      meta: act ? { defaultActivityType: act.name } : undefined,
    });
    const [dto] = await toDtos([doc.toObject()], true);
    res.status(201).json({ item: dto });
  });

  r.patch('/:id', perm('settings', 'edit'), async (req, res) => {
    const input = parseBody(updateProjectTypeSchema, req);
    const doc = await ProjectTypeModel.findById(idParam(req));
    if (!doc) throw notFound();
    const user = currentUser(req);
    const changes: { field: string; old: unknown; new: unknown }[] = [];
    const actions: string[] = [];
    if (input.name !== undefined && input.name !== doc.name) {
      const nameKey = projectTypeNameKey(input.name);
      if (await ProjectTypeModel.exists({ nameKey, _id: { $ne: doc._id } })) throw duplicate();
      changes.push({ field: 'name', old: doc.name, new: input.name });
      actions.push('project_type_renamed');
      doc.name = input.name;
      doc.nameKey = nameKey;
    }
    if (input.defaultActivityTypeId !== undefined) {
      const current = doc.defaultActivityTypeId?.toString() ?? null;
      if (input.defaultActivityTypeId !== current) {
        // Keeping an inactive default is allowed (unchanged); a new one must be active.
        if (input.defaultActivityTypeId) await assertActivityType(input.defaultActivityTypeId);
        changes.push({
          field: 'defaultActivityTypeId',
          old: current,
          new: input.defaultActivityTypeId,
        });
        actions.push('project_type_default_changed');
        doc.defaultActivityTypeId = input.defaultActivityTypeId
          ? new Types.ObjectId(input.defaultActivityTypeId)
          : null;
      }
    }
    if (input.active !== undefined && input.active !== (doc.active !== false)) {
      changes.push({ field: 'active', old: doc.active !== false, new: input.active });
      actions.push(input.active ? 'project_type_reactivated' : 'project_type_deactivated');
      doc.active = input.active;
      doc.deactivatedAt = input.active ? null : new Date();
      doc.deactivatedBy = input.active ? null : user._id;
    }
    try {
      await doc.save();
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw duplicate();
      throw e;
    }
    // FR-PTY-05: existing time entries are never touched by any of these changes.
    if (changes.length) {
      await audit({
        actorId: user._id,
        entityType: 'projectType',
        entityId: doc._id,
        action: actions.length === 1 ? actions[0]! : 'project_type_updated',
        changes,
        meta: { name: doc.name },
      });
    }
    const [dto] = await toDtos([doc.toObject()], true);
    res.json({ item: dto });
  });

  // Delete only when no project uses it; in-use types are deactivated instead.
  r.delete('/:id', perm('settings', 'edit'), async (req, res) => {
    const doc = await ProjectTypeModel.findById(idParam(req));
    if (!doc) throw notFound();
    const n = (await usage([doc._id])).get(doc._id.toString()) ?? 0;
    if (n > 0) {
      throw conflictWith(projectTypeInUseMessage(doc.name, n), 'PROJECT_TYPE_IN_USE', {
        usedBy: n,
      });
    }
    await doc.deleteOne();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'projectType',
      entityId: doc._id,
      action: 'project_type_deleted',
      changes: [{ field: 'name', old: doc.name, new: null }],
    });
    res.status(204).end();
  });

  return r.router;
}
