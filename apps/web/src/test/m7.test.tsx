import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeaveBalanceDto, LeaveDto, LeaveTypeDto } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { LOOKUPS } from './fixtures';
import { PID, api, type Route } from './m2fixtures';
import { trackerDay } from './m5fixtures';
import { renderAt } from './utils';

/** M7 Leave UI (doc 14 §4, Q-46, §16 FR-LV-11; mockup v0.8.7; QA 06 TC-S01..S10). */
afterEach(() => vi.unstubAllGlobals());

const type = (over: Partial<LeaveTypeDto>): LeaveTypeDto => ({
  id: '6510000000000000000000a1',
  name: 'Vacation',
  paid: true,
  unit: 'HALF_DAY',
  needsDocument: false,
  carryOverLimit: 5,
  active: true,
  ...over,
});
const TYPES = [
  type({}),
  type({ id: '6510000000000000000000a2', name: 'Emergency', unit: 'DAY', carryOverLimit: null }),
  type({ id: '6510000000000000000000a3', name: 'Unpaid', paid: false, carryOverLimit: null }),
];
const bal = (t: LeaveTypeDto, over: Partial<LeaveBalanceDto> = {}): LeaveBalanceDto => ({
  type: t,
  year: 2026,
  entitlement: t.paid ? 15 : null,
  carryOver: t.paid ? 2 : 0,
  recorded: 10,
  balance: t.paid ? 7 : null,
  negative: false,
  ...over,
});
const leave = (over: Partial<LeaveDto>): LeaveDto => ({
  id: 'l1',
  user: { id: 'u1', name: 'Maria Member' },
  type: { id: '6510000000000000000000a1', name: 'Vacation', paid: true },
  dayPart: 'FULL',
  from: '2099-10-29',
  to: '2099-11-03',
  days: 3,
  byYear: [{ year: 2099, days: 3 }],
  reason: 'Family trip',
  status: 'RECORDED',
  recordedAt: '2026-10-09T02:00:00.000Z',
  cancelledAt: null,
  cancelledBy: null,
  can: { cancel: true },
  ...over,
});

function leaveApi(opts: { supervisor?: boolean; extra?: Route } = {}) {
  return api('MEMBER', (url, init) => {
    const x = opts.extra?.(url, init);
    if (x) return x;
    if (url.includes('/leave/types')) return { status: 200, body: { items: TYPES } };
    if (url.includes('/leave/balances'))
      return {
        status: 200,
        body: {
          year: 2026,
          items: [
            bal(TYPES[0]!),
            bal(TYPES[1]!, { entitlement: null, recorded: 0, balance: 0 }),
            bal(TYPES[2]!),
          ],
          supervisor: opts.supervisor === false ? null : { id: 'u9', name: 'Jomerson Nazaire' },
        },
      };
    if (url.includes('/leave/team'))
      return {
        status: 200,
        body: {
          year: 2026,
          items: [
            leave({
              id: 'l9',
              user: { id: 'u2', name: 'Ken L.' },
              dayPart: 'AM',
              from: '2099-10-12',
              to: '2099-10-12',
              days: 0.5,
              reason: 'Personal appointment',
            }),
          ],
          people: [
            {
              user: { id: 'u2', name: 'Ken L.' },
              noSupervisor: false,
              items: [bal(TYPES[0]!, { balance: -2, negative: true })],
            },
          ],
        },
      };
    if (/\/leave(\?|$)/.test(url) && (!init?.method || init.method === 'GET'))
      return {
        status: 200,
        body: {
          items: [
            leave({}),
            leave({
              id: 'l2',
              from: '2026-10-06',
              to: '2026-10-06',
              days: 1,
              can: { cancel: false },
            }),
            leave({ id: 'l3', status: 'CANCELLED', can: { cancel: false } }),
          ],
        },
      };
    return undefined;
  });
}

