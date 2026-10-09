import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContactDto, SystemRole } from '@xc8/shared';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ACME, contact, meBody } from './fixtures';
import { mockApi, renderAt } from './utils';

afterEach(() => vi.unstubAllGlobals());

type Reply = { status: number; body?: unknown };

function clientApi(
  role: SystemRole,
  opts: {
    contacts?: ContactDto[];
    projects?: unknown[];
    projectCount?: number;
    postContact?: () => Reply;
  } = {},
) {
  const contacts = opts.contacts ?? [
    contact(),
    contact({ id: 'c2', name: 'L. Cruz', position: 'IT Lead', department: null }),
  ];
  return mockApi((url, init) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: meBody(role) };
    if (url.includes(`/clients/${ACME.id}/contacts`)) {
      if (init?.method === 'POST')
        return opts.postContact?.() ?? { status: 201, body: { contact: contact({ id: 'new' }) } };
      return { status: 200, body: { items: contacts } };
    }
    if (url.includes(`/clients/${ACME.id}/projects`))
      return {
        status: 200,
        body: { items: opts.projects ?? [], total: opts.projects?.length ?? 0 },
      };
    if (url.includes(`/clients/${ACME.id}`))
      return {
        status: 200,
        body: {
          client: { ...ACME, contactCount: contacts.length, projectCount: opts.projectCount ?? 0 },
        },
      };
    if (url.includes('/clients'))
      return { status: 200, body: { items: [ACME], page: 1, pageSize: 100, total: 1 } };
    return { status: 200, body: { items: [] } };
  });
}

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

const withWhere = (
  <>
    <App />
    <Routes>
      <Route path="*" element={<Where />} />
    </Routes>
  </>
);

