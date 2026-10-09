import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageDto, NotificationDto, SystemRole } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { followUpRecipients } from '../lib/m3ui';
import { ME_PM, PID, api, project, task, type Route } from './m2fixtures';
import { renderAt } from './utils';

beforeEach(() => {
  // Bootstrap modals and off-canvas panels read matchMedia, which jsdom lacks.
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
  phase: 'Phase 1',
  role: 'ASSIGNEE',
  dueDate: '2026-10-09',
  overdue: false,
  daysLate: 0,
  estHours: 8,
  actualHours: 0,
  status: 'IN_PROGRESS',
  party: 'INTERNAL',
  ...over,
});

const mine =
  (items: unknown[], extra: Record<string, unknown> = {}): Route =>
  (url) =>
    url.includes('/tasks/mine')
      ? {
          status: 200,
          body: {
            items,
            today: '2026-10-09',
            holiday: null,
            counts: {
              today: items.length,
              overdue: 1,
              dueThisWeek: 2,
              toReview: 0,
              assigned: 2,
              accountable: 0,
            },
            ...extra,
          },
        }
      : undefined;

describe('My tasks › Today (FR-TSK-20/21, AC-TODAY-1)', () => {
  it('is the first tab, shows the count, overdue first in red with days overdue, then due today, each with Log time', async () => {
    api(
      'MEMBER',
      mine([
        myTask({
          id: 'o1',
          name: 'Client master data – Items',
          dueDate: '2026-10-03',
          overdue: true,
          daysLate: 6,
        }),
        myTask({
          id: 'o2',
          name: 'Validate imported data',
          dueDate: '2026-10-08',
          overdue: true,
          daysLate: 1,
        }),
        myTask({ id: 't1', name: 'Prepare UAT scripts' }),
      ]),
    );
    renderAt('/my-tasks', <App />);
    expect(await screen.findByText('Friday, Oct 9')).toBeInTheDocument();
    const tabs = await screen.findAllByRole('button', {
      name: /Today|Assigned to me|accountable|review|Completed/,
    });
    expect(tabs[0]).toHaveTextContent('Today3');
    expect(await screen.findByText('Friday, Oct 9')).toBeInTheDocument();
    expect(screen.getByText('Philippine time')).toBeInTheDocument();
    const overdue = screen.getByRole('heading', { name: 'Overdue · 2' });
    expect(overdue).toHaveClass('text-danger');
    expect(screen.getByRole('heading', { name: 'Due today · 1' })).toBeInTheDocument();
    expect(screen.getByText('Oct 3 · 6 days overdue')).toHaveClass('text-danger');
    expect(screen.getByText('Oct 8 · 1 day overdue')).toBeInTheDocument();
    // Overdue section comes before Due today.
    const names = screen
      .getAllByRole('link', { name: /Client master|Validate|Prepare/ })
      .map((l) => l.textContent);
    expect(names).toEqual([
      'Client master data – Items',
      'Validate imported data',
      'Prepare UAT scripts',
    ]);
    expect(screen.getAllByRole('button', { name: 'Log time' })).toHaveLength(3);
  });

  it('empty state and the holiday banner', async () => {
    api('MEMBER', mine([], { holiday: { name: 'Bonifacio Day', type: 'REGULAR' } }));
    renderAt('/my-tasks', <App />);
    expect(await screen.findByText('Nothing due today')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Today is Bonifacio Day \(regular holiday\)\. New due dates skip today\. Tasks already due today keep their date\./,
      ),
    ).toBeInTheDocument();
  });

  it('Log time opens the form prefilled with the task and refuses bad hours', async () => {
    const fetchMock = api('MEMBER', (url, init) => {
      if (url.includes('/time/options'))
        return {
          status: 200,
          body: {
            items: [
              {
                project: { id: PID, name: 'SAP B1 Rollout' },
                tasks: [{ id: 't1', name: 'Prepare UAT scripts', phase: null }],
              },
            ],
          },
        };
      if (url.endsWith('/time') && init?.method === 'POST')
        return { status: 201, body: { entry: {} } };
      return mine([myTask({ id: 't1', name: 'Prepare UAT scripts' })])(url, init);
    });
    renderAt('/my-tasks', <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Log time' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log time' });
    await waitFor(() => expect(within(dialog).getByLabelText('Task *')).toHaveValue('t1'));
    await userEvent.type(within(dialog).getByLabelText('Hours *'), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }));
    expect(within(dialog).getByText('Enter between 0.25 and 24.')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('Hours *'));
    await userEvent.type(within(dialog).getByLabelText('Hours *'), '1.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/time') && i?.method === 'POST',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        taskId: 't1',
        hours: 1.5,
        type: 'EXECUTION',
      });
    });
  });
});

