import { describe, expect, it } from 'vitest';
import { toCsv } from '../lib/reportCsv';

// DEF-054 / FR-CLI-37: formula-like text is escaped in every CSV export.
describe('CSV formula escaping', () => {
  const cols = [
    { label: 'Client', value: (r: { name: string; n: number }) => r.name },
    { label: 'Hours', value: (r: { name: string; n: number }) => r.n },
  ];

  it('prefixes formula-like text with an apostrophe', () => {
    const csv = toCsv(cols, [
      { name: '=HYPERLINK("http://x","y")', n: 1 },
      { name: '+cmd|calc', n: 2 },
      { name: '-cmd', n: 3 },
      { name: '@SUM(A1)', n: 4 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"",""y"")",1`);
    expect(lines[2]).toBe(`'+cmd|calc,2`);
    expect(lines[3]).toBe(`'-cmd,3`);
    expect(lines[4]).toBe(`'@SUM(A1),4`);
  });

  it('leaves real numbers and plain text alone', () => {
    const csv = toCsv(cols, [{ name: 'Acme Corp', n: -5 }]);
    expect(csv.split('\r\n')[1]).toBe('Acme Corp,-5');
  });
});

describe('CSV formula escaping keeps signed values', () => {
  it('does not escape variances like +04:00, -2.5 or +50%', () => {
    const cols = [{ label: 'V', value: (r: { v: string }) => r.v }];
    const lines = toCsv(cols, [{ v: '+04:00' }, { v: '-2.5' }, { v: '+50%' }]).split('\r\n');
    expect(lines.slice(1)).toEqual(['+04:00', '-2.5', '+50%']);
  });
});
