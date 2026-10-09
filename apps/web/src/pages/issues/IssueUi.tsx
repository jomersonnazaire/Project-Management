import {
  ISSUE_CATEGORIES,
  ISSUE_CATEGORY_LABELS,
  ISSUE_OWNER_NEEDED,
  ISSUE_SEVERITIES,
  ISSUE_SEVERITY_HINTS,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STAGES,
  ISSUE_STAGE_LABELS,
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  MAX_ISSUE_TITLE,
  issueDueLabel,
  shortName,
  type IssueCategory,
  type IssueRowDto,
  type IssueSeverity,
  type IssueStage,
  type IssueStatus,
} from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, saveErrorMessage } from '../../api/client';
import { useIssueOptions, useRaiseIssue, type IssueFilters } from '../../api/issueHooks';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';

/** Shared pieces of the Milestone 3.5 issue screens (mockup v0.7 M3.5). */

const SEVERITY_BADGE: Record<IssueSeverity, string> = {
  CRITICAL: 'bg-danger',
  HIGH: 'bg-label-danger',
  MEDIUM: 'bg-label-warning',
  LOW: 'bg-label-secondary',
};
const STATUS_BADGE: Record<IssueStatus, string> = {
  OPEN: 'bg-label-info',
  IN_PROGRESS: 'bg-label-primary',
  WAITING_ON_CLIENT: 'bg-label-warning',
  RESOLVED: 'bg-label-success',
  CLOSED: 'bg-label-secondary',
};

export function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  return (
    <span className={`badge text-uppercase ${SEVERITY_BADGE[severity]}`}>
      {ISSUE_SEVERITY_LABELS[severity]}
    </span>
  );
}

export function IssueStatusBadge({ status }: { status: IssueStatus }) {
  return (
    <span className={`badge text-uppercase ${STATUS_BADGE[status]}`}>
      {ISSUE_STATUS_LABELS[status]}
    </span>
  );
}

export function OwnerCell({ row }: { row: Pick<IssueRowDto, 'owner' | 'ownerNeeded' | 'status'> }) {
  if (row.ownerNeeded) {
    return (
      <span className="text-danger small fw-semibold">
        {row.owner ? `${shortName(row.owner.name)} · ` : ''}
        {ISSUE_OWNER_NEEDED}
      </span>
    );
  }
  return <>{row.owner ? shortName(row.owner.name) : '–'}</>;
}

export function DueCell({ row }: { row: Pick<IssueRowDto, 'dueDate' | 'overdue'> }) {
  return (
    <span className={row.overdue ? 'text-danger fw-semibold' : undefined}>
      {issueDueLabel(row.dueDate, row.overdue)}
    </span>
  );
}

