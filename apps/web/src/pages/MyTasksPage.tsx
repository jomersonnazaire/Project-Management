import { HOLIDAY_BANNER_NOTE, HOLIDAY_TYPE_LABELS, type MyTaskDto } from '@xc8/shared';
import { useState } from 'react';
import { Button, Form, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useTimeWeek } from '../api/m3Hooks';
import { useMyTasks } from '../api/projectHooks';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorAlert, LoadingRows } from '../components/Feedback';
import { LogTimeModal } from '../components/LogTimeModal';
import { PageHeader } from '../components/PageHeader';
import { EstAct, TaskStatusBadge } from '../components/ProjectBadges';
import { hoursLabel, longDay, shortDate } from '../lib/format';

const VIEWS = [
  { key: 'today', label: 'Today' },
  { key: 'assigned', label: 'Assigned to me' },
  { key: 'accountable', label: "I'm accountable" },
  { key: 'review', label: 'To review' },
  { key: 'completed', label: 'Completed' },
] as const;

const ROLE_LABELS = {
  ACCOUNTABLE: 'Accountable',
  ASSIGNEE: 'Assignee',
  REVIEWER: 'Reviewer',
} as const;

const daysOverdue = (n: number) => `${n} day${n === 1 ? '' : 's'} overdue`;

