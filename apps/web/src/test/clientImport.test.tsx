import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CLIENT_IMPORT_TOKEN_HEADER,
  DEFAULT_ACCESS_RULES,
  XLSX_MIME,
  type ClientImportCommitDto,
  type ClientImportPreviewDto,
  type ClientImportRowDto,
  type PermissionGrid,
  type SystemRole,
} from '@xc8/shared';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_LONGER_PERMITTED } from '../api/client';
import { App } from '../App';
import { ACME, meBody } from './fixtures';
import { mockApi, renderAt } from './utils';

/** CR-19 Clients Excel template download and import: the Excel ▾ button and the import modal. */

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

const row = (r: Partial<ClientImportRowDto> & Pick<ClientImportRowDto, 'row' | 'result'>) =>
  ({ sheet: 'Clients', reasons: [], warnings: [], values: {}, ...r }) as ClientImportRowDto;

const PREVIEW: ClientImportPreviewDto = {
  fileName: 'clients.xlsx',
  size: 18 * 1024,
  counts: {
    clients: { new: 1, update: 1, noChange: 1, error: 1 },
    contacts: { new: 1, update: 0, noChange: 0, error: 1 },
    total: { new: 2, update: 1, noChange: 1, error: 2 },
  },
  clients: [
    row({ row: 3, result: 'UPDATE', values: { 'Company name': 'Acme Trading Corp.' } }),
    row({ row: 4, result: 'NEW', values: { 'Company name': 'Bluewave Marine Supply' } }),
    row({ row: 5, result: 'NO_CHANGE', inactive: true, values: { 'Company name': 'Globex' } }),
    row({
      row: 6,
      result: 'ERROR',
      reasons: ['Company name is blank'],
      values: { Industry: 'Construction', Notes: '=HYPERLINK("http://x")' },
    }),
  ],
  contacts: [
    row({
      sheet: 'Contacts',
      row: 3,
      result: 'NEW',
      values: { 'Company name': 'Bluewave Marine Supply', 'Full Name': 'Maria Santos' },
    }),
    row({
      sheet: 'Contacts',
      row: 4,
      result: 'ERROR',
      reasons: ["Email isn't valid"],
      values: { 'Company name': 'Acme', 'Full Name': 'Grace Tan', Email: 'grace@x' },
    }),
  ],
  notes: [],
  token: 'tok-1',
};

const { token: _token, ...PREVIEW_ROWS } = PREVIEW;
const COMMITTED: ClientImportCommitDto = {
  ...PREVIEW_ROWS,
  importId: 'i1',
  applied: { created: 2, updated: 1, skipped: 2 },
};

function setup(
  role: SystemRole,
  opts: {
    permissions?: PermissionGrid;
    preview?: () => Reply;
    commit?: () => Reply;
    template?: () => Reply;
    exportFile?: () => Reply;
  } = {},
) {
  return mockApi((url) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: meBody(role, opts.permissions) };
    if (url.includes('/clients/import/preview'))
      return opts.preview?.() ?? { status: 200, body: PREVIEW };
    if (url.includes('/clients/import/commit'))
      return opts.commit?.() ?? { status: 200, body: COMMITTED };
    if (url.includes('/clients/import/template'))
      return opts.template?.() ?? { status: 200, body: {} };
    if (url.includes('/clients/import/export'))
      return opts.exportFile?.() ?? { status: 200, body: {} };
    if (url.includes('/clients'))
      return { status: 200, body: { items: [ACME], page: 1, pageSize: 100, total: 1 } };
    return { status: 200, body: { items: [] } };
  });
}

const xlsxFile = (name = 'clients.xlsx') => new File(['PK'], name, { type: XLSX_MIME });

async function openImport() {
  const user = userEvent.setup({ applyAccept: false });
  await user.click(await screen.findByRole('button', { name: /Excel/ }));
  await user.click(screen.getByRole('button', { name: 'Import from Excel' }));
  const dialog = await screen.findByRole('dialog');
  return { user, dialog };
}

async function upload(file = xlsxFile()) {
  const { user, dialog } = await openImport();
  await user.upload(within(dialog).getByTestId('client-import-file'), file);
  return { user, dialog };
}

