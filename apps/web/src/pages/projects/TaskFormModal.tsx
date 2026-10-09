import {
  DUE_NOT_BEFORE_START,
  JOB_ROLE_LABELS,
  type JobRole,
  type PersonDto,
  NO_ESTIMATE_LABEL,
  PARTIES,
  PARTY_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  type Party,
  type Priority,
  type ProjectDto,
  type TaskDto,
} from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { ApiError, saveErrorMessage } from '../../api/client';
import {
  taskCreate,
  taskPatch,
  useContactOptions,
  usePeople,
  useTaskMutation,
} from '../../api/projectHooks';

/** Add or edit a task's plan (FR-TSK-01, FR-TSK-14). Only the project's planners see this. */
export function TaskFormModal({
  project,
  task,
  tasks,
  fixedPhase,
  onClose,
}: {
  project: ProjectDto;
  task: TaskDto | null;
  tasks: TaskDto[];
  /** Set by a phase's "+ Add activity": the task goes into that phase, with no phase picker. */
  fixedPhase?: string | null;
  onClose: () => void;
}) {
  const mutation = useTaskMutation();
  const contacts = useContactOptions(project.id, true);
  // FR-PRJ-19 (DEF-003): Owner and Assignees list only the project team. Admins and PMs who can
  // edit the project may pick someone else; they join the project in the same save that assigns
  // them (atomic on the API, audited as a project member add).
  const canAddMembers = Boolean(project.can.addMembers);
  const [added, setAdded] = useState<PersonDto[]>([]);
  const [picking, setPicking] = useState<'owner' | 'assignee' | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const team = [project.manager, ...project.members, ...added].filter(
    (u, i, all): u is NonNullable<typeof u> =>
      Boolean(u) && all.findIndex((x) => x?.id === u!.id) === i,
  );
  const memberIds = new Set(
    [project.manager, ...project.members].filter(Boolean).map((u) => u!.id),
  );

  const [name, setName] = useState(task?.name ?? '');
  const [phase, setPhase] = useState(task?.phase ?? fixedPhase ?? '');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'MEDIUM');
  const [party, setParty] = useState<Party>(task?.party ?? 'INTERNAL');
  const [ownerId, setOwnerId] = useState(task?.owner?.id ?? '');
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assignees.map((a) => a.id) ?? []);
  const [clientContactId, setClientContactId] = useState(task?.clientContact?.id ?? '');
  const [plannedStart, setPlannedStart] = useState(task?.plannedStart ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [est, setEst] = useState(task?.estHours == null ? '' : String(task.estHours));
  const [dependsOn, setDependsOn] = useState<string[]>(task?.dependsOn ?? []);
  const [deliverable, setDeliverable] = useState(task?.deliverable ?? '');
  const [mandatory, setMandatory] = useState(task?.mandatory ?? false);
  const [requiresApproval, setRequiresApproval] = useState(task?.requiresApproval ?? false);
  const [reviewerId, setReviewerId] = useState(task?.reviewer?.id ?? '');
  const [isMilestone, setIsMilestone] = useState(task?.isMilestone ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const serverErrors = mutation.error instanceof ApiError ? mutation.error.fieldErrors() : {};
  const err = (k: string) => errors[k] ?? serverErrors[k];
  const phases = Array.from(new Set(tasks.map((t) => t.phase).filter(Boolean))) as string[];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Task name is required.';
    // Blank means "no estimate", stored as null, never 0 (EC-58).
    const estHours = est.trim() === '' ? null : Number(est);
    if (estHours !== null && (!Number.isFinite(estHours) || estHours < 0)) {
      next.estHours = 'Enter hours of 0 or more, or leave blank.';
    }
    if (plannedStart && dueDate && dueDate < plannedStart) next.dueDate = DUE_NOT_BEFORE_START;
    if (party === 'CLIENT' && !clientContactId) next.clientContactId = 'Choose the client contact.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      name: name.trim(),
      phase: phase.trim() || null,
      priority,
      party,
      ownerId: ownerId || null,
      assigneeIds,
      clientContactId: party === 'CLIENT' ? clientContactId || null : null,
      plannedStart: plannedStart || null,
      dueDate: dueDate || null,
      estHours,
      dependsOn,
      deliverable: deliverable.trim() || null,
      mandatory,
      requiresApproval,
      reviewerId: requiresApproval ? reviewerId || null : null,
      isMilestone,
    };
    const roles = new Set([body.ownerId, body.reviewerId, ...assigneeIds].filter(Boolean));
    const joining = added.filter((p) => roles.has(p.id) && !memberIds.has(p.id));
    const withAdds = joining.length ? { ...body, addMemberIds: joining.map((p) => p.id) } : body;
    mutation.mutate(
      task
        ? taskPatch(task.id, { ...withAdds, version: task.version })
        : taskCreate(project.id, withAdds),
      {
        onSuccess: () => {
          if (!joining.length) return onClose();
          setConfirmation(
            `${joining.map((p) => p.name).join(', ')} added to ${project.name} and assigned.`,
          );
        },
      },
    );
  };

  const pick = (person: PersonDto) => {
    setAdded((prev) => (prev.some((p) => p.id === person.id) ? prev : [...prev, person]));
    if (picking === 'owner') setOwnerId(person.id);
    else if (!assigneeIds.includes(person.id)) setAssigneeIds([...assigneeIds, person.id]);
    setPicking(null);
  };
  const pending = added.filter(
    (p) => (p.id === ownerId || assigneeIds.includes(p.id)) && !memberIds.has(p.id),
  );
  const memberHint = !canAddMembers ? (
    <Form.Text className="d-block">Only project members can be assigned</Form.Text>
  ) : null;

  if (confirmation) {
    return (
      <Modal show onHide={onClose} centered>
        <Modal.Body>
          <Alert variant="success" className="mb-0" role="status">
            {confirmation}
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={onClose} autoFocus>
            Done
          </Button>
        </Modal.Footer>
      </Modal>
    );
  }

  return (
    <Modal show onHide={onClose} centered size="lg">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5">
            {task ? 'Edit task' : 'Add task'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {mutation.error && !Object.keys(serverErrors).length ? (
            <Alert variant="danger">{saveErrorMessage(mutation.error)}</Alert>
          ) : null}
          <div className="row g-3">
            <Form.Group className="col-md-8" controlId="task-name">
              <Form.Label>Task name</Form.Label>
              <Form.Control
                value={name}
                onChange={(e) => setName(e.target.value)}
                isInvalid={Boolean(err('name'))}
                autoFocus
              />
              <Form.Control.Feedback type="invalid">{err('name')}</Form.Control.Feedback>
            </Form.Group>
            {!task && fixedPhase !== undefined ? (
              <div className="col-md-4">
                <span className="form-label d-block">Phase</span>
                <span className="text-heading" data-testid="task-phase-fixed">
                  {fixedPhase ?? 'No phase'}
                </span>
              </div>
            ) : (
              <Form.Group className="col-md-4" controlId="task-phase">
                <Form.Label>Phase</Form.Label>
                <Form.Control
                  list="task-phase-list"
                  value={phase}
                  onChange={(e) => setPhase(e.target.value)}
                />
                <datalist id="task-phase-list">
                  {phases.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Form.Group>
            )}
            <Form.Group className="col-md-4" controlId="task-priority">
              <Form.Label>Priority</Form.Label>
              <Form.Select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-4" controlId="task-party">
              <Form.Label>Party</Form.Label>
              <Form.Select value={party} onChange={(e) => setParty(e.target.value as Party)}>
                {PARTIES.map((p) => (
                  <option key={p} value={p}>
                    {PARTY_LABELS[p]}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-4" controlId="task-owner">
              <Form.Label>Owner (accountable)</Form.Label>
              <Form.Select
                value={ownerId}
                onChange={(e) =>
                  e.target.value === ADD_SOMEONE ? setPicking('owner') : setOwnerId(e.target.value)
                }
                isInvalid={Boolean(err('ownerId'))}
              >
                <option value="">Unassigned</option>
                {team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
                {canAddMembers && <option value={ADD_SOMEONE}>{ADD_SOMEONE_LABEL}</option>}
              </Form.Select>
              <Form.Control.Feedback type="invalid">{err('ownerId')}</Form.Control.Feedback>
              {memberHint}
            </Form.Group>
            {party === 'CLIENT' && (
              <Form.Group className="col-md-6" controlId="task-contact">
                <Form.Label>Client contact</Form.Label>
                <Form.Select
                  value={clientContactId}
                  onChange={(e) => setClientContactId(e.target.value)}
                  isInvalid={Boolean(err('clientContactId'))}
                >
                  <option value="">Choose…</option>
                  {(contacts.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.position ? ` · ${c.position}` : ''}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">
                  {err('clientContactId')}
                </Form.Control.Feedback>
                <Form.Text>Only active contacts of {project.clientName}.</Form.Text>
              </Form.Group>
            )}
            <fieldset className="col-md-6">
              <legend className="form-label fs-6">Assignees</legend>
              <div className="border rounded p-2" style={{ maxHeight: 140, overflowY: 'auto' }}>
                {team.map((u) => (
                  <Form.Check
                    key={u.id}
                    id={`task-assignee-${u.id}`}
                    label={u.name}
                    checked={assigneeIds.includes(u.id)}
                    onChange={(e) =>
                      setAssigneeIds(
                        e.target.checked
                          ? [...assigneeIds, u.id]
                          : assigneeIds.filter((x) => x !== u.id),
                      )
                    }
                  />
                ))}
                {canAddMembers && (
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 mt-1"
                    onClick={() => setPicking('assignee')}
                  >
                    {ADD_SOMEONE_LABEL}
                  </Button>
                )}
              </div>
              {memberHint}
            </fieldset>
            {picking && (
              <PeoplePicker
                projectName={project.name}
                exclude={new Set(team.map((u) => u.id))}
                onPick={pick}
                onCancel={() => setPicking(null)}
              />
            )}
            {pending.length > 0 && (
              <div className="col-12">
                <Alert variant="info" className="py-2 mb-0" data-testid="pending-members">
                  {pending.map((p) => p.name).join(', ')} will be added to {project.name} when you
                  save.
                </Alert>
              </div>
            )}
            <Form.Group className="col-md-4" controlId="task-start">
              <Form.Label>Planned start</Form.Label>
              <Form.Control
                type="date"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
              />
            </Form.Group>
            <Form.Group className="col-md-4" controlId="task-due">
              <Form.Label>Due date</Form.Label>
              <Form.Control
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                isInvalid={Boolean(err('dueDate'))}
              />
              <Form.Control.Feedback type="invalid">{err('dueDate')}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="col-md-4" controlId="task-est">
              <Form.Label>Estimated hours</Form.Label>
              <Form.Control
                inputMode="decimal"
                placeholder="–"
                value={est}
                onChange={(e) => setEst(e.target.value)}
                isInvalid={Boolean(err('estHours'))}
                aria-describedby="task-est-hint"
              />
              <Form.Control.Feedback type="invalid">{err('estHours')}</Form.Control.Feedback>
              <Form.Text id="task-est-hint">
                Leave blank for {NO_ESTIMATE_LABEL.toLowerCase()}.
              </Form.Text>
            </Form.Group>
            <Form.Group className="col-md-6" controlId="task-deps">
              <Form.Label>Depends on</Form.Label>
              <Form.Select
                multiple
                value={dependsOn}
                onChange={(e) =>
                  setDependsOn(Array.from(e.target.selectedOptions).map((o) => o.value))
                }
              >
                {tasks
                  .filter((t) => t.id !== task?.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      #{t.order} {t.name}
                    </option>
                  ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-6" controlId="task-deliverable">
              <Form.Label>Deliverable</Form.Label>
              <Form.Control value={deliverable} onChange={(e) => setDeliverable(e.target.value)} />
            </Form.Group>
            <div className="col-12 d-flex flex-wrap gap-4 align-items-center">
              <Form.Check
                id="task-mandatory"
                label="Mandatory"
                checked={mandatory}
                onChange={(e) => setMandatory(e.target.checked)}
              />
              <Form.Check
                id="task-milestone"
                label="Milestone"
                checked={isMilestone}
                onChange={(e) => setIsMilestone(e.target.checked)}
              />
              <Form.Check
                id="task-approval"
                label="Needs approval"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
              />
              {requiresApproval && (
                <Form.Select
                  aria-label="Reviewer"
                  value={reviewerId}
                  onChange={(e) => setReviewerId(e.target.value)}
                  style={{ maxWidth: 220 }}
                >
                  <option value="">Reviewer: project manager</option>
                  {team.map((u) => (
                    <option key={u.id} value={u.id}>
                      Reviewer: {u.name}
                    </option>
                  ))}
                </Form.Select>
              )}
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {task ? 'Save task' : 'Add task'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

const ADD_SOMEONE = '__add_someone__';
const ADD_SOMEONE_LABEL = '+ Add someone to this project…';

/** People picker for FR-PRJ-19: active internal users not yet on the project (GET /people). */
function PeoplePicker({
  projectName,
  exclude,
  onPick,
  onCancel,
}: {
  projectName: string;
  exclude: Set<string>;
  onPick: (p: PersonDto) => void;
  onCancel: () => void;
}) {
  const people = usePeople();
  const [q, setQ] = useState('');
  const shown = (people.data ?? [])
    .filter((p) => !exclude.has(p.id))
    .filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="col-12">
      <div className="border rounded p-3" role="group" aria-labelledby="people-picker-title">
        <div className="d-flex align-items-center mb-2">
          <h3 className="h6 mb-0" id="people-picker-title">
            Add someone to {projectName}
          </h3>
          <Button variant="link" size="sm" className="ms-auto p-0" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <Form.Control
          aria-label="Search people"
          placeholder="Search people…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <div className="list-group mt-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {people.isLoading && <div className="small text-body-secondary p-2">Loading…</div>}
          {!people.isLoading && shown.length === 0 && (
            <div className="small text-body-secondary p-2">No one else to add.</div>
          )}
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              className="list-group-item list-group-item-action"
              onClick={() => onPick(p)}
            >
              {p.name}
              <span className="small text-body-secondary ms-2">
                {JOB_ROLE_LABELS[p.jobRole as JobRole] ?? p.jobRole}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
