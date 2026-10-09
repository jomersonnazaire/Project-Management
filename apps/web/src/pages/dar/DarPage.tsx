import {
  DAR_SEND_NOTE,
  DAR_SEND_PILL,
  changedAfterSaveMessage,
  darRangeSchema,
  formatLongDate,
  formatShortDate,
  formatTime12,
  phDateOf,
  rangeLabel,
  savedCopyNote,
  savedBeforeRenameNote,
  oldNameOnOlderCopiesNote,
  darExportName,
  DAR_EXPORT_NAME,
  todayPH,
  toDateOnly,
  type DarRange,
  type DarReportDto,
} from '@xc8/shared';
import { useState } from 'react';
import { Button, Form, Modal, Table } from 'react-bootstrap';
import { Link, NavLink, useSearchParams } from 'react-router-dom';
import { downloadFile } from '../../api/client';
import {
  useDar,
  useSaveReport,
  useSavedReport,
  useSavedReports,
  type SavedFilters,
} from '../../api/darHooks';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { DarReportView, SavedTagBadge } from './DarReportView';

/** "Oct 3, 2026 · 9:10 AM" in Philippine time (mockup v0.8.7). */
const savedOn = (iso: string) =>
  `${formatLongDate(phDateOf(new Date(iso)))} · ${formatTime12(iso).replace(/^0/, '')}`;

function Tabs({ active }: { active: 'report' | 'saved' }) {
  return (
    <ul className="nav nav-tabs nav-scrollable mb-0">
      <li className="nav-item">
        <NavLink end to="/dar" className={`nav-link ${active === 'report' ? 'active' : ''}`}>
          Report
        </NavLink>
      </li>
      <li className="nav-item">
        <NavLink to="/dar/saved" className={`nav-link ${active === 'saved' ? 'active' : ''}`}>
          Saved reports
        </NavLink>
      </li>
    </ul>
  );
}

/** No exports for a range without entries: there is nothing to put in the file (DR-42). */
const DAR_EXPORT_EMPTY = 'Nothing to export: no entries in this range.';

