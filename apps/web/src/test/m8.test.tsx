import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { daysLabel, weekRangeShort, whereWorkingQuestion } from '../lib/format';
import { LOOKUPS } from './fixtures';
import { api } from './m2fixtures';
import { entry, trackerDay } from './m5fixtures';
import { renderAt } from './utils';

/** M8 polish: DR-39..DR-42 (UIE re-check of M4–M7). */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Pretend the screen is a 390px phone (or a desktop). */
function screenWidth(px: number) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    return {
      matches: max ? px <= Number(max[1]) : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    };
  });
}

const week = {
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
  items: [],
  total: 0,
  capacity: 40,
};
const timeRoute = (url: string) =>
  /\/api\/v1\/time(\?|$)/.test(url) ? { status: 200, body: week } : undefined;

describe('DR-40: the page title leaves the top bar on phones', () => {
  it('phone: the title is a heading in the page, the top bar has none', async () => {
    screenWidth(390);
    api('MEMBER', timeRoute);
    const { container } = renderAt('/time', <App />);
    const h = await screen.findByRole('heading', { level: 1, name: 'Time logging' });
    expect(h.closest('.page-heading-phone')).not.toBeNull();
    expect(container.querySelector('.topbar-title')).toBeEmptyDOMElement();
  });

  it('desktop: the title stays in the top bar', async () => {
    screenWidth(1440);
    api('MEMBER', timeRoute);
    const { container } = renderAt('/time', <App />);
    const h = await screen.findByRole('heading', { level: 1, name: 'Time logging' });
    expect(container.querySelector('.topbar-title')).toContainElement(h);
  });
});

describe('DR-39: Time logging week switcher on phones', () => {
  it('phone: "‹ Oct 5–11 ›" sits in the page body, not the top bar', async () => {
    screenWidth(390);
    api('MEMBER', timeRoute);
    const { container } = renderAt('/time', <App />);
    const label = await screen.findByRole('button', { name: 'Oct 5–11' });
    const group = screen.getByRole('group', { name: 'Week' });
    expect(group).toContainElement(label);
    expect(within(group).getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
    expect(container.querySelector('.topbar-actions')).not.toContainElement(group);
    expect(screen.queryByText(/Week of/)).not.toBeInTheDocument();
  });

  it('desktop: "Week of Oct 5" stays in the top bar', async () => {
    screenWidth(1440);
    api('MEMBER', timeRoute);
    const { container } = renderAt('/time', <App />);
    const label = await screen.findByRole('button', { name: 'Week of Oct 5' });
    expect(container.querySelector('.topbar-actions')).toContainElement(label);
  });

  it('short labels cross months', () => {
    expect(weekRangeShort('2026-10-05')).toBe('Oct 5–11');
    expect(weekRangeShort('2026-09-28')).toBe('Sep 28–Oct 4');
  });
});

describe('DR-41: the location question for a past day', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T04:00:00Z'));
  });

  it('wording by day', () => {
    expect(whereWorkingQuestion('2026-10-09', '2026-10-09')).toBe('Where are you working today?');
    expect(whereWorkingQuestion('2026-10-07', '2026-10-09')).toBe(
      'Where were you working on Wed, Oct 7?',
    );
  });

  it('Add entry on Wed, Oct 7 asks "Where were you working on Wed, Oct 7?"', async () => {
    screenWidth(1440);
    const past = trackerDay({ date: '2026-10-07', location: null, entries: [] });
    api('MEMBER', (url) => {
      if (url.endsWith('/lookups')) return { status: 200, body: LOOKUPS };
      if (url.includes('/tracker/day')) return { status: 200, body: { day: past } };
      if (url.includes('/tracker/running'))
        return { status: 200, body: { entry: null, now: '2026-10-09T04:00:00.000Z' } };
      if (url.includes('/tracker/people'))
        return { status: 200, body: { items: [{ id: 'me', name: 'Me' }] } };
      return undefined;
    });
    renderAt('/my-tasks?tab=day&date=2026-10-07', <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add entry' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText('Where were you working on Wed, Oct 7? *'),
      ).toBeInTheDocument(),
    );
    expect(within(dialog).queryByText(/working today/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Every entry that day uses it/)).toBeInTheDocument();
  });
});

