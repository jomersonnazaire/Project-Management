import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  XLSX_MIME,
  type TimelineDto,
  type TimelineImportPreviewDto,
  type TimelineImportRowDto,
} from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { timelineDto } from './cr22bFixtures';
import { PID, api, project } from './m2fixtures';
import { renderAt } from './utils';

/**
 * CR-22 Part B slice 3: timeline Excel import and export (FR-TL-15 to 26, UIE §4 to §6).
 * The API does the checking (apps/api/test/cr22b3.test.ts); these cover the menu, the empty
 * state, the preview, confirm-overwrite, the stale preview and the done screen.
 */
let compact = false;
beforeEach(() => {
  compact = false;
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: compact && q.includes('max-width'),
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

const blankValues = (): TimelineImportRowDto['values'] => ({
  number: '',
  name: '',
  phase: '',
  milestone: '',
  start: '',
  finish: '',
  dependsOn: '',
  owner: '',
  baselineStart: '',
  baselineFinish: '',
  taskId: '',
});
const row = (over: Partial<TimelineImportRowDto>): TimelineImportRowDto => ({
  row: 2,
  result: 'UPDATE',
  values: blankValues(),
  old: {},
  changes: [],
  clears: [],
  errors: [],
  changedSince: null,
  willBe: null,
  ...over,
});
const PREVIEW: TimelineImportPreviewDto = {
  fileName: 'acme-timeline-2026-11-09.xlsx',
  size: 12_000,
  exported: { at: '2026-11-09T02:00:00.000Z', by: 'Test PM' },
  rows: [
    row({
      row: 2,
      values: { ...blankValues(), number: '1', name: 'Kickoff', finish: '2026-11-20' },
      changes: ['finish'],
      old: { finish: '2026-11-18' },
    }),
    row({
      row: 3,
      result: 'CHANGED',
      values: { ...blankValues(), number: '2', name: 'Design' },
      changes: ['owner'],
      clears: ['owner'],
      old: { owner: 'Test PM' },
      changedSince: 'Changed by Test PM on Nov 10',
    }),
    row({
      row: 4,
      result: 'NEW',
      values: { ...blankValues(), number: '9', name: 'Go-live', phase: 'Hypercare' },
      changes: ['name', 'phase'],
      willBe: 6,
    }),
    row({ row: 5, result: 'UNCHANGED', values: { ...blankValues(), number: '3', name: 'Build' } }),
  ],
  counts: {
    total: 4,
    new: 1,
    update: 1,
    unchanged: 1,
    changed: 1,
    error: 0,
    errorMessages: 0,
    clears: 1,
  },
  newPhases: ['Hypercare'],
  baselineFilled: false,
  token: 'tok',
};

type Reply = { status: number; body: unknown };
function mount(
  opts: {
    tl?: TimelineDto;
    role?: 'PROJECT_MANAGER' | 'MEMBER';
    preview?: () => Reply;
    commit?: () => Reply;
  } = {},
) {
  return api(opts.role ?? 'PROJECT_MANAGER', (url) => {
    if (url.includes('/timeline/import/preview'))
      return opts.preview?.() ?? { status: 200, body: PREVIEW };
    if (url.includes('/timeline/import/commit'))
      return (
        opts.commit?.() ?? {
          status: 200,
          body: {
            importId: 'imp1',
            created: [6],
            updated: 2,
            unchanged: 1,
            leftUnconfirmed: 0,
            newPhases: ['Hypercare'],
          },
        }
      );
    if (url.includes('/timeline/template') || url.includes('/timeline/export'))
      return { status: 200, body: {} };
    if (url.endsWith(`/projects/${PID}/timeline`))
      return { status: 200, body: opts.tl ?? timelineDto() };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [] } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
    return undefined;
  });
}
const open = async () => {
  renderAt(`/projects/${PID}/timeline`, <App />);
  return screen.findByTestId('timeline');
};
const xlsx = () => new File(['PK'], 'acme-timeline-2026-11-09.xlsx', { type: XLSX_MIME });
const called = (fetch: ReturnType<typeof mount>, part: string) =>
  fetch.mock.calls.filter(([u]) => String(u).includes(part));

async function openModal() {
  const user = userEvent.setup({ applyAccept: false });
  await open();
  await user.click(screen.getByRole('button', { name: 'Excel' }));
  await user.click(screen.getByRole('button', { name: 'Import from Excel…' }));
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}
async function preview() {
  const { user, dialog } = await openModal();
  await user.upload(within(dialog).getByTestId('timeline-import-file'), xlsx());
  await within(dialog).findByTestId('file-chip');
  return { user, dialog };
}

describe('CR-22 B3 Excel menu and empty state (FR-TL-15/16, UIE §4)', () => {
  it('a planner sees Excel ▾ with import, download timeline and template; downloads hit the API', async () => {
    const fetch = mount();
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Excel' }));
    expect(screen.getByRole('button', { name: 'Import from Excel…' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download timeline (.xlsx)' }));
    await waitFor(() => expect(called(fetch, '/timeline/export')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Excel' }));
    await user.click(screen.getByRole('button', { name: 'Download template' }));
    await waitFor(() => expect(called(fetch, '/timeline/template')).toHaveLength(1));
  });

  it('with downloads only (e.g. Completed) the menu has no import item', async () => {
    const base = timelineDto();
    mount({ tl: timelineDto({ can: { ...base.can, importExcel: false } }) });
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Excel' }));
    expect(screen.queryByRole('button', { name: 'Import from Excel…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download template' })).toBeInTheDocument();
  });

  it('without the right there is no Excel menu', async () => {
    const base = timelineDto();
    mount({ tl: timelineDto({ can: { ...base.can, excel: false, importExcel: false } }) });
    await open();
    expect(screen.queryByRole('button', { name: 'Excel' })).not.toBeInTheDocument();
  });

  it('the empty state offers Import from Excel and Download template beside Open Checklist', async () => {
    mount({ tl: timelineDto({ tasks: [] }) });
    const user = userEvent.setup();
    await open();
    const imp = await screen.findByRole('button', { name: 'Import from Excel' });
    expect(screen.getByRole('button', { name: 'Download template' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Checklist' })).toBeInTheDocument();
    await user.click(imp);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Import timeline from Excel');
  });

  it('on a phone, import shows the larger-screen message instead of the modal', async () => {
    compact = true;
    mount();
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Excel' }));
    await user.click(screen.getByRole('button', { name: 'Import from Excel…' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/larger screen/i);
  });
});

describe('CR-22 B3 import preview and commit (FR-TL-17 to 25, UIE §5)', () => {
  it('shows results, the new-phase notice and numbering; nothing is saved until Import', async () => {
    const fetch = mount();
    const { dialog } = await preview();
    expect(within(dialog).getByTestId('import-row-2')).toHaveTextContent('Update');
    expect(within(dialog).getByTestId('import-row-4')).toHaveTextContent('New');
    expect(dialog).toHaveTextContent(
      'New phase Hypercare will be added at the end of the phase list.',
    );
    expect(dialog).toHaveTextContent('file 9 → #6');
    expect(within(dialog).queryByTestId('import-row-5')).not.toBeInTheDocument();
    expect(called(fetch, '/timeline/import/commit')).toHaveLength(0);
    // 1 update + 1 new; the changed row isn't counted until it's confirmed.
    expect(within(dialog).getByRole('button', { name: 'Import 2 rows' })).toBeEnabled();
    expect(dialog).toHaveTextContent('1 changed row not confirmed will be left as it is.');
  });

  it('confirm overwrite adds the row and sends its Excel row number with the token', async () => {
    const fetch = mount();
    const { user, dialog } = await preview();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm overwrite' }));
    await user.click(within(dialog).getByRole('button', { name: 'Import 3 rows' }));
    expect(await within(dialog).findByText('Timeline imported')).toBeInTheDocument();
    const [url, init] = called(fetch, '/timeline/import/commit')[0]!;
    expect(String(url)).toContain('confirm=3');
    expect(JSON.stringify(init?.headers)).toContain('tok');
    expect(dialog).toHaveTextContent('1 task added at the end (#6) and 2 updated.');
    await user.click(within(dialog).getByRole('button', { name: 'Back to timeline' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('errors block the import', async () => {
    mount({
      preview: () => ({
        status: 200,
        body: {
          ...PREVIEW,
          rows: [
            row({
              row: 2,
              result: 'ERROR',
              values: { ...blankValues(), number: '1', name: 'Kickoff', start: 'soon' },
              errors: [{ field: 'start', message: 'Start must be a date.' }],
            }),
          ],
          counts: {
            ...PREVIEW.counts,
            total: 1,
            new: 0,
            update: 0,
            changed: 0,
            unchanged: 0,
            error: 1,
            errorMessages: 1,
            clears: 0,
          },
          newPhases: [],
        },
      }),
    });
    const { dialog } = await preview();
    expect(dialog).toHaveTextContent('Fix 1 error in the file and upload again.');
    expect(within(dialog).getByTestId('import-row-2')).toHaveTextContent('Start must be a date.');
    expect(within(dialog).getByRole('button', { name: /^Import \d+ rows?$/ })).toBeDisabled();
  });

  it('a file error from the API shows its message and saves nothing', async () => {
    mount({
      preview: () => ({
        status: 422,
        body: {
          error: { code: 'OTHER_PROJECT', message: 'This file is from another project.' },
          requestId: 'r',
        },
      }),
    });
    const { user, dialog } = await openModal();
    await user.upload(within(dialog).getByTestId('timeline-import-file'), xlsx());
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/another project/);
  });

  it('a stale preview says so and Check again re-reads the file', async () => {
    const fetch = mount({
      commit: () => ({
        status: 409,
        body: { error: { code: 'PREVIEW_STALE', message: 'stale' }, requestId: 'r' },
      }),
    });
    const { user, dialog } = await preview();
    await user.click(within(dialog).getByRole('button', { name: 'Import 2 rows' }));
    expect(await within(dialog).findByText('This preview is out of date.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Import 2 rows' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(called(fetch, '/timeline/import/preview')).toHaveLength(2));
  });
});

describe("CR-22 B Lead's slice-2 call: no % complete", () => {
  it('in-progress bars use the status colour only, with no fill or progress element', async () => {
    mount();
    const tl = await open();
    const bars = tl.querySelectorAll('.tlx-bar');
    expect(bars.length).toBeGreaterThan(0);
    expect(
      tl.querySelectorAll('.tlx-bar [class*="fill"], .tlx-bar [class*="progress"]'),
    ).toHaveLength(0);
    expect(tl).not.toHaveTextContent(/% (done|complete)/i);
  });
});

describe('CR-22 B3 Q20: one assignment notice per import', () => {
  it('the bell shows the usual "assigned you to" notice listing the tasks; it opens the timeline', async () => {
    api('MEMBER', (url) => {
      if (url.endsWith('/notifications/unread-count')) return { status: 200, body: { unread: 1 } };
      if (url.endsWith('/notifications'))
        return {
          status: 200,
          body: {
            unread: 1,
            items: [
              {
                id: 'n1',
                type: 'ASSIGNED',
                actor: { id: 'u2', name: 'Maria Perez' },
                message: null,
                link: `/projects/${PID}/timeline`,
                task: null,
                tasks: [
                  { id: 'k1', name: 'Kickoff' },
                  { id: 'k2', name: 'Go-live' },
                ],
                project: { id: PID, name: 'SAP B1 Rollout' },
                issue: null,
                read: true,
                at: new Date().toISOString(),
              },
            ],
          },
        };
      if (url.endsWith(`/projects/${PID}/timeline`)) return { status: 200, body: timelineDto() };
      return undefined;
    });
    const { router } = renderAt('/my-tasks', <App />);
    await userEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
    const item = await screen.findByRole('button', {
      name: /Maria P\. assigned you to Kickoff, Go-live · SAP B1 Rollout/,
    });
    await userEvent.click(item);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${PID}/timeline`));
  });
});
