/** CR-20 FR-NTF-09..13: "3 follow-ups, 1 new" / "1 follow-up" (the badge's accessible name). */
export function followUpBadgeLabel(total: number, unseen: number): string {
  const count = `${total} follow-up${total === 1 ? '' : 's'}`;
  return unseen > 0 ? `${count}, ${unseen} new` : count;
}

/** Consecutive follow-ups by one author within this many minutes share one avatar and name. */
export const FOLLOW_UP_GROUP_MINUTES = 5;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Day separator text in the follow-ups thread: "Today", "Yesterday", "Nov 4" (or "Nov 4, 2025"). */
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

/** "4:52 PM": the small time under a follow-up bubble. */
export function followUpTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "MM" from "Maria Member", "A" from "Ana"; "?" when there is no name. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

const AVATAR_TONES = ['primary', 'success', 'info', 'warning', 'danger', 'secondary'] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/** A stable label tone per user id, so one person always gets the same avatar colour. */
export function avatarTone(id: string | null | undefined): AvatarTone {
  let h = 0;
  for (const ch of id ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

export interface ThreadItem<T> {
  item: T;
  /** Text of the day separator to show above this item, if it starts a new day. */
  day: string | null;
  /** First of a run by one author: shows the avatar and name. */
  groupStart: boolean;
}

/**
 * Lays out follow-ups as a chat thread, oldest first: a day separator when the day changes, and
 * runs by one author within FOLLOW_UP_GROUP_MINUTES (on the same day) share one header.
 */
export function threadLayout<T extends { at: string; author: { id: string } | null }>(
  items: readonly T[],
  now: Date = new Date(),
): ThreadItem<T>[] {
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at));
  let prev: T | undefined;
  let prevDay = '';
  return sorted.map((item) => {
    const day = followUpDayLabel(item.at, now);
    const newDay = day !== prevDay;
    const sameAuthor =
      prev !== undefined && (prev.author?.id ?? null) === (item.author?.id ?? null);
    const close =
      prev !== undefined &&
      new Date(item.at).getTime() - new Date(prev.at).getTime() <= FOLLOW_UP_GROUP_MINUTES * 60_000;
    const out = { item, day: newDay ? day : null, groupStart: newDay || !sameAuthor || !close };
    prev = item;
    prevDay = day;
    return out;
  });
}
