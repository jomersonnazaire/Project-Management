import { z } from 'zod';

/**
 * CR-23 Part B: deliverable checklists (FR-DLV-01 to 09, NFR-56). A task's (and a template
 * activity's) Deliverable is a list of items. Shared by the API (validation, the Checklist file's
 * Deliverables cell) and the web app (limits, copy, the task panel list).
 */

/** NFR-56 / Q-156: items per task or template activity. */
export const DELIVERABLE_MAX_ITEMS = 50;
/** NFR-56 / Q-156: characters per NEW or edited item. Migrated text is never cut (Q-160). */
export const DELIVERABLE_MAX_TEXT = 200;
/** UIE §5.4: the length counter shows from this many characters. */
export const DELIVERABLE_COUNTER_FROM = 180;
/** UIE §5.4: the "· 45/50 items" note shows from this many items. */
export const DELIVERABLE_COUNT_NOTE_FROM = 40;

export interface DeliverableItemDto {
  id: string;
  text: string;
  done: boolean;
  /** The person who ticked it; null for an unticked item, a migrated one, or a tick from a file. */
  doneBy: { id: string; name: string } | null;
  doneAt: string | null;
  /** UIE §4.5: ticked by a Checklist import ("Done · from import, {date}"). */
  doneFromImport: boolean;
  /**
   * CR-23 (Lean): the task's old single Deliverable text, shown until the task has real items.
   * Read-only (no tick, edit, remove or reorder); counts as not done. Its id is `legacy`.
   */
  legacy: boolean;
  order: number;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

/** Template activities hold the same kind of list, never ticked (FR-DLV-01). */
export interface TemplateDeliverableItemDto {
  id: string;
  text: string;
  /** The activity's old Deliverable text, not yet moved into an item (id `legacy`). */
  legacy?: boolean;
}

/** CR-23 (Lean): the id of the read-only item that shows an old Deliverable text. */
export const LEGACY_DELIVERABLE_ID = 'legacy';

/** UIE §5.4 copy. */
export const deliverableTooLongMessage = (n: number) =>
  `A deliverable can be up to ${DELIVERABLE_MAX_TEXT} characters (this one has ${n}).`;
export const DELIVERABLE_COPY = {
  EMPTY_EDIT:
    'No deliverable items yet. Add what this task has to hand over, like a signed form or a test report.',
  EMPTY_READ: 'No deliverable items yet.',
  VIEW_ONLY: 'View only. The task owner, the project PM and Admins change deliverables.',
  ADD_PLACEHOLDER: 'Add a deliverable and press Enter',
  ADD_LABEL: 'Add a deliverable',
  AT_LIMIT_PLACEHOLDER: `${DELIVERABLE_MAX_ITEMS} items is the most for one task`,
  AT_LIMIT_NOTE: `This task has ${DELIVERABLE_MAX_ITEMS} deliverable items, the most allowed. Remove one to add another.`,
  SAVE_FAILED: "Couldn't save. Check your connection and try again.",
  CONFLICT: 'Someone else changed this list. Check it and try again.',
  TEXT_REQUIRED: 'Enter the deliverable.',
  LIMIT: `A task can have up to ${DELIVERABLE_MAX_ITEMS} deliverable items.`,
  /** FR-TSK-38: the old single text field is gone from write APIs. */
  /** Under the read-only item that shows the old Deliverable text. */
  LEGACY_NOTE:
    'From the old Deliverable field. It becomes a normal item when you add the first deliverable.',
  LEGACY_NOTE_READ: 'From the old Deliverable field.',
  LEGACY_BADGE: 'Old text',
  FIELD_REMOVED:
    'Deliverable is now a checklist. Send deliverableItems instead of the old deliverable text.',
} as const;
/** UIE §5.1: the read-only line on a locked project (FR-DLV-06). */
export const DELIVERABLE_LOCKED_COPY = {
  COMPLETED:
    'This project is completed, so its plan is read-only. Reopen the project to change tasks.',
  CANCELLED: 'This project is cancelled, so its plan is read-only.',
  ARCHIVED: 'This project is archived. Restore it before making changes.',
} as const;

/** UIE §5.2: "2 of 5 done". */
export const deliverableProgress = (items: { done: boolean }[]) =>
  `${items.filter((i) => i.done).length} of ${items.length} done`;

// ---------- Request schemas (strict, NFR-04) ----------
/**
 * The 200 cap (NFR-56) is a business rule answered with 422 by the API (`deliverableTextProblem`),
 * so the schema only bounds the body size.
 */
const itemText = z.string().trim().min(1, DELIVERABLE_COPY.TEXT_REQUIRED).max(10_000);
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.');
const version = z.number().int().min(0);

export const addDeliverableItemSchema = z.strictObject({ text: itemText, version });
export type AddDeliverableItemInput = z.input<typeof addDeliverableItemSchema>;

/** Edit text and/or tick / untick (FR-DLV-03, Q-156). Text over 200 is checked by the API. */
export const updateDeliverableItemSchema = z
  .strictObject({
    // The 200 cap applies to changed text; an untouched migrated item can still be ticked.
    text: itemText.optional(),
    done: z.boolean().optional(),
    version,
  })
  .refine((v) => v.text !== undefined || v.done !== undefined, 'Nothing to update.');
export type UpdateDeliverableItemInput = z.input<typeof updateDeliverableItemSchema>;

export const reorderDeliverableItemsSchema = z.strictObject({
  itemIds: z.array(objectId).max(DELIVERABLE_MAX_ITEMS + 50),
  version,
});
export type ReorderDeliverableItemsInput = z.input<typeof reorderDeliverableItemsSchema>;

export const deleteDeliverableItemQuerySchema = z.strictObject({
  version: z.coerce.number().int().min(0),
});

/** Undo after a remove (UIE §5.3): the API puts the removed item back from its audit entry. */
export const restoreDeliverableItemSchema = z.strictObject({ version });

/** A new task's first items (task form) and a template activity's items: text only, unticked. */
export const newDeliverableItemsSchema = z
  .array(z.strictObject({ text: itemText }))
  .max(DELIVERABLE_MAX_ITEMS + 50);

/**
 * Template activity items. An item keeps its id across saves; text over 200 is allowed only when
 * it is unchanged from the stored item (migrated text, Q-160), which the API checks.
 */
export const templateDeliverableItemsSchema = z
  .array(
    z.strictObject({
      id: z.string().trim().max(40).optional(),
      /** Sent back as the DTO had it; ignored (the server knows which item is the old text). */
      legacy: z.boolean().optional(),
      text: itemText,
    }),
  )
  .max(DELIVERABLE_MAX_ITEMS + 50);

/**
 * NFR-56: why a typed (new or changed) item text is refused, or null. `keep` holds texts already
 * stored on this record, which may stay longer than the cap (migrated text, Q-160).
 */
export function deliverableTextProblem(text: string, keep?: ReadonlySet<string>): string | null {
  const t = text.trim();
  if (!t) return DELIVERABLE_COPY.TEXT_REQUIRED;
  if (t.length > DELIVERABLE_MAX_TEXT && !keep?.has(t)) return deliverableTooLongMessage(t.length);
  return null;
}

// ---------- The Checklist file's Deliverables cell (FR-CLX-04, Q-158) ----------
export interface DeliverableLine {
  text: string;
  done: boolean;
}

/** `[x] ` in front of a done item (UIE §7). `[X]` and `[ ] ` (an open item) are read too. */
const DONE_PREFIX = /^\[[xX]\]\s+/;
const OPEN_PREFIX = /^\[ ?\]\s+/;
export const DELIVERABLE_DONE_MARK = '[x] ';

/** One item per line; blank lines are skipped. Two identical lines are two items (UIE call). */
export function parseDeliverablesCell(cell: string): DeliverableLine[] {
  return cell
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (DONE_PREFIX.test(l)) return { text: l.replace(DONE_PREFIX, '').trim(), done: true };
      if (OPEN_PREFIX.test(l)) return { text: l.replace(OPEN_PREFIX, '').trim(), done: false };
      if (/^\[[xX]\]$/.test(l) || /^\[ ?\]$/.test(l)) return { text: '', done: false };
      return { text: l, done: false };
    });
}

