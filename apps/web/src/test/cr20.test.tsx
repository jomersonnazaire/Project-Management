import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FollowUpDto } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { followUpBadgeLabel } from '../lib/followUps';
import { ME_PM, PID, api, project, task, type Route } from './m2fixtures';
import { renderAt } from './utils';

/** CR-20: My tasks # column (FR-TSK-35) and the follow-up badge with per-user seen state (FR-NTF-09..13). */
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

const myTask = (over: Record<string, unknown>) => ({
  id: 'k1',
  name: 'Kickoff',
  project: { id: PID, name: 'SAP B1 Rollout' },
  phase: null,
  role: 'ASSIGNEE',
  dueDate: '2026-10-09',
  overdue: false,
  daysLate: 0,
  estHours: 8,
  actualHours: 0,
  status: 'IN_PROGRESS',
  party: 'INTERNAL',
  plannedStart: '2026-10-09',
  section: null,
  ageDays: null,
  followUps: 0,
  followUpsUnseen: 0,
  ...over,
});

type Item = ReturnType<typeof myTask>;

/** Serves /tasks/mine per tab; `q` filters by name like the server does. */
const mine =
  (byView: Record<string, Item[]>): Route =>
  (url) => {
    if (!url.includes('/tasks/mine')) return undefined;
    const params = new URL(url, 'http://x').searchParams;
    const q = (params.get('q') ?? '').toLowerCase();
    const items = (byView[params.get('view') ?? 'today'] ?? []).filter((t) =>
      t.name.toLowerCase().includes(q),
    );
    return {
      status: 200,
      body: {
        items,
        today: '2026-10-09',
        holiday: null,
        counts: {
          today: (byView.today ?? []).length,
          due: (byView.due ?? []).length,
          overdue: 0,
          dueThisWeek: 0,
          toReview: 0,
          assigned: (byView.assigned ?? []).length,
          accountable: 0,
        },
      },
    };
  };

/** The # cells of the table rows, in DOM order across every table on the tab. */
const indexes = () =>
  [...document.querySelectorAll('tbody td.cell-index')].map((td) => td.textContent);

describe('My tasks # column (CR-20 FR-TSK-35)', () => {
  it('Today: a muted, unsortable # first column counting on from Planned into Aging', async () => {
    api(
      'MEMBER',
      mine({
        today: [
          myTask({ id: 'p1', name: 'Plan A', section: 'PLANNED' }),
          myTask({ id: 'p2', name: 'Plan B', section: 'PLANNED' }),
          myTask({ id: 'a1', name: 'Old A', section: 'AGING', ageDays: 3 }),
          myTask({ id: 'a2', name: 'Old B', section: 'AGING', ageDays: 9 }),
          myTask({ id: 'a3', name: 'Old C', section: 'AGING', ageDays: 20 }),
        ],
      }),
    );
    renderAt('/my-tasks', <App />);
    await screen.findByText('Old C');
    expect(indexes()).toEqual(['1', '2', '3', '4', '5']);
    expect(within(screen.getByTestId('aging-a1')).getByText('3')).toHaveClass(
      'cell-index',
      'text-body-secondary',
    );
    // Phone cards: "#3" before the title (hidden from md up).
    expect(within(screen.getByTestId('aging-a1')).getByText('#3')).toHaveClass(
      'task-index',
      'd-md-none',
    );
    for (const th of document.querySelectorAll('th.cell-index')) {
      expect(th).toHaveTextContent('#');
      expect(th.querySelector('button')).toBeNull();
      expect(th).not.toHaveAttribute('aria-sort');
    }
    // Quick activities and the checklist's own #order are not this column.
    expect(document.querySelectorAll('th.cell-index')).toHaveLength(2);
  });

  it('Due: Overdue 1–3, then Due today 4; restarts per tab; follows the server search', async () => {
    api(
      'MEMBER',
      mine({
        due: [
          myTask({ id: 'o1', name: 'Late one', overdue: true, daysLate: 3 }),
          myTask({ id: 'o2', name: 'Late two', overdue: true, daysLate: 2 }),
          myTask({ id: 'o3', name: 'Late three', overdue: true, daysLate: 1 }),
          myTask({ id: 'd1', name: 'Due now' }),
        ],
        assigned: [
          myTask({ id: 'x1', name: 'Alpha setup' }),
          myTask({ id: 'x2', name: 'Beta setup' }),
          myTask({ id: 'x3', name: 'Alpha review' }),
        ],
      }),
    );
    renderAt('/my-tasks?tab=due', <App />);
    await screen.findByText('Due now');
    expect(indexes()).toEqual(['1', '2', '3', '4']);
    expect(within(screen.getByTestId('due-d1')).getByText('#4')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Assigned to me/ }));
    await screen.findByText('Beta setup');
    expect(indexes()).toEqual(['1', '2', '3']);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'alpha');
    await waitFor(() => expect(screen.queryByText('Beta setup')).not.toBeInTheDocument());
    // Alpha review was row 3; in the filtered list it is row 2.
    expect(indexes()).toEqual(['1', '2']);
    expect(within(screen.getByTestId('row-x3')).getByText('2')).toHaveClass('cell-index');
  });
});

