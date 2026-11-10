import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TimelineDto } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { timelineDto } from './cr22bFixtures';
import { PID, api, project, task } from './m2fixtures';
import { renderAt } from './utils';

/**
 * CR-22 Part B slice 2: forecast, Delayed, critical path, baseline and history (FR-TL-08 to 13,
 * 29 to 31; UIE §2.1 to 2.7). Fixture today is Wed Nov 11, 2026; target Mon Dec 14.
 *   b1 is past its planned finish (Nov 9), so it's Delayed and forecasts Nov 11 – Nov 20.
 *   b2 follows b1: Nov 23 – Nov 25. b3 (Dec 1 – Dec 3) is the forecast end and the only
 *   zero-float task; b1 and b2 have 5 working days of float (Nov 30 is a holiday).
 */
let compact = false;
beforeEach(() => {
  compact = false;
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: compact && q.includes('max-width'),
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

function mount(
  tl: TimelineDto = timelineDto(),
  role: 'PROJECT_MANAGER' | 'MEMBER' = 'PROJECT_MANAGER',
) {
  return api(role, (url, init) => {
    if (url.endsWith(`/projects/${PID}/baseline`) && init?.method === 'POST')
      return {
        status: 201,
        body: {
          baseline: {
            id: 'bl9',
            savedAt: '2026-11-11T02:00:00.000Z',
            savedBy: { id: 'u1', name: 'Test PM' },
            reason: null,
            taskCount: 5,
          },
        },
      };
    if (url.endsWith(`/projects/${PID}/timeline`)) return { status: 200, body: tl };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [] } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
    return undefined;
  });
}
const open = async () => {
  renderAt(`/projects/${PID}/timeline`, <App />);
  return screen.findByTestId('timeline');
};

/** The fixture with a saved baseline: b2's baseline finish is Nov 11, so it forecasts late. */
const withBaseline = () => {
  const base = timelineDto();
  return timelineDto({
    tasks: base.tasks.map((t) =>
      t.id === 'b2'
        ? { ...t, baselineStart: '2026-11-09', baselineFinish: '2026-11-11' }
        : t.id === 'a2'
          ? {
              ...t,
              actualFinish: '2026-10-14',
              baselineStart: '2026-10-12',
              baselineFinish: '2026-10-12',
            }
          : t,
    ),
    baselines: [
      {
        id: 'bl2',
        savedAt: '2026-10-12T01:30:00.000Z',
        savedBy: { id: 'u1', name: 'Test PM' },
        reason: 'Kickoff sign-off',
        taskCount: 5,
      },
      {
        id: 'bl1',
        savedAt: '2026-10-05T01:30:00.000Z',
        savedBy: { id: 'u1', name: 'Test PM' },
        reason: null,
        taskCount: 4,
      },
    ],
  });
};

describe('CR-22 B2: cards, Delayed and critical path (FR-TL-11 to 13)', () => {
  it('Forecast end vs target, Delayed count, no-baseline copy', async () => {
    mount();
    const tl = await open();
    expect(within(tl).getByTestId('card-forecast')).toHaveTextContent('Thu, Dec 3, 2026');
    expect(within(tl).getByTestId('forecast-variance')).toHaveTextContent(
      '\u22127 working days early',
    );
    expect(within(tl).getByTestId('card-delayed')).toHaveTextContent('1');
    expect(within(tl).getByText('Open and past their planned finish')).toBeInTheDocument();
    expect(within(tl).getByTestId('card-baseline')).toHaveTextContent('No baseline yet');
    expect(within(tl).getByText('Save one to compare plan with actual.')).toBeInTheDocument();
    expect(within(tl).getByTestId('row-b1')).toHaveTextContent('Delayed');
    expect(within(tl).getByTestId('var-b1')).toHaveTextContent('—');
    // The forecast is earlier than the target, so no Forecast pill or line.
    expect(within(tl).queryByTestId('forecast-line')).not.toBeInTheDocument();
    // b1 forecasts later than planned: a dashed forecast tail.
    expect(within(tl).getByTestId('forecast-b1')).toBeInTheDocument();
    // The Phase row's second line is the forecast.
    expect(within(tl).getByTestId('group-Build')).toHaveTextContent('Forecast Dec 3');
  });

  it('filters Delayed and Critical path; the switch turns the highlight off', async () => {
    mount();
    const tl = await open();
    await userEvent.click(within(tl).getByRole('button', { name: /^Delayed/ }));
    expect(within(tl).getByTestId('row-b1')).toBeInTheDocument();
    expect(within(tl).queryByTestId('row-b2')).not.toBeInTheDocument();
    await userEvent.click(within(tl).getByRole('button', { name: /^Critical path/ }));
    expect(within(tl).getByTestId('row-b3')).toHaveAttribute('data-critical', 'true');
    expect(within(tl).queryByTestId('row-b1')).not.toBeInTheDocument();
    await userEvent.click(within(tl).getByRole('button', { name: /^All/ }));
    expect(within(tl).getByTestId('row-a1')).not.toHaveAttribute('data-critical');
    await userEvent.click(within(tl).getByLabelText('Critical path', { selector: 'input' }));
    expect(within(tl).getByTestId('row-b3')).not.toHaveAttribute('data-critical');
  });

  it('popover: actual, forecast, float and the Delayed reason', async () => {
    mount();
    const tl = await open();
    await userEvent.click(within(tl).getByRole('button', { name: /^#3 Data migration scripts/ }));
    const pop = await screen.findByRole('tooltip');
    expect(within(pop).getByTestId('pop-actual')).toHaveTextContent('Not started');
    expect(within(pop).getByText('Nov 11 – Nov 20')).toBeInTheDocument();
    expect(within(pop).getByTestId('pop-float')).toHaveTextContent('5 working days');
    expect(within(pop).getByTestId('pop-delayed')).toHaveTextContent(
      'Delayed: not completed, and its planned finish (Nov 9) has passed.',
    );
  });

  it('forecast after the target: danger pill, dashed line and a late badge', async () => {
    mount(timelineDto({ project: { ...timelineDto().project, plannedEndDate: '2026-12-01' } }));
    const tl = await open();
    expect(within(tl).getByTestId('forecast-variance')).toHaveTextContent('+2 working days late');
    expect(within(tl).getByTestId('forecast-line')).toHaveAttribute('data-date', '2026-12-03');
    expect(within(tl).getByText('Forecast Dec 3', { selector: '.tlx-flag' })).toBeInTheDocument();
  });
});

describe('CR-22 B2: baseline (FR-TL-08, 09; UIE §2.7)', () => {
  it('baseline bars, variance, Finished late, the Baseline switch and history', async () => {
    mount(withBaseline());
    const tl = await open();
    expect(within(tl).getByTestId('card-baseline')).toHaveTextContent('Saved Oct 12, 2026');
    expect(
      within(tl).getByText('Open, and past due or forecast after baseline'),
    ).toBeInTheDocument();
    // b2 forecasts Nov 25 against a Nov 11 baseline finish: +10 working days, Delayed.
    expect(within(tl).getByTestId('var-b2')).toHaveTextContent('+10d');
    expect(within(tl).getByTestId('row-b2')).toHaveTextContent('Delayed');
    expect(within(tl).getByTestId('card-delayed')).toHaveTextContent('2');
    // a2 was done 2 working days after its baseline: neutral Finished late.
    expect(within(tl).getByTestId('row-a2')).toHaveTextContent('Finished late');
    expect(within(tl).getByTestId('baseline-b2')).toBeInTheDocument();
    await userEvent.click(within(tl).getByLabelText('Baseline', { selector: 'input' }));
    expect(within(tl).queryByTestId('baseline-b2')).not.toBeInTheDocument();

    await userEvent.click(within(tl).getByRole('button', { name: 'Baseline history (2)' }));
    const dialog = await screen.findByRole('dialog');
    const rows = within(within(dialog).getByTestId('baseline-history')).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('Current');
    expect(rows[1]).toHaveTextContent('Kickoff sign-off');
    expect(rows[2]).toHaveTextContent('—');
    expect(dialog).toHaveTextContent('Times in Philippine time.');
  });

  it('Save baseline: confirm copy, optional reason, then the toast', async () => {
    const m = mount(withBaseline());
    const tl = await open();
    await userEvent.click(within(tl).getByRole('button', { name: 'Save baseline' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'This copies the planned start and finish of all 6 tasks into their baseline.',
    );
    expect(dialog).toHaveTextContent(
      'The current baseline (saved Oct 12, 2026 by Test PM) is replaced. It stays in Baseline history.',
    );
    expect(dialog).toHaveTextContent('1 task has no dates, so its baseline stays empty.');
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Re-plan');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save baseline' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Baseline saved for 5 tasks. It\u2019s now the current entry in Baseline history.',
        ),
      ).toBeInTheDocument(),
    );
    const call = m.mock.calls.find(
      ([u, i]) => String(u).endsWith('/baseline') && i?.method === 'POST',
    );
    expect(JSON.parse(String(call![1]!.body))).toEqual({ reason: 'Re-plan' });
  });

  it('read-only users get no Save baseline; on a phone it shows the larger-screen message', async () => {
    mount(
      timelineDto({
        can: { plan: false, editPhaseTargets: false, editPhaseNames: false, saveBaseline: false },
      }),
      'MEMBER',
    );
    const tl = await open();
    expect(within(tl).queryByRole('button', { name: 'Save baseline' })).not.toBeInTheDocument();
  });

  it('phone: Save baseline is view-only and the list shows Critical and Var.', async () => {
    compact = true;
    mount();
    const tl = await open();
    await userEvent.click(within(tl).getByRole('button', { name: 'Save baseline' }));
    expect(
      within(tl).getByText('Open this on a larger screen to make changes.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(tl).getByTestId('list-group-Build')).toHaveTextContent('Critical');
    expect(within(tl).getByTestId('list-group-Build')).toHaveTextContent('Var. —');
  });
});

describe('CR-22 B2: task form actual dates (FR-TL-10)', () => {
  it('the PM corrects the actual start; only changed actual dates are sent', async () => {
    const tasks = [
      task({
        id: 'k1',
        order: 1,
        name: 'Kickoff',
        status: 'IN_PROGRESS',
        actualStart: '2026-11-04',
      }),
    ];
    const m = api('PROJECT_MANAGER', (url, init) => {
      if (url.includes('/tasks/') && init?.method === 'PATCH')
        return { status: 200, body: { task: tasks[0] } };
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: tasks } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
      return undefined;
    });
    renderAt(`/projects/${PID}`, <App />);
    await screen.findByText('Kickoff');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Kickoff' }));
    const dialog = await screen.findByRole('dialog');
    const start = within(dialog).getByLabelText('Actual start');
    expect(start).toHaveValue('2026-11-04');
    await userEvent.clear(start);
    await userEvent.type(start, '2026-11-03');
    const finish = within(dialog).getByLabelText('Actual finish');
    await userEvent.type(finish, '2026-11-02');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save task' }));
    expect(
      within(dialog).getByText('Actual finish can\u2019t be before actual start.'),
    ).toBeInTheDocument();
    await userEvent.clear(finish);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save task' }));
    await waitFor(() => {
      const call = m.mock.calls.find(
        ([u, i]) => String(u).includes('/tasks/k1') && i?.method === 'PATCH',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String(call![1]!.body));
      expect(body.actualStart).toBe('2026-11-03');
      expect(body).not.toHaveProperty('actualFinish');
    });
  });
});
