import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  DashboardDto,
  EffortRowDto,
  IssueRowDto,
  MessageDto,
  MyProjectRowDto,
  WorkloadDto,
} from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { toCsv } from '../lib/reportCsv';
import { ACME, emptyDashboard, emptyIssueSummary } from './fixtures';
import { PID, api, project, task } from './m2fixtures';
import { renderAt } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ref = (id: string, name: string) => ({ id, name });

const myRow = (over: Partial<MyProjectRowDto> = {}): MyProjectRowDto => ({
  id: PID,
  name: 'SAP Rollout',
  client: ref(ACME.id, ACME.name),
  manager: ref('me-PROJECT_MANAGER', 'Me PM'),
  status: 'ACTIVE',
  health: 'DELAYED',
  progress: 40,
  baselineEnd: '2026-10-20',
  forecastEnd: '2026-10-29',
  daysLate: 9,
  overdueTasks: 2,
  blockedTasks: 1,
  openIssues: 3,
  openCriticalHighIssues: 1,
  waitingOnClient: 1,
  followUps: {
    people: [
      {
        person: { id: 'u2', name: 'Maria Member', email: 'm@x.example', active: true },
        overdue: 1,
        aging: 1,
        items: [
          {
            kind: 'TASK',
            id: 'k1',
            name: 'Kickoff',
            dueDate: '2026-10-13',
            reason: 'OVERDUE',
            href: `/projects/${PID}?task=k1`,
          },
        ],
      },
    ],
    contacts: [
      {
        contact: { id: 'c1', name: 'Ana Active', active: true },
        overdueTasks: 1,
        overdueDocuments: 0,
        items: [
          {
            kind: 'TASK',
            id: 'k3',
            name: 'Client sign-off',
            dueDate: '2026-10-19',
            reason: 'OVERDUE',
            href: `/projects/${PID}?task=k3`,
          },
        ],
      },
    ],
  },
  ...over,
});

const dash = (over: Partial<DashboardDto> = {}) =>
  emptyDashboard({
    kpis: {
      activeProjects: 4,
      delayedProjects: 1,
      overdueTasks: 5,
      overdueWaitingOnClient: 2,
      hoursThisWeek: 31.5,
      teamUtilizationPct: 79,
    },
    waitingOnClient: [
      {
        id: 'k3',
        name: 'Client sign-off',
        project: ref(PID, 'SAP Rollout'),
        client: ref(ACME.id, ACME.name),
        contact: { id: 'c1', name: 'Ana Active', active: true },
        dueDate: '2026-10-19',
        daysOverdue: 2,
      },
    ],
    upcomingMilestones: [
      {
        id: 'k9',
        name: 'Go-live',
        project: ref(PID, 'SAP Rollout'),
        client: ref(ACME.id, ACME.name),
        dueDate: '2026-10-29',
      },
    ],
    ...over,
  });