/** The Today tab (FR-TSK-20/21): overdue first in red, then due today, by Philippine date. */
function TodayList({
  items,
  today,
  onLog,
}: {
  items: MyTaskDto[];
  today: string;
  onLog: (t: MyTaskDto) => void;
}) {
  const overdue = items.filter((t) => t.overdue);
  const dueToday = items.filter((t) => !t.overdue);
  const section = (title: string, rows: MyTaskDto[], danger: boolean) =>
    rows.length > 0 && (
      <>
        <h3 className={`h6 mt-4 mb-2 ${danger ? 'text-danger' : ''}`}>
          {title} · {rows.length}
        </h3>
        <div className="table-responsive">
          <table className="table table-stack-md">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="cell-primary">
                    <Link className="fw-medium" to={`/projects/${t.project.id}?task=${t.id}`}>
                      {t.name}
                    </Link>
                    <div className="small text-body-secondary">
                      {t.project.name}
                      {t.phase && ` · ${t.phase}`}
                    </div>
                  </td>
                  <td
                    data-label="Due"
                    className={`text-nowrap ${t.overdue ? 'text-danger fw-semibold' : ''}`}
                  >
                    {t.overdue ? `${shortDate(t.dueDate)} · ${daysOverdue(t.daysLate)}` : 'Today'}
                  </td>
                  <td data-label="Status">
                    <TaskStatusBadge status={t.status} />
                  </td>
                  <td className="text-end">
                    <Button size="sm" variant="outline-primary" onClick={() => onLog(t)}>
                      Log time
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  return (
    <>
      <div className="d-flex align-items-baseline gap-2">
        <strong className="text-heading">{longDay(today)}</strong>
        <small className="text-body-secondary">Philippine time</small>
      </div>
      {items.length === 0 ? (
        <EmptyState icon="bx-sun" title="Nothing due today">
          You're clear for today.
        </EmptyState>
      ) : (
        <>
          {section('Overdue', overdue, true)}
          {section('Due today', dueToday, false)}
        </>
      )}
      <p className="small text-body-secondary mt-3 mb-0">
        Open tasks assigned to you (owner or assignee). Overdue tasks are listed first. "Today" uses
        Philippine time, so it flips at midnight here, not in UTC. Done tasks drop off the list.
      </p>
    </>
  );
}

/** My tasks: the sign-in landing page (FR-TSK-13, FR-TSK-20, AC-17.1, AC-TODAY-1). */
export function MyTasksPage() {
  const { user } = useAuth();
  const [view, setView] = useState<string>('today');
  const [q, setQ] = useState('');
  const [logging, setLogging] = useState<MyTaskDto | null>(null);
  const mine = useMyTasks(view, q || undefined);
  const week = useTimeWeek();
  const counts = mine.data?.counts;
  const items = mine.data?.items ?? [];
  const holiday = mine.data?.holiday;
  const kpis = [
    { label: 'Overdue', value: String(counts?.overdue ?? 0) },
    { label: 'Due this week', value: String(counts?.dueThisWeek ?? 0) },
    { label: 'Waiting for my review', value: String(counts?.toReview ?? 0) },
    {
      label: 'Logged this week',
      value: `${hoursLabel(week.data?.total ?? 0)}h`,
      sub: `of ${week.data?.capacity ?? user?.weeklyCapacityHours ?? 40}h available`,
    },
  ];

  return (
    <>
      <PageHeader title="My tasks" />
      {holiday && (
        <div className="alert alert-info" role="status">
          <i className="bx bx-calendar me-2" aria-hidden="true" />
          Today is {holiday.name} ({HOLIDAY_TYPE_LABELS[holiday.type].toLowerCase()}).{' '}
          {HOLIDAY_BANNER_NOTE}
        </div>
      )}
      <div className="row g-6 mb-6">
        {kpis.map((k) => (
          <div className="col-sm-6 col-xl-3" key={k.label}>
            <div className="card h-100">
              <div className="card-body">
                <p className="mb-1">{k.label}</p>
                <h3 className="mb-0">{k.value}</h3>
                {k.sub && <small className="text-body-secondary">{k.sub}</small>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-body">
          <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
            <Nav variant="pills" activeKey={view} onSelect={(k) => setView(k ?? 'today')}>
              {VIEWS.map((v) => (
                <Nav.Item key={v.key}>
                  <Nav.Link eventKey={v.key} as="button">
                    {v.label}
                    {v.key === 'today' && (counts?.today ?? 0) > 0 && (
                      <span
                        className={`badge rounded-pill ms-2 ${view === 'today' ? 'bg-white text-danger' : 'bg-danger'}`}
                      >
                        {counts?.today}
                      </span>
                    )}
                  </Nav.Link>
                </Nav.Item>
              ))}
            </Nav>
            <Form.Control
              type="search"
              placeholder="Search tasks…"
              aria-label="Search tasks"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 240 }}
              className="ms-auto"
            />
          </div>
          <ErrorAlert error={mine.error} />
          {mine.isPending ? (
            <LoadingRows />
          ) : view === 'today' ? (
            <TodayList items={items} today={mine.data?.today ?? ''} onLog={setLogging} />
          ) : items.length === 0 ? (
            <EmptyState icon="bx-check" title="You're all caught up">
              {q ? 'No tasks match your search.' : 'No tasks here right now.'}
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-stack-md">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Project</th>
                    <th scope="col">My role</th>
                    <th scope="col">Due</th>
                    <th scope="col">Est. / actual</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={`${t.id}-${t.role}`}>
                      <td className="text-heading fw-medium cell-primary">
                        <Link to={`/projects/${t.project.id}?task=${t.id}`}>{t.name}</Link>
                        {t.party === 'CLIENT' && (
                          <span className="badge bg-label-info ms-2">Client</span>
                        )}
                      </td>
                      <td data-label="Project">
                        <Link to={`/projects/${t.project.id}`}>{t.project.name}</Link>
                      </td>
                      <td data-label="My role">{ROLE_LABELS[t.role]}</td>
                      <td
                        data-label="Due"
                        className={`text-nowrap ${t.overdue ? 'text-danger' : ''}`}
                      >
                        {shortDate(t.dueDate)}
                        {t.overdue && <span className="d-block small">{t.daysLate}d late</span>}
                      </td>
                      <td data-label="Est. / actual">
                        <EstAct est={t.estHours} act={t.actualHours} />
                      </td>
                      <td data-label="Status">
                        <TaskStatusBadge status={t.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {logging && (
        <LogTimeModal
          preset={{ projectId: logging.project.id, taskId: logging.id }}
          today={mine.data?.today}
          onClose={() => setLogging(null)}
        />
      )}
    </>
  );
}
