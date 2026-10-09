import { screen, waitFor, within } from '@testing-library/react';
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
  status: 'ACTIVE',
  active: true,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

function setup(patch: (body: Record<string, unknown>) => { status: number; body?: unknown }) {
  return mockApi((url, init) => {
    if (url.endsWith('/auth/me'))
      return { status: 200, body: { user: user({ id: 'me', systemRole: 'ADMIN', name: 'Ada' }) } };
    if (url.endsWith('/users/u1') && init?.method === 'PATCH')
      return patch(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (url.includes('/users'))
      return { status: 200, body: { items: [user()], page: 1, pageSize: 100, total: 1 } };
    return { status: 200, body: { items: [] } };
  });
}

async function openEdit() {
  renderAt('/admin/users', <App />);
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Maria Member' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  return within(await screen.findByRole('dialog'));
}

describe('Admin edits a user email', () => {
  it('sends the new email lowercased and warns that sessions end', async () => {
    let sent: Record<string, unknown> | null = null;
    setup((body) => {
      sent = body;
      return { status: 200, body: { user: user({ email: String(body.email) }) } };
    });
    const dialog = await openEdit();
    const email = dialog.getByLabelText('Email *');
    expect(email).toHaveValue('member@xceler8.example');
    await userEvent.clear(email);
    await userEvent.type(email, 'Maria.New@Xceler8.example');
    expect(dialog.getByText(/same password\. Their open sessions end/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.email).toBe('maria.new@xceler8.example');
  });

  it('does not send the email when unchanged', async () => {
    let sent: Record<string, unknown> | null = null;
    setup((body) => {
      sent = body;
      return { status: 200, body: { user: user() } };
    });
    const dialog = await openEdit();
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!).not.toHaveProperty('email');
  });

  it('shows a format error and the 409 field error under Email', async () => {
    const fetchMock = setup(() => ({
      status: 409,
      body: {
        error: {
          code: 'EMAIL_IN_USE',
          message: 'Email already in use',
          details: [{ path: 'email', message: 'Another user already has this email.' }],
        },
      },
    }));
    const dialog = await openEdit();
    const email = dialog.getByLabelText('Email *');
    await userEvent.clear(email);
    await userEvent.type(email, 'not-an-email');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false);

    await userEvent.clear(email);
    await userEvent.type(email, 'taken@xceler8.example');
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByText('Another user already has this email.')).toBeInTheDocument();
    expect(email).toHaveClass('is-invalid');
  });
});
