import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectDto } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { PID, api, project, task } from './m2fixtures';
import { renderAt } from './utils';

/** FR-PRJ-19 / DEF-003: Owner and Assignees list only the team; PMs and Admins add-and-assign. */
afterEach(() => vi.unstubAllGlobals());

const PEOPLE = [
  { id: 'me-PROJECT_MANAGER', name: 'Me PM', systemRole: 'PROJECT_MANAGER', jobRole: 'PM' },
  { id: 'u2', name: 'Maria Member', systemRole: 'MEMBER', jobRole: 'CONSULTANT' },
  { id: 'u9', name: 'Nina New', systemRole: 'MEMBER', jobRole: 'DEVELOPER' },
];

function projectApi(p: ProjectDto = project()) {
  return api('PROJECT_MANAGER', (url, init) => {
    if (url.endsWith('/people')) return { status: 200, body: { items: PEOPLE } };
    if (url.endsWith(`/projects/${PID}/tasks`) && init?.method === 'POST')
      return { status: 201, body: { task: task({ id: 'k9', name: 'Go-live' }) } };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: p } };
    return undefined;
  });
}

const posted = (fetchMock: ReturnType<typeof projectApi>) =>
  fetchMock.mock.calls
    .filter(([u, i]) => String(u).endsWith(`/projects/${PID}/tasks`) && i?.method === 'POST')
    .map(([, i]) => JSON.parse(String(i!.body)) as Record<string, unknown>);

async function openAddTask() {
  renderAt(`/projects/${PID}`, <App />);
  await userEvent.click(await screen.findByRole('button', { name: '+ Add task' }));
  return within(await screen.findByRole('dialog'));
}

describe('Task form: add someone to this project (FR-PRJ-19)', () => {
  it('Owner lists only the team, with "+ Add someone to this project…" last for a PM', async () => {
    projectApi();
    const dialog = await openAddTask();
    const owner = dialog.getByLabelText('Owner (accountable)');
    const options = within(owner)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual([
      'Unassigned',
      'Me PM',
      'Maria Member',
      '+ Add someone to this project…',
    ]);
    expect(dialog.getByRole('button', { name: '+ Add someone to this project…' })).toBeVisible();
    expect(dialog.queryByText('Only project members can be assigned')).not.toBeInTheDocument();
  });

  it('picking from the Owner list makes them owner and saves with addMemberIds, then confirms', async () => {
    const fetchMock = projectApi();
    const dialog = await openAddTask();
    await userEvent.type(dialog.getByLabelText('Task name'), 'Go-live');
    await userEvent.selectOptions(
      dialog.getByLabelText('Owner (accountable)'),
      '+ Add someone to this project…',
    );
    const picker = dialog.getByRole('group', { name: 'Add someone to SAP B1 Rollout' });
    // Only people not on the project yet.
    expect(within(picker).queryByRole('button', { name: /Maria Member/ })).not.toBeInTheDocument();
    await userEvent.click(within(picker).getByRole('button', { name: /Nina New/ }));
    expect(dialog.getByLabelText('Owner (accountable)')).toHaveValue('u9');
    expect(dialog.getByTestId('pending-members')).toHaveTextContent(
      'Nina New will be added to SAP B1 Rollout when you save.',
    );
    await userEvent.click(dialog.getByRole('button', { name: 'Add task' }));
    await waitFor(() =>
      expect(posted(fetchMock)).toEqual([
        expect.objectContaining({ name: 'Go-live', ownerId: 'u9', addMemberIds: ['u9'] }),
      ]),
    );
    expect(
      await screen.findByText('Nina New added to SAP B1 Rollout and assigned.'),
    ).toBeInTheDocument();
  });

  it('picking from the Assignees list ticks them as an assignee', async () => {
    const fetchMock = projectApi();
    const dialog = await openAddTask();
    await userEvent.type(dialog.getByLabelText('Task name'), 'Go-live');
    await userEvent.click(dialog.getByRole('button', { name: '+ Add someone to this project…' }));
    await userEvent.type(dialog.getByLabelText('Search people'), 'nina');
    await userEvent.click(dialog.getByRole('button', { name: /Nina New/ }));
    expect(dialog.getByLabelText('Nina New')).toBeChecked();
    await userEvent.click(dialog.getByRole('button', { name: 'Add task' }));
    await waitFor(() =>
      expect(posted(fetchMock)).toEqual([
        expect.objectContaining({ assigneeIds: ['u9'], addMemberIds: ['u9'] }),
      ]),
    );
  });

  it('un-assigning a picked person before saving does not add them', async () => {
    const fetchMock = projectApi();
    const dialog = await openAddTask();
    await userEvent.type(dialog.getByLabelText('Task name'), 'Go-live');
    await userEvent.click(dialog.getByRole('button', { name: '+ Add someone to this project…' }));
    await userEvent.click(dialog.getByRole('button', { name: /Nina New/ }));
    await userEvent.click(dialog.getByLabelText('Nina New'));
    await userEvent.click(dialog.getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(posted(fetchMock)).toHaveLength(1));
    expect(posted(fetchMock)[0]).not.toHaveProperty('addMemberIds');
  });

  it('without the right to add members: no add option, and the hint under both fields', async () => {
    projectApi(
      project({
        can: {
          edit: false,
          archive: false,
          delete: false,
          planTasks: true,
          addMembers: false,
          activity: true,
        },
      }),
    );
    const dialog = await openAddTask();
    expect(
      within(dialog.getByLabelText('Owner (accountable)')).queryByText(
        '+ Add someone to this project…',
      ),
    ).not.toBeInTheDocument();
    expect(
      dialog.queryByRole('button', { name: '+ Add someone to this project…' }),
    ).not.toBeInTheDocument();
    expect(dialog.getAllByText('Only project members can be assigned')).toHaveLength(2);
  });
});

describe('Template editor label (FR-PRJ-19)', () => {
  it('the activity field is labelled "Default job role"', async () => {
    api('PROJECT_MANAGER', (url) =>
      url.endsWith('/templates/t9')
        ? {
            status: 200,
            body: {
              template: {
                id: 't9',
                templateKey: 'k',
                name: 'T',
                description: null,
                type: 'SAP_B1',
                version: 1,
                status: 'DRAFT',
                superseded: false,
                phaseCount: 1,
                activityCount: 0,
                dependencyCount: 0,
                deliverableCount: 0,
                projectCount: 0,
                publishedAt: null,
                updatedAt: '2026-10-09T00:00:00.000Z',
                draftId: null,
                phases: [{ id: 'p1', name: 'Discovery' }],
                activities: [],
                versions: [],
              },
            },
          }
        : undefined,
    );
    renderAt('/templates/t9', <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add activity to Phase 1' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText('Default job role')).toBeInTheDocument();
  });
});