// ---------- Doc 14 v0.9.7 FR-ACT-20..23 (mockup v0.8.9) ----------
const trackerApi = (
  day = trackerDay(),
  extra: (url: string, init?: RequestInit) => unknown = () => undefined,
) =>
  api('MEMBER', (url, init) => {
    const x = extra(url, init);
    if (x) return x as { status: number; body: unknown };
    if (url.endsWith('/lookups')) return { status: 200, body: LOOKUPS };
    if (url.includes('/tracker/day')) return { status: 200, body: { day } };
    if (url.includes('/tracker/running'))
      return {
        status: 200,
        body: {
          entry: day.entries.find((e) => e.running) ?? null,
          now: '2026-10-09T04:00:00.000Z',
        },
      };
    if (url.includes('/tracker/people'))
      return { status: 200, body: { items: [{ id: 'me', name: 'Me' }] } };
    if (init?.method === 'POST' && url.includes('/tracker/'))
      return { status: 201, body: { entry: entry() } };
    if (url.includes('/tasks/mine'))
      return {
        status: 200,
        body: {
          items: [],
          today: '2026-10-09',
          holiday: null,
          counts: {
            today: 0,
            due: 0,
            overdue: 0,
            dueThisWeek: 0,
            toReview: 0,
            assigned: 0,
            accountable: 0,
          },
        },
      };
    return undefined;
  });

