import { describe, expect, it } from 'vitest';
import {
  fileSizeMb,
  fileTooLargeError,
  importDoneLine,
  nameTooLongMessage,
  numberingLine,
  parseDependsOn,
  parseMilestone,
  parseTaskNumber,
  parseTimelineDate,
  timelineExportFileName,
  tooManyTimelineRowsError,
} from '../src/index.js';

/** CR-22 §B4 cell rules and UIE §5.1 copy for the timeline import. */
describe('CR-22 B3 timeline import cell rules (§B4)', () => {
  it('dates: a real calendar date as YYYY-MM-DD only', () => {
    expect(parseTimelineDate('2026-11-04')).toBe('2026-11-04');
    expect(parseTimelineDate(' 2026-11-04 ')).toBe('2026-11-04');
    expect(parseTimelineDate('2026-11-31')).toBeNull();
    expect(parseTimelineDate('04/11/2026')).toBeNull();
    expect(parseTimelineDate('46000')).toBeNull();
  });

  it('milestone: Y, N, Yes, No in any case; blank = N', () => {
    expect([' y', 'YES', 'n', 'No', ''].map(parseMilestone)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(parseMilestone('maybe')).toBeNull();
  });

  it('depends on: numbers split by , or ; without suffixes', () => {
    expect(parseDependsOn('3, 5;7')).toEqual([3, 5, 7]);
    expect(parseDependsOn('3,3')).toEqual([3]);
    expect(parseDependsOn('')).toEqual([]);
    expect(parseDependsOn('3FS+2d')).toBeNull();
    expect(parseDependsOn('#3')).toBeNull();
  });

  it('task number: a whole number of 1 or more', () => {
    expect(parseTaskNumber('12')).toBe(12);
    expect(parseTaskNumber('0')).toBeNull();
    expect(parseTaskNumber('1.5')).toBeNull();
    expect(parseTaskNumber('')).toBeNull();
  });

  it('file name and UIE lines', () => {
    expect(timelineExportFileName('Acme Test Co Rollout', '2026-11-09')).toBe(
      'acme-test-co-rollout-checklist-2026-11-09.xlsx',
    );
    expect(timelineExportFileName('***', '2026-11-09')).toBe('project-checklist-2026-11-09.xlsx');
    expect(
      numberingLine([
        { file: 30, final: 21 },
        { file: 31, final: 22 },
      ]),
    ).toContain('(file 30 → #21, file 31 → #22)');
    expect(
      importDoneLine({ created: [21, 22], updated: 5, unchanged: 8, leftUnconfirmed: 0 }),
    ).toBe('2 tasks added at the end (#21 and #22) and 5 updated. 8 rows were unchanged.');
    expect(importDoneLine({ created: [], updated: 1, unchanged: 1, leftUnconfirmed: 2 })).toBe(
      'No tasks added and 1 updated. 1 row was unchanged. 2 changed rows were not confirmed and left as they were.',
    );
  });
});

describe('Q24 copy (UIE §5.1, §5.2)', () => {
  it('file size rounds up to one decimal, so just over the limit never reads 5 MB', () => {
    expect(fileSizeMb(5 * 1024 * 1024 + 1)).toBe('5.1');
    expect(fileSizeMb(7 * 1024 * 1024)).toBe('7');
    expect(fileSizeMb(12.34 * 1024 * 1024)).toBe('12.4');
    const e = fileTooLargeError(6 * 1024 * 1024);
    expect(`${e.lead} ${e.rest}`).toBe(
      'This file is 6 MB. The limit is 5 MB. Remove extra sheets or images and try again. Nothing was imported.',
    );
  });
  it('rows and name length', () => {
    const e = tooManyTimelineRowsError(12500, 2000);
    expect(`${e.lead} ${e.rest}`).toBe(
      'This file has 12,500 rows. You can import up to 2,000 at a time. Split it into smaller files and import them one by one. Nothing was imported.',
    );
    expect(nameTooLongMessage(250)).toBe(
      'Task name can be up to 200 characters (this one has 250).',
    );
  });
});
