import {
  BOARD_COLUMNS,
  TASK_STATUS_LABELS,
  TASK_TRANSITIONS,
  effortSummary,
  formatHours,
  moveWithinGroup,
  phaseNotEmptyMessage,
  plural,
  type PhaseDto,
  type ProjectDto,
  type TaskDto,
  type TaskStatus,
} from '@xc8/shared';
import { useState, type DragEvent } from 'react';
import { useEdgeFade } from '../../lib/useEdgeFade';
import { Button, Dropdown, Form, Modal } from 'react-bootstrap';
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
import {
  useAddPhase,
  useApplyTemplate,
  useDeletePhase,
  useProjectPhases,
  useRenamePhase,
} from '../../api/issueHooks';
import { useTemplate, useTemplates } from '../../api/projectHooks';
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

  const toolbar = (
    <ChecklistToolbar project={project} hasPhases={phases.length > 0 || emptyPhases.length > 0} />
  );

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
            <PhaseControls project={project} phase={ph} />
          </div>
        </div>
      ))}
    </>
  );

  if (tasks.length === 0) {
    if (emptySection) {
      return (
        <>
          {toolbar}
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
    // FR-PRJ-29: blank project empty state; the buttons live in the toolbar above.
    return (
      <>
        {toolbar}
        <EmptyState icon="bx-list-check" title="No phases yet">
          {project.can.planTasks
            ? 'Add your first phase, or apply a template.'
            : 'Phases will show here once the plan is ready.'}
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {toolbar}
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
              className="card-header py-3 d-flex flex-wrap align-items-center gap-2 phase-toggle"
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
                    <PhaseControls project={project} phase={infoOf(ph)!} />
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

/**
 * Checklist toolbar (FR-PRJ-29..31, doc 14 v1.2.6): the starting-template label, "+ Add phase"
 * (Project PM in Planning, or Admin) and "Apply template" (Planning only), plus the result toast.
 */
function ChecklistToolbar({ project, hasPhases }: { project: ProjectDto; hasPhases: boolean }) {
  const { user } = useAuth();
  const canEditProject = useCan('projects', 'edit');
  const planner = project.can.planTasks && !project.archived && canEditProject;
  const isAdmin = user?.systemRole === 'ADMIN';
  const planning = project.status === 'PLANNING';
  const canAddPhase = planner && (isAdmin || planning);
  const canApply = planner && planning;
  const [adding, setAdding] = useState(false);
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <span className="small text-body-secondary" data-testid="started-from">
          {project.templateName
            ? `Started from ${project.templateName} v${project.templateVersion}`
            : 'Started blank'}
        </span>
        <span className="ms-auto d-flex flex-wrap gap-2">
          {canAddPhase && (
            <Button
              size="sm"
              variant={hasPhases ? 'outline-primary' : 'primary'}
              onClick={() => setAdding(true)}
            >
              + Add phase
            </Button>
          )}
          {canApply && (
            <Button size="sm" variant="outline-secondary" onClick={() => setApplying(true)}>
              Apply template
            </Button>
          )}
          {planner && !canAddPhase && (
            <small
              className="text-body-secondary"
              title={PHASE_LOCK_NOTE}
              data-testid="phase-lock-toolbar"
            >
              <i className="bx bx-lock-alt me-1" aria-hidden="true" />
              {PHASE_LOCK_NOTE}
            </small>
          )}
        </span>
      </div>
      {toast && (
        <div className="alert alert-success py-2" role="status">
          {toast}
        </div>
      )}
      {adding && <AddPhaseModal projectId={project.id} onClose={() => setAdding(false)} />}
      {applying && (
        <ApplyTemplateModal
          project={project}
          hasPhases={hasPhases}
          onClose={() => setApplying(false)}
          onDone={(msg) => {
            setApplying(false);
            setToast(msg);
          }}
        />
      )}
    </>
  );
}

function AddPhaseModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const add = useAddPhase(projectId);
  return (
    <Modal show onHide={onClose} centered aria-labelledby="phase-add-title">
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate(name.trim(), { onSuccess: onClose });
        }}
      >
        <Modal.Header closeButton>
          <Modal.Title id="phase-add-title">Add phase</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={add.error} />
          <Form.Group controlId="phase-add-name">
            <Form.Label>Phase name *</Form.Label>
            <Form.Control value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={add.isPending || !name.trim()}>
            Add phase
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

function ApplyTemplateModal({
  project,
  hasPhases,
  onClose,
  onDone,
}: {
  project: ProjectDto;
  hasPhases: boolean;
  onClose: () => void;
  onDone: (toast: string) => void;
}) {
  const templates = useTemplates({ status: 'PUBLISHED' });
  const [id, setId] = useState('');
  const apply = useApplyTemplate(project.id);
  const items = (templates.data?.items ?? []).filter((t) => !t.superseded);
  const t = items.find((x) => x.id === id);
  // Doc 14 §J: n new and k merged phases, from the template's phases vs the project's.
  const detail = useTemplate(id || undefined);
  const phases = useProjectPhases(project.id);
  const have = new Set((phases.data ?? []).map((p) => p.name.trim().toLowerCase()));
  const tplNames = [
    ...new Set((detail.data?.phases ?? []).map((p) => p.name.trim().toLowerCase())),
  ];
  const k = tplNames.filter((n) => have.has(n)).length;
  const n = tplNames.length - k;
  return (
    <Modal show onHide={onClose} centered aria-labelledby="apply-template-title">
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          if (!t) return;
          apply.mutate(
            { templateId: t.id, templateVersion: t.version },
            {
              onSuccess: (r) =>
                onDone(applyToast(r.phasesAdded, r.phasesMerged ?? 0, r.template.name)),
              onError: () => void templates.refetch(),
            },
          );
        }}
      >
        <Modal.Header closeButton>
          <Modal.Title id="apply-template-title">Apply template</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={apply.error || templates.error} />
          <Form.Group controlId="apply-template-id">
            <Form.Label>Template *</Form.Label>
            <Form.Select value={id} onChange={(e) => setId(e.target.value)}>
              <option value="">Choose…</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · v{x.version}
                </option>
              ))}
            </Form.Select>
            <Form.Text className="d-block">
              Pre-fills a standard set of phases and activities. You can change them later.
            </Form.Text>
          </Form.Group>
          {t && hasPhases && detail.data && (
            <p className="mt-3 mb-0" data-testid="apply-confirm">
              {applyConfirmText(n, k, t.activityCount)}
            </p>
          )}
          {t && project.templateName === t.name && (
            <p className="mt-2 mb-0 text-warning">
              This template was already applied to this project.
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!t || apply.isPending}>
            Apply template
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

/** FR-PRJ-23: PMs outside Planning see why phase details are locked (tooltip and note). */
export const PHASE_LOCK_NOTE = 'Phases can be edited only in Planning';

/**
 * Phase controls (FR-PRJ-22/23): Edit phase and Delete phase while the phase is editable (Project
 * PM in Planning, or Admin); otherwise a lock note for planners. "+ Add activity" stays (Q-64).
 */
function PhaseControls({ project, phase }: { project: TabProps['project']; phase: PhaseDto }) {
  const [renaming, setRenaming] = useState(false);
  if (phase.editable === false) {
    return (
      <small className="text-body-secondary ms-2" title={PHASE_LOCK_NOTE} data-testid="phase-lock">
        <i className="bx bx-lock-alt me-1" aria-hidden="true" />
        {PHASE_LOCK_NOTE}
      </small>
    );
  }
  return (
    <>
      <Button
        variant="outline-primary"
        size="sm"
        className="ms-2"
        onClick={() => setRenaming(true)}
      >
        ✎ Edit phase
      </Button>
      <PhaseDelete projectId={project.id} phase={phase} />
      {renaming && (
        <PhaseRenameModal
          projectId={project.id}
          name={phase.name}
          onClose={() => setRenaming(false)}
        />
      )}
    </>
  );
}

function PhaseRenameModal({
  projectId,
  name,
  onClose,
}: {
  projectId: string;
  name: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  const rename = useRenamePhase(projectId);
  return (
    <Modal show onHide={onClose} centered aria-labelledby="phase-edit-title">
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          rename.mutate({ name, newName: value.trim() }, { onSuccess: onClose });
        }}
      >
        <Modal.Header closeButton>
          <Modal.Title id="phase-edit-title">Phase information</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={rename.error} />
          <Form.Group controlId="phase-name">
            <Form.Label>Phase name *</Form.Label>
            <Form.Control
              value={value}
              maxLength={120}
              onChange={(e) => setValue(e.target.value)}
            />
          </Form.Group>
          <p className="small text-body-secondary mt-2 mb-0">
            Editable while the project is in Planning.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={rename.isPending || !value.trim()}>
            Save phase
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

/**
 * Delete phase (FR-PRJ-32/33): an empty phase asks to confirm; a phase with activities opens no
 * dialog and shows one red line under the header instead. Shown only while the phase is editable.
 */
function PhaseDelete({ projectId, phase }: { projectId: string; phase: PhaseDto }) {
  const [confirm, confirmDialog] = useConfirm();
  const del = useDeletePhase(projectId);
  const [blocked, setBlocked] = useState<string | null>(null);
  const serverBlock =
    del.error instanceof ApiError && del.error.code === 'PHASE_NOT_EMPTY'
      ? phaseNotEmptyText(
          (del.error.details as { activityCount?: number } | undefined)?.activityCount,
        )
      : null;
  const line = blocked ?? serverBlock;
  return (
    <>
      {confirmDialog}
      <Button
        variant="outline-danger"
        size="sm"
        className="ms-auto"
        disabled={del.isPending}
        onClick={async (e) => {
          e.stopPropagation();
          setBlocked(null);
          if (phase.taskCount > 0) {
            setBlocked(phaseNotEmptyText(phase.taskCount));
            return;
          }
          if (!phase.deletable && phase.deleteBlockedReason) {
            setBlocked(phase.deleteBlockedReason);
            return;
          }
          if (
            await confirm({
              title: `Delete phase ${phase.name}?`,
              cancelLabel: 'Cancel',
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
      {line && (
        <div
          className="w-100 small"
          role="alert"
          style={{ color: '#b8240a' }}
          data-testid="phase-delete-blocked"
        >
          {line}
        </div>
      )}
      {del.error instanceof ApiError && !serverBlock && (
        <div className="w-100 small text-danger" role="alert">
          ⚠ {del.error.message}
        </div>
      )}
    </>
  );
}

/** Doc 14 §J: the apply-template result toast. */
function applyToast(added: number, merged: number, name: string) {
  if (added && merged)
    return `Added ${plural(added, 'phase')} and merged ${merged} into existing ones from ${name}.`;
  if (merged) return `Merged ${plural(merged, 'phase')} into existing ones from ${name}.`;
  return `Added ${plural(added, 'phase')} from ${name}.`;
}

/** Doc 14 §J: the apply-template confirm text (merge clause only when k > 0). */
function applyConfirmText(n: number, k: number, m: number) {
  const merge = k
    ? `, merges ${k} into existing ${k === 1 ? 'phase' : 'phases'} with the same name, and`
    : ' and';
  return `This adds ${n} new ${n === 1 ? 'phase' : 'phases'}${merge} adds ${plural(m, 'activity', 'activities')}. Nothing is replaced.`;
}

/** FR-PRJ-33: the inline "can't delete" line, with or without a count. */
function phaseNotEmptyText(count: number | undefined) {
  return typeof count === 'number' ? phaseNotEmptyMessage(count) : PHASE_NOT_EMPTY_NO_COUNT;
}
const PHASE_NOT_EMPTY_NO_COUNT =
  "Can't delete: this phase still has activities. Delete them first.";

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
