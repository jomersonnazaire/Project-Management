import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { mockApi, renderAt } from './utils';

const unauth = { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } };
const providers = (microsoft: boolean) => (url: string) =>
  url.endsWith('/auth/providers') ? { status: 200, body: { microsoft } } : unauth;

const NO_EMAIL = /Your Microsoft account has no email address/;
const FAILED = /couldn.t sign you in with Microsoft/;
const MISMATCH = /already linked to a different Microsoft account/;
const UNVERIFIED = /Microsoft couldn.t confirm your email address/;

afterEach(() => vi.unstubAllGlobals());

describe('Microsoft sign-in on the login page', () => {
  it('shows the Microsoft button only when /auth/providers reports it enabled', async () => {
    mockApi(providers(true));
    const { unmount } = renderAt('/login', <App />);
    const link = await screen.findByRole('link', { name: 'Sign in with Microsoft' });
    expect(link).toHaveAttribute('href', '/api/auth/microsoft/login');
    unmount();

    const fetchMock = mockApi(providers(false));
    renderAt('/login', <App />);
    await screen.findByLabelText('Email');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/providers'))).toBe(true),
    );
    expect(screen.queryByRole('link', { name: 'Sign in with Microsoft' })).toBeNull();
  });

  it('shows the alert for each error the callback redirects with', async () => {
    mockApi(providers(true));
    const failed = renderAt('/login?error=ms_signin_failed', <App />);
    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText(NO_EMAIL)).toBeNull();
    failed.unmount();

    const noEmail = renderAt('/login?error=ms_no_email', <App />);
    expect(await screen.findByText(NO_EMAIL)).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
    noEmail.unmount();

    const mismatch = renderAt('/login?error=ms_account_mismatch', <App />);
    expect(await screen.findByText(MISMATCH)).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(UNVERIFIED)).toBeNull();
    mismatch.unmount();

    const unverified = renderAt('/login?error=ms_email_unverified', <App />);
    expect(await screen.findByText(UNVERIFIED)).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(MISMATCH)).toBeNull();
    unverified.unmount();

    renderAt('/login', <App />);
    await screen.findByLabelText('Email');
    expect(screen.queryByText(NO_EMAIL)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(MISMATCH)).toBeNull();
    expect(screen.queryByText(UNVERIFIED)).toBeNull();
  });
});
