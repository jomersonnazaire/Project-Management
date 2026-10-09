import { useMemo, useState } from 'react';
import { Button } from 'react-bootstrap';
import { useAllIssues, type IssueFilters } from '../../api/issueHooks';
import { PageHeader } from '../../components/PageHeader';
import { downloadCsv, issuesCsv } from '../../lib/issuesCsv';
import { IssueFilterBar, IssuesTable } from './IssueUi';

/** All issues across the projects the user can see (FR-ISS-08, mockup v7-allissues). */
export function AllIssuesPage() {
  const [filters, setFilters] = useState<IssueFilters>({});
  const list = useAllIssues(filters);
  // Picker options come from the whole (unfiltered by project/client/owner) open list.
  const everything = useAllIssues({ status: 'ALL' });
  const items = list.data?.items ?? [];
  const pickers = useMemo(() => {
    const all = everything.data?.items ?? [];
    const uniq = (xs: ({ id: string; name: string } | null)[]) =>
      [...new Map(xs.filter(Boolean).map((x) => [x!.id, x!])).values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    return {
      projects: uniq(all.map((i) => i.project)),
      clients: uniq(all.map((i) => i.client)),
      owners: uniq(all.map((i) => (i.owner ? { id: i.owner.id, name: i.owner.name } : null))),
    };
  }, [everything.data]);

  return (
    <>
      <PageHeader title="All issues" />
      <div className="card">
        <div className="card-body">
          <IssueFilterBar
            filters={filters}
            onChange={setFilters}
            owners={pickers.owners}
            projects={pickers.projects}
            clients={pickers.clients}
          />
          <Button
            variant="outline-secondary"
            size="sm"
            className="mb-4"
            disabled={!items.length}
            onClick={() => downloadCsv('issues.csv', issuesCsv(items))}
          >
            Export CSV
          </Button>
          <IssuesTable
            items={items}
            loading={list.isPending}
            error={list.error}
            showProject
            emptyText="Issues on your projects show here."
            note="Sorted by severity, then due date. Members see only issues on projects they're on. Viewers can read but not raise."
          />
        </div>
      </div>
    </>
  );
}