const note = (i: number, read = false): NotificationDto => ({
  id: `n${i}`,
  type: 'FOLLOW_UP',
  actor: { id: 'u2', name: 'Maria Perez' },
  task: { id: 'k1', name: 'Kickoff' },
  project: { id: PID, name: 'SAP B1 Rollout' },
  read,
  at: new Date().toISOString(),
});

describe('Notification bell (FR-NTF-01..06)', () => {
  it('shows 9+ above nine; Mark all as read; clicking opens the task and marks it read', async () => {
    const fetchMock = api('MEMBER', (url, init) => {
      if (url.endsWith('/notifications/unread-count')) return { status: 200, body: { unread: 12 } };
      if (url.endsWith('/notifications'))
        return { status: 200, body: { items: [note(1), note(2, true)], unread: 12 } };
      if (init?.method === 'POST' && url.includes('/notifications/'))
        return { status: 200, body: { unread: 0 } };
      return undefined;
    });
    const { router } = renderAt('/my-tasks', <App />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 12 unread' });
    expect(within(bell).getByText('9+')).toBeInTheDocument();
    await userEvent.click(bell);
    const [item] = await screen.findAllByRole('button', {
      name: /Maria P\. added a follow-up on Kickoff/,
    });
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeInTheDocument();
    await userEvent.click(item!);
    await waitFor(() => expect(router.state.location.search).toBe('?task=k1'));
    expect(router.state.location.pathname).toBe(`/projects/${PID}`);
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) => String(u).endsWith('/notifications/n1/read') && i?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('empty state', async () => {
    api('VIEWER', (url) =>
      url.endsWith('/notifications') ? { status: 200, body: { items: [], unread: 0 } } : undefined,
    );
    renderAt('/my-tasks', <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });
});

describe('Admin › Holidays (FR-CAL-01..05)', () => {
  const calendar = (over: Record<string, unknown> = {}) => ({
    workingDays: [1, 2, 3, 4, 5],
    version: 3,
    year: new Date().getFullYear(),
    holidays: [
      {
        id: 'h1',
        date: `${new Date().getFullYear()}-11-30`,
        name: 'Bonifacio Day',
        type: 'REGULAR',
        note: null,
      },
      {
        id: 'h2',
        date: `${new Date().getFullYear()}-12-12`,
        name: 'Make-up workday',
        type: 'SPECIAL_WORKING',
        note: 'Counts as a workday',
      },
    ],
    ...over,
  });

  it('lists the year; unticking the last working day keeps it ticked with the message; saves with the version', async () => {
    const fetchMock = api('ADMIN', (url, init) => {
      if (url.includes('/settings/working-days') && init?.method === 'PUT')
        return { status: 200, body: { workingDays: [6], version: 4 } };
      if (url.includes('/settings/calendar'))
        return { status: 200, body: calendar({ workingDays: [1] }) };
      return undefined;
    });
    renderAt('/admin/holidays', <App />);
    expect(await screen.findByText('Bonifacio Day')).toBeInTheDocument();
    expect(screen.getByText('Make-up workday')).toBeInTheDocument();
    const mon = screen.getByLabelText('Mon');
    expect(mon).toBeChecked();
    await userEvent.click(mon);
    expect(mon).toBeChecked();
    expect(screen.getByText('Keep at least one working day.')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Sat'));
    await userEvent.click(mon);
    expect(mon).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save working days' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/working-days') && i?.method === 'PUT',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ days: [6], version: 3 });
    });
  });

  it('Add holiday warns how many tasks are due that day and blocks a duplicate date', async () => {
    const y = new Date().getFullYear();
    api('ADMIN', (url) => {
      if (url.includes('/settings/holidays/impact') && url.includes(`${y}-12-08`))
        return {
          status: 200,
          body: {
            date: `${y}-12-08`,
            count: 12,
            existing: null,
            tasks: [
              {
                id: 'k1',
                name: 'Kickoff',
                project: { id: PID, name: 'SAP B1 Rollout' },
                dueDate: `${y}-12-08`,
              },
            ],
          },
        };
      if (url.includes('/settings/holidays/impact'))
        return {
          status: 200,
          body: { date: `${y}-11-30`, count: 0, tasks: [], existing: calendar().holidays[0] },
        };
      if (url.includes('/settings/calendar')) return { status: 200, body: calendar() };
      return undefined;
    });
    renderAt('/admin/holidays', <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add holiday' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add holiday' });
    const date = within(dialog).getByLabelText('Date *');
    await userEvent.type(date, `${y}-12-08`);
    expect(
      await within(dialog).findByText(
        /⚠ 12 tasks are due on this day\. Their due dates won't change\./,
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Review the 12 tasks' }));
    expect(within(dialog).getByRole('link', { name: 'Kickoff' })).toBeInTheDocument();
    await userEvent.clear(date);
    await userEvent.type(date, `${y}-11-30`);
    expect(
      await within(dialog).findByText(`Nov 30, ${y} already has a holiday ("Bonifacio Day").`),
    ).toBeInTheDocument();
  });

  it('an empty year offers Copy from the previous year', async () => {
    api('ADMIN', (url) =>
      url.includes('/settings/calendar')
        ? { status: 200, body: calendar({ holidays: [] }) }
        : undefined,
    );
    renderAt('/admin/holidays', <App />);
    const y = new Date().getFullYear();
    expect(await screen.findByText(`No holidays for ${y} yet`)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: `Copy from ${y - 1}…` }).length).toBeGreaterThan(
      0,
    );
  });
});

