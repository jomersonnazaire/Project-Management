import { hoursHHMM } from '@xc8/shared';

/**
 * Calendar dates (YYYY-MM-DD) are formatted in UTC so they never shift by the viewer's timezone
 * (07 §2). Example: "2026-10-12" → "Oct 12".
 */
export function shortDate(value: string | null | undefined, withYear = false): string {
  if (!value) return '–';
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

/** "5 min ago", "1 hour ago", "Yesterday, 4:10 PM", "Oct 7" (mockup notifications). */
export function relativeTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24 && d.getDate() === now.getDate())
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Friday, Oct 9" for a YYYY-MM-DD calendar date. */
export function longDay(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Thu, Oct 8" in local time (conversation day separators). */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Decimal hours as HH:MM (DR-25, doc 14 §12.2): 6 → "06:00", 0.0333 → "00:02". */
export function hoursLabel(h: number): string {
  return hoursHHMM(h);
}

/** "Oct 9, 9:05 AM" in Philippine time (doc 14 A-17), whatever the browser's timezone. */
export function phDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

/** "Fri, Oct 9" for a YYYY-MM-DD calendar date (DR-38). */
export function longDayShort(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
