import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SystemRole } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { LOOKUPS, makeUser } from './fixtures';
import { PID, api, type Route } from './m2fixtures';
import { entry, trackerDay } from './m5fixtures';
import { renderAt } from './utils';

/** M5 Activity Tracker UI (doc 14 §2, §10, §12; mockup v0.8.7; QA 06 TC-Q01..Q12). */
afterEach(() => vi.unstubAllGlobals());

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

const sent = (fetchMock: ReturnType<typeof api>, path: string) => {
  const call = fetchMock.mock.calls.find(
    ([u, i]) => String(u).endsWith(path) && i?.method && i.method !== 'GET',
  );
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

describe('Today › Time in / Time out (TC-Q01, Q02, Q08)', () => {
  it('shows today HH:MM per task and hours rendered; Time in asks for the day location first', async () => {
    const fetchMock = tracker(
      'MEMBER',
      trackerDay({ location: null, entries: [entry({ minutes: 75 })] }),
    );
    renderAt('/my-tasks', <App />);
    const row = await screen.findByTestId('planned-t1');
    expect(await within(row).findByText('01:15')).toBeInTheDocument();
    expect(screen.getByTestId('rendered-today')).toHaveTextContent('01:15');
    await userEvent.click(
      within(row).getByRole('button', { name: 'Time in on Prepare UAT scripts' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Time in' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    expect(within(dialog).getByText('Choose where you’re working today.')).toBeInTheDocument();
    // Prefilled from today's last entry on the same task.
    expect(within(dialog).getByLabelText('Activity type *')).toHaveValue('at1');
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Where are you working today? *'),
      'WFH',
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Activity type *'),
      'Configuration',
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('Module *'), 'Financials');
    expect(within(dialog).getByLabelText('Time type')).toHaveValue('EXECUTION');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    await waitFor(() =>
      expect(sent(fetchMock, '/tracker/start')).toEqual({
        taskId: 't1',
        activityTypeId: 'at1',
        moduleId: 'mod1',
        billable: true,
        type: 'EXECUTION',
        dayLocationId: 'loc2',
      }),
    );
  });

  it('the running task shows Running and Time out; the top bar shows the timer on every page', async () => {
    const running = entry({
      id: 'r1',
      running: true,
      endAt: null,
      startAt: '2026-10-09T02:48:00.000Z',
      minutes: 72,
    });
    const fetchMock = tracker('MEMBER', trackerDay({ entries: [running] }));
    renderAt('/my-tasks', <App />);
    const row = await screen.findByTestId('planned-t1');
    expect(await within(row).findByText('Running')).toBeInTheDocument();
    const pill = await screen.findByTestId('running-timer');
    expect(pill).toHaveTextContent('Prepare UAT scripts');
    expect(pill).toHaveTextContent('01:12');
    await userEvent.click(within(pill).getByRole('button', { name: '■ Time out' }));
    await waitFor(() => expect(sent(fetchMock, '/tracker/stop')).toEqual({}));
  });
});

describe('+ Quick activity (TC-Q06)', () => {
  it('needs a title and Activity type, has no Time type and defaults Billable to No', async () => {
    const fetchMock = tracker('MEMBER');
    renderAt('/my-tasks', <App />);
    await userEvent.click((await screen.findAllByRole('button', { name: '+ Quick activity' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Quick activity' });
    expect(
      within(dialog).getByText(
        'Not linked to a project. Only you, your supervisor and Admins can see it.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Time type')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('No')).toBeChecked();
    expect(within(dialog).getByLabelText('Module (optional)')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    expect(within(dialog).getByText('Add a title.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Title *'), 'Weekly team stand-up');
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Activity type *'),
      'Internal meeting',
    );
    await userEvent.click(within(dialog).getByLabelText('Enter time in and time out'));
    await userEvent.type(within(dialog).getByLabelText('Time in *'), '08:30');
    await userEvent.type(within(dialog).getByLabelText('Time out *'), '08:58');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }));
    await waitFor(() =>
      expect(sent(fetchMock, '/tracker/entries')).toEqual({
        title: 'Weekly team stand-up',
        activityTypeId: 'at2',
        billable: false,
        date: '2026-10-09',
        timeIn: '08:30',
        timeOut: '08:58',
      }),
    );
  });
});

describe('Day timesheet (TC-Q10, Q11, Q12)', () => {
  it('lists entries with 12-hour times, HH:MM and the day total; submit waits for the timer', async () => {
    const quick = entry({
      id: 'q1',
      kind: 'QUICK',
      project: null,
      client: null,
      task: null,
      title: 'Weekly team stand-up',
      startAt: '2026-10-09T00:30:00.000Z',
      endAt: '2026-10-09T00:58:00.000Z',
      minutes: 28,
      billable: false,
      type: null,
      module: null,
      activityType: { id: 'at2', name: 'Internal meeting' },
    });
    const running = entry({
      id: 'r1',
      running: true,
      endAt: null,
      minutes: 72,
      location: { id: 'loc1', name: 'Onsite' },
      locationOverridden: true,
    });
    tracker('MEMBER', trackerDay({ entries: [quick, running] }));
    renderAt('/my-tasks?tab=day', <App />);
    const q = await screen.findByTestId('entry-q1');
    expect(within(q).getByText('08:30 AM')).toBeInTheDocument();
    expect(within(q).getByText('08:58 AM')).toBeInTheDocument();
    expect(within(q).getByText('00:28')).toBeInTheDocument();
    expect(within(q).getByText('Quick activity')).toBeInTheDocument();
    expect(within(screen.getByTestId('entry-r1')).getByText('Onsite')).toHaveClass('fw-semibold');
    expect(screen.getByTestId('hours-rendered')).toHaveTextContent('01:40');
    expect(screen.getByRole('button', { name: 'Submit day' })).toBeDisabled();
    expect(
      screen.getAllByText('Stop the running timer before submitting this day.').length,
    ).toBeGreaterThan(0);
  });

  it('a past-lock day is locked as it stood and flagged Not submitted', async () => {
    tracker(
      'MEMBER',
      trackerDay({
        notSubmitted: true,
        weekLocked: true,
        can: { edit: false, submit: false, reopen: false },
        entries: [entry({ locked: true })],
      }),
    );
    renderAt('/my-tasks?tab=day', <App />);
    expect(
      await screen.findByText(/wasn't submitted\. It was locked as it stood at the weekly lock\./),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Not submitted').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '+ Add entry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
  });

  it('the supervisor reopens a submitted day with a reason', async () => {
    const day = trackerDay({
      user: { id: 'u9', name: 'Maria Perez' },
      own: false,
      status: 'SUBMITTED',
      submittedAt: '2026-10-09T10:12:00.000Z',
      can: { edit: false, submit: false, reopen: true },
    });
    const fetchMock = tracker('PROJECT_MANAGER', day, (url) =>
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
    await userEvent.selectOptions(await screen.findByLabelText('Person'), 'Maria Perez');
    expect(
      await screen.findByText(/Submitted Oct 9, 6:12 PM · entries locked/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reopen day…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Missing the 2–3 PM client call');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen day' }));
    await waitFor(() =>
      expect(sent(fetchMock, '/tracker/days/2026-10-09/reopen')).toEqual({
        userId: 'u9',
        reason: 'Missing the 2–3 PM client call',
      }),
    );
  });
});

describe('Admin › Settings lists (TC-Q09)', () => {
  it('shows Used by; in-use values deactivate, unused ones delete; duplicates show inline', async () => {
    const items = [
      {
        id: 'a1',
        kind: 'ACTIVITY_TYPE',
        name: 'Configuration',
        active: true,
        usedBy: 85,
        deactivatedAt: null,
        deactivatedBy: null,
        createdAt: '',
      },
      {
        id: 'a2',
        kind: 'ACTIVITY_TYPE',
        name: 'Vendor call',
        active: true,
        usedBy: 0,
        deactivatedAt: null,
        deactivatedBy: null,
        createdAt: '',
      },
    ];
    const fetchMock = api('ADMIN', (url, init) => {
      if (url.includes('/lookups/activity-types/all')) return { status: 200, body: { items } };
      if (url.endsWith('/lookups/activity-types') && init?.method === 'POST')
        return {
          status: 409,
          body: {
            error: {
              code: 'DUPLICATE_NAME',
              message: 'x',
              details: [{ path: 'name', message: '"Configuration" already exists.' }],
            },
          },
        };
      return undefined;
    });
    renderAt('/admin/settings', <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Activity types' }));
    expect(await screen.findByText('85 entries')).toBeInTheDocument();
    expect(screen.getByText('Not used')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate "Configuration"?' });
    expect(
      within(confirm).getByText(/It's used by 85 entries, so it can't be deleted\./),
    ).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(sent(fetchMock, '/lookups/a1')).toEqual({ active: false }));
    await userEvent.click(screen.getByRole('button', { name: '+ Add activity type' }));
    const add = await screen.findByRole('dialog', { name: 'Add activity type' });
    await userEvent.type(within(add).getByLabelText('Name *'), 'configuration');
    await userEvent.click(within(add).getByRole('button', { name: 'Add' }));
    expect(await within(add).findByText('"Configuration" already exists.')).toBeInTheDocument();
  });
});

describe('Admin › Users supervisor (doc 14 §5, FR-LV-10)', () => {
  it('flags users without a supervisor and saves one', async () => {
    const maria = makeUser({ id: 'u2', name: 'Maria Perez', supervisorId: null });
    const paolo = makeUser({
      id: 'cccccccccccccccccccccccc',
      name: 'Paolo PM',
      systemRole: 'PROJECT_MANAGER',
      supervisorId: 'u2',
    });
    const fetchMock = api('ADMIN', (url, init) => {
      if (url.includes('/users?') || url.endsWith('/users'))
        return { status: 200, body: { items: [maria, paolo], page: 1, pageSize: 100, total: 2 } };
      if (url.endsWith('/users/u2') && init?.method === 'PATCH')
        return { status: 200, body: { user: maria } };
      return undefined;
    });
    renderAt('/admin/users', <App />);
    const row = (await screen.findByText('Maria Perez')).closest('tr')!;
    expect(within(row).getByText('Supervisor needed')).toBeInTheDocument();
    expect(
      within(screen.getByText('Paolo PM').closest('tr')!).queryByText('Supervisor needed'),
    ).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /actions/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Direct supervisor'), 'Paolo PM');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(sent(fetchMock, '/users/u2')).toMatchObject({
        supervisorId: 'cccccccccccccccccccccccc',
      }),
    );
  });
});

describe('Notifications: personal notices', () => {
  it('shows the day-reopened sentence and opens the day', async () => {
    api('MEMBER', (url) =>
      url.includes('/notifications') && !url.includes('unread')
        ? {
            status: 200,
            body: {
              unread: 1,
              items: [
                {
                  id: 'n1',
                  type: 'DAY_REOPENED',
                  actor: { id: 'u3', name: 'Paolo PM' },
                  task: null,
                  issue: null,
                  project: null,
                  message:
                    'Paolo PM reopened your timesheet for 2026-10-08: Missing call. Make your changes and submit it again before the weekly lock.',
                  link: '/my-tasks?tab=day&date=2026-10-08',
                  read: false,
                  at: new Date().toISOString(),
                },
              ],
            },
          }
        : url.includes('unread-count')
          ? { status: 200, body: { unread: 1 } }
          : undefined,
    );
    renderAt('/my-tasks', <App />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(
      await screen.findByText(/reopened your timesheet for 2026-10-08: Missing call\./),
    ).toBeInTheDocument();
  });
});
