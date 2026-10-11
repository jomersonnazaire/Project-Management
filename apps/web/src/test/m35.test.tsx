import { DEFAULT_ACCESS_RULES, type TimeWeekDto } from '@xc8/shared';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { meBody } from './fixtures';
import { PID, api, project } from './m2fixtures';
import { mockApi, renderAt } from './utils';

/** Milestone 3.5 first push: DR-13, DR-17 and Members deleting their own time. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

const week: TimeWeekDto = {
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
  total: 2,
  capacity: 40,
  items: [
    {
      id: 'e1',
      user: { id: 'me-MEMBER', name: 'Me MEMBER' },
      project: { id: PID, name: 'SAP B1 Rollout' },
      task: { id: 'k1', name: 'Kickoff' },
      workDate: '2026-10-06',
      hours: 2,
      minutes: 120,
      timed: false,
      activityType: null,
      module: null,
      billable: true,
      type: 'EXECUTION',
      notes: null,
      locked: false,
      createdAt: '2026-10-06T01:00:00Z',
    },
  ],
};

describe('Access rules v0.6.8: Members delete their own time entries', () => {
  it('a Member sees Delete on their own entry with the new default grid', async () => {
    api('MEMBER', (url) => (url.endsWith('/time') ? { status: 200, body: week } : undefined));
    renderAt('/time', <App />);
    expect(
      await screen.findByRole('button', { name: /^Delete \d\d:\d\d on Kickoff/ }),
    ).toBeInTheDocument();
  });

  it('when an Admin has kept Delete off for Members, the button is hidden', async () => {
    const grid = structuredClone(DEFAULT_ACCESS_RULES.MEMBER);
    grid.time.delete = false;
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: meBody('MEMBER', grid) };
      if (url.endsWith('/time')) return { status: 200, body: week };
      return { status: 200, body: { items: [] } };
    });
    renderAt('/time', <App />);
    expect(await screen.findByText('Kickoff')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
  });
});

describe('Design review', () => {
  it('DR-13: the Timeline placeholder has no "planned for Milestone 3" line', async () => {
    api('PROJECT_MANAGER', (url) =>
      url.endsWith(`/projects/${PID}`) ? { status: 200, body: { project: project() } } : undefined,
    );
    renderAt(`/projects/${PID}/timeline`, <App />);
    expect(
      await screen.findByText('The timeline is coming in a later milestone'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/planned for Milestone/)).not.toBeInTheDocument();
  });

  it('DR-17: "+ Add holiday" sits in the page header, not the year toolbar', async () => {
    api('ADMIN', (url) =>
      url.includes('/settings/calendar')
        ? {
            status: 200,
            body: {
              workingDays: [1, 2, 3, 4, 5],
              version: 1,
              year: 2026,
              holidays: [
                {
                  id: 'h1',
                  date: '2026-12-25',
                  name: 'Christmas Day',
                  type: 'REGULAR',
                  note: null,
                },
              ],
            },
          }
        : undefined,
    );
    renderAt('/admin/holidays', <App />);
    const topbar = await screen.findByRole('navigation', { name: 'Top bar' });
    expect(
      await within(topbar).findByRole('button', { name: '+ Add holiday' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '+ Add holiday' })).toHaveLength(1);
  });
});
