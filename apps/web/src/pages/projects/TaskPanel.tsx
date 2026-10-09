import {
  PARTY_LABELS,
  PRIORITY_LABELS,
  TASK_TRANSITIONS,
  type ProjectDto,
  type TaskDto,
} from '@xc8/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Form, Offcanvas } from 'react-bootstrap';
import { useTask, useTaskHistory, useTaskMutation } from '../../api/projectHooks';
import { ErrorAlert, LoadingRows } from '../../components/Feedback';
import { EstAct, TaskStatusBadge } from '../../components/ProjectBadges';
import { ReasonModal } from '../../components/ReasonModal';
import { dateTime, shortDate } from '../../lib/format';
import { TaskFormModal } from './TaskFormModal';
import { moveLabel, useStatusMove } from './useStatusMove';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="col-5 fw-normal text-body-secondary">{label}</dt>
      <dd className="col-7 mb-2">{children}</dd>
    </>
  );
}

/** Task details side panel (FR-TSK-02..09): status, approvals, evidence, follow-ups, history. */
export function TaskPanel({
  taskId,
  project,
  tasks,
  onClose,
}: {
  taskId: string;
  project: ProjectDto;
  tasks: TaskDto[];
  onClose: () => void;
}) {
  const task = useTask(taskId);
  const history = useTaskHistory(taskId);
  const mutation = useTaskMutation();
  const status = useStatusMove(project);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [evidence, setEvidence] = useState({ name: '', url: '' });
  const [note, setNote] = useState('');
  const t = task.data;
  const archived = project.archived;
  const nameOf = (id: string) => {
    const d = tasks.find((x) => x.id === id);
    return d ? `#${d.order} ${d.name}` : 'Removed task';
  };

  const post = (path: string, body: unknown, done?: () => void) =>
    mutation.mutate({ path, body }, { onSuccess: () => done?.() });

  const addEvidence = (e: FormEvent) => {
    e.preventDefault();
    if (!t) return;
    post(`/tasks/${t.id}/evidence`, evidence, () => setEvidence({ name: '', url: '' }));
  };
  const addNote = (e: FormEvent) => {
    e.preventDefault();
    if (!t || !note.trim()) return;
    post(`/tasks/${t.id}/follow-ups`, { note: note.trim() }, () => setNote(''));
  };

  return (
    <Offcanvas
      show
      onHide={onClose}
      placement="end"
      style={{ width: 480 }}
      aria-labelledby="task-panel-title"
    >
      <Offcanvas.Header closeButton>
        <Offcanvas.Title as="h2" className="h5" id="task-panel-title">
          {t ? `#${t.order} ${t.name}` : 'Task'}
        </Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        <ErrorAlert error={task.error} />
        {!t ? (
          <LoadingRows rows={4} />
        ) : (
          <>
            {status.element}
            <ErrorAlert error={mutation.error} action />
            <div className="d-flex flex-wrap align-items-center gap-2 mb-4">
              <TaskStatusBadge status={t.status} />
              {t.overdue && (
                <span className="badge bg-label-danger">
                  Overdue · {t.daysLate} day{t.daysLate === 1 ? '' : 's'} late
                </span>
              )}
              {t.isMilestone && <span className="badge bg-label-primary">Milestone</span>}
              {t.mandatory && <span className="badge bg-label-secondary">Mandatory</span>}
            </div>

            {!archived && (
              <div className="d-flex flex-wrap gap-2 mb-4">
                {t.can.status &&
                  TASK_TRANSITIONS[t.status].map((to) => (
                    <Button
                      key={to}
                      size="sm"
                      variant={
                        to === 'CANCELLED' || to === 'BLOCKED' ? 'outline-secondary' : 'primary'
                      }
                      disabled={status.isPending}
                      onClick={() => status.move(t, to)}
                    >
                      {moveLabel(t, to)}
                    </Button>
                  ))}
                {t.status === 'BLOCKED' && t.can.status && (
                  <Button
                    size="sm"
                    onClick={() => post(`/tasks/${t.id}/unblock`, { version: t.version })}
                  >
                    Unblock
                  </Button>
                )}
                {t.status === 'FOR_REVIEW' && t.can.approve && (
                  <>
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => post(`/tasks/${t.id}/approve`, { version: t.version })}
                    >
                      Approve
                    </Button>
                    <Button size="sm" variant="outline-danger" onClick={() => setRejecting(true)}>
                      Reject
                    </Button>
                  </>
                )}
                {t.can.plan && (
                  <Button size="sm" variant="outline-primary" onClick={() => setEditing(true)}>
                    Edit task
                  </Button>
                )}
                {t.can.plan && (
                  <Button
                    size="sm"
                    variant="outline-danger"
                    onClick={() => {
                      if (window.confirm(`Delete "${t.name}"? This cannot be undone.`)) {
                        mutation.mutate(
                          { path: `/tasks/${t.id}`, method: 'DELETE' },
                          { onSuccess: onClose },
                        );
                      }
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>
            )}

            {t.blockerReason && t.status === 'BLOCKED' && (
              <div className="alert alert-danger py-2">
                <strong>Blocked:</strong> {t.blockerReason}
              </div>
            )}
            {t.approval.state === 'REJECTED' && t.approval.comment && (
              <div className="alert alert-warning py-2">
                <strong>Changes requested:</strong> {t.approval.comment}
              </div>
            )}

            <dl className="row mb-4">
              <Row label="Phase">{t.phase ?? '–'}</Row>
              <Row label="Priority">{PRIORITY_LABELS[t.priority]}</Row>
              <Row label="Party">{PARTY_LABELS[t.party]}</Row>
              <Row label="Owner">{t.owner?.name ?? 'Unassigned'}</Row>
              <Row label="Assignees">{t.assignees.map((a) => a.name).join(', ') || '–'}</Row>
              {t.clientContact && (
                <Row label="Client contact">
                  <span className={t.clientContact.active ? '' : 'text-body-secondary'}>
                    {t.clientContact.name}
                    {!t.clientContact.active && ' (Inactive)'}
                  </span>
                </Row>
              )}
              <Row label="Planned">
                {shortDate(t.plannedStart)} → {shortDate(t.dueDate)}
              </Row>
              <Row label="Est. / actual">
                <EstAct est={t.estHours} act={t.actualHours} />
              </Row>
              <Row label="Depends on">{t.dependsOn.map(nameOf).join(', ') || '–'}</Row>
              <Row label="Deliverable">{t.deliverable ?? '–'}</Row>
              {t.requiresApproval && (
                <Row label="Approval">
                  {t.approval.state === 'NONE' ? 'Needed' : t.approval.state.toLowerCase()}
                  {t.reviewer && ` · reviewer ${t.reviewer.name}`}
                  {t.approval.decidedBy && ` · by ${t.approval.decidedBy.name}`}
                </Row>
              )}
            </dl>

            <h3 className="h6">Evidence</h3>
            {t.evidence.length === 0 ? (
              <p className="small text-body-secondary">
                No evidence yet.{t.requiresApproval && ' Add a link before submitting for review.'}
              </p>
            ) : (
              <ul className="list-unstyled small">
                {t.evidence.map((ev) => (
                  <li key={ev.id} className="d-flex justify-content-between gap-2 mb-1">
                    <a href={ev.url} target="_blank" rel="noopener noreferrer">
                      {ev.name}
                    </a>
                    {t.can.edit && !archived && (
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 text-danger"
                        aria-label={`Remove ${ev.name}`}
                        onClick={() =>
                          mutation.mutate({
                            path: `/tasks/${t.id}/evidence/${ev.id}`,
                            method: 'DELETE',
                          })
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {t.can.edit && !archived && (
              <Form onSubmit={addEvidence} className="d-flex gap-2 mb-4" noValidate>
                <Form.Control
                  size="sm"
                  placeholder="Name"
                  aria-label="Evidence name"
                  value={evidence.name}
                  onChange={(e) => setEvidence({ ...evidence, name: e.target.value })}
                />
                <Form.Control
                  size="sm"
                  placeholder="https://…"
                  aria-label="Evidence link"
                  value={evidence.url}
                  onChange={(e) => setEvidence({ ...evidence, url: e.target.value })}
                />
                <Button size="sm" type="submit" variant="outline-primary">
                  Add
                </Button>
              </Form>
            )}

            <h3 className="h6">Follow-ups</h3>
            {t.followUps.length === 0 ? (
              <p className="small text-body-secondary">No follow-ups yet.</p>
            ) : (
              <ul className="list-unstyled small">
                {t.followUps.map((f) => (
                  <li key={f.id} className="mb-2">
                    <div>{f.note}</div>
                    <span className="text-body-secondary">
                      {f.author?.name ?? 'Unknown'} · {dateTime(f.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {t.can.edit && !archived && (
              <Form onSubmit={addNote} className="d-flex gap-2 mb-4" noValidate>
                <Form.Control
                  size="sm"
                  placeholder="Add a follow-up note"
                  aria-label="Follow-up note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button size="sm" type="submit" variant="outline-primary">
                  Add
                </Button>
              </Form>
            )}

            <h3 className="h6">History</h3>
            <ul className="list-unstyled small mb-0">
              {(history.data ?? []).map((h) => (
                <li key={h.id} className="mb-2">
                  <span className="text-heading">{h.actor?.name ?? 'System'}</span>{' '}
                  {h.action.replace(/^task_/, '').replace(/_/g, ' ')}
                  {h.changes.length > 0 && ` (${h.changes.map((c) => c.field).join(', ')})`}
                  {h.reason && <div className="text-body-secondary">“{h.reason}”</div>}
                  <div className="text-body-secondary">{dateTime(h.at)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Offcanvas.Body>
      {editing && t && (
        <TaskFormModal project={project} task={t} tasks={tasks} onClose={() => setEditing(false)} />
      )}
      {rejecting && t && (
        <ReasonModal
          title="Reject task"
          label="Comment"
          confirmLabel="Reject"
          intro="The task goes back to In Progress with your comment."
          pending={mutation.isPending}
          error={mutation.error}
          onClose={() => setRejecting(false)}
          onSubmit={(comment) =>
            post(`/tasks/${t.id}/reject`, { version: t.version, comment }, () =>
              setRejecting(false),
            )
          }
        />
      )}
    </Offcanvas>
  );
}
