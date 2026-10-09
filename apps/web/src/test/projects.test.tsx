import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { END_AFTER_START, type ProjectDto, type SystemRole, type TemplateDto } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ACME, rulesBody } from './fixtures';
import { ME_PM, PID, api, project, task, type Route } from './m2fixtures';
import { renderAt } from './utils';

afterEach(() => vi.unstubAllGlobals());

describe('Navigation (M2)', () => {
  it('Projects, Task board and Templates are enabled for roles that can view them', async () => {
    api('PROJECT_MANAGER');
    renderAt('/my-tasks', <App />);
    await screen.findByRole('heading', { name: 'My tasks' });
    for (const name of ['Projects', 'Task board', 'Templates']) {
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).not.toHaveTextContent(
        'Soon',
      );
    }
  });
});

describe('My tasks (FR-TSK-13, AC-17.1)', () => {
  it('shows real counts and my tasks, linking to the task on its project; unestimated show "–"', async () => {
    api('MEMBER', (url) =>
      url.includes('/tasks/mine')
        ? {
            status: 200,
            body: {
              counts: { overdue: 1, dueThisWeek: 2, toReview: 0, assigned: 2, accountable: 0 },
              items: [
                {
                  id: 'k1',
                  name: 'Kickoff',
                  project: { id: PID, name: 'SAP B1 Rollout' },
                  role: 'ASSIGNEE',
                  dueDate: '2026-10-05',
                  overdue: true,
                  daysLate: 4,
                  estHours: null,
                  actualHours: 0,
                  status: 'IN_PROGRESS',
                  party: 'INTERNAL',
                },
              ],
            },
          }
        : undefined,
    );
    renderAt('/my-tasks', <App />);
    const link = await screen.findByRole('link', { name: 'Kickoff' });
    expect(link).toHaveAttribute('href', `/projects/${PID}?task=k1`);
    const overdue = screen.getByText('Overdue').closest<HTMLElement>('.card-body')!;
    expect(within(overdue).getByText('1')).toBeInTheDocument();
    const row = link.closest('tr')!;
    expect(within(row).getByText('4d late')).toBeInTheDocument();
    expect(within(row).getByText('No estimate')).toBeInTheDocument();
  });
});

describe('Projects list (FR-PRJ-01)', () => {
  it('shows the API’s scoped list and counts; archived only under the Archived filter; New project needs Create', async () => {
    const fetchMock = api('MEMBER', (url) =>
      url.includes('/projects?')
        ? {
            status: 200,
            body: {
              items: [project()],
              total: 1,
              counts: { ALL: 1, ACTIVE: 1, ARCHIVED: 0, PLANNING: 0 },
            },
          }
        : undefined,
    );
    renderAt('/projects', <App />);
    const link = await screen.findByRole('link', { name: 'SAP B1 Rollout' });
    expect(link).toHaveAttribute('href', `/projects/${PID}`);
    expect(screen.getByRole('button', { name: /^All/ })).toHaveTextContent('All1');
    expect(screen.queryByRole('link', { name: '+ New project' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Archived/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('status=ARCHIVED'))).toBe(true),
    );
  });
});

describe('New project (FR-PRJ-01..04)', () => {
  const tpl = {
    id: 't1',
    name: 'SAP B1 Implementation',
    type: 'SAP_B1',
    status: 'PUBLISHED',
    version: 2,
    activityCount: 10,
    dependencyCount: 13,
    deliverableCount: 4,
  };
  it('previews what the template generates and checks the end is after the start before saving', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url) => {
      if (url.includes('/templates')) return { status: 200, body: { items: [tpl] } };
      if (url.includes('/people'))
        return {
          status: 200,
          body: {
            items: [{ id: ME_PM, name: 'Me PM', systemRole: 'PROJECT_MANAGER', jobRole: 'PM' }],
          },
        };
      if (url.includes('/clients'))
        return { status: 200, body: { items: [ACME], page: 1, pageSize: 100, total: 1 } };
      return undefined;
    });
    renderAt(`/projects/new?clientId=${ACME.id}`, <App />);
    const select = await screen.findByLabelText('Template');
    expect(screen.getByLabelText('Client')).toHaveValue(ACME.id);
    expect(screen.getByLabelText('Project manager')).toHaveValue(ME_PM);
    await userEvent.selectOptions(select, 't1');
    expect(screen.getByTestId('template-preview')).toHaveTextContent(
      'Generates 10 activities, 13 dependencies and 4 deliverables.',
    );
    await userEvent.type(screen.getByLabelText('Project name'), 'Rollout');
    await userEvent.clear(screen.getByLabelText('Baseline start'));
    await userEvent.type(screen.getByLabelText('Baseline start'), '2026-10-12');
    await userEvent.type(screen.getByLabelText('Baseline end'), '2026-10-12');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText(END_AFTER_START)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });
});