const errorReply = (status: number, code: string, message: string): Reply => ({
  status,
  body: { error: { code, message }, requestId: 'r' },
});

/** jsdom's Blob has no arrayBuffer(); FileReader works. */
const readBlob = (b: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(b);
  });

let blobs: Blob[] = [];
beforeEach(() => {
  blobs = [];
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return 'blob:x';
  });
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('CR-19 Excel button visibility (FR-CLI-23/24, Q-111)', () => {
  it.each(['ADMIN', 'PROJECT_MANAGER'] as const)(
    'AC-61.1 %s (create and edit on clients and contacts by default) sees Excel ▾ beside New client',
    async (role) => {
      setup(role);
      renderAt('/clients', <App />);
      const excel = await screen.findByRole('button', { name: /Excel/ });
      // UIE: outline-secondary, and Excel then New client in one wrapping group.
      expect(excel).toHaveClass('btn-outline-secondary');
      const group = screen.getByTestId('clients-actions');
      expect(group).toHaveClass('d-flex', 'flex-wrap');
      const newClient = within(group).getByRole('button', { name: /New client/ });
      expect(
        excel.compareDocumentPosition(newClient) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      await userEvent.click(excel);
      expect(screen.getByRole('button', { name: 'Download clients (.xlsx)' })).toBeInTheDocument();
      // The blank template moved into the import modal only.
      expect(screen.queryByRole('button', { name: 'Download template' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Import from Excel' })).toBeInTheDocument();
    },
  );

  it.each(['MEMBER', 'VIEWER'] as const)(
    'AC-61.2 %s doesn’t see the Excel button',
    async (role) => {
      setup(role);
      renderAt('/clients', <App />);
      expect(await screen.findByRole('link', { name: ACME.name })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Excel/ })).not.toBeInTheDocument();
    },
  );

  it('AC-61.6 clients-only rights hide Excel but keep New client; contacts-only rights hide both', async () => {
    const all = { view: true, create: true, edit: true, delete: true, export: false };
    const viewOnly = { view: true, create: false, edit: false, delete: false, export: false };
    const base = structuredClone(DEFAULT_ACCESS_RULES.PROJECT_MANAGER);
    setup('PROJECT_MANAGER', { permissions: { ...base, clients: all, contacts: viewOnly } });
    const a = renderAt('/clients', <App />);
    expect(await screen.findByRole('button', { name: /New client/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excel/ })).not.toBeInTheDocument();
    a.unmount();

    setup('PROJECT_MANAGER', { permissions: { ...base, clients: viewOnly, contacts: all } });
    renderAt('/clients', <App />);
    expect(await screen.findByRole('link', { name: ACME.name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New client/ })).not.toBeInTheDocument();
  });

  it('AC-61.3 missing just contacts.edit hides the button', async () => {
    const perms = structuredClone(DEFAULT_ACCESS_RULES.ADMIN);
    perms.contacts.edit = false;
    setup('ADMIN', { permissions: perms });
    renderAt('/clients', <App />);
    expect(await screen.findByRole('button', { name: /New client/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excel/ })).not.toBeInTheDocument();
  });

  it('Download clients (.xlsx) fetches the clients export, not the template', async () => {
    const fetch = setup('ADMIN');
    renderAt('/clients', <App />);
    await userEvent.click(await screen.findByRole('button', { name: /Excel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Download clients (.xlsx)' }));
    await waitFor(() =>
      expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/clients/import/export'))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/clients/import/template'))).toBe(
      false,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('UIE Download clients is disabled with a spinner while the file builds; one fetch per click burst', async () => {
    const fetch = setup('ADMIN');
    const orig = fetch.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetch.mockImplementation((u: RequestInfo | URL, init?: RequestInit) =>
      String(u).endsWith('/clients/import/export') ? gate.then(() => orig(u, init)) : orig(u, init),
    );
    renderAt('/clients', <App />);
    const user = userEvent.setup();
    const toggle = await screen.findByRole('button', { name: /Excel/ });
    await user.click(toggle);
    const item = screen.getByRole('button', { name: 'Download clients (.xlsx)' });
    // A fast double click lands before React re-renders: the ref guard keeps it to one fetch.
    fireEvent.click(item);
    fireEvent.click(item);
    // Q-118 + DEF-059: the TOGGLE is disabled with a small spinner and announces
    // "Preparing file…"; the visible label stays "Excel" so the width never changes at 390px.
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(within(toggle).getByRole('status')).toHaveTextContent('Preparing file…');
    expect(within(toggle).getByRole('status')).toHaveClass('visually-hidden');
    expect(toggle.querySelector('.spinner-border')).not.toBeNull();
    expect(toggle.querySelector('.bx-spreadsheet')).toBeNull();
    await user.click(toggle); // disabled: no menu, no second download
    const exportCalls = () =>
      fetch.mock.calls.filter(([u]) => String(u).endsWith('/clients/import/export')).length;
    expect(exportCalls()).toBe(1);
    release();
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveTextContent('Excel');
    expect(toggle).not.toHaveTextContent('Preparing file…');
    expect(toggle.querySelector('.spinner-border')).toBeNull();
    expect(exportCalls()).toBe(1);
  });

  it('UIE the Excel toggle is restored when the download fails', async () => {
    setup('ADMIN', { exportFile: () => errorReply(500, 'INTERNAL', 'boom') });
    renderAt('/clients', <App />);
    const user = userEvent.setup();
    const toggle = await screen.findByRole('button', { name: /Excel/ });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Download clients (.xlsx)' }));
    await screen.findByText("Couldn't download the clients file. Try again.");
    expect(toggle).not.toBeDisabled();
    expect(toggle).toHaveTextContent('Excel');
  });

  describe('Q-119 over-limit toast after a download', () => {
    const counts = (clients: number, contacts: number): Reply => ({
      status: 200,
      body: {},
      headers: {
        'X-Export-Clients-Rows': String(clients),
        'X-Export-Contacts-Rows': String(contacts),
      },
    });
    async function download() {
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Excel/ }));
      await user.click(screen.getByRole('button', { name: 'Download clients (.xlsx)' }));
      await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
      return user;
    }

    it('no toast when both sheets are within 2,000 rows', async () => {
      setup('ADMIN', { exportFile: () => counts(2000, 1999) });
      renderAt('/clients', <App />);
      await download();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Excel' })).not.toBeDisabled());
      expect(screen.queryByText(/over the 2,000 limit/)).toBeNull();
      expect(document.querySelector('.toast.bg-warning')).toBeNull();
    });

    it('Contacts only: amber toast names the sheet and count, and can be dismissed', async () => {
      setup('ADMIN', { exportFile: () => counts(40, 2340) });
      renderAt('/clients', <App />);
      const user = await download();
      const text =
        'Downloaded. The Contacts sheet has 2,340 rows, over the 2,000 limit, so split it into smaller files before importing.';
      const toast = (await screen.findByText(text)).closest('.toast') as HTMLElement;
      expect(toast).toHaveClass('bg-warning');
      expect(toast).toHaveAttribute('role', 'status');
      expect(toast).toHaveAttribute('aria-live', 'polite');
      expect(screen.queryByRole('alert')).toBeNull();
      await user.click(within(toast).getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByText(text)).toBeNull();
    });

    it('both sheets: one toast naming both', async () => {
      setup('ADMIN', { exportFile: () => counts(2100, 2340) });
      renderAt('/clients', <App />);
      await download();
      const toast = (
        await screen.findByText(
          'Downloaded. The Clients sheet has 2,100 rows and the Contacts sheet has 2,340 rows, over the 2,000 limit, so split them into smaller files before importing.',
        )
      ).closest('.toast');
      expect(toast).toHaveClass('bg-warning');
      expect(document.querySelectorAll('.toast.bg-warning')).toHaveLength(1);
    });
  });

  it('AC-61.5 Download template in the import modal still fetches the blank template', async () => {
    const fetch = setup('ADMIN');
    renderAt('/clients', <App />);
    const { user, dialog } = await openImport();
    await user.click(within(dialog).getByRole('button', { name: 'Download template' }));
    await waitFor(() =>
      expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/clients/import/template'))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });
});

describe('CR-19 import modal states (FR-CLI-34..38, UIE spec)', () => {
  it('choose-file state shows the drop zone copy and the template link', async () => {
    setup('ADMIN');
    renderAt('/clients', <App />);
    const { dialog } = await openImport();
    expect(within(dialog).getByText('Import clients from Excel')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Use the OpsTrack template. It has a Clients sheet and a Contacts sheet.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Drop your filled template here or choose a file'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Choose file' })).toBeInTheDocument();
    expect(
      within(dialog).getByText('.xlsx only · up to 5 MB · 2,000 rows per sheet'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Don't have it yet\?/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download template' })).toBeInTheDocument();
  });

  it('AC-62.1 Reading file… then the preview: counts, tabs, Result badges and Import valid rows (n)', async () => {
    let release: (r: Reply) => void = () => undefined;
    const fetch = setup('ADMIN');
    // Hold the preview reply so the loading state can be seen.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/clients/import/preview')) {
          const r = await new Promise<Reply>((res) => (release = res));
          return new Response(JSON.stringify(r.body), { status: r.status });
        }
        return fetch(input, init);
      }),
    );
    renderAt('/clients', <App />);
    const { dialog } = await upload();
    expect(await within(dialog).findByText('Reading file…')).toBeInTheDocument();
    const call = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([u]) => String(u).includes('/clients/import/preview'))!;
    expect(String(call[0])).toContain('fileName=clients.xlsx');
    expect((call[1]!.headers as Record<string, string>)['Content-Type']).toBe(XLSX_MIME);
    expect((call[1]!.headers as Record<string, string>)['X-Requested-With']).toBe('xc8-web');
    expect(call[1]!.body).toBeInstanceOf(File);

    release({ status: 200, body: PREVIEW });
    expect(await within(dialog).findByText('2 new')).toBeInTheDocument();
    expect(within(dialog).getByText('1 to update')).toBeInTheDocument();
    expect(within(dialog).getByText('1 no change')).toBeInTheDocument();
    expect(within(dialog).getByText('2 with errors')).toBeInTheDocument();
    expect(within(dialog).getByText(/Clients match on Company name/)).toBeInTheDocument();
    expect(within(dialog).getByText(/blank cells keep the current value/)).toBeInTheDocument();
    expect(within(dialog).getByText(/18 KB · 4 clients, 2 contacts/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Clients (4)' })).toBeInTheDocument();
    const table = within(dialog).getByRole('table');
    expect(within(table).getByText('Update')).toBeInTheDocument();
    expect(within(table).getByText('New')).toBeInTheDocument();
    expect(within(table).getByText('No change (inactive)')).toBeInTheDocument();
    expect(within(table).getByText('Company name is blank')).toBeInTheDocument();
    expect(within(table).getByText('(blank)')).toBeInTheDocument();
    // No change rows aren't counted: 2 new + 1 update.
    expect(within(dialog).getByRole('button', { name: 'Import valid rows (3)' })).toBeEnabled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Contacts (2)' }));
    expect(within(dialog).getByText('Grace Tan')).toBeInTheDocument();
    expect(within(dialog).getByText("Email isn't valid")).toBeInTheDocument();
    expect(within(dialog).getByRole('columnheader', { name: 'Full name' })).toBeInTheDocument();
  });

  it('nothing valid to import disables the Import button', async () => {
    const none = { new: 0, update: 0, noChange: 1, error: 0 };
    setup('ADMIN', {
      preview: () => ({
        status: 200,
        body: {
          ...PREVIEW,
          counts: { clients: none, contacts: { ...none, noChange: 0 }, total: none },
          clients: [row({ row: 3, result: 'NO_CHANGE', values: { 'Company name': 'Acme' } })],
          contacts: [],
        },
      }),
    });
    renderAt('/clients', <App />);
    const { dialog } = await upload();
    expect(
      await within(dialog).findByRole('button', { name: 'Import valid rows (0)' }),
    ).toBeDisabled();
  });

  it('EC-146 not the template: the message, the drop zone again and Download template', async () => {
    setup('ADMIN', {
      preview: () =>
        errorReply(
          422,
          'NOT_TEMPLATE',
          "This file isn't the OpsTrack template. Download the template and try again.",
        ),
    });
    renderAt('/clients', <App />);
    const { dialog } = await upload();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "This file isn't the OpsTrack template. Download the template and try again.",
    );
    expect(within(dialog).getByRole('button', { name: 'Choose file' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Download template' })).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: /Import valid rows/ }),
    ).not.toBeInTheDocument();
  });

  it('EC-145 no rows: the empty state and Choose another file', async () => {
    setup('ADMIN', { preview: () => errorReply(422, 'EMPTY_FILE', 'No rows found in the file.') });
    renderAt('/clients', <App />);
    const { user, dialog } = await upload();
    expect(await within(dialog).findByText('No rows found in the file.')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Add rows to the Clients or Contacts sheet, then choose the file again.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Choose another file' }));
    expect(within(dialog).getByRole('button', { name: 'Choose file' })).toBeInTheDocument();
  });

  it('EC-147 too many rows: the message and the split hint', async () => {
    const msg = 'Too many rows: the Contacts sheet has 2,340. The limit is 2,000 per sheet.';
    setup('ADMIN', { preview: () => errorReply(422, 'TOO_MANY_ROWS', msg) });
    renderAt('/clients', <App />);
    const { dialog } = await upload();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(msg);
    expect(
      within(dialog).getByText('Split the rows into two files and import them one at a time.'),
    ).toBeInTheDocument();
  });

  it('a non-.xlsx file is refused before upload ("Upload an .xlsx file.")', async () => {
    const fetch = setup('ADMIN');
    renderAt('/clients', <App />);
    const { dialog } = await upload(new File(['a,b'], 'clients.csv', { type: 'text/csv' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Upload an .xlsx file.');
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/import/preview'))).toBe(false);
  });

  it('AC-62.7 / FR-CLI-38 commit closes the modal, shows the toast and the skipped-rows link', async () => {
    const fetch = setup('ADMIN');
    renderAt('/clients', <App />);
    const { user, dialog } = await upload();
    await user.click(await within(dialog).findByRole('button', { name: 'Import valid rows (3)' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // UIE: a toast (react-bootstrap Toast), not an inline alert.
    const toast = await screen.findByRole('status');
    expect(toast).toHaveClass('toast');
    expect(toast).not.toHaveClass('alert');
    expect(toast).toHaveTextContent('Imported 2 new, updated 1. 2 rows skipped.');
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/clients/import/commit'))).toBe(true);

    // FR-CLI-36 / AC-62.9: the skipped-rows file holds only Error rows, all as plain text.
    await user.click(within(toast).getByRole('button', { name: 'Download skipped rows (.xlsx)' }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await readBlob(blobs[0]!));
    const clients = wb.getWorksheet('Clients')!;
    expect((clients.getRow(1).values as string[]).slice(1)).toEqual([
      'Company name',
      'Industry',
      'Address',
      'Notes',
      'Status',
      'Row',
      'Reason',
    ]);
    expect(clients.rowCount).toBe(2);
    const notes = clients.getCell('D2');
    expect(notes.type).toBe(ExcelJS.ValueType.String);
    expect(notes.value).toBe('=HYPERLINK("http://x")');
    expect(clients.getCell('G2').value).toBe('Company name is blank');
    const contacts = wb.getWorksheet('Contacts')!;
    expect(contacts.rowCount).toBe(2);
    expect(contacts.getCell('B2').value).toBe('Grace Tan');
  });

  it('no skipped rows: the toast has no download link', async () => {
    setup('ADMIN', {
      commit: () => ({
        status: 200,
        body: { ...COMMITTED, applied: { created: 1, updated: 0, skipped: 0 } },
      }),
    });
    renderAt('/clients', <App />);
    const { user, dialog } = await upload();
    await user.click(await within(dialog).findByRole('button', { name: 'Import valid rows (3)' }));
    expect(
      await screen.findByText('Imported 1 new, updated 0. 0 rows skipped.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download skipped rows/ })).not.toBeInTheDocument();
  });

  it('FR-CLI-35b the commit sends the preview token back', async () => {
    const fetch = setup('ADMIN');
    renderAt('/clients', <App />);
    const { user, dialog } = await upload();
    await user.click(await within(dialog).findByRole('button', { name: 'Import valid rows (3)' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const call = fetch.mock.calls.find(([u]) => String(u).includes('/clients/import/commit'))!;
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers[CLIENT_IMPORT_TOKEN_HEADER]).toBe('tok-1');
  });

  it('AC-62.19 409 PREVIEW_STALE shows "Preview again"; it re-runs the preview and the next commit uses the new token', async () => {
    let previews = 0;
    let commits = 0;
    const fetch = setup('ADMIN', {
      preview: () => ({ status: 200, body: { ...PREVIEW, token: `tok-${++previews}` } }),
      commit: () =>
        ++commits === 1
          ? errorReply(
              409,
              'PREVIEW_STALE',
              'These clients changed after your preview. Preview again.',
            )
          : { status: 200, body: COMMITTED },
    });
    renderAt('/clients', <App />);
    const { user, dialog } = await upload();
    await user.click(await within(dialog).findByRole('button', { name: 'Import valid rows (3)' }));
    // UIE: the modal stays on the preview with a warning (not danger) alert.
    const staleAlert = await within(dialog).findByRole('alert');
    expect(staleAlert).toHaveTextContent('This preview is out of date. Preview again.');
    expect(staleAlert).toHaveClass('alert-warning');
    expect(staleAlert).not.toHaveClass('alert-danger');
    expect(within(dialog).getByText('Bluewave Marine Supply')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Import valid rows/ })).toBeNull();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Preview again' }),
    );
    const importBtn = await screen.findByRole('button', { name: 'Import valid rows (3)' });
    expect(previews).toBe(2);
    expect(screen.queryByText(/out of date/)).toBeNull();
    await user.click(importBtn);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const commitCalls = fetch.mock.calls.filter(([u]) => String(u).includes('/import/commit'));
    const tokens = commitCalls.map(
      ([, init]) =>
        ((init as RequestInit).headers as Record<string, string>)[CLIENT_IMPORT_TOKEN_HEADER],
    );
    expect(tokens).toEqual(['tok-1', 'tok-2']);
  });

  it('AC-62.23 Download clients on the Excel menu shows the amber "not set up" message on 503', async () => {
    setup('ADMIN', {
      exportFile: () =>
        errorReply(503, 'IMPORT_NOT_CONFIGURED', 'Excel import isn’t set up yet. Ask an Admin.'),
    });
    renderAt('/clients', <App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Excel/ }));
    await user.click(screen.getByRole('button', { name: 'Download clients (.xlsx)' }));
    const tpl = await screen.findByText("Excel import isn't available right now.");
    expect(tpl.closest('.alert')).toHaveClass('alert-warning'); // DEF-057
    expect(screen.queryByText(/set up yet/)).toBeNull();
  });

  it('AC-62.23 503 IMPORT_NOT_CONFIGURED shows the "not set up" message', async () => {
    setup('ADMIN', {
      preview: () =>
        errorReply(503, 'IMPORT_NOT_CONFIGURED', 'Excel import isn’t set up yet. Ask an Admin.'),
    });
    renderAt('/clients', <App />);
    const { dialog } = await upload();
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent("Excel import isn't available right now. Nothing was saved.");
    expect(alert).toHaveClass('alert-warning'); // DEF-057
    expect(alert).not.toHaveTextContent('set up yet');
  });

  it('AC-62.23 503 on commit shows the UIE "not available" copy', async () => {
    setup('ADMIN', {
      commit: () =>
        errorReply(503, 'IMPORT_NOT_CONFIGURED', 'Excel import isn’t set up yet. Ask an Admin.'),
    });
    renderAt('/clients', <App />);
    const { user, dialog } = await upload();
    await user.click(await within(dialog).findByRole('button', { name: 'Import valid rows (3)' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent("Excel import isn't available right now. Nothing was saved.");
    expect(alert).toHaveClass('alert-warning'); // DEF-057
  });

  it.each([
    [
      'IMPORT_BUSY',
      'Another import is still running. Wait a moment, then try again. Nothing was saved.',
    ],
    ['RATE_LIMITED', 'Too many imports. Wait a few minutes, then try again. Nothing was saved.'],
  ])(
    'NFR-41 / AC-62.24 429 %s on commit: stays on the preview with the UIE warning; Import can be retried',
    async (code, expected) => {
      const serverText = '(raw server text, never shown)';
      let commits = 0;
      setup('ADMIN', {
        commit: () =>
          ++commits === 1 ? errorReply(429, code, serverText) : { status: 200, body: COMMITTED },
      });
      renderAt('/clients', <App />);
      const { user, dialog } = await upload();
      await user.click(
        await within(dialog).findByRole('button', { name: 'Import valid rows (3)' }),
      );
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(expected);
      expect(alert).not.toHaveTextContent('raw server text');
      expect(alert).toHaveClass('alert-warning');
      expect(within(dialog).getByText('Bluewave Marine Supply')).toBeInTheDocument();
      const again = within(dialog).getByRole('button', { name: 'Import valid rows (3)' });
      expect(again).toBeEnabled();
      await user.click(again);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(commits).toBe(2);
    },
  );

  it('NFR-41 the Import button is disabled while a commit is in flight (no double submit)', async () => {
    const fetch = setup('ADMIN');
    const real = fetch.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    fetch.mockImplementation(async (input, init) => {
      if (String(input).includes('/clients/import/commit')) await held;
      return real(input, init);
    });
    renderAt('/clients', <App />);
    const { user, dialog } = await upload();
    const btn = await within(dialog).findByRole('button', { name: 'Import valid rows (3)' });
    await user.dblClick(btn);
    const busy = await within(dialog).findByRole('button', { name: 'Importing…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    const commitCalls = () =>
      fetch.mock.calls.filter(([u]) => String(u).includes('/clients/import/commit')).length;
    expect(commitCalls()).toBe(1);
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(commitCalls()).toBe(1);
  });

  it('DEF-056 two clicks in the same tick send one commit (guard does not wait for isPending)', async () => {
    const fetch = setup('ADMIN');
    renderAt('/clients', <App />);
    const { dialog } = await upload();
    const btn = await within(dialog).findByRole('button', { name: 'Import valid rows (3)' });
    act(() => {
      btn.click();
      btn.click();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const commitCalls = fetch.mock.calls.filter(([u]) =>
      String(u).includes('/clients/import/commit'),
    ).length;
    expect(commitCalls).toBe(1);
    expect(screen.queryByText(/Nothing was saved/)).not.toBeInTheDocument();
  });

  it('UIE a "Possible duplicate" warning is amber (text-warning) with ⚠ and the row stays New', async () => {
    const dup = 'Possible duplicate of Contact One (no email) on the Contacts tab.';
    setup('ADMIN', {
      preview: () => ({
        status: 200,
        body: {
          ...PREVIEW,
          clients: [
            row({
              row: 3,
              result: 'NEW',
              warnings: [dup],
              values: { 'Company name': 'Dup Co' },
            }),
          ],
        },
      }),
    });
    renderAt('/clients', <App />);
    const { dialog } = await upload();
    const warn = await within(dialog).findByText(dup);
    const line = warn.closest('.client-import-warning') as HTMLElement;
    expect(line).toHaveClass('text-warning');
    expect(line).toHaveTextContent(`⚠ ${dup}`);
    const tr = line.closest('tr') as HTMLElement;
    expect(within(tr).getByText('New')).toHaveClass('bg-label-success');
  });

  it('DEF-055 the modal footer uses the stacking class (primary on top on phones)', async () => {
    setup('ADMIN');
    renderAt('/clients', <App />);
    const { dialog } = await upload();
    const btn = await within(dialog).findByRole('button', { name: 'Import valid rows (3)' });
    const footer = btn.closest('.modal-footer') as HTMLElement;
    expect(footer).toHaveClass('client-import-footer');
    // column-reverse puts the last child (Import) on top, so Import must come after Cancel.
    const buttons = within(footer).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Import valid rows (3)']);
  });

  it('UIE the modal is size lg, not xl', async () => {
    setup('ADMIN');
    renderAt('/clients', <App />);
    const { dialog } = await openImport();
    expect(dialog.querySelector('.modal-dialog') ?? dialog.closest('.modal-dialog')).toHaveClass(
      'modal-lg',
    );
  });

  it.each([
    [404, 'NOT_FOUND', 'Cannot POST /api/v1/clients/import/preview'],
    [500, 'INTERNAL', 'TypeError: x is undefined'],
    [502, 'HTTP_ERROR', 'Bad gateway'],
  ])(
    'UIE an unknown %s on preview shows the generic import message, not the server text',
    async (status, code, message) => {
      setup('ADMIN', { preview: () => errorReply(status, code, message) });
      renderAt('/clients', <App />);
      const { dialog } = await upload();
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent('Import failed. Nothing was saved. Try again.');
      expect(alert).not.toHaveTextContent(message);
    },
  );

  it('UIE 413 and 415 from the API use the spec copy', async () => {
    setup('ADMIN', { preview: () => errorReply(413, 'X', 'raw 413') });
    renderAt('/clients', <App />);
    const { dialog } = await upload();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The file is larger than 5 MB.',
    );
  });

  it('UIE an unknown commit error shows the generic import message', async () => {
    setup('ADMIN', { commit: () => errorReply(500, 'BOOM', 'stack trace here') });
    renderAt('/clients', <App />);
    const { user, dialog } = await upload();
    await user.click(await within(dialog).findByRole('button', { name: 'Import valid rows (3)' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Import failed. Nothing was saved. Try again.');
    expect(alert).not.toHaveTextContent('stack trace here');
  });

  it('UIE a failed clients download on the Excel menu shows red "Couldn\'t download" copy and can be dismissed', async () => {
    setup('ADMIN', { exportFile: () => errorReply(500, 'INTERNAL', 'raw server text') });
    renderAt('/clients', <App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Excel/ }));
    await user.click(screen.getByRole('button', { name: 'Download clients (.xlsx)' }));
    const failed = "Couldn't download the clients file. Try again.";
    const alert = await screen.findByText(failed);
    expect(alert.closest('.alert')).toHaveClass('alert-danger');
    expect(screen.queryByText('raw server text')).toBeNull();
    await user.click(
      within(alert.closest('.alert') as HTMLElement).getByRole('button', { name: 'Dismiss' }),
    );
    expect(screen.queryByText(failed)).toBeNull();
  });

  it('UIE a 403 on Download clients says the user no longer has permission (red)', async () => {
    setup('ADMIN', { exportFile: () => errorReply(403, 'FORBIDDEN', 'raw forbidden text') });
    renderAt('/clients', <App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Excel/ }));
    await user.click(screen.getByRole('button', { name: 'Download clients (.xlsx)' }));
    const alert = await screen.findByText(NO_LONGER_PERMITTED);
    expect(alert.closest('.alert')).toHaveClass('alert-danger');
    expect(screen.queryByText('raw forbidden text')).toBeNull();
  });

  it('UIE a template error in the modal is cleared when a file is chosen (alerts do not stack)', async () => {
    setup('ADMIN', { template: () => errorReply(404, 'NOT_FOUND', 'nope') });
    renderAt('/clients', <App />);
    const { user, dialog } = await openImport();
    await user.click(within(dialog).getByRole('button', { name: 'Download template' }));
    expect(
      await within(dialog).findByText("Couldn't download the template. Try again."),
    ).toBeInTheDocument();
    await user.upload(within(dialog).getByTestId('client-import-file'), xlsxFile());
    expect(await within(dialog).findByText('2 new')).toBeInTheDocument();
    expect(within(dialog).queryByText("Couldn't download the template. Try again.")).toBeNull();
  });

  it('AC-62.8 a failed commit keeps the modal open with "Import failed. Nothing was saved."', async () => {
    setup('ADMIN', {
      commit: () =>
        errorReply(500, 'IMPORT_FAILED', 'Import failed. Nothing was saved. Try again.'),
    });
    renderAt('/clients', <App />);
    const { user, dialog } = await upload();
    await user.click(await within(dialog).findByRole('button', { name: 'Import valid rows (3)' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Import failed. Nothing was saved. Try again.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
