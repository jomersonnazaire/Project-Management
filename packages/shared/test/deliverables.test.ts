import { describe, expect, it } from 'vitest';
import {
  addDeliverableItemSchema,
  deliverableProgress,
  deliverableTextProblem,
  deliverablesDoneLine,
  deliverablesGainText,
  deliverablesLose,
  deliverablesLossText,
  diffDeliverables,
  formatDeliverablesCell,
  parseDeliverablesCell,
} from '../src/index.js';

/** CR-23 FR-DLV / FR-CLX-04: the Deliverables cell format and the import diff. */
describe('Deliverables cell (one item per line, [x] = done)', () => {
  it('parses lines, trims, drops blank lines and reads [x] / [X] / [ ] prefixes', () => {
    expect(
      parseDeliverablesCell('[x] Form\r\n\n  Report  \n[X]  Sign-off\n[ ] Open\n[] Also open'),
    ).toEqual([
      { text: 'Form', done: true },
      { text: 'Report', done: false },
      { text: 'Sign-off', done: true },
      { text: 'Open', done: false },
      { text: 'Also open', done: false },
    ]);
    expect(parseDeliverablesCell('')).toEqual([]);
    // "[x]" with no text is an empty line (a row error in the import).
    expect(parseDeliverablesCell('[x]')).toEqual([{ text: '', done: false }]);
    // "[x]" not followed by a space is part of the text.
    expect(parseDeliverablesCell('[x]Form')).toEqual([{ text: '[x]Form', done: false }]);
  });

  it('round-trips: export writes [x] only on done items', () => {
    const items = [
      { text: 'A', done: true },
      { text: 'B', done: false },
    ];
    expect(formatDeliverablesCell(items)).toBe('[x] A\nB');
    expect(parseDeliverablesCell(formatDeliverablesCell(items))).toEqual(items);
  });
});

describe('diffDeliverables (the preview lines and counts)', () => {
  const cur = [
    { text: 'A', done: false },
    { text: 'B', done: false },
    { text: 'C', done: true },
  ];

  it('marks same, added, ticked, unticked and removed; removed lines come last', () => {
    const d = diffDeliverables(cur, parseDeliverablesCell('[x] A\nC\nD'));
    expect(d.lines.map((l) => [l.kind, l.text])).toEqual([
      ['ticked', 'A'],
      ['unticked', 'C'],
      ['added', 'D'],
      ['removed', 'B'],
    ]);
    expect(d).toMatchObject({ added: 1, removed: 1, ticked: 1, unticked: 1, reordered: false });
    expect(deliverablesLose(d)).toBe(true);
    expect(deliverablesGainText(d)).toBe('Deliverables (1 item added, 1 ticked)');
    expect(deliverablesLossText(d)).toBe('Deliverables: 1 item removed, 1 unticked');
  });

  it('a blank cell removes everything; the same list is no change; duplicates stay separate', () => {
    expect(diffDeliverables(cur, [])).toMatchObject({ removed: 3, added: 0 });
    const same = diffDeliverables(cur, parseDeliverablesCell('A\nB\n[x] C'));
    expect(same.lines.every((l) => l.kind === 'same')).toBe(true);
    expect(deliverablesLose(same)).toBe(false);
    const dup = diffDeliverables([{ text: 'A', done: false }], parseDeliverablesCell('A\nA'));
    expect(dup.lines.map((l) => l.kind)).toEqual(['same', 'added']);
  });

  it('a new order alone reads "order changed"', () => {
    const d = diffDeliverables(cur, parseDeliverablesCell('B\nA\n[x] C'));
    expect(d.reordered).toBe(true);
    expect(deliverablesGainText(d)).toBe('Deliverables (order changed)');
  });

  it('the Done line (UIE §4.5)', () => {
    expect(deliverablesDoneLine({ added: 4, removed: 3, ticked: 1, unticked: 1 })).toBe(
      'Deliverables: 4 items added, 3 removed, 1 ticked and 1 unticked.',
    );
    expect(deliverablesDoneLine({ added: 0, removed: 1, ticked: 0, unticked: 0 })).toBe(
      'Deliverables: 1 item removed.',
    );
    expect(deliverablesDoneLine({ added: 0, removed: 0, ticked: 0, unticked: 0 })).toBeNull();
  });
});

describe('limits and copy', () => {
  it('200 characters for new text; kept migrated text is allowed', () => {
    expect(deliverableTextProblem('x'.repeat(200))).toBeNull();
    expect(deliverableTextProblem('x'.repeat(227))).toBe(
      'A deliverable can be up to 200 characters (this one has 227).',
    );
    const old = 'o'.repeat(300);
    expect(deliverableTextProblem(old, new Set([old]))).toBeNull();
    expect(deliverableTextProblem('   ')).toBe('Enter the deliverable.');
  });

  it('progress reads "2 of 5 done"; the add body needs a version', () => {
    expect(
      deliverableProgress([
        { done: true },
        { done: true },
        { done: false },
        { done: false },
        { done: false },
      ]),
    ).toBe('2 of 5 done');
    expect(addDeliverableItemSchema.safeParse({ text: 'A' }).success).toBe(false);
    expect(addDeliverableItemSchema.safeParse({ text: 'A', version: 0 }).success).toBe(true);
  });
});