describe('Dashboard (FR-DASH-01..06) and My projects (doc 14 FR-PMV-01..04)', () => {
  it('PMs see the KPIs, AI placeholder, issue summary and My projects with days late and follow-ups', async () => {
    api('PROJECT_MANAGER', (url) => {
      if (url.endsWith('/dashboard/my-projects'))
        return {
          status: 200,
          body: {
            items: [
              myRow(),
              myRow({
                id: 'p2',
                name: 'On-time project',
                health: 'ON_TRACK',
                daysLate: -3,
                followUps: { people: [], contacts: [] },
              }),
            ],
          },
        };
      if (url.endsWith('/dashboard'))
        return {
          status: 200,
          body: dash({ myProjects: true, issues: { ...emptyIssueSummary(), open: 3, overdue: 1 } }),
        };
      return undefined;
    });
    renderAt('/', <App />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('2 waiting on client')).toBeInTheDocument();
    expect(screen.getByText('79% team utilization')).toBeInTheDocument();
    expect(screen.getByText('2 days overdue')).toBeInTheDocument();
    expect(screen.getByText('Phase 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Issues' })).toBeInTheDocument();

    // DR-27: Health is a health badge; Status and Waiting on client have their own columns.
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Health', 'Status', 'Waiting on client']));
    const sapRow = (await screen.findByText('SAP Rollout', { selector: 'a.fw-medium' })).closest(
      'tr',
    )!;
    expect(within(sapRow).getByText('Delayed')).toHaveClass('bg-label-danger');
    expect(within(sapRow).getByText('Active')).toBeInTheDocument();
    expect(
      within(sapRow).getByRole('link', { name: '1 waiting on client for SAP Rollout' }),
    ).toHaveAttribute('href', '#waiting-on-client');
    const late = await screen.findByText('9 days late');
    expect(late).toHaveClass('text-danger');
    expect(screen.getByText('On time')).toBeInTheDocument();
    expect(screen.getAllByText('1 critical/high')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: '1 person, 1 client contact' }));
    expect(screen.getByRole('link', { name: 'Kickoff' })).toHaveAttribute(
      'href',
      `/projects/${PID}?task=k1`,
    );
    expect(screen.getByText('Ana Active')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Late only'));
    expect(screen.queryByText('On-time project')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Late only'));
    await userEvent.selectOptions(screen.getByLabelText('Filter by health'), 'ON_TRACK');
    expect(screen.queryByText('SAP Rollout', { selector: 'a.fw-medium' })).not.toBeInTheDocument();
    expect(screen.getByText('On-time project')).toBeInTheDocument();
  });

  it('Members get the dashboard without My projects (and never ask for it)', async () => {
    const fetchMock = api('MEMBER', (url) =>
      url.endsWith('/dashboard') ? { status: 200, body: dash() } : undefined,
    );
    renderAt('/dashboard', <App />);
    expect(await screen.findByText('Upcoming milestones')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'My projects' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/my-projects'))).toBe(false);
  });

  it('Workload and Reports are live in the menu (no "Soon")', async () => {
    api('PROJECT_MANAGER');
    renderAt('/dashboard', <App />);
    expect(await screen.findByRole('link', { name: /Team & workload/ })).toHaveAttribute(
      'href',
      '/workload',
    );
    expect(screen.getByRole('link', { name: /Reports/ })).toHaveAttribute('href', '/reports');
    expect(screen.queryByText('Soon')).not.toBeInTheDocument();
  });
});

describe('Team & workload (FR-WL-01..03)', () => {
  const body = (weekStart: string): WorkloadDto => ({
    weekStart,
    weekEnd: '2026-10-25',
    note: "Hours aren't used as a performance score. Waiting time and scope changes are shown separately.",
    items: [
      {
        person: { id: 'u2', name: 'Maria Member', email: 'm@x.example', active: true },
        jobRole: 'PROJECT_MANAGER',
        teams: [ref('t1', 'SAP')],
        capacityHours: 40,
        assignedHours: 50,
        recordedHours: 30,
        waitingHours: 3,
        utilizationPct: 75,
        assignedPct: 125,
        overAssigned: true,
      },
    ],
  });

  it('flags over-capacity, shows waiting separately and moves between weeks', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url) =>
      url.includes('/workload')
        ? { status: 200, body: body(url.includes('week=2026-10-12') ? '2026-10-12' : '2026-10-19') }
        : undefined,
    );
    renderAt('/workload', <App />);
    expect(await screen.findByText('Over capacity')).toBeInTheDocument();
    expect(screen.getByText('125%')).toHaveClass('text-danger');
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('03:00')).toBeInTheDocument();
    // DR-34: the job role label, not the code.
    expect(screen.getByText('Project Manager')).toBeInTheDocument();
    expect(screen.queryByText('PROJECT_MANAGER')).not.toBeInTheDocument();
    expect(screen.getByText(/aren't used as a performance score/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('week=2026-10-12'))).toBe(true),
    );
  });
});

