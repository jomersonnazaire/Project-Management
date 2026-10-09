import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IssueDto, IssueRowDto, NotificationDto } from '@xc8/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { issuesCsv } from '../lib/issuesCsv';
import { PID, api, project, task, type Route } from './m2fixtures';
import { renderAt } from './utils';

/** Milestone 3.5 web: issues (doc 13), task/phase delete, My tasks › Today (FR-TSK-22..25). */
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

const row = (over: Partial<IssueRowDto> = {}): IssueRowDto => ({
  id: 'i1',
  key: 'ACME-SAP-ISS-014',
  title: 'Item import fails on missing UoM',
  project: { id: PID, name: 'SAP B1 Rollout' },
  client: { id: 'c1', name: 'Acme' },
  stage: 'BEFORE_GO_LIVE',
  category: 'DATA',
  severity: 'CRITICAL',
  status: 'IN_PROGRESS',
  owner: { id: 'u2', name: 'Ken Lee', active: true } as IssueRowDto['owner'],
  ownerNeeded: false,
  contact: { id: 'ct1', name: 'Rosa Santos', active: true },
  dueDate: '2026-10-09',
  overdue: true,
  updatedAt: '2026-10-09T00:00:00Z',
  ...over,
});
const list = (items: IssueRowDto[]) => ({
  items,
  counts: { open: 5, critical: 1, high: 1, overdue: 2, waiting: 1 },
  can: { create: true },
});
const detail = (over: Partial<IssueDto> = {}): IssueDto => ({
  ...row(),
  description: 'Vendor BPs imported with VAT codes from the legacy system.',
  reportedBy: { id: 'u3', name: 'Maria Perez', active: true } as IssueDto['reportedBy'],
  dueManual: false,
  resolution: null,
  resolvedAt: null,
  closedAt: null,
  closedBy: null,
  closedReason: null,
  createdAt: '2026-10-07T07:10:00Z',
  version: 3,
  projectStatus: 'ACTIVE',
  projectArchived: false,
  links: { tasks: [{ id: 'k1', name: 'Client master data – BPs', status: 'TODO' }], messages: [] },
  attachments: [
    {
      documentId: 'd1',
      name: 'BP_TaxCode_Mismatch.xlsx',
      size: 225_280,
      mimeType: 'application/vnd.ms-excel',
      uploadedBy: { id: 'u3', name: 'Maria Perez' },
      at: '2026-10-07T00:00:00Z',
    },
  ],
  can: {
    edit: true,
    comment: true,
    attach: true,
    delete: false,
    transitions: ['WAITING_ON_CLIENT', 'RESOLVED'],
  },
  ...over,
});

const projectRoutes =
  (extra: Route = () => undefined): Route =>
  (url, init) =>
    extra(url, init) ??
    (url.endsWith(`/projects/${PID}`)
      ? { status: 200, body: { project: project() } }
      : url.endsWith(`/projects/${PID}/tasks`)
        ? { status: 200, body: { items: [task()] } }
        : undefined);

