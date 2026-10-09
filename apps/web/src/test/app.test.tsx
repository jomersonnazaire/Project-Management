import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserDto } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { emptyDashboard } from './fixtures';
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
    // Clients replaces the old Client contacts page (FR-CLI-09); Access rules is Admin-only (Q-27).
    expect(screen.getByRole('link', { name: /^Clients/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Client contacts/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Access rules/ })).not.toBeInTheDocument();
  });

  it('an Admin opens the invite form with separate Access role and Job role fields (TC-B09)', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me'))
        return { status: 200, body: { user: user({ systemRole: 'ADMIN', name: 'Ada Admin' }) } };
      if (url.includes('/users'))
        return { status: 200, body: { items: [user()], page: 1, pageSize: 100, total: 1 } };
      return { status: 200, body: { items: [] } };
    });
    renderAt('/admin/users', <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Invite user' }));
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
    const fetchMock = mockApi((url, init) => {
      if (url.endsWith('/auth/invite/verify') && init?.method === 'POST')
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
    expect(screen.getByText('At least 8 characters').closest('li')).toHaveClass('missing');
    await userEvent.type(newPassword, 'w'); // 8 characters
    expect(screen.getByText('At least 8 characters').closest('li')).not.toHaveClass('missing');
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

  it('FR-AUTH-04/05 sends the link token only in POST bodies, never in a URL', async () => {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789';
    window.location.hash = `#token=${token}`;
    const fetchMock = mockApi((url, init) => {
      if (url.endsWith('/auth/invite/verify') && init?.method === 'POST')
        return {
          status: 200,
          body: {
            name: 'A. Reyes',
            email: 'areyes@xceler8.example',
            invitedByName: null,
            purpose: 'RESET',
          },
        };
      if (url.endsWith('/auth/setup-password') && init?.method === 'POST')
        return { status: 200, body: { user: user({ email: 'areyes@xceler8.example' }) } };
      if (url.endsWith('/auth/me'))
        return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } };
      return { status: 200, body: { items: [] } };
    });
    renderAt('/setup-password', <App />);
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New password'), 'Reset-password-1!');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Reset-password-1!');
    await userEvent.click(screen.getByRole('button', { name: 'Set password & continue' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/setup-password'))).toBe(
        true,
      ),
    );

    for (const [u] of fetchMock.mock.calls) expect(String(u)).not.toContain(token);
    const bodyOf = (path: string) => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith(path));
      expect(call?.[1]?.method).toBe('POST');
      expect((call?.[1]?.headers as Record<string, string>)['X-Requested-With']).toBe('xc8-web');
      return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
    };
    expect(bodyOf('/auth/invite/verify')).toEqual({ token });
    expect(bodyOf('/auth/setup-password')).toEqual({ token, password: 'Reset-password-1!' });
    // The token is removed from the address bar once it has been used.
    await waitFor(() => expect(window.location.hash).toBe(''));
  });

  it('ignores a token in the query string; links carry it in the fragment', async () => {
    window.history.replaceState(
      null,
      '',
      '/setup-password?token=abcdefghijklmnopqrstuvwxyz0123456789',
    );
    const fetchMock = mockApi(() => ({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'x' } },
    }));
    renderAt('/setup-password?token=abcdefghijklmnopqrstuvwxyz0123456789', <App />);
    expect(await screen.findByRole('heading', { name: 'Link not valid' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/auth/invite'))).toBe(false);
    window.history.replaceState(null, '', '/');
  });
});

describe('Admin-issued links (FR-AUTH-04/05, TC-A14)', () => {
  it('the sign-in page has no "Forgot password?" and lands on the Dashboard (AC-01.1, M4)', async () => {
    let signedIn = false;
    mockApi((url) => {
      if (url.endsWith('/auth/login')) {
        signedIn = true;
        return { status: 200, body: { user: user() } };
      }
      if (url.endsWith('/auth/me'))
        return signedIn
          ? { status: 200, body: { user: user() } }
          : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } };
      if (url.endsWith('/api/v1/dashboard')) return { status: 200, body: emptyDashboard() };
      return { status: 200, body: { items: [] } };
    });
    renderAt('/login', <App />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText(/^Forgot password\?$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Forgot/ })).not.toBeInTheDocument();
    expect(
      screen.getByText('Forgot your password? Ask an Admin for a reset link.'),
    ).toBeInTheDocument();
    expect(screen.getByText("You'll land on your Dashboard.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'member@xceler8.example');
    await userEvent.type(screen.getByLabelText('Password'), 'Secret-pass-1!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('shows "Copy reset link" for active users, "New invite link" for invited users, nothing for deactivated', async () => {
    const people = [
      user({ id: 'a1', name: 'Active Person', email: 'active@xceler8.example' }),
      user({
        id: 'i1',
        name: 'Invited Person',
        email: 'invited@xceler8.example',
        status: 'INVITED',
      }),
      user({
        id: 'd1',
        name: 'Gone Person',
        email: 'gone@xceler8.example',
        status: 'DEACTIVATED',
        active: false,
      }),
    ];
    const resetUrl =
      'http://localhost:5173/setup-password#token=reset-token-abcdefghijklmnopqrstuvwxyz';
    const fetchMock = mockApi((url, init) => {
      if (url.endsWith('/auth/me'))
        return { status: 200, body: { user: user({ id: 'me', systemRole: 'ADMIN' }) } };
      if (url.endsWith('/users/a1/invite') && init?.method === 'POST')
        return {
          status: 200,
          body: {
            user: people[0],
            inviteUrl: resetUrl,
            inviteExpiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
            purpose: 'RESET',
            replacedPrevious: true,
          },
        };
      if (url.includes('/users'))
        return { status: 200, body: { items: people, page: 1, pageSize: 100, total: 3 } };
      return { status: 200, body: { items: [] } };
    });
    renderAt('/admin/users', <App />);
    await screen.findByText('active@xceler8.example');
    expect(screen.getAllByRole('button', { name: 'Copy reset link' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'New invite link' })).toHaveLength(1);
    const goneRow = screen.getByText('gone@xceler8.example').closest('tr')!;
    expect(goneRow.textContent).not.toMatch(/reset link|invite link/);
    expect(
      screen.getByText(
        /Reset links are single use and expire in 24 hours\. Creating a new link cancels any earlier unused one\./,
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Copy reset link' }));
    const field = await screen.findByLabelText('Reset link (single use, expires in 24 hours)');
    expect(field).toHaveValue(resetUrl);
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^(Copy|Copied)$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/The previous unused link no longer works/)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) => String(u).endsWith('/users/a1/invite') && i?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('an expired, used or replaced link shows the "ask an Admin" message', async () => {
    window.location.hash = '#token=abcdefghijklmnopqrstuvwxyz0123456789';
    mockApi((url, init) =>
      url.endsWith('/auth/invite/verify') && init?.method === 'POST'
        ? {
            status: 400,
            body: {
              error: {
                code: 'INVALID_TOKEN',
                message: 'This link has expired. Ask an Admin for a new one.',
              },
            },
          }
        : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } },
    );
    renderAt('/setup-password', <App />);
    expect(
      await screen.findByText('This link has expired. Ask an Admin for a new one.'),
    ).toBeInTheDocument();
    window.location.hash = '';
  });
});
