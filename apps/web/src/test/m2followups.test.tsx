import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectDto, SystemRole } from '@xc8/shared';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { EstAct, ScheduleVariance } from '../components/ProjectBadges';
import { useEdgeFade } from '../lib/useEdgeFade';
import { ACME } from './fixtures';
import { ME_PM, PID, api, project, task, type Route } from './m2fixtures';
import { renderAt } from './utils';

/** Milestone 2 follow-ups: doc 11 §12 decisions and design review DR-08..DR-11. */
afterEach(() => vi.unstubAllGlobals());

const PEOPLE = [
  { id: ME_PM, name: 'Me PM', systemRole: 'PROJECT_MANAGER', jobRole: 'PROJECT_MANAGER' },
  { id: 'pm2', name: 'Pat Manager', systemRole: 'PROJECT_MANAGER', jobRole: 'PROJECT_MANAGER' },
  { id: 'u2', name: 'Maria Member', systemRole: 'MEMBER', jobRole: 'CONSULTANT' },
];

function projectApi(p: ProjectDto, role: SystemRole, extra: Route = () => undefined) {
  return api(role, (url, init) => {
    const r = extra(url, init);
    if (r) return r;
    if (url.includes(`/projects/${PID}/tasks`))
      return { status: 200, body: { items: [task({ estHours: 4, actualHours: 6 })] } };
    if (url.includes(`/projects/${PID}/activity`))
      return {
        status: 200,
        body: {
          items: [
            {
              id: 'e1',
              at: '2026-10-09T01:00:00.000Z',
              actor: { id: ME_PM, name: 'Me PM' },
              action: 'project_handover',
              changes: [{ field: 'managerId', old: ME_PM, new: 'pm2' }],
              reason: null,
            },
          ],
        },
      };
    if (url.includes('/people')) return { status: 200, body: { items: PEOPLE } };
    if (url.includes('/clients'))
      return { status: 200, body: { items: [ACME], page: 1, pageSize: 100, total: 1 } };
    if (url.endsWith(`/projects/${PID}`) && init?.method === 'PATCH')
      return { status: 200, body: { project: { ...p, managerId: 'pm2' } } };
    if (url.endsWith(`/projects/${PID}`)) return { status: 200, body: { project: p } };
    return undefined;
  });
}

