import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectTypeDto, ProjectTypePreselectDto } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { TrackerEntryModal } from '../components/tracker/TrackerEntryModal';
import { ACME, LOOKUPS } from './fixtures';
import { ME_PM, PID, PRESELECT, api, project, task, type Route } from './m2fixtures';
import { trackerDay } from './m5fixtures';
import { renderAt } from './utils';

/** Project types (doc 14 v1.1.1 FR-PTY-01..07; mockup v0.9.2). */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T04:00:00Z'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const type = (over: Partial<ProjectTypeDto>): ProjectTypeDto => ({
  id: 'pt1',
  name: 'Implementation',
  active: true,
  defaultActivityType: { id: 'at1', name: 'Configuration', active: true },
  usedBy: 3,
  deactivatedAt: null,
  deactivatedBy: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const ADMIN_TYPES = [
  type({}),
  type({ id: 'pt2', name: 'Training', usedBy: 0, defaultActivityType: null }),
  type({
    id: 'pt9',
    name: 'Legacy (example)',
    active: false,
    usedBy: 2,
    defaultActivityType: { id: 'at9', name: 'Recruiting', active: false },
    deactivatedAt: '2026-09-02T00:00:00.000Z',
    deactivatedBy: { id: 'u1', name: 'Jomerson Nazaire' },
  }),
];
const ADMIN_ACTS = LOOKUPS.activityTypes.map((a) => ({
  ...a,
  kind: 'ACTIVITY_TYPE',
  active: true,
  usedBy: 0,
  deactivatedAt: null,
  deactivatedBy: null,
  createdAt: '2026-10-01T00:00:00.000Z',
}));
const sentBody = (fetchMock: ReturnType<typeof api>, method: string, path: string) => {
  const call = fetchMock.mock.calls.find(
    ([u, i]) => String(u).includes(path) && i?.method === method,
  );
  return call ? JSON.parse(String(call[1]?.body ?? 'null')) : undefined;
};

