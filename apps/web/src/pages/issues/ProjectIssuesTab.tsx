import { ISSUE_AUTO_CLOSE_DAYS, type ProjectDto } from '@xc8/shared';
import { useState } from 'react';
import { useIssueOptions, useProjectIssues, type IssueFilters } from '../../api/issueHooks';
import { IssueFilterBar, IssuesTable } from './IssueUi';

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="col-sm-6 col-lg-3">
      <div className="card h-100">
        <div className="card-body">
          <div className="text-body-secondary">{label}</div>
          <div className={`fs-3 fw-semibold ${tone ?? 'text-heading'}`}>{value}</div>
        </div>
      </div>
    </div>
  );
}

/** Project › Issues (FR-ISS-07, mockup v7-issues): KPI cards, filters and the issue list. */
export function ProjectIssuesTab({ project }: { project: ProjectDto }) {
  const [filters, setFilters] = useState<IssueFilters>({});
  const list = useProjectIssues(project.id, filters);
  const options = useIssueOptions(project.id);
  const c = list.data?.counts;
  return (
    <>
      <div className="row g-4 mb-4">
        <Kpi label="Open" value={c?.open ?? '–'} />
        <Kpi
          label="Critical / High open"
          value={c ? `${c.critical} / ${c.high}` : '–'}
          tone={c && c.critical + c.high > 0 ? 'text-danger' : undefined}
        />
        <Kpi
          label="Overdue"
          value={c?.overdue ?? '–'}
          tone={c?.overdue ? 'text-danger' : undefined}
        />
        <Kpi
          label="Waiting on client"
          value={c?.waiting ?? '–'}
          tone={c?.waiting ? 'text-warning' : undefined}
        />
      </div>
      <div className="card">
        <div className="card-body">
          <IssueFilterBar
            filters={filters}
            onChange={setFilters}
            owners={options.data?.users ?? []}
          />
          <IssuesTable
            items={list.data?.items ?? []}
            loading={list.isPending}
            error={list.error}
            emptyText={
              list.data?.can.create
                ? 'Raise an issue when something blocks or breaks; it gets an owner and a due date.'
                : 'Issues raised on this project show here.'
            }
            note={`Critical rows carry a red edge. Overdue dates turn red. Resolved issues close automatically after ${ISSUE_AUTO_CLOSE_DAYS} days unless reopened. The ID is never reused.`}
          />
        </div>
      </div>
    </>
  );
}