describe('TC-S01/S05/S08: My leave', () => {
  it('shows balances, recorded leave, cancel rules and the no-supervisor notice', async () => {
    const fetch = leaveApi({
      supervisor: false,
      extra: (url, init) =>
        url.endsWith('/leave/l1/cancel') && init?.method === 'POST'
          ? { status: 200, body: { item: leave({ status: 'CANCELLED' }) } }
          : undefined,
    });
    renderAt('/leave', <App />);
    expect(await screen.findByText('Supervisor needed')).toBeInTheDocument();
    expect(
      screen.getByText(
        /so your leave notices go to all Admins\. Ask an Admin to set your supervisor\./,
      ),
    ).toBeInTheDocument();
    const vacation = (await screen.findAllByRole('row')).find((r) =>
      r.textContent?.startsWith('VacationPaid'),
    )!;
    expect(vacation).toHaveTextContent('VacationPaid1521077'.slice(0, 12));
    expect(screen.getByText('No entitlement set for you')).toBeInTheDocument();
    expect(screen.getByText('No limit')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').filter((r) => r.textContent?.includes('Full day'));
    expect(rows[0]).toHaveTextContent('Oct 29 – Nov 3');
    expect(rows[1]).toHaveTextContent('Past · Admin can cancel');
    expect(rows[2]).toHaveTextContent('Cancelled');
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this leave?' });
    expect(dialog).toHaveTextContent('Vacation · Oct 29 – Nov 3 · Full day · 3 working days');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel leave' }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([u, i]) => String(u).endsWith('/leave/l1/cancel') && i?.method === 'POST',
        ),
      ).toBe(true),
    );
  });
});

