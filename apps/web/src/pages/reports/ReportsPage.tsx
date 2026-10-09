import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  HEALTH_LABELS,
  HEALTH_VALUES,
  ISSUE_SEVERITIES,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STAGES,
  ISSUE_STAGE_LABELS,
  ISSUE_STATUS_LABELS,
  PARTIES,
  PARTY_LABELS,
  TASK_STATUS_LABELS,
  TIME_TYPES,
  TIME_TYPE_LABELS,
  formatOverrun,
  formatSignedHours,
  type EffortRowDto,
  type IssueReportRowDto,
  type IssueStatus,
  type OverdueRowDto,
  type ProjectStatusRowDto,
  type Ref,
  type TimesheetRowDto,
} from '@xc8/shared';
import { useClients } from '../../api/hooks';
import { useReport, type Filters, type ReportKey } from '../../api/m4Hooks';
import { useProjects } from '../../api/projectHooks';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { ProjectBadge } from '../../components/ProjectBadges';
import { hoursLabel, shortDate } from '../../lib/format';
import { exportCsv, type CsvColumn } from '../../lib/reportCsv';
import { DaysLate } from '../dashboard/MyProjectsView';
import { IssueSummary } from '../dashboard/DashboardPage';

interface Column<T> extends CsvColumn<T> {
  render?: (row: T) => ReactNode;
  end?: boolean;
}

const TABS: { key: ReportKey; label: string; need?: 'time' | 'issues' }[] = [
  { key: 'effort-variance', label: 'Effort variance' },
  { key: 'overdue', label: 'Overdue tasks' },
  { key: 'timesheets', label: 'Timesheets', need: 'time' },
  { key: 'project-status', label: 'Project status' },
  { key: 'issues', label: 'Issues', need: 'issues' },
];

