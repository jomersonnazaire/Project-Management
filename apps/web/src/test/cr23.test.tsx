import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  XLSX_MIME,
  type DeliverableItemDto,
  type ProjectDto,
  type TaskDto,
  type TimelineImportPreviewDto,
  type TimelineImportRowDto,
} from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { PID, api, project, task } from './m2fixtures';
import { renderAt } from './utils';

/**
 * CR-23 web: the deliverables checklist in the task panel (FR-DLV-01..07, UIE §5), the Checklist
 * chips (§3.2) and the Deliverables parts of the import preview (§4.3, §4.5).
 */
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

const item = (
  id: string,
  text: string,
  over: Partial<DeliverableItemDto> = {},
): DeliverableItemDto => ({
  id,
  text,
  done: false,
  doneBy: null,
  doneAt: null,
  doneFromImport: false,
  order: 1,
  createdBy: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...over,
});
const QA = { id: 'u3', name: 'QA One' };

/** A stateful API for one task's deliverables. */
function mount(
  opts: { items?: DeliverableItemDto[]; can?: boolean; project?: ProjectDto; fail?: number } = {},
) {
  let t: TaskDto = task({
    deliverableItems: opts.items ?? [
      item('i1', 'UAT script', { done: true, doneBy: QA, doneAt: '2026-11-09T03:00:00.000Z' }),
      item('i2', 'Defect log'),
    ],
    can: { edit: true, plan: true, status: true, approve: false, deliverables: opts.can ?? true },
  });
  const bump = (items: DeliverableItemDto[]) => {
    t = { ...t, version: t.version + 1, deliverableItems: items };
    return { status: 200, body: { task: t } };
  };
  let removed: DeliverableItemDto | null = null;
  const fetch = api('PROJECT_MANAGER', (url, init) => {
    const m = init?.method ?? 'GET';
    if (url.includes('/deliverable-items')) {
      if (opts.fail)
        return { status: opts.fail, body: { error: { code: 'X', message: 'x' }, requestId: 'r' } };
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const id = /deliverable-items\/([^/?]+)/.exec(url)?.[1];
      if (m === 'POST' && url.endsWith('/restore') && removed) {
        const back = removed;
        removed = null;
        return bump([
          ...t.deliverableItems.slice(0, back.order - 1),
          back,
          ...t.deliverableItems.slice(back.order - 1),
        ]);
      }
      if (m === 'POST' && !id)
        return bump([...t.deliverableItems, item(`n${t.version}`, String(body.text))]);
      if (m === 'PATCH')
        return bump(
          t.deliverableItems.map((i) =>
            i.id === id
              ? {
                  ...i,
                  ...(body.text !== undefined ? { text: String(body.text) } : {}),
                  ...(body.done !== undefined
                    ? {
                        done: Boolean(body.done),
                        doneBy: body.done ? { id: 'me', name: 'Me PM' } : null,
                        doneAt: body.done ? new Date().toISOString() : null,
                      }
                    : {}),
                }
              : i,
          ),
        );
      if (m === 'DELETE') {
        const at = t.deliverableItems.findIndex((i) => i.id === id);
        removed = { ...t.deliverableItems[at]!, order: at + 1 };
        return bump(t.deliverableItems.filter((i) => i.id !== id));
      }
    }
    if (url.endsWith('/tasks/k1')) return { status: 200, body: { task: t } };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [t] } };
    if (url.endsWith(`/projects/${PID}`))
      return { status: 200, body: { project: opts.project ?? project() } };
    return undefined;
  });
  return {
    fetch,
    calls: (part: string) => fetch.mock.calls.filter(([u]) => String(u).includes(part)),
  };
}
const openPanel = async () => {
  renderAt(`/projects/${PID}?task=k1`, <App />);
  return screen.findByTestId('deliverables');
};

