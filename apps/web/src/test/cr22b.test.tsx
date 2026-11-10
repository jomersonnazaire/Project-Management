import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskDto, TimelineDto } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { timelineDto } from './cr22bFixtures';
import { PID, api, project, task } from './m2fixtures';
import { renderAt } from './utils';

/** CR-22 Part B slice 1: the Timeline tab (FR-TL-01 to 07, 14, 23; UIE mockup v0.9.20). */
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

function timelineApi(
  tl: TimelineDto = timelineDto(),
  role: 'PROJECT_MANAGER' | 'MEMBER' = 'PROJECT_MANAGER',
  tasks: TaskDto[] = [],
) {
  return api(role, (url, init) => {
    if (url.endsWith(`/projects/${PID}/phase-list`) && init?.method === 'PUT')
      return {
        status: 200,
        body: { items: tl.phases, targetsOnly: !tl.can.editPhaseNames, changed: 1 },
      };
    if (url.endsWith(`/projects/${PID}/timeline`)) return { status: 200, body: tl };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: tasks } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
    return undefined;
  });
}

const open = async () => {
  renderAt(`/projects/${PID}/timeline`, <App />);
  return screen.findByTestId('timeline');
};

describe('CR-22 B: Timeline tab (desktop)', () => {
  it('FR-TL-01..05: cards, phases in list order, milestone marker, target line, Unscheduled last', async () => {
    timelineApi();
    const tl = await open();
    expect(within(tl).getByTestId('card-target')).toHaveTextContent('Mon, Dec 14, 2026');
    expect(within(tl).getByTestId('card-baseline')).toHaveTextContent('No baseline yet');
    const groups = within(tl)
      .getAllByTestId(/^group-/)
      .map((g) => g.getAttribute('data-testid'));
    expect(groups).toEqual(['group-Initiation', 'group-Build', 'group-Spare', 'group-Unscheduled']);
    const init = within(tl).getByTestId('group-Initiation');
    expect(init).toHaveTextContent('Target Oct 12');
    expect(init).toHaveTextContent('Completed Oct 12');
    expect(init).toHaveTextContent('On time');
    expect(
      within(tl).getByRole('button', { name: /^Milestone #2 Charter signed, Oct 12/ }),
    ).toBeInTheDocument();
    expect(within(tl).getByTestId('target-line')).toHaveAttribute('data-date', '2026-12-14');
    const unscheduled = within(tl).getByTestId('row-u1');
    expect(unscheduled).toHaveTextContent('#5 depends on it; that link is ignored.');
    expect(unscheduled).toHaveTextContent(
      'No dates, so it is left out of the critical path and forecast.',
    );
    expect(within(tl).getByTestId('row-b3')).toContainElement(
      within(tl).getByRole('img', { name: 'Linked task has no dates' }),
    );
    expect(within(tl).getByTestId('timeline-legend')).toBeInTheDocument();
    expect(within(tl).getByRole('button', { name: /Phases/ })).toBeInTheDocument();
    expect(screen.queryByText(/View only/)).not.toBeInTheDocument();
  });

  it('FR-TL-06/07: FS links drawn; a broken one is red with the banner and popover box', async () => {
    timelineApi();
    const tl = await open();
    expect(tl.querySelector('[data-testid="link-a1-a2"]')).toHaveAttribute('data-state', 'OK');
    expect(tl.querySelector('[data-testid="link-b1-b2"]')).toHaveAttribute('data-state', 'BROKEN');
    const banner = within(tl).getByTestId('broken-banner');
    expect(banner).toHaveTextContent('1 broken dependency.');
    expect(banner).toHaveTextContent(
      '#4 Load test data is planned to start Nov 9, but #3 Data migration scripts finishes Nov 9. Dates weren’t moved.',
    );
    await userEvent.click(
      within(tl).getByRole('button', {
        name: /^#4 Load test data, Nov 9 to Nov 11, broken dependency/,
      }),
    );
    const pop = await screen.findByRole('tooltip');
    expect(pop).toHaveTextContent('#4 Load test data');
    expect(pop).toHaveTextContent('Starts before a task it depends on finishes.');
    expect(pop).toHaveTextContent('#3 Data migration scripts finishes Nov 9. You can still save.');
    expect(within(pop).getByRole('button', { name: 'Open task' })).toHaveFocus();
    await userEvent.click(within(pop).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('Milestones filter shows only milestone rows; groups collapse', async () => {
    timelineApi();
    const tl = await open();
    await userEvent.click(within(tl).getByRole('button', { name: /^Milestones/ }));
    expect(within(tl).queryByTestId('row-b1')).not.toBeInTheDocument();
    expect(within(tl).getByTestId('row-a2')).toBeInTheDocument();
    await userEvent.click(within(tl).getByRole('button', { name: /^All/ }));
    await userEvent.click(within(tl).getByRole('button', { name: 'Collapse Build' }));
    expect(within(tl).queryByTestId('row-b1')).not.toBeInTheDocument();
    expect(within(tl).getByRole('button', { name: 'Expand Build' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('Q-142: read-only users get the lock note and no planner buttons', async () => {
    timelineApi(
      timelineDto({
        can: { plan: false, editPhaseTargets: false, editPhaseNames: false, saveBaseline: false, excel: false, importExcel: false },
      }),
      'MEMBER',
    );
    const tl = await open();
    expect(
      within(tl).getByText(
        'View only. The project PM or an Admin changes dates, phases and the baseline.',
      ),
    ).toBeInTheDocument();
    expect(within(tl).queryByRole('button', { name: /Phases/ })).not.toBeInTheDocument();
  });

  it('EC-188: no scheduled tasks shows the empty state with the no-dates count', async () => {
    const base = timelineDto();
    timelineApi({ ...base, tasks: base.tasks.map((t) => ({ ...t, plannedStart: null })).slice(2) });
    const tl = await open();
    const empty = within(tl).getByTestId('timeline-empty');
    expect(empty).toHaveTextContent('No scheduled tasks');
    expect(empty).toHaveTextContent(
      'A task needs both a start and a finish to show on the timeline.',
    );
    expect(empty).toHaveTextContent('4 tasks have no dates yet.');
    expect(within(empty).getByTestId('target-line')).toBeInTheDocument();
    expect(within(empty).getByRole('link', { name: 'Open Checklist' })).toBeInTheDocument();
  });
});

describe('CR-22 B: phase manager (FR-TL-23, UIE §2.7)', () => {
  it('Active PM: names, order, remove and add are locked; target dates save', async () => {
    const m = timelineApi();
    const tl = await open();
    await userEvent.click(within(tl).getByRole('button', { name: /Phases/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('phase-lock-alert')).toHaveTextContent(
      'This project is Active. You can change target completion dates.',
    );
    const names = within(dialog).getAllByLabelText('Phase name');
    expect(names[0]).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '+ Add phase' })).toBeDisabled();
    expect(within(dialog).getAllByRole('button', { name: 'Remove' })[2]).toBeDisabled();
    expect(names[0]!.closest('.tlx-locked')).toHaveAttribute(
      'title',
      'Phases can be added, renamed or removed only while the project is in Planning',
    );
    const date = within(dialog).getByLabelText('Target completion for Build');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-12-08');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save phases' }));
    await waitFor(() => {
      const put = m.mock.calls.find(
        ([u, i]) => String(u).endsWith('/phase-list') && i?.method === 'PUT',
      );
      expect(JSON.parse(String(put![1]!.body))).toEqual({
        phases: [
          { id: 'ph1', originalName: null, name: 'Initiation', targetDate: '2026-10-12' },
          { id: 'ph2', originalName: null, name: 'Build', targetDate: '2026-12-08' },
          { id: 'ph3', originalName: null, name: 'Spare', targetDate: null },
        ],
      });
    });
    expect(
      await screen.findByText(
        'Phase target dates saved. The change is recorded in the project history.',
      ),
    ).toBeInTheDocument();
  });

  it('Planning PM: add, reorder and remove an empty phase; duplicate names are caught', async () => {
    const m = timelineApi(
      timelineDto({
        can: { plan: true, editPhaseTargets: true, editPhaseNames: true, saveBaseline: true, excel: true, importExcel: true },
      }),
    );
    const tl = await open();
    await userEvent.click(within(tl).getByRole('button', { name: /Phases/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('phase-lock-alert')).not.toBeInTheDocument();
    const removes = within(dialog).getAllByRole('button', { name: 'Remove' });
    expect(removes[1]).toBeDisabled();
    expect(removes[1]!.closest('.tlx-locked')).toHaveAttribute(
      'title',
      'Move its tasks to another phase first',
    );
    await userEvent.click(removes[2]!);
    await userEvent.click(within(dialog).getByRole('button', { name: '+ Add phase' }));
    const names = within(dialog).getAllByLabelText('Phase name');
    await userEvent.type(names[2]!, ' build ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save phases' }));
    expect(
      await within(dialog).findByText('There’s already a phase with this name.'),
    ).toBeInTheDocument();
    await userEvent.clear(names[2]!);
    await userEvent.type(names[2]!, 'Go-live');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move Build up' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save phases' }));
    await waitFor(() => {
      const put = m.mock.calls.find(
        ([u, i]) => String(u).endsWith('/phase-list') && i?.method === 'PUT',
      );
      expect(JSON.parse(String(put![1]!.body)).phases.map((p: { name: string }) => p.name)).toEqual(
        ['Build', 'Initiation', 'Go-live'],
      );
    });
  });
});

describe('CR-22 B: phone (UIE §4, Q-143)', () => {
  it('opens on the List view, read-only by design: Phases shows the larger-screen message', async () => {
    compact = true;
    timelineApi();
    const tl = await open();
    expect(within(tl).getByTestId('timeline-list')).toBeInTheDocument();
    expect(
      within(tl).getByText('On a phone you can view the timeline and open task details.'),
    ).toBeInTheDocument();
    expect(within(tl).getByTestId('list-group-Build')).toHaveTextContent(
      '#3 Data migration scripts',
    );
    await userEvent.click(within(tl).getByRole('button', { name: /Phases/ }));
    expect(
      await screen.findByText('Open this on a larger screen to make changes.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(within(tl).getByRole('button', { name: 'Gantt' }));
    expect(within(tl).getByTestId('gantt')).toBeInTheDocument();
  });
});

describe('CR-22 B: task form warns on a broken dependency (FR-TL-07, AC-72.8)', () => {
  it('shows the warning and still saves', async () => {
    const tasks = [
      task({
        id: 'k1',
        order: 1,
        name: 'Kickoff',
        phase: 'Build',
        plannedStart: '2026-11-02',
        dueDate: '2026-11-09',
      }),
      task({
        id: 'k2',
        order: 2,
        name: 'Workshops',
        phase: 'Build',
        plannedStart: '2026-11-10',
        dueDate: '2026-11-12',
        dependsOn: ['k1'],
      }),
    ];
    const m = api('PROJECT_MANAGER', (url, init) => {
      if (url.includes('/tasks/') && init?.method === 'PATCH')
        return { status: 200, body: { task: tasks[1] } };
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: tasks } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
      return undefined;
    });
    renderAt(`/projects/${PID}`, <App />);
    await screen.findByText('Kickoff');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Workshops' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('task-broken-dependency')).not.toBeInTheDocument();
    const start = within(dialog).getByLabelText(/Planned start|Start date|Start/);
    await userEvent.clear(start);
    await userEvent.type(start, '2026-11-09');
    expect(within(dialog).getByTestId('task-broken-dependency')).toHaveTextContent(
      'Starts before a task it depends on finishes. #1 Kickoff finishes Nov 9. You can still save.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save task' }));
    await waitFor(() =>
      expect(
        m.mock.calls.some(([u, i]) => String(u).includes('/tasks/k2') && i?.method === 'PATCH'),
      ).toBe(true),
    );
  });
});

describe('CR-22 B (Lead): phase pick and the on-or-before broken rule', () => {
  const phases = [
    {
      id: 'ph1',
      name: 'Initiation',
      taskCount: 0,
      documentCount: 0,
      deletable: false,
      deleteBlockedReason: null,
      editable: true,
    },
    {
      id: 'ph2',
      name: 'Build',
      taskCount: 2,
      documentCount: 0,
      deletable: false,
      deleteBlockedReason: null,
      editable: true,
    },
  ];
  const tasks = [
    task({
      id: 'k1',
      order: 1,
      name: 'Kickoff',
      phaseId: 'ph2',
      phase: 'Build',
      plannedStart: '2026-11-02',
      dueDate: '2026-11-06',
    }),
    task({
      id: 'k2',
      order: 2,
      name: 'Workshops',
      phaseId: 'ph2',
      phase: 'Build',
      plannedStart: '2026-11-09',
      dueDate: '2026-11-12',
      dependsOn: ['k1'],
    }),
  ];
  const mount = () =>
    api('PROJECT_MANAGER', (url, init) => {
      if (url.includes('/tasks/') && init?.method === 'PATCH')
        return { status: 200, body: { task: tasks[1] } };
      if (url.endsWith(`/projects/${PID}/phases`)) return { status: 200, body: { items: phases } };
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: tasks } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
      return undefined;
    });

  it('the phase is a strict pick of the project phases plus No phase, saved by phaseId', async () => {
    const m = mount();
    renderAt(`/projects/${PID}`, <App />);
    await screen.findByText('Kickoff');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Workshops' }));
    const dialog = await screen.findByRole('dialog');
    const pick = within(dialog).getByLabelText('Phase') as HTMLSelectElement;
    expect(pick.tagName).toBe('SELECT');
    await waitFor(() =>
      expect([...pick.options].map((o) => o.text)).toEqual(['No phase', 'Initiation', 'Build']),
    );
    expect(pick.value).toBe('ph2');
    expect(within(dialog).getByText(/New phases are added in Phases/)).toBeInTheDocument();
    await userEvent.selectOptions(pick, 'Initiation');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save task' }));
    await waitFor(() => {
      const call = m.mock.calls.find(
        ([u, i]) => String(u).includes('/tasks/k2') && i?.method === 'PATCH',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String(call![1]!.body));
      expect(body.phaseId).toBe('ph1');
      expect(body).not.toHaveProperty('phase');
    });
  });

  it('AC-72.4: a Saturday start after a Friday finish is not broken; a same-day start is', async () => {
    mount();
    renderAt(`/projects/${PID}`, <App />);
    await screen.findByText('Kickoff');
    await userEvent.click(screen.getByRole('button', { name: 'Edit Workshops' }));
    const dialog = await screen.findByRole('dialog');
    const start = within(dialog).getByLabelText(/Planned start|Start date|Start/);
    await userEvent.clear(start);
    await userEvent.type(start, '2026-11-07');
    expect(within(dialog).queryByTestId('task-broken-dependency')).not.toBeInTheDocument();
    await userEvent.clear(start);
    await userEvent.type(start, '2026-11-06');
    expect(within(dialog).getByTestId('task-broken-dependency')).toBeInTheDocument();
  });
});