const projectLink = (p: Ref) => <Link to={`/projects/${p.id}`}>{p.name}</Link>;
const taskLink = (p: Ref, t: { id: string; name: string }) => (
  <Link to={`/projects/${p.id}?task=${t.id}`}>{t.name}</Link>
);

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      className="form-select form-select-sm w-auto"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{`All ${label.toLowerCase()}`}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="d-flex align-items-center gap-1 small mb-0">
      {label}
      <input
        type="date"
        className="form-control form-control-sm w-auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ReportTable<T extends { id: string }>({
  columns,
  rows,
  file,
  empty,
  pending,
  error,
}: {
  columns: Column<T>[];
  rows: T[];
  file: string;
  empty: string;
  pending: boolean;
  error: unknown;
}) {
  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <span className="small text-body-secondary">
          {pending ? '' : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          disabled={pending || rows.length === 0}
          onClick={() => exportCsv(file, columns, rows)}
        >
          <i className="bx bx-download me-1" aria-hidden="true" />
          Export CSV
        </button>
      </div>
      <ErrorAlert error={error} />
      {pending ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyState icon="bx-bar-chart-alt-2" title="Nothing to report">
          {empty} Try clearing a filter or widening the date range.
        </EmptyState>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.label} className={c.end ? 'text-end' : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {columns.map((c) => (
                    <td key={c.label} className={c.end ? 'text-end' : undefined}>
                      {c.render ? c.render(r) : (c.value(r) ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const owners = (rows: { owner: Ref | null }[]): [string, string][] => [
  ...new Map(rows.filter((r) => r.owner).map((r) => [r.owner!.id, r.owner!.name])).entries(),
];

/** Reports (FR-RPT-01..06, FR-ISS-16): each tab exports exactly the filtered rows (AC-22.2). */
export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const canTime = useCan('time', 'view');
  const canIssues = useCan('issues', 'view');
  const tabs = TABS.filter((t) => !t.need || (t.need === 'time' ? canTime : canIssues));
  const requested = params.get('tab');
  const tab = tabs.find((t) => t.key === requested) ?? tabs[0]!;
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const projects = useProjects();
  const clients = useClients();
  const projectOptions: [string, string][] = (projects.data?.items ?? []).map((p) => [
    p.id,
    p.name,
  ]);
  const clientOptions: [string, string][] = (clients.data?.items ?? []).map((c) => [c.id, c.name]);

  const pick = (...keys: string[]): Filters =>
    Object.fromEntries(keys.map((k) => [k, f[k] || undefined]));

  return (
    <>
      <PageHeader title="Reports" />
      <ul className="nav nav-tabs nav-scrollable mb-0" role="tablist">
        {tabs.map((t) => (
          <li key={t.key} className="nav-item">
            <button
              type="button"
              role="tab"
              aria-selected={t.key === tab.key}
              className={`nav-link ${t.key === tab.key ? 'active' : ''}`}
              onClick={() => setParams({ tab: t.key }, { replace: true })}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="card rounded-top-0">
        <div className="card-body">
          <div className="d-flex flex-wrap gap-2 align-items-center mb-4">
            {tab.key !== 'project-status' && (
              <Select
                label="Projects"
                value={f.projectId ?? ''}
                onChange={set('projectId')}
                options={projectOptions}
              />
            )}
            <Select
              label="Clients"
              value={f.clientId ?? ''}
              onChange={set('clientId')}
              options={clientOptions}
            />
            {tab.key === 'overdue' && (
              <Select
                label="Parties"
                value={f.party ?? ''}
                onChange={set('party')}
                options={PARTIES.map((p) => [p, PARTY_LABELS[p]])}
              />
            )}
            {tab.key === 'project-status' && (
              <Select
                label="Health"
                value={f.health ?? ''}
                onChange={set('health')}
                options={HEALTH_VALUES.map((h) => [h, HEALTH_LABELS[h]])}
              />
            )}
            {tab.key === 'issues' && (
              <>
                <Select
                  label="Severities"
                  value={f.severity ?? ''}
                  onChange={set('severity')}
                  options={ISSUE_SEVERITIES.map((s) => [s, ISSUE_SEVERITY_LABELS[s]])}
                />
                <Select
                  label="Stages"
                  value={f.stage ?? ''}
                  onChange={set('stage')}
                  options={ISSUE_STAGES.map((s) => [s, ISSUE_STAGE_LABELS[s]])}
                />
              </>
            )}
            {(tab.key === 'overdue' || tab.key === 'timesheets' || tab.key === 'issues') && (
              <>
                <DateInput
                  label={tab.key === 'overdue' ? 'Due from' : 'From'}
                  value={f.from ?? ''}
                  onChange={set('from')}
                />
                <DateInput label="to" value={f.to ?? ''} onChange={set('to')} />
              </>
            )}
            {Object.values(f).some(Boolean) && (
              <button type="button" className="btn btn-sm btn-link" onClick={() => setF({})}>
                Clear filters
              </button>
            )}
          </div>
          {tab.key === 'effort-variance' && (
            <EffortTab
              filters={pick('projectId', 'clientId')}
              owner={f.ownerId ?? ''}
              setOwner={set('ownerId')}
            />
          )}
          {tab.key === 'overdue' && (
            <OverdueTab
              filters={pick('projectId', 'clientId', 'party', 'from', 'to')}
              owner={f.ownerId ?? ''}
              setOwner={set('ownerId')}
            />
          )}
          {tab.key === 'timesheets' && (
            <TimesheetsTab filters={pick('projectId', 'clientId', 'from', 'to')} />
          )}
          {tab.key === 'project-status' && (
            <ProjectStatusTab filters={pick('clientId', 'health')} />
          )}
          {tab.key === 'issues' && (
            <IssuesTab filters={pick('projectId', 'clientId', 'severity', 'stage', 'from', 'to')} />
          )}
        </div>
      </div>
    </>
  );
}

function OwnerSelect({
  rows,
  value,
  onChange,
}: {
  rows: { owner: Ref | null }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-3">
      <Select label="Owners" value={value} onChange={onChange} options={owners(rows)} />
    </div>
  );
}

function EffortTab({
  filters,
  owner,
  setOwner,
}: {
  filters: Filters;
  owner: string;
  setOwner: (v: string) => void;
}) {
  const q = useReport('effort-variance', filters);
  const all = q.data?.items ?? [];
  const rows = owner ? all.filter((r) => r.owner?.id === owner) : all;
  const columns: Column<EffortRowDto>[] = [
    { label: 'Task', value: (r) => r.name, render: (r) => taskLink(r.project, r) },
    { label: 'Project', value: (r) => r.project.name, render: (r) => projectLink(r.project) },
    { label: 'Client', value: (r) => r.client.name },
    { label: 'Owner', value: (r) => r.owner?.name ?? '' },
    { label: 'Status', value: (r) => TASK_STATUS_LABELS[r.status] },
    {
      label: 'Estimate',
      value: (r) => (r.estHours === null ? '' : hoursLabel(r.estHours)),
      end: true,
      render: (r) => (r.estHours === null ? 'No estimate' : hoursLabel(r.estHours)),
    },
    {
      label: 'Actual',
      value: (r) => hoursLabel(r.actualHours),
      end: true,
      render: (r) => hoursLabel(r.actualHours),
    },
    {
      label: 'Variance',
      value: (r) => formatSignedHours(r.variance),
      end: true,
      render: (r) => (
        <span className={(r.variance ?? 0) > 0 ? 'text-danger' : ''}>
          {formatSignedHours(r.variance)}
        </span>
      ),
    },
    { label: 'Overrun', value: (r) => formatOverrun(r.overrunPct), end: true },
  ];
  return (
    <>
      <OwnerSelect rows={all} value={owner} onChange={setOwner} />
      <ReportTable
        columns={columns}
        rows={rows}
        file={`effort-variance-${today()}.csv`}
        empty="No tasks with an estimate or logged time match these filters."
        pending={q.isPending}
        error={q.error}
      />
    </>
  );
}

function OverdueTab({
  filters,
  owner,
  setOwner,
}: {
  filters: Filters;
  owner: string;
  setOwner: (v: string) => void;
}) {
  const q = useReport('overdue', filters);
  const all = q.data?.items ?? [];
  const rows = owner ? all.filter((r) => r.owner?.id === owner) : all;
  const columns: Column<OverdueRowDto>[] = [
    { label: 'Task', value: (r) => r.name, render: (r) => taskLink(r.project, r) },
    { label: 'Project', value: (r) => r.project.name, render: (r) => projectLink(r.project) },
    { label: 'Client', value: (r) => r.client.name },
    { label: 'Party', value: (r) => PARTY_LABELS[r.party] },
    {
      label: 'Owner / contact',
      value: (r) => (r.party === 'CLIENT' ? r.contact?.name : r.owner?.name) ?? '',
    },
    { label: 'Status', value: (r) => TASK_STATUS_LABELS[r.status] },
    { label: 'Due', value: (r) => r.dueDate, render: (r) => shortDate(r.dueDate, true) },
    {
      label: 'Days overdue',
      value: (r) => r.daysOverdue,
      end: true,
      render: (r) => <span className="text-danger">{r.daysOverdue}</span>,
    },
  ];
  return (
    <>
      <OwnerSelect rows={all} value={owner} onChange={setOwner} />
      <ReportTable
        columns={columns}
        rows={rows}
        file={`overdue-tasks-${today()}.csv`}
        empty="No overdue tasks match these filters."
        pending={q.isPending}
        error={q.error}
      />
    </>
  );
}

function TimesheetsTab({ filters }: { filters: Filters }) {
  const q = useReport('timesheets', filters);
  const [person, setPerson] = useState('');
  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  const rows = person ? all.filter((r) => r.user.id === person) : all;
  const totals = useMemo(() => {
    const t = Object.fromEntries(TIME_TYPES.map((k) => [k, 0])) as Record<string, number>;
    for (const r of rows) t[r.type] = (t[r.type] ?? 0) + r.hours;
    return t;
  }, [rows]);
  const people: [string, string][] = [
    ...new Map(all.map((r) => [r.user.id, r.user.name])).entries(),
  ];
  const columns: Column<TimesheetRowDto>[] = [
    { label: 'Date', value: (r) => r.workDate, render: (r) => shortDate(r.workDate, true) },
    { label: 'Person', value: (r) => r.user.name },
    { label: 'Project', value: (r) => r.project.name, render: (r) => projectLink(r.project) },
    { label: 'Task', value: (r) => r.task.name, render: (r) => taskLink(r.project, r.task) },
    { label: 'Type', value: (r) => TIME_TYPE_LABELS[r.type] },
    {
      label: 'Hours',
      value: (r) => hoursLabel(r.hours),
      end: true,
      render: (r) => hoursLabel(r.hours),
    },
    { label: 'Note', value: (r) => r.note ?? '' },
  ];
  return (
    <>
      <div className="d-flex flex-wrap gap-3 align-items-center mb-3">
        <Select label="People" value={person} onChange={setPerson} options={people} />
        <span className="small">
          {TIME_TYPES.map((k) => `${TIME_TYPE_LABELS[k]} ${hoursLabel(totals[k]!)}`).join(' · ')}
        </span>
      </div>
      <ReportTable
        columns={columns}
        rows={rows}
        file={`timesheets-${today()}.csv`}
        empty="No time entries match these filters."
        pending={q.isPending}
        error={q.error}
      />
    </>
  );
}

function ProjectStatusTab({ filters }: { filters: Filters }) {
  const q = useReport('project-status', filters);
  const columns: Column<ProjectStatusRowDto>[] = [
    { label: 'Project', value: (r) => r.name, render: (r) => projectLink(r) },
    { label: 'Client', value: (r) => r.client.name },
    {
      label: 'Health',
      value: (r) => HEALTH_LABELS[r.health],
      render: (r) => <ProjectBadge status={r.status} health={r.health} />,
    },
    { label: 'Progress', value: (r) => `${r.progress}%`, end: true },
    {
      label: 'Baseline end',
      value: (r) => r.baselineEnd ?? '',
      render: (r) => shortDate(r.baselineEnd, true) || '–',
    },
    {
      label: 'Forecast end',
      value: (r) => r.forecastEnd ?? '',
      render: (r) => shortDate(r.forecastEnd, true) || '–',
    },
    {
      label: 'Variance (days)',
      value: (r) => r.varianceDays,
      render: (r) => <DaysLate days={r.varianceDays} />,
    },
    { label: 'Overdue', value: (r) => r.overdueTasks, end: true },
    { label: 'Blocked', value: (r) => r.blockedTasks, end: true },
    { label: 'Pending client items', value: (r) => r.pendingClientItems, end: true },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={q.data?.items ?? []}
      file={`project-status-${today()}.csv`}
      empty="No projects match these filters."
      pending={q.isPending}
      error={q.error}
    />
  );
}

function IssuesTab({ filters }: { filters: Filters }) {
  const q = useReport('issues', filters);
  const columns: Column<IssueReportRowDto>[] = [
    {
      label: 'ID',
      value: (r) => r.key,
      render: (r) => <Link to={`/issues/${r.id}`}>{r.key}</Link>,
    },
    { label: 'Title', value: (r) => r.title },
    { label: 'Project', value: (r) => r.project.name, render: (r) => projectLink(r.project) },
    { label: 'Client', value: (r) => r.client.name },
    { label: 'Severity', value: (r) => ISSUE_SEVERITY_LABELS[r.severity] },
    { label: 'Stage', value: (r) => ISSUE_STAGE_LABELS[r.stage] },
    { label: 'Status', value: (r) => ISSUE_STATUS_LABELS[r.status as IssueStatus] ?? r.status },
    { label: 'Owner', value: (r) => r.owner?.name ?? '' },
    {
      label: 'Due',
      value: (r) => r.dueDate ?? '',
      render: (r) => (
        <span className={r.overdue ? 'text-danger' : ''}>{shortDate(r.dueDate, true) || '–'}</span>
      ),
    },
    { label: 'Days to resolve', value: (r) => r.daysToResolve ?? '', end: true },
  ];
  return (
    <>
      {q.data && (
        <div className="border rounded p-3 mb-4">
          <IssueSummary s={q.data.summary} />
        </div>
      )}
      <ReportTable
        columns={columns}
        rows={q.data?.items ?? []}
        file={`issues-${today()}.csv`}
        empty="No issues match these filters."
        pending={q.isPending}
        error={q.error}
      />
    </>
  );
}
