import {
  ISSUE_COMPLETED_BANNER,
  TEMPLATE_TYPE_LABELS,
  hasPermission,
  plural,
  type AccessAction,
  type RecordType,
} from '@xc8/shared';
import { useState } from 'react';
import { Alert, Button, Modal } from 'react-bootstrap';
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useProjectIssues } from '../../api/issueHooks';
import { useProject, useProjectAction, useProjectTasks } from '../../api/projectHooks';
import { useAuth } from '../../auth/AuthContext';
import { ErrorAlert, LoadingRows, LockNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { ProgressBar, ProjectBadge, ScheduleVariance } from '../../components/ProjectBadges';
import { shortDate } from '../../lib/format';
import { NotFoundPage } from '../ErrorPages';
import { ProjectEditModal } from './ProjectEditModal';
import {
  ActivityTab,
  BoardTab,
  ChecklistTab,
  ComingSoonTab,
  ContactsTab,
  TeamTab,
} from './ProjectTabs';
import { ConversationTab } from './ConversationTab';
import { DocumentsTab } from './DocumentsTab';
import { ProjectTimeTab } from './ProjectTimeTab';
import { TaskFormModal } from './TaskFormModal';
import { TaskPanel } from './TaskPanel';
import { ProjectIssuesTab } from '../issues/ProjectIssuesTab';
import { RaiseIssueModal } from '../issues/IssueUi';

/** Project detail with its plan, board, team and contacts (FR-PRJ-06..13, FR-TSK-*). */
export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const project = useProject(id);
  const tasks = useProjectTasks(id);
  const action = useProjectAction(id);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const warnings = (location.state as { warnings?: string[] } | null)?.warnings ?? [];
  const openTask = params.get('task');
  const { permissions } = useAuth();
  const can = (r: RecordType, a: AccessAction) => hasPermission(permissions, r, a);
  const issues = useProjectIssues(id, {}, can('issues', 'view'));
  const [raising, setRaising] = useState(false);
  const [openIssues, setOpenIssues] = useState<string[] | null>(null);
  const archive = () =>
    action.mutate('archive', {
      onError: (e) => {
        // FR-ISS-13: open issues → list them and ask again.
        if (e instanceof ApiError && e.code === 'OPEN_ISSUES') {
          setOpenIssues((e.details as { issues?: string[] } | undefined)?.issues ?? []);
        }
      },
    });
  const archiveError =
    action.error instanceof ApiError && action.error.code === 'OPEN_ISSUES' ? null : action.error;

  if (project.error instanceof ApiError && project.error.status === 404) return <NotFoundPage />;
  const p = project.data;
  if (!p) {
    return (
      <>
        <PageHeader title="Project" />
        <ErrorAlert error={project.error} />
        <LoadingRows rows={5} />
      </>
    );
  }

  const list = tasks.data ?? [];
  const setTask = (taskId: string | null) => {
    const next = new URLSearchParams(params);
    if (taskId) next.set('task', taskId);
    else next.delete('task');
    setParams(next);
  };
  const tabs = [
    { to: '', label: 'Checklist', end: true },
    { to: 'board', label: 'Board' },
    { to: 'team', label: 'Team' },
    { to: 'contacts', label: 'Active contacts' },
    ...(can('conversations', 'view') ? [{ to: 'conversation', label: 'Conversation' }] : []),
    ...(can('issues', 'view')
      ? [{ to: 'issues', label: 'Issues', count: issues.data?.counts.open }]
      : []),
    { to: 'timeline', label: 'Timeline' },
    ...(can('documents', 'view') ? [{ to: 'documents', label: 'Documents' }] : []),
    ...(can('time', 'view') ? [{ to: 'time', label: 'Time' }] : []),
    // Admins and PMs on any project they can view, or View on audit (doc 11 §12).
    ...(p.can.activity ? [{ to: 'activity', label: 'Activity log' }] : []),
  ];

  return (
    <>
      <PageHeader
        title={p.name}
        badge={<ProjectBadge status={p.status} health={p.health} archived={p.archived} />}
      >
        {issues.data?.can.create && !p.archived && (
          // DR-22: one filled primary button per header (Edit project); Raise issue is outline.
          <Button variant="outline-primary" onClick={() => setRaising(true)}>
            + Raise issue
          </Button>
        )}
        {p.can.planTasks && !p.archived && p.status !== 'COMPLETED' && (
          <Button variant="outline-primary" onClick={() => setAdding(true)}>
            + Add task
          </Button>
        )}
        {p.can.edit && !p.archived && (
          <Button onClick={() => setEditing(true)}>Edit project</Button>
        )}
      </PageHeader>
      <Link to="/projects" className="d-inline-block mb-4">
        ‹ All projects
      </Link>
      {warnings.map((w) => (
        <Alert key={w} variant="warning">
          {w}
        </Alert>
      ))}
      <ErrorAlert error={archiveError} action />
      {p.status === 'COMPLETED' && !p.archived && can('issues', 'view') && (
        <Alert variant="info">{ISSUE_COMPLETED_BANNER}</Alert>
      )}
      {p.archived && (
        <LockNotice>
          This project is archived and read-only.
          {p.can.archive && (
            <Button
              variant="link"
              size="sm"
              className="ms-2 p-0"
              onClick={() => action.mutate('unarchive')}
            >
              Unarchive
            </Button>
          )}
        </LockNotice>
      )}

      <div className="card mb-6">
        <div className="card-body">
          <div className="row g-4">
            <div className="col-sm-6 col-lg-3">
              <div className="small text-body-secondary">Client</div>
              <Link to={`/clients/${p.clientId}/projects`}>{p.clientName}</Link>
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="small text-body-secondary">Project manager</div>
              {p.manager?.name ?? '–'}
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="small text-body-secondary">Baseline</div>
              {shortDate(p.startDate, true)} → {shortDate(p.plannedEndDate, true)}
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="small text-body-secondary">Forecast end</div>
              {shortDate(p.forecastEnd, true)} <ScheduleVariance days={p.scheduleVarianceDays} />
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="small text-body-secondary">Progress</div>
              <ProgressBar value={p.progress} label="Project progress" />
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="small text-body-secondary">Template</div>
              {p.templateName ? `${p.templateName} · v${p.templateVersion}` : '–'}
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="small text-body-secondary">Type</div>
              {p.type ? TEMPLATE_TYPE_LABELS[p.type] : '–'}
            </div>
            <div className="col-sm-6 col-lg-3">
              <div className="small text-body-secondary">Tasks</div>
              {plural(p.taskCount, 'task')} · {p.unestimatedTaskCount} without an estimate
            </div>
          </div>
          {p.description && <p className="mt-4 mb-0">{p.description}</p>}
          {(p.can.archive || p.can.delete) && (
            <div className="d-flex gap-2 mt-4">
              {p.can.archive && !p.archived && (
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Archive this project? It becomes read-only and hidden from lists.',
                      )
                    ) {
                      archive();
                    }
                  }}
                >
                  Archive
                </Button>
              )}
              {p.can.delete && (
                <Button
                  size="sm"
                  variant="outline-danger"
                  onClick={() => {
                    if (
                      window.confirm(`Delete "${p.name}" and all its tasks? This cannot be undone.`)
                    ) {
                      action.mutate('delete', { onSuccess: () => navigate('/projects') });
                    }
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <ul className="nav nav-tabs mb-4" role="tablist">
        {tabs.map((t) => (
          <li className="nav-item" key={t.to}>
            <NavLink
              to={t.to ? `/projects/${p.id}/${t.to}` : `/projects/${p.id}`}
              end={t.end}
              className="nav-link"
            >
              {t.label}
              {'count' in t && t.count ? (
                <span className="badge bg-label-danger ms-2" aria-label={`${t.count} open`}>
                  {t.count}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
      <ErrorAlert error={tasks.error} />
      {tasks.isPending ? (
        <LoadingRows rows={4} />
      ) : (
        <Routes>
          <Route index element={<ChecklistTab project={p} tasks={list} onOpen={setTask} />} />
          <Route path="board" element={<BoardTab project={p} tasks={list} onOpen={setTask} />} />
          <Route path="team" element={<TeamTab project={p} tasks={list} />} />
          <Route path="contacts" element={<ContactsTab project={p} />} />
          <Route path="timeline" element={<ComingSoonTab title="The timeline" />} />
          <Route
            path="conversation"
            element={<ConversationTab project={p} tasks={list} onOpenTask={setTask} />}
          />
          <Route path="issues" element={<ProjectIssuesTab project={p} />} />
          <Route path="documents" element={<DocumentsTab project={p} tasks={list} />} />
          <Route path="time" element={<ProjectTimeTab project={p} />} />
          {p.can.activity && <Route path="activity" element={<ActivityTab project={p} />} />}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      )}

      {openTask && (
        <TaskPanel taskId={openTask} project={p} tasks={list} onClose={() => setTask(null)} />
      )}
      {raising && <RaiseIssueModal projectId={p.id} onClose={() => setRaising(false)} />}
      {openIssues && (
        <Modal
          show
          centered
          onHide={() => setOpenIssues(null)}
          aria-labelledby="archive-open-title"
        >
          <Modal.Header closeButton>
            <Modal.Title as="h2" className="h5" id="archive-open-title">
              Archive {p.name}?
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {openIssues.length} issue{openIssues.length === 1 ? ' is' : 's are'} still open:{' '}
            {openIssues.join(', ')}. After archiving, nobody can update them.
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setOpenIssues(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={action.isPending}
              onClick={() =>
                action.mutate(
                  { action: 'archive', confirmOpenIssues: true },
                  { onSuccess: () => setOpenIssues(null) },
                )
              }
            >
              Archive anyway
            </Button>
          </Modal.Footer>
        </Modal>
      )}
      {editing && <ProjectEditModal project={p} onClose={() => setEditing(false)} />}
      {adding && (
        <TaskFormModal project={p} task={null} tasks={list} onClose={() => setAdding(false)} />
      )}
    </>
  );
}
