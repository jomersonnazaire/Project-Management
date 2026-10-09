import { screen, waitFor } from '@testing-library/react';
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

describe('Sign in', () => {
  it('redirects signed-out users to the login page', async () => {
    mockApi(() => ({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } },
    }));
    renderAt('/admin', <App />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Client contacts don't have accounts/)).toBeInTheDocument();
  });

  it('AC-01.2 shows the generic error from the API and sends the CSRF header', async () => {
    const fetchMock = mockApi((url) =>
      url.endsWith('/auth/login')
        ? {
            status: 401,
            body: {
              error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
            },
          }
        : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } },
    );
    renderAt('/login', <App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'maria@xceler8.example');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/auth/login'));
    expect((call?.[1]?.headers as Record<string, string>)['X-Requested-With']).toBe('xc8-web');
    expect(call?.[1]?.credentials).toBe('include');
  });

  it('shows the session-expired message (AC-01.5)', async () => {
    mockApi(() => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }));
    renderAt('/login?reason=expired', <App />);
    expect(await screen.findByText(/session expired after 30 minutes/)).toBeInTheDocument();
  });
});

describe('Role-gated UI', () => {
  it('a Member opening Admin sees the 403 page and no Admin menu item', async () => {
    mockApi((url) =>
      url.endsWith('/auth/me')
        ? { status: 200, body: { user: user() } }
        : { status: 200, body: { items: [] } },
    );
    renderAt('/admin/users', <App />);
    expect(await screen.findByText('403')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Admin/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Client contacts/ })).toBeInTheDocument();
  });

  it('an Admin sees the invite form with separate Access role and Job role fields (TC-B09)', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me'))
        return { status: 200, body: { user: user({ systemRole: 'ADMIN', name: 'Ada Admin' }) } };
      if (url.includes('/users'))
        return { status: 200, body: { items: [user()], page: 1, pageSize: 100, total: 1 } };
      return { status: 200, body: { items: [] } };
    });
    renderAt('/admin/users', <App />);
    expect(await screen.findByLabelText('Access role * (what they can do)')).toBeInTheDocument();
    expect(screen.getByLabelText('Job role * (what they do)')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('member@xceler8.example')).toBeInTheDocument());
    expect(screen.getByText(/never appear here/)).toBeInTheDocument();
  });

  it('unknown routes show the 404 page inside the shell', async () => {
    mockApi((url) =>
      url.endsWith('/auth/me')
        ? { status: 200, body: { user: user() } }
        : { status: 200, body: {} },
    );
    renderAt('/does-not-exist', <App />);
    expect(await screen.findByText('404')).toBeInTheDocument();
  });
});

describe('First-time password setup', () => {
  it('checks the password rules and confirmation before submitting', async () => {
    window.location.hash = '#token=abcdefghijklmnopqrstuvwxyz0123456789';
    const fetchMock = mockApi((url) => {
      if (url.includes('/auth/invite/'))
        return {
          status: 200,
          body: {
            name: 'A. Reyes',
            email: 'areyes@xceler8.example',
            invitedByName: 'Jomerson Nazaire',
            purpose: 'INVITE',
          },
        };
      return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } };
    });
    renderAt('/setup-password', <App />);
    expect(await screen.findByText(/You were invited by Jomerson Nazaire/)).toBeInTheDocument();
    const newPassword = screen.getByLabelText('New password');
    await userEvent.type(newPassword, 'Ab1!xyz'); // 7 characters
    expect(screen.getByText('8+ characters').closest('li')).toHaveClass('missing');
    await userEvent.type(newPassword, 'w'); // 8 characters
    expect(screen.getByText('8+ characters').closest('li')).not.toHaveClass('missing');
    await userEvent.clear(newPassword);
    await userEvent.type(newPassword, 'Longpassword12');
    expect(screen.getByText(/A symbol/).closest('li')).toHaveClass('missing');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Set password & continue' }));
    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/setup-password'))).toBe(
      false,
    );
    window.location.hash = '';
  });
});
