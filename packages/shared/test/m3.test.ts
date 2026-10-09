import { describe, expect, it } from 'vitest';
import {
  CalendarLimitError,
  DEFAULT_ACCESS_RULES,
  MAX_CALENDAR_SCAN_DAYS,
  MAX_UPLOAD_BYTES,
  RECORD_TYPE_KEYS,
  addWorkingDays,
  checkFileRules,
  effectivePermissions,
  isWorkingDay,
  linkify,
  parseDateOnly,
  phDateOf,
  scheduleFromOffsets,
  timeLockBoundary,
  toDateOnly,
  todayPH,
  validatePermissionGrid,
  workingDaysSchema,
  type WorkCalendar,
} from '../src/index.js';

const d = parseDateOnly;
const iso = (x: Date) => toDateOnly(x);

describe('Philippine time boundaries (FR-TSK-21, AC-TODAY-1)', () => {
  it('00:30 in Manila (16:30 UTC the day before) is already the Manila date', () => {
    expect(iso(todayPH(new Date('2026-10-08T16:30:00Z')))).toBe('2026-10-09');
    expect(phDateOf(new Date('2026-10-08T16:30:00Z'))).toBe('2026-10-09');
  });
  it('23:59 in Manila is still that date; midnight Manila flips it', () => {
    expect(iso(todayPH(new Date('2026-10-09T15:59:59Z')))).toBe('2026-10-09');
    expect(iso(todayPH(new Date('2026-10-09T16:00:00Z')))).toBe('2026-10-10');
  });
  it('never uses server UTC: 07:59 Manila on the 1st of a month is the 1st, not the 31st', () => {
    expect(iso(todayPH(new Date('2026-12-31T23:59:00Z')))).toBe('2027-01-01');
  });
});

describe('Working days and holidays (FR-CAL-01..05)', () => {
  const MON_FRI: WorkCalendar = { workingDays: [1, 2, 3, 4, 5], holidays: {} };

  it('AC-CAL-1: a Special working day on Saturday counts; 1 working day from Friday lands on it', () => {
    const cal: WorkCalendar = { ...MON_FRI, holidays: { '2026-12-12': 'SPECIAL_WORKING' } };
    expect(iso(addWorkingDays(d('2026-12-11'), 1, cal))).toBe('2026-12-12');
    expect(isWorkingDay(d('2026-12-12'), cal)).toBe(true);
    expect(iso(addWorkingDays(d('2026-12-11'), 1, MON_FRI))).toBe('2026-12-14');
  });

  it('AC-CAL-3: with Saturday ticked, 1 working day from Friday lands on Saturday', () => {
    const cal: WorkCalendar = { workingDays: [1, 2, 3, 4, 5, 6], holidays: {} };
    expect(iso(addWorkingDays(d('2026-10-09'), 1, cal))).toBe('2026-10-10');
  });

  it('Regular holidays and Special non-working days are skipped', () => {
    const cal: WorkCalendar = {
      ...MON_FRI,
      holidays: { '2026-11-30': 'REGULAR', '2026-12-01': 'SPECIAL_NON_WORKING' },
    };
    // Fri Nov 27 + 1 → skip weekend, Mon 30 (regular), Tue Dec 1 (special) → Wed Dec 2.
    expect(iso(addWorkingDays(d('2026-11-27'), 1, cal))).toBe('2026-12-02');
    // A start on a holiday rolls to the next working day.
    expect(iso(addWorkingDays(d('2026-11-30'), 0, cal))).toBe('2026-12-02');
  });

  it('TC-N20: ten holidays in a row after a weekend still compute (bounded, no timeout)', () => {
    const holidays: Record<string, 'REGULAR'> = {};
    for (let i = 0; i < 10; i++)
      holidays[toDateOnly(new Date(Date.UTC(2026, 11, 14 + i)))] = 'REGULAR';
    const cal: WorkCalendar = { ...MON_FRI, holidays };
    // Fri Dec 11 + 1 → Sat/Sun skipped, Dec 14–23 holidays → Thu Dec 24.
    expect(iso(addWorkingDays(d('2026-12-11'), 1, cal))).toBe('2026-12-24');
    const s = scheduleFromOffsets(d('2026-12-11'), 1, 3, cal);
    expect([iso(s.plannedStart), iso(s.dueDate)]).toEqual(['2026-12-24', '2026-12-28']);
  });

  it('TC-N20: only Sunday ticked still works', () => {
    const cal: WorkCalendar = { workingDays: [0], holidays: {} };
    // A Friday start rolls to Sunday (the next working day); one more working day is a week later.
    expect(iso(addWorkingDays(d('2026-10-09'), 0, cal))).toBe('2026-10-11');
    expect(iso(addWorkingDays(d('2026-10-09'), 1, cal))).toBe('2026-10-18');
  });

  it('FR-CAL-05: the calculation is bounded, so a calendar with no working days throws instead of looping', () => {
    const cal: WorkCalendar = { workingDays: [], holidays: {} };
    expect(() => addWorkingDays(d('2026-10-09'), 1, cal)).toThrow(CalendarLimitError);
    // A huge offset is bounded too.
    expect(() => addWorkingDays(d('2026-10-09'), MAX_CALENDAR_SCAN_DAYS, MON_FRI)).toThrow(
      CalendarLimitError,
    );
  });

  it('the default (no calendar) stays Mon–Fri, as in M2', () => {
    expect(iso(addWorkingDays(d('2026-10-09'), 1))).toBe('2026-10-12');
  });

  it('workingDaysSchema refuses repeated days (the empty list is refused by the API with 422)', () => {
    expect(workingDaysSchema.safeParse({ days: [1, 1], version: 0 }).success).toBe(false);
    expect(workingDaysSchema.safeParse({ days: [6], version: 0 }).success).toBe(true);
  });
});

