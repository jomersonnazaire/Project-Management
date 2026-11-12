import {
  addDeliverableItemSchema,
  deleteDeliverableItemQuerySchema,
  reorderDeliverableItemsSchema,
  restoreDeliverableItemSchema,
  updateDeliverableItemSchema,
} from '@xc8/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { perm, type RouteRegistry } from '../access/registry.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { now as clockNow } from '../lib/clock.js';
import { idParam, parseBody, parseQuery } from '../lib/validate.js';
import { currentPermissions, currentUser } from '../middleware/auth.js';
import { ActivityLogModel, TaskModel } from '../models/index.js';
import { audit } from '../services/audit.js';
import { assertDeliverablesOpen, deliverablesEditor } from '../services/checklistAccess.js';
import {
  assertItemCount,
  assertItemText,
  DELIVERABLE_MIGRATION_AUDIT_ACTION,
  legacyDeliverable,
  legacyItem,
  sortedItems,
  type ItemLike,
} from '../services/deliverableItems.js';
import { loadTask, respondTask, type TaskDoc } from './tasks.js';

/**
 * CR-23 FR-DLV-05: a task's deliverable checklist.
 *   POST   /tasks/:id/deliverable-items                 add `{ text, version }` → 201
 *   PATCH  /tasks/:id/deliverable-items/:itemId         `{ text?, done?, version }` edit / tick / untick
 *   POST   /tasks/:id/deliverable-items/reorder         `{ itemIds, version }` (order only)
 *   DELETE /tasks/:id/deliverable-items/:itemId?version=n
 *   POST   /tasks/:id/deliverable-items/:itemId/restore `{ version }` Undo of a remove (UIE §5.3)
 * Only the task's owner, the project's PM and Admins (FR-DLV-02/03); everyone else 403. Refused on
 * Completed, Cancelled and archived projects (FR-DLV-06). Each write bumps the task `version` and a
 * stale one is 409 (EC-210). Every write is audited on the task (FR-DLV-07). Ticking never changes
 * the task's status (FR-DLV-09).
 */

const VERSION_CONFLICT = 'Someone else changed this list. Check it and try again.';
/** UIE §5.3: Undo lasts about 6 seconds; the API allows a generous window. */
const RESTORE_WINDOW_MS = 60 * 60 * 1000;

type Item = ItemLike;

async function loadEditable(req: Request) {
  const { task, project } = await loadTask(req);
  const p = project.toObject() as Parameters<typeof deliverablesEditor>[2] & {
    _id: Types.ObjectId;
  };
  assertDeliverablesOpen(p);
  if (!deliverablesEditor(currentUser(req), currentPermissions(req), p, task)) {
    throw forbidden(
      'Only the task owner, the project PM and Admins can change deliverables.',
      'DELIVERABLES_READ_ONLY',
    );
  }
  return { task, project };
}

const asObject = (t: { toObject: () => unknown }) => t.toObject() as TaskDoc;
const itemsOf = (t: TaskDoc) => sortedItems((t.deliverableItems ?? []) as unknown as Item[]);

/** Writes the whole list (renumbered 1…n) if the task is still at `version`, else 409. */
async function saveItems(taskId: Types.ObjectId, version: number, items: Item[]) {
  const res = await TaskModel.updateOne(
    { _id: taskId, version },
    {
      // The old `deliverable` text is left as it is (rollback, Lean); the marker stops the
      // read-only fallback from coming back once the list was saved, even if it's emptied later.
      $set: {
        deliverableItems: items.map((i, n) => ({ ...i, order: n + 1 })),
        deliverableLegacyMoved: true,
      },
      $inc: { version: 1 },
    },
  );
  if (!res.modifiedCount) throw conflict(VERSION_CONFLICT, 'VERSION_CONFLICT');
}

function checkVersion(t: TaskDoc, version: number) {
  if ((t.version ?? 0) !== version) throw conflict(VERSION_CONFLICT, 'VERSION_CONFLICT');
}

