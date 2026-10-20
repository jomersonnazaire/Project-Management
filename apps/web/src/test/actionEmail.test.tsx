import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SystemRole } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { PID, api, project, task, type Route } from './m2fixtures';
import { renderAt } from './utils';

/**
 * Action emails (roadmap §4): "Email {name}" on follow-ups, task assignment and adding project
 * members. Ticked by default for Microsoft-linked users, disabled with one generic hint for
 * unlinked users, hidden while the flag is off. Queen's FE-02, FE-03, FE-11a/b, FA-02/04/11.
 */
beforeEach(() => {
  // Bootstrap off-canvas panels read matchMedia, which jsdom lacks.
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
});
afterEach(() => vi.unstubAllGlobals());

const HINT = 'Link your Microsoft account to send emails.';
const FU = {
  id: 'f1',
  note: 'Called the client',
  author: { id: 'me-PROJECT_MANAGER', name: 'Me PM' },
  contact: null,
  at: '2026-10-20T01:00:00.000Z',
  emailedAt: null,
};

function setup(
  status: { enabled: boolean; linked: boolean } | null,
  extra: Route = () => undefined,
) {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  const fetchMock = api('PROJECT_MANAGER' as SystemRole, (url, init) => {
    const r = extra(url, init);
    if (r) return r;
    if (url.endsWith('/auth/me/email-status'))
      return status ? { status: 200, body: status } : { status: 200, body: {} };
    if (url.endsWith('/tasks/k1/follow-ups') && init?.method === 'POST')
      return { status: 201, body: { task: task({ followUps: [FU] }) } };
    if (url.endsWith(`/projects/${PID}/tasks`) && init?.method === 'POST')
      return { status: 201, body: { task: task({ id: 'k2' }) } };
    if (url.endsWith('/action-emails') && init?.method === 'POST')
      return { status: 200, body: { url: 'https://login.microsoftonline.com/x', recipients: 1 } };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
    if (url.endsWith('/tasks/k1')) return { status: 200, body: { task: task() } };
    if (url.endsWith(`/projects/${PID}`) && init?.method === 'PATCH')
      return { status: 200, body: { project: project() } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
    if (url.includes('/people'))
      return {
        status: 200,
        body: {
          items: [
            { id: 'me-PROJECT_MANAGER', name: 'Me PM', systemRole: 'PROJECT_MANAGER' },
            { id: 'u2', name: 'Maria Member', systemRole: 'MEMBER' },
            { id: 'u9', name: 'Nina New', systemRole: 'MEMBER' },
          ],
        },
      };
    return undefined;
  });
  const emailCalls = () =>
    fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/action-emails'));
  return { assign, emailCalls };
}

describe('Follow-up "Email {name}"', () => {
  it('linked: ticked by default; posting the follow-up starts the email from my Outlook', async () => {
    const { assign, emailCalls } = setup({ enabled: true, linked: true });
    renderAt(`/projects/${PID}?task=k1`, <App />);
    const box = await screen.findByRole('checkbox', { name: 'Email Maria M.' });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Follow-up note'), 'Called the client');
    await userEvent.click(screen.getByRole('button', { name: 'Post follow-up' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://login.microsoftonline.com/x'));
    expect(JSON.parse(String(emailCalls()[0]![1]!.body))).toEqual({
      kind: 'FOLLOW_UP',
      taskId: 'k1',
      followUpId: 'f1',
    });
  });

  it('linked but unticked: the follow-up posts, no email (FE-11a)', async () => {
    const { assign, emailCalls } = setup({ enabled: true, linked: true });
    renderAt(`/projects/${PID}?task=k1`, <App />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Email Maria M.' }));
    await userEvent.type(screen.getByLabelText('Follow-up note'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Post follow-up' }));
    await waitFor(() => expect(screen.getByLabelText('Follow-up note')).toHaveValue(''));
    expect(emailCalls()).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it('unlinked: disabled with the hint; the follow-up still posts (FE-02)', async () => {
    const { assign, emailCalls } = setup({ enabled: true, linked: false });
    renderAt(`/projects/${PID}?task=k1`, <App />);
    const box = await screen.findByRole('checkbox', { name: 'Email Maria M.' });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Follow-up note'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Post follow-up' }));
    await waitFor(() => expect(screen.getByLabelText('Follow-up note')).toHaveValue(''));
    expect(emailCalls()).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it('flag off: no email option at all (FE-03)', async () => {
    setup({ enabled: false, linked: true });
    renderAt(`/projects/${PID}?task=k1`, <App />);
    expect(await screen.findByLabelText('Follow-up note')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^Email / })).not.toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});

describe('Task assigned "Email {name}"', () => {
  it('names only the person newly given the task, never me, and emails after the save', async () => {
    const { assign, emailCalls } = setup({ enabled: true, linked: true });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add task' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Task name'), 'Go-live');
    // Self-assign: nobody to email, so no checkbox (FA-06).
    await userEvent.selectOptions(dialog.getByLabelText('Owner (accountable)'), 'Me PM');
    expect(dialog.queryByRole('checkbox', { name: /^Email / })).not.toBeInTheDocument();
    await userEvent.selectOptions(dialog.getByLabelText('Owner (accountable)'), 'Maria Member');
    expect(dialog.getByRole('checkbox', { name: 'Email Maria Member' })).toBeChecked();
    await userEvent.click(dialog.getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(JSON.parse(String(emailCalls()[0]![1]!.body))).toEqual({
      kind: 'TASK_ASSIGNED',
      taskId: 'k2',
      userIds: ['u2'],
    });
  });

  it('unlinked: disabled with the same hint; the task still saves (FA-02)', async () => {
    const { emailCalls } = setup({ enabled: true, linked: false });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add task' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Task name'), 'Go-live');
    await userEvent.selectOptions(dialog.getByLabelText('Owner (accountable)'), 'Maria Member');
    expect(dialog.getByRole('checkbox', { name: 'Email Maria Member' })).toBeDisabled();
    expect(dialog.getByText(HINT)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(emailCalls()).toHaveLength(0);
  });
});

describe('Added to project "Email {name}"', () => {
  it('shows only the newly added people and emails them after the save', async () => {
    const { assign, emailCalls } = setup({ enabled: true, linked: true });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    expect(screen.queryByRole('checkbox', { name: /^Email / })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByLabelText('Nina New'));
    const box = screen.getByRole('checkbox', { name: 'Email Nina New' });
    expect(box).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(JSON.parse(String(emailCalls()[0]![1]!.body))).toEqual({
      kind: 'PROJECT_ADDED',
      projectId: PID,
      userIds: ['u9'],
    });
  });

  it('unlinked: disabled with the same hint (FA-04)', async () => {
    setup({ enabled: true, linked: false });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    await userEvent.click(await screen.findByLabelText('Nina New'));
    expect(screen.getByRole('checkbox', { name: 'Email Nina New' })).toBeDisabled();
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });
});

describe('Result after the Microsoft round trip', () => {
  it('shows sent and error messages from the query string', async () => {
    setup({ enabled: true, linked: true });
    renderAt(`/projects/${PID}?email=sent`, <App />);
    expect(await screen.findByText('Email sent from your Outlook.')).toBeInTheDocument();
  });

  it('explains missing admin consent', async () => {
    setup({ enabled: true, linked: true });
    renderAt(`/projects/${PID}?email_error=admin_consent_required`, <App />);
    expect(await screen.findByTestId('email-result')).toHaveTextContent(/admin consent/);
  });
});
