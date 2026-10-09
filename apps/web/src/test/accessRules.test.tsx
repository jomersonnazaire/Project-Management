import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_ACCESS_RULES } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { meBody, rulesBody } from './fixtures';
import { mockApi, renderAt } from './utils';

afterEach(() => vi.unstubAllGlobals());

type Reply = { status: number; body?: unknown };

function adminApi(opts: { put?: () => Reply; reset?: () => Reply; me?: () => Reply } = {}) {
  return mockApi((url, init) => {
    if (url.endsWith('/auth/me')) return opts.me?.() ?? { status: 200, body: meBody('ADMIN') };
    if (url.includes('/access-rules/') && init?.method === 'PUT')
      return opts.put?.() ?? { status: 200, body: { rules: rulesBody(2).roles[1] } };
    if (url.endsWith('/reset'))
      return opts.reset?.() ?? { status: 200, body: { rules: rulesBody(2).roles[1] } };
    if (url.endsWith('/access-rules')) return { status: 200, body: rulesBody() };
    return { status: 200, body: { items: [] } };
  });
}

const row = (name: string) => screen.getByText(name, { selector: 'code' }).closest('tr')!;
const box = (r: HTMLElement, label: RegExp) => within(r).getByRole('checkbox', { name: label });

describe('Access rules screen (doc 11, mockup v0.5.2)', () => {
  it('shows role tabs, the PM grid by default, n/a cells and the fixed scope column', async () => {
    adminApi();
    renderAt('/access-rules', <App />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Admin', 'PM', 'Member', 'Viewer']);
    expect(screen.getByRole('tab', { name: 'PM' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('accessRules', { selector: 'code' });
    // 20 record types (M3 conversations and notifications, M3.5 issues, M5 activities, M7 leave, v0.4.8 workload).
    expect(document.querySelectorAll('tbody tr[data-record]')).toHaveLength(20);
    // PM defaults: clients VCED, users none.
    for (const a of [/^View Clients$/, /^Create Clients$/, /^Edit Clients$/, /^Delete Clients$/])
      expect(box(row('clients'), a)).toBeChecked();
    expect(box(row('users'), /^View Users/)).not.toBeChecked();
    // n/a cells are disabled and labelled.
    const settings = row('settings');
    expect(box(settings, /Create Settings \(n\/a\)/)).toBeDisabled();
    expect(within(settings).getAllByText('n/a')).toHaveLength(2);
    expect(within(row('approvals')).getAllByText('n/a')).toHaveLength(3);
    expect(within(row('reports')).getAllByText('n/a')).toHaveLength(3);
    // Q-26: PM can't be given project Delete; it archives instead.
    expect(box(row('projects'), /Delete Projects \(archive only\)/)).toBeDisabled();
    expect(within(row('projects')).getByText('Archive only')).toBeInTheDocument();
    expect(within(row('projects')).getByText(/projects they manage/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Member' }));
    expect(within(row('projects')).getByText('Only projects they belong to')).toBeInTheDocument();
    expect(within(row('tasks')).getByText('Own tasks only')).toBeInTheDocument();
    expect(within(row('time')).getByText('Own entries only')).toBeInTheDocument();
    expect(within(row('approvals')).getByText('Designated reviewer only')).toBeInTheDocument();
    expect(box(row('projects'), /Delete Projects \(Admin only\)/)).toBeDisabled();
  });

  it('AC-34.1 Admin rows on users and accessRules are locked on with an explanation', async () => {
    adminApi();
    renderAt('/access-rules', <App />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Admin' }));
    for (const record of ['users', 'accessRules']) {
      const r = row(record);
      for (const cb of within(r).getAllByRole('checkbox', { name: /locked/ })) {
        expect(cb).toBeChecked();
        expect(cb).toBeDisabled();
        expect(cb).toHaveAttribute('title', 'Locked so nobody can lock every Admin out');
      }
      expect(within(r).getByLabelText('Locked')).toBeInTheDocument();
    }
    expect(within(row('users')).getAllByRole('checkbox', { name: /locked/ })).toHaveLength(4);
    expect(within(row('accessRules')).getAllByRole('checkbox', { name: /locked/ })).toHaveLength(2);
    // Other Admin rows stay editable.
    expect(box(row('teams'), /^Delete Teams$/)).toBeEnabled();
    expect(screen.getByText(/locked so nobody can lock every Admin out/)).toBeInTheDocument();
  });

  it('AC-33.2 ticking Edit ticks View; View can’t be unticked while Edit is on; Discard restores', async () => {
    adminApi();
    renderAt('/access-rules', <App />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Viewer' }));
    const teams = row('teams');
    expect(box(teams, /^View Teams$/)).not.toBeChecked();
    expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument();

    await userEvent.click(box(teams, /^Edit Teams$/));
    expect(box(teams, /^Edit Teams$/)).toBeChecked();
    expect(box(teams, /^View Teams$/)).toBeChecked();
    expect(screen.getByText('You have unsaved changes for Viewer.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Viewer/ })).toHaveTextContent('●');

    await userEvent.click(box(teams, /^View Teams$/));
    expect(box(teams, /^View Teams$/)).toBeChecked();
    expect(
      screen.getByText('View is included in Create, Edit and Delete. Untick those first.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(box(row('teams'), /^Edit Teams$/)).not.toBeChecked();
    expect(box(row('teams'), /^View Teams$/)).not.toBeChecked();
    expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument();
  });

  it('FR-ACL-11 save asks for confirmation, then PUTs only changed rows with the version', async () => {
    const fetchMock = adminApi();
    renderAt('/access-rules', <App />);
    await screen.findByText('clients', { selector: 'code' });
    await userEvent.click(box(row('clients'), /^Delete Clients$/));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Save access rules?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/apply right away to everyone with this role, on their next action/),
    ).toBeInTheDocument();
    // DR-06: the close button sits in the standard modal header.
    expect(
      within(dialog).getByRole('button', { name: 'Close' }).closest('.modal-header'),
    ).not.toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await screen.findByText(/Saved\. PM permissions apply on each user's next action\./);
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(String(put[0])).toMatch(/\/access-rules\/PROJECT_MANAGER$/);
    expect(JSON.parse(String(put[1]?.body))).toEqual({
      version: 1,
      permissions: {
        clients: { view: true, create: true, edit: true, delete: false, export: false },
      },
    });
    expect((put[1]?.headers as Record<string, string>)['X-Requested-With']).toBe('xc8-web');
    await waitFor(() =>
      expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument(),
    );
  });

  it('AC-33.5 a 409 shows the conflict message with Reload', async () => {
    const fetchMock = adminApi({
      put: () => ({
        status: 409,
        body: { error: { code: 'VERSION_CONFLICT', message: 'Someone else saved…' } },
      }),
    });
    renderAt('/access-rules', <App />);
    await screen.findByText('clients', { selector: 'code' });
    await userEvent.click(box(row('clients'), /^Delete Clients$/));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
    );
    expect(
      await screen.findByText(/Someone else saved these rules while you were editing\./),
    ).toBeInTheDocument();
    const before = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/access-rules')).length;
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/access-rules')).length,
      ).toBeGreaterThan(before),
    );
    expect(box(row('clients'), /^Delete Clients$/)).toBeChecked();
    expect(screen.queryByText(/You have unsaved changes/)).not.toBeInTheDocument();
  });

  it('EC-53 a 403 on save shows "You no longer have permission to do this."', async () => {
    adminApi({
      put: () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'No.' } } }),
    });
    renderAt('/access-rules', <App />);
    await screen.findByText('clients', { selector: 'code' });
    await userEvent.click(box(row('clients'), /^Delete Clients$/));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
    );
    expect(
      await screen.findByText('You no longer have permission to do this.'),
    ).toBeInTheDocument();
  });

  it('AC-33.6 Reset to defaults asks first, then posts the reset for the selected role', async () => {
    const fetchMock = adminApi();
    renderAt('/access-rules', <App />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Member' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset role to defaults' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Reset to defaults?')).toBeInTheDocument();
    expect(within(dialog).getByText(/recorded in the audit log/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
    await screen.findByText('Member permissions reset to defaults.');
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/reset'))!;
    expect(String(call[0])).toMatch(/\/access-rules\/MEMBER\/reset$/);
    expect(JSON.parse(String(call[1]?.body))).toEqual({ version: 1 });
  });

  it('a role with View but not Edit on accessRules sees a read-only grid', async () => {
    const perms = structuredClone(DEFAULT_ACCESS_RULES.PROJECT_MANAGER);
    perms.accessRules.view = true;
    adminApi({ me: () => ({ status: 200, body: meBody('PROJECT_MANAGER', perms) }) });
    renderAt('/access-rules', <App />);
    await screen.findByText('clients', { selector: 'code' });
    expect(box(row('clients'), /^Delete Clients$/)).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Reset role to defaults' }),
    ).not.toBeInTheDocument();
  });

  it('Q-27 PMs, Members and Viewers get the 403 page and no Access rules menu item', async () => {
    for (const role of ['PROJECT_MANAGER', 'MEMBER', 'VIEWER'] as const) {
      mockApi((url) =>
        url.endsWith('/auth/me')
          ? { status: 200, body: meBody(role) }
          : { status: 200, body: { items: [] } },
      );
      const view = renderAt('/access-rules', <App />);
      expect(await screen.findByText('403')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Access rules/ })).not.toBeInTheDocument();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('an Admin sees the Access rules menu item', async () => {
    adminApi();
    renderAt('/my-tasks', <App />);
    expect(await screen.findByRole('link', { name: /Access rules/ })).toHaveAttribute(
      'href',
      '/access-rules',
    );
  });
});
