import { useState } from 'react';
import { Form, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useMyTasks } from '../api/projectHooks';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorAlert, LoadingRows } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';
import { EstAct, TaskStatusBadge } from '../components/ProjectBadges';
import { shortDate } from '../lib/format';

const VIEWS = [
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

/** My tasks: the sign-in landing page until the dashboard arrives (FR-TSK-13, AC-17.1). */
export function MyTasksPage() {
  const { user } = useAuth();
  const [view, setView] = useState<string>('assigned');
  const [q, setQ] = useState('');
  const mine = useMyTasks(view, q || undefined);
  const counts = mine.data?.counts;
  const items = mine.data?.items ?? [];
  const kpis = [
    { label: 'Overdue', value: String(counts?.overdue ?? 0) },
    { label: 'Due this week', value: String(counts?.dueThisWeek ?? 0) },
    { label: 'Waiting for my review', value: String(counts?.toReview ?? 0) },
    {
      // Time logging arrives in Milestone 3.
      label: 'Logged this week',
      value: '0h',
      sub: `of ${user?.weeklyCapacityHours ?? 40}h available`,
    },
  ];

  return (
    <>
      <PageHeader title="My tasks" />
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
            <Nav variant="pills" activeKey={view} onSelect={(k) => setView(k ?? 'assigned')}>
              {VIEWS.map((v) => (
                <Nav.Item key={v.key}>
                  <Nav.Link eventKey={v.key} as="button">
                    {v.label}
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
    </>
  );
}
