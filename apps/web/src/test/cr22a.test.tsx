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

describe('CR-22 A2: status change with tasks lacking an owner', () => {
  it('the edit form shows a note (not a block) and the saved note shows on the project', async () => {
    const message =
      '2 tasks have no owner yet. The status still changes; assign owners on the Checklist when you can.';
    const fetchMock = checklistApi(project({ unownedTaskCount: 2 }), {
      notes: [{ code: 'TASKS_WITHOUT_OWNER', count: 2, message }],
    });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('unowned-tasks-note')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'ON_HOLD');
    expect(within(dialog).getByTestId('unowned-tasks-note')).toHaveTextContent(message);
    await userEvent.click(within(dialog).getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(patchBody(fetchMock, `/projects/${PID}`).status).toBe('ON_HOLD'));
    expect(await screen.findByTestId('project-save-note')).toHaveTextContent(message);
  });
});
