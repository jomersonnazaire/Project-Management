import {
  BOARD_COLUMNS,
  TASK_STATUS_LABELS,
  TASK_TRANSITIONS,
  effortSummary,
  formatHours,
  moveWithinGroup,
  plural,
  type PhaseDto,
  type ProjectDto,
  type TaskDto,
  type TaskStatus,
} from '@xc8/shared';
import { useState, type DragEvent } from 'react';
import { useEdgeFade } from '../../lib/useEdgeFade';
import { Button, Dropdown, Form } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import {
  useContactOptions,
  useProjectActivity,
  useProjectContact,
  useReorderTasks,
} from '../../api/projectHooks';
import { DragHandle } from '../../components/ReorderControls';
import { dragHandleProps, dropTargetProps } from '../../lib/dragRow';
import { useAuth } from '../../auth/AuthContext';
import { TaskFormModal } from './TaskFormModal';
import { useDeletePhase, useProjectPhases } from '../../api/issueHooks';
import { ApiError } from '../../api/client';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { EstAct, TaskStatusBadge } from '../../components/ProjectBadges';
import { dateTime, initials, shortDate } from '../../lib/format';
import { moveLabel, useStatusMove } from './useStatusMove';
import { useConfirm } from '../../components/ConfirmModal';

interface TabProps {
  project: ProjectDto;
  tasks: TaskDto[];
  onOpen: (id: string) => void;
}

function DueCell({ t }: { t: TaskDto }) {
  return (
    <span className={t.overdue ? 'text-danger' : undefined}>
      {shortDate(t.dueDate)}
      {t.overdue && <span className="d-block small">{t.daysLate}d late</span>}
    </span>
  );
}

/** Checklist: tasks grouped by phase (FR-TSK-11), with collapsible phases and reordering (doc 12). */
const OTHER = 'Other tasks';
const phaseOf = (t: TaskDto) => t.phase || OTHER;

/** Which phases this user has closed on this project, remembered per user per project (FR-PRJ-14). */
function useCollapsedPhases(userId: string | undefined, projectId: string) {
  const key = `xc8.checklist.collapsed.${userId ?? 'anon'}.${projectId}`;
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const toggle = (phase: string) => {
    const next = collapsed.includes(phase)
      ? collapsed.filter((p) => p !== phase)
      : [...collapsed, phase];
    setCollapsed(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage full or blocked: the phase still opens and closes for this visit.
    }
  };
  return { isOpen: (phase: string) => !collapsed.includes(phase), toggle };
}

