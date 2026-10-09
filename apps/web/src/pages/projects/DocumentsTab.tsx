import {
  CLIENT_CONTACT_NOTICE,
  DOCUMENT_ACCEPT,
  DOCUMENT_FILTER_STATES,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPES_LABEL,
  checkFileRules,
  formatBytes,
  partyLabel,
  shortName,
  type DocumentDto,
  type DocumentState,
  type DocumentStatus,
  type FolderDto,
  type ProjectDto,
  type TaskDto,
  type UploadTicketDto,
} from '@xc8/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button, Form, Modal, Nav, ProgressBar } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../api/client';
import {
  completeUpload,
  fileMeta,
  openDownload,
  putFile,
  useDocumentMutation,
  useDocuments,
  useFolders,
  useRequestParties,
} from '../../api/m3Hooks';
import { EmptyState, ErrorAlert, LoadingRows, LockNotice } from '../../components/Feedback';
import { ReasonModal } from '../../components/ReasonModal';
import { dateTime, shortDate } from '../../lib/format';
import { FileChip } from './EvidenceSection';
import { FolderAccessModal, RequestModal } from './DocumentRequestModals';

const STATUS_BADGE: Record<DocumentState, string> = {
  REQUESTED: 'bg-label-warning',
  SUBMITTED: 'bg-label-info',
  SIGNED: 'bg-label-success',
  CANCELLED: 'bg-label-secondary',
};

const EVENT_LABELS: Record<string, string> = {
  REQUESTED: 'Requested',
  CANCELLED: 'Cancelled',
  SUBMITTED: 'Submitted',
  SIGNED: 'Signed',
  UPDATED: 'Updated',
  UNLINKED_FROM_TASK: 'Removed from its task',
  ARCHIVED: 'Archived',
  RESTORED: 'Restored',
};

