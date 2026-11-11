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
  order: number;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

/** Template activities hold the same kind of list, never ticked (FR-DLV-01). */
export interface TemplateDeliverableItemDto {
  id: string;
  text: string;
}

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