describe('Follow-up badge (CR-20 FR-NTF-09..13)', () => {
  it('labels: total, plus how many are new', () => {
    expect(followUpBadgeLabel(3, 1)).toBe('3 follow-ups, 1 new');
    expect(followUpBadgeLabel(1, 0)).toBe('1 follow-up');
    expect(followUpBadgeLabel(2, 2)).toBe('2 follow-ups, 2 new');
  });

  it('My tasks: amber with a dot when new, grey when seen, none at 0; links to the follow-ups', async () => {
    api(
      'MEMBER',
      mine({
        assigned: [
          myTask({ id: 'n1', name: 'Has new', followUps: 3, followUpsUnseen: 1 }),
          myTask({ id: 's1', name: 'All seen', followUps: 1, followUpsUnseen: 0 }),
          myTask({ id: 'z1', name: 'No follow-ups' }),
        ],
      }),
    );
    renderAt('/my-tasks?tab=assigned', <App />);
    await screen.findByText('No follow-ups');
    const fresh = screen.getByRole('link', { name: '3 follow-ups, 1 new' });
    expect(fresh).toHaveClass('badge', 'rounded-pill', 'followup-badge', 'bg-label-warning');
    expect(fresh).toHaveAttribute('href', `/projects/${PID}?task=n1&focus=follow-ups`);
    expect(fresh.querySelector('.followup-dot')).not.toBeNull();
    // Right after the title link, before anything else in the cell.
    expect(fresh.previousElementSibling).toHaveTextContent('Has new');
    const seen = screen.getByRole('link', { name: '1 follow-up' });
    expect(seen).toHaveClass('bg-label-secondary');
    expect(seen.querySelector('.followup-dot')).toBeNull();
    expect(within(screen.getByTestId('row-z1')).queryByTestId('follow-up-badge')).toBeNull();
  });

  const fu = (id: string, author: string, at: string): FollowUpDto => ({
    id,
    note: `Note ${id}`,
    author: { id: author, name: author === ME_PM ? 'Me PM' : 'Maria Member' },
    contact: null,
    at,
    emailedAt: null,
  });

  it('checklist: badge after the title; opening it marks seen, greys the badge and flags the new ones', async () => {
    const followUps = [
      fu('f1', 'u2', '2026-10-01T01:00:00Z'),
      fu('f2', ME_PM, '2026-10-02T01:00:00Z'),
      fu('f3', 'u2', '2026-10-03T01:00:00Z'),
    ];
    let seen = false;
    const current = () => task({ followUps, followUpsUnseen: seen ? 0 : 1 });
    const fetchMock = api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith('/tasks/k1/follow-ups/seen') && init?.method === 'POST') {
        seen = true;
        return { status: 200, body: { followUps: 3, followUpsUnseen: 0 } };
      }
      if (url.includes(`/projects/${PID}/tasks`))
        return { status: 200, body: { items: [current()] } };
      if (url.endsWith('/tasks/k1')) return { status: 200, body: { task: current() } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
      return undefined;
    });
    const { router } = renderAt(`/projects/${PID}`, <App />);
    const badge = await screen.findByRole('button', { name: '3 follow-ups, 1 new' });
    expect(badge).toHaveClass('bg-label-warning');
    const seenCalls = () =>
      fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/follow-ups/seen')).length;
    expect(seenCalls()).toBe(0);

    await userEvent.click(badge);
    await waitFor(() => expect(router.state.location.search).toBe('?task=k1&focus=follow-ups'));
    await waitFor(() => expect(seenCalls()).toBe(1));
    expect(await screen.findByRole('button', { name: '3 follow-ups' })).toHaveClass(
      'bg-label-secondary',
    );
    // Only the newest one by someone else was new; mine and the older one are not flagged.
    const newest = await screen.findByText('Note f3');
    expect(newest.closest('li')).toHaveClass('followup-new');
    expect(within(newest.closest('li')!).getByText('New')).toHaveClass('badge', 'bg-label-warning');
    expect(screen.getByText('Note f1').closest('li')).not.toHaveClass('followup-new');
    expect(screen.getByText('Note f2').closest('li')).not.toHaveClass('followup-new');
  });

  it('arriving from a bell link (?task=) marks that task seen; nothing to mark posts nothing', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith('/follow-ups/seen') && init?.method === 'POST')
        return { status: 200, body: { followUps: 1, followUpsUnseen: 0 } };
      if (url.endsWith('/tasks/k1'))
        return {
          status: 200,
          body: {
            task: task({ followUps: [fu('f1', 'u2', '2026-10-01T01:00:00Z')], followUpsUnseen: 1 }),
          },
        };
      if (url.endsWith('/tasks/k2'))
        return {
          status: 200,
          body: { task: task({ id: 'k2', followUps: [], followUpsUnseen: 0 }) },
        };
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [] } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
      return undefined;
    });
    const posts = (id: string) =>
      fetchMock.mock.calls.filter(
        ([u, i]) => String(u).endsWith(`/tasks/${id}/follow-ups/seen`) && i?.method === 'POST',
      ).length;
    const first = renderAt(`/projects/${PID}?task=k1&focus=follow-ups`, <App />);
    await waitFor(() => expect(posts('k1')).toBe(1));
    first.unmount();
    renderAt(`/projects/${PID}?task=k2`, <App />);
    await screen.findByRole('heading', { name: /Follow-ups/ });
    expect(posts('k2')).toBe(0);
  });
});
