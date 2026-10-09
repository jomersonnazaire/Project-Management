import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HEALTH_LABELS, HEALTH_VALUES, type Health, type MyProjectRowDto } from '@xc8/shared';
import { useMyProjects } from '../../api/m4Hooks';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { HealthBadge, ProgressBar, ProjectStatusBadge } from '../../components/ProjectBadges';
import { shortDate } from '../../lib/format';

type Sort = 'late' | 'name' | 'health';
const HEALTH_ORDER: Record<Health, number> = { DELAYED: 0, AT_RISK: 1, ON_HOLD: 2, ON_TRACK: 3 };

export function DaysLate({ days }: { days: number }) {
  if (days > 0)
    return (
      <span className="text-danger fw-medium">
        {days} {days === 1 ? 'day' : 'days'} late
      </span>
    );
  return <span className="text-body-secondary">On time</span>;
}

/**
 * Doc 14 §6 (FR-PMV-01..04): one row per project the PM manages (all projects for Admins and
 * Viewers) with health, days late, blocked tasks, open issues and who needs a follow-up.
 */
export function MyProjectsView() {
  const q = useMyProjects(true);
  const [health, setHealth] = useState('');
  const [client, setClient] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('late');
  const [open, setOpen] = useState<string | null>(null);
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const clients = useMemo(
    () =>
      [...new Map(items.map((p) => [p.client.id, p.client.name])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [items],
  );
  const rows = useMemo(() => {
    const list = items.filter(
      (p) =>
        (!health || p.health === health) &&
        (!client || p.client.id === client) &&
        (!lateOnly || p.daysLate > 0),
    );
    const by: Record<Sort, (a: MyProjectRowDto, b: MyProjectRowDto) => number> = {
      late: (a, b) => b.daysLate - a.daysLate || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      health: (a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || b.daysLate - a.daysLate,
    };
    return [...list].sort(by[sort]);
  }, [items, health, client, lateOnly, sort]);

  return (
    <div className="card mb-6">
      <div className="card-header d-flex flex-wrap gap-3 align-items-center justify-content-between">
        <h2 className="h5 mb-0">My projects</h2>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <select
            className="form-select form-select-sm w-auto"
            aria-label="Filter by health"
            value={health}
            onChange={(e) => setHealth(e.target.value)}
          >
            <option value="">All health</option>
            {HEALTH_VALUES.map((h) => (
              <option key={h} value={h}>
                {HEALTH_LABELS[h]}
              </option>
            ))}
          </select>
          <select
            className="form-select form-select-sm w-auto"
            aria-label="Filter by client"
            value={client}
            onChange={(e) => setClient(e.target.value)}
          >
            <option value="">All clients</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <div className="form-check mb-0">
            <input
              id="mp-late"
              className="form-check-input"
              type="checkbox"
              checked={lateOnly}
              onChange={(e) => setLateOnly(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="mp-late">
              Late only
            </label>
          </div>
          <select
            className="form-select form-select-sm w-auto"
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="late">Most days late</option>
            <option value="health">Health</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>
      <div className="card-body">
        <ErrorAlert error={q.error} />
        {q.isPending ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <EmptyState icon="bx-briefcase" title="No projects to show">
            {items.length ? 'No projects match these filters.' : 'Projects you manage show here.'}
          </EmptyState>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Health</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Go-live</th>
                  <th>Schedule</th>
                  <th className="text-end">Overdue</th>
                  <th className="text-end">Blocked</th>
                  <th className="text-end">Open issues</th>
                  <th className="text-end">Waiting on client</th>
                  <th>Follow up</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const people = p.followUps.people.length;
                  const contacts = p.followUps.contacts.length;
                  const expanded = open === p.id;
                  return (
                    <MyProjectRow
                      key={p.id}
                      p={p}
                      expanded={expanded}
                      onToggle={() => setOpen(expanded ? null : p.id)}
                      people={people}
                      contacts={contacts}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MyProjectRow({
  p,
  expanded,
  onToggle,
  people,
  contacts,
}: {
  p: MyProjectRowDto;
  expanded: boolean;
  onToggle: () => void;
  people: number;
  contacts: number;
}) {
  const total = people + contacts;
  return (
    <>
      <tr>
        <td>
          <Link to={`/projects/${p.id}`} className="fw-medium">
            {p.name}
          </Link>
          <div className="small text-body-secondary">{p.client.name}</div>
        </td>
        <td>
          <HealthBadge health={p.health} />
        </td>
        <td>
          <ProjectStatusBadge status={p.status} />
        </td>
        <td>
          <ProgressBar value={p.progress} label={`${p.name} progress`} />
        </td>
        <td className="small">
          {shortDate(p.baselineEnd, true) || '–'}
          {p.forecastEnd && (
            <div className="text-body-secondary">Forecast {shortDate(p.forecastEnd, true)}</div>
          )}
        </td>
        <td>
          <DaysLate days={p.daysLate} />
        </td>
        <td className={`text-end ${p.overdueTasks ? 'text-danger' : ''}`}>{p.overdueTasks}</td>
        <td className={`text-end ${p.blockedTasks ? 'text-warning' : ''}`}>{p.blockedTasks}</td>
        <td className="text-end">
          <Link to={`/projects/${p.id}/issues`}>{p.openIssues}</Link>
          {p.openCriticalHighIssues > 0 && (
            <div className="small text-danger">{p.openCriticalHighIssues} critical/high</div>
          )}
        </td>
        <td className="text-end">
          {p.waitingOnClient > 0 ? (
            <a
              href="#waiting-on-client"
              aria-label={`${p.waitingOnClient} waiting on client for ${p.name}`}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById('waiting-on-client')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {p.waitingOnClient}
            </a>
          ) : (
            <span className="text-body-secondary">0</span>
          )}
        </td>
        <td>
          {total === 0 ? (
            <span className="text-body-secondary small">No one</span>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              aria-expanded={expanded}
              onClick={onToggle}
            >
              {people > 0 && `${people} ${people === 1 ? 'person' : 'people'}`}
              {people > 0 && contacts > 0 && ', '}
              {contacts > 0 && `${contacts} client ${contacts === 1 ? 'contact' : 'contacts'}`}
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="table-light">
          <td colSpan={11}>
            <div className="row g-4">
              <div className="col-md-6">
                <h3 className="h6">Team members</h3>
                {p.followUps.people.length === 0 && (
                  <p className="small text-body-secondary mb-0">Nobody on the team.</p>
                )}
                {p.followUps.people.map((f) => (
                  <div key={f.person.id} className="mb-2">
                    <div className="fw-medium">
                      {f.person.name}{' '}
                      <span className="small text-body-secondary">
                        {f.overdue} overdue, {f.aging} not started
                      </span>
                    </div>
                    <FollowUpItems items={f.items} />
                  </div>
                ))}
              </div>
              <div className="col-md-6">
                <h3 className="h6">Client contacts</h3>
                {p.followUps.contacts.length === 0 && (
                  <p className="small text-body-secondary mb-0">No client contacts.</p>
                )}
                {p.followUps.contacts.map((f) => (
                  <div key={f.contact.id} className="mb-2">
                    <div className="fw-medium">
                      {f.contact.name}
                      {!f.contact.active && ' (inactive)'}{' '}
                      <span className="small text-body-secondary">
                        {f.overdueTasks} overdue tasks, {f.overdueDocuments} overdue documents
                      </span>
                    </div>
                    <FollowUpItems items={f.items} />
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function FollowUpItems({
  items,
}: {
  items: MyProjectRowDto['followUps']['people'][number]['items'];
}) {
  return (
    <ul className="small mb-0 ps-3">
      {items.map((i) => (
        <li key={`${i.kind}-${i.id}`}>
          <Link to={i.href}>{i.name}</Link>{' '}
          <span className={i.reason === 'OVERDUE' ? 'text-danger' : 'text-warning'}>
            {i.reason === 'OVERDUE' ? 'overdue' : 'not started'}
          </span>
          {i.dueDate && <span className="text-body-secondary"> · due {shortDate(i.dueDate)}</span>}
        </li>
      ))}
    </ul>
  );
}
