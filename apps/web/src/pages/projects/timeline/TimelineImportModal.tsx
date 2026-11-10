import {
  CLIENT_IMPORT_MAX_BYTES,
  TIMELINE_COLUMN_LABEL,
  TIMELINE_FILE_ERRORS,
  TIMELINE_IMPORT_COPY as COPY,
  TIMELINE_RESULT_LABELS,
  TIMELINE_VISIBLE_FIELDS,
  changedAlertLead,
  changedAlertRest,
  errorsAlertLead,
  importDoneLine,
  newPhaseNotice,
  notConfirmedHelp,
  numberingLine,
  type TimelineImportCommitDto,
  type TimelineImportField,
  type TimelineImportPreviewDto,
  type TimelineImportResult,
  type TimelineImportRowDto,
  type TimelinePlanField,
} from '@xc8/shared';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import { ApiError } from '../../../api/client';
import {
  downloadTimelineTemplate,
  useTimelineImportCommit,
  useTimelineImportPreview,
} from '../../../api/timelineHooks';

/**
 * CR-22 Part B slice 3: Import timeline from Excel (UIE §5, `modal-xl`). Choose file → Check rows
 * (preview, nothing saved) → Done. Any row error blocks the import (Q-146); Changed-since-export
 * rows are saved only when confirmed (FR-TL-25).
 */

type Filter = 'all' | 'errors' | 'changed' | 'clears' | 'new' | 'update';
type Problem = { lead: string; rest: string };

const BADGE: Record<TimelineImportResult, string> = {
  NEW: 'bg-label-info',
  UPDATE: 'bg-label-primary',
  UNCHANGED: 'bg-label-secondary',
  CHANGED: 'bg-label-warning',
  ERROR: 'bg-label-danger',
};
const BASELINE: TimelineImportField[] = ['baselineStart', 'baselineFinish'];
const PLAN = new Set<string>([
  'name',
  'phase',
  'milestone',
  'start',
  'finish',
  'dependsOn',
  'owner',
]);

/** The API's file-error message as UIE's bold lead and the rest. */
function problemOf(e: unknown): Problem {
  const message = e instanceof Error ? e.message : 'Something went wrong. Nothing was imported.';
  const cut = message.indexOf('. ');
  return cut > 0
    ? { lead: message.slice(0, cut + 1), rest: message.slice(cut + 2) }
    : { lead: message, rest: '' };
}

function localProblem(f: File): Problem | null {
  if (!/\.xlsx$/i.test(f.name)) return TIMELINE_FILE_ERRORS.NOT_XLSX;
  if (f.size > CLIENT_IMPORT_MAX_BYTES) return TIMELINE_FILE_ERRORS.FILE_TOO_LARGE;
  return null;
}

const exportedOn = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });

function Steps({ at }: { at: 1 | 2 | 3 }) {
  const names = ['Choose file', 'Check rows', 'Done'];
  return (
    <ol className="tli-steps" aria-label="Steps">
      {names.map((n, i) => {
        const step = i + 1;
        const cls = step === at ? 'on' : step < at ? 'dn' : '';
        return (
          <li key={n} className={cls} aria-current={step === at ? 'step' : undefined}>
            <span className="n" aria-hidden="true">
              {step < at ? '✓' : step}
            </span>
            {n}
          </li>
        );
      })}
    </ol>
  );
}

