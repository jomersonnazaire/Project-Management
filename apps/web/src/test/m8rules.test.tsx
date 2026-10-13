import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { PID, api, project, task } from './m2fixtures';
import { renderAt } from './utils';

/** Project rules (doc 14 v1.2.6 FR-PRJ-27..31, EC-94..99): blank projects, apply template, Q-69. */
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

const TPL = {
  id: 'cccccccccccccccccccccccc',
  templateKey: 'erp',
  name: 'ERP rollout',
  type: 'IMPLEMENTATION',
  description: null,
  status: 'PUBLISHED',
  version: 3,
  superseded: false,
  phaseCount: 2,
  activityCount: 5,
  dependencyCount: 0,
  deliverableCount: 0,
  projectCount: 0,
  publishedAt: null,
};

const posted = (m: ReturnType<typeof api>, suffix: string, method = 'POST') =>
  m.mock.calls.filter(([u, i]) => String(u).includes(suffix) && i?.method === method);

describe('blank project Checklist', () => {
  it('shows the empty state, "Started blank", + Add phase and Apply template', async () => {
    api('PROJECT_MANAGER', (url) =>
      url.endsWith(`/projects/${PID}`)
        ? {
            status: 200,
            body: { project: project({ status: 'PLANNING', templateName: null, taskCount: 0 }) },
          }
        : undefined,
    );
    renderAt(`/projects/${PID}`, <App />);
    expect(await screen.findByText('No phases yet')).toBeInTheDocument();
    expect(screen.getByText('Add your first phase, or apply a template.')).toBeInTheDocument();
    expect(screen.getByTestId('started-from')).toHaveTextContent('Started blank');
    expect(screen.getByRole('button', { name: '+ Add phase' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply template' })).toBeInTheDocument();
  });

  it('labels a templated project with the starting template and version', async () => {
    api('PROJECT_MANAGER', (url) =>
      url.endsWith(`/projects/${PID}`)
        ? {
            status: 200,
            body: { project: project({ templateName: 'ERP rollout', templateVersion: 3 }) },
          }
        : undefined,
    );
    renderAt(`/projects/${PID}`, <App />);
    expect(await screen.findByTestId('started-from')).toHaveTextContent(
      'Started from ERP rollout v3',
    );
  });

  it('applying a template posts it and shows "Added N phases from <name>."', async () => {
    const m = api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith('/apply-template') && init?.method === 'POST')
        return {
          status: 200,
          body: {
            project: project({ templateName: null }),
            template: { id: TPL.id, name: TPL.name, version: 3 },
            phasesAdded: 2,
            tasksAdded: 5,
            alreadyApplied: false,
          },
        };
      if (url.includes('/templates')) return { status: 200, body: { items: [TPL] } };
      if (url.endsWith(`/projects/${PID}`))
        return {
          status: 200,
          body: { project: project({ status: 'PLANNING', templateName: null, taskCount: 0 }) },
        };
      return undefined;
    });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Apply template' }));
    const dlg = await screen.findByRole('dialog', { name: 'Apply template' });
    await screen.findByRole('option', { name: 'ERP rollout · v3' });
    await userEvent.selectOptions(within(dlg).getByLabelText('Template *'), TPL.id);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Apply template' }));
    expect(await screen.findByText('Added 2 phases from ERP rollout.')).toBeInTheDocument();
    expect(JSON.parse(String(posted(m, '/apply-template')[0]![1]!.body))).toEqual({
      templateId: TPL.id,
      templateVersion: 3,
    });
  });

  it('§J: confirm text counts new and merged phases; the toast reports both', async () => {
    api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith('/apply-template') && init?.method === 'POST')
        return {
          status: 200,
          body: {
            project: project({ status: 'PLANNING' }),
            template: { id: TPL.id, name: TPL.name, version: 3 },
            phasesAdded: 1,
            phasesMerged: 1,
            tasksAdded: 5,
            alreadyApplied: false,
          },
        };
      if (url.includes(`/templates/${TPL.id}`))
        return {
          status: 200,
          body: {
            template: {
              ...TPL,
              phases: [
                { id: 'a', name: 'Discovery' },
                { id: 'b', name: 'Build' },
              ],
              activities: [],
              versions: [],
            },
          },
        };
      if (url.includes('/templates')) return { status: 200, body: { items: [TPL] } };
      if (url.endsWith(`/projects/${PID}/phases`))
        return {
          status: 200,
          body: {
            items: [
              {
                name: ' discovery ',
                taskCount: 1,
                documentCount: 0,
                deletable: false,
                deleteBlockedReason: null,
                editable: true,
              },
            ],
          },
        };
      if (url.includes(`/projects/${PID}/tasks`))
        return { status: 200, body: { items: [task({ id: 'k1', phase: ' discovery ' })] } };
      if (url.endsWith(`/projects/${PID}`))
        return { status: 200, body: { project: project({ status: 'PLANNING' }) } };
      return undefined;
    });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Apply template' }));
    const dlg = await screen.findByRole('dialog', { name: 'Apply template' });
    await screen.findByRole('option', { name: 'ERP rollout · v3' });
    await userEvent.selectOptions(within(dlg).getByLabelText('Template *'), TPL.id);
    expect(await within(dlg).findByTestId('apply-confirm')).toHaveTextContent(
      'This adds 1 new phase, merges 1 into existing phase with the same name, and adds 5 activities. Nothing is replaced.',
    );
    await userEvent.click(within(dlg).getByRole('button', { name: 'Apply template' }));
    expect(
      await screen.findByText('Added 1 phase and merged 1 into existing ones from ERP rollout.'),
    ).toBeInTheDocument();
  });

  it('+ Add phase posts the new phase name', async () => {
    const m = api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith(`/projects/${PID}/phases`) && init?.method === 'POST')
        return { status: 201, body: { name: 'Discovery' } };
      if (url.endsWith(`/projects/${PID}`))
        return {
          status: 200,
          body: { project: project({ status: 'PLANNING', templateName: null, taskCount: 0 }) },
        };
      return undefined;
    });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add phase' }));
    const dlg = await screen.findByRole('dialog', { name: 'Add phase' });
    await userEvent.type(within(dlg).getByLabelText('Phase name *'), 'Discovery');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add phase' }));
    await waitFor(() => expect(posted(m, `/projects/${PID}/phases`)).toHaveLength(1));
  });
});