/** Filters row: search, status, severity, owner, stage (+ project/client on All issues). */
export function IssueFilterBar({
  filters,
  onChange,
  owners,
  projects,
  clients,
}: {
  filters: IssueFilters;
  onChange: (f: IssueFilters) => void;
  owners: { id: string; name: string }[];
  projects?: { id: string; name: string }[];
  clients?: { id: string; name: string }[];
}) {
  const set = (k: keyof IssueFilters) => (v: string) =>
    onChange({ ...filters, [k]: v || undefined });
  return (
    <div className="d-flex flex-wrap gap-2 mb-4">
      <Form.Control
        type="search"
        placeholder="Search issues…"
        aria-label="Search issues"
        value={filters.q ?? ''}
        onChange={(e) => set('q')(e.target.value)}
        style={{ maxWidth: 260 }}
        className="me-auto"
      />
      <Form.Select
        aria-label="Status"
        value={filters.status ?? 'OPEN_ALL'}
        onChange={(e) => set('status')(e.target.value === 'OPEN_ALL' ? '' : e.target.value)}
        style={{ width: 'auto' }}
      >
        <option value="OPEN_ALL">Open statuses</option>
        <option value="ALL">All statuses</option>
        {ISSUE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {ISSUE_STATUS_LABELS[s]}
          </option>
        ))}
      </Form.Select>
      <Form.Select
        aria-label="Severity"
        value={filters.severity ?? ''}
        onChange={(e) => set('severity')(e.target.value)}
        style={{ width: 'auto' }}
      >
        <option value="">All severities</option>
        {ISSUE_SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {ISSUE_SEVERITY_LABELS[s]}
          </option>
        ))}
      </Form.Select>
      <Form.Select
        aria-label="Owner"
        value={filters.ownerId ?? ''}
        onChange={(e) => set('ownerId')(e.target.value)}
        style={{ width: 'auto' }}
      >
        <option value="">Any owner</option>
        <option value="none">No owner</option>
        {owners.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Form.Select>
      <Form.Select
        aria-label="Stage"
        value={filters.stage ?? ''}
        onChange={(e) => set('stage')(e.target.value)}
        style={{ width: 'auto' }}
      >
        <option value="">Before &amp; after go-live</option>
        {ISSUE_STAGES.map((s) => (
          <option key={s} value={s}>
            {ISSUE_STAGE_LABELS[s]}
          </option>
        ))}
      </Form.Select>
      {projects && (
        <Form.Select
          aria-label="Project"
          value={filters.projectId ?? ''}
          onChange={(e) => set('projectId')(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Form.Select>
      )}
      {clients && (
        <Form.Select
          aria-label="Client"
          value={filters.clientId ?? ''}
          onChange={(e) => set('clientId')(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Form.Select>
      )}
    </div>
  );
}

/** Issue table: Critical rows carry a red edge, overdue dates are red (mockup v7-issues). */
export function IssuesTable({
  items,
  loading,
  error,
  showProject = false,
  emptyText,
  note,
}: {
  items: IssueRowDto[];
  loading: boolean;
  error: unknown;
  showProject?: boolean;
  emptyText: string;
  note: string;
}) {
  if (loading) return <LoadingRows rows={4} />;
  return (
    <>
      <ErrorAlert error={error} />
      {items.length === 0 ? (
        <EmptyState icon="bx-flag" title="No issues raised">
          {emptyText}
        </EmptyState>
      ) : (
        <div className="table-responsive">
          <table className="table table-stack-md issues-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                {showProject && <th scope="col">Project</th>}
                <th scope="col">Title</th>
                <th scope="col">Stage</th>
                <th scope="col">Severity</th>
                <th scope="col">Status</th>
                <th scope="col">Owner</th>
                <th scope="col">Client contact</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={i.id}
                  className={i.severity === 'CRITICAL' ? 'issue-critical' : undefined}
                  data-testid={`issue-row-${i.key}`}
                >
                  <td className="cell-primary text-nowrap">
                    <Link to={`/issues/${i.id}`} className="font-monospace">
                      {i.key}
                    </Link>
                  </td>
                  {showProject && <td data-label="Project">{i.project.name}</td>}
                  <td data-label="Title">
                    <Link to={`/issues/${i.id}`} className="fw-semibold text-heading">
                      {i.title}
                    </Link>
                  </td>
                  <td data-label="Stage" className="small text-body-secondary">
                    {ISSUE_STAGE_LABELS[i.stage]}
                  </td>
                  <td data-label="Severity">
                    <SeverityBadge severity={i.severity} />
                  </td>
                  <td data-label="Status">
                    <IssueStatusBadge status={i.status} />
                  </td>
                  <td data-label="Owner">
                    <OwnerCell row={i} />
                  </td>
                  <td data-label="Client contact">{i.contact ? shortName(i.contact.name) : '–'}</td>
                  <td data-label="Due" className="text-nowrap">
                    <DueCell row={i} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small text-body-secondary mb-0 mt-2">{note}</p>
    </>
  );
}

/** Raise issue (FR-ISS-01..03, AC-42.1): title, description, severity, stage required. */
export function RaiseIssueModal({
  projectId,
  taskId,
  onClose,
}: {
  projectId: string;
  taskId?: string;
  onClose: () => void;
}) {
  const options = useIssueOptions(projectId);
  const raise = useRaiseIssue(projectId);
  const navigate = useNavigate();
  const o = options.data;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<IssueSeverity | ''>('');
  const [stage, setStage] = useState<IssueStage | ''>('');
  const [category, setCategory] = useState<IssueCategory>('OTHER');
  const [ownerId, setOwnerId] = useState('');
  const [contactId, setContactId] = useState('');
  const [taskIds, setTaskIds] = useState<string[]>(taskId ? [taskId] : []);
  const [submitted, setSubmitted] = useState(false);
  const stageValue = stage || o?.defaultStage || '';
  const errors: Record<string, string> = {};
  if (!title.trim()) errors.title = 'Title is required.';
  if (!description.trim()) errors.description = 'Description is required.';
  if (!severity) errors.severity = 'Choose a severity.';
  if (!stageValue) errors.stage = 'Choose a stage.';
  const server = raise.error instanceof ApiError ? raise.error.fieldErrors() : {};
  const show = (k: string) => (submitted ? (errors[k] ?? server[k]) : server[k]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    raise.mutate(
      {
        title: title.trim(),
        description: description.trim(),
        severity: severity as IssueSeverity,
        stage: stageValue as IssueStage,
        category,
        ownerId: ownerId || null,
        reportedByContactId: contactId || null,
        taskIds,
      },
      {
        onSuccess: (issue) => {
          onClose();
          navigate(`/issues/${issue.id}`);
        },
      },
    );
  };

  return (
    <Modal show onHide={onClose} size="lg" aria-labelledby="raise-issue-title">
      <Form noValidate onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title id="raise-issue-title">Raise issue</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={options.error} />
          {raise.error && !Object.keys(server).length && (
            <Alert variant="danger">{saveErrorMessage(raise.error)}</Alert>
          )}
          <div className="row g-3">
            <Form.Group className="col-12" controlId="issue-title">
              <Form.Label>Title</Form.Label>
              <Form.Control
                value={title}
                maxLength={MAX_ISSUE_TITLE}
                onChange={(e) => setTitle(e.target.value)}
                isInvalid={Boolean(show('title'))}
              />
              <Form.Control.Feedback type="invalid">{show('title')}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="col-12" controlId="issue-description">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                isInvalid={Boolean(show('description'))}
              />
              <Form.Control.Feedback type="invalid">{show('description')}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="col-md-6" controlId="issue-severity">
              <Form.Label>Severity</Form.Label>
              <Form.Select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
                isInvalid={Boolean(show('severity'))}
              >
                <option value="">Choose…</option>
                {ISSUE_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {ISSUE_SEVERITY_LABELS[s]} – {ISSUE_SEVERITY_HINTS[s]}
                  </option>
                ))}
              </Form.Select>
              <Form.Control.Feedback type="invalid">{show('severity')}</Form.Control.Feedback>
              {severity && o && (
                <Form.Text>
                  Due {issueDueLabel(o.defaultDue[severity], false)} by default.
                </Form.Text>
              )}
            </Form.Group>
            <Form.Group className="col-md-6" controlId="issue-stage">
              <Form.Label>Stage</Form.Label>
              <Form.Select
                value={stageValue}
                onChange={(e) => setStage(e.target.value as IssueStage)}
                isInvalid={Boolean(show('stage'))}
              >
                <option value="">Choose…</option>
                {ISSUE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {ISSUE_STAGE_LABELS[s]}
                  </option>
                ))}
              </Form.Select>
              <Form.Control.Feedback type="invalid">{show('stage')}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="col-md-6" controlId="issue-category">
              <Form.Label>Category</Form.Label>
              <Form.Select
                value={category}
                onChange={(e) => setCategory(e.target.value as IssueCategory)}
              >
                {ISSUE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ISSUE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-6" controlId="issue-owner">
              <Form.Label>Owner</Form.Label>
              <Form.Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">No owner yet</option>
                {(o?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-6" controlId="issue-contact">
              <Form.Label>Reported by (client contact)</Form.Label>
              <Form.Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">Raised internally</option>
                {(o?.contacts ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-6" controlId="issue-task">
              <Form.Label>Linked task</Form.Label>
              <Form.Select
                value={taskIds[0] ?? ''}
                onChange={(e) => setTaskIds(e.target.value ? [e.target.value] : [])}
              >
                <option value="">None</option>
                {(o?.tasks ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.phase ? `${t.phase} – ` : ''}
                    {t.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={raise.isPending}>
            Raise issue
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
