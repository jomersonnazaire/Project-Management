import {
  CLIENT_IMPORT_MAX_BYTES,
  CLIENT_IMPORT_MESSAGES as MSG,
  CLIENT_IMPORT_RESULT_LABELS,
  type ClientImportCommitDto,
  type ClientImportCountsDto,
  type ClientImportPreviewDto,
  type ClientImportRowDto,
} from '@xc8/shared';
import { useRef, useState, type DragEvent } from 'react';
import { Button, Modal, Nav, Spinner } from 'react-bootstrap';
import {
  downloadClientTemplate,
  useClientImportCommit,
  useClientImportPreview,
} from '../../api/hooks';
import { importProblemOf, templateErrorOf, type ImportProblem } from './importErrors';

/**
 * CR-19 "Import clients from Excel" (FR-CLI-34..38, UIE CLIENTS_EXCEL_IMPORT_UI.md, mockup
 * v0.9.17). Choose file → Reading file… → Preview (counts, tabs, per-row Result and Reason) →
 * Import valid rows. File-level problems keep the modal open so another file can be chosen.
 */

const RESULT_VARIANT: Record<ClientImportRowDto['result'], string> = {
  NEW: 'success',
  UPDATE: 'info',
  NO_CHANGE: 'secondary',
  ERROR: 'danger',
};

const MATCH_NOTE =
  "Clients match on Company name (spaces trimmed, case doesn't matter). Contacts match on Email under that client, or on Full name within that client when there's no email. The same email under a different client is a separate contact. Matches update the record; others are added. Rows with nothing to change show No change and aren't saved. Rows with errors are skipped, and if a row appears twice in the file, every copy is skipped.";

