import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SystemRole, TaskDto, TemplateActivityDto, TemplateDto } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { PID, api, project, task } from './m2fixtures';
import { renderAt } from './utils';

/**
 * PR #3 UX follow-ups (doc 12 §3.1, mockup v0.6): "+ Add activity to Phase N", ⋮⋮ reordering with
 * Alt+↑/↓, and Checklist phase cards that open and close from the header.
 */
afterEach(() => vi.unstubAllGlobals());

/** A DataTransfer stand-in for jsdom, shared across dragstart / dragover / drop. */
function dataTransfer() {
  const data: Record<string, string> = {};
  return {
    data,
    effectAllowed: 'all',
    get types() {
      return Object.keys(data);
    },
    setData: (t: string, v: string) => (data[t] = v),
    getData: (t: string) => data[t] ?? '',
  };
}

/** Drags a row by its ⋮⋮ handle onto another row; returns whether the target accepted it. */
function drag(name: string, onto: HTMLElement) {
  const dt = dataTransfer();
  fireEvent.dragStart(screen.getByRole('button', { name: `Reorder ${name}` }), {
    dataTransfer: dt,
  });
  const over = createEvent.dragOver(onto, { dataTransfer: dt });
  fireEvent(onto, over);
  fireEvent.drop(onto, { dataTransfer: dt });
  return over.defaultPrevented;
}

const activity = (id: string, phaseId: string, name: string, dependsOn: string[] = []) =>
  ({
    id,
    phaseId,
    name,
    taskType: null,
    priority: 'MEDIUM',
    mandatory: true,
    party: 'INTERNAL',
    defaultJobRole: null,
    defaultTeamId: null,
    estHours: 4,
    offsetDays: 0,
    durationDays: 1,
    deliverable: null,
    requiresApproval: false,
    isMilestone: false,
    dependsOn,
  }) satisfies TemplateActivityDto;

const draft: TemplateDto = {
  id: 't2',
  templateKey: 'k',
  name: 'SAP B1 Implementation',
  description: null,
  type: 'SAP_B1',
  version: 2,
  status: 'DRAFT',
  superseded: false,
  phaseCount: 2,
  activityCount: 4,
  dependencyCount: 1,
  deliverableCount: 0,
  projectCount: 0,
  publishedAt: null,
  updatedAt: '2026-10-09T00:00:00.000Z',
  draftId: null,
  phases: [
    { id: 'p1', name: 'Discovery' },
    { id: 'p2', name: 'Build' },
  ],
  activities: [
    activity('a1', 'p1', 'Kickoff'),
    activity('a2', 'p1', 'Workshops', ['a1']),
    activity('a3', 'p2', 'Configure'),
    activity('a4', 'p2', 'Data migration'),
  ],
  versions: [{ id: 't2', version: 2, status: 'DRAFT', superseded: false, publishedAt: null }],
};

function templateApi(role: SystemRole = 'PROJECT_MANAGER') {
  return api(role, (url, init) => {
    if (url.endsWith('/templates/t2'))
      return {
        status: 200,
        body: { template: init?.method === 'PATCH' ? JSON.parse(String(init.body)) : draft },
      };
    return undefined;
  });
}

async function savedActivities(fetchMock: ReturnType<typeof templateApi>) {
  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  let body: { activities: TemplateActivityDto[] } | undefined;
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
    expect(call).toBeTruthy();
    body = JSON.parse(String(call![1]!.body));
  });
  return body!.activities;
}

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