describe('FR-ACT-20: Module is optional free text', () => {
  beforeEach(() => screenWidth(1440));

  it('counts from 80 characters and refuses more than 100 after trimming', async () => {
    const fetchMock = trackerApi();
    const user = userEvent.setup();
    renderAt('/my-tasks', <App />);
    await user.click((await screen.findAllByRole('button', { name: /Quick activity/ }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Quick activity' });
    const field = within(dialog).getByLabelText('Module (optional)');
    expect(field).toHaveAttribute('placeholder', 'e.g. ADFS Remote');
    expect(field.tagName).toBe('INPUT');
    await user.click(field);
    await user.paste('x'.repeat(79));
    expect(within(dialog).queryByText(/\/100$/)).toBeNull();
    await user.type(field, 'x');
    expect(within(dialog).getByText('80/100')).toBeInTheDocument();
    // Spaces around it don't count.
    await user.paste(`${'y'.repeat(20)}   `);
    expect(within(dialog).getByText('100/100')).toBeInTheDocument();
    // Typing after the spaces makes them inner characters: 100 + 3 spaces + 1.
    await user.type(field, 'z');
    expect(within(dialog).getByText('104/100')).toHaveClass('text-danger');
    await user.type(within(dialog).getByLabelText('Title *'), 'Stand-up');
    await user.selectOptions(within(dialog).getByLabelText('Activity type *'), 'Internal meeting');
    await user.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    expect(within(dialog).getByText('Keep the module under 100 characters.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) => String(u).includes('/tracker/start') && i?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('a blank module shows "–"; typed HTML shows as plain text', async () => {
    trackerApi(
      trackerDay({
        entries: [
          entry({ id: 'e1', module: null }),
          entry({
            id: 'e2',
            module: '<b>ADFS</b> <img src=x onerror=alert(1)>',
            startAt: '2026-10-09T04:00:00.000Z',
            endAt: '2026-10-09T04:30:00.000Z',
            minutes: 30,
          }),
        ],
      }),
    );
    renderAt('/my-tasks?tab=day', <App />);
    const blank = await screen.findByTestId('entry-e1');
    expect(blank).toHaveTextContent('– · Scenarios 1–6');
    const html = screen.getByTestId('entry-e2');
    expect(html).toHaveTextContent('<b>ADFS</b> <img src=x onerror=alert(1)>');
    expect(html.querySelector('b, img')).toBeNull();
  });
});

describe('FR-ACT-22: no Admin › Settings › Modules', () => {
  it('Settings lists Activity types, Project types and Locations only', async () => {
    screenWidth(1440);
    api('ADMIN', (url) =>
      url.includes('/lookups') ? { status: 200, body: { items: [] } } : undefined,
    );
    renderAt('/admin/settings', <App />);
    const nav = await screen.findByRole('list', { name: 'Settings sections' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['General', 'Activity types', 'Project types', 'Locations']);
  });
});

describe('FR-ACT-23: Time out on the Day timesheet running row', () => {
  it('stops that entry at server time, once', async () => {
    screenWidth(1440);
    const running = entry({ id: 'r1', running: true, endAt: null, minutes: 72 });
    const fetchMock = trackerApi(trackerDay({ entries: [entry(), running] }));
    const user = userEvent.setup();
    renderAt('/my-tasks?tab=day', <App />);
    const row = await screen.findByTestId('entry-r1');
    const button = within(row).getByRole('button', { name: 'Time out on Prepare UAT scripts' });
    expect(button).toHaveTextContent('■ Time out');
    await user.click(button);
    await waitFor(() => {
      const stops = fetchMock.mock.calls.filter(
        ([u, i]) => String(u).endsWith('/tracker/stop') && i?.method === 'POST',
      );
      expect(stops).toHaveLength(1);
      // No client time is sent: the server stamps it. The entry id makes a repeat a no-op.
      expect(JSON.parse(String(stops[0]![1]!.body))).toEqual({ entryId: 'r1' });
    });
  });

  it("someone else's running timer has no Time out", async () => {
    screenWidth(1440);
    const running = entry({ id: 'r1', running: true, endAt: null, minutes: 72 });
    trackerApi(trackerDay({ own: false, entries: [running] }));
    renderAt('/my-tasks?tab=day', <App />);
    const row = await screen.findByTestId('entry-r1');
    expect(within(row).queryByRole('button', { name: /Time out/ })).toBeNull();
    expect(within(row).getByText('Running')).toBeInTheDocument();
  });
});

describe('DR-38: negative balances look the same everywhere', () => {
  it('Admin › Leave › Entitlements: real minus, AA red and the Negative badge', async () => {
    screenWidth(1440);
    const vacation = {
      id: '6510000000000000000000a1',
      name: 'Vacation',
      paid: true,
      unit: 'DAY',
      halfDays: true,
      carryOver: 'NONE',
      carryOverLimit: null,
      active: true,
      order: 1,
    };
    api('ADMIN', (url) => {
      if (url.includes('/leave/types')) return { status: 200, body: { items: [vacation] } };
      if (url.includes('/leave/entitlements'))
        return {
          status: 200,
          body: {
            items: [
              {
                user: { id: 'u3', name: 'A. Reyes' },
                leaveTypeId: vacation.id,
                year: 2026,
                entitlement: 4,
                carryOver: 0,
                taken: 6,
                balance: -2,
                negative: true,
              },
            ],
          },
        };
      return undefined;
    });
    renderAt('/admin/leave', <App />);
    const value = await screen.findByText('\u22122');
    expect(value).toHaveClass('text-negative');
    expect(value.nextElementSibling).toHaveTextContent('Negative');
    expect(value.nextElementSibling).toHaveClass('badge-negative');
    expect(value.closest('td')).not.toHaveTextContent('-2');
  });

  it('one helper formats days', () => {
    expect(daysLabel(-3.5)).toBe('\u22123.5');
    expect(daysLabel(0)).toBe('0');
    expect(daysLabel(null)).toBe('–');
  });
});

describe('FR-ACT-24: locked rows show a lock, not Edit or Delete', () => {
  const timeEntry = (over: object) => ({
    id: 'x1',
    user: { id: 'me-PROJECT_MANAGER', name: 'Me PM' },
    project: { id: 'p1', name: 'SAP B1 Rollout' },
    task: { id: 't1', name: 'Kickoff' },
    workDate: '2026-10-02',
    hours: 2,
    minutes: 120,
    timed: false,
    activityType: { id: 'at1', name: 'Configuration' },
    module: null,
    billable: true,
    type: 'EXECUTION',
    notes: null,
    locked: true,
    createdAt: '2026-10-02T01:00:00.000Z',
    ...over,
  });

  it('Time logging: a PM sees the lock and tooltip on a locked entry', async () => {
    screenWidth(1440);
    api('PROJECT_MANAGER', (url) =>
      /\/api\/v1\/time(\?|$)/.test(url)
        ? {
            status: 200,
            body: {
              ...week,
              items: [
                timeEntry({}),
                timeEntry({ id: 'x2', locked: false, workDate: '2026-10-08' }),
              ],
              total: 4,
            },
          }
        : undefined,
    );
    renderAt('/time', <App />);
    const icons = await screen.findAllByTestId('locked-icon');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveAttribute('title', 'Locked. Ask an Admin to reopen this day.');
    expect(screen.getByRole('img', { name: 'Locked. Ask an Admin to reopen this day.' })).toBe(
      icons[0],
    );
    expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(1);
    expect(icons[0]!.closest('tr')).not.toHaveTextContent('Delete');
  });

  it('Day timesheet: a locked own day shows the lock instead of ✎', async () => {
    screenWidth(1440);
    trackerApi(
      trackerDay({
        status: 'SUBMITTED',
        can: { edit: false, submit: false, reopen: false },
        entries: [entry({ locked: true })],
      }),
    );
    renderAt('/my-tasks?tab=day', <App />);
    const row = await screen.findByTestId('entry-e1');
    expect(
      within(row).getByRole('img', { name: 'Locked. Ask an Admin to reopen this day.' }),
    ).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Edit/ })).toBeNull();
  });
});
