import {
  CLIENT_IMPORT_MAX_ROWS,
  TIMELINE_COLUMN_LABEL,
  TIMELINE_FILE_ERRORS,
  TIMELINE_IMPORT_COPY as COPY,
  TIMELINE_MAX_BYTES,
  TIMELINE_RESULT_LABELS,
  TIMELINE_VISIBLE_FIELDS,
  DELIVERABLES_LOST_REST,
  TIMELINE_ROW_HELP_CLEAN,
  ADD_MEMBERS_REST,
  addMembersLead,
  addedMembersLine,
  changedAlertLead,
  changedAlertRest,
  deliverablesDoneLine,
  deliverablesGainText,
  deliverablesLose,
  deliverablesLossText,
  deliverablesLostLead,
  errorsAlertLead,
  fileTooLargeError,
  importDoneLine,
  newPhaseNotice,
  notConfirmedHelp,
  numberingLine,
  tooManyTimelineRowsError,
  type TimelineImportCommitDto,
  type TimelineImportField,
  type TimelineImportPreviewDto,
  type TimelineImportResult,
  type TimelineImportRowDto,
  type TimelinePlanField,
  type DeliverablesDiff,
} from '@xc8/shared';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import {
  downloadChecklistTemplate,
  useChecklistImportCommit,
  useChecklistImportPreview,
} from '../../api/checklistHooks';
import { checklistRowCount } from './checklistRowCount';

/**
 * CR-23 (UIE §4): Import checklist from Excel, on the Checklist tab. The CR-22 import (Choose file
 * → Check rows (preview, nothing saved) → Done) moved here and reads a Deliverables column too.
 * Any row error blocks the import (Q-146); Changed-since-export rows (deliverables included) are
 * saved only when confirmed (FR-TL-25).
 */

type Filter = 'all' | 'errors' | 'changed' | 'losses' | 'new' | 'update';
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

