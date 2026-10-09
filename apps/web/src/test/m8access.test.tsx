import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_ACCESS_RULES, type SystemRole } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { meBody, rulesBody } from './fixtures';
import { mockApi, renderAt } from './utils';

/** Doc 11 v0.4.8, FR-ACL-14..17: Reports (View, Export) and Team & workload (View) rows. */
afterEach(() => vi.unstubAllGlobals());

const row = (name: string) => screen.getByText(name, { selector: 'code' }).closest('tr')!;
const box = (r: HTMLElement, label: RegExp) => within(r).getByRole('checkbox', { name: label });

function adminApi() {
  return mockApi((url, init) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: meBody('ADMIN') };
    if (url.includes('/access-rules/') && init?.method === 'PUT')
      return { status: 200, body: { rules: rulesBody(2).roles[1] } };
    if (url.endsWith('/access-rules')) return { status: 200, body: rulesBody() };
    return { status: 200, body: { items: [] } };
  });
}

describe('FR-ACL-14: the grid stays View/Create/Edit/Delete', () => {
  it('new rows show n/a for Create, Edit, Delete; Export sits under View on Reports only', async () => {
    adminApi();
    renderAt('/access-rules', <App />);
    await screen.findByText('workload', { selector: 'code' });
    const headers = within(document.querySelector('thead')!)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Record type', 'View', 'Create', 'Edit', 'Delete', 'Scope (fixed)']);
    const reports = row('reports');
    const workload = row('workload');
    expect(within(reports).getByText('Reports')).toBeInTheDocument();
    expect(within(workload).getByText('Team & workload')).toBeInTheDocument();
    expect(within(reports).getAllByText('n/a')).toHaveLength(3);
    expect(within(workload).getAllByText('n/a')).toHaveLength(3);
    // PM defaults reproduce today: Reports View + Export, Team & workload View.
    expect(box(reports, /^View Reports$/)).toBeChecked();
    expect(box(reports, /^Export Reports$/)).toBeChecked();
    expect(box(workload, /^View Team & workload$/)).toBeChecked();
    expect(within(workload).queryByRole('checkbox', { name: /Export/ })).not.toBeInTheDocument();
  });

  it('FR-ACL-15: turning View off also unticks Export, and the save sends both', async () => {
    const fetchMock = adminApi();
    renderAt('/access-rules', <App />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Member' }));
    await userEvent.click(box(row('reports'), /^View Reports$/));
    expect(box(row('reports'), /^View Reports$/)).not.toBeChecked();
    expect(box(row('reports'), /^Export Reports$/)).not.toBeChecked();
    expect(box(row('reports'), /^Export Reports$/)).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]?.body)).permissions).toEqual({
      reports: { view: false, create: false, edit: false, delete: false, export: false },
    });
  });

  it('Admin is locked full on both rows', async () => {
    adminApi();
    renderAt('/access-rules', <App />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Admin' }));
    for (const [r, label] of [
      ['reports', /^View Reports \(locked\)$/],
      ['reports', /^Export Reports \(locked\)$/],
      ['workload', /^View Team & workload \(locked\)$/],
    ] as const) {
      expect(box(row(r), label)).toBeChecked();
      expect(box(row(r), label)).toBeDisabled();
    }
  });
});

function asRole(role: SystemRole, patch: (p: typeof DEFAULT_ACCESS_RULES.ADMIN) => void) {
  const perms = structuredClone(DEFAULT_ACCESS_RULES[role]);
  patch(perms);
  return mockApi((url) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: meBody(role, perms) };
    if (url.includes('/reports/effort-variance'))
      return {
        status: 200,
        body: {
          items: [
            {
              id: 'k1',
              name: 'Kickoff',
              project: { id: 'p1', name: 'SAP Rollout' },
              client: { id: 'c1', name: 'Acme' },
              owner: { id: 'u2', name: 'Maria Member' },
              status: 'IN_PROGRESS',
              estHours: 8,
              actualHours: 12,
              variance: 4,
              overrunPct: 50,
            },
          ],
        },
      };
    return { status: 200, body: { items: [] } };
  });
}

describe('FR-ACL-16: the menu and buttons follow the permissions', () => {
  it('without the permissions the menu hides Reports and Team & workload and the pages are 403', async () => {
    asRole('PROJECT_MANAGER', (p) => {
      p.reports.view = false;
      p.reports.export = false;
      p.workload.view = false;
    });
    const view = renderAt('/reports', <App />);
    expect(await screen.findByText('403')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team & workload' })).not.toBeInTheDocument();
    // The dashboard is part of Reports View too.
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    view.unmount();
    renderAt('/workload', <App />);
    expect(await screen.findByText('403')).toBeInTheDocument();
  });

  it('Team & workload only shows with its own permission', async () => {
    asRole('MEMBER', (p) => {
      p.reports.view = false;
      p.reports.export = false;
    });
    renderAt('/my-tasks', <App />);
    expect(await screen.findByRole('link', { name: 'Team & workload' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });

  it('Reports View without Export has no Export CSV button', async () => {
    asRole('MEMBER', (p) => {
      p.reports.export = false;
    });
    renderAt('/reports', <App />);
    expect(await screen.findByText('Kickoff')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument();
  });

  it('with Export, the CSV rows come from the audited export route', async () => {
    const fetchMock = asRole('MEMBER', () => undefined);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    renderAt('/reports', <App />);
    expect(await screen.findByText('Kickoff')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes('/reports/effort-variance/export')),
      ).toBe(true),
    );
  });
});