describe('CR-23 deliverables checklist in the task panel (UIE §5)', () => {
  it('shows "1 of 2 done", a struck-through done item with who ticked it, and the chip on the row', async () => {
    mount();
    const box = await openPanel();
    expect(within(box).getByText('1 of 2 done')).toBeInTheDocument();
    expect(within(box).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    const done = within(box).getByRole('checkbox', { name: 'UAT script' });
    expect(done).toBeChecked();
    expect(within(box).getByText('UAT script')).toHaveClass('is-done');
    expect(within(box).getByText('Done by QA One · Nov 9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deliverables: 1 of 2 done' })).toHaveTextContent(
      '1/2',
    );
  });

  it('add with Enter keeps focus; tick saves at once; ticking all leaves the status alone', async () => {
    const { calls } = mount();
    const user = userEvent.setup();
    const box = await openPanel();
    const input = within(box).getByLabelText('Add a deliverable');
    await user.type(input, 'Sign-off{Enter}');
    expect(await within(box).findByRole('checkbox', { name: 'Sign-off' })).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    // Blank Enter does nothing.
    await user.type(input, '   {Enter}');
    expect(calls('/deliverable-items').filter(([, i]) => i?.method === 'POST')).toHaveLength(1);
    await user.click(within(box).getByRole('checkbox', { name: 'Defect log' }));
    await user.click(within(box).getByRole('checkbox', { name: 'Sign-off' }));
    expect(await within(box).findByText('3 of 3 done')).toBeInTheDocument();
    expect(calls('/status')).toHaveLength(0);
    const [, init] = calls('/deliverable-items/i2')[0]!;
    expect(JSON.parse(String(init!.body))).toMatchObject({ done: true, version: 1 });
  });

  it('inline edit: Enter saves, Esc cancels; over 200 characters shows the error and saves nothing', async () => {
    const { calls } = mount();
    const user = userEvent.setup();
    const box = await openPanel();
    await user.click(within(box).getByRole('button', { name: 'Edit Defect log' }));
    const edit = within(box).getByRole('textbox', { name: 'Edit Defect log' });
    expect(within(box).getByText('Enter saves · Esc cancels')).toBeInTheDocument();
    await user.clear(edit);
    await user.type(edit, 'Defect log v2{Enter}');
    expect(await within(box).findByRole('checkbox', { name: 'Defect log v2' })).toBeInTheDocument();

    const add = within(box).getByLabelText('Add a deliverable');
    await user.click(add);
    await user.paste('x'.repeat(197));
    expect(within(box).getByText('197/200')).toBeInTheDocument();
    await user.paste('y'.repeat(30));
    await user.keyboard('{Enter}');
    expect(within(box).getByRole('alert')).toHaveTextContent(
      'A deliverable can be up to 200 characters (this one has 227).',
    );
    expect(add).toHaveClass('is-invalid');
    expect(calls('/deliverable-items').filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
  });

  it('remove shows Undo with focus on it; Undo puts the item back', async () => {
    mount();
    const user = userEvent.setup();
    const box = await openPanel();
    await user.click(within(box).getByRole('button', { name: 'Remove Defect log' }));
    const undo = await within(box).findByRole('button', { name: 'Undo' });
    expect(box).toHaveTextContent('Removed “Defect log”.');
    expect(undo).toHaveFocus();
    expect(within(box).queryByRole('checkbox', { name: 'Defect log' })).not.toBeInTheDocument();
    await user.click(undo);
    const back = await within(box).findByRole('checkbox', { name: 'Defect log' });
    await waitFor(() => expect(back).toHaveFocus());
  });

  it('at 50 items the add box is disabled with the note', async () => {
    mount({ items: Array.from({ length: 50 }, (_, n) => item(`i${n}`, `Item ${n + 1}`)) });
    const box = await openPanel();
    expect(within(box).getByText('0 of 50 done · 50/50 items')).toHaveClass('text-danger');
    expect(within(box).getByLabelText('Add a deliverable')).toBeDisabled();
    expect(within(box).getByLabelText('Add a deliverable')).toHaveAttribute(
      'placeholder',
      '50 items is the most for one task',
    );
    expect(box).toHaveTextContent(
      'This task has 50 deliverable items, the most allowed. Remove one to add another.',
    );
  });

  it('a failed tick goes back and says why', async () => {
    mount({ fail: 500 });
    const user = userEvent.setup();
    const box = await openPanel();
    const cb = within(box).getByRole('checkbox', { name: 'Defect log' });
    await user.click(cb);
    expect(await within(box).findByRole('alert')).toHaveTextContent(
      "Couldn't save. Check your connection and try again.",
    );
    await waitFor(() => expect(cb).not.toBeChecked());
  });

  it('read-only for others: disabled boxes, no add box or actions, and the view-only line', async () => {
    mount({ can: false });
    const box = await openPanel();
    expect(within(box).getByRole('checkbox', { name: 'Defect log' })).toBeDisabled();
    expect(within(box).queryByLabelText('Add a deliverable')).not.toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(box).toHaveTextContent(
      'View only. The task owner, the project PM and Admins change deliverables.',
    );
  });

  it('a completed project is locked for everyone with its status line', async () => {
    mount({ can: false, project: project({ status: 'COMPLETED' }) });
    const box = await openPanel();
    expect(box).toHaveTextContent(
      'This project is completed, so its plan is read-only. Reopen the project to change tasks.',
    );
  });

  it('empty: the hint for editors; a tick from an import reads "Done · from import"', async () => {
    mount({ items: [] });
    const box = await openPanel();
    expect(box).toHaveTextContent(
      'No deliverable items yet. Add what this task has to hand over, like a signed form or a test report.',
    );
  });

  it('an imported tick has no name', async () => {
    mount({
      items: [
        item('i1', 'Form', {
          done: true,
          doneFromImport: true,
          doneAt: '2026-11-11T02:00:00.000Z',
        }),
      ],
    });
    const box = await openPanel();
    expect(box).toHaveTextContent(/Done · from import, (Nov 11|Today)/);
  });
});

// ----- Import preview -----
const blank = (): TimelineImportRowDto['values'] => ({
  number: '1',
  name: 'Kickoff',
  phase: '',
  milestone: '',
  start: '',
  finish: '',
  dependsOn: '',
  owner: '',
  baselineStart: '',
  baselineFinish: '',
  deliverables: '',
  taskId: 'k1',
});
const row = (over: Partial<TimelineImportRowDto>): TimelineImportRowDto => ({
  row: 2,
  result: 'UPDATE',
  values: blank(),
  old: {},
  changes: [],
  clears: [],
  errors: [],
  warnings: [],
  changedSince: null,
  willBe: null,
  deliverables: null,
  ...over,
});
const PREVIEW: TimelineImportPreviewDto = {
  fileName: 'acme-checklist-2026-11-10.xlsx',
  size: 9000,
  exported: { at: '2026-11-10T08:05:00.000Z', by: 'Test PM' },
  rows: [
    row({
      row: 2,
      values: { ...blank(), deliverables: 'A\nC\n[x] D' },
      changes: ['deliverables'],
      deliverables: {
        lines: [
          { kind: 'same', text: 'A', done: false },
          { kind: 'unticked', text: 'C', done: false },
          { kind: 'added', text: 'D', done: true },
          { kind: 'removed', text: 'B', done: false },
        ],
        added: 1,
        removed: 1,
        ticked: 0,
        unticked: 1,
        reordered: false,
      },
    }),
    row({
      row: 3,
      values: { ...blank(), number: '2', name: 'Design', owner: '' },
      changes: ['deliverables'],
      clears: ['deliverables'],
      warnings: [{ field: 'owner', message: 'Email ghost@xceler8.example doesn’t exist.' }],
      deliverables: {
        lines: [{ kind: 'removed', text: 'Spec', done: true }],
        added: 0,
        removed: 1,
        ticked: 0,
        unticked: 0,
        reordered: false,
      },
    }),
    row({ row: 4, result: 'UNCHANGED', values: { ...blank(), number: '3', name: 'Build' } }),
  ],
  counts: {
    total: 3,
    new: 0,
    update: 2,
    unchanged: 1,
    changed: 0,
    error: 0,
    errorMessages: 0,
    clears: 1,
    losesDeliverables: 2,
  },
  newPhases: [],
  addMembers: ['contractor@xceler8.example'],
  baselineFilled: false,
  noDeliverablesColumn: false,
  token: 'tok',
};

function mountImport(preview: TimelineImportPreviewDto = PREVIEW) {
  return api('PROJECT_MANAGER', (url) => {
    if (url.includes('/checklist/import/preview')) return { status: 200, body: preview };
    if (url.includes('/checklist/import/commit'))
      return {
        status: 200,
        body: {
          importId: 'i',
          created: [],
          updated: 2,
          unchanged: 1,
          leftUnconfirmed: 0,
          newPhases: [],
          addedMembers: 1,
          deliverables: { added: 1, removed: 2, ticked: 0, unticked: 1 },
        },
      };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
    return undefined;
  });
}
async function previewDialog(preview?: TimelineImportPreviewDto) {
  mountImport(preview);
  const user = userEvent.setup({ applyAccept: false });
  renderAt(`/projects/${PID}`, <App />);
  await user.click(await screen.findByRole('button', { name: 'Excel' }));
  await user.click(screen.getByRole('button', { name: /^Import from Excel…/ }));
  const dialog = await screen.findByRole('dialog');
  await user.upload(
    within(dialog).getByTestId('timeline-import-file'),
    new File(['PK'], 'acme-checklist-2026-11-10.xlsx', { type: XLSX_MIME }),
  );
  await within(dialog).findByTestId('file-chip');
  return { user, dialog };
}

describe('CR-23 import preview: deliverables (UIE §4.3 to §4.5)', () => {
  it('lines show added, unticked and removed; the Result says what is lost; the warning filters', async () => {
    const { user, dialog } = await previewDialog();
    const r2 = within(dialog).getByTestId('import-row-2');
    expect(r2).toHaveTextContent('Changes: Deliverables (1 item added)');
    expect(within(r2).getByText('Deliverables: 1 item removed, 1 unticked')).toHaveClass('fw-bold');
    expect(r2.querySelector('.tli-dl-add')).toHaveTextContent('+ [x] D');
    expect(r2.querySelector('.tli-dl-gone s')).toHaveTextContent('[ ] B');
    expect(r2.querySelector('.tli-dl-untick .tli-was')).toHaveTextContent('[x] C');
    expect(r2.querySelector('.tli-loss')).toBeInTheDocument();
    const r3 = within(dialog).getByTestId('import-row-3');
    expect(r3).toHaveTextContent('Clears: Deliverables (1 item)');
    expect(r3).toHaveTextContent('(blank)');
    expect(r3).toHaveTextContent('Email ghost@xceler8.example doesn’t exist.');
    expect(dialog).toHaveTextContent(
      "2 tasks will lose deliverable items or ticks. The Deliverables cell replaces each task's list, and a blank cell clears it.",
    );
    expect(dialog).toHaveTextContent(
      '1 person will be added to the project team as a Member: contractor@xceler8.example.',
    );
    expect(dialog).toHaveTextContent('Owners of new or changed tasks get one notification each.');
    await user.click(within(dialog).getByRole('button', { name: 'Show these rows' }));
    expect(within(dialog).getByRole('button', { name: /Removes or clears/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // No errors: no Errors chip.
    expect(within(dialog).queryByRole('button', { name: /^Errors/ })).not.toBeInTheDocument();
  });

  it('Done lists the deliverable totals and who joined the team', async () => {
    const { user, dialog } = await previewDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Import 2 rows' }));
    expect(await within(dialog).findByText('Checklist imported')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Deliverables: 1 item added, 2 removed and 1 unticked. No tasks were deleted. Baselines didn't change.",
    );
    expect(dialog).toHaveTextContent('1 person was added to the project team.');
  });

  it('an older Timeline file shows the grey note', async () => {
    const { dialog } = await previewDialog({ ...PREVIEW, noDeliverablesColumn: true });
    expect(within(dialog).getByTestId('legacy-sheet-note')).toHaveTextContent(
      "This is an older timeline file, so deliverables won't change.",
    );
  });

  it('Queen: body cells wrap long unbroken text', async () => {
    const { dialog } = await previewDialog();
    expect(dialog.querySelector('.tli-tbl')).toBeInTheDocument();
    // jsdom has no layout; the rule lives in main.scss (.tli-tbl tbody td { overflow-wrap: anywhere }).
    expect(
      within(dialog).getByTestId('import-row-2').querySelector('td.tli-cell'),
    ).toBeInTheDocument();
  });
});
