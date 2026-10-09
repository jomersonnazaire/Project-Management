import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { api } from './m2fixtures';
import { renderAt } from './utils';

/** NFR-26: non-production deploys show a "Staging" badge next to the page title; production never. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function topbarTitle() {
  api('ADMIN', (url) =>
    url.includes('/clients') ? { status: 200, body: { items: [] } } : undefined,
  );
  renderAt('/clients', <App />);
  return screen.findByRole('heading', { level: 1, name: 'Clients' });
}

describe('Staging badge (NFR-26)', () => {
  it.each(['preview', 'development'])(
    'shows on a %s build, next to the page title',
    async (env) => {
      vi.stubEnv('VITE_APP_ENV', env);
      const title = await topbarTitle();
      const badge = screen.getByTestId('env-badge');
      expect(badge).toHaveTextContent('Staging');
      expect(badge).toHaveClass('badge', 'bg-label-warning');
      // Same top-bar group as the title slot.
      expect(badge.parentElement).toContainElement(title);
    },
  );

  it('never shows on a production build, and the title slot keeps its production layout', async () => {
    vi.stubEnv('VITE_APP_ENV', 'production');
    const title = await topbarTitle();
    expect(screen.queryByTestId('env-badge')).not.toBeInTheDocument();
    expect(screen.queryByText('Staging')).not.toBeInTheDocument();
    expect(title.parentElement).toHaveClass('topbar-title', 'flex-grow-1', 'min-w-0');
  });
});