function UploadModal({
  project,
  folders,
  folderId,
  tasks,
  existing,
  fulfils,
  onClose,
}: {
  project: ProjectDto;
  folders: FolderDto[];
  folderId: string;
  tasks: TaskDto[];
  existing: DocumentDto[];
  /** Pre-selected request (the document panel's "Upload file" on a Requested document). */
  fulfils?: DocumentDto | null;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    folderId: fulfils?.folderId ?? folderId,
    status: 'SUBMITTED' as DocumentStatus,
    taskId: '',
    onDuplicate: 'NEW_VERSION' as 'NEW_VERSION' | 'KEEP_BOTH',
    note: '',
    fulfilsDocumentId: fulfils?.id ?? '',
    signedByContactId: '',
  });
  // FR-DOC-21: any open request in the project can be fulfilled; FR-DOC-25: signed by a contact.
  const requests = useDocuments(project.id, { status: 'REQUESTED' });
  const parties = useRequestParties(project.id);
  const openRequests = requests.data?.items ?? (fulfils ? [fulfils] : []);
  const chosen = openRequests.find((d) => d.id === form.fulfilsDocumentId) ?? null;
  const [error, setError] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const dup =
    file &&
    !form.fulfilsDocumentId &&
    existing.some(
      (d) => d.name.toLowerCase() === file.name.toLowerCase() && d.folderId === form.folderId,
    );

  const pick = (f: File | undefined) => {
    if (!f) return;
    const issue = checkFileRules({ name: f.name, size: f.size }, 'DOCUMENT');
    setError(issue?.message ?? '');
    setFile(issue ? null : f);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError('Choose a file to upload.');
    setError('');
    try {
      setPct(0);
      const { upload } = await api<{ upload: UploadTicketDto }>(
        `/projects/${project.id}/documents/uploads`,
        {
          method: 'POST',
          body: {
            folderId: form.folderId,
            file: fileMeta(file),
            status: form.status,
            onDuplicate: form.onDuplicate,
            taskId: form.taskId || null,
            ...(form.note.trim() ? { note: form.note.trim() } : {}),
            ...(form.fulfilsDocumentId ? { fulfilsDocumentId: form.fulfilsDocumentId } : {}),
            ...(form.status === 'SIGNED' && form.signedByContactId
              ? { signedByContactId: form.signedByContactId }
              : {}),
          },
        },
      );
      await putFile(upload, file, setPct);
      await completeUpload(upload.id);
      onClose();
    } catch (err) {
      setPct(null);
      setError(
        err instanceof ApiError ? err.message : `${file.name} couldn't be uploaded. Try again.`,
      );
    }
  };

  return (
    <Modal show onHide={onClose} centered aria-labelledby="upload-title">
      <Form onSubmit={(e) => void submit(e)} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5" id="upload-title">
            Upload document
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div
            className={`drop-zone mb-3 ${over ? 'is-over' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="Choose a file"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                input.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              pick(e.dataTransfer.files[0]);
            }}
          >
            {file ? (
              <>
                <strong>{file.name}</strong> · {formatBytes(file.size)}
              </>
            ) : (
              <>
                Drag files here or <span className="text-primary">browse</span>
              </>
            )}
            <div className="small text-body-secondary">{DOCUMENT_TYPES_LABEL}</div>
            <input
              ref={input}
              type="file"
              hidden
              accept={DOCUMENT_ACCEPT}
              data-testid="document-input"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {error && (
            <div className="small text-danger mb-3" role="alert">
              ⚠ {error}
            </div>
          )}
          {pct !== null && (
            <div className="mb-3">
              <ProgressBar now={pct} style={{ height: 6 }} aria-label="Upload progress" />
              <small className="text-body-secondary">
                {pct < 100 ? `Uploading… ${pct}%` : 'Checking the file…'}
              </small>
            </div>
          )}
          <div className="row g-3">
            <Form.Group className="col-sm-6" controlId="doc-folder">
              <Form.Label>Folder</Form.Label>
              <Form.Select
                value={chosen ? chosen.folderId : form.folderId}
                disabled={Boolean(chosen)}
                onChange={(e) => setForm({ ...form, folderId: e.target.value })}
              >
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {'\u00a0\u00a0'.repeat(f.depth)}
                    {f.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-sm-6" controlId="doc-status">
              <Form.Label>Status</Form.Label>
              <Form.Select
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as DocumentStatus,
                    signedByContactId: '',
                  })
                }
              >
                {DOCUMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DOCUMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-12" controlId="doc-fulfils">
              <Form.Label>Fulfils request</Form.Label>
              <Form.Select
                value={form.fulfilsDocumentId}
                onChange={(e) => setForm({ ...form, fulfilsDocumentId: e.target.value })}
              >
                <option value="">None (a new document)</option>
                {openRequests.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.request?.requestedFrom ? ` · ${d.request.requestedFrom.name}` : ''}
                  </option>
                ))}
              </Form.Select>
              {chosen && <Form.Text>The file is added to {chosen.name} as version 1.</Form.Text>}
            </Form.Group>
            {form.status === 'SIGNED' && (
              <Form.Group className="col-12" controlId="doc-signed-by">
                <Form.Label>Signed by</Form.Label>
                <Form.Select
                  value={form.signedByContactId}
                  onChange={(e) => setForm({ ...form, signedByContactId: e.target.value })}
                >
                  <option value="">Our team</option>
                  {(parties.data?.contacts ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {partyLabel(c)} (client contact)
                    </option>
                  ))}
                </Form.Select>
                <Form.Text>
                  For a client signature, you're recorded as the person who uploaded it.
                </Form.Text>
              </Form.Group>
            )}
            <Form.Group className="col-12" controlId="doc-task">
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
            {dup && (
              <Form.Group className="col-12">
                <Form.Label>A document with this name is already in the folder</Form.Label>
                <Form.Check
                  type="radio"
                  id="dup-version"
                  label="Add it as a new version"
                  checked={form.onDuplicate === 'NEW_VERSION'}
                  onChange={() => setForm({ ...form, onDuplicate: 'NEW_VERSION' })}
                />
                <Form.Check
                  type="radio"
                  id="dup-both"
                  label="Keep both (saved with “(2)” added)"
                  checked={form.onDuplicate === 'KEEP_BOTH'}
                  onChange={() => setForm({ ...form, onDuplicate: 'KEEP_BOTH' })}
                />
              </Form.Group>
            )}
            <Form.Group className="col-12" controlId="doc-note">
              <Form.Label>Note</Form.Label>
              <Form.Control
                value={form.note}
                maxLength={500}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!file || pct !== null}>
            Upload
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

/** "Signed" + " by R. Santos (client, recorded by J. Nazaire)" (FR-DOC-25, AC-28.1). */
function eventParts(ev: DocumentDto['events'][number]) {
  const label = EVENT_LABELS[ev.event] ?? ev.event;
  const actor = ev.actor ? shortName(ev.actor.name) : 'Unknown';
  const who = ev.onBehalfOf ? `${ev.onBehalfOf.name} (client, recorded by ${actor})` : actor;
  return { label, rest: `${ev.version ? ` v${ev.version}` : ''} by ${who}` };
}

/** Requested › Submitted › Signed steps (mockup document panel). */
function Steps({ doc }: { doc: DocumentDto }) {
  if (doc.status === 'CANCELLED') return null;
  const order: DocumentState[] = ['REQUESTED', 'SUBMITTED', 'SIGNED'];
  const reached = order.indexOf(doc.status);
  const shown = doc.request ? order : order.slice(1);
  return (
    <ol className="doc-steps list-inline small mb-3" aria-label="Document status">
      {shown.map((st) => {
        const i = order.indexOf(st);
        const state = i < reached ? 'done' : i === reached ? 'current' : 'todo';
        return (
          <li
            key={st}
            className={`list-inline-item doc-step-${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {state !== 'todo' ? '✓ ' : ''}
            {DOCUMENT_STATUS_LABELS[st]}
          </li>
        );
      })}
    </ol>
  );
}

