import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DocumentDto, DocumentRequestRowDto, FolderDto, SystemRole } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ME_PM, PID, api, project, task, type Route } from './m2fixtures';
import { renderAt } from './utils';

/** Request a document, folder restrictions, Dashboard, holidays seed and the M3 QA/design fixes. */
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

const ANA = {
  kind: 'CONTACT' as const,
  id: 'c1',
  name: 'Ana Active',
  active: true,
  company: 'Acme Trading',
};
const folder = (over: Partial<FolderDto> = {}): FolderDto => ({
  id: 'f1',
  name: 'Contracts',
  parentId: null,
  kind: 'CONTRACTS',
  depth: 0,
  documentCount: 2,
  restricted: false,
  restrictedByParent: false,
  allowedUserIds: [],
  canRestrict: true,
  ...over,
});
const doc = (over: Partial<DocumentDto> = {}): DocumentDto => ({
  id: 'd1',
  projectId: PID,
  folderId: 'f1',
  name: 'NDA – Acme Trading',
  kind: null,
  status: 'REQUESTED',
  requiresSignature: true,
  request: {
    requestedBy: { id: ME_PM, name: 'Me PM' },
    requestedFrom: ANA,
    dueDate: '2026-10-06',
    overdue: true,
    cancelled: null,
  },
  signedVersion: null,
  latestVersion: 0,
  task: null,
  source: 'DOCUMENT',
  archived: false,
  archivedReason: null,
  updatedAt: '2026-10-05T01:00:00Z',
  uploadedBy: null,
  versions: [],
  events: [
    {
      event: 'REQUESTED',
      actor: { id: ME_PM, name: 'Me PM' },
      at: '2026-10-05T01:00:00Z',
      version: null,
      note: null,
      onBehalfOf: null,
    },
  ],
  can: { upload: true, edit: true, archive: true, cancel: true },
  ...over,
});
const signed = doc({
  id: 'd2',
  name: 'Statement of Work.pdf',
  kind: 'PDF',
  status: 'SIGNED',
  request: null,
  signedVersion: 1,
  latestVersion: 1,
  uploadedBy: { id: 'u2', name: 'Maria Member' },
  versions: [
    {
      version: 1,
      fileName: 'Statement of Work.pdf',
      size: 1000,
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
      status: 'SIGNED',
      uploadedBy: { id: 'u2', name: 'Maria Member' },
      uploadedAt: '2026-09-02T07:14:00Z',
      note: null,
      signedBy: ANA,
    },
  ],
  events: [
    {
      event: 'SIGNED',
      actor: { id: 'u2', name: 'Maria Member' },
      at: '2026-09-02T07:14:00Z',
      version: 1,
      note: null,
      onBehalfOf: ANA,
    },
  ],
  can: { upload: true, edit: false, archive: true, cancel: false },
});

function docsApi(role: SystemRole, folders: FolderDto[], docs: DocumentDto[], extra?: Route) {
  return api(role, (url, init) => {
    const r = extra?.(url, init);
    if (r) return r;
    if (url.includes(`/projects/${PID}/folders`) && (init?.method ?? 'GET') === 'GET')
      return {
        status: 200,
        body: { items: folders, can: { createFolder: true, renameDefault: true, restrict: true } },
      };
    if (url.includes(`/projects/${PID}/request-parties`))
      return {
        status: 200,
        body: {
          users: [
            { kind: 'USER', id: ME_PM, name: 'Me PM', active: true },
            { kind: 'USER', id: 'u2', name: 'Maria Member', active: true },
          ],
          contacts: [ANA],
        },
      };
    if (url.includes(`/projects/${PID}/documents`) && (init?.method ?? 'GET') === 'GET')
      return {
        status: 200,
        body: {
          items: docs,
          counts: {
            all: docs.length,
            REQUESTED: docs.filter((d) => d.status === 'REQUESTED').length,
            SUBMITTED: 0,
            SIGNED: docs.filter((d) => d.status === 'SIGNED').length,
            CANCELLED: 0,
          },
          can: { upload: true, createFolder: true, archive: true, request: true },
        },
      };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
    return undefined;
  });
}