const snapshot = (i: Item, order: number) => ({
  id: i._id.toString(),
  text: i.text,
  done: Boolean(i.done),
  doneBy: i.doneBy ? i.doneBy.toString() : null,
  doneAt: i.doneAt ? i.doneAt.toISOString() : null,
  doneViaImport: Boolean(i.doneViaImport),
  order,
  createdBy: i.createdBy ? i.createdBy.toString() : null,
  createdAt: i.createdAt ? i.createdAt.toISOString() : null,
});

export function deliverablesRouter(registry: RouteRegistry) {
  const r = registry.router('/tasks');

  const log = (
    req: Request,
    task: { _id: Types.ObjectId; projectId: Types.ObjectId },
    action: string,
    changes: { field: string; old: unknown; new: unknown }[],
    meta: Record<string, unknown>,
  ) =>
    audit({
      actorId: currentUser(req)._id,
      entityType: 'task',
      entityId: task._id,
      projectId: task.projectId,
      action,
      // `deliverableItems` is what the Checklist import's Changed-since-export check reads
      // (FR-CLX-09).
      changes,
      meta,
    });

  r.post('/:id/deliverable-items', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(addDeliverableItemSchema, req);
    const { task, project } = await loadEditable(req);
    const t = asObject(task);
    checkVersion(t, input.version);
    // Lean: the first item added turns the old Deliverable text (shown read-only until now) into a
    // real first item, unticked, exactly as the migration does.
    const legacy = legacyDeliverable(t);
    const items = legacy ? [legacyItem(legacy, clockNow())] : itemsOf(t);
    assertItemCount(items.length + 1);
    assertItemText(input.text);
    const item: Item = {
      _id: new Types.ObjectId(),
      text: input.text.trim(),
      done: false,
      doneBy: null,
      doneAt: null,
      doneViaImport: false,
      order: items.length + 1,
      createdBy: currentUser(req)._id,
      createdAt: clockNow(),
    };
    await saveItems(task._id, input.version, [...items, item]);
    if (legacy)
      await log(
        req,
        task,
        DELIVERABLE_MIGRATION_AUDIT_ACTION,
        [{ field: 'deliverableItems', old: null, new: legacy }],
        { itemId: items[0]!._id.toString(), text: legacy, onFirstAdd: true },
      );
    await log(
      req,
      task,
      'deliverable_item_added',
      [{ field: 'deliverableItems', old: null, new: item.text }],
      { itemId: item._id.toString(), text: item.text },
    );
    await respondTask(req, res, project.toObject(), task._id, 201);
  });

  r.post('/:id/deliverable-items/reorder', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(reorderDeliverableItemsSchema, req);
    const { task, project } = await loadEditable(req);
    const t = asObject(task);
    checkVersion(t, input.version);
    const items = itemsOf(t);
    const byId = new Map(items.map((i) => [i._id.toString(), i]));
    if (
      input.itemIds.length !== items.length ||
      new Set(input.itemIds).size !== items.length ||
      input.itemIds.some((id) => !byId.has(id))
    ) {
      throw badRequest(
        'Send every item of this task once, in the new order.',
        undefined,
        'BAD_ORDER',
      );
    }
    const next = input.itemIds.map((id) => byId.get(id)!);
    const before = items.map((i) => i._id.toString());
    if (before.join() !== input.itemIds.join()) {
      await saveItems(task._id, input.version, next);
      await log(
        req,
        task,
        'deliverable_items_reordered',
        [{ field: 'deliverableItems', old: before, new: input.itemIds }],
        {},
      );
    }
    await respondTask(req, res, project.toObject(), task._id);
  });

  r.patch('/:id/deliverable-items/:itemId', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(updateDeliverableItemSchema, req);
    const { task, project } = await loadEditable(req);
    const t = asObject(task);
    const itemId = idParam(req, 'itemId');
    const items = itemsOf(t);
    const at = items.findIndex((i) => i._id.toString() === itemId);
    if (at < 0) throw notFound();
    checkVersion(t, input.version);
    const old = items[at]!;
    const next: Item = { ...old };
    const audits: [string, { field: string; old: unknown; new: unknown }[]][] = [];
    if (input.text !== undefined && input.text.trim() !== old.text) {
      // Q-160 / AC-76.16: the cap applies to changed text, even on a migrated long item.
      assertItemText(input.text);
      next.text = input.text.trim();
      audits.push([
        'deliverable_item_updated',
        [{ field: 'deliverableItems', old: old.text, new: next.text }],
      ]);
    }
    if (input.done !== undefined && input.done !== Boolean(old.done)) {
      Object.assign(
        next,
        input.done
          ? { done: true, doneBy: currentUser(req)._id, doneAt: clockNow(), doneViaImport: false }
          : { done: false, doneBy: null, doneAt: null, doneViaImport: false },
      );
      audits.push([
        input.done ? 'deliverable_item_ticked' : 'deliverable_item_unticked',
        [{ field: 'deliverableItems', old: Boolean(old.done), new: input.done }],
      ]);
    }
    if (audits.length) {
      items[at] = next;
      await saveItems(task._id, input.version, items);
      for (const [action, changes] of audits)
        await log(req, task, action, changes, { itemId, text: next.text });
    }
    await respondTask(req, res, project.toObject(), task._id);
  });

  r.delete('/:id/deliverable-items/:itemId', perm('tasks', 'edit'), async (req, res) => {
    const { version } = parseQuery(deleteDeliverableItemQuerySchema, req);
    const { task, project } = await loadEditable(req);
    const t = asObject(task);
    const itemId = idParam(req, 'itemId');
    const items = itemsOf(t);
    const at = items.findIndex((i) => i._id.toString() === itemId);
    if (at < 0) throw notFound();
    checkVersion(t, version);
    const old = items[at]!;
    await saveItems(
      task._id,
      version,
      items.filter((_, i) => i !== at),
    );
    await log(
      req,
      task,
      'deliverable_item_deleted',
      [{ field: 'deliverableItems', old: old.text, new: null }],
      // The snapshot lets Undo put the very same item back (restore below).
      { itemId, text: old.text, item: snapshot(old, at + 1) },
    );
    await respondTask(req, res, project.toObject(), task._id);
  });

  r.post('/:id/deliverable-items/:itemId/restore', perm('tasks', 'edit'), async (req, res) => {
    const input = parseBody(restoreDeliverableItemSchema, req);
    const { task, project } = await loadEditable(req);
    const t = asObject(task);
    const itemId = idParam(req, 'itemId');
    checkVersion(t, input.version);
    const items = itemsOf(t);
    if (items.some((i) => i._id.toString() === itemId)) {
      return respondTask(req, res, project.toObject(), task._id);
    }
    const entry = await ActivityLogModel.findOne({
      entityType: 'task',
      entityId: task._id,
      action: 'deliverable_item_deleted',
      'meta.itemId': itemId,
      at: { $gt: new Date(clockNow().getTime() - RESTORE_WINDOW_MS) },
    })
      .sort({ at: -1 })
      .lean();
    const snap = (entry?.meta as { item?: ReturnType<typeof snapshot> } | null)?.item;
    if (!snap) throw notFound();
    assertItemCount(items.length + 1);
    const oid = (v: string | null) => (v ? new Types.ObjectId(v) : null);
    const item: Item = {
      _id: new Types.ObjectId(snap.id),
      text: snap.text,
      done: snap.done,
      doneBy: oid(snap.doneBy),
      doneAt: snap.doneAt ? new Date(snap.doneAt) : null,
      doneViaImport: snap.doneViaImport,
      order: snap.order,
      createdBy: oid(snap.createdBy),
      createdAt: snap.createdAt ? new Date(snap.createdAt) : clockNow(),
    };
    const pos = Math.min(Math.max(snap.order - 1, 0), items.length);
    await saveItems(task._id, input.version, [...items.slice(0, pos), item, ...items.slice(pos)]);
    await log(
      req,
      task,
      'deliverable_item_added',
      [{ field: 'deliverableItems', old: null, new: item.text }],
      { itemId, text: item.text, restored: true },
    );
    await respondTask(req, res, project.toObject(), task._id, 201);
  });

  return r.router;
}
