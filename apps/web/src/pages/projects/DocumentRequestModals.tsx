import {
  CLIENT_CONTACT_NOTICE,
  RESTRICTED_FOLDER_NOTE,
  partyLabel,
  phDateOf,
  type DocumentDto,
  type FolderDto,
  type ProjectDto,
  type TaskDto,
} from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { useDocumentMutation, useRequestParties } from '../../api/m3Hooks';
import { ErrorAlert } from '../../components/Feedback';

/**
 * Request a document (FR-DOC-20, AC-26.1/26.2, mockup "Request a document"): name, folder, due date
 * (today or later), requested from (project members or active client contacts), linked task, and
 * requires-signature (on by default in Contracts).
 */
export function RequestModal({
  project,
  folders,
  folderId,
  tasks,
  onClose,
}: {
  project: ProjectDto;
  folders: FolderDto[];
  folderId: string;
  tasks: TaskDto[];
  onClose: (created?: DocumentDto) => void;
}) {
  const parties = useRequestParties(project.id);
  const mutation = useDocumentMutation(project.id);
  const today = phDateOf(new Date());
  const startFolder = folders.find((f) => f.id === folderId);
  const [form, setForm] = useState({
    name: '',
    folderId,
    dueDate: '',
    from: '',
    taskId: '',
    requiresSignature: startFolder?.kind === 'CONTRACTS',
  });
  const [missing, setMissing] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m: Record<string, string> = {};
    if (!form.name.trim()) m.name = 'Document name is required.';
    if (!form.dueDate) m.dueDate = 'Choose a due date.';
    else if (form.dueDate < today) m.dueDate = 'The due date can’t be in the past.';
    if (!form.from) m.from = 'Choose who the document is requested from.';
    setMissing(m);
    if (Object.keys(m).length) return;
    const [kind, id] = form.from.split(':');
    mutation.mutate(
      {
        path: '/documents/requests',
        body: {
          name: form.name.trim(),
          folderId: form.folderId,
          dueDate: form.dueDate,
          requestedFrom: { kind, id },
          taskId: form.taskId || null,
          requiresSignature: form.requiresSignature,
        },
      },
      { onSuccess: (res) => onClose(res.document) },
    );
  };

  return (
    <Modal show onHide={() => onClose()} centered aria-labelledby="request-title">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5" id="request-title">
            Request a document
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={mutation.error} action />
          <ErrorAlert error={parties.error} />
          <div className="row g-3">
            <Form.Group className="col-12" controlId="req-name">
              <Form.Label>Document name *</Form.Label>
              <Form.Control
                value={form.name}
                maxLength={200}
                isInvalid={Boolean(missing.name)}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <Form.Control.Feedback type="invalid">{missing.name}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="col-sm-6" controlId="req-folder">
              <Form.Label>Folder *</Form.Label>
              <Form.Select
                value={form.folderId}
                onChange={(e) => {
                  const f = folders.find((x) => x.id === e.target.value);
                  setForm({
                    ...form,
                    folderId: e.target.value,
                    requiresSignature: f?.kind === 'CONTRACTS',
                  });
                }}
              >
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {'\u00a0\u00a0'.repeat(f.depth)}
                    {f.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-sm-6" controlId="req-due">
              <Form.Label>Due date *</Form.Label>
              <Form.Control
                type="date"
                min={today}
                value={form.dueDate}
                isInvalid={Boolean(missing.dueDate)}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
              <Form.Control.Feedback type="invalid">{missing.dueDate}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="col-12" controlId="req-from">
              <Form.Label>Requested from *</Form.Label>
              <Form.Select
                value={form.from}
                isInvalid={Boolean(missing.from)}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
              >
                <option value="">Choose a person…</option>
                {(parties.data?.contacts.length ?? 0) > 0 && (
                  <optgroup label="Client contacts">
                    {parties.data!.contacts.map((c) => (
                      <option key={c.id} value={`CONTACT:${c.id}`}>
                        {partyLabel(c)} (client contact)
                      </option>
                    ))}
                  </optgroup>
                )}
                {(parties.data?.users.length ?? 0) > 0 && (
                  <optgroup label="Project team">
                    {parties.data!.users.map((u) => (
                      <option key={u.id} value={`USER:${u.id}`}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Form.Select>
              <Form.Control.Feedback type="invalid">{missing.from}</Form.Control.Feedback>
              <Form.Text>{CLIENT_CONTACT_NOTICE}</Form.Text>
            </Form.Group>
            <Form.Group className="col-12" controlId="req-task">
              <Form.Label>Linked task (optional)</Form.Label>
              <Form.Select
                value={form.taskId}
                onChange={(e) => setForm({ ...form, taskId: e.target.value })}
              >
                <option value="">None</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.order} {t.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-12" controlId="req-signature">
              <Form.Check
                type="checkbox"
                label="Needs a signed copy"
                checked={form.requiresSignature}
                onChange={(e) => setForm({ ...form, requiresSignature: e.target.checked })}
              />
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Send request
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

/**
 * Folder restriction (FR-DOC-43): the PM or an Admin limits a folder (and its sub-folders) to the
 * project manager, Admins and the members they pick.
 */
export function FolderAccessModal({
  project,
  folder,
  onClose,
}: {
  project: ProjectDto;
  folder: FolderDto;
  onClose: () => void;
}) {
  const parties = useRequestParties(project.id);
  const mutation = useDocumentMutation(project.id);
  const [restricted, setRestricted] = useState(folder.restricted);
  const [picked, setPicked] = useState<string[]>(folder.allowedUserIds);
  const managerId = project.manager?.id ?? null;
  const members = (parties.data?.users ?? []).filter((u) => u.id !== managerId);

  const save = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate(
      {
        path: `/folders/${folder.id}/access`,
        method: 'PUT',
        body: { restricted, memberIds: restricted ? picked : [] },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal show onHide={onClose} centered aria-labelledby="access-title">
      <Form onSubmit={save} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5" id="access-title">
            Who can see “{folder.name}”
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={mutation.error} action />
          <Form.Check
            type="radio"
            id="access-all"
            name="access"
            label="Everyone on the project"
            checked={!restricted}
            onChange={() => setRestricted(false)}
          />
          <Form.Check
            type="radio"
            id="access-restricted"
            name="access"
            label="Only the project manager, Admins and the people below"
            checked={restricted}
            onChange={() => setRestricted(true)}
          />
          {restricted && (
            <fieldset className="mt-3 ms-4">
              <legend className="small fw-semibold mb-2">Project members</legend>
              {members.length === 0 && (
                <p className="small text-body-secondary">No other members on this project.</p>
              )}
              {members.map((u) => (
                <Form.Check
                  key={u.id}
                  type="checkbox"
                  id={`access-${u.id}`}
                  label={u.name}
                  checked={picked.includes(u.id)}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked ? [...picked, u.id] : picked.filter((x) => x !== u.id),
                    )
                  }
                />
              ))}
            </fieldset>
          )}
          <p className="small text-body-secondary mt-3 mb-0">
            {RESTRICTED_FOLDER_NOTE} Sub-folders follow this folder.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Save
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