export function ChecklistTab({ project, tasks, onOpen }: TabProps) {
  const { user } = useAuth();
  const phases = Array.from(new Set(tasks.map(phaseOf)));
  const summary = effortSummary(tasks);
  const reorder = useReorderTasks(project.id);
  const { isOpen, toggle } = useCollapsedPhases(user?.id, project.id);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<TaskDto | null>(null);
  // FR-PRJ-20: a visible pencil per row for users who can edit that task. Planners get the task
  // form; Members who may only update their own tasks get the task panel. The column shows when
  // anyone's row has it, so rows line up across phases.
  const showEdit = !project.archived && tasks.some((t) => t.can.edit);
  const editTask = (t: TaskDto) => (t.can.plan ? setEditingTask(t) : onOpen(t.id));
  const [announce, setAnnounce] = useState('');
  // Planners reorder within a phase with the grip handle (drag, or Alt+↑/↓). Display order only:
  // dependencies, dates, owners and status never change (FR-PRJ-16).
  const canPlan = project.can.planTasks && !project.archived;
  // M3.5: planners delete a phase once it has no tasks (and its folder holds no documents).
  const phaseInfo = useProjectPhases(project.id, canPlan);
  const infoOf = (ph: string) => phaseInfo.data?.find((x) => x.name === ph);
  const emptyPhases = (phaseInfo.data ?? []).filter(
    (x) => x.taskCount === 0 && !phases.includes(x.name),
  );
  const move = (ph: string, from: number, to: number) => {
    const group = tasks.filter((t) => phaseOf(t) === ph);
    const ids = group.map((t) => t.id);
    const next = moveWithinGroup(ids, () => true, from, to);
    if (next.join() === ids.join()) return;
    setAnnounce(`Moved ${group[from]!.name} to position ${to + 1} of ${ids.length} in ${ph}.`);
    reorder.mutate({ phase: ph === OTHER ? null : ph, taskIds: next });
  };

  const emptySection = emptyPhases.length > 0 && (
    <>
      {emptyPhases.map((ph) => (
        <div key={ph.name} className="card mb-4" data-testid={`empty-phase-${ph.name}`}>
          <div className="card-header py-3 d-flex align-items-center gap-2">
            <h3 className="h6 mb-0">{ph.name}</h3>
            <span className="small text-body-secondary">No activities</span>
          </div>
          <div className="card-footer py-3 d-flex flex-wrap align-items-center gap-2">
            <Button variant="outline-secondary" size="sm" onClick={() => setAddingTo(ph.name)}>
              + Add activity
            </Button>
            <PhaseDelete projectId={project.id} phase={ph} />
          </div>
        </div>
      ))}
    </>
  );

  if (tasks.length === 0) {
    if (emptySection) {
      return (
        <>
          {emptySection}
          {addingTo !== null && (
            <TaskFormModal
              project={project}
              task={null}
              tasks={tasks}
              fixedPhase={addingTo}
              onClose={() => setAddingTo(null)}
            />
          )}
        </>
      );
    }
    return (
      <EmptyState icon="bx-list-check" title="No tasks yet">
        {project.can.planTasks
          ? 'Add the first task with + Add task.'
          : 'Tasks will show here once the plan is ready.'}
      </EmptyState>
    );
  }
  return (
    <>
      <p className="small text-body-secondary">
        Estimated {formatHours(summary.estimatedHours)} across{' '}
        {plural(tasks.length - summary.unestimatedCount, 'task')} ·{' '}
        <span data-testid="unestimated-count">{summary.unestimatedCount}</span> without an estimate
      </p>
      <ErrorAlert error={reorder.error} action />
      <div className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </div>
      {phases.map((ph, phaseIndex) => {
        const group = tasks.filter((t) => phaseOf(t) === ph);
        const done = group.filter((t) => t.status === 'COMPLETED').length;
        const open = isOpen(ph);
        const bodyId = `phase-body-${phaseIndex}`;
        const scope = `checklist-${phaseIndex}`;
        const addLabel =
          ph === OTHER ? '+ Add activity' : `+ Add activity to Phase ${phaseIndex + 1}`;
        return (
          <div key={ph} className="card mb-4">
            <div
              className="card-header py-3 d-flex align-items-center gap-2 phase-toggle"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => toggle(ph)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(ph);
                }
              }}
            >
              <span className="phase-caret text-primary" aria-hidden="true">
                ▸
              </span>
              <h3 className="h6 mb-0">{ph}</h3>
              <span className="small text-body-secondary">
                {plural(group.length, 'activity', 'activities')} · {done} done
              </span>
              <div
                className="progress phase-progress ms-auto"
                aria-hidden="true"
                title={`${done} of ${group.length} done`}
              >
                <div
                  className="progress-bar"
                  style={{ width: `${group.length ? (done / group.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div id={bodyId} hidden={!open}>
              <div className="table-responsive">
                <table className="table table-stack-md mb-0">
                  <thead>
                    <tr>
                      {canPlan && (
                        <th scope="col">
                          <span className="visually-hidden">Reorder</span>
                        </th>
                      )}
                      <th scope="col">#</th>
                      <th scope="col">Task</th>
                      <th scope="col">Owner</th>
                      <th scope="col">Due</th>
                      <th scope="col">Est. / actual</th>
                      <th scope="col">Status</th>
                      {showEdit && (
                        <th scope="col" style={{ width: '2.5rem' }}>
                          <span className="visually-hidden">Edit</span>
                        </th>
                      )}
                      {canPlan && (
                        <th scope="col">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((t, i) => (
                      <tr
                        key={t.id}
                        {...dropTargetProps(canPlan, scope, (from) => move(ph, Number(from), i))}
                      >
                        {canPlan && (
                          <td className="text-nowrap" style={{ width: '2rem' }}>
                            <DragHandle
                              name={t.name}
                              index={i}
                              count={group.length}
                              disabled={reorder.isPending}
                              onMove={(to) => move(ph, i, to)}
                              dragProps={dragHandleProps(canPlan, scope, String(i))}
                            />
                          </td>
                        )}
                        <td data-label="#">{t.order}</td>
                        <td className="cell-primary">
                          <Button
                            variant="link"
                            className="p-0 text-start fw-medium"
                            onClick={() => onOpen(t.id)}
                          >
                            {t.name}
                          </Button>
                          {t.party === 'CLIENT' && (
                            <span className="badge bg-label-info ms-2">Client</span>
                          )}
                        </td>
                        <td data-label="Owner">{t.owner?.name ?? '–'}</td>
                        <td data-label="Due" className="text-nowrap">
                          <DueCell t={t} />
                        </td>
                        <td data-label="Est. / actual">
                          <EstAct est={t.estHours} act={t.actualHours} />
                        </td>
                        <td data-label="Status">
                          <TaskStatusBadge status={t.status} />
                        </td>
                        {showEdit && (
                          <td className="text-end cell-edit" style={{ width: '2.5rem' }}>
                            {t.can.edit && (
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 text-body"
                                aria-label="Edit task"
                                title="Edit task"
                                onClick={() => editTask(t)}
                              >
                                <i className="bx bx-pencil fs-5" aria-hidden="true" />
                              </Button>
                            )}
                          </td>
                        )}
                        {canPlan && (
                          <td className="text-end cell-actions">
                            {/* Touch and non-drag alternative to the grip handle (FR-PRJ-18). Same reorder call;
                                moving to another phase stays in Edit task. */}
                            <Dropdown align="end">
                              <Dropdown.Toggle
                                variant="link"
                                size="sm"
                                className="hide-arrow p-0 text-body"
                                aria-label={`Actions for ${t.name}`}
                              >
                                <i
                                  className="bx bx-dots-vertical-rounded fs-5"
                                  aria-hidden="true"
                                />
                              </Dropdown.Toggle>
                              <Dropdown.Menu>
                                <Dropdown.Item
                                  as="button"
                                  disabled={i === 0 || reorder.isPending}
                                  onClick={() => move(ph, i, i - 1)}
                                >
                                  Move up
                                </Dropdown.Item>
                                <Dropdown.Item
                                  as="button"
                                  disabled={i === group.length - 1 || reorder.isPending}
                                  onClick={() => move(ph, i, i + 1)}
                                >
                                  Move down
                                </Dropdown.Item>
                              </Dropdown.Menu>
                            </Dropdown>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canPlan && (
                <div className="card-footer py-3">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    title={ph === OTHER ? undefined : `Add an activity to ${ph}`}
                    onClick={() => setAddingTo(ph)}
                  >
                    {addLabel}
                  </Button>
                  {ph !== OTHER && infoOf(ph) && (
                    <PhaseDelete projectId={project.id} phase={infoOf(ph)!} />
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {emptySection}
      {editingTask && (
        <TaskFormModal
          project={project}
          task={editingTask}
          tasks={tasks}
          onClose={() => setEditingTask(null)}
        />
      )}
      {addingTo !== null && (
        <TaskFormModal
          project={project}
          task={null}
          tasks={tasks}
          fixedPhase={addingTo === OTHER ? null : addingTo}
          onClose={() => setAddingTo(null)}
        />
      )}
    </>
  );
}

/** Delete phase: shown when allowed (with a confirm); otherwise disabled with the reason. */
function PhaseDelete({ projectId, phase }: { projectId: string; phase: PhaseDto }) {
  const [confirm, confirmDialog] = useConfirm();
  const del = useDeletePhase(projectId);
  if (!phase.deletable && !phase.deleteBlockedReason) return null;
  return (
    <>
      {confirmDialog}
      <span className="d-inline-flex flex-wrap align-items-center gap-2 ms-auto">
        <Button
          variant="outline-danger"
          size="sm"
          disabled={!phase.deletable || del.isPending}
          aria-describedby={
            phase.deletable ? undefined : `phase-blocked-${phase.name.replace(/\W+/g, '-')}`
          }
          onClick={async () => {
            if (
              await confirm({
                title: `Delete the phase "${phase.name}"?`,
                body: 'This cannot be undone.',
                confirmLabel: 'Delete phase',
                danger: true,
              })
            ) {
              del.mutate(phase.name);
            }
          }}
        >
          Delete phase
        </Button>
        {!phase.deletable && (
          <small
            className="text-body-secondary"
            id={`phase-blocked-${phase.name.replace(/\W+/g, '-')}`}
          >
            {phase.deleteBlockedReason}
          </small>
        )}
        {del.error instanceof ApiError && (
          <small className="text-danger" role="alert">
            ⚠ {del.error.message}
          </small>
        )}
      </span>
    </>
  );
}

/**
 * Kanban board by status (FR-TSK-10). Cards can be dragged, and every card also has a "Move to…"
 * menu so the board works with a keyboard (NFR-15).
 */
export function BoardTab({ project, tasks, onOpen }: TabProps) {
  const [assignee, setAssignee] = useState('');
  const status = useStatusMove(project);
  const { ref: boardRef, fade, update: updateFade } = useEdgeFade<HTMLDivElement>();
  const team = [project.manager, ...project.members].filter(
    (u, i, all): u is NonNullable<typeof u> =>
      Boolean(u) && all.findIndex((x) => x?.id === u!.id) === i,
  );
  const shown = assignee
    ? tasks.filter((t) => t.owner?.id === assignee || t.assignees.some((a) => a.id === assignee))
    : tasks;
  const drop = (e: DragEvent, to: TaskStatus) => {
    e.preventDefault();
    const t = tasks.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (t && t.status !== to && TASK_TRANSITIONS[t.status].includes(to) && t.can.status)
      status.move(t, to);
  };

  return (
    <>
      {status.element}
      <div className="d-flex align-items-center gap-3 mb-4">
        <Form.Select
          aria-label="Filter by assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          style={{ maxWidth: 240 }}
        >
          <option value="">Everyone</option>
          {team.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Form.Select>
        <span className="small text-body-secondary">Drag a card, or use its Move to… menu.</span>
      </div>
      <div className={`board-wrap${fade ? ' is-overflowing' : ''}`} data-testid="board-wrap">
        <div
          className="board"
          ref={boardRef}
          onScroll={updateFade}
          tabIndex={0}
          aria-label="Task board"
        >
          {BOARD_COLUMNS.map((col) => {
            const items = shown.filter((t) => t.status === col);
            return (
              <section
                key={col}
                className="board-column"
                aria-label={`${TASK_STATUS_LABELS[col]} (${items.length})`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, col)}
              >
                <h3 className="h6 d-flex justify-content-between">
                  {TASK_STATUS_LABELS[col]}
                  <span className="badge bg-label-secondary">{items.length}</span>
                </h3>
                {items.map((t) => (
                  <div
                    key={t.id}
                    className="card mb-3"
                    draggable={t.can.status && !project.archived}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                  >
                    <div className="card-body p-3">
                      <Button
                        variant="link"
                        className="p-0 text-start fw-medium text-heading"
                        onClick={() => onOpen(t.id)}
                      >
                        #{t.order} {t.name}
                      </Button>
                      {t.phase && <div className="small text-body-secondary">{t.phase}</div>}
                      <div className="d-flex justify-content-between align-items-center mt-2 small">
                        <DueCell t={t} />
                        <EstAct est={t.estHours} act={t.actualHours} />
                        {t.owner && (
                          <span
                            className="avatar-initials"
                            title={t.owner.name}
                            aria-label={`Owner ${t.owner.name}`}
                          >
                            {initials(t.owner.name)}
                          </span>
                        )}
                      </div>
                      {t.can.status &&
                        !project.archived &&
                        TASK_TRANSITIONS[t.status].length > 0 && (
                          <Form.Select
                            size="sm"
                            className="mt-2"
                            aria-label={`Move ${t.name} to`}
                            value=""
                            onChange={(e) =>
                              e.target.value && status.move(t, e.target.value as TaskStatus)
                            }
                          >
                            <option value="">Move to…</option>
                            {TASK_TRANSITIONS[t.status].map((to) => (
                              <option key={to} value={to}>
                                {moveLabel(t, to)}
                              </option>
                            ))}
                          </Form.Select>
                        )}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function TeamTab({ project, tasks }: Omit<TabProps, 'onOpen'>) {
  const people = [
    ...(project.manager ? [{ ...project.manager, role: 'Project manager' }] : []),
    ...project.members
      .filter((m) => m.id !== project.manager?.id)
      .map((m) => ({ ...m, role: 'Member' })),
  ];
  return (
    <div className="card">
      <div className="table-responsive">
        <table className="table mb-0">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role on project</th>
              <th scope="col">Open tasks</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className={p.active ? undefined : 'text-body-secondary'}>
                <td className="text-heading">
                  {p.name}
                  {!p.active && <span className="badge bg-label-secondary ms-2">Inactive</span>}
                </td>
                <td>{p.role}</td>
                <td>
                  {
                    tasks.filter(
                      (t) =>
                        !['COMPLETED', 'CANCELLED'].includes(t.status) &&
                        (t.owner?.id === p.id || t.assignees.some((a) => a.id === p.id)),
                    ).length
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {project.can.edit && !project.archived && (
        <p className="small text-body-secondary m-4 mt-3">Change the team with Edit project.</p>
      )}
    </div>
  );
}

/**
 * Active contacts (FR-PRJ-13): picked from this project's client only; inactive contacts stay
 * listed, greyed out.
 */
export function ContactsTab({ project }: { project: ProjectDto }) {
  const editable = project.can.edit && !project.archived;
  const options = useContactOptions(project.id, editable);
  const mutation = useProjectContact(project.id);
  const canCreateContact = useCan('contacts', 'create');
  const [pick, setPick] = useState('');
  const available = (options.data ?? []).filter((o) => !o.added);
  const clientContactsLink = `/clients/${project.clientId}/contacts`;

  return (
    <div className="card">
      <div className="card-body">
        <ErrorAlert error={mutation.error} action />
        {editable && available.length > 0 && (
          <div className="d-flex gap-2 mb-4" style={{ maxWidth: 480 }}>
            <Form.Select
              aria-label="Add a contact"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Add a contact from {project.clientName}…</option>
              {available.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.position ? ` · ${o.position}` : ''}
                </option>
              ))}
            </Form.Select>
            <Button
              disabled={!pick || mutation.isPending}
              onClick={() => mutation.mutate({ contactId: pick }, { onSuccess: () => setPick('') })}
            >
              Add
            </Button>
          </div>
        )}
        {project.activeContacts.length === 0 ? (
          <EmptyState
            icon="bx-phone"
            title="No active contacts"
            action={
              canCreateContact ? (
                <Link className="btn btn-outline-primary" to={clientContactsLink}>
                  Go to {project.clientName}’s contacts
                </Link>
              ) : undefined
            }
          >
            {editable && available.length > 0
              ? `Pick the people at ${project.clientName} this project works with.`
              : `${project.clientName} has no active contacts to add yet.`}
          </EmptyState>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Position</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  {editable && (
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {project.activeContacts.map((c) => (
                  <tr
                    key={c.id}
                    className={c.active ? undefined : 'text-body-secondary opacity-75'}
                    data-inactive={!c.active || undefined}
                  >
                    <td className={c.active ? 'text-heading' : undefined}>
                      {c.name}
                      {!c.active && <span className="badge bg-label-secondary ms-2">Inactive</span>}
                    </td>
                    <td>{c.position ?? '–'}</td>
                    <td className="text-break">{c.email ?? '–'}</td>
                    <td className="text-nowrap">{c.phone ?? '–'}</td>
                    {editable && (
                      <td className="text-end">
                        <Button
                          variant="link"
                          size="sm"
                          className="text-danger"
                          aria-label={`Remove ${c.name}`}
                          onClick={() => mutation.mutate({ contactId: c.id, remove: true })}
                        >
                          Remove
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityTab({ project }: { project: ProjectDto }) {
  const activity = useProjectActivity(project.id, true);
  return (
    <div className="card">
      <div className="card-body">
        <ErrorAlert error={activity.error} />
        {activity.isPending ? (
          <LoadingRows />
        ) : (activity.data ?? []).length === 0 ? (
          <EmptyState icon="bx-history" title="No activity yet" />
        ) : (
          <ul className="list-unstyled mb-0">
            {activity.data!.map((a) => (
              <li key={a.id} className="mb-3">
                <span className="text-heading">{a.actor?.name ?? 'System'}</span>{' '}
                {a.action.replace(/_/g, ' ')}
                {a.changes.length > 0 && ` (${a.changes.map((c) => c.field).join(', ')})`}
                {a.reason && <div className="small text-body-secondary">“{a.reason}”</div>}
                <div className="small text-body-secondary">{dateTime(a.at)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ComingSoonTab({ title }: { title: string }) {
  return <EmptyState icon="bx-time" title={`${title} is coming in a later milestone`} />;
}