describe('Documents › Request a document (FR-DOC-20..26)', () => {
  it('a request shows "Waiting on … · due … · overdue", the Requested count, and its steps', async () => {
    docsApi('PROJECT_MANAGER', [folder()], [doc(), signed]);
    renderAt(`/projects/${PID}/documents`, <App />);
    expect(
      await screen.findByText(/Waiting on Ana Active · due Oct 6.* · overdue/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Requested (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Signed (1)' })).toBeInTheDocument();
    // Signed by a client contact: "Ana A. Client" in the list.
    expect(screen.getByText('Client', { selector: '.badge' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /NDA – Acme Trading/ }));
    expect(await screen.findByText('Overdue')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Document status' })).toHaveTextContent(
      '✓ RequestedSubmittedSigned',
    );
    expect(screen.getByRole('button', { name: 'Upload file' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Versions/ })).not.toBeInTheDocument();
  });

  it('the signed event reads "by Ana Active (client, recorded by Maria M.)"', async () => {
    docsApi('PROJECT_MANAGER', [folder()], [signed]);
    renderAt(`/projects/${PID}/documents`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: /Statement of Work\.pdf/ }));
    expect(
      await screen.findByText(/by Ana Active \(client, recorded by Maria M\.\)/),
    ).toBeInTheDocument();
  });

  it('Request document validates the form and sends the request', async () => {
    const fetchMock = docsApi('PROJECT_MANAGER', [folder()], [], (url, init) =>
      (init?.method ?? 'GET') === 'POST' && url.endsWith('/documents/requests')
        ? { status: 201, body: { document: doc() } }
        : undefined,
    );
    renderAt(`/projects/${PID}/documents`, <App />);
    expect(await screen.findByText('This folder is empty')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Request document' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request a document' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(within(dialog).getByText('Document name is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a due date.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Choose who the document is requested from.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Needs a signed copy')).toBeChecked(); // Contracts
    expect(
      within(dialog).getByText('Client contacts can be named on a document but have no access.'),
    ).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Document name *'), 'NDA');
    await userEvent.type(within(dialog).getByLabelText('Due date *'), '2099-01-15');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('option', { name: /Ana Active · Acme Trading/ }),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('Requested from *'), 'CONTACT:c1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/documents/requests'));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({
        name: 'NDA',
        folderId: 'f1',
        dueDate: '2099-01-15',
        requestedFrom: { kind: 'CONTACT', id: 'c1' },
        requiresSignature: true,
      });
    });
  });

  it('Cancel request needs a reason and posts it', async () => {
    const fetchMock = docsApi('PROJECT_MANAGER', [folder()], [doc()], (url, init) =>
      (init?.method ?? 'GET') === 'POST' && url.endsWith('/documents/d1/cancel')
        ? { status: 200, body: { document: doc({ status: 'CANCELLED' }) } }
        : undefined,
    );
    renderAt(`/projects/${PID}/documents?folder=f1&doc=d1`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Client emailed it');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) =>
            String(u).endsWith('/documents/d1/cancel') &&
            JSON.parse(String(i!.body)).reason === 'Client emailed it',
        ),
      ).toBe(true),
    );
  });
});

describe('Documents › restricted folders (FR-DOC-43)', () => {
  it('shows a lock on restricted folders; the PM picks who can see one', async () => {
    const fetchMock = docsApi(
      'PROJECT_MANAGER',
      [folder({ restricted: true, allowedUserIds: [] })],
      [],
      (url, init) =>
        init?.method === 'PUT' && url.endsWith('/folders/f1/access')
          ? { status: 200, body: { folder: { id: 'f1', name: 'Contracts' } } }
          : undefined,
    );
    renderAt(`/projects/${PID}/documents`, <App />);
    expect(await screen.findByLabelText('Restricted folder')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Who can see “Contracts”/ }));
    const dialog = await screen.findByRole('dialog', { name: /Who can see/ });
    await userEvent.click(await within(dialog).findByLabelText('Maria Member'));
    // The PM always sees it, so isn't listed.
    expect(within(dialog).queryByLabelText('Me PM')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/folders/f1/access'));
      expect(JSON.parse(String(call![1]!.body))).toEqual({ restricted: true, memberIds: ['u2'] });
    });
  });
});

const row = (over: Partial<DocumentRequestRowDto> = {}): DocumentRequestRowDto => ({
  id: 'd1',
  name: 'Items master data template',
  project: { id: PID, name: 'SAP B1 Rollout' },
  client: { id: 'cl1', name: 'Acme Trading' },
  folder: { id: 'f1', name: 'Contracts' },
  requestedFrom: ANA,
  requestedBy: { id: ME_PM, name: 'Me PM' },
  dueDate: '2026-10-03',
  daysOverdue: 6,
  overdue: true,
  ...over,
});