/** NFR-52 checks before upload: type, 5 MB and 2,000 rows (the API checks all three again). */
async function localProblem(f: File): Promise<Problem | null> {
  if (!/\.xlsx$/i.test(f.name)) return TIMELINE_FILE_ERRORS.NOT_XLSX;
  if (f.size > TIMELINE_MAX_BYTES) return fileTooLargeError(f.size);
  const rows = await checklistRowCount(f);
  if (rows !== null && rows > CLIENT_IMPORT_MAX_ROWS)
    return tooManyTimelineRowsError(rows, CLIENT_IMPORT_MAX_ROWS);
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
        <strong>Drop your checklist file here</strong> or
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
  // Deliverables get their own wording (UIE §4.3, Q-158).
  const d = r.changes.includes('deliverables') ? r.deliverables : null;
  const dCleared = r.clears.includes('deliverables');
  const gain = d && !dCleared ? deliverablesGainText(d) : null;
  const loss = d && !dCleared ? deliverablesLossText(d) : null;
  const changes = r.changes.filter((c) => !r.clears.includes(c) && c !== 'deliverables').map(label);
  if (gain) changes.push(gain);
  const clears = r.clears.filter((c) => c !== 'deliverables').map(label);
  if (dCleared && d) clears.push(`Deliverables (${d.removed} item${d.removed === 1 ? '' : 's'})`);
  const updating = r.result === 'UPDATE' || r.result === 'CHANGED';
  const added = r.result === 'NEW' && r.deliverables ? r.deliverables.added : 0;
  return (
    <>
      <span className={`badge ${BADGE[r.result]}`}>{TIMELINE_RESULT_LABELS[r.result]}</span>
      {r.result === 'NEW' && r.willBe !== null && (
        <span className="tli-rsn text-body-secondary">Added at the end as #{r.willBe}</span>
      )}
      {updating && changes.length > 0 && (
        <span className="tli-rsn">Changes: {changes.join(', ')}</span>
      )}
      {updating && loss && <span className="tli-rsn text-danger fw-bold">{loss}</span>}
      {updating && clears.length > 0 && (
        <span className="tli-rsn text-danger fw-semibold">Clears: {clears.join(', ')}</span>
      )}
      {added > 0 && (
        <span className="tli-rsn text-body-secondary">
          Deliverables: {added} item{added === 1 ? '' : 's'}
        </span>
      )}
      {r.warnings.map((w) => (
        <span key={w.message} className="tli-rsn tli-warn">
          <i className="bx bx-info-circle me-1" aria-hidden="true" />
          {w.message}
        </span>
      ))}
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

const DATE_FIELDS: readonly TimelineImportField[] = [
  'start',
  'finish',
  'baselineStart',
  'baselineFinish',
];
/** UIE review 5: an email may wrap before its "@" (no sideways scroll at 1440). */
/** Splits a header label so its last word can carry the lock icon without wrapping alone. */
function headWords(label: string) {
  const at = label.lastIndexOf(' ');
  return at < 0
    ? { head: '', last: label }
    : { head: label.slice(0, at + 1), last: label.slice(at + 1) };
}

const breakable = (f: TimelineImportField, v: string): ReactNode =>
  f === 'owner' && v.includes('@') ? (
    <>
      {v.slice(0, v.indexOf('@'))}
      <wbr />
      {v.slice(v.indexOf('@'))}
    </>
  ) : (
    v
  );

/** UIE §4.3 table: one line per item in file order, then removed lines struck through. */
function DeliverablesLines({ d, cleared }: { d: DeliverablesDiff; cleared: boolean }) {
  const box = (done: boolean) => (done ? '[x] ' : '[ ] ');
  return (
    <ul className="tli-dl list-unstyled mb-0">
      {cleared && <li className="text-danger fw-semibold">(blank)</li>}
      {d.lines.map((l, i) => {
        switch (l.kind) {
          case 'same':
            return (
              <li key={i} className={l.done ? 'tli-dl-done' : undefined}>
                {box(l.done)}
                {l.text}
              </li>
            );
          case 'added':
            return (
              <li key={i} className="tli-dl-add">
                <span className="visually-hidden">Added: </span>+ {box(l.done)}
                {l.text}
              </li>
            );
          case 'ticked':
          case 'unticked':
            return (
              <li key={i} className={l.kind === 'ticked' ? 'tli-dl-tick' : 'tli-dl-untick'}>
                <span className="visually-hidden">
                  {l.kind === 'ticked' ? 'Ticked: ' : 'Unticked: '}
                </span>
                {box(l.done)}
                {l.text}
                <s className="tli-was">
                  {box(!l.done)}
                  {l.text}
                </s>
              </li>
            );
          case 'removed':
            return (
              <li key={i} className="tli-dl-gone">
                <span className="visually-hidden">Removed: </span>
                <s>
                  {box(l.done)}
                  {l.text}
                </s>
              </li>
            );
        }
      })}
    </ul>
  );
}

function Cell({ r, f }: { r: TimelineImportRowDto; f: TimelineImportField }) {
  if (f === 'deliverables' && r.deliverables && !r.errors.some((e) => e.field === f)) {
    const loses = r.result !== 'NEW' && deliverablesLose(r.deliverables);
    const tone = loses ? ' tli-loss' : r.changes.includes('deliverables') ? ' tli-chg' : '';
    return (
      <td className={`tli-cell${tone}`}>
        {r.deliverables.lines.length === 0 ? (
          <span className="text-body-secondary">—</span>
        ) : (
          <DeliverablesLines d={r.deliverables} cleared={r.clears.includes('deliverables')} />
        )}
      </td>
    );
  }
  const value = r.values[f];
  const ro = BASELINE.includes(f);
  const bad = r.errors.some((e) => e.field === f);
  const changed = PLAN.has(f) && r.changes.includes(f as TimelinePlanField);
  const cleared = changed && r.clears.includes(f as TimelinePlanField);
  const old = changed ? r.old[f as TimelinePlanField] : undefined;
  // UIE §4.4 (c5e0ee8): an owner the import can't use ("doesn't exist", "can't own tasks").
  const noOwner = f === 'owner' && Boolean(value) && r.warnings.some((w) => w.field === 'owner');
  const cls = [
    'tli-cell',
    `tli-f-${f}`,
    noOwner ? 'tli-nown' : '',
    bad ? 'tli-bad' : '',
    changed && !bad ? 'tli-chg' : '',
    ro ? 'tli-ro' : '',
    DATE_FIELDS.includes(f) ? 'tli-date' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <td className={cls}>
      {value ? (
        f === 'deliverables' ? (
          <span className="tli-pre">{value}</span>
        ) : (
          breakable(f, value)
        )
      ) : cleared ? (
        <span className="text-danger">(blank)</span>
      ) : (
        <span className="text-body-secondary">—</span>
      )}
      {noOwner && <span className="tli-noown">No owner</span>}
      {old !== undefined && f !== 'deliverables' && (
        <s className="tli-was">{old ? breakable(f, old) : 'blank'}</s>
      )}
    </td>
  );
}

export function ChecklistImportModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName?: string;
  onClose: () => void;
}) {
  const preview = useChecklistImportPreview(projectId);
  const commit = useChecklistImportCommit(projectId);
  const committing = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<TimelineImportCommitDto | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const chosen = useRef(0);

  const reset = () => {
    chosen.current++; // a row count still running for an earlier file is dropped
    setCounting(false);
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
    const mine = ++chosen.current;
    setCounting(true);
    void localProblem(f).then((local) => {
      if (mine !== chosen.current) return; // another file was chosen meanwhile
      setCounting(false);
      if (local) {
        setFile(null);
        return setProblem(local);
      }
      check(f);
    });
  };
  const template = () => {
    setTplError(null);
    downloadChecklistTemplate(projectId).catch((e: unknown) =>
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
          <h3 className="h5 mb-2">Checklist imported</h3>
          <p className="mb-1">{importDoneLine(done)}</p>
          <p className="mb-1">
            {[deliverablesDoneLine(done.deliverables), COPY.NOTHING_DELETED]
              .filter(Boolean)
              .join(' ')}
          </p>
          {done.addedMembers > 0 && <p className="mb-1">{addedMembersLine(done.addedMembers)}</p>}
          <p className="small text-body-secondary">{COPY.UP_TO_DATE}</p>
          <Button onClick={onClose}>Back to checklist</Button>
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
  } else if (preview.isPending || counting) {
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
          <strong>{COPY.NEVER_DELETES_LEAD}</strong> {COPY.NEVER_DELETES_REST}{' '}
          <strong>{COPY.DELIVERABLES_LEAD}</strong> {COPY.DELIVERABLES_REST}
        </Alert>
        <DropZone onFile={choose} />
        <p className="small text-body-secondary mb-0">
          To edit this project&apos;s plan, use <strong>Excel › Download checklist (.xlsx)</strong>{' '}
          on the Checklist, change the file, then import it here. To start from scratch,{' '}
          <Button variant="link" className="p-0 align-baseline small" onClick={template}>
            download the template
          </Button>
          ; every row in it imports as a new task. Dates as a date cell or YYYY-MM-DD. Deliverables:
          one item per line in the cell (Alt+Enter for a new line); put [x] in front of a done item.
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
      // CR-23 "Removes or clears": blank cells that clear a field, and lost deliverable items.
      losses: rows.filter(
        (r) =>
          r.result !== 'ERROR' &&
          r.result !== 'UNCHANGED' &&
          (r.clears.length > 0 ||
            (r.result !== 'NEW' && r.deliverables !== null && deliverablesLose(r.deliverables))),
      ),
      new: rows.filter((r) => r.result === 'NEW'),
      update: rows.filter((r) => r.result === 'UPDATE'),
    };
    const allChips: [Filter, string, number, string][] = [
      ['all', 'All', rows.length, 'secondary'],
      ['errors', 'Errors', data.counts.error, 'danger'],
      ['changed', 'Changed since export', data.counts.changed, 'warning'],
      ['losses', 'Removes or clears', lists.losses.length, 'danger'],
      ['new', 'New', data.counts.new, 'info'],
      ['update', 'Update', data.counts.update, 'primary'],
    ];
    // UIE §4.3: Errors (and Changed since export) only when there are some.
    const chips = allChips.filter(
      ([key, , count]) => (key !== 'errors' && key !== 'changed') || count > 0,
    );
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
        : TIMELINE_ROW_HELP_CLEAN;
    const newRows = rows.filter((r) => r.result === 'NEW' && r.willBe !== null);
    // UIE #51: an older Timeline file has no Deliverables column, so the preview doesn't show one.
    const shownFields = data.noDeliverablesColumn
      ? TIMELINE_VISIBLE_FIELDS.filter((f) => f !== 'deliverables')
      : TIMELINE_VISIBLE_FIELDS;
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
              ? `Downloaded from this project${projectName ? ` (${projectName})` : ''} ${exportedOn(data.exported.at)}`
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
        {data.counts.losesDeliverables > 0 && (
          <Alert tone="warning" icon="bx-error">
            <strong>{deliverablesLostLead(data.counts.losesDeliverables)}</strong>{' '}
            {DELIVERABLES_LOST_REST}{' '}
            <Button
              variant="link"
              className="p-0 align-baseline"
              onClick={() => setFilter('losses')}
            >
              Show these rows
            </Button>
          </Alert>
        )}
        {data.addMembers.length > 0 && (
          <Alert tone="info" icon="bx-group">
            <span data-testid="team-additions">
              <strong>{addMembersLead(data.addMembers.length)}</strong> {data.addMembers.join(', ')}
              . {ADD_MEMBERS_REST}
            </span>
          </Alert>
        )}
        {data.newPhases.map((name) => (
          <Alert key={name} tone="info" icon="bx-layer-plus">
            {newPhaseNotice(name)}
          </Alert>
        ))}
        {data.noDeliverablesColumn && (
          <p className="small text-body-secondary mb-2" data-testid="legacy-sheet-note">
            <i className="bx bx-info-circle me-1" aria-hidden="true" />
            {COPY.LEGACY_SHEET}
          </p>
        )}
        {data.baselineFilled && (
          <Alert tone="secondary" icon="bx-lock-alt">
            <strong>{COPY.BASELINE_IGNORED_LEAD}</strong>, so they aren&apos;t shown here. Click{' '}
            <strong>Save baseline</strong> on the Timeline after importing to update the baseline.
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
                {shownFields.map((f) => (
                  <th
                    scope="col"
                    key={f}
                    title={
                      BASELINE.includes(f) ? 'Ignored on import. Use Save baseline.' : undefined
                    }
                  >
                    {/* UIE retest: headers wrap onto two lines ("Baseline / start 🔒"); the lock
                        stays with the last word. */}
                    {headWords(TIMELINE_COLUMN_LABEL[f]).head}
                    <span className="text-nowrap">
                      {headWords(TIMELINE_COLUMN_LABEL[f]).last}
                      {BASELINE.includes(f) && (
                        <i className="bx bx-lock-alt ms-1" aria-label="ignored on import" />
                      )}
                    </span>
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
                  {shownFields.map((f) => (
                    <Cell key={f} r={r} f={f} />
                  ))}
                </tr>
              ))}
              {lists[filter].length === 0 && (
                <tr>
                  <td
                    colSpan={shownFields.length + 2}
                    className="text-center text-body-secondary py-4"
                  >
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
          {!data.noDeliverablesColumn && ` ${COPY.FOOTNOTE_DELIVERABLES}`}
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
      aria-labelledby="checklist-import-title"
    >
      <Modal.Header closeButton={!busy}>
        <Modal.Title id="checklist-import-title">Import checklist from Excel</Modal.Title>
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
