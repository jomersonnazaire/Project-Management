import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  plural,
  END_AFTER_START,
  type ProjectDto,
  type ProjectStatus,
  type UpdateProjectInput,
} from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { ApiError, saveErrorMessage } from '../../api/client';
import { useClients } from '../../api/hooks';
import { usePeople, useUpdateProject } from '../../api/projectHooks';
import { useAuth } from '../../auth/AuthContext';
import { HandoverModal } from '../../components/HandoverModal';

/**
 * Edit a project (FR-PRJ-11..13): details, team, status, baseline dates (with a reason) and the
 * client (which clears the active contacts after confirmation).
 */
export function ProjectEditModal({
  project,
  onClose,
}: {
  project: ProjectDto;
  onClose: () => void;
}) {
  const update = useUpdateProject(project.id);
  const { user } = useAuth();
  const [handover, setHandover] = useState<UpdateProjectInput | null>(null);
  const people = usePeople();
  const clients = useClients();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [managerId, setManagerId] = useState(project.managerId ?? '');
  const [memberIds, setMemberIds] = useState(project.members.map((m) => m.id));
  const [clientId, setClientId] = useState(project.clientId);
  const [startDate, setStartDate] = useState(project.startDate ?? '');
  const [plannedEndDate, setPlannedEndDate] = useState(project.plannedEndDate ?? '');
  const [reason, setReason] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const datesChanged =
    startDate !== (project.startDate ?? '') || plannedEndDate !== (project.plannedEndDate ?? '');
  const clientChanged = clientId !== project.clientId;
  const serverErrors = update.error instanceof ApiError ? update.error.fieldErrors() : {};
  const err = (k: string) => errors[k] ?? serverErrors[k];
  const needsConfirm =
    update.error instanceof ApiError && update.error.code === 'CONFIRM_CLEAR_CONTACTS';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Project name is required.';
    if (plannedEndDate <= startDate) next.plannedEndDate = END_AFTER_START;
    if (datesChanged && !reason.trim()) next.reason = 'Give a reason for changing the baseline.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const body: UpdateProjectInput = {};
    if (name.trim() !== project.name) body.name = name.trim();
    if ((description.trim() || null) !== project.description)
      body.description = description.trim() || null;
    if (status !== project.status) body.status = status;
    if (managerId !== project.managerId) body.managerId = managerId;
    const members = memberIds.filter((m) => m !== managerId);
    if (members.join() !== project.members.map((m) => m.id).join()) body.memberIds = members;
    if (clientChanged) {
      body.clientId = clientId;
      if (confirmClear) body.confirmClearContacts = true;
    }
    if (datesChanged) {
      body.startDate = startDate;
      body.plannedEndDate = plannedEndDate;
      body.reason = reason.trim();
    }
    if (!Object.keys(body).length) return onClose();
    // A PM giving away a project they manage confirms first (doc 11 §12).
    if (
      body.managerId &&
      user?.systemRole === 'PROJECT_MANAGER' &&
      project.managerId === user.id &&
      body.managerId !== user.id
    ) {
      setHandover(body);
      return;
    }
    update.mutate(body, { onSuccess: onClose });
  };

  const managers = (people.data ?? []).filter(
    (p) => p.systemRole === 'ADMIN' || p.systemRole === 'PROJECT_MANAGER',
  );

  return (
    <Modal show onHide={onClose} centered size="lg">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5">
            Edit project
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {update.error && !Object.keys(serverErrors).length && !needsConfirm ? (
            <Alert variant="danger">{saveErrorMessage(update.error)}</Alert>
          ) : null}
          {needsConfirm && <Alert variant="warning">{(update.error as ApiError).message}</Alert>}
          <div className="row g-3">
            <Form.Group className="col-md-8" controlId="edit-prj-name">
              <Form.Label>Project name</Form.Label>
              <Form.Control
                value={name}
                onChange={(e) => setName(e.target.value)}
                isInvalid={Boolean(err('name'))}
              />
              <Form.Control.Feedback type="invalid">{err('name')}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="col-md-4" controlId="edit-prj-status">
              <Form.Label>Status</Form.Label>
              <Form.Select
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-6" controlId="edit-prj-client">
              <Form.Label>Client</Form.Label>
              <Form.Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                {(clients.data?.items ?? [])
                  .filter((c) => c.active || c.id === project.clientId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                {!clients.data && <option value={project.clientId}>{project.clientName}</option>}
              </Form.Select>
              {clientChanged && project.activeContacts.length > 0 && (
                <Form.Check
                  className="mt-2"
                  id="edit-prj-confirm-clear"
                  label={`Remove the ${plural(project.activeContacts.length, 'active contact')} from ${project.clientName}`}
                  checked={confirmClear}
                  isInvalid={needsConfirm && !confirmClear}
                  onChange={(e) => setConfirmClear(e.target.checked)}
                />
              )}
            </Form.Group>
            <Form.Group className="col-md-6" controlId="edit-prj-manager">
              <Form.Label>Project manager</Form.Label>
              <Form.Select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                {!people.data && project.manager && (
                  <option value={project.manager.id}>{project.manager.name}</option>
                )}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-6" controlId="edit-prj-start">
              <Form.Label>Baseline start</Form.Label>
              <Form.Control
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Form.Group>
            <Form.Group className="col-md-6" controlId="edit-prj-end">
              <Form.Label>Baseline end</Form.Label>
              <Form.Control
                type="date"
                value={plannedEndDate}
                onChange={(e) => setPlannedEndDate(e.target.value)}
                isInvalid={Boolean(err('plannedEndDate'))}
              />
              <Form.Control.Feedback type="invalid">{err('plannedEndDate')}</Form.Control.Feedback>
            </Form.Group>
            {datesChanged && (
              <Form.Group className="col-12" controlId="edit-prj-reason">
                <Form.Label>Reason for re-baselining</Form.Label>
                <Form.Control
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  isInvalid={Boolean(err('reason'))}
                />
                <Form.Control.Feedback type="invalid">{err('reason')}</Form.Control.Feedback>
              </Form.Group>
            )}
            <fieldset className="col-12">
              <legend className="form-label fs-6">Team members</legend>
              <div
                className="border rounded p-2 d-flex flex-wrap gap-3"
                style={{ maxHeight: 160, overflowY: 'auto' }}
              >
                {(people.data ?? [])
                  .filter((p) => p.id !== managerId)
                  .map((p) => (
                    <Form.Check
                      key={p.id}
                      id={`edit-prj-member-${p.id}`}
                      label={p.name}
                      checked={memberIds.includes(p.id)}
                      onChange={(e) =>
                        setMemberIds(
                          e.target.checked
                            ? [...memberIds, p.id]
                            : memberIds.filter((x) => x !== p.id),
                        )
                      }
                    />
                  ))}
              </div>
            </fieldset>
            <Form.Group className="col-12" controlId="edit-prj-desc">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending}>
            Save changes
          </Button>
        </Modal.Footer>
      </Form>
      {handover && (
        <HandoverModal
          name={managers.find((m) => m.id === handover.managerId)?.name ?? 'the new manager'}
          pending={update.isPending}
          onCancel={() => setHandover(null)}
          onConfirm={() =>
            update.mutate(handover, {
              onSuccess: onClose,
              onSettled: () => setHandover(null),
            })
          }
        />
      )}
    </Modal>
  );
}
