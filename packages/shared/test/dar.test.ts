import { describe, expect, it } from 'vitest';
import {
  DAR_MAX_PDF_BYTES,
  DAR_PASSWORD_ONLY,
  DAR_TOO_LARGE,
  darEmailRange,
  darSendError,
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
  it('formats the DAR email range: one date, same-year range, cross-year range', () => {
    expect(darEmailRange('2026-10-13', '2026-10-13')).toBe('Oct 13, 2026');
    expect(darEmailRange('2026-10-13', '2026-10-17')).toBe('Oct 13 to Oct 17, 2026');
    expect(darEmailRange('2026-09-30', '2026-10-02')).toBe('Sep 30 to Oct 2, 2026');
    expect(darEmailRange('2026-12-29', '2027-01-02')).toBe('Dec 29, 2026 to Jan 2, 2027');
  });
  it('allows up to 5 distinct CC emails', () => {
    expect(reportCcSchema.safeParse(['a@x.example', 'A@x.example']).success).toBe(false);
    expect(reportCcSchema.safeParse(['a@x.example', 'b@x.example']).success).toBe(true);
    expect(
      reportCcSchema.safeParse(Array.from({ length: 6 }, (_, i) => `u${i}@x.example`)).success,
    ).toBe(false);
  });
  it('Send copy matches §11, and the PDF limit is 2.5 MB raw', () => {
    expect(DAR_MAX_PDF_BYTES).toBe(2_621_440);
    expect(DAR_TOO_LARGE).toBe(
      "This report's PDF is over 2.5 MB, so it can't be emailed. Choose a shorter date range, or export it and send it yourself.",
    );
    expect(darSendError('too_large')).toBe(DAR_TOO_LARGE);
    expect(DAR_PASSWORD_ONLY).toBe(
      "You sign in with a password, so this app can't email your report. Export it instead, and use Notify supervisor to tell your supervisor it's ready.",
    );
    expect(darSendError('not_linked')).toBe(DAR_PASSWORD_ONLY);
  });
});
