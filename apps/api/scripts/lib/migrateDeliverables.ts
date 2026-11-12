/**
 * CR-23 FR-DLV-04 (one-time deliverable migration): the old single `deliverable` text on tasks and
 * on template activities is copied into the first deliverable item (`text` = the trimmed string,
 * unticked, `order` 1, `createdBy` null, `createdAt` = the migration time). Text is never cut
 * (Q-160).
 *
 * Lean (rollback): the old `deliverable` field is LEFT AS IT IS, on every record, text or empty. It
 * is never unset, cleared or rewritten, so the pre-CR-23 app still shows it after a rollback.
 * Empty or blank strings are not touched at all.
 *
 * Idempotent without relying on the old field: a record counts as migrated once it has items or
 * carries `deliverableLegacyMoved: true` (set in the same write as the items, and by the app when
 * it converts on the first add). A re-run changes nothing. A record that already has items but
 * still has old text is reported and left alone. Each changed task or template gets one
 * `deliverables_migrated` audit entry.
 *
 * Reads and writes the raw collections (no Mongoose casting or defaults).
 */
import { Types } from 'mongoose';
import { ActivityLogModel, TaskModel, TemplateModel } from '../../src/models/index.js';
import { auditMany } from '../../src/services/audit.js';
import {
  DELIVERABLE_MIGRATION_AUDIT_ACTION,
  legacyItem,
} from '../../src/services/deliverableItems.js';

export { DELIVERABLE_MIGRATION_AUDIT_ACTION };
const REASON =
  'CR-23 FR-DLV-04: one-time copy of the Deliverable text into a checklist item (old field kept)';

export interface DeliverableMigrationResult {
  apply: boolean;
  /** Tasks / templates with a non-blank old text that aren't marked as moved. */
  tasksChecked: number;
  templatesChecked: number;
  /** Tasks whose text is (or would be) copied into a first item. */
  tasks: { taskId: string; projectId: string; text: string }[];
  templates: {
    templateId: string;
    name: string;
    version: number;
    activities: { id: string; text: string }[];
  }[];
  /** Records that already have items and still carry old text (left as they are). */
  skipped: { kind: 'task' | 'activity'; id: string; text: string }[];
}

type Raw = Record<string, unknown> & { _id: Types.ObjectId };

const textOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const hasItems = (v: unknown) => Array.isArray(v) && v.length > 0;
const NOT_MOVED = { $ne: true };

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
    { deliverable: { $type: 'string', $regex: /\S/ }, deliverableLegacyMoved: NOT_MOVED },
    { projection: { _id: 1, projectId: 1, deliverable: 1, deliverableItems: 1 } },
  );
  for await (const raw of tasks) {
    const t = raw as Raw;
    const text = textOf(t.deliverable);
    if (!text) continue;
    out.tasksChecked += 1;
    if (hasItems(t.deliverableItems)) {
      out.skipped.push({ kind: 'task', id: t._id.toString(), text });
      continue;
    }
    out.tasks.push({ taskId: t._id.toString(), projectId: String(t.projectId), text });
    if (!opts.apply) continue;
    // Only while the record is still as read (no items, not moved). `deliverable` isn't written.
    const res = await TaskModel.collection.updateOne(
      {
        _id: t._id,
        deliverableLegacyMoved: NOT_MOVED,
        $or: [{ deliverableItems: { $exists: false } }, { deliverableItems: { $size: 0 } }],
      },
      {
        $set: { deliverableItems: [legacyItem(text, at)], deliverableLegacyMoved: true },
        $inc: { version: 1 },
      },
    );
    if (res.modifiedCount) {
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
    { 'activities.deliverable': { $type: 'string' } },
    { projection: { _id: 1, name: 1, version: 1, activities: 1 } },
  );
  for await (const raw of templates) {
    const t = raw as Raw;
    const acts = (Array.isArray(t.activities) ? t.activities : []) as Record<string, unknown>[];
    const changed: { id: string; text: string }[] = [];
    let checked = false;
    const next = acts.map((a) => {
      const text = textOf(a.deliverable);
      if (!text || a.deliverableLegacyMoved === true) return a;
      checked = true;
      if (hasItems(a.deliverableItems)) {
        out.skipped.push({ kind: 'activity', id: `${t._id.toString()}/${String(a.id)}`, text });
        return a;
      }
      changed.push({ id: String(a.id), text });
      // `deliverable` stays on the activity as it is.
      return { ...a, deliverableItems: [legacyItem(text, at)], deliverableLegacyMoved: true };
    });
    if (checked) out.templatesChecked += 1;
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
    if (res.modifiedCount) {
      await auditMany([
        {
          actorId: null,
          entityType: 'template',
          entityId: t._id,
          action: DELIVERABLE_MIGRATION_AUDIT_ACTION,
          reason: REASON,
          changes: changed.map((c) => ({
            field: `activities.${c.id}.deliverableItems`,
            old: null,
            new: c.text,
          })),
        },
      ]);
    }
  }
  return out;
}

export interface LegacyRestoreResult {
  apply: boolean;
  /** Migration audit entries (actor null) looked at. */
  entriesChecked: number;
  /** Fully reverted: old text back, the migration's item removed (looks as before any migration). */
  tasks: { taskId: string; text: string }[];
  templates: { templateId: string; activities: { id: string; text: string }[] }[];
  /** Old text back, but the items were changed after the migration, so they're kept. */
  skippedItems: { kind: 'task' | 'activity'; id: string; text: string }[];
  /** Records named in an entry that still have the field (or are gone): never touched. */
  leftAlone: number;
}

