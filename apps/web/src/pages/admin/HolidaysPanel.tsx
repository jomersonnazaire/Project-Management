import {
  HOLIDAY_TYPES,
  HOLIDAY_TYPE_LABELS,
  HOLIDAY_TYPE_SHORT,
  HOLIDAY_TYPE_VARIANTS,
  KEEP_ONE_WORKING_DAY,
  WEEKDAYS,
  plural,
  type HolidayDto,
  type HolidayType,
  OFFICIAL_HOLIDAY_YEARS,
  PH_OFFICIAL_HOLIDAYS,
} from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { useCalendar, useCalendarMutation, useHolidayImpact } from '../../api/m3Hooks';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { TopbarActions } from '../../components/PageHeader';
import { shortDate } from '../../lib/format';

const weekday = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

/** Add or edit a holiday, warning how many open tasks are due that day (FR-CAL-02/03, AC-CAL-2). */
function HolidayModal({
  holiday,
  year,
  onClose,
}: {
  holiday: HolidayDto | null;
  year: number;
  onClose: () => void;
}) {
  const save = useCalendarMutation();
  const [form, setForm] = useState({
    date: holiday?.date ?? '',
    name: holiday?.name ?? '',
    type: (holiday?.type ?? 'REGULAR') as HolidayType,
    note: holiday?.note ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showTasks, setShowTasks] = useState(false);
  const changedDate = form.date !== (holiday?.date ?? '');
  const impact = useHolidayImpact(changedDate ? form.date : null);
  const clash =
    impact.data?.existing && impact.data.existing.id !== holiday?.id ? impact.data.existing : null;
  const n = impact.data?.count ?? 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!form.date) next.date = 'Enter the date.';
    if (!form.name.trim()) next.name = 'Name is required.';
    if (clash) {
      next.date = `${shortDate(form.date, true)} already has a holiday ("${clash.name}").`;
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    const body = {
      date: form.date,
      name: form.name.trim(),
      type: form.type,
      note: form.note.trim() || null,
    };
    save.mutate(
      holiday
        ? { path: `/holidays/${holiday.id}`, method: 'PATCH', body }
        : { path: '/holidays', body },
      {
        onSuccess: onClose,
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'DUPLICATE_HOLIDAY')
            setErrors({ date: err.message });
          else if (err instanceof ApiError) setErrors(err.fieldErrors());
        },
      },
    );
  };

  return (
    <Modal show onHide={onClose} centered aria-labelledby="holiday-title">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5" id="holiday-title">
            {holiday ? 'Edit holiday' : 'Add holiday'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!(save.error instanceof ApiError && save.error.code === 'DUPLICATE_HOLIDAY') && (
            <ErrorAlert error={save.error} action />
          )}
          <Form.Group className="mb-3" controlId="holiday-date">
            <Form.Label>Date *</Form.Label>
            <Form.Control
              type="date"
              min={`${year - 1}-01-01`}
              value={form.date}
              isInvalid={Boolean(errors.date || clash)}
              onChange={(e) => {
                setForm({ ...form, date: e.target.value });
                setErrors({ ...errors, date: '' });
              }}
            />
            <Form.Control.Feedback type="invalid">
              {errors.date ||
                (clash && `${shortDate(form.date, true)} already has a holiday ("${clash.name}").`)}
            </Form.Control.Feedback>
          </Form.Group>
          <Form.Group className="mb-3" controlId="holiday-name">
            <Form.Label>Name *</Form.Label>
            <Form.Control
              value={form.name}
              maxLength={120}
              isInvalid={Boolean(errors.name)}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Form.Control.Feedback type="invalid">{errors.name}</Form.Control.Feedback>
          </Form.Group>
          <Form.Group className="mb-3" controlId="holiday-type">
            <Form.Label>Type *</Form.Label>
            <Form.Select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as HolidayType })}
            >
              {HOLIDAY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {HOLIDAY_TYPE_LABELS[t]}
                </option>
              ))}
            </Form.Select>
            <Form.Text>
              Regular holidays and special non-working days are skipped in due dates. Special
              working days count as workdays.
            </Form.Text>
          </Form.Group>
          <Form.Group className="mb-3" controlId="holiday-note">
            <Form.Label>Note</Form.Label>
            <Form.Control
              value={form.note}
              maxLength={300}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Form.Group>
          {changedDate && n > 0 && !clash && form.type !== 'SPECIAL_WORKING' && (
            <div className="alert alert-warning py-2 mb-0" role="status">
              ⚠ {plural(n, 'task')} {n === 1 ? 'is' : 'are'} due on this day. Their due dates won't
              change.{' '}
              <Button
                variant="link"
                className="p-0 align-baseline"
                onClick={() => setShowTasks((x) => !x)}
              >
                Review the {plural(n, 'task')}
              </Button>
              {showTasks && (
                <ul className="small mt-2 mb-0">
                  {impact.data?.tasks.map((t) => (
                    <li key={t.id}>
                      <Link to={`/projects/${t.project.id}?task=${t.id}`} target="_blank">
                        {t.name}
                      </Link>{' '}
                      · {t.project.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Save holiday
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

/** Working days (FR-CAL-05, AC-CAL-3): at least one weekday always stays ticked. */
export function WorkingDaysCard({
  days,
  version,
  canEdit,
}: {
  days: number[];
  version: number;
  canEdit: boolean;
}) {
  const save = useCalendarMutation();
  const [ticked, setTicked] = useState<number[]>(days);
  const [guard, setGuard] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = [...ticked].sort().join() !== [...days].sort().join();

  const toggle = (d: number) => {
    setSaved(false);
    if (ticked.includes(d)) {
      if (ticked.length === 1) {
        // Unticking the last day leaves it ticked.
        setGuard(true);
        return;
      }
      setTicked(ticked.filter((x) => x !== d));
    } else setTicked([...ticked, d]);
    setGuard(false);
  };

  return (
    <div className="card mb-6">
      <div className="card-body">
        <h2 className="h6">Working days</h2>
        <ErrorAlert error={save.error} action />
        <div className="d-grid gap-2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {WEEKDAYS.map((w) => (
            <Form.Check
              key={w.day}
              id={`wd-${w.day}`}
              label={w.label}
              checked={ticked.includes(w.day)}
              disabled={!canEdit}
              onChange={() => toggle(w.day)}
            />
          ))}
        </div>
        {guard && (
          <div className="small text-danger mt-2" role="alert">
            {KEEP_ONE_WORKING_DAY}
          </div>
        )}
        <p className="small text-body-secondary mt-3">
          Due dates count only these days. Holidays still apply on top, and a special working day
          always counts. Changes affect new due dates only, never ones already set.
        </p>
        {canEdit && (
          <Button
            className="w-100"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(
                {
                  path: '/working-days',
                  method: 'PUT',
                  body: { days: [...ticked].sort(), version },
                },
                { onSuccess: () => setSaved(true) },
              )
            }
          >
            Save working days
          </Button>
        )}
        {saved && !dirty && (
          <div className="small text-success mt-2" role="status">
            Working days saved.
          </div>
        )}
      </div>
    </div>
  );
}

/** Admin › Holidays (FR-CAL-01..05): the year's holidays plus the working-day settings. */
export function HolidaysPanel() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [type, setType] = useState<string>('');
  const [editing, setEditing] = useState<HolidayDto | 'new' | null>(null);
  const cal = useCalendar(year);
  const mutation = useCalendarMutation();
  const canEdit = useCan('settings', 'edit');
  const [copied, setCopied] = useState<string | null>(null);
  const items = (cal.data?.holidays ?? []).filter((h) => !type || h.type === type);

  const copy = () => {
    if (
      !window.confirm(
        `Copy ${year - 1}'s holidays into ${year}? Dates already in ${year} are skipped.`,
      )
    )
      return;
    mutation.mutate(
      { path: '/holidays/copy', body: { fromYear: year - 1, toYear: year } },
      {
        onSuccess: (r) =>
          setCopied(
            `Copied ${plural(r.copied ?? 0, 'holiday')}${r.skipped ? `, skipped ${r.skipped}` : ''}.`,
          ),
      },
    );
  };
  const copyButton = canEdit && (
    <Button variant="outline-secondary" onClick={copy} disabled={mutation.isPending}>
      Copy from {year - 1}…
    </Button>
  );
  // Seed data: the official Philippine holidays for the years we have (2026, 2027).
  const hasOfficial = OFFICIAL_HOLIDAY_YEARS.includes(year);
  // The toolbar offers loading only while some official date is still missing from the year.
  const listed = new Set((cal.data?.holidays ?? []).map((h) => h.date));
  const officialMissing = (PH_OFFICIAL_HOLIDAYS[year] ?? []).some((h) => !listed.has(h.date));
  const loadOfficial = () =>
    mutation.mutate(
      { path: '/holidays/official', body: { year } },
      {
        onSuccess: (r) =>
          setCopied(
            `Added ${plural(r.added ?? 0, 'official holiday')}${r.skipped ? `; ${r.skipped} already on the list were kept` : ''}.`,
          ),
      },
    );
  const officialButton = canEdit && hasOfficial && (
    <Button variant="outline-secondary" onClick={loadOfficial} disabled={mutation.isPending}>
      Load official PH holidays
    </Button>
  );

  return (
    <div className="row g-6">
      {/* DR-17: the primary action sits in the page header so the toolbar stays on one row. */}
      {canEdit && (
        <TopbarActions>
          <Button onClick={() => setEditing('new')}>+ Add holiday</Button>
        </TopbarActions>
      )}
      <div className="col-lg-8">
        <div className="card">
          <div className="card-body">
            <div className="d-flex flex-wrap align-items-center gap-2 mb-4">
              <Button
                variant="outline-secondary"
                size="sm"
                aria-label="Previous year"
                onClick={() => setYear(year - 1)}
              >
                <i className="bx bx-chevron-left" aria-hidden="true" />
              </Button>
              <h2 className="h5 mb-0" aria-live="polite">
                {year}
              </h2>
              <Button
                variant="outline-secondary"
                size="sm"
                aria-label="Next year"
                onClick={() => setYear(year + 1)}
              >
                <i className="bx bx-chevron-right" aria-hidden="true" />
              </Button>
              <Form.Select
                aria-label="Filter by type"
                className="ms-auto"
                style={{ maxWidth: 200 }}
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">All types</option>
                {HOLIDAY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {HOLIDAY_TYPE_LABELS[t]}
                  </option>
                ))}
              </Form.Select>
              {officialMissing && officialButton}
              {copyButton}
            </div>
            <ErrorAlert error={cal.error} />
            <ErrorAlert error={mutation.error} action />
            {copied && (
              <div className="alert alert-success py-2" role="status">
                {copied}
              </div>
            )}
            {cal.isPending ? (
              <LoadingRows />
            ) : (cal.data?.holidays.length ?? 0) === 0 ? (
              <EmptyState
                icon="bx-calendar"
                title={`No holidays for ${year} yet`}
                action={
                  <div className="d-flex flex-wrap justify-content-center gap-2">
                    {officialButton}
                    {copyButton}
                  </div>
                }
              >
                Due dates will count only the working days set here.
              </EmptyState>
            ) : items.length === 0 ? (
              <p className="text-body-secondary">No holidays of this type in {year}.</p>
            ) : (
              <div className="table-responsive">
                <table className="table table-stack-md">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Day</th>
                      <th scope="col">Name</th>
                      <th scope="col">Type</th>
                      <th scope="col">Note</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((h) => (
                      <tr key={h.id}>
                        <td className="cell-primary text-nowrap">{shortDate(h.date)}</td>
                        <td data-label="Day" className="text-body-secondary">
                          {weekday(h.date)}
                        </td>
                        <td data-label="Name" className="fw-medium text-heading">
                          {h.name}
                        </td>
                        <td data-label="Type">
                          <span className={`badge bg-label-${HOLIDAY_TYPE_VARIANTS[h.type]}`}>
                            {HOLIDAY_TYPE_SHORT[h.type]}
                          </span>
                        </td>
                        <td data-label="Note" className="small text-body-secondary">
                          {h.note ?? ''}
                        </td>
                        <td className="text-end text-nowrap">
                          {canEdit && (
                            <>
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 me-3"
                                aria-label={`Edit ${h.name}`}
                                onClick={() => setEditing(h)}
                              >
                                <i className="bx bx-edit-alt" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="link"
                                size="sm"
                                className="p-0 text-danger"
                                aria-label={`Remove ${h.name}`}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Remove ${h.name} (${shortDate(h.date, true)})? Existing due dates won't change.`,
                                    )
                                  ) {
                                    mutation.mutate({
                                      path: `/holidays/${h.id}`,
                                      method: 'DELETE',
                                    });
                                  }
                                }}
                              >
                                <i className="bx bx-trash" aria-hidden="true" />
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small text-body-secondary mt-3 mb-0">
              Admins enter each year's proclaimed holidays. Due dates skip regular holidays and
              special non-working days. A special working day counts as a workday, even on a
              Saturday or Sunday.
            </p>
          </div>
        </div>
      </div>
      <div className="col-lg-4">
        {cal.data && (
          <WorkingDaysCard
            key={`${cal.data.version}-${cal.data.workingDays.join()}`}
            days={cal.data.workingDays}
            version={cal.data.version}
            canEdit={canEdit}
          />
        )}
        <div className="card">
          <div className="card-body">
            <h2 className="h6">What changes</h2>
            <p className="small text-body-secondary mb-0">
              Adding a holiday never moves existing due dates; it only affects dates worked out from
              then on. Every change is logged.
            </p>
          </div>
        </div>
      </div>
      {editing && (
        <HolidayModal
          holiday={editing === 'new' ? null : editing}
          year={year}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
