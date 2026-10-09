import { randomUUID } from 'node:crypto';
import {
  TEMPLATE_STATUSES,
  findCycle,
  templateSchema,
  updateTemplateSchema,
  type TemplateDto,
  type TemplateStatus,
  type TemplateSummaryDto,
  type TemplateType,
} from '@xc8/shared';
import type { Request } from 'express';
import mongoose, { type FilterQuery, type Types } from 'mongoose';
import { z } from 'zod';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { unprocessable } from '../lib/http422.js';
import { escapeRegex, idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import { ProjectModel, TemplateModel, type Template } from '../models/index.js';
import { audit } from '../services/audit.js';
import { projectScopeFilter } from '../services/scope.js';

/**
 * Implementation templates (FR-TPL-01..10, US-07/08). Every route is declared with its record
 * type and action. Publishing follows Edit on `templates` (Q-11, resolved: PMs can publish).
 */
type TemplateDoc = Template & { _id: Types.ObjectId; updatedAt?: Date };

const listQuery = z.strictObject({
  status: z.enum(TEMPLATE_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});

interface Content {
  phases: { id: string; name: string }[];
  activities: {
    id: string;
    name: string;
    phaseId: string;
    dependsOn: string[];
    deliverable?: string | null;
  }[];
}

/** Phase and activity references must resolve, and dependencies can't loop (FR-TPL-07, AC-07.2). */
export function validateTemplateContent(t: Content) {
  const phaseIds = new Set<string>();
  for (const p of t.phases) {
    if (phaseIds.has(p.id))
      throw unprocessable(`Two phases share the id "${p.id}".`, 'TEMPLATE_INVALID');
    phaseIds.add(p.id);
  }
  const byId = new Map<string, Content['activities'][number]>();
  for (const a of t.activities) {
    if (byId.has(a.id))
      throw unprocessable(`Two activities share the id "${a.id}".`, 'TEMPLATE_INVALID');
    byId.set(a.id, a);
  }
  for (const a of t.activities) {
    if (!phaseIds.has(a.phaseId)) {
      throw unprocessable(`"${a.name}" is in a phase that doesn't exist.`, 'TEMPLATE_INVALID');
    }
    for (const d of a.dependsOn) {
      if (d === a.id)
        throw unprocessable("An activity can't depend on itself.", 'DEPENDENCY_CYCLE', {
          activities: [a.name],
        });
      if (!byId.has(d)) {
        throw unprocessable(
          `"${a.name}" depends on an activity that doesn't exist.`,
          'TEMPLATE_INVALID',
        );
      }
    }
  }
  const cycle = findCycle(t.activities);
  if (cycle) {
    const names = cycle.map((id) => byId.get(id)!.name);
    throw unprocessable(`Circular dependency: ${names.join(' → ')}.`, 'DEPENDENCY_CYCLE', {
      activities: names,
    });
  }
}

function counts(t: Pick<TemplateDoc, 'phases' | 'activities'>) {
  const acts = t.activities ?? [];
  return {
    phaseCount: (t.phases ?? []).length,
    activityCount: acts.length,
    dependencyCount: acts.reduce((n, a) => n + (a.dependsOn?.length ?? 0), 0),
    deliverableCount: acts.filter((a) => a.deliverable).length,
  };
}

function toSummary(
  t: TemplateDoc,
  projectCount: number,
  draftId: string | null,
): TemplateSummaryDto {
  return {
    id: t._id.toString(),
    templateKey: t.templateKey,
    name: t.name,
    type: t.type as TemplateType,
    description: t.description ?? null,
    status: t.status as TemplateStatus,
    version: t.version,
    superseded: Boolean(t.superseded),
    ...counts(t),
    projectCount,
    publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
    updatedAt: (t.updatedAt ?? new Date()).toISOString(),
    draftId,
  };
}

async function projectCounts(req: Request, keys: string[]) {
  const rows = await ProjectModel.aggregate<{ _id: string; n: number }>([
    {
      $match: {
        ...projectScopeFilter(currentUser(req)),
        'templateSnapshot.templateKey': { $in: keys },
      },
    },
    { $group: { _id: '$templateSnapshot.templateKey', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

/**
 * Draft (and archived) templates are visible only to roles with Edit on templates; everyone else
 * sees published versions only (doc 11 §12). Read from the access rules on every request.
 */
function seesDrafts(req: Request): boolean {
  return currentPermissions(req).templates.edit;
}

async function draftIds(keys: string[]) {
  const drafts = await TemplateModel.find({ templateKey: { $in: keys }, status: 'DRAFT' })
    .select('templateKey')
    .lean();
  return new Map(drafts.map((d) => [d.templateKey, d._id.toString()]));
}

export async function toTemplateDto(req: Request, t: TemplateDoc): Promise<TemplateDto> {
  const [pc, drafts, versions] = await Promise.all([
    projectCounts(req, [t.templateKey]),
    seesDrafts(req) ? draftIds([t.templateKey]) : new Map<string, string>(),
    TemplateModel.find({
      templateKey: t.templateKey,
      ...(seesDrafts(req) ? {} : { status: 'PUBLISHED' }),
    })
      .select('version status superseded publishedAt')
      .sort({ version: -1 })
      .lean(),
  ]);
  const draftId = drafts.get(t.templateKey) ?? null;
  return {
    ...toSummary(t, pc.get(t.templateKey) ?? 0, draftId === t._id.toString() ? null : draftId),
    phases: (t.phases ?? []).map((p) => ({ id: p.id, name: p.name })),
    activities: (t.activities ?? []).map((a) => ({
      id: a.id,
      phaseId: a.phaseId,
      name: a.name,
      taskType: a.taskType ?? null,
      priority: a.priority as TemplateDto['activities'][number]['priority'],
      mandatory: Boolean(a.mandatory),
      party: a.party as TemplateDto['activities'][number]['party'],
      defaultJobRole: (a.defaultJobRole ??
        null) as TemplateDto['activities'][number]['defaultJobRole'],
      defaultTeamId: a.defaultTeamId ? a.defaultTeamId.toString() : null,
      estHours: a.estHours ?? null,
      offsetDays: a.offsetDays ?? 0,
      durationDays: a.durationDays ?? 1,
      deliverable: a.deliverable ?? null,
      requiresApproval: Boolean(a.requiresApproval),
      isMilestone: Boolean(a.isMilestone),
      dependsOn: [...(a.dependsOn ?? [])],
    })),
    versions: versions.map((v) => ({
      id: v._id.toString(),
      version: v.version,
      status: v.status as TemplateStatus,
      superseded: Boolean(v.superseded),
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    })),
  };
}

async function loadTemplate(req: Request) {
  const t = await TemplateModel.findById(idParam(req));
  if (!t || (t.status !== 'PUBLISHED' && !seesDrafts(req))) throw notFound();
  return t;
}

function copyContent(t: TemplateDoc) {
  const o = (t as unknown as { toObject?: () => TemplateDoc }).toObject?.() ?? t;
  return { phases: o.phases ?? [], activities: o.activities ?? [] };
}

export function templatesRouter(registry: RouteRegistry) {
  const r = registry.router('/templates');

  r.get('/', perm('templates', 'view'), async (req, res) => {
    const q = parseQuery(listQuery, req);
    const filter: FilterQuery<Template> = { superseded: { $ne: true } };
    if (q.status) filter.status = q.status;
    if (!seesDrafts(req)) {
      // A non-editor asking for Drafts or Archived gets an empty list, not an error.
      filter.status = !q.status || q.status === 'PUBLISHED' ? 'PUBLISHED' : { $in: [] };
    }
    if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
    const items = (await TemplateModel.find(filter)
      .sort({ name: 1, version: -1 })
      .limit(500)
      .lean()) as TemplateDoc[];
    const keys = [...new Set(items.map((t) => t.templateKey))];
    const [pc, drafts] = await Promise.all([
      projectCounts(req, keys),
      seesDrafts(req) ? draftIds(keys) : new Map<string, string>(),
    ]);
    res.json({
      items: items.map((t) => {
        const draftId = drafts.get(t.templateKey) ?? null;
        return toSummary(
          t,
          pc.get(t.templateKey) ?? 0,
          draftId === t._id.toString() ? null : draftId,
        );
      }),
    });
  });

  r.get('/:id', perm('templates', 'view'), async (req, res) => {
    res.json({ template: await toTemplateDto(req, await loadTemplate(req)) });
  });

  r.post('/', perm('templates', 'create'), async (req, res) => {
    const input = parseBody(templateSchema, req);
    validateTemplateContent(input);
    const userId = currentUser(req)._id;
    const t = await TemplateModel.create({
      ...input,
      templateKey: randomUUID(),
      version: 1,
      status: 'DRAFT',
      createdBy: userId,
      updatedBy: userId,
    });
    await audit({
      actorId: userId,
      entityType: 'template',
      entityId: t._id,
      action: 'template_created',
    });
    res.status(201).json({ template: await toTemplateDto(req, t) });
  });

  // Only Drafts are edited; a Published version is changed through a new Draft (FR-TPL-04).
  r.patch('/:id', perm('templates', 'edit'), async (req, res) => {
    const input = parseBody(updateTemplateSchema, req);
    const t = await loadTemplate(req);
    if (t.status !== 'DRAFT') {
      throw conflict(
        'Only drafts can be edited. Create a new version first.',
        'TEMPLATE_NOT_DRAFT',
      );
    }
    const content = copyContent(t);
    validateTemplateContent({
      phases: input.phases ?? content.phases,
      activities: (input.activities ?? content.activities) as Content['activities'],
    });
    t.set({ ...input, updatedBy: currentUser(req)._id });
    await t.save();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'template',
      entityId: t._id,
      action: 'template_updated',
    });
    res.json({ template: await toTemplateDto(req, t) });
  });

  // "Edit" on a Published template: a Draft of the next version (workflow §6).
  r.post('/:id/new-version', perm('templates', 'edit'), async (req, res) => {
    const t = await loadTemplate(req);
    if (t.status === 'DRAFT') throw conflict('This is already a draft.', 'TEMPLATE_IS_DRAFT');
    const existing = await TemplateModel.findOne({ templateKey: t.templateKey, status: 'DRAFT' });
    if (existing) return res.json({ template: await toTemplateDto(req, existing) });
    const latest = await TemplateModel.findOne({ templateKey: t.templateKey })
      .sort({ version: -1 })
      .lean();
    const userId = currentUser(req)._id;
    const draft = await TemplateModel.create({
      templateKey: t.templateKey,
      name: t.name,
      type: t.type,
      description: t.description,
      ...copyContent(t),
      version: (latest?.version ?? t.version) + 1,
      status: 'DRAFT',
      createdBy: userId,
      updatedBy: userId,
    });
    await audit({
      actorId: userId,
      entityType: 'template',
      entityId: draft._id,
      action: 'template_version_drafted',
      changes: [{ field: 'version', old: t.version, new: draft.version }],
    });
    res.status(201).json({ template: await toTemplateDto(req, draft) });
  });

  // Publish needs Edit on templates (Q-11 resolved: PMs publish too). Only Drafts with activities.
  r.post('/:id/publish', perm('templates', 'edit'), async (req, res) => {
    const t = await loadTemplate(req);
    if (t.status !== 'DRAFT') throw conflict('Only drafts can be published.', 'TEMPLATE_NOT_DRAFT');
    if (!t.activities.length) {
      throw unprocessable('Add at least one activity before publishing.', 'TEMPLATE_EMPTY');
    }
    validateTemplateContent(copyContent(t) as Content);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await TemplateModel.updateMany(
          {
            templateKey: t.templateKey,
            _id: { $ne: t._id },
            status: { $in: ['PUBLISHED', 'ARCHIVED'] },
            superseded: { $ne: true },
          },
          { $set: { superseded: true } },
          { session },
        );
        t.status = 'PUBLISHED';
        t.publishedAt = new Date();
        t.updatedBy = currentUser(req)._id;
        await t.save({ session });
      });
    } finally {
      await session.endSession();
    }
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'template',
      entityId: t._id,
      action: 'template_published',
      changes: [{ field: 'version', old: null, new: t.version }],
    });
    res.json({ template: await toTemplateDto(req, t) });
  });

  r.post('/:id/duplicate', perm('templates', 'create'), async (req, res) => {
    const t = await loadTemplate(req);
    const userId = currentUser(req)._id;
    const copy = await TemplateModel.create({
      templateKey: randomUUID(),
      name: `Copy of ${t.name}`.slice(0, 160),
      type: t.type,
      description: t.description,
      ...copyContent(t),
      version: 1,
      status: 'DRAFT',
      createdBy: userId,
      updatedBy: userId,
    });
    await audit({
      actorId: userId,
      entityType: 'template',
      entityId: copy._id,
      action: 'template_duplicated',
      meta: { from: t._id.toString() },
    });
    res.status(201).json({ template: await toTemplateDto(req, copy) });
  });

  // Archived templates leave the New project picker; existing projects keep their snapshot (FR-TPL-10).
  for (const [path, from, to] of [
    ['archive', 'PUBLISHED', 'ARCHIVED'],
    ['restore', 'ARCHIVED', 'PUBLISHED'],
  ] as const) {
    r.post(`/:id/${path}`, perm('templates', 'edit'), async (req, res) => {
      const t = await loadTemplate(req);
      if (t.superseded) throw conflict('Older versions are read-only.', 'TEMPLATE_SUPERSEDED');
      if (t.status !== from) {
        throw conflict(
          path === 'archive'
            ? 'Only published templates can be archived.'
            : 'This template isn’t archived.',
          'TEMPLATE_STATUS',
        );
      }
      t.status = to;
      t.updatedBy = currentUser(req)._id;
      await t.save();
      await audit({
        actorId: currentUser(req)._id,
        entityType: 'template',
        entityId: t._id,
        action: `template_${path === 'archive' ? 'archived' : 'restored'}`,
        changes: [{ field: 'status', old: from, new: to }],
      });
      res.json({ template: await toTemplateDto(req, t) });
    });
  }

  // Discarding a draft. Published versions are never deleted (projects reference them).
  r.delete('/:id', perm('templates', 'delete'), async (req, res) => {
    const t = await loadTemplate(req);
    if (t.status !== 'DRAFT') {
      throw conflict(
        'Only drafts can be deleted. Archive a published template instead.',
        'TEMPLATE_NOT_DRAFT',
      );
    }
    await t.deleteOne();
    await audit({
      actorId: currentUser(req)._id,
      entityType: 'template',
      entityId: t._id,
      action: 'template_draft_deleted',
    });
    res.status(204).end();
  });

  void badRequest;
  return r.router;
}
