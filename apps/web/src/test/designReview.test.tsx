import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserDto } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { mockApi, renderAt } from './utils';

const user = (over: Partial<UserDto> = {}): UserDto => ({
  id: 'u1',
  name: 'Maria Member',
  email: 'member@xceler8.example',
  systemRole: 'MEMBER',
  jobRole: 'CONSULTANT',
  teamIds: [],
  weeklyCapacityHours: 40,
  supervisorId: null,
  reportCc: [],
  status: 'ACTIVE',
  active: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('Design review M1 (DR-01..DR-04)', () => {
  const teams = [
    { id: 't1', name: 'Management', memberCount: 1 },
    { id: 't2', name: 'Consulting', memberCount: 1 },
  ];
  const adminApi = () =>
    mockApi((url) => {
      if (url.endsWith('/auth/me'))
        return { status: 200, body: { user: user({ id: 'me', systemRole: 'ADMIN' }) } };
      if (url.includes('/teams'))
        return { status: 200, body: { items: teams, page: 1, pageSize: 100, total: 2 } };
      if (url.includes('/users'))
        return {
          status: 200,
          body: {
            items: [user({ id: 'p1', name: 'Paolo PM', teamIds: ['t1', 't2'] })],
            page: 1,
            pageSize: 100,
            total: 1,
          },
        };
      return { status: 200, body: { items: [] } };
    });

  it('DR-02 puts the page title and primary action in the top bar', async () => {
    adminApi();
    renderAt('/admin/users', <App />);
    const topbar = await screen.findByRole('navigation', { name: 'Top bar' });
    expect(await within(topbar).findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(within(topbar).getByRole('button', { name: '+ Invite user' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Admin' })).toHaveLength(1);
  });

  it('DR-01 opens the invite form in a modal so the users table gets the full width', async () => {
    adminApi();
    renderAt('/admin/users', <App />);
    await screen.findByText('Paolo PM');
    expect(screen.queryByLabelText('Full name *')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Invite user' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Invite user')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Full name *')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create invite link' })).toBeInTheDocument();
    // The table is no longer squeezed into a column next to the form.
    expect(screen.getByRole('table').closest('.col-xxl-8')).toBeNull();
  });

  it('DR-03 marks the users table for stacked cards on phones, with a label per cell', async () => {
    adminApi();
    renderAt('/admin/users', <App />);
    await screen.findByText('Paolo PM');
    const table = screen.getByRole('table');
    expect(table).toHaveClass('table-stack-md');
    const row = screen.getByText('Paolo PM').closest('tr')!;
    const labels = Array.from(row.querySelectorAll('td[data-label]')).map((td) =>
      td.getAttribute('data-label'),
    );
    expect(labels).toEqual(['Access', 'Job role', 'Teams', 'Status']);
  });

  it('DR-04 joins team names as "Management, Consulting"', async () => {
    adminApi();
    renderAt('/admin/users', <App />);
    const row = (await screen.findByText('Paolo PM')).closest('tr')!;
    const teamsCell = row.querySelector('td[data-label="Teams"]')!;
    expect(teamsCell.textContent).toBe('Management, Consulting');
  });
});
