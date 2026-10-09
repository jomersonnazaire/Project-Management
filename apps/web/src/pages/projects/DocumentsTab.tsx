import {
  DOCUMENT_ACCEPT,
  DOCUMENT_STATUSES,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPES_LABEL,
  checkFileRules,
  formatBytes,
  shortName,
  type DocumentDto,
  type DocumentStatus,
  type FolderDto,
  type ProjectDto,
  type TaskDto,
  type UploadTicketDto,
} from '@xc8/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Button, Form, Modal, Nav, ProgressBar } from 'react-bootstrap';
import { ApiError, api } from '../../api/client';
import {
  completeUpload,
  fileMeta,
  openDownload,
  putFile,
  useDocumentMutation,
  useDocuments,
  useFolders,
} from '../../api/m3Hooks';
import { EmptyState, ErrorAlert, LoadingRows, LockNotice } from '../../components/Feedback';
import { ReasonModal } from '../../components/ReasonModal';
import { dateTime, shortDate } from '../../lib/format';
import { FileChip } from './EvidenceSection';

const STATUS_BADGE: Record<DocumentStatus, string> = {
  SUBMITTED: 'bg-label-info',
  SIGNED: 'bg-label-success',
};

const EVENT_LABELS: Record<string, string> = {
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
  onClose,
}: {
  project: ProjectDto;
  folders: FolderDto[];
  folderId: string;
  tasks: TaskDto[];
  existing: DocumentDto[];
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    folderId,
    status: 'SUBMITTED' as DocumentStatus,
    taskId: '',
    onDuplicate: 'NEW_VERSION' as 'NEW_VERSION' | 'KEEP_BOTH',
    note: '',
  });
  const [error, setError] = useState('');
  const [pct, setPct] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const dup =
    file &&
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
                value={form.folderId}
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
                onChange={(e) => setForm({ ...form, status: e.target.value as DocumentStatus })}
              >
                {DOCUMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {DOCUMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
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

function DocumentDetail({
  doc,
  projectId,
  onArchive,
  onRestore,
}: {
  doc: DocumentDto;
  projectId: string;
  onArchive: () => void;
  onRestore: () => void;
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
        {doc.archived && <span className="badge bg-label-secondary ms-2">Archived</span>}
        {doc.status === 'SIGNED' && (
          <LockNotice>
            Signed documents are locked. A change needs a new version, and the signed copy is kept.
          </LockNotice>
        )}
        {doc.task && <p className="small mb-2">Linked task: {doc.task.name}</p>}
        <ul className="list-unstyled small my-3">
          {[...doc.events].reverse().map((ev, i) => (
            <li key={i} className="mb-2">
              <strong>{EVENT_LABELS[ev.event] ?? ev.event}</strong>
              {ev.version ? ` v${ev.version}` : ''} by{' '}
              {ev.actor ? shortName(ev.actor.name) : 'Unknown'}
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
          <Button size="sm" variant="outline-secondary" onClick={() => setShowVersions((x) => !x)}>
            Versions ({doc.versions.length})
          </Button>
          <Button size="sm" onClick={() => void download()}>
            Download
          </Button>
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
          Downloads are permission-checked and the link expires after 5 minutes.
        </p>
      </div>
    </div>
  );
}

/** Project Documents (FR-DOC-01..41): folders, versions, Signed lock, permission-checked downloads. */
export function DocumentsTab({ project, tasks }: { project: ProjectDto; tasks: TaskDto[] }) {
  const folders = useFolders(project.id);
  const [folderId, setFolderId] = useState<string | null>(null);
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
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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
                    <small>{f.documentCount}</small>
                  </button>
                ))}
              </div>
            )}
            <p className="small text-body-secondary mt-3 mb-0">
              Contracts and phase folders are created from the template. Custom folders can be
              added.
            </p>
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
              {docs.data?.can.upload && writable && (
                <Button size="sm" onClick={() => setUploading(true)} disabled={!folders.data}>
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
              {DOCUMENT_STATUSES.map((s) => (
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
                    {docs.data && !archived ? ` (${docs.data.counts[s]})` : ''}
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
              <EmptyState icon="bx-folder-open" title="No documents here yet">
                {DOCUMENT_TYPES_LABEL}
              </EmptyState>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table-stack-md">
                  <thead>
                    <tr>
                      <th scope="col">Document</th>
                      <th scope="col">Status</th>
                      <th scope="col">Uploaded by</th>
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
                        <td data-label="Uploaded by">
                          {d.uploadedBy ? shortName(d.uploadedBy.name) : '–'}
                        </td>
                        <td data-label="Version">v{d.latestVersion}</td>
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
          onClose={() => {
            setUploading(false);
            void docs.refetch();
            void folders.refetch();
          }}
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