const projectApi = (role: SystemRole, extra: Route) =>
  api(role, (url, init) => {
    const r = extra(url, init);
    if (r) return r;
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
    if (url.endsWith(`/tasks/k1`)) return { status: 200, body: { task: task() } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
    return undefined;
  });

describe('Task evidence (FR-EVD-01..07)', () => {
  it('refuses a non-PDF/Word/Excel file before uploading, with the mockup message', async () => {
    const fetchMock = projectApi('PROJECT_MANAGER', () => undefined);
    renderAt(`/projects/${PID}?task=k1`, <App />);
    const input = await screen.findByTestId('evidence-input');
    expect(screen.getByText('PDF, Word or Excel · up to 25 MB each')).toBeInTheDocument();
    await userEvent.upload(input, new File(['x'], 'screenshot.png', { type: 'image/png' }), {
      applyAccept: false,
    });
    expect(
      await screen.findByText(
        "⚠ screenshot.png can't be added. Evidence must be a PDF, Word or Excel file.",
      ),
    ).toBeInTheDocument();
    await userEvent.upload(input, new File(['x'], 'Macros.xlsm'), { applyAccept: false });
    expect(
      await screen.findByText("⚠ Macros.xlsm can't be added. Save it as .xlsx without macros."),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/evidence/uploads'))).toBe(false);
  });

  it('legacy links show as "Link (legacy)"; files have Download; follow-ups say who is notified', async () => {
    const t = task({
      assignees: [{ id: 'u3', name: 'Ken Lee', active: true }],
      reviewer: { id: 'u4', name: 'Rita Reviewer', active: true },
      evidence: [
        {
          id: 'e1',
          type: 'LINK',
          name: 'sharepoint',
          url: 'https://sp.example/x',
          documentId: null,
          size: null,
          mimeType: null,
          addedBy: null,
          at: '2026-09-01T00:00:00Z',
        },
        {
          id: 'e2',
          type: 'FILE',
          name: 'Signoff.pdf',
          url: null,
          documentId: 'd1',
          size: 1_887_437,
          mimeType: 'application/pdf',
          addedBy: { id: 'u2', name: 'Maria Member' },
          at: '2026-09-15T00:00:00Z',
        },
      ],
    });
    projectApi('PROJECT_MANAGER', (url) =>
      url.endsWith('/tasks/k1') ? { status: 200, body: { task: t } } : undefined,
    );
    renderAt(`/projects/${PID}?task=k1`, <App />);
    expect(
      await screen.findByText('Link (legacy) · added before file uploads'),
    ).toBeInTheDocument();
    expect(screen.getByText(/1\.8 MB · Maria M\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(
      screen.getByText('Notifies Maria M., Ken L. and Rita R. (reviewer)'),
    ).toBeInTheDocument();
  });

  it('followUpRecipients lists owner, assignees, reviewer and PM without the author', () => {
    const t = task({
      assignees: [{ id: 'u3', name: 'Ken Lee', active: true }],
      reviewer: { id: 'u4', name: 'Rita Reviewer', active: true },
    });
    expect(followUpRecipients(t, project(), 'u3')).toBe(
      'Maria M., Rita R. (reviewer) and Me P. (PM)',
    );
    expect(followUpRecipients(t, project(), ME_PM)).toBe('Maria M., Ken L. and Rita R. (reviewer)');
  });

  it('the checklist drag handle is the bx-grid-vertical icon', async () => {
    projectApi('PROJECT_MANAGER', () => undefined);
    renderAt(`/projects/${PID}`, <App />);
    await screen.findAllByText('Kickoff');
    expect(document.querySelector('.bx-grid-vertical')).not.toBeNull();
    expect(document.body.textContent).not.toContain('⋮⋮');
  });
});

describe('Project Conversation (FR-CNV-01..08)', () => {
  const msg = (over: Partial<MessageDto>): MessageDto => ({
    id: 'm1',
    text: '<script>alert(1)</script>',
    type: 'NOTE',
    author: { id: 'u2', name: 'Maria Member', active: true },
    at: '2026-10-09T01:30:00Z',
    task: null,
    contacts: [],
    hidden: null,
    ...over,
  });

  it('shows script as plain text; Viewers read but cannot post; hidden messages show who hid them', async () => {
    projectApi('VIEWER', (url) =>
      url.includes('/messages')
        ? {
            status: 200,
            body: {
              items: [
                msg({}),
                msg({
                  id: 'm2',
                  text: null,
                  hidden: {
                    by: { id: 'a', name: 'Ada Admin' },
                    at: '2026-10-09T02:00:00Z',
                    reason: 'Conduct policy',
                  },
                }),
              ],
              can: { post: false, hide: false },
            },
          }
        : undefined,
    );
    renderAt(`/projects/${PID}/conversation`, <App />);
    expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('main script')).toBeNull();
    expect(
      screen.getByText(/Message hidden by Ada Admin on Oct 9\. Reason: Conduct policy/),
    ).toBeInTheDocument();
    expect(screen.getByText('You can read this conversation but not post.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('members post with a type and tagged task', async () => {
    const fetchMock = projectApi('MEMBER', (url, init) => {
      if (url.includes('/messages') && init?.method === 'POST')
        return { status: 201, body: { message: msg({}) } };
      if (url.includes('/messages'))
        return { status: 200, body: { items: [], can: { post: true, hide: false } } };
      return undefined;
    });
    renderAt(`/projects/${PID}/conversation`, <App />);
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
    expect(
      screen.getByText("Messages are permanent and can't be edited or deleted."),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Message type'), 'CALL');
    await userEvent.selectOptions(screen.getByLabelText('Tag a task'), 'k1');
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Called the client');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).includes('/messages') && i?.method === 'POST',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        text: 'Called the client',
        type: 'CALL',
        taskId: 'k1',
        contactIds: [],
      });
    });
  });
});