describe('FR-PTY-01 Admin › Settings › Project types', () => {
  const admin = (extra: Route = () => undefined) =>
    api('ADMIN', (url, init) => {
      const x = extra(url, init);
      if (x) return x;
      if (url.includes('/project-types/all')) return { status: 200, body: { items: ADMIN_TYPES } };
      if (url.includes('/lookups/activity-types/all'))
        return { status: 200, body: { items: ADMIN_ACTS } };
      if (url.includes('/project-types') && init?.method === 'POST')
        return { status: 201, body: { item: type({ id: 'ptn', name: 'Hypercare', usedBy: 0 }) } };
      return undefined;
    });

  it('lists types with default activity type, projects using it and status; inactive default marked', async () => {
    admin();
    renderAt('/admin/settings', <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Project types' }));
    const row = (await screen.findByText('Legacy (example)')).closest('tr')!;
    expect(row).toHaveClass('row-inactive');
    expect(within(row).getByRole('combobox')).toHaveDisplayValue('Recruiting (inactive)');
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    const impl = screen.getByText('Implementation').closest('tr')!;
    expect(within(impl).getByText('3 projects')).toBeInTheDocument();
    expect(within(impl).getByRole('combobox')).toHaveDisplayValue('Configuration');
    // In use: no Delete; unused: Delete is offered.
    expect(within(impl).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    const training = screen.getByText('Training').closest('tr')!;
    expect(within(training).getByText('Not used')).toBeInTheDocument();
    expect(within(training).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(within(training).getByRole('combobox')).toHaveDisplayValue('No default');
  });

  it('add: counter, "Add a name.", too long, duplicate ignoring case and spaces, then saves', async () => {
    const fetchMock = admin();
    const user = userEvent.setup();
    renderAt('/admin/settings', <App />);
    await user.click(await screen.findByRole('button', { name: 'Project types' }));
    await screen.findByText('Implementation');
    await user.click(screen.getAllByRole('button', { name: '+ Add project type' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add project type' });
    expect(within(dialog).getByText('0/50')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('Add a name.')).toBeInTheDocument();
    const name = within(dialog).getByLabelText('Name *');
    await user.type(name, 'x'.repeat(51));
    expect(within(dialog).getByText('51/50')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('Keep the name under 50 characters.')).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, '  legacy   (EXAMPLE) ');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(
      within(dialog).getByText('A project type with this name already exists.'),
    ).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, ' Hyper  care ');
    await user.selectOptions(within(dialog).getByLabelText(/Default activity type/), 'at2');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(sentBody(fetchMock, 'POST', '/project-types')).toEqual({
        name: 'Hyper care',
        defaultActivityTypeId: 'at2',
      }),
    );
    expect(await screen.findByText('Hyper care added.')).toBeInTheDocument();
  });

  it('deactivate asks first and says how many projects keep it', async () => {
    const fetchMock = admin((url, init) =>
      init?.method === 'PATCH' && url.includes('/project-types/pt1')
        ? { status: 200, body: { item: type({ active: false }) } }
        : undefined,
    );
    const user = userEvent.setup();
    renderAt('/admin/settings', <App />);
    await user.click(await screen.findByRole('button', { name: 'Project types' }));
    const impl = (await screen.findByText('Implementation')).closest('tr')!;
    await user.click(within(impl).getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Implementation?' });
    expect(dialog).toHaveTextContent('3 projects use it and keep it.');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(sentBody(fetchMock, 'PATCH', '/project-types/pt1')).toEqual({ active: false }),
    );
    expect(await screen.findByText('Implementation deactivated.')).toBeInTheDocument();
  });
});

describe('FR-PTY-02/03 project information', () => {
  const PEOPLE = [
    {
      id: ME_PM,
      name: 'Me PM',
      email: 'pm@x.example',
      active: true,
      systemRole: 'PROJECT_MANAGER',
    },
  ];
  const CLIENTS = { status: 200, body: { items: [ACME], page: 1, pageSize: 100, total: 1 } };

  it('New project: Project type is required ("Choose a project type.")', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url) => {
      if (url.includes('/people')) return { status: 200, body: { items: PEOPLE } };
      if (url.includes('/clients')) return CLIENTS;
      return undefined;
    });
    renderAt(`/projects/new?clientId=${ACME.id}`, <App />);
    await screen.findByRole('option', { name: 'Implementation' });
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Choose a project type.')).toBeInTheDocument();
    expect(screen.getByLabelText('Project type *')).toHaveClass('is-invalid');
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });

  const detail = (p: ReturnType<typeof project>) =>
    api('PROJECT_MANAGER', (url, init) => {
      if (url.includes('/people')) return { status: 200, body: { items: PEOPLE } };
      if (url.includes('/clients')) return CLIENTS;
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
      if (url.endsWith(`/projects/${PID}`) && init?.method === 'PATCH')
        return { status: 200, body: { project: p } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: p } };
      return undefined;
    });

  it('an existing project shows "Not set" in the header and must pick a type to save', async () => {
    const fetchMock = detail(project({ managerId: ME_PM, projectType: null }));
    renderAt(`/projects/${PID}`, <App />);
    expect(await screen.findByTestId('project-type-meta')).toHaveTextContent(
      'Project type: Not set',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit project' }));
    await screen.findByRole('option', { name: 'Implementation' });
    expect(screen.getByText('Not set. Pick a project type to save.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Choose a project type.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false);
    await userEvent.selectOptions(screen.getByLabelText('Project type *'), 'pt2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(sentBody(fetchMock, 'PATCH', `/projects/${PID}`)).toEqual({ projectTypeId: 'pt2' }),
    );
  });

  it('a deactivated type stays selected with "(inactive)" and is not re-sent on save', async () => {
    const fetchMock = detail(
      project({
        managerId: ME_PM,
        projectType: { id: 'pt9', name: 'Legacy (example)', active: false },
      }),
    );
    renderAt(`/projects/${PID}`, <App />);
    expect(await screen.findByTestId('project-type-meta')).toHaveTextContent(
      'Project type: Legacy (example)',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit project' }));
    await screen.findByRole('option', { name: 'Implementation' });
    expect(screen.getByLabelText('Project type *')).toHaveDisplayValue(
      'Legacy (example) (inactive)',
    );
    expect(
      screen.getByText('This type is no longer offered for new projects.'),
    ).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Project name'));
    await userEvent.type(screen.getByLabelText('Project name'), 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(sentBody(fetchMock, 'PATCH', `/projects/${PID}`)).toEqual({ name: 'Renamed' }),
    );
  });
});

describe('FR-PTY-04 Time in preselect', () => {
  const render = (preselect: ProjectTypePreselectDto | null, mode: 'start' | 'quick' | 'add') => {
    const fetchMock = api('MEMBER', (url) => {
      if (url.endsWith('/lookups')) return { status: 200, body: LOOKUPS };
      if (url.includes('/tracker/day')) return { status: 200, body: { day: trackerDay() } };
      if (url.includes('/tracker/running'))
        return { status: 200, body: { entry: null, now: '2026-10-09T04:00:00.000Z' } };
      if (url.includes('/project-types/preselect'))
        return { status: 200, body: { preselect: preselect ?? PRESELECT } };
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
      return undefined;
    });
    renderAt(
      '/',
      <TrackerEntryModal
        mode={
          mode === 'start'
            ? {
                kind: 'start',
                date: '2026-10-09',
                task: { id: 't1', name: 'Prepare UAT scripts', projectName: 'SAP B1 Rollout' },
              }
            : { kind: mode, date: '2026-10-09' }
        }
        onClose={() => undefined}
      />,
    );
    return fetchMock;
  };

  it('preselects the project type default with the hint; the user can change it', async () => {
    render(null, 'start');
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByLabelText('Activity type *');
    await waitFor(() => expect(select).toHaveValue('at1'));
    expect(
      within(dialog).getByText('From project type: Implementation. You can change it.'),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent('SAP B1 Rollout · Project type: Implementation');
    await userEvent.selectOptions(select, 'at2');
    expect(select).toHaveValue('at2');
    expect(within(dialog).queryByTestId('activity-hint')).not.toBeInTheDocument();
  });

  it('leaves it blank when the default activity type is inactive (and says so)', async () => {
    render(
      {
        projectName: 'Northwind Upgrade',
        projectType: { id: 'pt9', name: 'Legacy (example)', active: false },
        activityType: null,
        inactiveDefault: 'Recruiting',
      },
      'start',
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(
        'Recruiting, the default activity type for Legacy (example), is no longer offered. Choose one.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Activity type *')).toHaveValue('');
  });

  it('leaves it blank for a project with no type ("Not set") and for a type with no default', async () => {
    render(
      {
        projectName: 'Cloud Migration',
        projectType: null,
        activityType: null,
        inactiveDefault: null,
      },
      'start',
    );
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveTextContent('Project type: Not set'));
    expect(within(dialog).getByLabelText('Activity type *')).toHaveValue('');
    expect(within(dialog).queryByTestId('activity-hint')).not.toBeInTheDocument();
  });

  it('a quick activity is never preselected', async () => {
    const fetchMock = render(null, 'quick');
    const dialog = await screen.findByRole('dialog');
    await screen.findByRole('option', { name: 'Configuration' });
    expect(within(dialog).getByLabelText('Activity type *')).toHaveValue('');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/preselect'))).toBe(false);
  });

  it('+ Add entry on a project task preselects too; switching to Quick activity clears it', async () => {
    render(null, 'add');
    const dialog = await screen.findByRole('dialog');
    await screen.findByRole('option', { name: 'Prepare UAT scripts · SAP B1 Rollout' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Task or quick activity *'), 't1');
    const select = within(dialog).getByLabelText('Activity type *');
    await waitFor(() => expect(select).toHaveValue('at1'));
    expect(within(dialog).getByTestId('activity-hint')).toHaveTextContent(
      'From project type: Implementation. You can change it.',
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Task or quick activity *'),
      '__quick__',
    );
    expect(select).toHaveValue('');
  });
});
