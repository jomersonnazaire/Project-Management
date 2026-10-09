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
  it('asks for confirmation, then sends the new email lowercased', async () => {
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
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }));
    const confirm = within(
      await screen.findByRole('dialog', { name: "Change Maria Member's email?" }),
    );
    expect(
      confirm.getByText(
        (_, el) =>
          el?.tagName === 'DIV' &&
          el.textContent ===
            "They'll sign in with maria.new@xceler8.example from now on. This signs them out on other devices and cancels any unused invite or reset links.",
      ),
    ).toBeInTheDocument();
    expect(sent).toBeNull();
    // Cancel goes back to the form with the typed value kept.
    await userEvent.click(confirm.getByRole('button', { name: 'Cancel' }));
    const form = within(await screen.findByRole('dialog'));
    expect(form.getByLabelText('Email *')).toHaveValue('Maria.New@Xceler8.example');
    await userEvent.click(form.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Change email' }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.email).toBe('maria.new@xceler8.example');
  });

  it('does not send the email or ask for confirmation when unchanged', async () => {
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
    await userEvent.click(await screen.findByRole('button', { name: 'Change email' }));
    const form = within(await screen.findByRole('dialog'));
    expect(await form.findByText('Another user already has this email.')).toBeInTheDocument();
    expect(form.getByLabelText('Email *')).toHaveClass('is-invalid');
  });
});
