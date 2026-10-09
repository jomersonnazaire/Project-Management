import {
  HOLIDAY_BANNER_NOTE,
  HOLIDAY_TYPE_LABELS,
  ageLabel,
  ageTone,
  type MyTaskDto,
} from '@xc8/shared';
import { useState } from 'react';
import { Button, Form, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useDocumentRequests, useTimeWeek } from '../api/m3Hooks';
import { DocumentRequestList } from '../components/DocumentRequestList';
import { useMyTasks } from '../api/projectHooks';
import { useAuth } from '../auth/AuthContext';
import { useCan } from '../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../components/Feedback';
import { LogTimeModal } from '../components/LogTimeModal';
import { PageHeader } from '../components/PageHeader';
import { EstAct, TaskStatusBadge } from '../components/ProjectBadges';
import { hoursLabel, longDay, shortDate } from '../lib/format';

const VIEWS = [
  { key: 'today', label: 'Today' },
  { key: 'due', label: 'Due' },
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

const AGE_BADGE = { none: 'bg-label-secondary', amber: 'bg-label-warning', red: 'bg-label-danger' };

function TaskCell({ t }: { t: MyTaskDto }) {
  return (
    <td className="cell-primary">
      <Link className="fw-medium" to={`/projects/${t.project.id}?task=${t.id}`}>
        {t.name}
      </Link>
      <div className="small text-body-secondary">
        {t.project.name}
        {t.phase && ` · ${t.phase}`}
      </div>
    </td>
  );
}

/**
 * The Today tab (FR-TSK-23..25, mockup v0.7.6): Planned for today, then Aging (planned start has
 * passed and the task is still Not started or past due), oldest first, with a working-day age.
 */
function TodayPlan({
  items,
  today,
  onLog,
  onShowDue,
}: {
  items: MyTaskDto[];
  today: string;
  onLog: (t: MyTaskDto) => void;
  onShowDue: () => void;
}) {
  const planned = items.filter((t) => t.section === 'PLANNED');
  const aging = items.filter((t) => t.section === 'AGING');
  const dueCell = (t: MyTaskDto) => (
    <td data-label="Due" className={`text-nowrap ${t.overdue ? 'text-danger fw-semibold' : ''}`}>
      {t.dueDate === today ? 'Today' : shortDate(t.dueDate)}
      {t.overdue && ' · overdue'}
    </td>
  );
  const logCell = (t: MyTaskDto) => (
    <td className="text-end">
      <Button size="sm" variant="outline-primary" onClick={() => onLog(t)}>
        Log time
      </Button>
    </td>
  );
  return (
    <>
      <div className="d-flex align-items-baseline gap-2">
        <strong className="text-heading">{longDay(today)}</strong>
        <small className="text-body-secondary">Philippine time · by planned date</small>
      </div>
      {items.length === 0 ? (
        <EmptyState icon="bx-sun" title="Nothing planned for today">
          No aging tasks either.{' '}
          <Button variant="link" className="p-0 align-baseline" onClick={onShowDue}>
            Check what’s due
          </Button>
        </EmptyState>
      ) : (
        <>
          {planned.length > 0 && (
            <section aria-labelledby="planned-today">
              <h3 className="h6 mt-4 mb-2" id="planned-today">
                Planned for today · {planned.length}
              </h3>
              <div className="table-responsive">
                <table className="table table-stack-md">
                  <thead>
                    <tr>
                      <th scope="col">Task</th>
                      <th scope="col">Planned</th>
                      <th scope="col">Due</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {planned.map((t) => (
                      <tr key={t.id} data-testid={`planned-${t.id}`}>
                        <TaskCell t={t} />
                        <td data-label="Planned" className="text-nowrap">
                          {t.plannedStart === today
                            ? shortDate(t.plannedStart)
                            : `${shortDate(t.plannedStart)} → ${shortDate(t.dueDate)}`}
                        </td>
                        {dueCell(t)}
                        <td data-label="Status">
                          <TaskStatusBadge status={t.status} />
                        </td>
                        {logCell(t)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {aging.length > 0 && (
            <section aria-labelledby="aging-today">
              <h3 className="h6 mt-4 mb-2 text-warning" id="aging-today">
                Aging · {aging.length}{' '}
                <small className="text-body-secondary fw-normal">
                  planned date has passed, not done yet
                </small>
              </h3>
              <div className="table-responsive">
                <table className="table table-stack-md">
                  <thead>
                    <tr>
                      <th scope="col">Task</th>
                      <th scope="col">Planned</th>
                      <th scope="col">Due</th>
                      <th scope="col">Age</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {aging.map((t) => {
                      const age = t.ageDays ?? 0;
                      const tone = ageTone(age);
                      return (
                        <tr key={t.id} data-testid={`aging-${t.id}`}>
                          <TaskCell t={t} />
                          <td data-label="Planned" className="text-nowrap">
                            {shortDate(t.plannedStart)}
                          </td>
                          {dueCell(t)}
                          <td data-label="Age">
                            <span
                              className={`badge text-uppercase ${AGE_BADGE[tone]}`}
                              data-tone={tone}
                            >
                              {ageLabel(age)}
                            </span>
                          </td>
                          <td data-label="Status">
                            <TaskStatusBadge status={t.status} />
                          </td>
                          {logCell(t)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
      <p className="small text-body-secondary mt-3 mb-0">
        Open tasks assigned to you (owner or assignee), by planned date in Philippine time. Age
        counts working days since the planned start; the badge turns amber at 3 and red at 7. Tasks
        on On Hold projects are hidden. A task can appear here and on the Due tab.
      </p>
    </>
  );
}

const daysOverdue = (n: number) => `${n} day${n === 1 ? '' : 's'} overdue`;

/** The Due tab (FR-TSK-20/21/22, formerly Today): overdue first in red, then due today. */
function DueList({
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

/** My tasks: the sign-in landing page (FR-TSK-13, FR-TSK-20..25, AC-17.1, AC-TODAY-1..5). */
export function MyTasksPage() {
  const { user } = useAuth();
  const [view, setView] = useState<string>('today');
  const [q, setQ] = useState('');
  const [logging, setLogging] = useState<MyTaskDto | null>(null);
  const mine = useMyTasks(view, q || undefined);
  // FR-DOC-26: documents requested from me (overdue ones in red), shown with the Today tab.
  const requests = useDocumentRequests('mine', useCan('documents', 'view'));
  const week = useTimeWeek();
  const counts = mine.data?.counts;
  const items = mine.data?.items ?? [];
  const holiday = mine.data?.holiday;
  // FR-DOC-26: documents requested from me (overdue ones in red), on the Today and Due tabs.
  const requestsSection = (requests.data?.items.length ?? 0) > 0 && (
    <section className="mt-5" aria-labelledby="requested-from-you">
      <h3 className="h6 mb-3" id="requested-from-you">
        Documents requested from you
        {(requests.data?.overdue ?? 0) > 0 && (
          <span className="badge bg-label-danger ms-2">{requests.data?.overdue} overdue</span>
        )}
      </h3>
      <DocumentRequestList items={requests.data!.items} showContact={false} />
    </section>
  );
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
                        className={`badge rounded-pill ms-2 ${view === 'today' ? 'bg-white text-secondary' : 'bg-secondary'}`}
                      >
                        {counts?.today}
                      </span>
                    )}
                    {v.key === 'due' && (counts?.due ?? 0) > 0 && (
                      <span
                        className={`badge rounded-pill ms-2 ${view === 'due' ? 'bg-white text-danger' : 'bg-danger'}`}
                      >
                        {counts?.due}
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
            <>
              <TodayPlan
                items={items}
                today={mine.data?.today ?? ''}
                onLog={setLogging}
                onShowDue={() => setView('due')}
              />
              {requestsSection}
            </>
          ) : view === 'due' ? (
            <>
              <DueList items={items} today={mine.data?.today ?? ''} onLog={setLogging} />
              {requestsSection}
            </>
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
