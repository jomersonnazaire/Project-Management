import { screen } from '@testing-library/react';
import { myTasksTabsFor, DEFAULT_ACCESS_RULES } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { meBody } from './fixtures';
import { mockApi, renderAt } from './utils';

/** Q-70 option B (doc 14 FR-ACT-35, AC-56.1, EC-111): Viewers have no time or tracker. */
afterEach(() => vi.unstubAllGlobals());

function viewerApi() {
  return mockApi((url) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: meBody('VIEWER') };
    if (url.includes('/tasks/mine'))
      return { status: 200, body: { items: [], today: '2026-10-13', counts: {} } };
    return { status: 200, body: { items: [] } };
  });
}

describe('AC-56.1: Viewer has no Time or Tracker in the web app', () => {
  it('My tasks tabs leave out day-timesheet for Viewers', () => {
    expect(myTasksTabsFor(DEFAULT_ACCESS_RULES.VIEWER)).not.toContain('day-timesheet');
    expect(myTasksTabsFor(DEFAULT_ACCESS_RULES.MEMBER)).toContain('day-timesheet');
  });

  it('menu hides Time logging and the DAR but keeps Leave', async () => {
    viewerApi();
    renderAt('/projects', <App />);
    expect(await screen.findByRole('link', { name: /Leave/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Time logging/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Daily Accomplishment Report/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /My saved reports/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Time out/ })).not.toBeInTheDocument();
  });

  for (const path of ['/time', '/dar', '/dar/saved', '/timesheets/review']) {
    it(`opening ${path} shows the no-access page, not an error`, async () => {
      viewerApi();
      renderAt(path, <App />);
      expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Log task time' })).not.toBeInTheDocument();
    });
  }

  it('EC-111: My tasks shows no Logged this week, Add quick activity, Day timesheet or time calls', async () => {
    const fetchMock = viewerApi();
    renderAt('/my-tasks', <App />);
    expect(await screen.findByText('Overdue')).toBeInTheDocument();
    expect(screen.queryByText('Logged this week')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add quick activity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Day timesheet/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Time in/)).not.toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => /\/time(\?|$)/.test(u) || u.includes('/tracker/'))).toBe(false);
  });
});
