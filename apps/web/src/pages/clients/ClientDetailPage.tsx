import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type ClientDto,
  type ContactDto,
} from '@xc8/shared';
import { useState } from 'react';
import { Button, Dropdown, Form } from 'react-bootstrap';
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import {
  useClient,
  useClientActive,
  useClientContacts,
  useClientProjects,
  useContactActive,
} from '../../api/hooks';
import { useCan } from '../../auth/useCan';
import { ActiveBadge } from '../../components/Badges';
import { EmptyState, ErrorAlert, LoadingRows, LockNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { NotFoundPage } from '../ErrorPages';
import { ClientModal } from './ClientModal';
import { ContactModal } from './ContactModal';

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '–';

const STATUS_VARIANT: Record<string, string> = {
  ACTIVE: 'info',
  DELAYED: 'danger',
  ON_HOLD: 'warning',
  COMPLETED: 'success',
};

/** Client detail with Details, Contacts and Projects tabs (FR-CLI-09, FR-CLI-11). */
export function ClientDetailPage() {
  const { id = '' } = useParams();
  const client = useClient(id);
  const canEditClient = useCan('clients', 'edit');
  const canAddContact = useCan('contacts', 'create');
  const canSeeContacts = useCan('contacts', 'view');
  const canSeeProjects = useCan('projects', 'view');
  const [editingClient, setEditingClient] = useState(false);
  const [contactModal, setContactModal] = useState<ContactDto | null | undefined>(undefined);

  if (client.isPending) return <LoadingRows />;
  if (client.error) {
    if (client.error instanceof ApiError && client.error.status === 404) return <NotFoundPage />;
    return <ErrorAlert error={client.error} />;
  }
  const c = client.data;
  const base = `/clients/${c.id}`;
  const tabs = [
    { to: base, label: 'Details', end: true, show: true },
    { to: `${base}/contacts`, label: 'Contacts', count: c.contactCount, show: canSeeContacts },
    { to: `${base}/projects`, label: 'Projects', count: c.projectCount ?? 0, show: canSeeProjects },
  ];

  return (
    <>
      <PageHeader title={c.name} badge={<ActiveBadge active={c.active} />}>
        {canEditClient && (
          <Button variant="outline-secondary" onClick={() => setEditingClient(true)}>
            Edit client
          </Button>
        )}
        <Routes>
          <Route
            path="contacts"
            element={
              canAddContact && canSeeContacts ? (
                <Button onClick={() => setContactModal(null)}>+ Add contact</Button>
              ) : null
            }
          />
          <Route path="*" element={null} />
        </Routes>
      </PageHeader>
      <nav aria-label="Breadcrumb" className="small mb-3">
        <Link to="/clients">Clients</Link> <span aria-hidden="true">›</span> {c.name}
      </nav>
      <ul className="nav nav-tabs nav-scrollable mb-6">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <li className="nav-item" key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className="badge rounded-pill bg-label-secondary ms-2">{t.count}</span>
                )}
              </NavLink>
            </li>
          ))}
      </ul>
      <Routes>
        <Route index element={<DetailsTab client={c} />} />
        <Route
          path="contacts"
          element={
            canSeeContacts ? (
              <ContactsTab
                client={c}
                onAdd={() => setContactModal(null)}
                onEdit={setContactModal}
              />
            ) : (
              <NotFoundPage />
            )
          }
        />
        <Route
          path="projects"
          element={canSeeProjects ? <ProjectsTab client={c} /> : <NotFoundPage />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      {editingClient && <ClientModal client={c} onClose={() => setEditingClient(false)} />}
      {contactModal !== undefined && (
        <ContactModal
          clientId={c.id}
          clientName={c.name}
          contact={contactModal}
          onClose={() => setContactModal(undefined)}
        />
      )}
    </>
  );
}

function DetailsTab({ client }: { client: ClientDto }) {
  const canDelete = useCan('clients', 'delete');
  const setActive = useClientActive();
  const rows: [string, string][] = [
    ['Company name', client.name],
    ['Industry', client.industry ?? '–'],
    ['Address', client.address ?? '–'],
    ['Notes', client.notes ?? '–'],
  ];
  return (
    <div className="card">
      <div className="card-body">
        <ErrorAlert error={setActive.error} action />
        <dl className="row mb-0">
          {rows.map(([k, v]) => (
            <div className="col-12 d-flex flex-wrap border-bottom py-2" key={k}>
              <dt className="col-sm-3 fw-medium text-heading">{k}</dt>
              <dd className="col-sm-9 mb-0 text-break">{v}</dd>
            </div>
          ))}
          <div className="col-12 d-flex flex-wrap py-2">
            <dt className="col-sm-3 fw-medium text-heading">Status</dt>
            <dd className="col-sm-9 mb-0">
              <ActiveBadge active={client.active} />
            </dd>
          </div>
        </dl>
        {canDelete && (
          <Button
            variant="outline-secondary"
            className="mt-3"
            onClick={() => setActive.mutate({ id: client.id, active: !client.active })}
          >
            {client.active ? 'Deactivate client' : 'Reactivate client'}
          </Button>
        )}
      </div>
    </div>
  );
}

type ContactStatus = 'ACTIVE' | 'INACTIVE' | 'ALL';