describe('Project detail (FR-PRJ-13, FR-TSK-10)', () => {
  const tasks = [
    task(),
    task({ id: 'k2', order: 2, name: 'Client sign-off', status: 'IN_PROGRESS', estHours: null }),
  ];
  const projectApi = (
    p: ProjectDto,
    role: SystemRole = 'PROJECT_MANAGER',
    extra: Route = () => undefined,
  ) =>
    api(role, (url, init) => {
      const r = extra(url, init);
      if (r) return r;
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: tasks } };
      if (url.includes(`/projects/${PID}/contact-options`))
        return { status: 200, body: { items: [] } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: p } };
      return undefined;
    });

  it('the board has five status columns; Move to… changes status (keyboard alternative)', async () => {
    const fetchMock = projectApi(project(), 'PROJECT_MANAGER', (url, init) =>
      url.includes('/tasks/k1/status') && init?.method === 'POST'
        ? { status: 200, body: { task: task({ status: 'IN_PROGRESS', version: 1 }) } }
        : undefined,
    );
    renderAt(`/projects/${PID}/board`, <App />);
    const todo = await screen.findByRole('region', { name: 'To Do (1)' });
    for (const col of ['In Progress (1)', 'Blocked (0)', 'For Review (0)', 'Completed (0)'])
      expect(screen.getByRole('region', { name: col })).toBeInTheDocument();
    // EC-58: the unestimated task shows "–" with a hint.
    expect(
      within(screen.getByRole('region', { name: 'In Progress (1)' })).getByText('No estimate'),
    ).toBeInTheDocument();
    await userEvent.selectOptions(within(todo).getByLabelText('Move Kickoff to'), 'IN_PROGRESS');
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/tasks/k1/status'));
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ status: 'IN_PROGRESS', version: 0 });
    });
  });

  it('moving to Blocked asks for the reason first', async () => {
    const fetchMock = projectApi(project());
    renderAt(`/projects/${PID}/board`, <App />);
    const todo = await screen.findByRole('region', { name: 'To Do (1)' });
    await userEvent.selectOptions(within(todo).getByLabelText('Move Kickoff to'), 'BLOCKED');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark blocked' }));
    expect(within(dialog).getByText('What is blocking it? is required.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/status'))).toBe(false);
  });

  it('Active contacts: inactive contacts are greyed out and labelled', async () => {
    projectApi(
      project({
        activeContacts: [
          { id: 'c1', name: 'Ana Active', position: 'CFO', email: null, phone: null, active: true },
          {
            id: 'c3',
            name: 'Cara Inactive',
            position: null,
            email: null,
            phone: null,
            active: false,
          },
        ],
      }),
    );
    renderAt(`/projects/${PID}/contacts`, <App />);
    const cara = (await screen.findByText('Cara Inactive')).closest('tr')!;
    expect(cara).toHaveClass('text-body-secondary');
    expect(within(cara).getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText('Ana Active').closest('tr')).not.toHaveClass('text-body-secondary');
  });

  it('Active contacts empty state links to the client’s Contacts tab for users who can add contacts', async () => {
    projectApi(project());
    const a = renderAt(`/projects/${PID}/contacts`, <App />);
    expect(await screen.findByText('No active contacts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /’s contacts$/ })).toHaveAttribute(
      'href',
      `/clients/${ACME.id}/contacts`,
    );
    a.unmount();
    vi.unstubAllGlobals();
    // Viewers can't create contacts: no link.
    projectApi(
      project({
        can: {
          edit: false,
          archive: false,
          delete: false,
          planTasks: false,
          addMembers: false,
          activity: false,
        },
      }),
      'VIEWER',
    );
    renderAt(`/projects/${PID}/contacts`, <App />);
    expect(await screen.findByText('No active contacts')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /’s contacts$/ })).not.toBeInTheDocument();
  });

  it('actions follow the project’s can flags: no Edit, Add task or Delete for a Member', async () => {
    projectApi(
      project({
        can: {
          edit: false,
          archive: false,
          delete: false,
          planTasks: false,
          addMembers: false,
          activity: false,
        },
      }),
      'MEMBER',
    );
    renderAt(`/projects/${PID}`, <App />);
    expect(await screen.findByText('Kickoff')).toBeInTheDocument();
    expect(screen.getByTestId('unestimated-count')).toHaveTextContent('1');
    expect(screen.queryByRole('button', { name: 'Edit project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Activity log' })).not.toBeInTheDocument();
  });
});

