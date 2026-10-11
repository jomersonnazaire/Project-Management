import {
  HOLIDAY_BANNER_NOTE,
  HOLIDAY_TYPE_LABELS,
  ageLabel,
  ageTone,
  formatHHMM,
  formatTime12,
  type MyTaskDto,
  type TrackerDayDto,
} from '@xc8/shared';
import { useEffect, useState } from 'react';
import { Button, Form, Nav } from 'react-bootstrap';
import { Link, useSearchParams } from 'react-router-dom';
import { useTrackerDay, useTrackerMutation } from '../api/trackerHooks';
import { TrackerEntryModal, type TrackerModalMode } from '../components/tracker/TrackerEntryModal';
import { DayTimesheet, LocationChip } from './tracker/DayTimesheet';
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
  // FR-TSK-22 (doc 14 update): Day timesheet sits right after Today.
  { key: 'day', label: 'Day timesheet' },
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
  onShowDue,
  hasTracker,
  tracker,
  fetchedAt,
  onTimeIn,
  onQuick,
}: {
  items: MyTaskDto[];
  today: string;
  onShowDue: () => void;
  /** The user has the tracker: its columns are drawn straight away (DR-32). */
  hasTracker: boolean;
  /** Today's tracker day (doc 14 FR-ACT-01); undefined while it loads. */
  tracker?: TrackerDayDto;
  /** When the tracker day arrived (its running minutes are as of then). */
  fetchedAt: number;
  onTimeIn: (t: MyTaskDto) => void;
  onQuick: () => void;
}) {
  const stop = useTrackerMutation();
  const entries = tracker?.entries ?? [];
  const now = useNow(entries.some((e) => e.running));
  // DR-31: a running entry counts up live from its start, not from when the day was fetched.
  // Server minutes at fetch time plus the time since, so the browser clock doesn't matter.
  const entryMinutes = (e: (typeof entries)[number]) =>
    e.running ? e.minutes + Math.max(0, Math.floor((now - fetchedAt) / 60_000)) : e.minutes;
  const minutesOn = (taskId: string) =>
    entries.filter((e) => e.task?.id === taskId).reduce((s, e) => s + entryMinutes(e), 0);
  const loading = hasTracker && !tracker;
  const runningEntry = (taskId: string) => entries.find((e) => e.running && e.task?.id === taskId);
  const runningOn = (taskId: string) => Boolean(runningEntry(taskId));
  const quick = entries.filter((e) => e.kind === 'QUICK');
  const canTime = Boolean(tracker?.can.edit);
  const planned = items.filter((t) => t.section === 'PLANNED');
  const aging = items.filter((t) => t.section === 'AGING');
  const dueCell = (t: MyTaskDto) => (
    <td data-label="Due" className={`text-nowrap ${t.overdue ? 'text-danger fw-semibold' : ''}`}>
      {t.dueDate === today ? 'Today' : shortDate(t.dueDate)}
      {t.overdue && ' · overdue'}
    </td>
  );
  const todayCell = (t: MyTaskDto) => (
    <td data-label="Today" className="font-monospace text-nowrap">
      {loading ? (
        <span className="skeleton-row d-inline-block my-0" style={{ inlineSize: '3rem' }} />
      ) : runningOn(t.id) ? (
        <span className="text-success fw-semibold">
          {formatHHMM(minutesOn(t.id))}{' '}
          <span className="small text-uppercase font-sans-serif">Running</span>
        </span>
      ) : minutesOn(t.id) ? (
        formatHHMM(minutesOn(t.id))
      ) : (
        '–'
      )}
    </td>
  );
  const rowClass = (t: MyTaskDto) => (runningOn(t.id) ? 'row-running' : undefined);
  // FR-ACT-01/02: Time in / Time out on each row; one timer at a time.
  const logCell = (t: MyTaskDto) => (
    <td className="text-end text-nowrap">
      {runningOn(t.id) ? (
        <>
          <Button
            size="sm"
            variant="danger"
            disabled={stop.isPending}
            onClick={() =>
              stop.mutate({ path: '/stop', body: { entryId: runningEntry(t.id)?.id } })
            }
          >
            ■ Time out
          </Button>
        </>
      ) : loading ? (
        <Button size="sm" variant="success" disabled aria-label={`Time in on ${t.name}`}>
          ▶ Time in
        </Button>
      ) : (
        canTime && (
          <Button
            size="sm"
            variant="success"
            onClick={() => onTimeIn(t)}
            aria-label={`Time in on ${t.name}`}
          >
            ▶ Time in
          </Button>
        )
      )}
    </td>
  );
  return (
    <>
      <div className="d-flex flex-wrap align-items-baseline gap-2">
        <strong className="text-heading">{longDay(today)}</strong>
        {tracker?.location && <LocationChip day={tracker} editable={tracker.can.edit} />}
        <small className="text-body-secondary">Philippine time · by planned date</small>
        {hasTracker && (
          <span className="ms-auto small">
            Hours rendered today:{' '}
            <strong className="font-monospace" data-testid="rendered-today">
              {tracker
                ? formatHHMM(
                    tracker.totalMinutes +
                      entries.reduce((n, e) => n + entryMinutes(e) - e.minutes, 0),
                  )
                : '––:––'}
            </strong>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState icon="bx-sun" title="Nothing planned for today">
          {tracker && 'Use + Quick activity to time non-project work. '}
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
                      {hasTracker && <th scope="col">Today</th>}
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {planned.map((t) => (
                      <tr key={t.id} data-testid={`planned-${t.id}`} className={rowClass(t)}>
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
                        {hasTracker && todayCell(t)}
                        {hasTracker && logCell(t)}
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
                  planned start has passed and not started, or past due
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
                      {hasTracker && <th scope="col">Today</th>}
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
                        <tr key={t.id} data-testid={`aging-${t.id}`} className={rowClass(t)}>
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
                          {hasTracker && todayCell(t)}
                          {hasTracker && logCell(t)}
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
      {tracker && (
        <section aria-labelledby="quick-today">
          <div className="d-flex align-items-center mt-4 mb-2">
            <h3 className="h6 mb-0" id="quick-today">
              Quick activities today · {quick.length}
            </h3>
            {canTime && (
              <Button size="sm" variant="link" className="ms-auto" onClick={onQuick}>
                + Quick activity
              </Button>
            )}
          </div>
          {quick.length > 0 && (
            <div className="table-responsive">
              <table className="table table-stack-md">
                <thead>
                  <tr>
                    <th scope="col">Activity</th>
                    <th scope="col">Activity type</th>
                    <th scope="col">Time in – out</th>
                    <th scope="col">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {quick.map((e) => (
                    <tr key={e.id} className={e.running ? 'row-running' : undefined}>
                      <td className="cell-primary">
                        <span className="fw-medium">{e.title}</span>
                        <div className="small text-body-secondary">No project</div>
                      </td>
                      <td data-label="Activity type">{e.activityType?.name}</td>
                      <td data-label="Time in – out" className="text-nowrap">
                        {e.startAt ? formatTime12(e.startAt) : '–'} –{' '}
                        {e.running ? 'Running' : e.endAt ? formatTime12(e.endAt) : '–'}
                      </td>
                      <td data-label="Duration" className="font-monospace">
                        {formatHHMM(entryMinutes(e))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small text-body-secondary mb-0">
            One timer at a time: starting another task stops the running one at the same moment.
            Times are set by the server in Philippine time. A timer left running stops automatically
            at 11:59 PM PH time.
          </p>
        </section>
      )}
      <p className="small text-body-secondary mt-3 mb-0">
        Open tasks assigned to you (owner or assignee), by planned date in Philippine time. Age
        counts working days since the planned start; the badge turns amber at 3 and red at 7. Tasks
        on On Hold projects are hidden. A task can appear here and on the Due tab.
      </p>
    </>
  );
}

/** Ticks every second while something is running (DR-31), otherwise stays put. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
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
  const { user, permissions } = useAuth();
  const [params] = useSearchParams();
  const [view, setView] = useState<string>(params.get('tab') === 'day' ? 'day' : 'today');
  const hasTracker = Boolean(permissions?.activities?.view);
  const [trackerModal, setTrackerModal] = useState<TrackerModalMode | null>(null);
  const [q, setQ] = useState('');
  const [logging, setLogging] = useState<MyTaskDto | null>(null);
  const mine = useMyTasks(view === 'day' ? 'today' : view, q || undefined);
  const todayKey = mine.data?.today ?? '';
  const trackerDay = useTrackerDay(todayKey, undefined, hasTracker);
  const tracker = hasTracker && todayKey ? trackerDay.data : undefined;
  const timeIn = (t: MyTaskDto) =>
    setTrackerModal({
      kind: 'start',
      date: todayKey,
      task: { id: t.id, name: t.name, projectName: t.project.name },
      last: [...(tracker?.entries ?? [])].reverse().find((e) => e.task?.id === t.id),
    });
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
      value: hoursLabel(week.data?.total ?? 0),
      sub: `of ${hoursLabel(week.data?.capacity ?? user?.weeklyCapacityHours ?? 40)} available`,
    },
  ];

  return (
    <>
      <PageHeader title="My tasks">
        {tracker?.can.edit && (
          <Button
            size="sm"
            aria-label="Quick activity"
            title="Quick activity"
            onClick={() => setTrackerModal({ kind: 'quick', date: todayKey })}
          >
            <i className="bx bx-plus me-1" aria-hidden="true" />
            <span className="btn-collapse-label">Quick activity</span>
          </Button>
        )}
      </PageHeader>
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
              {VIEWS.filter((v) => v.key !== 'day' || hasTracker).map((v) => (
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
                onShowDue={() => setView('due')}
                hasTracker={hasTracker}
                tracker={tracker}
                fetchedAt={trackerDay.dataUpdatedAt}
                onTimeIn={timeIn}
                onQuick={() => setTrackerModal({ kind: 'quick', date: todayKey })}
              />
              {requestsSection}
            </>
          ) : view === 'day' ? (
            <DayTimesheet today={todayKey} initialDate={params.get('date') ?? undefined} />
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
      {trackerModal && (
        <TrackerEntryModal mode={trackerModal} onClose={() => setTrackerModal(null)} />
      )}
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
