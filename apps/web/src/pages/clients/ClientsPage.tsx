import { clientImportToast, plural, type ClientDto, type ClientImportCommitDto } from '@xc8/shared';
import { useState } from 'react';
import { Button, Dropdown, Form } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { downloadClientTemplate, useClientActive, useClients } from '../../api/hooks';
import { useCan } from '../../auth/useCan';
import { ActiveBadge } from '../../components/Badges';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { ClientImportModal } from './ClientImportModal';
import { ClientModal } from './ClientModal';
import { downloadSkippedRows } from './skippedRows';

/** Clients list (FR-CLI-01). Each client opens its Details / Contacts / Projects tabs. */
export function ClientsPage() {
  const canCreate = useCan('clients', 'create');
  const canEdit = useCan('clients', 'edit');
  const canDelete = useCan('clients', 'delete');
  // CR-19 (FR-CLI-23/24, Q-111): Excel needs create AND edit on BOTH clients and contacts.
  const canCreateContact = useCan('contacts', 'create');
  const canEditContact = useCan('contacts', 'edit');
  const canImport = canCreate && canEdit && canCreateContact && canEditContact;
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<ClientImportCommitDto | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const clients = useClients({ q: q || undefined, includeInactive });
  const setActive = useClientActive();
  const [editing, setEditing] = useState<ClientDto | null | undefined>(undefined);
  const hasActions = canEdit || canDelete;

  return (
    <>
      <PageHeader title="Clients">
        {canImport && (
          <Dropdown className="me-2">
            <Dropdown.Toggle variant="outline-primary" id="clients-excel">
              <i className="bx bx-spreadsheet me-1" aria-hidden="true" />
              Excel
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.Item
                as="button"
                onClick={() => {
                  setExcelError(null);
                  downloadClientTemplate().catch((e: unknown) =>
                    setExcelError(e instanceof Error ? e.message : 'Could not download.'),
                  );
                }}
              >
                <i className="bx bx-download me-2" aria-hidden="true" />
                Download template
              </Dropdown.Item>
              <Dropdown.Item as="button" onClick={() => setImporting(true)}>
                <i className="bx bx-upload me-2" aria-hidden="true" />
                Import from Excel
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        )}
        {canCreate && (
          <Button onClick={() => setEditing(null)}>
            <i className="bx bx-plus me-1" aria-hidden="true" />
            New client
          </Button>
        )}
      </PageHeader>
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
          </div>
          {imported && (
            <div
              className="alert alert-success py-2 d-flex flex-wrap align-items-center gap-2"
              role="status"
            >
              <span>{clientImportToast(imported.applied)}</span>
              {imported.applied.skipped > 0 && (
                <Button
                  variant="link"
                  className="p-0 align-baseline"
                  onClick={() => void downloadSkippedRows(imported)}
                >
                  Download skipped rows (.xlsx)
                </Button>
              )}
              <button
                type="button"
                className="btn-close ms-auto"
                aria-label="Dismiss"
                onClick={() => setImported(null)}
              />
            </div>
          )}
          {excelError && (
            <div className="alert alert-danger py-2" role="alert">
              {excelError}
            </div>
          )}
          <ErrorAlert error={clients.error} />
          <ErrorAlert error={setActive.error} action />
          {clients.isPending ? (
            <LoadingRows />
          ) : clients.data?.items.length === 0 ? (
            <EmptyState
              icon="bx-buildings"
              title={q ? 'No clients match' : 'No clients yet'}
              action={
                canCreate && !q ? (
                  <Button onClick={() => setEditing(null)}>+ New client</Button>
                ) : undefined
              }
            >
              {q
                ? 'Try a different search or show inactive clients.'
                : canCreate
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
                    <th scope="col">Projects</th>
                    <th scope="col">Status</th>
                    {hasActions && (
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {clients.data?.items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/clients/${c.id}`} className="fw-medium">
                          {c.name}
                        </Link>
                      </td>
                      <td>{c.industry ?? '–'}</td>
                      <td>
                        <Link
                          to={`/clients/${c.id}/contacts`}
                          aria-label={`${plural(c.contactCount, 'contact')} at ${c.name}`}
                        >
                          {c.contactCount}
                        </Link>
                      </td>
                      <td>{c.projectCount ?? 0}</td>
                      <td>
                        <ActiveBadge active={c.active} />
                      </td>
                      {hasActions && (
                        <td className="text-end text-nowrap">
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              className="me-2"
                              onClick={() => setEditing(c)}
                            >
                              Edit
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => setActive.mutate({ id: c.id, active: !c.active })}
                            >
                              {c.active ? 'Deactivate' : 'Reactivate'}
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
      </div>
      {importing && (
        <ClientImportModal
          onClose={() => setImporting(false)}
          onImported={(result) => {
            setImporting(false);
            setImported(result);
          }}
        />
      )}
      {editing !== undefined && (
        <ClientModal client={editing} onClose={() => setEditing(undefined)} />
      )}
    </>
  );
}
