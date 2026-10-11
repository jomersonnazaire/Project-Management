import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PROJECT_CODE_LOCKED, PROJECT_CODE_TAKEN, issuePrefix } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ACME } from './fixtures';
import { ME_PM, PID, api, project, task } from './m2fixtures';
import { renderAt } from './utils';

afterEach(() => vi.unstubAllGlobals());

const TEMPLATES = {
  status: 200,
  body: {
    items: [
      {
        id: 't1',
        name: 'Small',
        type: 'SAP_B1',
        status: 'PUBLISHED',
        version: 1,
        activityCount: 1,
        dependencyCount: 1,
        deliverableCount: 1,
      },
    ],
  },
};
const CLIENTS = { status: 200, body: { items: [ACME], page: 1, pageSize: 100, total: 1 } };
const PEOPLE = [
  { id: ME_PM, name: 'Me PM', email: 'pm@x.example', active: true, systemRole: 'PROJECT_MANAGER' },
];

describe('DR-23 project code', () => {
  it('New project suggests a code and shows the duplicate-code error inline', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url, init) => {
      if (url.includes('/templates')) return TEMPLATES;
      if (url.includes('/people')) return { status: 200, body: { items: PEOPLE } };
      if (url.includes('/clients')) return CLIENTS;
      if (url.endsWith('/projects') && init?.method === 'POST')
        return {
          status: 409,
          body: {
            error: {
              code: 'PROJECT_CODE_TAKEN',
              message: PROJECT_CODE_TAKEN,
              details: [{ path: 'code', message: PROJECT_CODE_TAKEN }],
            },
          },
        };
      return undefined;
    });
    renderAt(`/projects/new?clientId=${ACME.id}`, <App />);
    await userEvent.selectOptions(await screen.findByLabelText('Template'), 't1');
    await screen.findByRole('option', { name: 'Implementation' });
    await userEvent.selectOptions(screen.getByLabelText('Project type *'), 'pt1');
    const code = screen.getByLabelText('Project code');
    expect(code).toHaveValue(issuePrefix(ACME.name, 'SAP_B1'));
    await userEvent.clear(code);
    await userEvent.type(code, 'acme-sap');
    expect(code).toHaveValue('ACME-SAP');
    await userEvent.type(screen.getByLabelText('Project name'), 'Rollout');
    await userEvent.type(screen.getByLabelText('Baseline end'), '2099-12-18');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText(PROJECT_CODE_TAKEN)).toBeInTheDocument();
    expect(code).toHaveClass('is-invalid');
    const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ code: 'ACME-SAP' });
  });

  it('Edit project: the code is read-only with the hint once the project has issues', async () => {
    api('PROJECT_MANAGER', (url) => {
      if (url.includes('/people')) return { status: 200, body: { items: PEOPLE } };
      if (url.includes('/clients')) return CLIENTS;
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
      if (url.endsWith(`/projects/${PID}`))
        return {
          status: 200,
          body: { project: project({ managerId: ME_PM, codeLocked: true, code: 'ACME-SAP' }) },
        };
      return undefined;
    });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const code = await screen.findByLabelText('Project code');
    expect(code).toHaveAttribute('readonly');
    expect(code).toHaveValue('ACME-SAP');
    expect(screen.getByText(PROJECT_CODE_LOCKED)).toBeInTheDocument();
  });

  it('Edit project: an unlocked code can change and is sent in capitals', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url, init) => {
      if (url.includes('/people')) return { status: 200, body: { items: PEOPLE } };
      if (url.includes('/clients')) return CLIENTS;
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
      if (url.endsWith(`/projects/${PID}`) && init?.method === 'PATCH')
        return { status: 200, body: { project: project({ managerId: ME_PM }) } };
      if (url.endsWith(`/projects/${PID}`))
        return { status: 200, body: { project: project({ managerId: ME_PM }) } };
      return undefined;
    });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const code = await screen.findByLabelText('Project code');
    await userEvent.clear(code);
    await userEvent.type(code, 'acme-b1');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ code: 'ACME-B1' });
    });
  });
});