describe('Project › Issues tab (FR-ISS-07, mockup v7-issues)', () => {
  it('shows KPI cards, the open count on the tab, a red edge on Critical rows and red overdue dates', async () => {
    api(
      'PROJECT_MANAGER',
      projectRoutes((url) =>
        url.includes(`/projects/${PID}/issues`)
          ? {
              status: 200,
              body: list([
                row(),
                row({
                  id: 'i2',
                  key: 'ACME-SAP-ISS-012',
                  severity: 'MEDIUM',
                  overdue: false,
                  dueDate: '2026-10-16',
                }),
              ]),
            }
          : undefined,
      ),
    );
    renderAt(`/projects/${PID}/issues`, <App />);
    const critical = await screen.findByTestId('issue-row-ACME-SAP-ISS-014');
    expect(critical).toHaveClass('issue-critical');
    expect(within(critical).getByText('Oct 9 · overdue')).toHaveClass('text-danger');
    expect(screen.getByTestId('issue-row-ACME-SAP-ISS-012')).not.toHaveClass('issue-critical');
    expect(screen.getByText('1 / 1')).toHaveClass('text-danger');
    expect(screen.getByRole('link', { name: /Issues/ })).toHaveTextContent('Issues5');
    expect(screen.getByRole('button', { name: '+ Raise issue' })).toBeInTheDocument();
  });

  it('Raise issue checks the required fields, then posts and opens the new issue', async () => {
    const fetchMock = api(
      'PROJECT_MANAGER',
      projectRoutes((url, init) => {
        if (url.endsWith(`/projects/${PID}/issue-options`))
          return {
            status: 200,
            body: {
              users: [{ id: 'u2', name: 'Ken Lee', active: true }],
              contacts: [],
              tasks: [],
              messages: [],
              defaultStage: 'BEFORE_GO_LIVE',
              defaultDue: {
                CRITICAL: '2026-10-12',
                HIGH: '2026-10-14',
                MEDIUM: '2026-10-20',
                LOW: '2026-10-30',
              },
            },
          };
        if (url.endsWith(`/projects/${PID}/issues`) && init?.method === 'POST')
          return { status: 201, body: { issue: detail({ id: 'new1' }) } };
        if (url.includes(`/projects/${PID}/issues`) && (init?.method ?? 'GET') === 'GET')
          return { status: 200, body: list([]) };
        if (url.endsWith('/issues/new1'))
          return { status: 200, body: { issue: detail({ id: 'new1' }) } };
        return undefined;
      }),
    );
    renderAt(`/projects/${PID}/issues`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Raise issue' }));
    const dialog = await screen.findByRole('dialog', { name: 'Raise issue' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Raise issue' }));
    expect(within(dialog).getByText('Title is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a severity.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Tax codes mismatch');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Three codes missing');
    await userEvent.selectOptions(within(dialog).getByLabelText('Severity'), 'HIGH');
    expect(within(dialog).getByText('Due Oct 14 by default.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Raise issue' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith(`/projects/${PID}/issues`) && i?.method === 'POST',
      );
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        title: 'Tax codes mismatch',
        severity: 'HIGH',
        stage: 'BEFORE_GO_LIVE',
      });
    });
    expect(await screen.findByText('Comments & history')).toBeInTheDocument();
  });
});

describe('Issue detail (mockup v7-issue)', () => {
  it('Mark resolved asks for the resolution and sends it with the version', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url, init) => {
      if (url.endsWith('/issues/i1/status') && init?.method === 'POST')
        return { status: 200, body: { issue: detail({ status: 'RESOLVED' }) } };
      if (url.endsWith('/issues/i1')) return { status: 200, body: { issue: detail() } };
      return undefined;
    });
    renderAt('/issues/i1', <App />);
    expect(await screen.findByText('BP_TaxCode_Mismatch.xlsx')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '☑ Client master data – BPs' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Resolution/), 'Mapped the 3 legacy codes');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/issues/i1/status'));
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        version: 3,
        status: 'RESOLVED',
        resolution: 'Mapped the 3 legacy codes',
      });
    });
  });

  it('archived project: read-only note, no actions; completed: the support banner', async () => {
    api('VIEWER', (url) =>
      url.endsWith('/issues/i1')
        ? {
            status: 200,
            body: {
              issue: detail({
                projectArchived: true,
                can: { edit: false, comment: false, attach: false, delete: false, transitions: [] },
              }),
            },
          }
        : undefined,
    );
    renderAt('/issues/i1', <App />);
    expect(
      await screen.findByText('This project is archived, so its issues are read-only.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark resolved' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument();
  });
});

describe('All issues (FR-ISS-08, FR-ISS-17)', () => {
  it('lists issues with their project and exports the filtered list as CSV', async () => {
    api('PROJECT_MANAGER', (url) =>
      url.includes('/issues') ? { status: 200, body: list([row()]) } : undefined,
    );
    renderAt('/issues', <App />);
    expect(await screen.findByTestId('issue-row-ACME-SAP-ISS-014')).toHaveTextContent(
      'SAP B1 Rollout',
    );
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    const csv = issuesCsv([row({ title: 'Has, comma "quoted"' })]);
    expect(csv.split('\r\n')[0]).toBe(
      'ID,Project,Client,Title,Stage,Category,Severity,Status,Owner,Client contact,Due,Overdue',
    );
    expect(csv).toContain('"Has, comma ""quoted"""');
  });
});

describe('Notification bell: issues', () => {
  it('shows the issue key and opens the issue', async () => {
    const n: NotificationDto = {
      id: 'n1',
      type: 'ISSUE_ASSIGNED',
      actor: { id: 'u2', name: 'Paolo PM' },
      task: null,
      project: { id: PID, name: 'SAP B1 Rollout' },
      issue: { id: 'i1', key: 'ACME-SAP-ISS-014', title: 'Item import fails' },
      read: false,
      at: new Date().toISOString(),
    };
    api('MEMBER', (url) => {
      if (url.endsWith('/notifications/unread-count')) return { status: 200, body: { unread: 1 } };
      if (url.endsWith('/notifications')) return { status: 200, body: { items: [n], unread: 1 } };
      if (url.endsWith('/issues/i1')) return { status: 200, body: { issue: detail() } };
      return undefined;
    });
    renderAt('/my-tasks', <App />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications, 1 unread/ }));
    const item = await screen.findByText(/assigned you/);
    expect(item.closest('button')).toHaveTextContent('ACME-SAP-ISS-014 Item import fails');
    await userEvent.click(item.closest('button')!);
    expect(await screen.findByText('Comments & history')).toBeInTheDocument();
  });
});

