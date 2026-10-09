import { describe, expect, it } from 'vitest';
import { FULL_DAY_AM_PM, mergeHalfDays, type LeaveDto } from '../src/index';

const leave = (
  id: string,
  dayPart: LeaveDto['dayPart'],
  over: Partial<LeaveDto> = {},
): LeaveDto => ({
  id,
  user: { id: 'u1', name: 'Maria' },
  type: { id: 'vac', name: 'Vacation', paid: true },
  dayPart,
  from: '2026-10-13',
  to: '2026-10-13',
  days: dayPart === 'FULL' ? 1 : 0.5,
  byYear: [{ year: 2026, days: dayPart === 'FULL' ? 1 : 0.5 }],
  reason: null,
  status: 'RECORDED',
  recordedAt: '2026-10-09T02:00:00Z',
  cancelledAt: null,
  cancelledBy: null,
  can: { cancel: true },
  ...over,
});

describe('DR-33: AM + PM of the same type and date show as one full day', () => {
  it('merges the two halves and keeps each for cancelling', () => {
    const rows = mergeHalfDays([
      leave('a', 'AM'),
      leave('b', 'PM'),
      leave('c', 'FULL', { from: '2026-10-20', to: '2026-10-20' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ dayPart: 'FULL', days: 1, byYear: [{ year: 2026, days: 1 }] });
    expect(rows[0]!.halves?.map((h) => h.id)).toEqual(['a', 'b']);
    expect(FULL_DAY_AM_PM).toBe('Full day (AM + PM)');
  });

  it('keeps halves apart for different types, dates, people or a cancelled half', () => {
    expect(
      mergeHalfDays([
        leave('a', 'AM'),
        leave('b', 'PM', { type: { id: 'sick', name: 'Sick', paid: true } }),
      ]),
    ).toHaveLength(2);
    expect(
      mergeHalfDays([leave('a', 'AM'), leave('b', 'PM', { from: '2026-10-14', to: '2026-10-14' })]),
    ).toHaveLength(2);
    expect(
      mergeHalfDays([leave('a', 'AM'), leave('b', 'PM', { user: { id: 'u2', name: 'Ana' } })]),
    ).toHaveLength(2);
    expect(
      mergeHalfDays([leave('a', 'AM'), leave('b', 'PM', { status: 'CANCELLED' })]),
    ).toHaveLength(2);
  });
});