describe('Clients › Details / Contacts / Projects tabs (FR-CLI-09..12)', () => {
  it('AC-35.1 the old contacts URL redirects to Clients, or to the client’s Contacts tab', async () => {
    clientApi('ADMIN');
    const a = renderAt('/contacts', withWhere);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/clients$/));
    expect(await screen.findByRole('link', { name: 'Acme Trading Corp.' })).toHaveAttribute(
      'href',
      `/clients/${ACME.id}`,
    );
    a.unmount();
    renderAt(`/contacts?clientId=${ACME.id}`, withWhere);
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/clients/${ACME.id}/contacts`),
    );
    expect(await screen.findByText('R. Santos')).toBeInTheDocument();
  });

  it('shows the three tabs with counts, the breadcrumb and the no-login notice', async () => {
    clientApi('PROJECT_MANAGER');
    renderAt(`/clients/${ACME.id}/contacts`, <App />);
    const topbar = await screen.findByRole('navigation', { name: 'Top bar' });
    expect(
      await within(topbar).findByRole('heading', { name: /Acme Trading Corp\./ }),
    ).toBeInTheDocument();
    expect(within(topbar).getByText('Active')).toBeInTheDocument();
    const tabs = screen.getAllByRole('link').filter((l) => l.closest('.nav-tabs'));
    expect(tabs.map((t) => t.textContent)).toEqual(['Details', 'Contacts2', 'Projects0']);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Clients' })).toHaveAttribute(
      'href',
      '/clients',
    );
    expect(
      screen.getByText(/Client contacts are tracked only\. They don't get a login or app access\./),
    ).toBeInTheDocument();
    expect(await screen.findByText('R. Santos')).toBeInTheDocument();
    expect(screen.getByText('L. Cruz')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for R. Santos' })).toBeInTheDocument();
  });

  it('+ Add contact opens a modal that attaches the contact to this client (FR-CLI-10)', async () => {
    const fetchMock = clientApi('PROJECT_MANAGER');
    renderAt(`/clients/${ACME.id}/contacts`, <App />);
    const topbar = await screen.findByRole('navigation', { name: 'Top bar' });
    await userEvent.click(await within(topbar).findByRole('button', { name: '+ Add contact' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add contact to Acme Trading Corp.' });
    expect(
      within(dialog).getByText(/The client is set automatically\. Contacts never get a login\./),
    ).toBeInTheDocument();
    // DR-06: standard header with the close button inside it.
    expect(
      within(dialog).getByRole('button', { name: 'Close' }).closest('.modal-header'),
    ).not.toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save contact' }));
    expect(await within(dialog).findByText('Name is required.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Full name *'), 'M. Dela Rosa');
    await userEvent.type(within(dialog).getByLabelText('Position'), 'Warehouse Supervisor');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save contact' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(String(post[0])).toMatch(new RegExp(`/clients/${ACME.id}/contacts$`));
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({
      name: 'M. Dela Rosa',
      position: 'Warehouse Supervisor',
    });
  });

  it('EC-53 a 403 on save shows "You no longer have permission to do this." and refreshes permissions', async () => {
    const fetchMock = clientApi('PROJECT_MANAGER', {
      postContact: () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'x' } } }),
    });
    renderAt(`/clients/${ACME.id}/contacts`, <App />);
    const topbar = await screen.findByRole('navigation', { name: 'Top bar' });
    await userEvent.click(await within(topbar).findByRole('button', { name: '+ Add contact' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Full name *'), 'Late Person');
    const meCalls = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/me')).length;
    const before = meCalls();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save contact' }));
    expect(
      await within(dialog).findByText('You no longer have permission to do this.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(meCalls()).toBeGreaterThan(before));
  });

  it('shows the empty state with + Add contact for roles that can create', async () => {
    clientApi('ADMIN', { contacts: [] });
    renderAt(`/clients/${ACME.id}/contacts`, <App />);
    expect(await screen.findByText('No contacts yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add the people at this client your team follows up with.'),
    ).toBeInTheDocument();
    const empty = screen.getByText('No contacts yet').closest('.empty-state') as HTMLElement;
    expect(within(empty).getByRole('button', { name: '+ Add contact' })).toBeInTheDocument();
  });

  it('Viewers and Members see contacts read-only: no + Add contact, no ⋮ menu, no Edit client', async () => {
    for (const role of ['VIEWER', 'MEMBER'] as const) {
      clientApi(role);
      const view = renderAt(`/clients/${ACME.id}/contacts`, <App />);
      expect(await screen.findByText('R. Santos')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ Add contact' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit client' })).not.toBeInTheDocument();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('AC-35.3 the Projects tab: empty state, M2 status filters, and + New project for creators', async () => {
    const fetchMock = clientApi('ADMIN');
    renderAt(`/clients/${ACME.id}/projects`, <App />);
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(screen.getByText('Projects linked to this client will show here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ New project' })).toHaveAttribute(
      'href',
      `/projects/new?clientId=${ACME.id}`,
    );
    const status = screen.getByRole('combobox', { name: 'Project status' });
    expect(
      within(status)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'All statuses',
      'Planning',
      'Active',
      'Delayed',
      'At risk',
      'On hold',
      'Completed',
      'Cancelled',
      'Archived',
    ]);
    await userEvent.selectOptions(status, 'ARCHIVED');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes('/projects?status=ARCHIVED')),
      ).toBe(true),
    );
  });

  it('FR-CLI-12 a Member’s Projects tab lists what the API returns for their scope, linked, and the count matches', async () => {
    clientApi('MEMBER', {
      projectCount: 1,
      projects: [
        {
          id: 'p1',
          name: 'SAP B1 Rollout',
          clientId: ACME.id,
          managerName: 'Jomerson N.',
          startDate: '2026-08-18',
          plannedEndDate: '2026-11-20',
          progress: 42,
          status: 'ACTIVE',
          health: 'DELAYED',
          archived: false,
        },
      ],
    });
    renderAt(`/clients/${ACME.id}/projects`, <App />);
    const link = await screen.findByRole('link', { name: 'SAP B1 Rollout' });
    expect(link).toHaveAttribute('href', '/projects/p1');
    const row = link.closest('tr')!;
    expect(within(row).getByText('Jomerson N.')).toBeInTheDocument();
    // Calendar dates never shift with the viewer's timezone.
    expect(within(row).getByText('Aug 18')).toBeInTheDocument();
    expect(within(row).getByText('Nov 20')).toBeInTheDocument();
    expect(within(row).getByText('42%')).toBeInTheDocument();
    expect(within(row).getByText('Delayed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '+ New project' })).not.toBeInTheDocument();
    const projectsTab = screen
      .getAllByRole('link')
      .find((l) => l.getAttribute('href') === `/clients/${ACME.id}/projects`);
    expect(projectsTab).toHaveTextContent('Projects1');
  });

  it('the Contacts table shows each contact’s projects as links', async () => {
    clientApi('ADMIN', {
      contacts: [
        contact({ projects: [{ id: 'p1', name: 'SAP B1 Rollout' }] }),
        contact({ id: 'c2', name: 'L. Cruz', projects: [] }),
      ],
    });
    renderAt(`/clients/${ACME.id}/contacts`, <App />);
    expect(await screen.findByRole('columnheader', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SAP B1 Rollout' })).toHaveAttribute(
      'href',
      '/projects/p1',
    );
    const cruz = screen.getByText('L. Cruz').closest('tr')!;
    expect(within(cruz).getByText('–', { selector: 'span' })).toBeInTheDocument();
  });

  it('the Details tab shows the client fields; Deactivate only with Delete on clients', async () => {
    clientApi('PROJECT_MANAGER');
    const a = renderAt(`/clients/${ACME.id}`, <App />);
    expect(await screen.findByText('Retail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate client' })).toBeInTheDocument();
    a.unmount();
    vi.unstubAllGlobals();
    clientApi('VIEWER');
    renderAt(`/clients/${ACME.id}`, <App />);
    expect(await screen.findByText('Retail')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate client' })).not.toBeInTheDocument();
  });

  it('the Clients list links each client to its tabs; New client only with Create', async () => {
    clientApi('VIEWER');
    const a = renderAt('/clients', <App />);
    expect(
      await screen.findByRole('link', { name: '2 contacts at Acme Trading Corp.' }),
    ).toHaveAttribute('href', `/clients/${ACME.id}/contacts`);
    expect(screen.queryByRole('button', { name: /New client/ })).not.toBeInTheDocument();
    a.unmount();
    vi.unstubAllGlobals();
    clientApi('PROJECT_MANAGER');
    renderAt('/clients', <App />);
    expect(await screen.findByRole('button', { name: /New client/ })).toBeInTheDocument();
  });

  it('the old Admin › Clients tab redirects to Clients', async () => {
    clientApi('ADMIN');
    renderAt('/admin/clients', withWhere);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/clients$/));
  });
});

describe('Design review M1 follow-ups (DR-05, DR-06)', () => {
  const adminApi = () =>
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: meBody('ADMIN') };
      return { status: 200, body: { items: [], page: 1, pageSize: 100, total: 0 } };
    });

  it('DR-05 the Admin tab row scrolls sideways instead of clipping "Settings"', async () => {
    adminApi();
    renderAt('/admin/users', <App />);
    const settings = await screen.findByRole('link', { name: 'Settings' });
    const row = settings.closest('ul')!;
    expect(row).toHaveClass('nav-tabs', 'nav-scrollable');
    expect(
      within(row)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Users', 'Teams', 'Settings', 'Holidays', 'Leave']);
  });

  it('DR-06 the invite modal uses the standard header with × inside it', async () => {
    adminApi();
    renderAt('/admin/users', <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Invite user' }));
    const dialog = await screen.findByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const header = close.closest('.modal-header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText('Invite user')).toBeInTheDocument();
  });
});