function ContactsTab({
  client,
  onAdd,
  onEdit,
}: {
  client: ClientDto;
  onAdd: () => void;
  onEdit: (c: ContactDto) => void;
}) {
  const canCreate = useCan('contacts', 'create');
  const canEdit = useCan('contacts', 'edit');
  const canDelete = useCan('contacts', 'delete');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ContactStatus>('ACTIVE');
  const contacts = useClientContacts(client.id, { q: q || undefined, status });
  const setActive = useContactActive();
  const hasMenu = canEdit || canDelete;
  const filtered = Boolean(q) || status !== 'ACTIVE';

  return (
    <>
      <div className="mb-4">
        <LockNotice>
          Client contacts are tracked only. They don&apos;t get a login or app access.
        </LockNotice>
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
              aria-label="Contact status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ContactStatus)}
              style={{ maxWidth: 160 }}
              className="ms-auto"
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="ALL">All</option>
            </Form.Select>
          </div>
          <ErrorAlert error={contacts.error} />
          <ErrorAlert error={setActive.error} action />
          {contacts.isPending ? (
            <LoadingRows />
          ) : contacts.data?.items.length === 0 ? (
            filtered ? (
              <EmptyState icon="bx-phone" title="No contacts match">
                Try clearing the search or choosing All.
              </EmptyState>
            ) : (
              <EmptyState
                icon="bx-phone"
                title="No contacts yet"
                action={canCreate ? <Button onClick={onAdd}>+ Add contact</Button> : undefined}
              >
                Add the people at this client your team follows up with.
              </EmptyState>
            )
          ) : (
            <div className="table-responsive">
              <table className="table table-stack-md">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Position</th>
                    <th scope="col">Email</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Status</th>
                    {hasMenu && (
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {contacts.data?.items.map((ct) => (
                    <tr key={ct.id}>
                      <td className="text-heading fw-medium cell-primary">
                        {ct.name}
                        {ct.department && (
                          <div className="small text-body-secondary fw-normal">{ct.department}</div>
                        )}
                      </td>
                      <td data-label="Position">{ct.position ?? '–'}</td>
                      <td data-label="Email" className="text-break">
                        {ct.email ?? '–'}
                      </td>
                      <td data-label="Phone" className="text-nowrap">
                        {ct.phone ?? '–'}
                      </td>
                      <td data-label="Status">
                        <ActiveBadge active={ct.active} />
                      </td>
                      {hasMenu && (
                        <td className="text-end cell-actions">
                          <Dropdown align="end">
                            <Dropdown.Toggle
                              variant="link"
                              size="sm"
                              className="hide-arrow p-0 text-body"
                              aria-label={`Actions for ${ct.name}`}
                            >
                              <i className="bx bx-dots-vertical-rounded fs-5" aria-hidden="true" />
                            </Dropdown.Toggle>
                            <Dropdown.Menu>
                              {canEdit && (
                                <Dropdown.Item as="button" onClick={() => onEdit(ct)}>
                                  Edit
                                </Dropdown.Item>
                              )}
                              {canDelete && (
                                <Dropdown.Item
                                  as="button"
                                  onClick={() =>
                                    setActive.mutate({ id: ct.id, active: !ct.active })
                                  }
                                >
                                  {ct.active ? 'Deactivate' : 'Reactivate'}
                                </Dropdown.Item>
                              )}
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
          <p className="small text-body-secondary mb-0 mt-3">
            Deactivated contacts stay on past projects, marked Inactive.
          </p>
        </div>
      </div>
    </>
  );
}

function ProjectsTab({ client }: { client: ClientDto }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const projects = useClientProjects(client.id, { q: q || undefined, status: status || undefined });
  const filtered = Boolean(q) || Boolean(status);

  return (
    <div className="card">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
          <Form.Control
            type="search"
            placeholder="Search projects…"
            aria-label="Search projects"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <Form.Select
            aria-label="Project status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ maxWidth: 180 }}
            className="ms-auto"
          >
            <option value="">All statuses</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </option>
            ))}
            <option value="ARCHIVED">Archived</option>
          </Form.Select>
        </div>
        <ErrorAlert error={projects.error} />
        {projects.isPending ? (
          <LoadingRows />
        ) : projects.data?.items.length === 0 ? (
          filtered ? (
            <EmptyState icon="bx-briefcase" title="No projects match">
              Try clearing the search or status filter.
            </EmptyState>
          ) : (
            <EmptyState icon="bx-briefcase" title="No projects yet">
              Projects linked to this client will show here.
            </EmptyState>
          )
        ) : (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Project manager</th>
                  <th scope="col">Start</th>
                  <th scope="col">Planned end</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {projects.data?.items.map((p) => (
                  <tr key={p.id}>
                    <td className="text-heading fw-medium">{p.name}</td>
                    <td>{p.managerName ?? '–'}</td>
                    <td>{shortDate(p.startDate)}</td>
                    <td>{shortDate(p.plannedEndDate)}</td>
                    <td style={{ minWidth: 120 }}>
                      <div
                        className="progress"
                        style={{ height: 8 }}
                        role="progressbar"
                        aria-label={`${p.name} progress`}
                        aria-valuenow={p.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div className="progress-bar" style={{ width: `${p.progress}%` }} />
                      </div>
                      <span className="small text-body-secondary">{p.progress}%</span>
                    </td>
                    <td>
                      <span
                        className={`badge bg-label-${p.archived ? 'secondary' : STATUS_VARIANT[p.status]} text-uppercase`}
                      >
                        {p.archived ? 'Archived' : PROJECT_STATUS_LABELS[p.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small text-body-secondary mb-0 mt-3">
          Read-only list. Archived projects are hidden unless you pick Archived.
        </p>
      </div>
    </div>
  );
}