describe('Dashboard › Waiting on client (FR-DASH-03, AC-26.4)', () => {
  it('lists client requests with "6d overdue" / "Due tomorrow" and links to the document', async () => {
    api('PROJECT_MANAGER', (url) =>
      url.endsWith('/document-requests/waiting-on-client')
        ? {
            status: 200,
            body: {
              items: [
                row(),
                row({
                  id: 'd2',
                  name: 'Business partner template',
                  daysOverdue: -1,
                  overdue: false,
                  dueDate: '2026-10-10',
                }),
              ],
              overdue: 1,
            },
          }
        : undefined,
    );
    renderAt('/dashboard', <App />);
    expect(await screen.findByText('6d overdue')).toBeInTheDocument();
    expect(screen.getByText('Due tomorrow')).toBeInTheDocument();
    expect(screen.getAllByText('Ana Active · Acme Trading')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Items master data template' })).toHaveAttribute(
      'href',
      `/projects/${PID}/documents?folder=f1&doc=d1`,
    );
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeInTheDocument();
  });
});

describe('My tasks › Documents requested from you (FR-DOC-26)', () => {
  it('shows open requests from me under Today, with the overdue count', async () => {
    api('MEMBER', (url) => {
      if (url.includes('/tasks/mine'))
        return {
          status: 200,
          body: {
            items: [],
            today: '2026-10-09',
            holiday: null,
            counts: { today: 0, overdue: 0, dueThisWeek: 0, toReview: 0 },
          },
        };
      if (url.endsWith('/document-requests/mine'))
        return {
          status: 200,
          body: {
            items: [row({ name: 'Internal memo', requestedFrom: { ...ANA, kind: 'USER' } })],
            overdue: 1,
          },
        };
      return undefined;
    });
    renderAt('/my-tasks', <App />);
    expect(await screen.findByText('Documents requested from you')).toBeInTheDocument();
    expect(screen.getByText('1 overdue')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Internal memo' })).toBeInTheDocument();
  });
});

describe('Admin › Holidays › official Philippine holidays (seed data)', () => {
  it('an empty 2026 or 2027 offers "Load official PH holidays"', async () => {
    const fetchMock = api('ADMIN', (url, init) => {
      if (url.includes('/settings/calendar'))
        return {
          status: 200,
          body: { workingDays: [1, 2, 3, 4, 5], version: 1, year: 2026, holidays: [] },
        };
      if ((init?.method ?? 'GET') === 'POST' && url.endsWith('/settings/holidays/official'))
        return { status: 200, body: { added: 21, skipped: 0 } };
      return undefined;
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T03:00:00Z'));
    try {
      renderAt('/admin/holidays', <App />);
      const [load] = await screen.findAllByRole('button', { name: 'Load official PH holidays' });
      await userEvent.click(load!);
      expect(await screen.findByText('Added 21 official holidays.')).toBeInTheDocument();
      const call = fetchMock.mock.calls.find(([u]) =>
        String(u).endsWith('/settings/holidays/official'),
      );
      expect(JSON.parse(String(call![1]!.body))).toEqual({ year: 2026 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('M3 QA and design fixes', () => {
  it('DR-15: the notifications list ends with "Showing the last 90 days"', async () => {
    api('MEMBER', (url) =>
      url.endsWith('/notifications')
        ? {
            status: 200,
            body: {
              items: [
                {
                  id: 'n1',
                  type: 'FOLLOW_UP',
                  actor: { id: 'u2', name: 'Maria Member' },
                  task: { id: 'k1', name: 'Kickoff' },
                  project: { id: PID, name: 'SAP B1 Rollout' },
                  read: true,
                  at: new Date().toISOString(),
                },
              ],
              unread: 0,
            },
          }
        : undefined,
    );
    renderAt('/my-tasks', <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Showing the last 90 days')).toBeInTheDocument();
  });

  it('DR-16: the sidebar has no Documents "Soon" item; DR-13: Timeline says "coming in a later milestone"', async () => {
    docsApi('PROJECT_MANAGER', [folder()], []);
    renderAt(`/projects/${PID}/timeline`, <App />);
    expect(
      await screen.findByText('The timeline is coming in a later milestone'),
    ).toBeInTheDocument();
    const nav = screen.getByRole('complementary', { name: 'Main navigation' });
    expect(within(nav).queryByText('Documents')).not.toBeInTheDocument();
  });

  it('DR-14: the conversation tag field reads "Tag a contact"', async () => {
    docsApi('PROJECT_MANAGER', [folder()], [], (url) =>
      url.includes('/messages')
        ? { status: 200, body: { items: [], can: { post: true, hide: false } } }
        : undefined,
    );
    renderAt(`/projects/${PID}/conversation`, <App />);
    expect(await screen.findByRole('option', { name: 'Tag a contact' })).toBeInTheDocument();
  });
});
