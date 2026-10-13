import { screen, within } from '@testing-library/react';
import {
  DEFAULT_ACCESS_RULES,
  activityInUseMessage,
  myTasksTabsFor,
  resolveMyTasksTab,
  setGrant,
  type MyTaskDto,
  type PermissionGrid,
} from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { meBody } from './fixtures';
import { mockApi, renderAt } from './utils';

/** m8-polish (doc 14 v1.2.5): Setup hiding, tab fallback, Planned column, buttons, messages. */
afterEach(() => vi.unstubAllGlobals());

const grid = (base: PermissionGrid, offs: [string, string][]) =>
  offs.reduce((g, [r, a]) => setGrant(g, r as never, a as never, false), structuredClone(base));

const task = (over: Partial<MyTaskDto>): MyTaskDto => ({
  id: 't1',
  name: 'Configure GL',
  project: { id: 'p1', name: 'Rollout' },
  phase: null,
  role: 'ASSIGNEE',
  dueDate: '2026-10-20',
  overdue: false,
  daysLate: 0,
  estHours: null,
  actualHours: 0,
  status: 'TODO',
  party: 'INTERNAL',
  plannedStart: '2026-10-15',
  section: null,
  ageDays: null,
  ...over,
});

function api(perms: PermissionGrid, items: MyTaskDto[] = []) {
  return mockApi((url) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: meBody('MEMBER', perms) };
    if (url.includes('/tasks/mine'))
      return {
        status: 200,
        body: {
          items,
          today: '2026-10-13',
          holiday: null,
          counts: {
            today: 0,
            due: 0,
            overdue: 0,
            dueThisWeek: 0,
            toReview: 0,
            assigned: items.length,
            accountable: 0,
          },
        },
      };
    return { status: 200, body: { items: [] } };
  });
}

describe('shared helpers', () => {
  it('FR-TSK-28: tab keys by permission and next-allowed-to-the-right with wrap', () => {
    expect(myTasksTabsFor(DEFAULT_ACCESS_RULES.VIEWER)).toEqual([
      'due',
      'assigned',
      'accountable',
      'completed',
    ]);
    expect(resolveMyTasksTab('day-timesheet', ['due', 'completed'])).toBe('due');
    expect(resolveMyTasksTab('completed', ['today'])).toBe('today');
    expect(resolveMyTasksTab('nope', ['assigned'])).toBe('assigned');
    expect(resolveMyTasksTab(null, [])).toBeNull();
  });

  it('FR-PRJ-21: ACTIVITY_IN_USE message in fixed order, no Oxford comma', () => {
    expect(activityInUseMessage(['time'])).toBe("Can't delete: this activity has logged time.");
    expect(activityInUseMessage(['issues', 'time', 'documents'])).toBe(
      "Can't delete: this activity has logged time, documents and issues.",
    );
  });
});

describe('FR-NAV-01: Setup group hides when no child is allowed', () => {
  it('shows Setup with the allowed items only, and hides it when none', async () => {
    const none = grid(DEFAULT_ACCESS_RULES.MEMBER, [
      ['templates', 'view'],
      ['clients', 'view'],
      ['workload', 'view'],
      ['reports', 'view'],
    ]);
    api(none);
    const { unmount } = renderAt('/my-tasks', <App />);
    await screen.findByRole('navigation', { name: 'Main navigation' }).catch(() => null);
    await screen.findAllByText('My tasks');
    expect(screen.queryByText('Setup')).not.toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    api(grid(none, []).templates ? setGrant(none, 'clients', 'view', true) : none);
    renderAt('/my-tasks', <App />);
    await screen.findAllByText('My tasks');
    expect(screen.getByText('Setup')).toBeInTheDocument();
    const nav = screen.getByLabelText('Main navigation');
    expect(within(nav).getByText('Clients')).toBeInTheDocument();
    expect(within(nav).queryByText('Templates')).not.toBeInTheDocument();
  });
});

describe('FR-TSK-28..30: My tasks tabs', () => {
  it('a Viewer without time.view lands on Due; Today and Day timesheet are hidden', async () => {
    api(DEFAULT_ACCESS_RULES.VIEWER);
    renderAt('/my-tasks', <App />);
    expect(await screen.findByRole('button', { name: /^Due/ })).toHaveClass('active');
    expect(screen.queryByRole('button', { name: /^Today/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Day timesheet' })).not.toBeInTheDocument();
  });

  it('a denied deep link opens the next allowed tab with a notice', async () => {
    api(DEFAULT_ACCESS_RULES.VIEWER);
    renderAt('/my-tasks?tab=day-timesheet', <App />);
    expect(await screen.findByText("You don't have access to that view.")).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Due/ })).toHaveClass('active');
  });

  it('no allowed tab: My tasks is not in the menu and its URL is Not found', async () => {
    api(
      grid(DEFAULT_ACCESS_RULES.VIEWER, [
        ['tasks', 'view'],
        ['time', 'view'],
      ]),
    );
    renderAt('/my-tasks', <App />);
    expect(await screen.findByText(/couldn.t find that page/)).toBeInTheDocument();
    const nav = screen.getByLabelText('Main navigation');
    expect(within(nav).queryByText('My tasks')).not.toBeInTheDocument();
  });
});

describe('FR-TSK-26/27, AC-48.3: Planned column', () => {
  it('Assigned to me reads Task, Project, Role, Planned, Due, Est. / actual, Status; blank when empty', async () => {
    api(DEFAULT_ACCESS_RULES.MEMBER, [
      task({}),
      task({ id: 't2', name: 'No plan', plannedStart: null }),
    ]);
    renderAt('/my-tasks?tab=assigned', <App />);
    await screen.findByText('No plan');
    const headers = within(document.querySelector('thead')!)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      'Task',
      'Project',
      'Role',
      'Planned',
      'Due',
      'Est. / actual',
      'Status',
    ]);
    expect(screen.getByTestId('planned-cell-t1').textContent).not.toBe('');
    expect(screen.getByTestId('planned-cell-t2')).toBeEmptyDOMElement();
    expect(screen.getByTestId('planned-cell-t2')).toHaveClass('cell-omit-empty');
  });
});

describe('FR-ACT-29: Time logging buttons', () => {
  it('shows Log task time and Add quick activity', async () => {
    api(DEFAULT_ACCESS_RULES.MEMBER);
    renderAt('/time', <App />);
    expect(await screen.findByRole('button', { name: 'Log task time' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add quick activity' })).toBeInTheDocument();
  });
});