describe('Template editor: "+ Add activity to Phase N" (FR-TPL-12, AC-37.1)', () => {
  it('creates the activity in that phase with no phase picker, at the end of the phase', async () => {
    const fetchMock = templateApi();
    renderAt('/templates/t2', <App />);
    await screen.findByText('Kickoff');
    expect(screen.getByRole('button', { name: '+ Add activity to Phase 1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Add activity to Phase 2' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Phase')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('act-phase-fixed')).toHaveTextContent('Build');
    await userEvent.type(within(dialog).getByLabelText('Activity name'), 'Go-live');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add activity' }));

    const acts = await savedActivities(fetchMock);
    expect(acts.map((a) => [a.name, a.phaseId])).toEqual([
      ['Kickoff', 'p1'],
      ['Workshops', 'p1'],
      ['Configure', 'p2'],
      ['Data migration', 'p2'],
      ['Go-live', 'p2'],
    ]);
  });

  it('a new activity in Phase 1 goes after Phase 1’s last activity, before Phase 2', async () => {
    const fetchMock = templateApi();
    renderAt('/templates/t2', <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add activity to Phase 1' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Activity name'), 'Sign-off');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add activity' }));
    const acts = await savedActivities(fetchMock);
    expect(acts.map((a) => a.id).slice(0, 3)).toEqual(['a1', 'a2', expect.any(String)]);
    expect(acts[2]).toMatchObject({ name: 'Sign-off', phaseId: 'p1' });
  });

  it('editing an existing activity still offers the phase picker ("move to phase…")', async () => {
    templateApi();
    renderAt('/templates/t2', <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Configure' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Phase')).toHaveValue('p2');
  });
});

describe('Template editor: reordering (FR-TPL-13)', () => {
  it('Move up / Move down reorders within the phase, keeps dependencies, and saves with the draft', async () => {
    const fetchMock = templateApi();
    renderAt('/templates/t2', <App />);
    await screen.findByText('Kickoff');
    expect(screen.getByRole('button', { name: 'Move Kickoff up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Workshops down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Configure up' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Move Workshops up' }));
    const acts = await savedActivities(fetchMock);
    expect(acts.map((a) => a.id)).toEqual(['a2', 'a1', 'a3', 'a4']);
    expect(acts.find((a) => a.id === 'a2')!.dependsOn).toEqual(['a1']);
  });

  it('Alt+↑ / Alt+↓ on the ⋮⋮ handle is the keyboard alternative; plain arrows do nothing', async () => {
    const fetchMock = templateApi();
    renderAt('/templates/t2', <App />);
    await screen.findByText('Kickoff');
    const handle = screen.getByRole('button', { name: 'Reorder Configure' });
    expect(handle).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'ArrowUp', altKey: true }); // already first: no-op
    fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true });
    const acts = await savedActivities(fetchMock);
    expect(acts.map((a) => a.id)).toEqual(['a1', 'a2', 'a4', 'a3']);
  });

  it('dragging the handle reorders within a phase, and into another phase moves it there', async () => {
    const fetchMock = templateApi();
    renderAt('/templates/t2', <App />);
    await screen.findByText('Kickoff');
    expect(drag('Data migration', rowOf('Configure'))).toBe(true);
    expect(drag('Workshops', rowOf('Configure'))).toBe(true);
    const acts = await savedActivities(fetchMock);
    expect(acts.map((a) => [a.id, a.phaseId])).toEqual([
      ['a1', 'p1'],
      ['a4', 'p2'],
      ['a2', 'p2'],
      ['a3', 'p2'],
    ]);
    // Dependencies follow ids, so moving never breaks them.
    expect(acts.find((a) => a.id === 'a2')!.dependsOn).toEqual(['a1']);
  });

  it('read-only users get no handles or reorder controls', async () => {
    templateApi('MEMBER');
    renderAt('/templates/t2', <App />);
    await screen.findByText('Kickoff');
    expect(screen.queryByRole('button', { name: /^(Move|Reorder) / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add activity/ })).not.toBeInTheDocument();
  });
});