describe('TC-S03/S04: Record leave', () => {
  it('limits half days to half-day types, sends the choice, and shows the server rule', async () => {
    const fetch = leaveApi({
      extra: (url, init) =>
        /\/leave$/.test(url) && init?.method === 'POST'
          ? {
              status: 422,
              body: {
                error: {
                  code: 'LEAVE_OVERLAP',
                  message: 'You already have leave recorded for this morning.',
                  details: [
                    {
                      path: 'dayPart',
                      message: 'You already have leave recorded for this morning.',
                    },
                  ],
                },
              },
            }
          : undefined,
    });
    renderAt('/leave', <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record leave' }));
    await screen.findByRole('dialog', { name: 'Record leave' });
    const dlg = () => screen.getByRole('dialog', { name: 'Record leave' });
    await userEvent.click(within(dlg()).getByRole('button', { name: 'Record leave' }));
    expect(within(dlg()).getByText('Choose a leave type.')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dlg()).getByRole('option', { name: 'Vacation (balance 7)' }),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(
      within(dlg()).getByLabelText('Leave type *'),
      '6510000000000000000000a2',
    );
    expect(within(dlg()).getByLabelText('Half day AM')).toBeDisabled();
    await userEvent.selectOptions(
      within(dlg()).getByLabelText('Leave type *'),
      '6510000000000000000000a1',
    );
    await userEvent.click(within(dlg()).getByLabelText('Half day AM'));
    expect(within(dlg()).queryByLabelText('To *')).not.toBeInTheDocument();
    const date = within(dlg()).getByLabelText('Date *');
    fireEvent.change(date, { target: { value: '2099-10-20' } });
    await userEvent.type(within(dlg()).getByLabelText('Reason'), 'Errand');
    expect(within(dlg()).getByText(/Don't include medical details/)).toBeInTheDocument();
    expect(
      within(dlg()).getByText(/Jomerson Nazaire \(your supervisor\) gets an in-app notice/),
    ).toBeInTheDocument();
    await userEvent.click(within(dlg()).getByRole('button', { name: 'Record leave' }));
    expect(
      await within(dlg()).findByText('You already have leave recorded for this morning.'),
    ).toBeInTheDocument();
    const post = fetch.mock.calls.find(
      ([u, i]) => /\/leave$/.test(String(u)) && i?.method === 'POST',
    );
    expect(JSON.parse(String(post![1]!.body))).toEqual({
      leaveTypeId: '6510000000000000000000a1',
      dayPart: 'AM',
      from: '2099-10-20',
      to: '2099-10-20',
      reason: 'Errand',
    });
  });
});

describe('TC-S06: Team on leave', () => {
  it('lists direct reports with reasons and flags negative balances', async () => {
    leaveApi();
    renderAt('/leave?tab=team', <App />);
    const row = (await screen.findByText('Personal appointment')).closest('tr')!;
    expect(row).toHaveTextContent('Ken L.');
    expect(row).toHaveTextContent('Half day AM');
    expect(screen.getByText('−2').closest('td')).toHaveClass('text-danger');
    // DR-38: a real minus sign and the Negative badge, as in My balances.
    expect(screen.getByText('−2').closest('td')).toHaveTextContent('−2Negative');
  });
});

describe('TC-S09: timer on a half-day leave', () => {
  it('warns and lets the user log time anyway', async () => {
    let attempts = 0;
    const fetch = api('MEMBER', (url, init) => {
      if (url.endsWith('/lookups')) return { status: 200, body: LOOKUPS };
      if (url.includes('/tracker/day')) return { status: 200, body: { day: trackerDay() } };
      if (url.includes('/tracker/running'))
        return { status: 200, body: { entry: null, now: '2026-10-09T04:00:00.000Z' } };
      if (url.endsWith('/tracker/start') && init?.method === 'POST') {
        attempts += 1;
        return attempts === 1
          ? {
              status: 409,
              body: {
                error: {
                  code: 'HALF_DAY_LEAVE',
                  message: 'You have half-day leave (AM) on Oct 9. Log time anyway?',
                  details: { half: 'AM' },
                },
              },
            }
          : { status: 201, body: { entry: null } };
      }
      if (url.includes('/tasks/mine'))
        return {
          status: 200,
          body: {
            items: [
              {
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
              },
            ],
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
        };
      return undefined;
    });
    renderAt('/my-tasks', <App />);
    const row = await screen.findByTestId('planned-t1');
    await userEvent.click(
      await within(row).findByRole('button', { name: 'Time in on Prepare UAT scripts' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Time in' });
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Activity type *'),
      'Configuration',
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('Module *'), 'Financials');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start timer' }));
    expect(
      await within(dialog).findByText('You have half-day leave (AM) on Oct 9. Log time anyway?'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Log time anyway' }));
    await waitFor(() => expect(attempts).toBe(2));
    const last = fetch.mock.calls.filter(([u]) => String(u).endsWith('/tracker/start')).at(-1)!;
    expect(JSON.parse(String(last[1]!.body))).toMatchObject({ taskId: 't1', confirmLeave: true });
  });
});

describe('TC-S07: Admin entitlements', () => {
  it('saves an entitlement below what is taken and shows the warning', async () => {
    api('ADMIN', (url, init) => {
      if (url.includes('/leave/types/all')) return { status: 200, body: { items: TYPES } };
      if (url.includes('/leave/entitlements') && init?.method === 'PUT')
        return {
          status: 200,
          body: {
            item: {
              user: { id: 'u3', name: 'A. Reyes' },
              leaveTypeId: '6510000000000000000000a1',
              year: 2026,
              entitlement: 4,
              carryOver: 0,
              taken: 6,
              balance: -2,
              negative: true,
            },
            warning:
              'A. Reyes has already taken 6 days of Vacation. Setting 4 makes the balance -2. The balance is flagged (EC-79).',
          },
        };
      if (url.includes('/leave/entitlements'))
        return {
          status: 200,
          body: {
            items: [
              {
                user: { id: 'u3', name: 'A. Reyes' },
                leaveTypeId: '6510000000000000000000a1',
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
    expect(await screen.findByRole('heading', { name: 'Leave types' })).toBeInTheDocument();
    expect(
      (await screen.findByText('Emergency', { selector: 'td' })).closest('tr'),
    ).toHaveTextContent('EmergencyPaidDayNoNone');
    const input = await screen.findByLabelText('A. Reyes entitlement');
    await userEvent.clear(input);
    await userEvent.type(input, '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        /A\. Reyes has already taken 6 days of Vacation\. Setting 4 makes the balance -2/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