describe('DR-29: Team & workload for Members', () => {
  it("doesn't ask for /teams and builds the team filter from the rows", async () => {
    const row = (id: string, teams: { id: string; name: string }[]) => ({
      person: { id, name: `Person ${id}`, email: `${id}@x.example`, active: true },
      jobRole: 'CONSULTANT',
      teams,
      capacityHours: 40,
      assignedHours: 0,
      recordedHours: 0.03333333333333333,
      waitingHours: 0,
      utilizationPct: 0,
      assignedPct: 0,
      overAssigned: false,
    });
    const fetchMock = api('MEMBER', (url) =>
      url.includes('/workload')
        ? {
            status: 200,
            body: {
              weekStart: '2026-10-19',
              weekEnd: '2026-10-25',
              note: 'n',
              items: [row('a', [ref('t1', 'SAP')]), row('b', [ref('t2', 'Data')])],
            },
          }
        : url.endsWith('/teams')
          ? { status: 403, body: { error: { code: 'FORBIDDEN', message: 'No' } } }
          : undefined,
    );
    renderAt('/workload', <App />);
    expect(await screen.findByText('Person a')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/teams'))).toBe(false);
    const filter = screen.getByLabelText('Team');
    expect(
      within(filter)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All teams', 'Data', 'SAP']);
    // DR-25: hours from timed entries show as HH:MM, not raw decimals.
    expect(screen.getAllByText('00:02').length).toBeGreaterThan(0);
    expect(screen.queryByText(/0\.0333/)).not.toBeInTheDocument();
  });
});

describe('Reports (FR-RPT-01..06, FR-ISS-16)', () => {
  const effort = (over: Partial<EffortRowDto>): EffortRowDto => ({
    id: 'k1',
    name: 'Kickoff',
    project: ref(PID, 'SAP Rollout'),
    client: ref(ACME.id, 'Acme, Inc.'),
    owner: ref('u2', 'Maria Member'),
    status: 'COMPLETED',
    estHours: 8,
    actualHours: 12,
    variance: 4,
    overrunPct: 50,
    ...over,
  });

  it('effort variance shows +4 / +50% and No estimate; CSV has the visible columns of the filtered rows', async () => {
    api('PROJECT_MANAGER', (url) =>
      url.includes('/reports/effort-variance')
        ? {
            status: 200,
            body: {
              items: [
                effort({}),
                effort({
                  id: 'k2',
                  name: 'Design',
                  owner: ref('u3', 'Ken Lee'),
                  estHours: null,
                  actualHours: 2,
                  variance: null,
                  overrunPct: null,
                }),
              ],
            },
          }
        : undefined,
    );
    let csv = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const OrigBlob = Blob;
    vi.stubGlobal(
      'Blob',
      class extends OrigBlob {
        constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
          super(parts, opts);
          csv = parts.map(String).join('');
        }
      },
    );
    renderAt('/reports', <App />);
    expect(await screen.findByText('+04:00')).toBeInTheDocument();
    expect(screen.getByText('+50%')).toBeInTheDocument();
    expect(screen.getAllByText('No estimate', { selector: 'td' })).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText('Owners'), 'u2');
    expect(screen.queryByText('Design')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    const lines = csv.replace('\ufeff', '').split('\r\n');
    expect(lines[0]).toBe('Task,Project,Client,Owner,Status,Estimate,Actual,Variance,Overrun');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Kickoff,SAP Rollout,"Acme, Inc.",Maria Member');
    expect(lines[1]).toContain(',08:00,12:00,+04:00,+50%');
  });

  it('the issues tab shows the FR-ISS-16 summary; Timesheets is hidden without Time view', async () => {
    api('VIEWER', (url) =>
      url.includes('/reports/issues')
        ? {
            status: 200,
            body: {
              items: [],
              summary: {
                ...emptyIssueSummary(),
                open: 2,
                avgDaysToResolve: 3.5,
                perClient: [{ client: ref(ACME.id, ACME.name), open: 2, overdue: 1 }],
              },
            },
          }
        : undefined,
    );
    renderAt('/reports?tab=issues', <App />);
    expect(await screen.findByText('3.5')).toBeInTheDocument();
    expect(screen.getByText('2 open, 1 overdue')).toBeInTheDocument();
    expect(
      screen.getByText(
        /No issues match these filters\. Try clearing a filter or widening the date range\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Timesheets' })).toBeNull();
  });

  it('toCsv quotes commas, quotes and new lines', () => {
    expect(toCsv([{ label: 'A', value: (r: { a: string }) => r.a }], [{ a: 'x,"y"\nz' }])).toBe(
      'A\r\n"x,""y""\nz"',
    );
  });
});

describe('Admin › Settings › Time entry lock (Q-09)', () => {
  it('shows the default and saves a new day and time with the version', async () => {
    const fetchMock = api('ADMIN', (url, init) => {
      if (url.endsWith('/settings/time-lock') && init?.method === 'PUT')
        return {
          status: 200,
          body: {
            policy: { enabled: true, weekday: 2, hour: 9 },
            version: 1,
            boundary: null,
            description: '',
          },
        };
      if (url.endsWith('/settings/time-lock'))
        return {
          status: 200,
          body: {
            policy: { enabled: true, weekday: 1, hour: 12 },
            version: 0,
            boundary: '2026-10-19',
            description: '',
          },
        };
      return undefined;
    });
    renderAt('/admin/settings', <App />);
    expect(
      await screen.findByText("Last week's entries lock every Monday at 12:00 PM Philippine time."),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Day'), '2');
    await userEvent.selectOptions(screen.getByLabelText('Time (Philippine time)'), '9');
    expect(
      screen.getByText("Last week's entries lock every Tuesday at 9:00 AM Philippine time."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT');
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        enabled: true,
        weekday: 2,
        hour: 9,
        version: 0,
      });
    });
  });
});

describe('EC-68 and linking a message to an issue', () => {
  it('changing the client when issues keep old contacts asks to confirm, then sends confirmIssueContacts', async () => {
    let tries = 0;
    const fetchMock = api('ADMIN', (url, init) => {
      if (url.includes('/clients'))
        return {
          status: 200,
          body: {
            items: [ACME, { ...ACME, id: 'c'.repeat(24), name: 'Beta Corp' }],
            page: 1,
            pageSize: 100,
            total: 2,
          },
        };
      if (url.endsWith(`/projects/${PID}`) && init?.method === 'PATCH') {
        tries += 1;
        return tries === 1
          ? {
              status: 409,
              body: {
                error: {
                  code: 'ISSUE_CONTACTS_OLD_CLIENT',
                  message:
                    '1 issue keeps a contact from the current client: ACME-SAP-ISS-001. They stay as they are. Confirm to change the client.',
                  details: { issues: ['ACME-SAP-ISS-001'] },
                },
              },
            }
          : { status: 200, body: { project: project() } };
      }
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
      return undefined;
    });
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const client = await screen.findByLabelText('Client');
    await waitFor(() => expect(within(client).getByText('Beta Corp')).toBeInTheDocument());
    await userEvent.selectOptions(client, 'c'.repeat(24));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/ACME-SAP-ISS-001/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Change the client anyway'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([, i]) => i?.method === 'PATCH');
      expect(calls).toHaveLength(2);
      expect(JSON.parse(String(calls[1]?.[1]?.body))).toMatchObject({
        clientId: 'c'.repeat(24),
        confirmIssueContacts: true,
      });
    });
  });

  it('Conversation › Link to issue keeps existing links and sends the version', async () => {
    const msg: MessageDto = {
      id: 'm1',
      text: 'Client reported posting errors',
      type: 'CALL',
      author: { id: 'u2', name: 'Maria Member', active: true },
      at: '2026-10-09T01:30:00Z',
      task: null,
      contacts: [],
      hidden: null,
    };
    const row = { id: 'i1', key: 'ACME-SAP-ISS-001', title: 'Posting fails', severity: 'HIGH' };
    const fetchMock = api('PROJECT_MANAGER', (url, init) => {
      if (url.includes('/messages'))
        return { status: 200, body: { items: [msg], can: { post: true, hide: false } } };
      if (url.includes(`/projects/${PID}/issues`))
        return {
          status: 200,
          body: {
            items: [row as unknown as IssueRowDto],
            counts: { open: 1, critical: 0, high: 1, overdue: 0, waiting: 0 },
            can: { create: true },
          },
        };
      if (url.endsWith('/issues/i1') && init?.method === 'PATCH')
        return { status: 200, body: { issue: { ...row, version: 8 } } };
      if (url.endsWith('/issues/i1'))
        return {
          status: 200,
          body: { issue: { ...row, version: 7, links: { tasks: [], messages: [{ id: 'm0' }] } } },
        };
      if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
      if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: project() } };
      return undefined;
    });
    renderAt(`/projects/${PID}/conversation`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Link to issue' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link to issue' });
    await userEvent.selectOptions(await within(dialog).findByLabelText('Open issue'), 'i1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Link' }));
    expect(await within(dialog).findByText(/Linked to/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ version: 7, messageIds: ['m0', 'm1'] });
  });
});