describe('Time lock boundary (FR-TIME-04, Q-09)', () => {
  it('last week stays open until Monday 12:00 Manila time', () => {
    // Mon Oct 12, 11:59 Manila → last week (from Oct 5) still open.
    expect(iso(timeLockBoundary(new Date('2026-10-12T03:59:00Z')))).toBe('2026-10-05');
    // Mon Oct 12, 12:00 Manila → only this week open.
    expect(iso(timeLockBoundary(new Date('2026-10-12T04:00:00Z')))).toBe('2026-10-12');
    expect(iso(timeLockBoundary(new Date('2026-10-14T00:00:00Z')))).toBe('2026-10-12');
  });
});

describe('Upload name and size rules (FR-EVD-01..03, FR-DOC-13)', () => {
  it('evidence: PDF, Word and Excel only; images refused with the mockup message', () => {
    for (const n of ['a.pdf', 'a.doc', 'a.docx', 'a.xls', 'a.XLSX'])
      expect(checkFileRules({ name: n, size: 10 }, 'EVIDENCE')).toBeNull();
    expect(checkFileRules({ name: 'screenshot.png', size: 10 }, 'EVIDENCE')?.message).toBe(
      "screenshot.png can't be added. Evidence must be a PDF, Word or Excel file.",
    );
  });
  it('Q-30: images are allowed in Documents', () => {
    expect(checkFileRules({ name: 'site.jpg', size: 10 }, 'DOCUMENT')).toBeNull();
    expect(checkFileRules({ name: 'run.exe', size: 10 }, 'DOCUMENT')?.code).toBe(
      'INVALID_FILE_TYPE',
    );
  });
  it('macro-enabled files are refused with a fix-it message', () => {
    expect(checkFileRules({ name: 'Macros.xlsm', size: 10 }, 'EVIDENCE')?.message).toBe(
      "Macros.xlsm can't be added. Save it as .xlsx without macros.",
    );
    expect(checkFileRules({ name: 'm.docm', size: 10 }, 'DOCUMENT')?.code).toBe(
      'INVALID_FILE_TYPE',
    );
  });
  it('AC-39.3: exactly 25 MiB is fine, one byte more is 413; 0 bytes is refused', () => {
    expect(checkFileRules({ name: 'a.pdf', size: MAX_UPLOAD_BYTES }, 'EVIDENCE')).toBeNull();
    const big = checkFileRules({ name: 'Big_Export.xlsx', size: MAX_UPLOAD_BYTES + 1 }, 'EVIDENCE');
    expect(big).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
    expect(
      checkFileRules({ name: 'Big_Export.xlsx', size: 31 * 1_048_576 }, 'EVIDENCE')?.message,
    ).toBe('Big_Export.xlsx is 31 MB, larger than the 25 MB limit.');
    // DEF-004: one byte over must not read "25 MB. The limit is 25 MB."
    expect(big?.message).toBe('Big_Export.xlsx is larger than 25 MB, the limit per file.');
    expect(checkFileRules({ name: 'b.pdf', size: 25.6 * 1_048_576 }, 'DOCUMENT')?.message).toBe(
      'b.pdf is 26 MB, larger than the 25 MB limit.',
    );
    expect(checkFileRules({ name: 'a.pdf', size: 0 }, 'EVIDENCE')?.code).toBe('EMPTY_FILE');
  });
});

describe('Access rules for M3 record types (doc 12 §3.4, TC-N21)', () => {
  it('conversations: Admin/PM/Member View+Create, Viewer View; no Edit or Delete for anyone', () => {
    expect(DEFAULT_ACCESS_RULES.ADMIN.conversations).toMatchObject({
      view: true,
      create: true,
      edit: false,
      delete: false,
    });
    expect(DEFAULT_ACCESS_RULES.MEMBER.conversations).toMatchObject({ view: true, create: true });
    expect(DEFAULT_ACCESS_RULES.VIEWER.conversations).toMatchObject({ view: true, create: false });
  });
  it('notifications are always on (own only) and can’t be switched off', () => {
    expect(RECORD_TYPE_KEYS).toEqual(
      expect.arrayContaining(['documents', 'conversations', 'notifications']),
    );
    const stored = { notifications: { view: false } };
    expect(effectivePermissions('VIEWER', stored).notifications.view).toBe(true);
    const grid = effectivePermissions('MEMBER');
    grid.notifications.view = false;
    expect(validatePermissionGrid('MEMBER', grid).map((i) => i.code)).toContain(
      'LOCKED_PERMISSION',
    );
  });
  it('Admin stays locked on Users and Access rules', () => {
    const grid = effectivePermissions('ADMIN', { users: { view: false } });
    expect(grid.users.view).toBe(true);
  });
});

describe('linkify (FR-CNV-07)', () => {
  it('finds links and keeps everything else as plain text', () => {
    expect(linkify('see https://x.example/a, then <script>')).toEqual([
      { text: 'see ' },
      { text: 'https://x.example/a', href: 'https://x.example/a' },
      { text: ', then <script>' },
    ]);
  });
});
