import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskDto } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { PID, api, project, task } from './m2fixtures';
import { renderAt } from './utils';

afterEach(() => vi.unstubAllGlobals());

const tasks: TaskDto[] = [
  task({ id: 'k1', order: 1, name: 'Kickoff', phase: 'Discovery' }),
  task({ id: 'k2', order: 2, name: 'Workshops', phase: 'Discovery', dependsOn: ['k1'] }),
  task({ id: 'k3', order: 3, name: 'Configure', phase: 'Build', dependsOn: ['k2'] }),
  task({ id: 'k4', order: 4, name: 'Ad hoc', phase: 'Build' }),
];

function checklistApi(p = project(), patchReply: Record<string, unknown> = {}) {
  return api('PROJECT_MANAGER', (url, init) => {
    if (url.includes('/tasks/') && init?.method === 'PATCH')
      return { status: 200, body: { task: tasks[1], ...patchReply } };
    if (url.endsWith(`/projects/${PID}`) && init?.method === 'PATCH')
      return { status: 200, body: { project: p, ...patchReply } };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: tasks } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: p } };
    return undefined;
  });
}

const patchBody = (fetchMock: ReturnType<typeof checklistApi>, part: string) => {
  const call = fetchMock.mock.calls.filter(
    ([u, i]) => String(u).includes(part) && i?.method === 'PATCH',
  );
  return JSON.parse(String(call.at(-1)![1]!.body));
};

async function editWorkshops() {
  renderAt(`/projects/${PID}`, <App />);
  await screen.findByText('Kickoff');
  await userEvent.click(screen.getByRole('button', { name: 'Edit Workshops' }));
  return screen.findByRole('dialog');
}

describe('CR-22 A3: Depends On picker', () => {
  it('adds a second dependency with a plain click, removes one by its chip, and saves', async () => {
    const fetchMock = checklistApi();
    const dialog = await editWorkshops();
    const kickoff = within(dialog).getByRole('checkbox', { name: '#1 Kickoff' });
    expect(kickoff).toBeChecked();
    // A plain click adds (it used to replace the selection in a native multi-select).
    await userEvent.click(within(dialog).getByRole('checkbox', { name: '#4 Ad hoc' }));
    expect(kickoff).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: '#4 Ad hoc' })).toBeChecked();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove dependency #1 Kickoff' }),
    );
    expect(kickoff).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save task' }));
    await waitFor(() => expect(patchBody(fetchMock, '/tasks/k2').dependsOn).toEqual(['k4']));
  });

  it('Clear all sends an empty list; the task itself and tasks depending on it can’t be picked', async () => {
    const fetchMock = checklistApi();
    const dialog = await editWorkshops();
    expect(within(dialog).queryByRole('checkbox', { name: /Workshops/ })).not.toBeInTheDocument();
    // Configure depends on Workshops: picking it would be a cycle.
    expect(within(dialog).getByRole('checkbox', { name: /#3 Configure/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear all' }));
    expect(within(dialog).queryByTestId('task-deps-chips')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save task' }));
    await waitFor(() => expect(patchBody(fetchMock, '/tasks/k2').dependsOn).toEqual([]));
  });

  it('works from the keyboard: Space toggles the focused checkbox', async () => {
    checklistApi();
    const dialog = await editWorkshops();
    const adhoc = within(dialog).getByRole('checkbox', { name: '#4 Ad hoc' });
    adhoc.focus();
    await userEvent.keyboard(' ');
    expect(adhoc).toBeChecked();
    expect(within(dialog).getByTestId('task-deps-chips')).toHaveTextContent('#4 Ad hoc');
  });
});

describe('CR-22 A3: Depends On search', () => {
  it('a long list gets a search box that filters the options', async () => {
    const many = [
      ...tasks,
      ...['Data load', 'Training', 'Cutover', 'Go-live'].map((name, i) =>
        task({ id: `m${i}`, order: 5 + i, name, phase: 'Build' }),
      ),
    ];
    api('PROJECT_MANAGER', (url) => {
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: many } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
      return undefined;
    });
    const dialog = await editWorkshops();
    await userEvent.type(within(dialog).getByRole('searchbox', { name: /Search tasks/ }), 'cut');
    const group = within(dialog).getByRole('group', { name: 'Tasks this one depends on' });
    expect(
      within(group)
        .getAllByRole('checkbox')
        .map((c) => c.getAttribute('id')),
    ).toEqual(['task-deps-m2']);
    // The chip for a selected task stays even when the search hides it.
    expect(within(dialog).getByTestId('task-deps-chips')).toHaveTextContent('#1 Kickoff');
  });
});

describe('CR-22 A2: status change with tasks lacking an owner', () => {
  it('Planning → Active shows a note (not a block) in the form and, after saving, on the project', async () => {
    const message =
      '2 tasks have no owner yet. The status still changes; assign owners on the Checklist when you can.';
    const fetchMock = checklistApi(project({ status: 'PLANNING', unownedTaskCount: 2 }), {
      notes: [{ code: 'TASKS_WITHOUT_OWNER', count: 2, message }],
    });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('unowned-tasks-note')).not.toBeInTheDocument();
    // Q-127: only Planning → Active shows it.
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'ON_HOLD');
    expect(within(dialog).queryByTestId('unowned-tasks-note')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'ACTIVE');
    expect(within(dialog).getByTestId('unowned-tasks-note')).toHaveTextContent(message);
    await userEvent.click(within(dialog).getByRole('button', { name: /^Save/ }));
    // Q-69: the fixture has no phases, so leaving Planning asks first.
    await userEvent.click(await screen.findByRole('button', { name: 'Move on anyway' }));
    await waitFor(() => expect(patchBody(fetchMock, `/projects/${PID}`).status).toBe('ACTIVE'));
    expect(await screen.findByTestId('project-save-note')).toHaveTextContent(message);
  });
});

describe('CR-22 A2: note wording', () => {
  it.each([
    [1, '1 task has no owner yet.'],
    [3, '3 tasks have no owner yet.'],
  ])('%i unowned task(s): "%s"', async (count, start) => {
    checklistApi(project({ status: 'PLANNING', unownedTaskCount: count }));
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'ACTIVE');
    const note = within(dialog).getByTestId('unowned-tasks-note');
    expect(note.textContent!.startsWith(start)).toBe(true);
  });
});
