import { Link } from 'react-router-dom';
import {
  AI_INSIGHTS_PHASE2_NOTE,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STAGE_LABELS,
  type IssueSeverity,
  type IssueStage,
  type IssueSummaryDto,
} from '@xc8/shared';
import { useDocumentRequests } from '../../api/m3Hooks';
import { useDashboard } from '../../api/m4Hooks';
import { useCan } from '../../auth/useCan';
import { DocumentRequestList } from '../../components/DocumentRequestList';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { ProgressBar, ProjectBadge } from '../../components/ProjectBadges';
import { hoursLabel, shortDate } from '../../lib/format';
import { MyProjectsView } from './MyProjectsView';

function Kpi({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string | number;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="col-sm-6 col-xl-3">
      <div className="card h-100">
        <div className="card-body">
          <p className="mb-1">{label}</p>
          <h3 className={`mb-0 ${danger ? 'text-danger' : ''}`}>{value}</h3>
          {sub && <small className="text-body-secondary">{sub}</small>}
        </div>
      </div>
    </div>
  );
}

function daysLabel(d: number | null) {
  if (d === null) return 'No due date';
  if (d > 0) return `${d} ${d === 1 ? 'day' : 'days'} overdue`;
  if (d === 0) return 'Due today';
  return `Due in ${-d} ${d === -1 ? 'day' : 'days'}`;
}