/** Quick checks before upload; the API checks the content again (§9). */
function localProblem(file: File): ImportProblem | null {
  if (!/\.xlsx$/i.test(file.name))
    return { code: 'UNSUPPORTED_FILE', message: MSG.UNSUPPORTED_FILE };
  if (file.size > CLIENT_IMPORT_MAX_BYTES) {
    return { code: 'FILE_TOO_LARGE', message: MSG.FILE_TOO_LARGE };
  }
  return null;
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-US')} KB`;

function ResultBadge({ row }: { row: ClientImportRowDto }) {
  const label = CLIENT_IMPORT_RESULT_LABELS[row.result];
  return (
    <span className={`badge rounded-pill bg-label-${RESULT_VARIANT[row.result]}`}>
      {row.inactive && row.result !== 'ERROR' ? `${label} (inactive)` : label}
    </span>
  );
}

function Chips({ counts }: { counts: ClientImportCountsDto }) {
  return (
    <div className="d-flex flex-wrap gap-2 mb-3" aria-label="Summary">
      <span className="badge rounded-pill bg-label-success">{counts.new} new</span>
      <span className="badge rounded-pill bg-label-info">{counts.update} to update</span>
      <span className="badge rounded-pill bg-label-secondary">{counts.noChange} no change</span>
      <span className="badge rounded-pill bg-label-danger">{counts.error} with errors</span>
    </div>
  );
}

const CLIENT_COLS = ['Company name', 'Industry', 'Status'];
const CONTACT_COLS = ['Company name', 'Full Name', 'Email'];

function RowsTable({ rows, cols }: { rows: ClientImportRowDto[]; cols: string[] }) {
  return (
    <div className="table-responsive" style={{ maxHeight: 360 }}>
      <table className="table table-sm">
        <thead>
          <tr>
            <th scope="col">Row</th>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c === 'Full Name' ? 'Full name' : c}
              </th>
            ))}
            <th scope="col">Result</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.row} className={r.result === 'ERROR' ? 'table-danger' : undefined}>
              <td>{r.row}</td>
              {cols.map((c, i) => {
                const v = r.values[c];
                if (!v) {
                  return (
                    <td key={c} className="text-body-secondary">
                      {i === 0 || c === 'Email' ? '(blank)' : '–'}
                    </td>
                  );
                }
                return <td key={c}>{i === 0 || c === 'Full Name' ? <strong>{v}</strong> : v}</td>;
              })}
              <td>
                <ResultBadge row={r} />
              </td>
              <td className={r.result === 'ERROR' ? 'text-danger' : 'text-body-secondary'}>
                {r.reasons.length || r.warnings.length ? (
                  <>
                    {r.reasons.join(' ')}
                    {/* UIE: warnings (e.g. "Possible duplicate", Q-113) in the AA amber with ⚠;
                        the row keeps its own tag. */}
                    {r.warnings.map((w) => (
                      <span key={w} className="d-block text-warning client-import-warning">
                        <span aria-hidden="true">⚠ </span>
                        {w}
                      </span>
                    ))}
                  </>
                ) : (
                  '–'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <div
      className={`client-import-drop mb-3 ${over ? 'is-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid="client-import-drop"
    >
      <i className="bx bx-upload client-import-drop-icon" aria-hidden="true" />
      <strong className="d-block mb-3">Drop your filled template here or choose a file</strong>
      <Button variant="outline-secondary" onClick={() => input.current?.click()}>
        Choose file
      </Button>
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="d-none"
        aria-label="Choose file"
        data-testid="client-import-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <div className="small text-body-secondary mt-3">
        .xlsx only · up to 5 MB · 2,000 rows per sheet
      </div>
    </div>
  );
}

export function ClientImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (result: ClientImportCommitDto) => void;
}) {
  const preview = useClientImportPreview();
  const commit = useClientImportCommit();
  // DEF-056: `commit.isPending` only disables Import after a re-render, so a fast double-click
  // could send two commits (the second gets IMPORT_BUSY and wrongly says nothing was saved).
  // This ref blocks a second click synchronously until the first commit settles.
  const committing = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);
  const [tab, setTab] = useState<'clients' | 'contacts'>('clients');
  const [tplError, setTplError] = useState<string | null>(null);

  const reset = () => {
    preview.reset();
    commit.reset();
    setFile(null);
    setProblem(null);
    setTplError(null);
    setTab('clients');
  };

  const choose = (f: File) => {
    reset(); // also clears a template-download error, so alerts don't stack (UIE)
    setFile(f);
    const local = localProblem(f);
    if (local) return setProblem(local);
    preview.mutate(f, { onError: (e) => setProblem(importProblemOf(e)) });
  };

  const template = () => {
    setTplError(null);
    downloadClientTemplate().catch((e: unknown) => setTplError(templateErrorOf(e)));
  };

  const data: ClientImportPreviewDto | undefined = preview.data;
  const valid = data ? data.counts.total.new + data.counts.total.update : 0;
  const commitProblem = commit.error ? importProblemOf(commit.error) : null;
  // FR-CLI-35b / Q-116: the data changed (or the token expired) since this preview. Nothing was
  // saved; the user must preview the same file again before importing.
  const stale = commitProblem?.code === 'PREVIEW_STALE';
  const previewAgain = () => {
    if (!file) return;
    commit.reset();
    preview.mutate(file, { onError: (e) => setProblem(importProblemOf(e)) });
  };

  const templateLink = (lead?: string) => (
    <p className="small text-body-secondary mb-0">
      {lead}
      <Button variant="link" className="p-0 align-baseline" onClick={template}>
        Download template
      </Button>
    </p>
  );

  let body;
  if (preview.isPending) {
    body = (
      <div className="text-center py-5" role="status" aria-live="polite">
        <Spinner animation="border" variant="primary" className="mb-3" />
        <strong className="d-block">Reading file…</strong>
        <div className="small text-body-secondary">{file?.name}</div>
      </div>
    );
  } else if (problem?.code === 'EMPTY_FILE') {
    body = (
      <div className="empty-state py-4">
        <i className="bx bx-spreadsheet fs-1" aria-hidden="true" />
        <strong className="d-block">{problem.message}</strong>
        <p className="text-body-secondary">
          Add rows to the Clients or Contacts sheet, then choose the file again.
        </p>
        <Button variant="outline-secondary" onClick={reset}>
          Choose another file
        </Button>
      </div>
    );
  } else if (problem?.code === 'TOO_MANY_ROWS') {
    body = (
      <>
        <div className="alert alert-danger" role="alert">
          {problem.message}
        </div>
        <p className="text-body-secondary">
          Split the rows into two files and import them one at a time.
        </p>
        <Button variant="outline-secondary" onClick={reset}>
          Choose another file
        </Button>
      </>
    );
  } else if (problem || !data) {
    body = (
      <>
        {problem && (
          <div className={`alert alert-${problem.tone ?? 'danger'}`} role="alert">
            {problem.message}
          </div>
        )}
        <DropZone onFile={choose} />
        {templateLink(problem ? undefined : "Don't have it yet? ")}
      </>
    );
  } else {
    const n = (k: 'clients' | 'contacts') => data[k].length;
    body = (
      <>
        <div className="d-flex flex-wrap align-items-center gap-2 border rounded p-2 mb-3">
          <span className="badge bg-label-success">XLSX</span>
          <strong>{data.fileName}</strong>
          <span className="small text-body-secondary">
            {kb(data.size)} · {n('clients')} {n('clients') === 1 ? 'client' : 'clients'},{' '}
            {n('contacts')} {n('contacts') === 1 ? 'contact' : 'contacts'}
          </span>
          <Button variant="link" className="ms-auto p-0" onClick={reset}>
            Choose another file
          </Button>
        </div>
        <Chips counts={data.counts.total} />
        <div className="alert alert-info small py-2">
          {MATCH_NOTE}
          <br />
          <strong>Update:</strong> blank cells keep the current value.
        </div>
        {data.notes.map((note) => (
          <div key={note} className="alert alert-warning small py-2">
            {note}
          </div>
        ))}
        {commitProblem && (
          <div className={`alert alert-${commitProblem.tone ?? 'danger'}`} role="alert">
            {commitProblem.message}
          </div>
        )}
        <Nav variant="tabs" activeKey={tab} onSelect={(k) => setTab(k as 'clients' | 'contacts')}>
          <Nav.Item>
            <Nav.Link eventKey="clients">Clients ({n('clients')})</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="contacts">Contacts ({n('contacts')})</Nav.Link>
          </Nav.Item>
        </Nav>
        <div className="pt-2">
          {tab === 'clients' ? (
            <RowsTable rows={data.clients} cols={CLIENT_COLS} />
          ) : (
            <RowsTable rows={data.contacts} cols={CONTACT_COLS} />
          )}
        </div>
      </>
    );
  }

  return (
    <Modal show onHide={onClose} centered size="lg" aria-labelledby="client-import-title">
      <Modal.Header closeButton>
        <div>
          <Modal.Title id="client-import-title">Import clients from Excel</Modal.Title>
          <div className="small text-body-secondary">
            Use the OpsTrack template. It has a Clients sheet and a Contacts sheet.
          </div>
        </div>
      </Modal.Header>
      <Modal.Body>
        {tplError && (
          <div className="alert alert-danger alert-dismissible py-2" role="alert">
            {tplError}
            <button
              type="button"
              className="btn-close"
              aria-label="Dismiss"
              onClick={() => setTplError(null)}
            />
          </div>
        )}
        {body}
      </Modal.Body>
      {data && !problem && (
        // DEF-055: below 576px the buttons stack full width with the primary on top.
        <Modal.Footer className="client-import-footer">
          <Button variant="outline-secondary" onClick={onClose} disabled={commit.isPending}>
            Cancel
          </Button>
          {stale ? (
            <Button onClick={previewAgain}>Preview again</Button>
          ) : (
            <Button
              disabled={valid === 0 || commit.isPending}
              onClick={() => {
                if (!file || committing.current) return;
                committing.current = true;
                commit.mutate(
                  { file, token: data.token },
                  {
                    onSuccess: onImported,
                    onSettled: () => {
                      committing.current = false;
                    },
                  },
                );
              }}
            >
              {commit.isPending ? 'Importing…' : `Import valid rows (${valid})`}
            </Button>
          )}
        </Modal.Footer>
      )}
    </Modal>
  );
}