/** Export: the items in order, one per line, `[x] ` on done ones. */
export const formatDeliverablesCell = (items: DeliverableLine[]) =>
  items.map((i) => `${i.done ? DELIVERABLE_DONE_MARK : ''}${i.text}`).join('\n');

export type DeliverableLineKind = 'same' | 'added' | 'ticked' | 'unticked' | 'removed';
export interface DeliverableDiffLine {
  kind: DeliverableLineKind;
  text: string;
  /** The line's done state (for `removed`, the old one). */
  done: boolean;
}
export interface DeliverablesDiff {
  /** File lines in file order, then the removed old items. */
  lines: DeliverableDiffLine[];
  added: number;
  removed: number;
  ticked: number;
  unticked: number;
  /** Same items, other order. */
  reordered: boolean;
}

/**
 * Q-158: the cell replaces the list. Each file line is matched to the first unmatched current item
 * with the same text (so duplicates pair up in order); a matched item keeps its id, author and
 * tick details, and the file's `[x]` sets its tick. `match[i]` is the current item's index for
 * file line `i`, or -1 for a new item.
 */
export function matchDeliverables(
  current: DeliverableLine[],
  next: DeliverableLine[],
): { match: number[]; removed: number[] } {
  const used = new Set<number>();
  const match = next.map((n) => {
    const i = current.findIndex((c, j) => !used.has(j) && c.text === n.text);
    if (i >= 0) used.add(i);
    return i;
  });
  return { match, removed: current.map((_, i) => i).filter((i) => !used.has(i)) };
}

