import { TEMPLATE_TYPE_LABELS, TEMPLATE_TYPES, plural, type TemplateType } from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form, Modal, Nav } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, saveErrorMessage } from '../../api/client';
import { useSaveTemplate, useTemplates } from '../../api/projectHooks';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { TemplateStatusBadge } from '../../components/ProjectBadges';
import { shortDate } from '../../lib/format';

const TABS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'DRAFT', label: 'Drafts' },
  { key: 'ARCHIVED', label: 'Archived' },
];

/** Implementation templates (FR-TPL-01..08). */
export function TemplatesPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const canCreate = useCan('templates', 'create');
  // Drafts and archived templates are only shown with Edit on templates (doc 11 §12).
  const canEdit = useCan('templates', 'edit');
  const templates = useTemplates({ status: status || undefined, q: q || undefined });
  const items = templates.data?.items ?? [];

  return (
    <>
      <PageHeader title="Templates">
        {canCreate && <Button onClick={() => setCreating(true)}>+ New template</Button>}
      </PageHeader>
      <div className="card">
        <div className="card-body">
          <div className="d-flex flex-wrap align-items-center gap-3 mb-4">
            <Nav variant="pills" activeKey={status} onSelect={(k) => setStatus(k ?? '')}>
              {(canEdit ? TABS : []).map((t) => (
                <Nav.Item key={t.key}>
                  <Nav.Link eventKey={t.key} as="button">
                    {t.label}
                  </Nav.Link>
                </Nav.Item>
              ))}
            </Nav>
            <Form.Control
              type="search"
              placeholder="Search templates…"
              aria-label="Search templates"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 260 }}
              className="ms-auto"
            />
          </div>
          <ErrorAlert error={templates.error} />
          {templates.isPending ? (
            <LoadingRows />
          ) : items.length === 0 ? (
            <EmptyState
              icon="bx-book-content"
              title={q || status ? 'No templates match' : 'No templates yet'}
            >
              {q || status
                ? 'Try clearing the search or choosing All.'
                : 'Templates hold the phases and activities new projects start from.'}
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-stack-md">
                <thead>
                  <tr>
                    <th scope="col">Template</th>
                    <th scope="col">Type</th>
                    <th scope="col">Version</th>
                    <th scope="col">Activities</th>
                    <th scope="col">Projects</th>
                    <th scope="col">Status</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <td className="text-heading fw-medium cell-primary">
                        <Link to={`/templates/${t.id}`}>{t.name}</Link>
                      </td>
                      <td data-label="Type">{TEMPLATE_TYPE_LABELS[t.type]}</td>
                      <td data-label="Version">
                        v{t.version}
                        {t.draftId && (
                          <Link to={`/templates/${t.draftId}`} className="ms-2 small">
                            Draft v{t.version + 1}
                          </Link>
                        )}
                      </td>
                      <td data-label="Activities">
                        {plural(t.activityCount, 'activity', 'activities')} in{' '}
                        {plural(t.phaseCount, 'phase')}
                      </td>
                      <td data-label="Projects">{t.projectCount}</td>
                      <td data-label="Status">
                        <TemplateStatusBadge status={t.status} />
                      </td>
                      <td data-label="Updated" className="text-nowrap">
                        {shortDate(t.updatedAt, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {creating && <NewTemplateModal onClose={() => setCreating(false)} />}
    </>
  );
}

function NewTemplateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<TemplateType | ''>('');
  const save = useSaveTemplate();
  const navigate = useNavigate();
  const fieldErrors = save.error instanceof ApiError ? save.error.fieldErrors() : {};

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { body: { name, type: type as TemplateType } },
      { onSuccess: (t) => navigate(`/templates/${t.id}`) },
    );
  };

  return (
    <Modal show onHide={onClose} centered>
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5">
            New template
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {save.error && !Object.keys(fieldErrors).length ? (
            <div className="alert alert-danger">{saveErrorMessage(save.error)}</div>
          ) : null}
          <Form.Group className="mb-3" controlId="tpl-name">
            <Form.Label>Template name</Form.Label>
            <Form.Control
              value={name}
              onChange={(e) => setName(e.target.value)}
              isInvalid={Boolean(fieldErrors.name)}
              autoFocus
            />
            <Form.Control.Feedback type="invalid">{fieldErrors.name}</Form.Control.Feedback>
          </Form.Group>
          <Form.Group controlId="tpl-type">
            <Form.Label>Type</Form.Label>
            <Form.Select
              value={type}
              onChange={(e) => setType(e.target.value as TemplateType)}
              isInvalid={Boolean(fieldErrors.type)}
            >
              <option value="">Choose…</option>
              {TEMPLATE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TEMPLATE_TYPE_LABELS[t]}
                </option>
              ))}
            </Form.Select>
            <Form.Control.Feedback type="invalid">{fieldErrors.type}</Form.Control.Feedback>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Create draft
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