describe('Project Activity log for PMs (doc 11 §12)', () => {
  it('a PM sees the Activity log tab on a project they view but do not manage, and can read it', async () => {
    projectApi(
      project({
        managerId: 'pm2',
        can: {
          edit: false,
          archive: false,
          delete: false,
          planTasks: false,
          addMembers: false,
          activity: true,
        },
      }),
      'PROJECT_MANAGER',
    );
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('link', { name: 'Activity log' }));
    expect(await screen.findByText(/project handover/)).toBeInTheDocument();
  });

  it('Members do not get the tab (the API answers can.activity = false)', async () => {
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
    expect(await screen.findByRole('link', { name: 'Board' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Activity log' })).not.toBeInTheDocument();
  });
});

describe('Draft templates only with Edit on templates (doc 11 §12)', () => {
  const list: Route = (url) =>
    url.includes('/templates')
      ? {
          status: 200,
          body: {
            items: [
              {
                id: 't1',
                name: 'SAP B1 Implementation',
                type: 'SAP_B1',
                status: 'PUBLISHED',
                version: 1,
                activityCount: 1,
                phaseCount: 1,
                projectCount: 0,
                draftId: null,
                updatedAt: '2026-10-09T00:00:00.000Z',
              },
            ],
          },
        }
      : undefined;

  it('Members get no Drafts or Archived filters; PMs do', async () => {
    api('MEMBER', list);
    const a = renderAt('/templates', <App />);
    expect(await screen.findByRole('link', { name: 'SAP B1 Implementation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Drafts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archived' })).not.toBeInTheDocument();
    // DR-10 on the list too.
    expect(screen.getByText('1 activity in 1 phase')).toBeInTheDocument();
    a.unmount();
    vi.unstubAllGlobals();
    api('PROJECT_MANAGER', list);
    renderAt('/templates', <App />);
    expect(await screen.findByRole('button', { name: 'Drafts' })).toBeInTheDocument();
  });
});

describe('PM handover confirmation (doc 11 §12)', () => {
  const pmProject = project({ managerId: ME_PM });

  it('a PM reassigning a project they manage confirms with the agreed copy; Cancel sends nothing', async () => {
    const fetchMock = projectApi(pmProject, 'PROJECT_MANAGER');
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const manager = await screen.findByLabelText('Project manager');
    await waitFor(() => expect(within(manager).getByText('Pat Manager')).toBeInTheDocument());
    await userEvent.selectOptions(manager, 'pm2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Hand over this project to Pat Manager?',
    });
    expect(dialog).toHaveTextContent(
      "After this, only Pat Manager and Admins can edit or archive it. You'll still be able to view it.",
    );
    const handOver = within(dialog).getByRole('button', { name: 'Hand over' });
    expect(handOver).toHaveClass('btn-primary');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const again = await screen.findByRole('dialog', {
      name: 'Hand over this project to Pat Manager?',
    });
    await userEvent.click(within(again).getByRole('button', { name: 'Hand over' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ managerId: 'pm2' });
    });
  });

  it('Admins change the manager without the handover dialog', async () => {
    const fetchMock = projectApi(pmProject, 'ADMIN');
    renderAt(`/projects/${PID}`, <App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit project' }));
    const manager = await screen.findByLabelText('Project manager');
    await waitFor(() => expect(within(manager).getByText('Pat Manager')).toBeInTheDocument());
    await userEvent.selectOptions(manager, 'pm2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true),
    );
    expect(screen.queryByText(/Hand over this project/)).not.toBeInTheDocument();
  });

  it('a PM creating a project for another PM confirms the handover too', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url, init) => {
      if (url.includes('/templates'))
        return {
          status: 200,
          body: {
            items: [
              {
                id: 't1',
                name: 'Small',
                type: 'GENERAL_IT',
                status: 'PUBLISHED',
                version: 1,
                activityCount: 1,
                dependencyCount: 1,
                deliverableCount: 1,
              },
            ],
          },
        };
      if (url.includes('/people')) return { status: 200, body: { items: PEOPLE } };
      if (url.includes('/clients'))
        return { status: 200, body: { items: [ACME], page: 1, pageSize: 100, total: 1 } };
      if (url.endsWith('/projects') && init?.method === 'POST')
        return { status: 201, body: { project: project(), warnings: [] } };
      return undefined;
    });
    renderAt(`/projects/new?clientId=${ACME.id}`, <App />);
    await userEvent.selectOptions(await screen.findByLabelText('Template'), 't1');
    // DR-10 in the template preview.
    expect(screen.getByTestId('template-preview')).toHaveTextContent(
      'Generates 1 activity, 1 dependency and 1 deliverable.',
    );
    await userEvent.type(screen.getByLabelText('Project name'), 'For Pat');
    await userEvent.clear(screen.getByLabelText('Baseline start'));
    await userEvent.type(screen.getByLabelText('Baseline start'), '2026-10-12');
    await userEvent.type(screen.getByLabelText('Baseline end'), '2026-12-18');
    await userEvent.selectOptions(screen.getByLabelText('Project manager'), 'pm2');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Hand over this project to Pat Manager?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hand over' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true),
    );
  });
});

describe('DR-08 estimate cells', () => {
  it('no estimate reads "– / –" on one line with "No estimate" beneath; hours carry units', () => {
    const { container, rerender } = render(<EstAct est={null} act={0} />);
    const line = container.querySelector('.text-nowrap')!;
    expect(line).toHaveTextContent(/^– \/ –$/);
    expect(container.querySelector('small')).toHaveTextContent('No estimate');
    rerender(<EstAct est={4} act={6} />);
    expect(container).toHaveTextContent(/^04:00 \/ 06:00$/);
    rerender(<EstAct est={4} act={0} />);
    expect(container).toHaveTextContent(/^04:00 \/ –$/);
  });

  it('the checklist shows units and pluralizes the summary (DR-10)', async () => {
    projectApi(project({ taskCount: 1, unestimatedTaskCount: 0 }), 'PROJECT_MANAGER');
    renderAt(`/projects/${PID}`, <App />);
    const row = (await screen.findByRole('button', { name: 'Kickoff' })).closest('tr')!;
    expect(within(row).getByText('04:00 / 06:00')).toBeInTheDocument();
    expect(screen.getByText(/Estimated 04:00 across 1 task ·/)).toBeInTheDocument();
    expect(screen.getByText('1 task · 0 without an estimate')).toBeInTheDocument();
  });
});