export function diffDeliverables(
  current: DeliverableLine[],
  next: DeliverableLine[],
): DeliverablesDiff {
  const { match, removed } = matchDeliverables(current, next);
  const lines: DeliverableDiffLine[] = next.map((n, i) => {
    const m = match[i]!;
    if (m < 0) return { kind: 'added', text: n.text, done: n.done };
    const was = current[m]!.done;
    return {
      kind: was === n.done ? 'same' : n.done ? 'ticked' : 'unticked',
      text: n.text,
      done: n.done,
    };
  });
  for (const i of removed)
    lines.push({ kind: 'removed', text: current[i]!.text, done: current[i]!.done });
  const matched = match.filter((m) => m >= 0);
  return {
    lines,
    added: lines.filter((l) => l.kind === 'added').length,
    removed: removed.length,
    ticked: lines.filter((l) => l.kind === 'ticked').length,
    unticked: lines.filter((l) => l.kind === 'unticked').length,
    reordered: matched.some((m, i) => i > 0 && m < matched[i - 1]!),
  };
}

export const deliverablesChanged = (d: DeliverablesDiff) =>
  d.added > 0 || d.removed > 0 || d.ticked > 0 || d.unticked > 0 || d.reordered;
/** UIE §4.3: a row that loses items or ticks gets the "Removes or clears" filter and warning. */
export const deliverablesLose = (d: DeliverablesDiff) => d.removed > 0 || d.unticked > 0;

const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
/** UIE §4.3 Result column: "Deliverables (1 item added)" / "(1 ticked)". */
export function deliverablesGainText(d: DeliverablesDiff): string | null {
  const parts: string[] = [];
  if (d.added) parts.push(`${items(d.added)} added`);
  if (d.ticked) parts.push(`${d.ticked} ticked`);
  if (!parts.length && d.reordered) parts.push('order changed');
  return parts.length ? `Deliverables (${parts.join(', ')})` : null;
}
/** UIE §4.3: "Deliverables: 2 items removed, 1 unticked" (danger, bold). */
export function deliverablesLossText(d: DeliverablesDiff): string | null {
  const parts: string[] = [];
  if (d.removed) parts.push(`${items(d.removed)} removed`);
  if (d.unticked) parts.push(`${d.unticked} unticked`);
  return parts.length ? `Deliverables: ${parts.join(', ')}` : null;
}
/** UIE §4.3 / §5.5 import totals: "Deliverables: 4 items added, 3 removed, 1 ticked and 1 unticked." */
export function deliverablesDoneLine(t: {
  added: number;
  removed: number;
  ticked: number;
  unticked: number;
}): string | null {
  const parts: string[] = [];
  if (t.added) parts.push(`${items(t.added)} added`);
  if (t.removed) parts.push(`${t.added ? t.removed : items(t.removed)} removed`);
  if (t.ticked) parts.push(`${t.ticked} ticked`);
  if (t.unticked) parts.push(`${t.unticked} unticked`);
  if (!parts.length) return null;
  const last = parts.pop()!;
  return `Deliverables: ${parts.length ? `${parts.join(', ')} and ${last}` : last}.`;
}

/** UIE §4.4 row errors (NFR-56). `n` is the 1-based line in the cell. */
export const deliverableLineTooLongMessage = (n: number, count: number) =>
  `Deliverables: line ${n} is longer than ${DELIVERABLE_MAX_TEXT} characters (it has ${count}).`;
export const tooManyDeliverablesMessage = (n: number) =>
  `Deliverables: this task would have ${n} items. The most is ${DELIVERABLE_MAX_ITEMS}.`;
export const DELIVERABLE_EMPTY_LINE_MESSAGE = 'Deliverables: a line has [x] but no text.';

/**
 * CR-23 FR-DLV-07 / AC-76.18 (Lean): one item change in the audit log. A task-panel edit writes
 * one entry per item with this `action` (the entry's own action), `changes: [{ field:
 * 'deliverableItems', old, new }]` and `meta: { itemId, text }`. A Checklist import writes ONE
 * entry per task (`task_updated` / `task_created`) whose `meta.deliverableItems` lists every item
 * change in this shape, with the same `old` / `new` values the panel records (and one matching
 * `deliverableItems` row in `changes` each):
 *   added     old null,        new text
 *   updated   old text,        new text   (import: a changed line in the same position)
 *   ticked    old false,       new true
 *   unticked  old true,        new false
 *   deleted   old text,        new null
 *   reordered old [item ids],  new [item ids]
 *   deliverables_migrated  old null, new text  (the old Deliverable text kept as a real item)
 */
