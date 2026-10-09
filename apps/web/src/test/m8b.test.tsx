import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeaveTypeDto, SystemRole } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { LOOKUPS } from './fixtures';
import { PID, api, type Route } from './m2fixtures';
import { entry, trackerDay } from './m5fixtures';
import { renderAt } from './utils';

/** M8 workforce items (doc 14 v0.9.9): FR-ACT-26/27/28, FR-LV-12/13. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T04:00:00Z'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const planned = {
  id: 't1',
  name: 'Prepare UAT scripts',
  project: { id: PID, name: 'SAP B1 Rollout' },
  phase: 'Phase 3',
  role: 'ASSIGNEE',
  section: 'PLANNED',
  plannedStart: '2026-10-09',
  dueDate: '2026-10-14',
  overdue: false,
  daysLate: 0,
  estHours: 8,
  actualHours: 0,
  status: 'TODO',
  party: 'INTERNAL',
};
const myTasks: Route = (url) =>
  url.includes('/tasks/mine')
    ? {
        status: 200,
        body: {
          items: [planned],
          today: '2026-10-09',
          holiday: null,
          counts: {
            today: 1,
            due: 0,
            overdue: 0,
            dueThisWeek: 1,
            toReview: 0,
            assigned: 1,
            accountable: 0,
          },
        },
      }
    : undefined;

function tracker(role: SystemRole, day = trackerDay(), extra: Route = () => undefined) {
  return api(role, (url, init) => {
    const x = extra(url, init);
    if (x) return x;
    if (url.endsWith('/lookups')) return { status: 200, body: LOOKUPS };
    if (url.includes('/tracker/day')) return { status: 200, body: { day } };
    if (url.includes('/tracker/running')) {
      const running = day.entries.find((e) => e.running) ?? null;
      return { status: 200, body: { entry: running, now: '2026-10-09T04:00:00.000Z' } };
    }
    if (url.includes('/tracker/people'))
      return { status: 200, body: { items: [{ id: 'me', name: 'Me' }] } };
    if (init?.method === 'POST' && url.includes('/tracker/'))
      return { status: 201, body: { entry: entry() } };
    return myTasks(url, init);
  });
}
const posts = (fetchMock: ReturnType<typeof api>, path: string) =>
  fetchMock.mock.calls
    .filter(([u, i]) => String(u).endsWith(path) && i?.method === 'POST')
    .map(([, i]) => JSON.parse(String(i?.body)));

const standUp = entry({
  id: 'r1',
  kind: 'QUICK',
  project: null,
  client: null,
  task: null,
  title: 'Weekly stand-up',
  running: true,
  endAt: null,
  minutes: 12,
});

async function openTimeIn() {
  const row = await screen.findByTestId('planned-t1');
  await userEvent.click(
    await within(row).findByRole('button', { name: 'Time in on Prepare UAT scripts' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Time in' });
  const type = within(dialog).getByLabelText('Activity type *') as HTMLSelectElement;
  if (!type.value) await userEvent.selectOptions(type, 'Configuration');
  return dialog;
}

describe('FR-ACT-26: Switch prompt', () => {
  it('asks before stopping the running timer; Switch sends switchFrom', async () => {
    const fetchMock = tracker('MEMBER', trackerDay({ entries: [standUp] }));
    renderAt('/my-tasks', <App />);
    const dialog = await openTimeIn();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    const prompt = await within(dialog).findByRole('alertdialog', { name: 'Switch timer' });
    expect(prompt).toHaveTextContent("Stop 'Weekly stand-up' and start this one?");
    expect(posts(fetchMock, '/tracker/start')).toHaveLength(0);
    await userEvent.click(within(prompt).getByRole('button', { name: 'Switch' }));
    await waitFor(() =>
      expect(posts(fetchMock, '/tracker/start')).toEqual([
        expect.objectContaining({ taskId: 't1', switchFrom: 'r1' }),
      ]),
    );
  });

  it('Cancel keeps the running timer and sends nothing', async () => {
    const fetchMock = tracker('MEMBER', trackerDay({ entries: [standUp] }));
    renderAt('/my-tasks', <App />);
    const dialog = await openTimeIn();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    const prompt = await within(dialog).findByRole('alertdialog', { name: 'Switch timer' });
    await userEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));
    expect(within(dialog).queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(posts(fetchMock, '/tracker/start')).toHaveLength(0);
  });

  it('a 409 TIMER_RUNNING from another tab opens the prompt for that timer', async () => {
    let calls = 0;
    const fetchMock = tracker('MEMBER', trackerDay(), (url, init) => {
      if (init?.method === 'POST' && url.endsWith('/tracker/start') && calls++ === 0)
        return {
          status: 409,
          body: {
            error: {
              code: 'TIMER_RUNNING',
              message: 'A timer is already running. Stop it first or switch.',
              details: { running: { id: 'x9', name: 'Data migration' } },
            },
          },
        };
      return undefined;
    });
    renderAt('/my-tasks', <App />);
    const dialog = await openTimeIn();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    const prompt = await within(dialog).findByRole('alertdialog', { name: 'Switch timer' });
    expect(prompt).toHaveTextContent("Stop 'Data migration' and start this one?");
    await userEvent.click(within(prompt).getByRole('button', { name: 'Switch' }));
    await waitFor(() => expect(posts(fetchMock, '/tracker/start')[1]?.switchFrom).toBe('x9'));
  });
});

describe('FR-ACT-28: errors under their fields', () => {
  it('shows a field error under the field and keeps the banner for other problems', async () => {
    tracker('MEMBER', trackerDay(), (url, init) =>
      init?.method === 'POST' && url.endsWith('/tracker/start')
        ? {
            status: 400,
            body: {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Some fields are invalid.',
                details: [{ path: 'notes', message: 'Remarks can be up to 500 characters.' }],
              },
            },
          }
        : undefined,
    );
    renderAt('/my-tasks', <App />);
    const dialog = await openTimeIn();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    expect(
      await within(dialog).findByText('Remarks can be up to 500 characters.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Some fields are invalid/)).not.toBeInTheDocument();
  });

  it('names a field the form does not show instead of a bare "Some fields are invalid"', async () => {
    tracker('MEMBER', trackerDay(), (url, init) =>
      init?.method === 'POST' && url.endsWith('/tracker/start')
        ? {
            status: 400,
            body: {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Some fields are invalid.',
                details: [
                  { path: 'remarks', message: "remarks isn't a field this server accepts." },
                ],
              },
            },
          }
        : undefined,
    );
    renderAt('/my-tasks', <App />);
    const dialog = await openTimeIn();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    expect(
      await within(dialog).findByText(/remarks: remarks isn't a field this server accepts\./),
    ).toBeInTheDocument();
  });
});

const VACATION: LeaveTypeDto = {
  id: '6510000000000000000000a1',
  name: 'Vacation',
  paid: true,
  unit: 'HALF_DAY',
  needsDocument: false,
  carryOverLimit: 5,
  active: true,
};

describe('FR-LV-12: leave on the Day timesheet', () => {
  it('shows a grey read-only leave row first and + Add leave opens Record leave on that date', async () => {
    tracker(
      'MEMBER',
      trackerDay({
        entries: [entry({ id: 'e1' })],
        leaveRows: [{ id: 'l1', type: 'Vacation', dayPart: 'AM', label: 'Vacation · Half day AM' }],
      }),
      (url) =>
        url.includes('/leave/types')
          ? { status: 200, body: { items: [VACATION] } }
          : url.includes('/leave/balances')
            ? { status: 200, body: { items: [] } }
            : undefined,
    );
    renderAt('/my-tasks?tab=day', <App />);
    const row = await screen.findByTestId('leave-row');
    expect(row).toHaveTextContent('Vacation · Half day AM');
    expect(row).toHaveClass('table-secondary');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    // Leave sits above the entries.
    const rows = screen.getAllByRole('row');
    expect(rows.indexOf(row)).toBeLessThan(rows.indexOf(screen.getByTestId('entry-e1')));
    const add = screen.getByRole('button', { name: '+ Add entry' });
    const addLeave = screen.getByRole('button', { name: '+ Add leave' });
    expect(add.parentElement).toBe(addLeave.parentElement);
    await userEvent.click(addLeave);
    const dialog = await screen.findByRole('dialog', { name: 'Record leave' });
    expect(within(dialog).getByLabelText('From *')).toHaveValue('2026-10-09');
  });
});

describe('FR-ACT-27: own Day timesheet only', () => {
  it('My tasks › Day timesheet has no person picker and never asks for another user', async () => {
    const fetchMock = tracker('PROJECT_MANAGER', trackerDay(), (url) =>
      url.includes('/tracker/people')
        ? {
            status: 200,
            body: {
              items: [
                { id: 'me-PROJECT_MANAGER', name: 'Me' },
                { id: 'u9', name: 'Maria Perez' },
              ],
            },
          }
        : undefined,
    );
    renderAt('/my-tasks?tab=day', <App />);
    expect(
      await screen.findByRole('link', { name: 'Review your team’s timesheets' }),
    ).toHaveAttribute('href', '/timesheets/review');
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    const dayCalls = fetchMock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes('/tracker/day'));
    expect(dayCalls.length).toBeGreaterThan(0);
    expect(dayCalls.every((u) => !u.includes('userId='))).toBe(true);
  });
});

describe('FR-LV-13: entitlement auto-save failure', () => {
  it('puts the old value back and says it could not save', async () => {
    api('ADMIN', (url, init) => {
      if (url.includes('/leave/types/all')) return { status: 200, body: { items: [VACATION] } };
      if (url.includes('/leave/entitlements') && init?.method === 'PUT')
        return {
          status: 500,
          body: { error: { code: 'INTERNAL', message: 'Something went wrong.' } },
        };
      if (url.includes('/leave/entitlements'))
        return {
          status: 200,
          body: {
            items: [
              {
                user: { id: 'u3', name: 'A. Reyes' },
                leaveTypeId: VACATION.id,
                year: 2026,
                entitlement: 10,
                carryOver: 0,
                taken: 6,
                balance: 4,
                negative: false,
              },
            ],
          },
        };
      return undefined;
    });
    renderAt('/admin/leave', <App />);
    const input = await screen.findByLabelText('A. Reyes entitlement');
    await userEvent.clear(input);
    await userEvent.type(input, '4');
    await userEvent.tab();
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText('A. Reyes entitlement')).toHaveValue(10);
  });
});

describe('DR-43: Reports filters for a Member', () => {
  it('builds Project and Client options from /reports/filters, never /clients or /projects', async () => {
    const fetchMock = api('MEMBER', (url) => {
      if (url.includes('/reports/filters'))
        return {
          status: 200,
          body: {
            projects: [{ id: 'p1', name: 'SAP B1 Rollout' }],
            clients: [{ id: 'c1', name: 'Acme Trading' }],
          },
        };
      if (url.includes('/reports/')) return { status: 200, body: { items: [] } };
      if (url.includes('/clients') || /\/projects(\?|$)/.test(url))
        return { status: 403, body: { error: { code: 'FORBIDDEN', message: 'No' } } };
      return undefined;
    });
    renderAt('/reports', <App />);
    const clients = await screen.findByLabelText('Clients');
    expect(
      await within(clients).findByRole('option', { name: 'Acme Trading' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Projects')).getByRole('option', { name: 'SAP B1 Rollout' }),
    ).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => /\/api\/v1\/clients/.test(u))).toBe(false);
    expect(urls.some((u) => /\/api\/v1\/projects(\?|$)/.test(u))).toBe(false);
  });
});

describe('DR-44: negative balances use the danger token', () => {
  it('main.scss uses $danger (#b8240a), not #c22d0e', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = resolve(process.cwd(), 'src');
    const scss = readFileSync(resolve(src, 'styles/main.scss'), 'utf8');
    expect(scss.toLowerCase()).not.toContain('#c22d0e');
    expect(scss).toMatch(/\.text-negative \{\s*color: \$danger !important;/);
    const vars = readFileSync(
      resolve(src, 'vendor/sneat/scss/_custom-variables/_bootstrap-extended.scss'),
      'utf8',
    );
    expect(vars).toContain('$danger: #b8240a;');
  });
});

describe('Inactive list rows use the AA token', () => {
  it('Activity types: an inactive row gets row-inactive and the badge-inactive badge', async () => {
    const items = [
      {
        id: 'a1',
        kind: 'ACTIVITY_TYPE',
        name: 'Configuration',
        active: true,
        usedBy: 3,
        deactivatedAt: null,
        deactivatedBy: null,
        createdAt: '',
      },
      {
        id: 'a2',
        kind: 'ACTIVITY_TYPE',
        name: 'Old type',
        active: false,
        usedBy: 2,
        deactivatedAt: '2026-10-01T00:00:00.000Z',
        deactivatedBy: null,
        createdAt: '',
      },
    ];
    api('ADMIN', (url) =>
      url.includes('/lookups/') && url.endsWith('/all')
        ? { status: 200, body: { items } }
        : undefined,
    );
    renderAt('/admin/settings', <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Activity types' }));
    await userEvent.click(await screen.findByLabelText('Show inactive'));
    const row = (await screen.findAllByText('Old type'))[0]!.closest('tr')!;
    expect(row).toHaveClass('row-inactive');
    expect(within(row).getByText('Inactive')).toHaveClass('badge-inactive');
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = resolve(process.cwd(), 'src');
    const scss = readFileSync(resolve(src, 'styles/main.scss'), 'utf8');
    expect(scss).toMatch(/\.row-inactive > td,[\s\S]*?color: \$text-inactive !important;/);
    const vars = readFileSync(
      resolve(src, 'vendor/sneat/scss/_custom-variables/_bootstrap-extended.scss'),
      'utf8',
    );
    expect(vars).toContain('$text-inactive: #646e78;');
    expect(scss.toLowerCase()).not.toContain('#8592a3');
  });
});