describe('Delete a task or phase (M3.5)', () => {
  it('Delete shows only when allowed; when blocked the panel explains why', async () => {
    const reason = 'This task has 3 time entries; remove them first.';
    api(
      'PROJECT_MANAGER',
      projectRoutes((url) =>
        url.endsWith('/tasks/k1')
          ? { status: 200, body: { task: task({ deletable: false, deleteBlockedReason: reason }) } }
          : undefined,
      ),
    );
    renderAt(`/projects/${PID}?task=k1`, <App />);
    expect(await screen.findByTestId('delete-blocked')).toHaveTextContent(
      `Can’t delete: ${reason}`,
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('a deletable task asks to confirm, then sends DELETE', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const fetchMock = api(
      'PROJECT_MANAGER',
      projectRoutes((url, init) =>
        url.endsWith('/tasks/k1') && init?.method === 'DELETE'
          ? { status: 204, body: null }
          : url.endsWith('/tasks/k1')
            ? { status: 200, body: { task: task({ deletable: true }) } }
            : undefined,
      ),
    );
    renderAt(`/projects/${PID}?task=k1`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u).endsWith('/tasks/k1') && i?.method === 'DELETE',
        ),
      ).toBe(true),
    );
  });

  it('phases: blocked phases show the reason; an empty phase can be deleted after confirming', async () => {
    vi.stubGlobal('confirm', () => true);
    const fetchMock = api(
      'PROJECT_MANAGER',
      projectRoutes((url, init) => {
        if (url.includes(`/projects/${PID}/phases`) && init?.method === 'DELETE')
          return { status: 204, body: null };
        if (url.endsWith(`/projects/${PID}/phases`))
          return {
            status: 200,
            body: {
              items: [
                {
                  name: 'Phase 1',
                  taskCount: 1,
                  documentCount: 0,
                  deletable: false,
                  deleteBlockedReason: 'This phase has 1 task; delete or move it first.',
                },
                {
                  name: 'Go-live',
                  taskCount: 0,
                  documentCount: 0,
                  deletable: true,
                  deleteBlockedReason: null,
                },
              ],
            },
          };
        return undefined;
      }),
    );
    renderAt(`/projects/${PID}`, <App />);
    expect(
      await screen.findByText('This phase has 1 task; delete or move it first.'),
    ).toBeInTheDocument();
    const empty = await screen.findByTestId('empty-phase-Go-live');
    await userEvent.click(within(empty).getByRole('button', { name: 'Delete phase' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) => String(u).includes('/phases?name=Go-live') && i?.method === 'DELETE',
        ),
      ).toBe(true),
    );
  });
});

describe('My tasks › Today (FR-TSK-22..25, TC-N22/N23/N26)', () => {
  const t = (over: Record<string, unknown>) => ({
    id: 'k1',
    name: 'Task',
    project: { id: PID, name: 'SAP B1 Rollout' },
    phase: 'Phase 1',
    role: 'ACCOUNTABLE',
    dueDate: '2026-10-14',
    overdue: false,
    daysLate: 0,
    estHours: 4,
    actualHours: 0,
    status: 'TODO',
    party: 'INTERNAL',
    plannedStart: '2026-10-09',
    section: 'PLANNED',
    ageDays: 0,
    ...over,
  });
  it('Planned for today first, then Aging with amber/red age badges', async () => {
    api('MEMBER', (url) =>
      url.includes('/tasks/mine')
        ? {
            status: 200,
            body: {
              today: '2026-10-09',
              holiday: null,
              counts: {
                today: 4,
                due: 1,
                overdue: 1,
                dueThisWeek: 0,
                toReview: 0,
                assigned: 4,
                accountable: 4,
              },
              items: [
                t({ id: 'p1', name: 'Prepare UAT scripts' }),
                t({
                  id: 'a8',
                  name: 'Client master data – Items',
                  section: 'AGING',
                  ageDays: 8,
                  status: 'BLOCKED',
                  overdue: true,
                  plannedStart: '2026-09-29',
                  dueDate: '2026-10-03',
                }),
                t({
                  id: 'a4',
                  name: 'Configure system',
                  section: 'AGING',
                  ageDays: 4,
                  plannedStart: '2026-10-05',
                  dueDate: '2026-10-20',
                }),
                t({
                  id: 'a2',
                  name: 'Draft training outline',
                  section: 'AGING',
                  ageDays: 2,
                  plannedStart: '2026-10-07',
                  dueDate: '2026-10-23',
                }),
              ],
            },
          }
        : undefined,
    );
    renderAt('/my-tasks', <App />);
    expect(
      await screen.findByRole('heading', { name: 'Planned for today · 1' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Aging · 3/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Today/ })).toHaveTextContent('Today4');
    expect(screen.getByRole('button', { name: /^Due/ })).toHaveTextContent('Due1');
    expect(within(screen.getByTestId('aging-a8')).getByText('8 working days')).toHaveAttribute(
      'data-tone',
      'red',
    );
    expect(within(screen.getByTestId('aging-a4')).getByText('4 working days')).toHaveAttribute(
      'data-tone',
      'amber',
    );
    expect(within(screen.getByTestId('aging-a2')).getByText('2 working days')).toHaveAttribute(
      'data-tone',
      'none',
    );
    expect(within(screen.getByTestId('aging-a8')).getByText('Blocked')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('planned-p1')).queryByText(/working day/),
    ).not.toBeInTheDocument();
  });
});