function DocumentDetail({
  doc,
  projectId,
  onArchive,
  onRestore,
  onFulfil,
  onCancel,
}: {
  doc: DocumentDto;
  projectId: string;
  onArchive: () => void;
  onRestore: () => void;
  onFulfil: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const download = (version?: number) =>
    openDownload(
      `/projects/${projectId}/documents/${doc.id}/download${version ? `?version=${version}` : ''}`,
    ).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not download the file.'));

  return (
    <div className="card">
      <div className="card-body">
        <h2 className="h6 text-break">{doc.name}</h2>
        <span className={`badge ${STATUS_BADGE[doc.status]} mb-3`}>
          {DOCUMENT_STATUS_LABELS[doc.status]}
        </span>
        {doc.request?.overdue && <span className="badge bg-label-danger ms-2 mb-3">Overdue</span>}
        {doc.archived && <span className="badge bg-label-secondary ms-2">Archived</span>}
        <Steps doc={doc} />
        {doc.status === 'REQUESTED' && doc.request && (
          <p className="small mb-2">
            Waiting on {partyLabel(doc.request.requestedFrom)}
            {doc.request.dueDate && ` · due ${shortDate(doc.request.dueDate)}`}
            {doc.requiresSignature && (
              <span className="d-block text-body-secondary">Needs a signed copy.</span>
            )}
          </p>
        )}
        {doc.request?.cancelled && (
          <LockNotice>
            Cancelled by{' '}
            {doc.request.cancelled.by ? shortName(doc.request.cancelled.by.name) : 'Unknown'}: “
            {doc.request.cancelled.reason}”. Cancelled requests are kept and can't be changed.
          </LockNotice>
        )}
        {doc.status === 'SIGNED' && (
          <LockNotice>
            Signed documents are locked. A change needs a new version, and the signed copy is kept.
          </LockNotice>
        )}
        {doc.task && <p className="small mb-2">Linked task: {doc.task.name}</p>}
        <ul className="list-unstyled small my-3">
          {[...doc.events].reverse().map((ev, i) => (
            <li key={i} className="mb-2">
              <strong>{eventParts(ev).label}</strong>
              {eventParts(ev).rest}
              {ev.note && <div className="text-body-secondary">“{ev.note}”</div>}
              <div className="text-body-secondary">{dateTime(ev.at)}</div>
            </li>
          ))}
        </ul>
        {showVersions && (
          <ul className="list-unstyled small border-top pt-2">
            {[...doc.versions].reverse().map((v) => (
              <li key={v.version} className="d-flex align-items-center gap-2 mb-2">
                <span className="me-auto">
                  v{v.version} · {formatBytes(v.size)} · {DOCUMENT_STATUS_LABELS[v.status]}
                  {doc.signedVersion === v.version && ' · Signed copy'}
                  <span className="d-block text-body-secondary">
                    {v.signedBy ? `Signed by ${v.signedBy.name} (client), recorded by ` : ''}
                    {v.uploadedBy ? shortName(v.uploadedBy.name) : 'Unknown'} ·{' '}
                    {shortDate(v.uploadedAt)}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="link"
                  className="p-0"
                  onClick={() => void download(v.version)}
                >
                  Download
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <div className="small text-danger mb-2" role="alert">
            ⚠ {error}
          </div>
        )}
        <div className="d-flex flex-wrap gap-2">
          {doc.versions.length > 0 && (
            <>
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => setShowVersions((x) => !x)}
              >
                Versions ({doc.versions.length})
              </Button>
              <Button size="sm" onClick={() => void download()}>
                Download
              </Button>
            </>
          )}
          {doc.status === 'REQUESTED' && doc.can.upload && (
            <Button size="sm" onClick={onFulfil}>
              <i className="bx bx-upload me-1" aria-hidden="true" />
              Upload file
            </Button>
          )}
          {doc.can.cancel && (
            <Button size="sm" variant="outline-danger" onClick={onCancel}>
              Cancel request
            </Button>
          )}
          {doc.can.archive &&
            (doc.archived ? (
              <Button size="sm" variant="outline-secondary" onClick={onRestore}>
                Restore
              </Button>
            ) : (
              <Button size="sm" variant="outline-danger" onClick={onArchive}>
                Archive
              </Button>
            ))}
        </div>
        <p className="small text-body-secondary mt-3 mb-0">
          Downloads are permission-checked and the link expires after 5 minutes.{' '}
          {CLIENT_CONTACT_NOTICE}
        </p>
      </div>
    </div>
  );
}

/** "Waiting on R. Santos · due Oct 12" for requests (mockup), else who uploaded or signed. */
function SubmittedBy({ doc }: { doc: DocumentDto }) {
  if (doc.status === 'REQUESTED' && doc.request) {
    return (
      <span className={doc.request.overdue ? 'text-danger' : 'text-body-secondary'}>
        Waiting on {doc.request.requestedFrom?.name ?? 'someone'}
        {doc.request.requestedFrom && !doc.request.requestedFrom.active && ' (inactive)'}
        {doc.request.dueDate && ` · due ${shortDate(doc.request.dueDate)}`}
        {doc.request.overdue && ' · overdue'}
      </span>
    );
  }
  if (doc.status === 'CANCELLED') return <span className="text-body-secondary">–</span>;
  const signer = doc.versions[doc.versions.length - 1]?.signedBy;
  if (signer) {
    return (
      <>
        {shortName(signer.name)} <span className="badge bg-label-warning">Client</span>
      </>
    );
  }
  return <>{doc.uploadedBy ? shortName(doc.uploadedBy.name) : '–'}</>;
}

/** Project Documents (FR-DOC-01..41): folders, versions, Signed lock, permission-checked downloads. */
export function DocumentsTab({ project, tasks }: { project: ProjectDto; tasks: TaskDto[] }) {
  const folders = useFolders(project.id);
  // Deep links from Dashboard / My tasks: ?folder=…&doc=… opens that document.
  const [params] = useSearchParams();
  const [folderId, setFolderId] = useState<string | null>(params.get('folder'));
  const [status, setStatus] = useState<string>('');
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const current = folderId ?? folders.data?.items[0]?.id;
  const docs = useDocuments(project.id, {
    folderId: q ? undefined : current,
    q: q || undefined,
    status: status || undefined,
    archived: archived ? 'true' : undefined,
  });
  const mutation = useDocumentMutation(project.id);
  const [selected, setSelected] = useState<string | null>(params.get('doc'));
  const [uploading, setUploading] = useState<{ fulfils: DocumentDto | null } | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [cancelling, setCancelling] = useState<DocumentDto | null>(null);
  const [editingAccess, setEditingAccess] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<DocumentDto | null>(null);
  const list = docs.data?.items ?? [];
  const doc = list.find((d) => d.id === selected) ?? null;
  const folder = folders.data?.items.find((f) => f.id === current);
  const writable = !project.archived;

  return (
    <div className="row g-6">
      <div className="col-lg-3">
        <div className="card">
          <div className="card-body">
            <div className="d-flex align-items-center mb-2">
              <h2 className="h6 mb-0 me-auto">Folders</h2>
              {folders.data?.can.createFolder && writable && (
                <Button size="sm" variant="link" className="p-0" onClick={() => setNewFolder('')}>
                  + Folder
                </Button>
              )}
            </div>
            <ErrorAlert error={folders.error} />
            {folders.isPending ? (
              <LoadingRows />
            ) : (
              <div className="list-group folder-tree">
                {folders.data?.items.map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    className={`list-group-item list-group-item-action d-flex ${f.id === current ? 'active' : ''}`}
                    style={{ paddingInlineStart: `${0.75 + f.depth}rem` }}
                    onClick={() => {
                      setFolderId(f.id);
                      setSelected(null);
                      setQ('');
                    }}
                  >
                    <i className="bx bx-folder me-2" aria-hidden="true" />
                    <span className="me-auto text-truncate">{f.name}</span>
                    {f.restricted && (
                      <i
                        className="bx bx-lock-alt me-1"
                        aria-label="Restricted folder"
                        title="Restricted folder"
                      />
                    )}
                    <small>{f.documentCount}</small>
                  </button>
                ))}
              </div>
            )}
            <p className="small text-body-secondary mt-3 mb-0">
              Contracts and phase folders are created from the template. Custom folders can be
              added.
            </p>
            {folder?.canRestrict && writable && !q && (
              <Button
                size="sm"
                variant="outline-secondary"
                className="mt-3 w-100"
                onClick={() => setEditingAccess(true)}
              >
                <i className="bx bx-lock-alt me-1" aria-hidden="true" />
                Who can see “{folder.name}”
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className={doc ? 'col-lg-5' : 'col-lg-9'}>
        <div className="card">
          <div className="card-body">
            <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
              <h2 className="h6 mb-0 me-auto">
                {q ? 'Search results' : (folder?.name ?? 'Documents')}
              </h2>
              <Form.Control
                type="search"
                size="sm"
                placeholder="Search documents…"
                aria-label="Search documents"
                value={q}
                style={{ maxWidth: 200 }}
                onChange={(e) => setQ(e.target.value)}
              />
              {docs.data?.can.request && writable && (
                <Button
                  size="sm"
                  variant="outline-primary"
                  onClick={() => setRequesting(true)}
                  disabled={!folders.data}
                >
                  Request document
                </Button>
              )}
              {docs.data?.can.upload && writable && (
                <Button
                  size="sm"
                  onClick={() => setUploading({ fulfils: null })}
                  disabled={!folders.data}
                >
                  <i className="bx bx-upload me-1" aria-hidden="true" />
                  Upload
                </Button>
              )}
            </div>
            <Nav variant="tabs" activeKey={archived ? 'ARCHIVED' : status} className="mb-3">
              <Nav.Item>
                <Nav.Link
                  as="button"
                  eventKey=""
                  onClick={() => {
                    setStatus('');
                    setArchived(false);
                  }}
                >
                  All
                </Nav.Link>
              </Nav.Item>
              {DOCUMENT_FILTER_STATES.map((s) => (
                <Nav.Item key={s}>
                  <Nav.Link
                    as="button"
                    eventKey={s}
                    onClick={() => {
                      setStatus(s);
                      setArchived(false);
                    }}
                  >
                    {DOCUMENT_STATUS_LABELS[s]}
                    {docs.data && !archived ? ` (${docs.data.counts[s] ?? 0})` : ''}
                  </Nav.Link>
                </Nav.Item>
              ))}
              <Nav.Item>
                <Nav.Link
                  as="button"
                  eventKey="ARCHIVED"
                  onClick={() => {
                    setStatus('');
                    setArchived(true);
                  }}
                >
                  Archived
                </Nav.Link>
              </Nav.Item>
            </Nav>
            <ErrorAlert error={docs.error} />
            <ErrorAlert error={mutation.error} action />
            {docs.isPending ? (
              <LoadingRows />
            ) : list.length === 0 ? (
              <EmptyState
                icon="bx-folder-open"
                title={q || status || archived ? 'No documents match' : 'This folder is empty'}
              >
                {q || status || archived
                  ? DOCUMENT_TYPES_LABEL
                  : 'Upload a file or request one from a team member or client contact.'}
              </EmptyState>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table-stack-md">
                  <thead>
                    <tr>
                      <th scope="col">Document</th>
                      <th scope="col">Status</th>
                      <th scope="col">Requested by</th>
                      <th scope="col">Submitted by</th>
                      <th scope="col">Version</th>
                      <th scope="col">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((d) => (
                      <tr key={d.id} className={d.id === selected ? 'table-active' : ''}>
                        <td className="cell-primary">
                          <button
                            type="button"
                            className="btn btn-link p-0 text-start d-flex align-items-center gap-2"
                            onClick={() => setSelected(d.id)}
                          >
                            <FileChip name={d.name} />
                            <span className="text-break">{d.name}</span>
                          </button>
                          {d.source === 'EVIDENCE' && (
                            <span className="badge bg-label-secondary ms-1">Evidence</span>
                          )}
                        </td>
                        <td data-label="Status">
                          <span className={`badge ${STATUS_BADGE[d.status]}`}>
                            {DOCUMENT_STATUS_LABELS[d.status]}
                          </span>
                        </td>
                        <td data-label="Requested by">
                          {d.request?.requestedBy ? shortName(d.request.requestedBy.name) : '–'}
                        </td>
                        <td data-label="Submitted by">
                          <SubmittedBy doc={d} />
                        </td>
                        <td data-label="Version">
                          {d.latestVersion ? `v${d.latestVersion}` : '–'}
                        </td>
                        <td data-label="Updated">{shortDate(d.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small text-body-secondary mt-3 mb-0">
              Max 25 MB per file. PDF, Word, Excel, images. Uploading a file with an existing name
              adds a new version instead of overwriting.
            </p>
          </div>
        </div>
      </div>
      {doc && (
        <div className="col-lg-4">
          <DocumentDetail
            doc={doc}
            projectId={project.id}
            onArchive={() => setArchiving(doc)}
            onRestore={() => mutation.mutate({ path: `/documents/${doc.id}/restore` })}
            onFulfil={() => setUploading({ fulfils: doc })}
            onCancel={() => setCancelling(doc)}
          />
        </div>
      )}
      {uploading && folders.data && current && (
        <UploadModal
          project={project}
          folders={folders.data.items}
          folderId={current}
          tasks={tasks}
          existing={list}
          fulfils={uploading.fulfils}
          onClose={() => {
            setUploading(null);
            void docs.refetch();
            void folders.refetch();
          }}
        />
      )}
      {requesting && folders.data && current && (
        <RequestModal
          project={project}
          folders={folders.data.items}
          folderId={current}
          tasks={tasks}
          onClose={(created) => {
            setRequesting(false);
            if (created) setSelected(created.id);
          }}
        />
      )}
      {editingAccess && folder && (
        <FolderAccessModal
          project={project}
          folder={folder}
          onClose={() => setEditingAccess(false)}
        />
      )}
      {cancelling && (
        <ReasonModal
          title="Cancel request"
          label="Reason"
          confirmLabel="Cancel request"
          intro="The request is kept, read-only, with your reason."
          pending={mutation.isPending}
          error={mutation.error}
          onClose={() => setCancelling(null)}
          onSubmit={(reason) =>
            mutation.mutate(
              { path: `/documents/${cancelling.id}/cancel`, body: { reason } },
              { onSuccess: () => setCancelling(null) },
            )
          }
        />
      )}
      {newFolder !== null && (
        <Modal show onHide={() => setNewFolder(null)} centered aria-labelledby="folder-title">
          <Form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!newFolder.trim()) return;
              mutation.mutate(
                { path: '/folders', body: { name: newFolder.trim(), parentId: current ?? null } },
                { onSuccess: () => setNewFolder(null) },
              );
            }}
          >
            <Modal.Header closeButton>
              <Modal.Title as="h2" className="h5" id="folder-title">
                New folder
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <ErrorAlert error={mutation.error} action />
              <Form.Group controlId="folder-name">
                <Form.Label>Folder name</Form.Label>
                <Form.Control
                  autoFocus
                  value={newFolder}
                  maxLength={120}
                  onChange={(e) => setNewFolder(e.target.value)}
                />
                <Form.Text>Created inside {folder?.name ?? 'the selected folder'}.</Form.Text>
              </Form.Group>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="outline-secondary" onClick={() => setNewFolder(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newFolder.trim() || mutation.isPending}>
                Create folder
              </Button>
            </Modal.Footer>
          </Form>
        </Modal>
      )}
      {archiving && (
        <ReasonModal
          title="Archive document"
          label="Reason"
          confirmLabel="Archive"
          intro="Archived documents are hidden from the folder but kept with their history."
          pending={mutation.isPending}
          error={mutation.error}
          onClose={() => setArchiving(null)}
          onSubmit={(reason) =>
            mutation.mutate(
              { path: `/documents/${archiving.id}/archive`, body: { reason } },
              {
                onSuccess: () => {
                  setArchiving(null);
                  setSelected(null);
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