describe('Template editor (FR-TPL-02..04, EC-58)', () => {
  const draft: TemplateDto = {
    id: 't2',
    templateKey: 'k',
    name: 'Small',
    type: 'GENERAL_IT',
    description: null,
    status: 'DRAFT',
    version: 2,
    superseded: false,
    phaseCount: 1,
    activityCount: 1,
    dependencyCount: 0,
    deliverableCount: 0,
    projectCount: 0,
    publishedAt: null,
    updatedAt: '2026-10-09T00:00:00.000Z',
    draftId: null,
    phases: [{ id: 'p1', name: 'Phase 1' }],
    activities: [
      {
        id: 'a1',
        phaseId: 'p1',
        name: 'Kickoff',
        taskType: null,
        priority: 'MEDIUM',
        mandatory: true,
        party: 'INTERNAL',
        defaultJobRole: null,
        defaultTeamId: null,
        estHours: null,
        offsetDays: 0,
        durationDays: 1,
        deliverable: null,
        requiresApproval: false,
        isMilestone: false,
        dependsOn: [],
      },
    ],
    versions: [
      {
        id: 't1',
        version: 1,
        status: 'PUBLISHED',
        superseded: false,
        publishedAt: '2026-10-01T00:00:00.000Z',
      },
      { id: 't2', version: 2, status: 'DRAFT', superseded: false, publishedAt: null },
    ],
  };

  it('PMs can publish (Q-11); a blank estimate shows "–" and is saved as null, never 0', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith('/templates/t2') && init?.method === 'PATCH')
        return { status: 200, body: { template: draft } };
      if (url.endsWith('/templates/t2')) return { status: 200, body: { template: draft } };
      return undefined;
    });
    renderAt('/templates/t2', <App />);
    expect(await screen.findByRole('button', { name: 'Publish v2' })).toBeInTheDocument();
    expect(screen.getByText('No estimate')).toBeInTheDocument();
    expect(screen.getByText('v1')).toHaveAttribute('href', '/templates/t1');

    await userEvent.click(screen.getByRole('button', { name: '+ Add activity to Phase 1' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Activity name'), 'Design');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add activity' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
      const body = JSON.parse(String(call?.[1]?.body));
      expect(
        body.activities.map((a: { name: string; estHours: unknown }) => [a.name, a.estHours]),
      ).toEqual([
        ['Kickoff', null],
        ['Design', null],
      ]);
    });
  });

  it('Members see the template read-only, with no publish or edit controls', async () => {
    api('MEMBER', (url) =>
      url.endsWith('/templates/t2') ? { status: 200, body: { template: draft } } : undefined,
    );
    renderAt('/templates/t2', <App />);
    expect(await screen.findByText('Kickoff')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add activity/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Template name')).toBeDisabled();
  });
});

describe('Access rules: unsaved changes on in-app navigation (FR-ACL-11, TC-M17)', () => {
  it('warns before moving to another page, and Stay keeps the changes', async () => {
    api('ADMIN', (url) =>
      url.endsWith('/access-rules') ? { status: 200, body: rulesBody() } : undefined,
    );
    const { router } = renderAt('/access-rules', <App />);
    await screen.findByText('templates', { selector: 'code' });
    const row = screen.getByText('templates', { selector: 'code' }).closest('tr')!;
    await userEvent.click(within(row).getByRole('checkbox', { name: /^Edit Templates/ }));
    await userEvent.click(screen.getByRole('link', { name: /^Clients/ }));
    const dialog = (await screen.findByText('Leave without saving?')).closest<HTMLElement>(
      '[role=dialog]',
    )!;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stay on this page' }));
    expect(router.state.location.pathname).toBe('/access-rules');
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: /^Clients/ }));
    const again = (await screen.findByText('Leave without saving?')).closest<HTMLElement>(
      '[role=dialog]',
    )!;
    await userEvent.click(within(again).getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/clients'));
  });

  it('does not warn when nothing changed', async () => {
    api('ADMIN', (url) =>
      url.endsWith('/access-rules') ? { status: 200, body: rulesBody() } : undefined,
    );
    const { router } = renderAt('/access-rules', <App />);
    await screen.findByText('templates', { selector: 'code' });
    await userEvent.click(screen.getByRole('link', { name: /^Clients/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/clients'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
