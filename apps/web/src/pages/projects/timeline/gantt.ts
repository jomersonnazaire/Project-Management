import {
  addDays,
  daysBetween,
  isWorkingDay,
  parseDateOnly,
  toDateOnly,
  type TimelineDto,
} from '@xc8/shared';

/** UIE §2.2 zoom levels: pixels per calendar day. */
export const ZOOMS = { days: 28, weeks: 10, months: 4 } as const;
export type Zoom = keyof typeof ZOOMS;
export const ROW_H = 34;

export function dayIndex(rangeStart: string, date: string): number {
  return daysBetween(parseDateOnly(rangeStart), parseDateOnly(date));
}

export function daysInRange(range: { start: string; end: string }): string[] {
  const out: string[] = [];
  const end = parseDateOnly(range.end);
  for (let d = parseDateOnly(range.start); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    out.push(toDateOnly(d));
  }
  return out;
}

/** Weekends and holidays from the app calendar (Q-131, Q-148), for the grey / hatched columns. */
export function nonWorkingDays(days: string[], cal: TimelineDto['calendar']) {
  return days
    .map((date, i) => ({ date, i }))
    .filter(({ date }) => !isWorkingDay(parseDateOnly(date), cal))
    .map(({ date, i }) => ({
      i,
      date,
      holiday:
        cal.holidays[date] && cal.holidays[date] !== 'SPECIAL_WORKING'
          ? (cal.holidayNames[date] ?? 'Holiday')
          : null,
    }));
}

const MONTH = (d: string, year: boolean) =>
  parseDateOnly(d).toLocaleDateString('en-US', {
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

/** Header line 1: months as spans of day indexes. */
export function monthSpans(days: string[]) {
  const out: { key: string; label: string; from: number; to: number }[] = [];
  days.forEach((d, i) => {
    const key = d.slice(0, 7);
    const last = out.at(-1);
    if (last?.key === key) last.to = i;
    else out.push({ key, label: MONTH(d, true), from: i, to: i });
  });
  return out;
}

/** Header line 2: Monday ticks (Weeks), each day (Days), or month starts (Months). */
export function ticks(days: string[], zoom: Zoom) {
  if (zoom === 'days') return days.map((d, i) => ({ i, label: String(Number(d.slice(8))) }));
  if (zoom === 'months')
    return days
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.endsWith('-01'))
      .map(({ d, i }) => ({ i, label: MONTH(d, false) }));
  return days
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => parseDateOnly(d).getUTCDay() === 1)
    .map(({ d, i }) => ({
      i,
      label: parseDateOnly(d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    }));
}

/** Elbow connector from a predecessor's finish to its successor's start (UIE §2.5). */
export function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const out = x1 + 6;
  if (x2 - 6 >= out) return `M${x1},${y1} H${x2 - 6} V${y2} H${x2}`;
  const mid = y1 + (y2 > y1 ? ROW_H / 2 : -ROW_H / 2);
  return `M${x1},${y1} H${out} V${mid} H${x2 - 8} V${y2} H${x2}`;
}
