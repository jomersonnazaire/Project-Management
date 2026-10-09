import { LOOKUP_LABELS, type EditableLookupKind, type LookupDto } from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import { useAdminLookups, useLookupMutation } from '../../api/trackerHooks';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { shortDate } from '../../lib/format';

const NOTES: Record<EditableLookupKind, string> = {
  ACTIVITY_TYPE:
    "One list for every time entry, project tasks and quick activities alike. Required on each entry; shown in the report's Activity Type column.",
  LOCATION:
    'Asked once per day at the first Time in ("Where are you working today?"); entries inherit it and one entry can be changed. Report column "Location".',
};

const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; item: LookupDto }
  | { kind: 'deactivate'; item: LookupDto }
  | { kind: 'delete'; item: LookupDto };

/**
 * Admin › Settings › Activity types / Locations (doc 14 FR-ACT-15, -17, §10; mockup v0.8.9
 * actcat, setloc; Modules removed by FR-ACT-22). In use: deactivate, not delete. Every change is audited.
 */
export function LookupsPanel({ kind }: { kind: EditableLookupKind }) {
  const labels = LOOKUP_LABELS[kind];
  const list = useAdminLookups(kind);
  const save = useLookupMutation();
  const canEdit = useCan('settings', 'edit');
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const items = (list.data ?? []).filter((i) => showInactive || i.active);

  const open = (d: Dialog) => {
    save.reset();
    setError('');
    setName(d.kind === 'edit' ? d.item.name : '');
    setDialog(d);
  };
  const close = () => setDialog(null);
  const onError = (err: unknown) => {
    if (err instanceof ApiError) setError(err.fieldErrors().name ?? err.message);
  };

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Add a name.');
    if (dialog?.kind === 'add') {
      save.mutate(
        { path: `/${labels.path}`, body: { name: name.trim() } },
        { onSuccess: close, onError },
      );
    } else if (dialog?.kind === 'edit') {
      save.mutate(
        { path: `/${dialog.item.id}`, method: 'PATCH', body: { name: name.trim() } },
        { onSuccess: close, onError },
      );
    }
  };

  return (
    <div className="card">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
          <h5 className="mb-0">{labels.many}</h5>
          <Form.Check
            type="switch"
            id={`${kind}-inactive`}
            label="Show inactive"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          {canEdit && (
            <Button size="sm" className="ms-auto" onClick={() => open({ kind: 'add' })}>
              + Add {labels.one}
            </Button>
          )}
        </div>
        <p className="small text-body-secondary">
          {NOTES[kind]} In use: deactivate, not delete (past entries keep the value; it's no longer
          offered). Delete only when no entry uses it. Renaming updates the label everywhere. Every
          change is audited.
        </p>
        <ErrorAlert error={list.error} />
        {list.isPending ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          <EmptyState icon="bx-purchase-tag" title={`No ${labels.many.toLowerCase()} yet`}>
            Add at least one so people can log time.
          </EmptyState>
        ) : (
          <div className="table-responsive">
            <table className="table table-stack-md">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Used by</th>
                  <th scope="col">Status</th>
                  {canEdit && <th scope="col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className={i.active ? '' : 'text-body-secondary'}>
                    <td className="cell-primary fw-medium">
                      {i.name}
                      {!i.active && i.deactivatedAt && (
                        <div className="small fw-normal">
                          Deactivated {shortDate(i.deactivatedAt)}
                          {i.deactivatedBy && ` by ${i.deactivatedBy.name}`}
                        </div>
                      )}
                    </td>
                    <td data-label="Used by">{i.usedBy ? entries(i.usedBy) : 'Not used'}</td>
                    <td data-label="Status">
                      <span
                        className={`badge ${i.active ? 'bg-label-success' : 'bg-label-secondary'}`}
                      >
                        {i.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="text-nowrap">
                        <Button
                          size="sm"
                          variant="link"
                          onClick={() => open({ kind: 'edit', item: i })}
                        >
                          Edit
                        </Button>
                        {!i.active ? (
                          <Button
                            size="sm"
                            variant="link"
                            onClick={() =>
                              save.mutate({
                                path: `/${i.id}`,
                                method: 'PATCH',
                                body: { active: true },
                              })
                            }
                          >
                            Reactivate
                          </Button>
                        ) : i.usedBy ? (
                          <Button
                            size="sm"
                            variant="link"
                            onClick={() => open({ kind: 'deactivate', item: i })}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="link"
                            className="text-danger"
                            onClick={() => open({ kind: 'delete', item: i })}
                          >
                            Delete
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <Modal show onHide={close} centered aria-labelledby="lookup-title">
          <Form onSubmit={submitName} noValidate>
            <Modal.Header closeButton>
              <Modal.Title as="h2" className="h5" id="lookup-title">
                {dialog.kind === 'add' ? `Add ${labels.one}` : `Edit ${labels.one}`}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Form.Group controlId="lookup-name">
                <Form.Label>Name *</Form.Label>
                <Form.Control
                  value={name}
                  maxLength={80}
                  autoFocus
                  isInvalid={Boolean(error)}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError('');
                  }}
                />
                <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
                {dialog.kind === 'edit' && dialog.item.usedBy ? (
                  <Form.Text>
                    Renaming updates the label on all {entries(dialog.item.usedBy)} and in reports.
                  </Form.Text>
                ) : null}
              </Form.Group>
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
        <Modal show onHide={close} centered aria-labelledby="lookup-confirm-title">
          <Modal.Header closeButton>
            <Modal.Title as="h2" className="h5" id="lookup-confirm-title">
              {cap(dialog.kind)} "{dialog.item.name}"?
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <ErrorAlert error={save.error} />
            {dialog.kind === 'deactivate'
              ? `It's used by ${entries(dialog.item.usedBy ?? 0)}, so it can't be deleted. Those entries keep it. It won't be offered for new entries. You can reactivate it later.`
              : "No entries use it. This can't be undone."}
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
                  { onSuccess: close },
                )
              }
            >
              {cap(dialog.kind)}
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </div>
  );
}
