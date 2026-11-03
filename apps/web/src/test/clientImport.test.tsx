import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
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
import { App } from '../App';
import { ACME, meBody } from './fixtures';
import { mockApi, renderAt } from './utils';

/** CR-19 Clients Excel template download and import: the Excel ▾ button and the import modal. */

type Reply = { status: number; body?: unknown };

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
};

const COMMITTED: ClientImportCommitDto = {
  ...PREVIEW,
  importId: 'i1',
  applied: { created: 2, updated: 1, skipped: 2 },
};

function setup(
  role: SystemRole,
  opts: {
    permissions?: PermissionGrid;
    preview?: () => Reply;
    commit?: () => Reply;
  } = {},
) {
  return mockApi((url) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: meBody(role, opts.permissions) };
    if (url.includes('/clients/import/preview'))
      return opts.preview?.() ?? { status: 200, body: PREVIEW };
    if (url.includes('/clients/import/commit'))
      return opts.commit?.() ?? { status: 200, body: COMMITTED };
    if (url.includes('/clients/import/template')) return { status: 200, body: {} };
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
      expect(excel).toHaveClass('btn-outline-primary');
      expect(screen.getByRole('button', { name: /New client/ })).toBeInTheDocument();
      await userEvent.click(excel);
      expect(screen.getByRole('button', { name: 'Download template' })).toBeInTheDocument();
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

  it('AC-61.5 Download template fetches the template file', async () => {
    const fetch = setup('ADMIN');
    renderAt('/clients', <App />);
    await userEvent.click(await screen.findByRole('button', { name: /Excel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Download template' }));
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
    const toast = screen.getByRole('status');
    expect(toast).toHaveClass('alert-success');
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