describe('Project Checklist (FR-PRJ-14..16)', () => {
  const tasks: TaskDto[] = [
    task({ id: 'k1', order: 1, name: 'Kickoff', phase: 'Discovery', status: 'COMPLETED' }),
    task({ id: 'k2', order: 2, name: 'Workshops', phase: 'Discovery', dependsOn: ['k1'] }),
    task({ id: 'k3', order: 3, name: 'Configure', phase: 'Build' }),
    task({ id: 'k4', order: 4, name: 'Ad hoc', phase: null }),
    task({ id: 'k5', order: 5, name: 'Extra', phase: null }),
  ];

  function checklistApi(
    p = project(),
    reply: (body: { phase: string | null; taskIds: string[] }) => {
      status: number;
      body?: unknown;
    } = (b) => ({
      status: 200,
      body: {
        items: [
          ...tasks.filter((t) => (t.phase ?? null) !== b.phase),
          ...b.taskIds.map((id) => tasks.find((t) => t.id === id)!),
        ],
      },
    }),
  ) {
    return api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith(`/projects/${PID}/tasks/reorder`) && init?.method === 'POST')
        return reply(JSON.parse(String(init.body)));
      if (url.endsWith(`/projects/${PID}/tasks`) && init?.method === 'POST')
        return { status: 201, body: { task: task({ id: 'k9', name: 'New' }) } };
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: tasks } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: p } };
      return undefined;
    });
  }

  const calls = (fetchMock: ReturnType<typeof checklistApi>, suffix: string) =>
    fetchMock.mock.calls
      .filter(([u, i]) => String(u).endsWith(suffix) && i?.method === 'POST')
      .map(([, i]) => JSON.parse(String(i!.body)));

  afterEach(() => localStorage.clear());

  it('clicking anywhere on a phase header, or Enter / Space on it, opens and closes the phase', async () => {
    checklistApi();
    renderAt(`/projects/${PID}`, <App />);
    const header = await screen.findByRole('button', { name: /Discovery/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(header).toHaveAttribute('tabindex', '0');
    expect(header).toHaveTextContent('2 activities · 1 done');
    expect(screen.getByRole('button', { name: /Build/ })).toHaveTextContent('1 activity · 0 done');

    await userEvent.click(within(header).getByText('2 activities · 1 done'));
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Kickoff')).not.toBeVisible();
    header.focus();
    await userEvent.keyboard('{Enter}');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Kickoff')).toBeVisible();
    await userEvent.keyboard(' ');
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('remembers closed phases per user per project', async () => {
    checklistApi();
    const first = renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: /Build/ }));
    first.unmount();
    renderAt(`/projects/${PID}`, <App />);
    expect(await screen.findByRole('button', { name: /Build/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: /Discovery/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(Object.keys(localStorage)).toEqual([
      `xc8.checklist.collapsed.me-PROJECT_MANAGER.${PID}`,
    ]);
  });

  it('Alt+↓ on the ⋮⋮ handle sends the phase’s new order to the reorder endpoint', async () => {
    const fetchMock = checklistApi();
    renderAt(`/projects/${PID}`, <App />);
    const handle = await screen.findByRole('button', { name: 'Reorder Kickoff' });
    handle.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() =>
      expect(calls(fetchMock, '/tasks/reorder')).toEqual([
        { phase: 'Discovery', taskIds: ['k2', 'k1'] },
      ]),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Moved Kickoff to position 2 of 2 in Discovery.',
    );
    // The body carries only ids: no dependencies, dates, owners or status.
    expect(Object.keys(calls(fetchMock, '/tasks/reorder')[0])).toEqual(['phase', 'taskIds']);
  });

  it('dragging the handle reorders; tasks without a phase go as phase null; no drops across phases', async () => {
    const fetchMock = checklistApi();
    renderAt(`/projects/${PID}`, <App />);
    await screen.findByText('Extra');
    expect(drag('Extra', rowOf('Ad hoc'))).toBe(true);
    expect(drag('Configure', rowOf('Kickoff'))).toBe(false);
    await waitFor(() =>
      expect(calls(fetchMock, '/tasks/reorder')).toEqual([{ phase: null, taskIds: ['k5', 'k4'] }]),
    );
  });

  it('shows the API error when someone else reordered meanwhile (EC-63)', async () => {
    checklistApi(project(), () => ({
      status: 409,
      body: {
        error: {
          code: 'ORDER_CHANGED',
          message: 'The task list changed. Refresh to see the latest order.',
        },
      },
    }));
    renderAt(`/projects/${PID}`, <App />);
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Reorder Workshops' }), {
      key: 'ArrowUp',
      altKey: true,
    });
    expect(
      await screen.findByText('The task list changed. Refresh to see the latest order.'),
    ).toBeInTheDocument();
  });

  it('FR-PRJ-18 each row’s ⋮ menu has Move up / Move down, greyed out at the ends of a phase', async () => {
    const fetchMock = checklistApi();
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Kickoff' }));
    expect(await screen.findByRole('button', { name: 'Move up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Move down' })).not.toHaveAttribute('aria-disabled');
    // A greyed-out item does nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Move up' }));
    expect(calls(fetchMock, '/tasks/reorder')).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Kickoff' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move down' }));
    await waitFor(() =>
      expect(calls(fetchMock, '/tasks/reorder')).toEqual([
        { phase: 'Discovery', taskIds: ['k2', 'k1'] },
      ]),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Moved Kickoff to position 2 of 2 in Discovery.',
    );
  });

  it('FR-PRJ-18 Move up on the last row of a phase; a single-row phase has both greyed out', async () => {
    const fetchMock = checklistApi();
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Extra' }));
    expect(await screen.findByRole('button', { name: 'Move down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move up' }));
    await waitFor(() =>
      expect(calls(fetchMock, '/tasks/reorder')).toEqual([{ phase: null, taskIds: ['k5', 'k4'] }]),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Configure' }));
    const menu = screen.getByRole('button', { name: 'Actions for Configure' }).parentElement!;
    expect(within(menu).getByRole('button', { name: 'Move up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(within(menu).getByRole('button', { name: 'Move down' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('"+ Add activity to Phase N" adds a task in that phase with no phase picker', async () => {
    const fetchMock = checklistApi();
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add activity to Phase 2' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Phase')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('task-phase-fixed')).toHaveTextContent('Build');
    await userEvent.type(within(dialog).getByLabelText('Task name'), 'Go-live');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add task' }));
    await waitFor(() =>
      expect(calls(fetchMock, `/projects/${PID}/tasks`)).toEqual([
        expect.objectContaining({ name: 'Go-live', phase: 'Build' }),
      ]),
    );
    // Tasks without a phase get a plain "+ Add activity".
    expect(screen.getByRole('button', { name: '+ Add activity' })).toBeInTheDocument();
  });

  it('no handles or add buttons without plan rights or on an archived project', async () => {
    checklistApi(
      project({
        can: { edit: false, archive: false, delete: false, planTasks: false, activity: true },
      }),
    );
    const { unmount } = renderAt(`/projects/${PID}`, <App />);
    await screen.findByText('Kickoff');
    expect(screen.queryByRole('button', { name: /^Reorder / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add activity/ })).not.toBeInTheDocument();
    // Opening and closing phases is for everyone.
    expect(screen.getByRole('button', { name: /Discovery/ })).toHaveAttribute('aria-expanded');
    unmount();
    vi.unstubAllGlobals();

    checklistApi(project({ archived: true }));
    renderAt(`/projects/${PID}`, <App />);
    await screen.findByText('Kickoff');
    expect(screen.queryByRole('button', { name: /^Reorder / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for / })).not.toBeInTheDocument();
  });
});
