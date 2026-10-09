import { describe, expect, it } from 'vitest';
import {
  darRangeSchema,
  formatLongDate,
  rangeDays,
  rangeLabel,
  reportCcSchema,
} from '../src/index.js';

describe('DAR helpers (doc 14 §3)', () => {
  it('limits the range to 31 days, From on or before To', () => {
    expect(rangeDays('2026-10-01', '2026-10-31')).toBe(31);
    expect(darRangeSchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    const long = darRangeSchema.safeParse({ from: '2026-10-01', to: '2026-11-01' });
    expect(long.error?.issues[0]?.message).toBe(
      'The range can be up to 31 days. Pick a shorter range.',
    );
    const back = darRangeSchema.safeParse({ from: '2026-10-02', to: '2026-10-01' });
    expect(back.error?.issues[0]?.message).toBe('"From" must be on or before "To".');
  });
  it('formats dates like the sample', () => {
    expect(formatLongDate('2026-09-30')).toBe('Sep 30, 2026');
    expect(rangeLabel('2026-09-30', '2026-10-02')).toBe('Sep 30 – Oct 2');
    expect(rangeLabel('2026-09-29', '2026-09-29')).toBe('Sep 29');
  });
  it('allows up to 5 distinct CC emails', () => {
    expect(reportCcSchema.safeParse(['a@x.example', 'A@x.example']).success).toBe(false);
    expect(reportCcSchema.safeParse(['a@x.example', 'b@x.example']).success).toBe(true);
    expect(
      reportCcSchema.safeParse(Array.from({ length: 6 }, (_, i) => `u${i}@x.example`)).success,
    ).toBe(false);
  });
});
