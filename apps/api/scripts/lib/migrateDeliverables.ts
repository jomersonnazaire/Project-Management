/**
 * CR-23 FR-DLV-04 (one-time deliverable migration): the old single `deliverable` text on tasks and
 * on template activities becomes the first deliverable item (`text` = the trimmed string, unticked,
 * `order` 1, `createdBy` null, `createdAt` = the migration time). Text is never cut (Q-160). Empty
 * or null strings just drop the old field. A task or activity that already has items keeps them and
 * keeps its old text (reported, not changed). Idempotent: the old field is removed in the same
 * write, so a second run finds nothing. Each changed task or template gets one
 * `deliverables_migrated` audit entry.
 *
 * Reads and writes the raw collections: the `deliverable` field is no longer in the models.
 */
import { Types } from 'mongoose';
import { TaskModel, TemplateModel } from '../../src/models/index.js';
import { auditMany } from '../../src/services/audit.js';

export const DELIVERABLE_MIGRATION_AUDIT_ACTION = 'deliverables_migrated';
const REASON = 'CR-23 FR-DLV-04: one-time move of the Deliverable text into a checklist item';

export interface DeliverableMigrationResult {
  apply: boolean;
  tasksChecked: number;
  templatesChecked: number;
  /** Tasks whose text becomes an item (or whose empty old field is dropped). */
  tasks: { taskId: string; projectId: string; text: string | null }[];
  templates: {
    templateId: string;
    name: string;
    version: number;
    activities: { id: string; text: string | null }[];
  }[];
  /** Records that already have items and still carry old text (left as they are). */
  skipped: { kind: 'task' | 'activity'; id: string; text: string }[];
}

type Raw = Record<string, unknown> & { _id: Types.ObjectId };

const textOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const item = (text: string, at: Date) => ({
  _id: new Types.ObjectId(),
  text,
  done: false,
  doneBy: null,
  doneAt: null,
  doneViaImport: false,
  order: 1,
  createdBy: null,
  createdAt: at,
});

/** Dry run unless `apply` is true: reports what would change and writes nothing. */
export async function migrateAllDeliverables(opts: {
  apply: boolean;
  now?: Date;
}): Promise<DeliverableMigrationResult> {
  const at = opts.now ?? new Date();
  const out: DeliverableMigrationResult = {
    apply: opts.apply,
    tasksChecked: 0,
    templatesChecked: 0,
    tasks: [],
    templates: [],
    skipped: [],
  };

  // Tasks.
  const tasks = TaskModel.collection.find(
    { deliverable: { $exists: true } },
    { projection: { _id: 1, projectId: 1, deliverable: 1, deliverableItems: 1 } },
  );
  for await (const raw of tasks) {
    const t = raw as Raw;
    out.tasksChecked += 1;
    const text = textOf(t.deliverable);
    const items = Array.isArray(t.deliverableItems) ? t.deliverableItems : [];
    if (items.length) {
      if (text) out.skipped.push({ kind: 'task', id: t._id.toString(), text });
      continue;
    }
    out.tasks.push({ taskId: t._id.toString(), projectId: String(t.projectId), text });
    if (!opts.apply) continue;
    // Only while the record is still as read (the old text, no items yet).
    const res = await TaskModel.collection.updateOne(
      {
        _id: t._id,
        deliverable: t.deliverable,
        $or: [{ deliverableItems: { $exists: false } }, { deliverableItems: { $size: 0 } }],
      },
      {
        $set: { deliverableItems: text ? [item(text, at)] : [] },
        $unset: { deliverable: '' },
        $inc: { version: 1 },
      },
    );
    if (res.modifiedCount && text) {
      await auditMany([
        {
          actorId: null,
          entityType: 'task',
          entityId: t._id,
          projectId: t.projectId as Types.ObjectId,
          action: DELIVERABLE_MIGRATION_AUDIT_ACTION,
          reason: REASON,
          changes: [{ field: 'deliverableItems', old: null, new: text }],
        },
      ]);
    }
  }

  // Template activities (every version: projects are generated from published ones).
  const templates = TemplateModel.collection.find(
    { 'activities.deliverable': { $exists: true } },
    { projection: { _id: 1, name: 1, version: 1, activities: 1 } },
  );
  for await (const raw of templates) {
    const t = raw as Raw;
    out.templatesChecked += 1;
    const acts = (Array.isArray(t.activities) ? t.activities : []) as Record<string, unknown>[];
    const changed: { id: string; text: string | null }[] = [];
    const next = acts.map((a) => {
      if (!('deliverable' in a)) return a;
      const text = textOf(a.deliverable);
      const items = Array.isArray(a.deliverableItems) ? a.deliverableItems : [];
      if (items.length) {
        if (text)
          out.skipped.push({ kind: 'activity', id: `${t._id.toString()}/${String(a.id)}`, text });
        return a;
      }
      changed.push({ id: String(a.id), text });
      const { deliverable: _old, ...rest } = a;
      void _old;
      return { ...rest, deliverableItems: text ? [item(text, at)] : [] };
    });
    if (!changed.length) continue;
    out.templates.push({
      templateId: t._id.toString(),
      name: String(t.name),
      version: Number(t.version),
      activities: changed,
    });
    if (!opts.apply) continue;
    const res = await TemplateModel.collection.updateOne(
      { _id: t._id, activities: acts },
      { $set: { activities: next } },
    );
    if (res.modifiedCount && changed.some((c) => c.text)) {
      await auditMany([
        {
          actorId: null,
          entityType: 'template',
          entityId: t._id,
          action: DELIVERABLE_MIGRATION_AUDIT_ACTION,
          reason: REASON,
          changes: changed
            .filter((c) => c.text)
            .map((c) => ({ field: `activities.${c.id}.deliverableItems`, old: null, new: c.text })),
        },
      ]);
    }
  }
  return out;
}
