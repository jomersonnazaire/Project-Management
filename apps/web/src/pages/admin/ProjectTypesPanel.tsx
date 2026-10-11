import {
  PROJECT_TYPE_DUPLICATE,
  PROJECT_TYPE_NAME_MAX,
  PROJECT_TYPE_TOO_LONG,
  normalizeProjectTypeName,
  projectTypeNameKey,
  type ProjectTypeDto,
} from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import { useAdminProjectTypes, useProjectTypeMutation } from '../../api/projectTypeHooks';
import { useAdminLookups } from '../../api/trackerHooks';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { shortDate } from '../../lib/format';

const projects = (n: number) => `${n} ${n === 1 ? 'project' : 'projects'}`;

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; item: ProjectTypeDto }
  | { kind: 'deactivate'; item: ProjectTypeDto }
  | { kind: 'delete'; item: ProjectTypeDto };

/**
 * Admin › Settings › Project types (doc 14 v1.1.1 FR-PTY-01; mockup v0.9.2 #ptypes). Name and an
 * optional default activity type (active Activity types). In use: deactivate, not delete. Gated by
 * the `settings` access row like the other Admin lists. Every change is audited by the API.
 */
export function ProjectTypesPanel() {
  const list = useAdminProjectTypes();
  const acts = useAdminLookups('ACTIVITY_TYPE');
  const save = useProjectTypeMutation();
  const canEdit = useCan('settings', 'edit');
  const [showInactive, setShowInactive] = useState(true);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState('');
  const [defaultId, setDefaultId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const all = list.data ?? [];
  const items = all.filter((i) => showInactive || i.active);
  const activeActs = (acts.data ?? []).filter((a) => a.active);

  const open = (d: Dialog) => {
    save.reset();
    setError('');
    setName(d.kind === 'edit' ? d.item.name : '');
    setDefaultId('');
    setDialog(d);
  };
  const close = () => setDialog(null);
  const done = (text: string) => () => {
    setNotice(text);
    close();
  };
  const onError = (err: unknown) => {
    if (err instanceof ApiError) setError(err.fieldErrors().name ?? err.message);
  };

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    const v = normalizeProjectTypeName(name);
    if (!v) return setError('Add a name.');
    if (v.length > PROJECT_TYPE_NAME_MAX) return setError(PROJECT_TYPE_TOO_LONG);
    const self = dialog?.kind === 'edit' ? dialog.item.id : null;
    // Duplicate check ignores case and extra spaces, and includes inactive types (the API too).
    if (all.some((t) => t.id !== self && projectTypeNameKey(t.name) === v.toLowerCase())) {
      return setError(PROJECT_TYPE_DUPLICATE);
    }
    if (dialog?.kind === 'add') {
      save.mutate(
        { path: '', body: { name: v, defaultActivityTypeId: defaultId || null } },
        { onSuccess: done(`${v} added.`), onError },
      );
    } else if (dialog?.kind === 'edit') {
      if (v === dialog.item.name) return close();
      save.mutate(
        { path: `/${dialog.item.id}`, method: 'PATCH', body: { name: v } },
        { onSuccess: done(`Renamed to ${v}.`), onError },
      );
    }
  };

  const setDefault = (t: ProjectTypeDto, id: string) =>
    save.mutate(
      { path: `/${t.id}`, method: 'PATCH', body: { defaultActivityTypeId: id || null } },
      { onSuccess: () => setNotice(`Default activity type for ${t.name} saved.`) },
    );

  return (
    <div className="card">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
          <h5 className="mb-0">Project types</h5>
          <Form.Check
            type="switch"
            id="ptype-inactive"
            label="Show inactive"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {canEdit && (
            <Button size="sm" className="ms-auto" onClick={() => open({ kind: 'add' })}>
              + Add project type
            </Button>
          )}
        </div>
        <ErrorAlert error={list.error} />
        {notice && (
          <div className="alert alert-success py-2 small" role="status">
            <i className="bx bx-check me-1" aria-hidden="true" />
            {notice}
          </div>
        )}
        {list.isPending ? (
          <LoadingRows />
        ) : all.length === 0 ? (
          <EmptyState
            icon="bx-folder"
            title="No project types yet"
            action={
              canEdit ? (
                <Button size="sm" onClick={() => open({ kind: 'add' })}>
                  + Add project type
                </Button>
              ) : undefined
            }
          >
            Add one so new projects can pick a type and Time in can suggest an activity type.
          </EmptyState>
        ) : (
          <div className="table-responsive">
            <table className="table table-stack-md">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Default activity type</th>
                  <th scope="col">Projects using it</th>
                  <th scope="col">Status</th>
                  {canEdit && <th scope="col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const dead = t.defaultActivityType && !t.defaultActivityType.active;
                  return (
                    <tr key={t.id} className={t.active ? '' : 'row-inactive'}>
                      <td className="cell-primary fw-medium">
                        {t.name}
                        {!t.active && t.deactivatedAt && (
                          <div className="small fw-normal">
                            Deactivated {shortDate(t.deactivatedAt)}
                            {t.deactivatedBy && ` by ${t.deactivatedBy.name}`}
                          </div>
                        )}
                      </td>
                      <td data-label="Default activity type">
                        {canEdit ? (
                          <Form.Select
                            size="sm"
                            aria-label={`Default activity type for ${t.name}`}
                            value={t.defaultActivityType?.id ?? ''}
                            disabled={save.isPending}
                            onChange={(e) => setDefault(t, e.target.value)}
                          >
                            <option value="">No default</option>
                            {dead && (
                              <option value={t.defaultActivityType!.id}>
                                {t.defaultActivityType!.name} (inactive)
                              </option>
                            )}
                            {activeActs.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </Form.Select>
                        ) : t.defaultActivityType ? (
                          `${t.defaultActivityType.name}${dead ? ' (inactive)' : ''}`
                        ) : (
                          'No default'
                        )}
                      </td>
                      <td data-label="Projects using it">
                        {t.usedBy ? projects(t.usedBy) : 'Not used'}
                      </td>
                      <td data-label="Status">
                        <span
                          className={`badge ${t.active ? 'bg-label-success' : 'badge-inactive'}`}
                        >
                          {t.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="text-nowrap">
                          <Button
                            size="sm"
                            variant="link"
                            onClick={() => open({ kind: 'edit', item: t })}
                          >
                            Rename
                          </Button>
                          {t.active ? (
                            <Button
                              size="sm"
                              variant="link"
                              onClick={() => open({ kind: 'deactivate', item: t })}
                            >
                              Deactivate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="link"
                              onClick={() =>
                                save.mutate(
                                  { path: `/${t.id}`, method: 'PATCH', body: { active: true } },
                                  { onSuccess: () => setNotice(`${t.name} reactivated.`) },
                                )
                              }
                            >
                              Reactivate
                            </Button>
                          )}
                          {t.active && !t.usedBy && (
                            <Button
                              size="sm"
                              variant="link"
                              className="text-danger"
                              onClick={() => open({ kind: 'delete', item: t })}
                            >
                              Delete
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small text-body-secondary mb-0">
          Every new project needs a project type. Its default activity type is preselected when
          someone times in on that project's tasks; they can change it. In use: deactivate, not
          delete (projects keep the type; new projects can't pick it). Delete only when no project
          uses it. Renaming updates the label on every project. Every change is audited. A default
          activity type that was deactivated shows as "(inactive)"; Time in then leaves Activity
          type blank.
        </p>
      </div>
      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <Modal show onHide={close} centered aria-labelledby="ptype-title">
          <Form onSubmit={submitName} noValidate>
            <Modal.Header closeButton>
              <Modal.Title as="h2" className="h5" id="ptype-title">
                {dialog.kind === 'add' ? 'Add project type' : 'Rename project type'}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Form.Group controlId="ptype-name" className="mb-3">
                <Form.Label>Name *</Form.Label>
                <Form.Control
                  value={name}
                  placeholder="e.g. Hypercare"
                  autoFocus
                  isInvalid={Boolean(error)}
                  aria-describedby="ptype-count"
                  onChange={(e) => {
                    setName(e.target.value);
                    setError('');
                  }}
                />
                <div
                  id="ptype-count"
                  className={`small text-end ${name.length > PROJECT_TYPE_NAME_MAX ? 'text-danger' : 'text-body-secondary'}`}
                >
                  {name.length}/{PROJECT_TYPE_NAME_MAX}
                </div>
                <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
                {dialog.kind === 'edit' && dialog.item.usedBy ? (
                  <Form.Text>
                    Renaming updates the label on all {projects(dialog.item.usedBy)}.
                  </Form.Text>
                ) : null}
              </Form.Group>
              {dialog.kind === 'add' && (
                <Form.Group controlId="ptype-default">
                  <Form.Label>
                    Default activity type <span className="text-body-secondary">(optional)</span>
                  </Form.Label>
                  <Form.Select value={defaultId} onChange={(e) => setDefaultId(e.target.value)}>
                    <option value="">No default</option>
                    {activeActs.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Text>
                    Preselected at Time in on this type's projects. People can change it.
                  </Form.Text>
                </Form.Group>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="outline-secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {dialog.kind === 'add' ? 'Add' : 'Save'}
              </Button>
            </Modal.Footer>
          </Form>
        </Modal>
      )}
      {(dialog?.kind === 'deactivate' || dialog?.kind === 'delete') && (
        <Modal show onHide={close} centered aria-labelledby="ptype-confirm-title">
          <Modal.Header closeButton>
            <Modal.Title as="h2" className="h5" id="ptype-confirm-title">
              {dialog.kind === 'delete' ? 'Delete' : 'Deactivate'} {dialog.item.name}?
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <ErrorAlert error={save.error} />
            {dialog.kind === 'deactivate'
              ? `${dialog.item.usedBy ? `${projects(dialog.item.usedBy)} use it and keep it. ` : ''}New projects can't pick it. You can reactivate it later.`
              : "No project uses it. This can't be undone."}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={dialog.kind === 'delete' ? 'danger' : 'warning'}
              disabled={save.isPending}
              onClick={() =>
                save.mutate(
                  dialog.kind === 'delete'
                    ? { path: `/${dialog.item.id}`, method: 'DELETE' }
                    : { path: `/${dialog.item.id}`, method: 'PATCH', body: { active: false } },
                  {
                    onSuccess: done(
                      `${dialog.item.name} ${dialog.kind === 'delete' ? 'deleted' : 'deactivated'}.`,
                    ),
                  },
                )
              }
            >
              {dialog.kind === 'delete' ? 'Delete' : 'Deactivate'}
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