function ExportButtons({
  href,
  loading = false,
  empty = false,
}: {
  href: (fmt: 'pdf' | 'xlsx') => string;
  /** No report yet (first preview still loading). */
  loading?: boolean;
  /** The range has no entries (leave lines don't count): both exports are disabled (DR-42). */
  empty?: boolean;
}) {
  const disabled = loading || empty;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (fmt: 'pdf' | 'xlsx') => {
    setError(null);
    setBusy(fmt);
    try {
      await downloadFile(href(fmt), `DAR.${fmt}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Button
        variant="outline-secondary"
        disabled={disabled || busy !== null}
        aria-describedby={empty ? 'dar-export-empty' : undefined}
        onClick={() => run('pdf')}
      >
        <i className="bx bx-download me-1" aria-hidden="true" />
        Export PDF
      </Button>
      <Button
        variant="outline-secondary"
        disabled={disabled || busy !== null}
        aria-describedby={empty ? 'dar-export-empty' : undefined}
        onClick={() => run('xlsx')}
      >
        <i className="bx bx-download me-1" aria-hidden="true" />
        Export Excel
      </Button>
      {empty && (
        <span id="dar-export-empty" className="small text-body-secondary align-self-center">
          {DAR_EXPORT_EMPTY}
        </span>
      )}
      {error ? <ErrorAlert error={error} /> : null}
    </>
  );
}

/** Daily Accomplishment Report: view, save and export (doc 14 §3, §14, §15; mockup v0.8.7). */
export function DarPage() {
  const [params, setParams] = useSearchParams();
  const today = toDateOnly(todayPH());
  const [from, setFrom] = useState(params.get('from') ?? today);
  const [to, setTo] = useState(params.get('to') ?? params.get('from') ?? today);
  const [range, setRange] = useState<DarRange | null>(() => {
    const p = darRangeSchema.safeParse({ from, to });
    return p.success ? p.data : null;
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedId, setSavedId] = useState<string | null>(null);
  const report = useDar(range);
  const save = useSaveReport();

  const preview = (f = from, t = to) => {
    const p = darRangeSchema.safeParse({ from: f, to: t });
    if (!p.success) {
      setFieldErrors(
        Object.fromEntries(p.error.issues.map((i) => [String(i.path[0] ?? 'to'), i.message])),
      );
      return;
    }
    setFieldErrors({});
    setSavedId(null);
    setRange(p.data);
    setParams({ from: p.data.from, to: p.data.to }, { replace: true });
  };

  const r = report.data;
  return (
    <>
      <PageHeader title="Daily Accomplishment Report" />
      <Tabs active="report" />
      <div className="card rounded-top-0">
        <div className="card-body">
          <Form
            className="d-flex flex-wrap gap-2 align-items-start mb-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              preview();
            }}
          >
            <Form.Group controlId="dar-from">
              <Form.Label className="small mb-0">From</Form.Label>
              <Form.Control
                type="date"
                value={from}
                max={today}
                isInvalid={Boolean(fieldErrors.from)}
                onChange={(e) => setFrom(e.target.value)}
              />
              <Form.Control.Feedback type="invalid">{fieldErrors.from}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group controlId="dar-to">
              <Form.Label className="small mb-0">To</Form.Label>
              <Form.Control
                type="date"
                value={to}
                isInvalid={Boolean(fieldErrors.to)}
                onChange={(e) => setTo(e.target.value)}
              />
              <Form.Control.Feedback type="invalid">{fieldErrors.to}</Form.Control.Feedback>
            </Form.Group>
            <div className="d-flex flex-wrap gap-2 align-self-end dar-actions">
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setFrom(today);
                  setTo(today);
                  preview(today, today);
                }}
              >
                Today
              </Button>
              <Button type="submit">Preview</Button>
              <Button
                variant="success"
                disabled={!r || !range || save.isPending}
                onClick={async () => {
                  if (!range) return;
                  const item = await save.mutateAsync(range).catch(() => null);
                  if (item) setSavedId(item.id);
                }}
              >
                Save report
              </Button>
              {range && (
                <ExportButtons
                  loading={!r}
                  empty={r?.totalActivities === 0}
                  href={(fmt) => `/dar/export/${fmt}?from=${range.from}&to=${range.to}`}
                />
              )}
            </div>
          </Form>
          {save.error ? <ErrorAlert error={save.error} /> : null}
          {savedId && (
            <div className="alert alert-success py-2" role="status">
              Report saved. <Link to="/dar/saved">View saved reports</Link>
            </div>
          )}
          <p className="small text-body-secondary mb-2">
            Default today · max 31 days · Philippine time · future days left out
          </p>
          <p className="small mb-3">
            <span className="badge bg-label-secondary me-2">{DAR_SEND_PILL}</span>
            {DAR_SEND_NOTE}
          </p>
          {report.isLoading && <LoadingRows rows={4} />}
          {report.error ? <ErrorAlert error={report.error} /> : null}
          {r && (
            <>
              <DayStatusLine report={r} />
              <RecipientsLine report={r} />
              {r.rows.length === 0 ? (
                <EmptyState icon="bx-time-five" title="No time entries in this range">
                  Try another date range, or log time in{' '}
                  <Link to="/my-tasks">My tasks › Today</Link>.
                </EmptyState>
              ) : (
                <div className="border rounded p-3">
                  <div className="small text-body-secondary mb-2">
                    Preview · PDF and Excel exports use this layout
                  </div>
                  <DarReportView report={r} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Not part of the report: each day's submit state (FR-ACT-14), leave and running timers. */
function DayStatusLine({ report }: { report: DarReportDto }) {
  if (!report.days.length) return null;
  const leaveDays = report.days.filter((d) => d.leave);
  return (
    <div className="alert alert-secondary py-2 small" data-testid="dar-day-status">
      <strong>Day status in this range (not part of the report):</strong>{' '}
      {report.days.map((d, i) => (
        <span key={d.date}>
          {i > 0 && ' · '}
          {formatShortDate(d.date)}{' '}
          <span
            className={`badge ${
              d.status === 'Submitted'
                ? 'bg-label-success'
                : d.status === 'Reopened'
                  ? 'bg-label-info'
                  : 'bg-label-warning'
            }`}
          >
            {d.status}
          </span>
          {d.reopenedBy ? ` by ${d.reopenedBy}` : ''}
          {d.leave ? ` (${d.leave})` : ''}
        </span>
      ))}
      {leaveDays.length === 0 ? ' · No leave days.' : ''} Days not submitted are still included.
      {report.runningExcluded > 0
        ? " A running timer isn't included until you press Time out."
        : ''}
    </div>
  );
}

function RecipientsLine({ report }: { report: DarReportDto }) {
  return (
    <p className="small text-body-secondary">
      Supervisor: {report.supervisor?.name ?? 'Not set'} · CC:{' '}
      {report.cc.length ? report.cc.join(', ') : 'None'}{' '}
      <span className="badge bg-label-secondary">Set by Admin</span>
    </p>
  );
}

/** My saved reports (FR-DAR-11 to -16): private, read-only, newest first, no deletes. */
export function SavedReportsPage() {
  const [filters, setFilters] = useState<SavedFilters>({ label: 'ALL' });
  const [open, setOpen] = useState<string | null>(null);
  const list = useSavedReports(filters);
  const items = list.data ?? [];
  const filtered = Boolean(
    filters.from || filters.to || (filters.label && filters.label !== 'ALL'),
  );
  return (
    <>
      <PageHeader title="My saved reports" />
      <Tabs active="saved" />
      <div className="card rounded-top-0">
        <div className="card-body">
          <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
            <Form.Group controlId="saved-from">
              <Form.Label className="small mb-0">Saved from</Form.Label>
              <Form.Control
                type="date"
                value={filters.from ?? ''}
                onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
              />
            </Form.Group>
            <Form.Group controlId="saved-to">
              <Form.Label className="small mb-0">To</Form.Label>
              <Form.Control
                type="date"
                value={filters.to ?? ''}
                onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })}
              />
            </Form.Group>
            <Form.Group controlId="saved-label">
              <Form.Label className="small mb-0">Label</Form.Label>
              <Form.Select
                value={filters.label ?? 'ALL'}
                onChange={(e) =>
                  setFilters({ ...filters, label: e.target.value as SavedFilters['label'] })
                }
              >
                <option value="ALL">All</option>
                <option value="LATEST">Latest</option>
                <option value="EARLIER">Earlier version</option>
              </Form.Select>
            </Form.Group>
          </div>
          <p className="small text-body-secondary">
            Reports you saved, newest first. Each save is final and kept as a read-only copy. When
            you save exactly the same range again, the newest is &quot;Latest&quot; and older ones
            are &quot;Earlier version&quot;. An overlapping range is a separate report with no tag.
            Only you can see them. Saved reports can&apos;t be edited or deleted.
          </p>
          <p className="small text-body-secondary">
            <b>Old app name on older copies:</b> {oldNameOnOlderCopiesNote()}
          </p>
          {list.isLoading && <LoadingRows rows={3} />}
          {list.error ? <ErrorAlert error={list.error} /> : null}
          {list.data && items.length === 0 && !filtered && (
            <EmptyState icon="bx-archive" title="No saved reports yet">
              <Link to="/dar">Create a report</Link> and press Save report.
            </EmptyState>
          )}
          {list.data && items.length === 0 && filtered && (
            <EmptyState icon="bx-search" title="No saved reports match these filters">
              <Button variant="link" className="p-0" onClick={() => setFilters({ label: 'ALL' })}>
                Clear filters
              </Button>
            </EmptyState>
          )}
          {items.length > 0 && (
            <div className="table-responsive">
              <Table hover size="sm" className="align-middle">
                <thead>
                  <tr>
                    <th>Saved on (PH)</th>
                    <th>Range</th>
                    <th className="text-end">Activities</th>
                    <th className="text-end">Total hours</th>
                    <th>Label</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className="text-nowrap">{savedOn(i.savedAt)}</td>
                      <td className="text-nowrap">{rangeLabel(i.from, i.to)}</td>
                      <td className="text-end">{i.totalActivities}</td>
                      <td className="text-end">{i.totalRendered}</td>
                      <td>
                        <SavedTagBadge tag={i.tag} />
                        {i.changedDates.length > 0 && (
                          <span className="badge bg-label-warning ms-1">Changed after saving</span>
                        )}
                      </td>
                      <td className="text-end">
                        <Button size="sm" variant="outline-primary" onClick={() => setOpen(i.id)}>
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </div>
      </div>
      {open && <SavedReportModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SavedReportModal({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useSavedReport(id);
  const s = q.data;
  return (
    <Modal show onHide={onClose} size="xl" scrollable aria-labelledby="saved-title">
      <Modal.Header closeButton>
        <Modal.Title id="saved-title" className="d-flex flex-wrap gap-2 align-items-center">
          Saved report · {s ? rangeLabel(s.from, s.to) : '…'}
          <span className="badge bg-label-secondary">Read-only</span>
          {s?.tag && <SavedTagBadge tag={s.tag} />}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {q.isLoading && <LoadingRows rows={4} />}
        {q.error ? <ErrorAlert error={q.error} /> : null}
        {s && (
          <>
            <div className="d-flex flex-wrap gap-2 mb-3">
              <ExportButtons
                empty={s.totalActivities === 0}
                href={(fmt) => `/dar/saved/${s.id}/export/${fmt}`}
              />
            </div>
            <p className="small">{savedCopyNote(savedOn(s.savedAt).replace(' ·', ','))}</p>
            {darExportName(s.report) !== DAR_EXPORT_NAME && (
              <p className="small text-body-secondary" data-testid="old-name-note">
                {savedBeforeRenameNote()}
              </p>
            )}
            {s.changedDates.map((d) => (
              <div key={d} className="alert alert-info py-2 small">
                {changedAfterSaveMessage(formatShortDate(d))}.{' '}
                <Link to={`/dar?from=${s.from}&to=${s.to}`} onClick={onClose}>
                  Create a new report
                </Link>
              </div>
            ))}
            <DarReportView report={s.report} />
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}