describe('FR-PRJ-21: Checklist Delete outside Planning', () => {
  it('the PM can still delete an unattached activity on an Active project', async () => {
    const m = api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith('/tasks/k1') && init?.method === 'DELETE')
        return { status: 204, body: null };
      if (url.endsWith('/tasks/k1'))
        return { status: 200, body: { task: task({ id: 'k1', deletable: true }) } };
      if (url.includes(`/projects/${PID}/tasks`))
        return { status: 200, body: { items: [task({ id: 'k1', phase: 'Build' })] } };
      if (url.endsWith(`/projects/${PID}`))
        return { status: 200, body: { project: project({ status: 'ACTIVE' }) } };
      return undefined;
    });
    renderAt(`/projects/${PID}?task=k1`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dlg = await screen.findByRole('dialog', { name: /^Delete "/ });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(posted(m, '/tasks/k1', 'DELETE')).toHaveLength(1));
  });
});

describe('Q-69: leaving Planning with no phases', () => {
  it('asks to confirm; "Stay in Planning" sends nothing, "Move on anyway" saves', async () => {
    const m = api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith(`/projects/${PID}`) && init?.method === 'PATCH')
        return { status: 200, body: { project: project({ status: 'ACTIVE', taskCount: 0 }) } };
      if (url.endsWith(`/projects/${PID}`))
        return {
          status: 200,
          body: { project: project({ status: 'PLANNING', taskCount: 0, templateName: null }) },
        };
      return undefined;
    });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const edit = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(edit).getByLabelText(/Status/), 'ACTIVE');
    await userEvent.click(within(edit).getByRole('button', { name: /Save/ }));
    let dlg = await screen.findByRole('dialog', { name: 'Leave Planning with no phases?' });
    expect(dlg).toHaveTextContent(
      'This project has no phases or activities yet. Phase details will lock for PMs once it leaves Planning.',
    );
    await userEvent.click(within(dlg).getByRole('button', { name: 'Stay in Planning' }));
    expect(posted(m, `/projects/${PID}`, 'PATCH')).toHaveLength(0);
    const edit2 = await screen.findByRole('dialog');
    await userEvent.click(within(edit2).getByRole('button', { name: /Save/ }));
    dlg = await screen.findByRole('dialog', { name: 'Leave Planning with no phases?' });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Move on anyway' }));
    await waitFor(() => expect(posted(m, `/projects/${PID}`, 'PATCH')).toHaveLength(1));
  });
});