export type DeliverableAuditAction =
  | 'deliverable_item_added'
  | 'deliverable_item_updated'
  | 'deliverable_item_ticked'
  | 'deliverable_item_unticked'
  | 'deliverable_item_deleted'
  | 'deliverable_items_reordered'
  | 'deliverables_migrated';
export interface DeliverableAuditChange {
  action: DeliverableAuditAction;
  /** The item's id; null for the list (reorder) and for old text removed before it was an item. */
  itemId: string | null;
  /** The item's text (its new text after an edit); null for a reorder. */
  text: string | null;
  old: unknown;
  new: unknown;
  /** Import edit: the id of the item the changed line replaced. */
  replacedItemId?: string;
  /** The change is to a task's old single Deliverable text (read-only item until now). */
  oldText?: boolean;
}

const AUDIT_ACTIONS = new Set<string>([
  'deliverable_item_added',
  'deliverable_item_updated',
  'deliverable_item_ticked',
  'deliverable_item_unticked',
  'deliverable_item_deleted',
  'deliverable_items_reordered',
  'deliverables_migrated',
]);

/** The item changes an audit entry records (panel or import), or null when it has none. */
export function deliverableAuditChanges(e: {
  action: string;
  changes?: { field?: string | null; old?: unknown; new?: unknown }[] | null;
  meta?: unknown;
}): DeliverableAuditChange[] | null {
  const meta = (e.meta ?? null) as {
    deliverableItems?: unknown;
    itemId?: unknown;
    text?: unknown;
  } | null;
  if (meta && Array.isArray(meta.deliverableItems))
    return meta.deliverableItems.length
      ? (meta.deliverableItems as DeliverableAuditChange[])
      : null;
  if (!AUDIT_ACTIONS.has(e.action)) return null;
  const c = (e.changes ?? []).find((x) => x.field === 'deliverableItems');
  return [
    {
      action: e.action as DeliverableAuditAction,
      itemId: typeof meta?.itemId === 'string' ? meta.itemId : null,
      text: typeof meta?.text === 'string' ? meta.text : null,
      old: c?.old ?? null,
      new: c?.new ?? null,
    },
  ];
}

const q = (t: unknown) => `“${String(t ?? '')}”`;
/**
 * UIE §5.5: what the Activity log / History shows after the actor's name.
 *   panel:  "ticked deliverable “UAT script”", "removed deliverable “Defect log”"
 *   import: "imported the checklist: added “Cutover runbook v2”; removed “Rollback plan”,
 *            “Contact sheet”; unticked “Cutover runbook”"
 */
export function deliverableAuditText(list: DeliverableAuditChange[], imported: boolean): string {
  const by = (a: DeliverableAuditAction) => list.filter((c) => c.action === a);
  const groups: [string, string[]][] = [
    ['added', by('deliverable_item_added').map((c) => q(c.text))],
    ['kept the old text', by('deliverables_migrated').map((c) => q(c.text))],
    ['edited', by('deliverable_item_updated').map((c) => `${q(c.old)} → ${q(c.new)}`)],
    ['removed', by('deliverable_item_deleted').map((c) => q(c.old ?? c.text))],
    ['ticked', by('deliverable_item_ticked').map((c) => q(c.text))],
    ['unticked', by('deliverable_item_unticked').map((c) => q(c.text))],
  ];
  const parts = groups.filter(([, v]) => v.length).map(([verb, v]) => `${verb} ${v.join(', ')}`);
  if (by('deliverable_items_reordered').length) parts.push('reordered the list');
  if (imported) return `imported the checklist: ${parts.join('; ')}`;
  // Panel entries hold one change.
  const c = list[0];
  if (!c) return '';
  switch (c.action) {
    case 'deliverable_item_updated':
      return `edited deliverable ${q(c.old)} → ${q(c.new)}`;
    case 'deliverable_items_reordered':
      return 'reordered deliverables';
    case 'deliverable_item_deleted':
      return `removed deliverable ${q(c.old ?? c.text)}`;
    case 'deliverables_migrated':
      return `kept the old Deliverable text ${q(c.text)} as an item`;
    default: {
      const verb = {
        deliverable_item_added: 'added',
        deliverable_item_ticked: 'ticked',
        deliverable_item_unticked: 'unticked',
      }[c.action];
      return `${verb} deliverable ${q(c.text)}`;
    }
  }
}
