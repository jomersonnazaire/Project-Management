import {
  DELIVERABLE_COPY,
  DELIVERABLE_MAX_ITEMS,
  deliverableTextProblem,
  type DeliverableItemDto,
} from '@xc8/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { unprocessable } from '../lib/http422.js';

/** CR-23 Part B helpers shared by the task, template and import routes (FR-DLV-01 to 05). */

export interface ItemLike {
  _id: Types.ObjectId;
  text: string;
  done?: boolean | null;
  doneBy?: Types.ObjectId | null;
  doneAt?: Date | null;
  doneViaImport?: boolean | null;
  order?: number | null;
  createdBy?: Types.ObjectId | null;
  createdAt?: Date | null;
}

/** Items in display order (`order`, then insertion). */
export const sortedItems = <T extends { order?: number | null }>(items: T[] | null | undefined) =>
  [...(items ?? [])]
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (a.it.order ?? 0) - (b.it.order ?? 0) || a.i - b.i)
    .map(({ it }) => it);

export function deliverableItemDtos(
  items: ItemLike[] | null | undefined,
  ref: (id?: Types.ObjectId | null) => { id: string; name: string } | null,
): DeliverableItemDto[] {
  return sortedItems(items).map((i, n) => {
    const by = ref(i.doneBy);
    const author = ref(i.createdBy);
    return {
      id: i._id.toString(),
      text: i.text,
      done: Boolean(i.done),
      doneBy: by ? { id: by.id, name: by.name } : null,
      doneAt: i.doneAt ? i.doneAt.toISOString() : null,
      doneFromImport: Boolean(i.done && i.doneViaImport),
      order: n + 1,
      createdBy: author ? { id: author.id, name: author.name } : null,
      createdAt: (i.createdAt ?? new Date(0)).toISOString(),
    };
  });
}

/** NFR-56: 422 for typed text over 200 characters (or blank). `keep` = texts already stored. */
export function assertItemText(text: string, keep?: ReadonlySet<string>) {
  const problem = deliverableTextProblem(text, keep);
  if (problem) throw unprocessable(problem, 'DELIVERABLE_TOO_LONG');
}

/** NFR-56: 422 past 50 items per task or template activity. */
export function assertItemCount(n: number) {
  if (n > DELIVERABLE_MAX_ITEMS) throw unprocessable(DELIVERABLE_COPY.LIMIT, 'DELIVERABLE_LIMIT');
}

/** A new task's first items from the task form: unticked, by the person creating the task. */
export function newTaskItems(items: { text: string }[], actorId: Types.ObjectId) {
  assertItemCount(items.length);
  const at = new Date();
  return items.map((i, n) => {
    assertItemText(i.text);
    return {
      _id: new Types.ObjectId(),
      text: i.text.trim(),
      done: false,
      doneBy: null,
      doneAt: null,
      doneViaImport: false,
      order: n + 1,
      createdBy: actorId,
      createdAt: at,
    };
  });
}

/**
 * FR-TSK-38 / FR-DLV-04 / Q-160: a template activity's items copied onto a new task, unticked, in
 * the same order, text in full (never cut to the cap).
 */
export function copyTemplateItems(items: { text: string; order?: number | null }[] | undefined) {
  const at = new Date();
  return sortedItems(items ?? []).map((i, n) => ({
    _id: new Types.ObjectId(),
    text: i.text,
    done: false,
    doneBy: null,
    doneAt: null,
    doneViaImport: false,
    order: n + 1,
    createdBy: null,
    createdAt: at,
  }));
}

/**
 * FR-TSK-38 / AC-76.4: after CR-23 the old single `deliverable` text isn't accepted on task or
 * template writes; 422 (not the generic unknown-field 400) so old clients get a clear answer.
 */
export function rejectLegacyDeliverable(req: Request) {
  const body = req.body as Record<string, unknown> | undefined;
  const acts = body && Array.isArray(body.activities) ? (body.activities as unknown[]) : [];
  const legacy =
    (body && typeof body === 'object' && 'deliverable' in body) ||
    acts.some((a) => a && typeof a === 'object' && 'deliverable' in (a as object));
  if (legacy) throw unprocessable(DELIVERABLE_COPY.FIELD_REMOVED, 'DELIVERABLE_FIELD_REMOVED');
}
