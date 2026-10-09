import { PROJECT_FILTER_LABELS, PROJECT_FILTERS, PROJECT_TYPE_NOT_SET } from '@xc8/shared';
import { useState } from 'react';
import { Form, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useProjects } from '../../api/projectHooks';
import { useProjectTypes } from '../../api/projectTypeHooks';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { ProgressBar, ProjectBadge, ScheduleVariance } from '../../components/ProjectBadges';
import { shortDate } from '../../lib/format';

/**
 * Projects list (FR-PRJ-01). Members only ever see projects they're on; the API enforces this,
 * including the counts on the filter tabs.
 */
export function ProjectsPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [typeId, setTypeId] = useState('');
  const canCreate = useCan('projects', 'create');
  const types = useProjectTypes(true, true);
  const projects = useProjects({
    status: status || undefined,
    q: q || undefined,
    projectTypeId: typeId || undefined,
  });
  const counts = projects.data?.counts ?? {};
  const items = projects.data?.items ?? [];

  return (
    <>
      <PageHeader title="Projects">
        {canCreate && (
          <Link className="btn btn-primary" to="/projects/new">
            + New project
          </Link>
        )}
      </PageHeader>
      <div className="card">
        <div className="card-body">
          <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
            <Nav
              variant="pills"
              activeKey={status}
              onSelect={(k) => setStatus(k ?? '')}
              className="flex-wrap"
              aria-label="Project status filter"
            >
              {(['', ...PROJECT_FILTERS] as const).map((f) => (
                <Nav.Item key={f}>
                  <Nav.Link eventKey={f} as="button">
                    {f ? PROJECT_FILTER_LABELS[f] : 'All'}
                    {counts[f || 'ALL'] !== undefined && (
                      <span className="badge bg-label-secondary ms-1">{counts[f || 'ALL']}</span>
                    )}
                  </Nav.Link>
                </Nav.Item>
              ))}
            </Nav>
            {/* Doc 14 FR-PTY-07: filter by project type. */}
            <Form.Select
              aria-label="Project type filter"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              style={{ maxWidth: 200 }}
              className="ms-auto"
            >
              <option value="">All project types</option>
              {(types.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.active ? '' : ' (inactive)'}
                </option>
              ))}
              <option value="none">{PROJECT_TYPE_NOT_SET}</option>
            </Form.Select>
            <Form.Control
              type="search"
              placeholder="Search projects…"
              aria-label="Search projects"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 240 }}
            />
          </div>
          <ErrorAlert error={projects.error} />
          {projects.isPending ? (
            <LoadingRows />
          ) : items.length === 0 ? (
            q || status || typeId ? (
              <EmptyState icon="bx-briefcase" title="No projects match">
                Try clearing the search or choosing All.
              </EmptyState>
            ) : (
              <EmptyState
                icon="bx-briefcase"
                title="No projects yet"
                action={
                  canCreate ? (
                    <Link className="btn btn-primary" to="/projects/new">
                      + New project
                    </Link>
                  ) : undefined
                }
              >
                {canCreate
                  ? 'Create a project from a published template.'
                  : "Projects you're on will show here."}
              </EmptyState>
            )
          ) : (
            <div className="table-responsive">
              <table className="table table-stack-md">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Client</th>
                    <th scope="col">Project type</th>
                    <th scope="col">Project manager</th>
                    <th scope="col">Start</th>
                    <th scope="col">Planned end</th>
                    <th scope="col">Forecast</th>
                    <th scope="col">Progress</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td className="text-heading fw-medium cell-primary">
                        <Link to={`/projects/${p.id}`}>{p.name}</Link>
                        {p.templateName && (
                          <div className="small text-body-secondary fw-normal">
                            {p.templateName} v{p.templateVersion}
                          </div>
                        )}
                      </td>
                      <td data-label="Client">
                        <Link to={`/clients/${p.clientId}/projects`}>{p.clientName}</Link>
                      </td>
                      <td data-label="Project type">
                        {p.projectType ? (
                          <>
                            {p.projectType.name}
                            {!p.projectType.active && (
                              <span className="badge badge-inactive ms-1">Inactive</span>
                            )}
                          </>
                        ) : (
                          <span className="text-body-secondary">{PROJECT_TYPE_NOT_SET}</span>
                        )}
                      </td>
                      <td data-label="Project manager">{p.managerName ?? '–'}</td>
                      <td data-label="Start" className="text-nowrap">
                        {shortDate(p.startDate)}
                      </td>
                      <td data-label="Planned end" className="text-nowrap">
                        {shortDate(p.plannedEndDate)}
                      </td>
                      <td data-label="Forecast" className="text-nowrap">
                        {shortDate(p.forecastEnd)}
                        <div>
                          <ScheduleVariance days={p.scheduleVarianceDays} />
                        </div>
                      </td>
                      <td data-label="Progress">
                        <ProgressBar value={p.progress} label={`${p.name} progress`} />
                      </td>
                      <td data-label="Status">
                        <ProjectBadge status={p.status} health={p.health} archived={p.archived} />
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