describe('DR-09 forecast vs baseline', () => {
  it('reads "N days before baseline end" in green, "N days late" in red, or "On baseline"', () => {
    const { container, rerender } = render(<ScheduleVariance days={-38} />);
    expect(container.firstChild).toHaveTextContent('38 days before baseline end');
    expect(container.firstChild).toHaveClass('text-success');
    rerender(<ScheduleVariance days={1} />);
    expect(container.firstChild).toHaveTextContent('1 day late');
    expect(container.firstChild).toHaveClass('text-danger');
    rerender(<ScheduleVariance days={0} />);
    expect(container.firstChild).toHaveTextContent('On baseline');
  });

  it('the project summary uses the wording, not "−38 days"', async () => {
    projectApi(
      project({ scheduleVarianceDays: -38, forecastEnd: '2026-11-10' }),
      'PROJECT_MANAGER',
    );
    renderAt(`/projects/${PID}`, <App />);
    expect(await screen.findByText('38 days before baseline end')).toHaveClass('text-success');
    expect(screen.queryByText(/−38/)).not.toBeInTheDocument();
  });
});

describe('DR-11 board fits five columns, with a scroll hint when narrower', () => {
  it('the CSS gives 5 flexible columns whose minimum widths fit the 1280px content area', () => {
    const css = readFileSync(resolve(__dirname, '../styles/main.scss'), 'utf8');
    expect(css).toMatch(/grid-template-columns: repeat\(5, minmax\(\$board-col-min, 1fr\)\)/);
    const min = Number(/\$board-col-min: (\d+)px/.exec(css)?.[1]);
    const gapRem = Number(/\$board-gap: ([\d.]+)rem/.exec(css)?.[1]);
    // 1280 − 260px menu − 2 × 24px page padding.
    expect(5 * min + 4 * gapRem * 16).toBeLessThanOrEqual(1280 - 260 - 48);
    expect(css).toMatch(/\.board-wrap \{[\s\S]*&\.is-overflowing::after/);
    expect(css).toMatch(/overflow-x: auto/);
  });

  function Probe({ scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
    const { ref, fade, update } = useEdgeFade<HTMLDivElement>();
    return (
      <div data-testid="wrap" className={fade ? 'is-overflowing' : ''}>
        <div
          data-testid="scroller"
          ref={(el) => {
            ref.current = el;
            if (el) {
              Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
              Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
            }
          }}
          onScroll={update}
        />
      </div>
    );
  }

  it('shows the edge fade only while columns are hidden to the right', async () => {
    const { rerender } = render(<Probe scrollWidth={1200} clientWidth={900} />);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('wrap')).toHaveClass('is-overflowing');
    // Scrolled to the end: no fade.
    const scroller = screen.getByTestId('scroller');
    scroller.scrollLeft = 300;
    fireEvent.scroll(scroller);
    expect(screen.getByTestId('wrap')).not.toHaveClass('is-overflowing');
    // Everything fits: no fade.
    rerender(<Probe scrollWidth={900} clientWidth={900} />);
    scroller.scrollLeft = 0;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('wrap')).not.toHaveClass('is-overflowing');
  });

  it('the board renders inside the scroll wrapper', async () => {
    projectApi(project(), 'PROJECT_MANAGER');
    renderAt(`/projects/${PID}/board`, <App />);
    const wrap = await screen.findByTestId('board-wrap');
    expect(within(wrap).getAllByRole('region')).toHaveLength(5);
    // DR-08 on board cards.
    expect(within(wrap).getByText('04:00 / 06:00')).toBeInTheDocument();
  });
});
