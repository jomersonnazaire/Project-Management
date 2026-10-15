import { screen, waitFor, within } from '@testing-library/react';
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE, BRAND } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { api } from './m2fixtures';
import { mockApi, renderAt } from './utils';

/** Branding comes from packages/shared/src/brand.ts everywhere the name shows. */
afterEach(() => vi.unstubAllGlobals());
const unauth = { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } };

describe('Branding', () => {
  it('the app is OpsTrack with the Ops Pulse lockup (confirmed 2026-10-10)', () => {
    expect(APP_NAME).toBe('OpsTrack');
    expect(BRAND.lockup).toBe(true);
  });

  it('sign-in shows the brand and names the browser tab', async () => {
    mockApi(() => unauth);
    renderAt('/login', <App />);
    expect(
      await screen.findByRole('heading', { name: `Sign in to ${APP_NAME}` }),
    ).toBeInTheDocument();
    if (BRAND.lockup) {
      expect(screen.getByAltText(`${APP_NAME} ${APP_TAGLINE}`)).toHaveAttribute(
        'src',
        '/brand/logo.svg',
      );
    } else {
      expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    }
    await waitFor(() => expect(document.title).toBe(`${APP_NAME} – Sign in`));
  });

  it('the invite screen shows the brand too', async () => {
    mockApi((url, init) =>
      url.endsWith('/auth/invite/verify') && init?.method === 'POST'
        ? {
            status: 200,
            body: {
              name: 'Maria',
              email: 'maria@x.example',
              purpose: 'INVITE',
              invitedByName: null,
            },
          }
        : unauth,
    );
    window.location.hash = '#token=abcdefghijklmnopqrstuvwxyz0123456789';
    renderAt('/setup-password', <App />);
    expect(await screen.findByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
    expect(
      await screen.findByText(`Welcome to ${APP_NAME}, Maria.`, { exact: false }),
    ).toBeInTheDocument();
    if (BRAND.lockup)
      expect(screen.getByAltText(`${APP_NAME} ${APP_TAGLINE}`)).toHaveAttribute(
        'src',
        '/brand/logo.svg',
      );
    else expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(`${APP_NAME} – Set your password`));
  });

  it('the sidebar brand and page titles use the constant', async () => {
    api('MEMBER', () => undefined);
    renderAt('/my-tasks', <App />);
    const menu = await screen.findByRole('complementary', { name: 'Main navigation' });
    if (BRAND.lockup)
      expect(within(menu).getByAltText(`${APP_NAME} ${APP_TAGLINE}`)).toHaveAttribute(
        'src',
        '/brand/logo.svg',
      );
    else expect(within(menu).getByText(APP_SHORT_NAME)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(`${APP_NAME} – My tasks`));
    expect(screen.getByTestId('app-footer')).toHaveTextContent('OpsTrack · by Jomerson & Grok');
  });
});
