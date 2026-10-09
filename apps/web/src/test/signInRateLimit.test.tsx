import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { mockApi, renderAt } from './utils';

const RATE_LIMITED = 'Too many sign-in attempts. Please wait 15 minutes and try again.';
const limited = {
  status: 429,
  body: { error: { code: 'RATE_LIMITED', message: 'Too many attempts (server text).' } },
};
const unauth = { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } };

afterEach(() => vi.unstubAllGlobals());

describe('Rate-limited sign-in (DEF-002, NFR-05)', () => {
  it('shows the 429 message in the sign-in error spot', async () => {
    mockApi((url) => (url.endsWith('/auth/login') ? limited : unauth));
    renderAt('/login', <App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'maria@xceler8.example');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const alert = await screen.findByText(RATE_LIMITED);
    expect(alert).toHaveAttribute('role', 'alert');
  });

  it('shows the 429 message when setting a password is rate limited', async () => {
    window.location.hash = '#token=abcdefghijklmnopqrstuvwxyz0123456789';
    mockApi((url) => {
      if (url.endsWith('/auth/invite/verify'))
        return {
          status: 200,
          body: { name: 'New Person', email: 'new@xceler8.example', purpose: 'INVITE' },
        };
      if (url.endsWith('/auth/setup-password')) return limited;
      return unauth;
    });
    renderAt('/setup-password', <App />);
    await screen.findByText(/Welcome, New Person/);
    await userEvent.type(screen.getByLabelText('New password'), 'Good-pass-42!');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Good-pass-42!');
    await userEvent.click(screen.getByRole('button', { name: 'Set password & continue' }));
    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
    window.location.hash = '';
  });

  it('shows the 429 message when verifying the link is rate limited', async () => {
    window.location.hash = '#token=abcdefghijklmnopqrstuvwxyz0123456789';
    mockApi((url) => (url.endsWith('/auth/invite/verify') ? limited : unauth));
    renderAt('/setup-password', <App />);
    expect(await screen.findByText(RATE_LIMITED)).toBeInTheDocument();
    window.location.hash = '';
  });
});