function Alert({
  tone,
  icon,
  children,
  action,
}: {
  tone: 'danger' | 'warning' | 'secondary' | 'info';
  icon: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={`alert alert-${tone} d-flex align-items-start gap-2 py-2`}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <i className={`bx ${icon} mt-1`} aria-hidden="true" />
      <div className="flex-grow-1">{children}</div>
      {action}
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
      className={`tli-drop mb-3${over ? ' is-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid="timeline-import-drop"
    >
      <i className="bx bx-cloud-upload tli-drop-icon" aria-hidden="true" />
      <p className="mb-2">
        <strong>Drop your timeline file here</strong> or
      </p>
      <Button onClick={() => input.current?.click()}>Choose file</Button>
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="d-none"
        aria-label="Choose file"
        data-testid="timeline-import-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <p className="small text-body-secondary mt-3 mb-0">{COPY.LIMITS}</p>
    </div>
  );
}

function ResultCell({
  r,
  confirmed,
  onConfirm,
}: {
  r: TimelineImportRowDto;
  confirmed: boolean;
  onConfirm: () => void;
}) {
  const label = (f: TimelinePlanField) => TIMELINE_COLUMN_LABEL[f];
  const changes = r.changes.filter((c) => !r.clears.includes(c));
  return (
    <>
      <span className={`badge ${BADGE[r.result]}`}>{TIMELINE_RESULT_LABELS[r.result]}</span>
      {r.result === 'NEW' && r.willBe !== null && (
        <span className="tli-rsn text-body-secondary">Added at the end as #{r.willBe}</span>
      )}
      {(r.result === 'UPDATE' || r.result === 'CHANGED') && changes.length > 0 && (
        <span className="tli-rsn">Changes: {changes.map(label).join(', ')}</span>
      )}
      {(r.result === 'UPDATE' || r.result === 'CHANGED') && r.clears.length > 0 && (
        <span className="tli-rsn text-danger fw-semibold">
          Clears: {r.clears.map(label).join(', ')}
        </span>
      )}
      {r.errors.map((e) => (
        <span key={e.message} className="tli-rsn text-danger">
          {e.message}
        </span>
      ))}
      {r.result === 'CHANGED' && (
        <>
          <span className="tli-rsn tli-warn">{r.changedSince}</span>
          <Button
            size="sm"
            variant={confirmed ? 'success' : 'outline-warning'}
            className="mt-1 tli-confirm"
            aria-pressed={confirmed}
            onClick={onConfirm}
          >
            {confirmed ? '✓ Confirmed: file values win' : 'Confirm overwrite'}
          </Button>
        </>
      )}
    </>
  );
}

function Cell({ r, f }: { r: TimelineImportRowDto; f: TimelineImportField }) {
  const value = r.values[f];
  const ro = BASELINE.includes(f);
  const bad = r.errors.some((e) => e.field === f);
  const changed = PLAN.has(f) && r.changes.includes(f as TimelinePlanField);
  const cleared = changed && r.clears.includes(f as TimelinePlanField);
  const old = changed ? r.old[f as TimelinePlanField] : undefined;
  const cls = [
    'tli-cell',
    bad ? 'tli-bad' : '',
    changed && !bad ? 'tli-chg' : '',
    ro ? 'tli-ro' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <td className={cls}>
      {value ? (
        value
      ) : cleared ? (
        <span className="text-danger">(blank)</span>
      ) : (
        <span className="text-body-secondary">—</span>
      )}
      {old !== undefined && <s className="tli-was">{old || 'blank'}</s>}
    </td>
  );
}

export function TimelineImportModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const preview = useTimelineImportPreview(projectId);
  const commit = useTimelineImportCommit(projectId);
  const committing = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<TimelineImportCommitDto | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);

  const reset = () => {
    preview.reset();
    commit.reset();
    setFile(null);
    setProblem(null);
    setFilter('all');
    setConfirmed(new Set());
  };
  const check = (f: File) => {
    commit.reset();
    setConfirmed(new Set());
    preview.mutate(f, {
      onError: (e) => {
        setFile(null);
        setProblem(problemOf(e));
      },
    });
  };
  const choose = (f: File) => {
    reset();
    setFile(f);
    const local = localProblem(f);
    if (local) {
      setFile(null);
      return setProblem(local);
    }
    check(f);
  };
  const template = () => {
    setTplError(null);
    downloadTimelineTemplate(projectId).catch((e: unknown) =>
      setTplError(e instanceof ApiError ? e.message : "Couldn't download the template. Try again."),
    );
  };

  const data: TimelineImportPreviewDto | undefined = preview.data;
  const busy = commit.isPending;
  const stale = commit.error instanceof ApiError && commit.error.code === 'PREVIEW_STALE';
  const commitProblem = commit.error && !stale ? problemOf(commit.error) : null;

  let body: ReactNode;
  let footer: ReactNode = null;
  if (done) {
    body = (
      <>
        <Steps at={3} />
        <div className="tli-done text-center py-4" role="status">
          <div className="tli-done-ic mx-auto mb-3" aria-hidden="true">
            <i className="bx bx-check" />
          </div>
          <h3 className="h5 mb-2">Timeline imported</h3>
          <p className="mb-1">{importDoneLine(done)}</p>
          <p className="mb-1">{COPY.NOTHING_DELETED}</p>
          <p className="small text-body-secondary">{COPY.UP_TO_DATE}</p>
          <Button onClick={onClose}>Back to timeline</Button>
        </div>
      </>
    );
  } else if (busy) {
    body = (
      <>
        <Steps at={2} />
        <div className="text-center py-5" role="status" aria-live="polite">
          <Spinner animation="border" variant="primary" className="mb-3" aria-hidden="true" />
          <strong className="d-block">{COPY.IMPORTING}</strong>
          <div className="small text-body-secondary">{COPY.IMPORTING_SUB}</div>
        </div>
      </>
    );
  } else if (preview.isPending) {
    body = (
      <>
        <Steps at={1} />
        <div className="text-center py-5" role="status" aria-live="polite">
          <Spinner animation="border" variant="primary" className="mb-3" aria-hidden="true" />
          <strong className="d-block">{COPY.READING}</strong>
          <div className="small text-body-secondary">{COPY.READING_SUB}</div>
        </div>
      </>
    );
  } else if (!data || !file) {
    body = (
      <>
        <Steps at={1} />
        {problem && (
          <Alert tone="danger" icon="bx-x-circle">
            <strong>{problem.lead}</strong> {problem.rest}
          </Alert>
        )}
        <Alert tone="info" icon="bx-info-circle">
          <strong>{COPY.NEVER_DELETES_LEAD}</strong> {COPY.NEVER_DELETES_REST}
        </Alert>
        <DropZone onFile={choose} />
        <p className="small text-body-secondary mb-0">
          To edit this project’s tasks, use <strong>Excel › Download timeline (.xlsx)</strong> on
          the Timeline, change the file, then import it here. To start a plan from scratch,{' '}
          <Button variant="link" className="p-0 align-baseline small" onClick={template}>
            download the template
          </Button>
          ; every row in it imports as a new task. Dates as a date cell or YYYY-MM-DD.
        </p>
      </>
    );
    footer = (
      <Button variant="outline-secondary" onClick={onClose}>
        Cancel
      </Button>
    );
  } else {
    const rows = data.rows;
    const changedRows = rows.filter((r) => r.result === 'CHANGED');
    const nConfirmed = changedRows.filter((r) => confirmed.has(r.row)).length;
    const left = changedRows.length - nConfirmed;
    const blocked = data.counts.error > 0;
    const n = data.counts.new + data.counts.update + nConfirmed;
    const lists: Record<Filter, TimelineImportRowDto[]> = {
      all: rows.filter((r) => showUnchanged || r.result !== 'UNCHANGED'),
      errors: rows.filter((r) => r.result === 'ERROR'),
      changed: changedRows,
      clears: rows.filter((r) => r.clears.length > 0),
      new: rows.filter((r) => r.result === 'NEW'),
      update: rows.filter((r) => r.result === 'UPDATE'),
    };
    const chips: [Filter, string, number, string][] = [
      ['all', 'All', rows.length, 'secondary'],
      ['errors', 'Errors', data.counts.error, 'danger'],
      ['changed', 'Changed since export', data.counts.changed, 'warning'],
      ['clears', 'Clears fields', data.counts.clears, 'danger'],
      ['new', 'New', data.counts.new, 'info'],
      ['update', 'Update', data.counts.update, 'primary'],
    ];
    const toggle = (row: number) =>
      setConfirmed((s) => {
        const next = new Set(s);
        if (next.has(row)) next.delete(row);
        else next.add(row);
        return next;
      });
    const allConfirmed = changedRows.length > 0 && left === 0;
    const help = blocked
      ? errorsAlertLead(data.counts.errorMessages)
      : left
        ? notConfirmedHelp(left)
        : '';
    const newRows = rows.filter((r) => r.result === 'NEW' && r.willBe !== null);
    body = (
      <>
        <Steps at={2} />
        {stale && (
          <Alert
            tone="danger"
            icon="bx-time-five"
            action={
              <Button size="sm" variant="outline-secondary" onClick={() => check(file)}>
                Check again
              </Button>
            }
          >
            <strong>{COPY.STALE_LEAD}</strong> {COPY.STALE_REST}
          </Alert>
        )}
        {commitProblem && (
          <Alert tone="danger" icon="bx-x-circle">
            <strong>{commitProblem.lead}</strong> {commitProblem.rest}
          </Alert>
        )}
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3" data-testid="file-chip">
          <span className="badge bg-label-secondary tli-file">
            <i className="bx bx-spreadsheet me-1" aria-hidden="true" />
            {data.fileName}
          </span>
          <span className="small text-body-secondary">
            {data.exported?.at
              ? `Exported from this project ${exportedOn(data.exported.at)}`
              : 'Template file, not an export of this project'}{' '}
            · {rows.length} rows
          </span>
          <Button variant="link" size="sm" className="ms-auto p-0" onClick={reset}>
            Choose another file
          </Button>
        </div>
        <div
          className="d-flex flex-wrap align-items-center gap-2 mb-3"
          role="group"
          aria-label="Show rows"
        >
          {chips.map(([key, label, count, tone]) => (
            <button
              key={key}
              type="button"
              className={`tli-chip${filter === key ? ' on' : ''}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label} <span className={`badge rounded-pill bg-label-${tone}`}>{count}</span>
            </button>
          ))}
          <Form.Check
            id="tli-unchanged"
            className="small mb-0 ms-1"
            label={`Show ${data.counts.unchanged} unchanged rows`}
            checked={showUnchanged}
            onChange={(e) => setShowUnchanged(e.target.checked)}
          />
        </div>
        {blocked && (
          <Alert tone="danger" icon="bx-x-circle">
            <strong>{errorsAlertLead(data.counts.errorMessages)}</strong> Any row with an error
            stops the whole import, because rows depend on each other. Nothing has been saved.{' '}
            <Button
              variant="link"
              className="p-0 align-baseline"
              onClick={() => setFilter('errors')}
            >
              Show rows with errors
            </Button>
          </Alert>
        )}
        {changedRows.length > 0 && (
          <Alert
            tone="warning"
            icon="bx-error"
            action={
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() =>
                  setConfirmed(allConfirmed ? new Set() : new Set(changedRows.map((r) => r.row)))
                }
              >
                {allConfirmed ? 'Undo confirm all' : `Confirm all (${changedRows.length})`}
              </Button>
            }
          >
            <strong>{changedAlertLead(changedRows.length)}</strong>{' '}
            {changedAlertRest(changedRows.length)}
          </Alert>
        )}
        {data.baselineFilled && (
          <Alert tone="secondary" icon="bx-lock-alt">
            <strong>{COPY.BASELINE_IGNORED_LEAD}</strong> Click <strong>Save baseline</strong> after
            importing to update the baseline.
          </Alert>
        )}
        {newRows.length > 0 && (
          <p className="small mb-2">
            <i className="bx bx-sort-down me-1" aria-hidden="true" />
            {numberingLine(
              newRows.map((r) => ({ file: Number(r.values.number), final: r.willBe! })),
            )}
          </p>
        )}
        {data.newPhases.map((name) => (
          <Alert key={name} tone="info" icon="bx-layer-plus">
            {newPhaseNotice(name)}
          </Alert>
        ))}
        <div className="tli-twrap">
          <table className="table table-sm tli-tbl mb-0">
            <thead>
              <tr>
                <th scope="col" className="tli-rowno">
                  Row
                </th>
                <th scope="col" className="tli-result">
                  Result
                </th>
                {TIMELINE_VISIBLE_FIELDS.map((f) => (
                  <th
                    scope="col"
                    key={f}
                    title={
                      BASELINE.includes(f) ? 'Ignored on import. Use Save baseline.' : undefined
                    }
                  >
                    {TIMELINE_COLUMN_LABEL[f]}
                    {BASELINE.includes(f) && (
                      <i className="bx bx-lock-alt ms-1" aria-label="ignored on import" />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lists[filter].map((r) => (
                <tr
                  key={r.row}
                  className={
                    r.result === 'ERROR' ? 'tli-er' : r.result === 'CHANGED' ? 'tli-cx' : ''
                  }
                  data-testid={`import-row-${r.row}`}
                >
                  <td className="tli-rowno">{r.row}</td>
                  <td className="tli-result">
                    <ResultCell
                      r={r}
                      confirmed={confirmed.has(r.row)}
                      onConfirm={() => toggle(r.row)}
                    />
                  </td>
                  {TIMELINE_VISIBLE_FIELDS.map((f) => (
                    <Cell key={f} r={r} f={f} />
                  ))}
                </tr>
              ))}
              {lists[filter].length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center text-body-secondary py-4">
                    No rows here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="small text-body-secondary mt-2 mb-0">
          Crossed-out values are what OpsTrack has now. <span className="text-danger">(blank)</span>{' '}
          {COPY.FOOTNOTE_REST}
        </p>
      </>
    );
    footer = (
      <>
        <span
          id="tli-help"
          className={`small me-auto ${blocked ? 'text-danger' : 'text-body-secondary'}`}
        >
          {help}
        </span>
        <Button variant="outline-secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={blocked || n === 0 || stale}
          aria-describedby={help ? 'tli-help' : undefined}
          onClick={() => {
            if (committing.current) return;
            committing.current = true;
            commit.mutate(
              {
                file,
                token: data.token,
                confirm: changedRows.filter((r) => confirmed.has(r.row)).map((r) => r.row),
              },
              {
                onSuccess: setDone,
                onSettled: () => {
                  committing.current = false;
                },
              },
            );
          }}
        >
          Import {n} row{n === 1 ? '' : 's'}
        </Button>
      </>
    );
  }

  return (
    <Modal
      show
      onHide={busy ? () => undefined : onClose}
      backdrop={busy ? 'static' : true}
      keyboard={!busy}
      size="xl"
      dialogClassName="tli-modal"
      aria-labelledby="timeline-import-title"
    >
      <Modal.Header closeButton={!busy}>
        <Modal.Title id="timeline-import-title">Import timeline from Excel</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {tplError && (
          <div className="alert alert-danger py-2" role="alert">
            {tplError}
          </div>
        )}
        {body}
      </Modal.Body>
      {footer && <Modal.Footer className="tli-foot">{footer}</Modal.Footer>}
    </Modal>
  );
}