/** FR-ISS-16: open issues by severity and stage, overdue, average time to resolve, per client. */
export function IssueSummary({ s }: { s: IssueSummaryDto }) {
  return (
    <div className="row g-4">
      <div className="col-md-4">
        <div className="d-flex gap-4 mb-3">
          <div>
            <div className="small text-body-secondary">Open</div>
            <div className="h4 mb-0">{s.open}</div>
          </div>
          <div>
            <div className="small text-body-secondary">Overdue</div>
            <div className={`h4 mb-0 ${s.overdue ? 'text-danger' : ''}`}>{s.overdue}</div>
          </div>
          <div>
            <div className="small text-body-secondary">Avg. days to resolve</div>
            <div className="h4 mb-0">{s.avgDaysToResolve ?? '–'}</div>
          </div>
        </div>
        <div className="small text-body-secondary">{s.resolvedCount} resolved</div>
      </div>
      <div className="col-md-4">
        <div className="small fw-medium mb-1">Open by severity</div>
        <ul className="list-unstyled small mb-2">
          {(Object.keys(s.bySeverity) as IssueSeverity[]).map((k) => (
            <li key={k} className="d-flex justify-content-between">
              <span>{ISSUE_SEVERITY_LABELS[k]}</span>
              <span>{s.bySeverity[k]}</span>
            </li>
          ))}
        </ul>
        <div className="small fw-medium mb-1">Open by stage</div>
        <ul className="list-unstyled small mb-0">
          {(Object.keys(s.byStage) as IssueStage[]).map((k) => (
            <li key={k} className="d-flex justify-content-between">
              <span>{ISSUE_STAGE_LABELS[k]}</span>
              <span>{s.byStage[k]}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="col-md-4">
        <div className="small fw-medium mb-1">Per client</div>
        {s.perClient.length === 0 ? (
          <p className="small text-body-secondary mb-0">No open issues.</p>
        ) : (
          <ul className="list-unstyled small mb-0">
            {s.perClient.map((c) => (
              <li key={c.client.id} className="d-flex justify-content-between">
                <span>{c.client.name}</span>
                <span>
                  {c.open} open{c.overdue ? `, ${c.overdue} overdue` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Dashboard (FR-DASH-01..06, mockup v0.7.4) with the My projects view for PMs, Admins and Viewers
 * (doc 14 §6). Every number respects the caller's project scope.
 */
export function DashboardPage() {
  const q = useDashboard();
  const docs = useDocumentRequests('waiting-on-client');
  const canIssues = useCan('issues', 'view');
  const canTime = useCan('time', 'view');
  const d = q.data;
  const docItems = docs.data?.items ?? [];

  return (
    <>
      <PageHeader title="Dashboard" />
      <ErrorAlert error={q.error} />
      {q.isPending ? (
        <LoadingRows rows={4} />
      ) : d ? (
        <>
          <div className="row g-6 mb-6">
            <Kpi label="Active projects" value={d.kpis.activeProjects} />
            <Kpi
              label="Delayed projects"
              value={d.kpis.delayedProjects}
              danger={d.kpis.delayedProjects > 0}
            />
            <Kpi
              label="Overdue tasks"
              value={d.kpis.overdueTasks}
              danger={d.kpis.overdueTasks > 0}
              sub={`${d.kpis.overdueWaitingOnClient} waiting on client`}
            />
            {canTime && (
              <Kpi
                label="Hours this week"
                value={hoursLabel(d.kpis.hoursThisWeek)}
                sub={
                  d.kpis.teamUtilizationPct === null
                    ? 'No capacity set'
                    : `${d.kpis.teamUtilizationPct}% team utilization`
                }
              />
            )}
          </div>

          {d.myProjects && <MyProjectsView />}

          <div className="row g-6 mb-6">
            <div className="col-xl-8">
              <div className="card h-100">
                <div className="card-body">
                  <h2 className="h5 mb-4">Active projects</h2>
                  {d.activeProjects.length === 0 ? (
                    <EmptyState icon="bx-briefcase" title="No active projects" />
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm align-middle">
                        <thead>
                          <tr>
                            <th>Project</th>
                            <th>Template</th>
                            <th>Progress</th>
                            <th>Health</th>
                            <th>Go-live</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.activeProjects.map((p) => (
                            <tr key={p.id}>
                              <td>
                                <Link to={`/projects/${p.id}`} className="fw-medium">
                                  {p.name}
                                </Link>
                                <div className="small text-body-secondary">{p.client.name}</div>
                              </td>
                              <td className="small">{p.template ?? '–'}</td>
                              <td>
                                <ProgressBar value={p.progress} label={`${p.name} progress`} />
                              </td>
                              <td>
                                <ProjectBadge status={p.status} health={p.health} />
                              </td>
                              <td className="small">{shortDate(p.goLive, true) || '–'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="col-xl-4">
              <div className="card h-100">
                <div className="card-body">
                  <h2 className="h5 mb-4">Upcoming milestones</h2>
                  {d.upcomingMilestones.length === 0 ? (
                    <p className="text-body-secondary small mb-0">
                      No milestones due in the next 30 days.
                    </p>
                  ) : (
                    <ul className="list-unstyled mb-0">
                      {d.upcomingMilestones.map((m) => (
                        <li key={m.id} className="mb-3">
                          <Link to={`/projects/${m.project.id}?task=${m.id}`} className="fw-medium">
                            {m.name}
                          </Link>
                          <div className="small text-body-secondary">
                            {m.project.name} · {shortDate(m.dueDate, true)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="row g-6 mb-6">
            <div className="col-xl-8">
              <div className="card h-100">
                <div className="card-body">
                  <h2 className="h5 mb-4" id="waiting-on-client" tabIndex={-1}>
                    Waiting on client
                  </h2>
                  {d.waitingOnClient.length === 0 && docItems.length === 0 && !docs.isPending ? (
                    <EmptyState icon="bx-check-circle" title="Nothing waiting on clients">
                      Client tasks and documents requested from client contacts show here.
                    </EmptyState>
                  ) : (
                    <>
                      {d.waitingOnClient.length > 0 && (
                        <ul className="list-unstyled mb-4">
                          {d.waitingOnClient.map((t) => (
                            <li key={t.id} className="d-flex justify-content-between gap-3 mb-2">
                              <div>
                                <Link to={`/projects/${t.project.id}?task=${t.id}`}>{t.name}</Link>
                                <div className="small text-body-secondary">
                                  {t.project.name}
                                  {t.contact && ` · ${t.contact.name}`}
                                </div>
                              </div>
                              <span
                                className={`small text-nowrap ${(t.daysOverdue ?? 0) > 0 ? 'text-danger' : 'text-body-secondary'}`}
                              >
                                {daysLabel(t.daysOverdue)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <ErrorAlert error={docs.error} />
                      {docItems.length > 0 && (
                        <>
                          <h3 className="h6">Requested documents</h3>
                          <DocumentRequestList items={docItems} showContact />
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="col-xl-4">
              <div className="card h-100">
                <div className="card-body">
                  <h2 className="h5 mb-2">
                    AI insights <span className="badge bg-label-secondary ms-1">Phase 2</span>
                  </h2>
                  <p className="small text-body-secondary mb-0">{AI_INSIGHTS_PHASE2_NOTE}</p>
                </div>
              </div>
            </div>
          </div>

          {canIssues && (
            <div className="card mb-6">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-center mb-4">
                  <h2 className="h5 mb-0">Issues</h2>
                  <Link to="/reports?tab=issues" className="small">
                    Issue report
                  </Link>
                </div>
                <IssueSummary s={d.issues} />
              </div>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
