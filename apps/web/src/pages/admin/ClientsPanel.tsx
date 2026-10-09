import { zodResolver } from '@hookform/resolvers/zod';
import { clientSchema, type ClientDto, type ClientInput } from '@xc8/shared';
import { useState } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useClientActive, useClients, useSaveClient } from '../../api/hooks';
import { useCan } from '../../auth/useCan';
import { ActiveBadge } from '../../components/Badges';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';

function ClientModal({ client, onClose }: { client: ClientDto | null; onClose: () => void }) {
  const save = useSaveClient();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name ?? '',
      industry: client?.industry ?? '',
      address: client?.address ?? '',
      notes: client?.notes ?? '',
    },
  });
  const onSubmit = handleSubmit(async (body) => {
    try {
      await save.mutateAsync({ id: client?.id, body });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'CLIENT_NAME_IN_USE' ? 'name' : 'root', {
        message: e instanceof ApiError ? e.message : 'Could not save.',
      });
    }
  });
  return (
    <Modal show onHide={onClose} centered>
      <Form noValidate onSubmit={(e) => void onSubmit(e)}>
        <Modal.Header closeButton>
          <Modal.Title as="h5">{client ? `Edit ${client.name}` : 'New client'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3" controlId="client-name">
            <Form.Label>Company name *</Form.Label>
            <Form.Control {...register('name')} isInvalid={!!errors.name} />
            <Form.Control.Feedback type="invalid">{errors.name?.message}</Form.Control.Feedback>
          </Form.Group>
          <Form.Group className="mb-3" controlId="client-industry">
            <Form.Label>Industry</Form.Label>
            <Form.Control {...register('industry')} />
          </Form.Group>
          <Form.Group className="mb-3" controlId="client-address">
            <Form.Label>Address</Form.Label>
            <Form.Control {...register('address')} />
          </Form.Group>
          <Form.Group controlId="client-notes">
            <Form.Label>Notes</Form.Label>
            <Form.Control as="textarea" rows={3} {...register('notes')} />
          </Form.Group>
          {errors.root && <div className="text-danger small mt-2">{errors.root.message}</div>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

/** Client companies (FR-CLI-01). Admin and PM manage; Viewer reads. */
export function ClientsPanel() {
  const canManage = useCan('clients:manage');
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const clients = useClients({ q: q || undefined, includeInactive });
  const setActive = useClientActive();
  const [editing, setEditing] = useState<ClientDto | null | undefined>(undefined);

  return (
    <div className="card">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
          <Form.Control
            type="search"
            placeholder="Search clients…"
            aria-label="Search clients"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <Form.Check
            type="switch"
            id="clients-inactive"
            label="Show inactive"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          {canManage && (
            <Button className="ms-auto" onClick={() => setEditing(null)}>
              <i className="bx bx-plus me-1" aria-hidden="true" />
              Client
            </Button>
          )}
        </div>
        <ErrorAlert error={clients.error ?? setActive.error} />
        {clients.isPending ? (
          <LoadingRows />
        ) : clients.data?.items.length === 0 ? (
          <EmptyState
            icon="bx-buildings"
            title={q ? 'No clients match' : 'No clients yet'}
            action={
              canManage && !q ? (
                <Button onClick={() => setEditing(null)}>+ Client</Button>
              ) : undefined
            }
          >
            {q
              ? 'Try a different search or show inactive clients.'
              : canManage
                ? 'Add your first client company.'
                : 'Clients you can see will appear here.'}
          </EmptyState>
        ) : (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col">Industry</th>
                  <th scope="col">Active contacts</th>
                  <th scope="col">Status</th>
                  {canManage && (
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {clients.data?.items.map((c) => (
                  <tr key={c.id}>
                    <td className="text-heading">{c.name}</td>
                    <td>{c.industry ?? '–'}</td>
                    <td>
                      <Link to={`/contacts?clientId=${c.id}`}>{c.contactCount}</Link>
                    </td>
                    <td>
                      <ActiveBadge active={c.active} />
                    </td>
                    {canManage && (
                      <td className="text-end text-nowrap">
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          className="me-2"
                          onClick={() => setEditing(c)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => setActive.mutate({ id: c.id, active: !c.active })}
                        >
                          {c.active ? 'Deactivate' : 'Reactivate'}
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
      {editing !== undefined && (
        <ClientModal client={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}
