import { describe, expect, it } from 'vitest';
import {
  DAR_MAX_PDF_BYTES,
  DAR_PASSWORD_ONLY,
  DAR_TOO_LARGE,
  darEmailRange,
  darSendError,
  darSendFailureMessage,
  darSentBanner,
  DAR_SEND_UNCONFIRMED,
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

describe('DAR Send result text (web banners)', () => {
  it('every failure starts with "Your report wasn\'t sent." and never shows the raw code', () => {
    const lines: Record<string, string> = {
      ms_auth_failed: 'Microsoft sign-in failed, so nothing was sent. Try again.',
      send_forbidden:
        "Your Microsoft account isn't allowed to send email from OpsTrack. Ask your Admin to allow it.",
      bad_recipient: "Your supervisor's email address isn't valid. Ask your Admin to check it.",
      graph_unavailable: "Microsoft isn't responding right now. Try again in a few minutes.",
      not_found: "We couldn't find this saved report. Refresh the page and try again.",
      not_enabled: "Sending reports isn't turned on. Export the report and send it yourself.",
    };
    for (const [code, line] of Object.entries(lines)) {
      expect(darSendFailureMessage(code)).toBe(`Your report wasn't sent. ${line}`);
    }
    for (const code of ['send_failed', 'weird_code', 'toString', '__proto__', '', null]) {
      const msg = darSendFailureMessage(code);
      expect(msg).toBe(
        "Your report wasn't sent. Something went wrong. Try again, or export the report and send it yourself.",
      );
      if (code) expect(msg).not.toContain(code);
    }
    expect(darSendError('result_unavailable')).toBe(DAR_SEND_UNCONFIRMED);
  });

  it('success banner: range, name (email), CC names', () => {
    const recipient = { name: 'Supervisor Sam', email: 'sup@xceler8.example' };
    expect(
      darSentBanner({
        from: '2026-10-13',
        to: '2026-10-13',
        recipient,
        cc: [
          { name: 'Cee One', email: 'cc1@xceler8.example' },
          { name: 'Cee Two', email: 'cc2@xceler8.example' },
        ],
      }),
    ).toBe(
      'Report for Oct 13, 2026 sent to Supervisor Sam (sup@xceler8.example). CC: Cee One, Cee Two.',
    );
    expect(darSentBanner({ from: '2026-10-13', to: '2026-10-17', recipient, cc: [] })).toBe(
      'Report for Oct 13 to Oct 17, 2026 sent to Supervisor Sam (sup@xceler8.example).',
    );
  });
});
