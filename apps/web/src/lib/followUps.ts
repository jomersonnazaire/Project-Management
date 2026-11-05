/** CR-20 FR-NTF-09..13: "3 follow-ups, 1 new" / "1 follow-up" (the badge's accessible name). */
export function followUpBadgeLabel(total: number, unseen: number): string {
  const count = `${total} follow-up${total === 1 ? '' : 's'}`;
  return unseen > 0 ? `${count}, ${unseen} new` : count;
}

/**
 * Follow-ups thread runs (UI spec v0.9.19 §4, Lean Nov 5, 2026): consecutive messages by one author
 * on one day, with no New divider between them, stay one run while each gap is LESS than this.
 * A gap of exactly this much or more starts a new run (avatar and name again).
 */
export const FOLLOW_UP_RUN_GAP_MS = 5 * 60_000;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Day chip text in the follow-ups thread: "Today", "Yesterday", "Nov 4" (or "Nov 4, 2025"). */
export function followUpDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** The small time under a bubble: "4:52 PM" today, "Nov 4, 3:05 PM" on other days (mockup). */
export function followUpTime(iso: string, now: Date = new Date()): string {
  const time = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = followUpDayLabel(iso, now);
  return day === 'Today' ? time : `${day}, ${time}`;
}

export interface ThreadItem<T> {
  item: T;
  /** Day chip text to show above this item when the day changes. */
  day: string | null;
  /** Show the New divider above this item (the first unseen one). */
  newDivider: boolean;
  /** First of a run: shows the avatar and name. */
  runStart: boolean;
}

/**
 * Lays out follow-ups as a chat thread, oldest first: a day chip where the day changes, the New
 * divider above the first of `newIds`, and runs (same author, same day, no divider between,
 * each gap under FOLLOW_UP_RUN_GAP_MS) that share one avatar and name.
 */
export function threadLayout<T extends { id: string; at: string; author: { id: string } | null }>(
  items: readonly T[],
  newIds: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): ThreadItem<T>[] {
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at));
  let prev: T | undefined;
  let prevDay = '';
  let dividerShown = false;
  return sorted.map((item) => {
    const day = followUpDayLabel(item.at, now);
    const newDay = day !== prevDay;
    const newDivider = !dividerShown && newIds.has(item.id);
    if (newDivider) dividerShown = true;
    const sameAuthor =
      prev !== undefined && (prev.author?.id ?? null) === (item.author?.id ?? null);
    const close =
      prev !== undefined &&
      new Date(item.at).getTime() - new Date(prev.at).getTime() < FOLLOW_UP_RUN_GAP_MS;
    const runStart = newDay || newDivider || !sameAuthor || !close;
    prev = item;
    prevDay = day;
    return { item, day: newDay ? day : null, newDivider, runStart };
  });
}
