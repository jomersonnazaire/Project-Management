import { Link } from 'react-router-dom';
import { useProjects } from '../../api/projectHooks';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { ProgressBar, ProjectBadge } from '../../components/ProjectBadges';

/** Task board entry point: each project has its own board, so pick one. */
export function BoardPickerPage() {
  const projects = useProjects();
  const items = projects.data?.items ?? [];
  return (
    <>
      <PageHeader title="Task board" />
      <ErrorAlert error={projects.error} />
      {projects.isPending ? (
        <LoadingRows />
      ) : items.length === 0 ? (
        <EmptyState icon="bx-columns" title="No projects yet">
          Boards appear here once you're on a project.
        </EmptyState>
      ) : (
        <div className="row g-4">
          {items.map((p) => (
            <div className="col-md-6 col-xl-4" key={p.id}>
              <div className="card h-100">
                <div className="card-body">
                  <div className="d-flex justify-content-between gap-2 mb-2">
                    <Link to={`/projects/${p.id}/board`} className="fw-medium">
                      {p.name}
                    </Link>
                    <ProjectBadge status={p.status} health={p.health} archived={p.archived} />
                  </div>
                  <div className="small text-body-secondary mb-2">{p.clientName}</div>
                  <ProgressBar value={p.progress} label={`${p.name} progress`} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