type ItemRaw = { text?: unknown; done?: unknown; createdBy?: unknown };
/** The list is still exactly what the migration wrote: one unticked, authorless item, same text. */
const untouched = (items: unknown, text: string) => {
  if (!Array.isArray(items) || items.length !== 1) return false;
  const i = items[0] as ItemRaw;
  return i.text === text && !i.done && !i.createdBy;
};

/**
 * One-off staging repair (Lean / Queen, 2026-11-11): `--restore-legacy`. The first CR-23
 * migration (f73cf65) copied the old `deliverable` text into a first item and `$unset` the field.
 * This reverts that, only for the records that migration's own `deliverables_migrated` audit
 * entries name (actor null) and only where the `deliverable` field is MISSING (a record that still
 * has the field is never touched, so records from the current migration are safe):
 *   - items unchanged since then (one unticked item, the migrated text, no author, and for tasks
 *     no later item audit): `deliverable` is set back to the text and the items are removed, so
 *     the record looks as before any migration (read-only fallback shows; the migration can run
 *     again);
 *   - items changed since: only the text is put back (items kept, `deliverableLegacyMoved` set),
 *     reported as skipped-items.
 * The text is the one the entry recorded (the trimmed string that became the item). Idempotent:
 * once the field is back a re-run skips the record. Empty texts were never audited, so empty
 * fields that script dropped stay dropped (the old app shows missing and empty alike).
 */
export async function restoreLegacyDeliverables(opts: {
  apply: boolean;
}): Promise<LegacyRestoreResult> {
  const out: LegacyRestoreResult = {
    apply: opts.apply,
    entriesChecked: 0,
    tasks: [],
    templates: [],
    skippedItems: [],
    leftAlone: 0,
  };
  const entries = await ActivityLogModel.find({
    action: DELIVERABLE_MIGRATION_AUDIT_ACTION,
    actorId: null,
    entityType: { $in: ['task', 'template'] },
  })
    .sort({ at: 1 })
    .lean();
  // The earliest entry per record holds the text the migration moved.
  const taskText = new Map<string, { text: string; at: Date }>();
  const tplText = new Map<string, Map<string, string>>();
  for (const e of entries) {
    out.entriesChecked += 1;
    const id = String(e.entityId);
    for (const c of e.changes ?? []) {
      if (typeof c.new !== 'string' || !c.new) continue;
      if (e.entityType === 'task' && c.field === 'deliverableItems') {
        if (!taskText.has(id)) taskText.set(id, { text: c.new, at: e.at ?? new Date(0) });
      } else if (e.entityType === 'template') {
        const m = /^activities\.(.+)\.deliverableItems$/.exec(c.field ?? '');
        if (!m) continue;
        const acts = tplText.get(id) ?? new Map<string, string>();
        if (!acts.has(m[1]!)) acts.set(m[1]!, c.new);
        tplText.set(id, acts);
      }
    }
  }

  for (const [id, { text, at }] of taskText) {
    const _id = new Types.ObjectId(id);
    const t = await TaskModel.collection.findOne(
      { _id },
      { projection: { deliverable: 1, deliverableItems: 1 } },
    );
    if (!t || 'deliverable' in t) {
      out.leftAlone += 1;
      continue;
    }
    const laterChange = await ActivityLogModel.exists({
      entityType: 'task',
      entityId: _id,
      at: { $gt: at },
      $or: [{ action: /^deliverable_item/ }, { 'changes.field': 'deliverableItems' }],
    });
    const revert = untouched(t.deliverableItems, text) && !laterChange;
    if (revert) out.tasks.push({ taskId: id, text });
    else out.skippedItems.push({ kind: 'task', id, text });
    if (!opts.apply) continue;
    // Only while the field is still missing (and, for a revert, the items still as checked).
    await TaskModel.collection.updateOne(
      revert
        ? { _id, deliverable: { $exists: false }, deliverableItems: t.deliverableItems }
        : { _id, deliverable: { $exists: false } },
      revert
        ? {
            $set: { deliverable: text, deliverableItems: [] },
            $unset: { deliverableLegacyMoved: '' },
            $inc: { version: 1 },
          }
        : { $set: { deliverable: text, deliverableLegacyMoved: true } },
    );
  }

  for (const [id, texts] of tplText) {
    const _id = new Types.ObjectId(id);
    const t = await TemplateModel.collection.findOne({ _id }, { projection: { activities: 1 } });
    const acts = (Array.isArray(t?.activities) ? t.activities : []) as Record<string, unknown>[];
    const reverted: { id: string; text: string }[] = [];
    let touched = 0;
    const next = acts.map((a) => {
      const text = texts.get(String(a.id));
      if (!text || 'deliverable' in a) return a;
      touched += 1;
      if (untouched(a.deliverableItems, text)) {
        reverted.push({ id: String(a.id), text });
        const { deliverableLegacyMoved: _m, ...rest } = a;
        void _m;
        return { ...rest, deliverable: text, deliverableItems: [] };
      }
      out.skippedItems.push({ kind: 'activity', id: `${id}/${String(a.id)}`, text });
      return { ...a, deliverable: text, deliverableLegacyMoved: true };
    });
    out.leftAlone += texts.size - touched;
    if (reverted.length) out.templates.push({ templateId: id, activities: reverted });
    if (!t || !touched || !opts.apply) continue;
    await TemplateModel.collection.updateOne(
      { _id, activities: acts },
      { $set: { activities: next } },
    );
  }
  return out;
}
