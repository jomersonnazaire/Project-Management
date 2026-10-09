import { zodResolver } from '@hookform/resolvers/zod';
import { contactSchema, type ContactDto, type ContactInput } from '@xc8/shared';
import { useState } from 'react';
import { Button, Dropdown, Form, Modal, Nav } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useClients, useContactActive, useContacts, useSaveContact } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { useCan } from '../auth/useCan';
import { ActiveBadge, PendingBadge } from '../components/Badges';
import { EmptyState, ErrorAlert, LoadingRows, LockNotice } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';
import { ClientsPanel } from './admin/ClientsPanel';

const NO_LOGIN_NOTICE =
  "Client contacts are stored separately from user accounts and can't sign in. Tagging one on a task never grants access.";

function ContactModal({
  contact,
  defaultClientId,
  onClose,
}: {
  contact: ContactDto | null;
  defaultClientId?: string;
  onClose: () => void;
}) {
  const save = useSaveContact();
  const clients = useClients();
  const [clientId, setClientId] = useState(contact?.clientId ?? defaultClientId ?? '');
  const [clientError, setClientError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: contact?.name ?? '',
      department: contact?.department ?? '',
      position: contact?.position ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      notes: contact?.notes ?? '',
    },
  });
  const onSubmit = handleSubmit(async (body) => {
    if (!clientId) return setClientError('Company is required.');
    try {
      await save.mutateAsync({ id: contact?.id, clientId, body });
      onClose();
    } catch (e) {
      setError('root', { message: e instanceof ApiError ? e.message : 'Could not save.' });
    }
  });
  return (
    <Modal show onHide={onClose} centered>
      <Form noValidate onSubmit={(e) => void onSubmit(e)}>
        <Modal.Header closeButton>
          <Modal.Title as="h5">
            {contact ? `Edit ${contact.name}` : 'New client contact'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="mb-4">
            <LockNotice>
              Client contacts are tracked only. They don&apos;t get a login or app access.
            </LockNotice>
          </div>
          <Form.Group className="mb-3" controlId="contact-name">
            <Form.Label>Name *</Form.Label>
            <Form.Control {...register('name')} isInvalid={!!errors.name} />
            <Form.Control.Feedback type="invalid">{errors.name?.message}</Form.Control.Feedback>
          </Form.Group>
          <Form.Group className="mb-3" controlId="contact-client">
            <Form.Label>Company *</Form.Label>
            <Form.Select
              value={clientId}
              disabled={!!contact}
              isInvalid={!!clientError}
              onChange={(e) => {
                setClientId(e.target.value);
                setClientError(null);
              }}
            >
              <option value="">Choose a client…</option>
              {clients.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Form.Select>
            <Form.Control.Feedback type="invalid">{clientError}</Form.Control.Feedback>
          </Form.Group>
          <div className="row">
            <Form.Group className="mb-3 col-sm-6" controlId="contact-dept">
              <Form.Label>Department</Form.Label>
              <Form.Control {...register('department')} />
            </Form.Group>
            <Form.Group className="mb-3 col-sm-6" controlId="contact-position">
              <Form.Label>Position</Form.Label>
              <Form.Control {...register('position')} />
            </Form.Group>
            <Form.Group className="mb-3 col-sm-6" controlId="contact-email">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" {...register('email')} isInvalid={!!errors.email} />
              <Form.Control.Feedback type="invalid">{errors.email?.message}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="mb-3 col-sm-6" controlId="contact-phone">
              <Form.Label>Phone</Form.Label>
              <Form.Control {...register('phone')} />
            </Form.Group>
          </div>
          <Form.Group controlId="contact-notes">
            <Form.Label>Notes</Form.Label>
            <Form.Control as="textarea" rows={2} {...register('notes')} />
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

function ContactsList() {
  const { user } = useAuth();
  const canManage = useCan('clients:manage');
  const [params, setParams] = useSearchParams();
  const clientId = params.get('clientId') ?? '';
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const contacts = useContacts({
    q: q || undefined,
    clientId: clientId || undefined,
    includeInactive,
  });
  const clients = useClients();
  const setActive = useContactActive();
  const [editing, setEditing] = useState<ContactDto | null | undefined>(undefined);
  const memberNote = user?.systemRole === 'MEMBER';

  return (
    <>
      <div className="mb-4">
        <LockNotice>{NO_LOGIN_NOTICE}</LockNotice>
      </div>
      <div className="card">
        <div className="card-body">
          <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
            <Form.Control
              type="search"
              placeholder="Search contacts…"
              aria-label="Search contacts"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 260 }}
            />
            <Form.Select
              aria-label="Filter by client"
              value={clientId}
              style={{ maxWidth: 220 }}
              onChange={(e) => setParams(e.target.value ? { clientId: e.target.value } : {})}
            >
              <option value="">All clients</option>
              {clients.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Form.Select>
            <Form.Check
              type="switch"
              id="contacts-inactive"
              label="Show inactive"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            {canManage && (
              <Button className="ms-auto" onClick={() => setEditing(null)}>
                <i className="bx bx-plus me-1" aria-hidden="true" />
                Contact
              </Button>
            )}
          </div>
          <ErrorAlert error={contacts.error ?? setActive.error} />
          {contacts.isPending ? (
            <LoadingRows />
          ) : contacts.data?.items.length === 0 ? (
            <EmptyState
              icon="bx-phone"
              title={q || clientId ? 'No contacts match' : 'No client contacts yet'}
            >
              {memberNote
                ? 'You will see contacts for clients of the projects you belong to.'
                : q || clientId
                  ? 'Try clearing the search or client filter.'
                  : canManage
                    ? 'Add the people at each client you follow up with.'
                    : 'Contacts will appear here once they are added.'}
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Company</th>
                    <th scope="col">Department</th>
                    <th scope="col">Email</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Pending items</th>
                    <th scope="col">Status</th>
                    {canManage && (
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {contacts.data?.items.map((c) => (
                    <tr key={c.id}>
                      <td className="text-heading">
                        {c.name}
                        {c.position && (
                          <div className="small text-body-secondary">{c.position}</div>
                        )}
                      </td>
                      <td>{c.clientName}</td>
                      <td>{c.department ?? '–'}</td>
                      <td>{c.email ?? '–'}</td>
                      <td className="text-nowrap">{c.phone ?? '–'}</td>
                      <td>
                        <PendingBadge pending={c.pendingCount} overdue={c.overdueCount} />
                      </td>
                      <td>
                        <ActiveBadge active={c.active} />
                      </td>
                      {canManage && (
                        <td className="text-end">
                          <Dropdown align="end">
                            <Dropdown.Toggle
                              variant="link"
                              size="sm"
                              className="hide-arrow p-0 text-body"
                              aria-label={`Actions for ${c.name}`}
                            >
                              <i className="bx bx-dots-vertical-rounded fs-5" aria-hidden="true" />
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                              <Dropdown.Item as="button" onClick={() => setEditing(c)}>
                                Edit
                              </Dropdown.Item>
                              <Dropdown.Item
                                as="button"
                                onClick={() => setActive.mutate({ id: c.id, active: !c.active })}
                              >
                                {c.active ? 'Deactivate' : 'Reactivate'}
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
          )}
        </div>
      </div>
      {editing !== undefined && (
        <ContactModal
          contact={editing}
          defaultClientId={clientId || undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

/** Client contacts screen (FR-CLI-02/05/07, AC-04.1/04.3). */
export function ContactsPage() {
  const [tab, setTab] = useState<'contacts' | 'clients'>('contacts');
  return (
    <>
      <PageHeader title="Client contacts" />
      <Nav
        variant="tabs"
        activeKey={tab}
        onSelect={(k) => setTab(k === 'clients' ? 'clients' : 'contacts')}
        className="mb-6"
      >
        <Nav.Item>
          <Nav.Link eventKey="contacts">Contacts</Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link eventKey="clients">Clients</Nav.Link>
        </Nav.Item>
      </Nav>
      {tab === 'contacts' ? <ContactsList /> : <ClientsPanel />}
    </>
  );
}
