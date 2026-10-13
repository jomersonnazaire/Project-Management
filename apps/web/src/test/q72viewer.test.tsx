import { screen } from '@testing-library/react';
import { DEFAULT_ACCESS_RULES } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { meBody } from './fixtures';
import { mockApi, renderAt } from './utils';

/** Q-72 No (doc 14 FR-ACT-35, AC-56.1, EC-113): Viewers have no leave access. */
afterEach(() => vi.unstubAllGlobals());

function apiAs(role: 'VIEWER' | 'MEMBER') {
  return mockApi((url) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: meBody(role) };
    return { status: 200, body: { items: [] } };
  });
}

describe('AC-56.1: Viewer has no Leave in the web app', () => {
  it('Viewer default leave is all false', () => {
    expect(DEFAULT_ACCESS_RULES.VIEWER.leave).toMatchObject({
      view: false,
      create: false,
      edit: false,
      delete: false,
    });
  });

  it('menu hides Leave for a Viewer and keeps it for a Member', async () => {
    apiAs('VIEWER');
    const { unmount } = renderAt('/projects', <App />);
    expect(await screen.findByRole('link', { name: /Projects/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Leave/ })).not.toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    apiAs('MEMBER');
    renderAt('/projects', <App />);
    expect(await screen.findByRole('link', { name: /^Leave/ })).toBeInTheDocument();
  });

  it('opening /leave shows the no-access page and makes no leave calls', async () => {
    const fetchMock = apiAs('VIEWER');
    renderAt('/leave', <App />);
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('/leave'))).toBe(false);
  });
});
