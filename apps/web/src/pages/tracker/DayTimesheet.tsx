import {
  AUTO_STOPPED_LABEL,
  NOT_SUBMITTED_LABEL,
  addDays,
  formatHHMM,
  formatTime12,
  parseDateOnly,
  toDateOnly,
  type Ref,
  type TrackerDayDto,
  type TrackerEntryDto,
} from '@xc8/shared';
import { useState } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import {
  useLookups,
  useTrackerDay,
  useTrackerMutation,
  useTrackerPeople,
} from '../../api/trackerHooks';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { ReasonModal } from '../../components/ReasonModal';
import {
  TrackerEntryModal,
  type TrackerModalMode,
} from '../../components/tracker/TrackerEntryModal';
import { longDay, phDateTime, shortDate } from '../../lib/format';

const shift = (d: string, n: number) => toDateOnly(addDays(parseDateOnly(d), n));

export function DayStatusBadge({ day }: { day: TrackerDayDto }) {
  if (day.status === 'SUBMITTED')
    return <span className="badge bg-label-success">✓ Submitted</span>;
  if (day.notSubmitted) return <span className="badge bg-label-danger">{NOT_SUBMITTED_LABEL}</span>;
  if (day.status === 'REOPENED') return <span className="badge bg-label-warning">Reopened</span>;
  return <span className="badge bg-label-secondary">{NOT_SUBMITTED_LABEL}</span>;
}

function entryName(e: TrackerEntryDto) {
  return e.kind === 'QUICK' ? (e.title ?? '') : (e.task?.name ?? '');
}

/** Location chip with "Change" (FR-ACT-17). */
export function LocationChip({ day, editable }: { day: TrackerDayDto; editable: boolean }) {
  const lists = useLookups();
  const save = useTrackerMutation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  return (
    <span className="d-inline-flex align-items-center gap-2">
      <span className="badge bg-label-info">
        <i className="bx bx-map me-1" aria-hidden="true" />
        {day.location?.name ?? 'Location not set'}
      </span>
      {editable && (
        <Button
          variant="link"
          size="sm"
          className="p-0"
          onClick={() => {
            setValue(day.location?.id ?? '');
            setOpen(true);
          }}
        >
          Change
        </Button>
      )}
      {open && (
        <Modal show onHide={() => setOpen(false)} centered aria-labelledby="day-location-title">
          <Modal.Header closeButton>
            <Modal.Title as="h2" className="h5" id="day-location-title">
              Where are you working on {shortDate(day.date)}?
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <ErrorAlert error={save.error} />
            <Form.Group controlId="day-location">
              <Form.Label>Location</Form.Label>
              <Form.Select value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Choose…</option>
                {(lists.data?.locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Form.Select>
              <Form.Text>
                Entries that follow the day's location change with it; changed entries keep theirs.
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!value || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    path: `/days/${day.date}/location`,
                    method: 'PUT',
                    body: { locationId: value },
                  },
                  { onSuccess: () => setOpen(false) },
                )
              }
            >
              Save
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </span>
  );
}

/**
 * Day timesheet (doc 14 FR-ACT-10..14, §10; mockup v0.8.7 daysheet): every timed entry of a day,
 * hours rendered, Submit day, reopen history. Supervisors and Admins pick a person and view only.
 */
export function DayTimesheet({ today, initialDate }: { today: string; initialDate?: string }) {
  const { user } = useAuth();
  const [date, setDate] = useState(initialDate ?? today);
  const [person, setPerson] = useState<string>('');
  const people = useTrackerPeople();
  const others = (people.data ?? []).filter((p: Ref) => p.id !== user?.id);
  const day = useTrackerDay(date, person || undefined);
  const save = useTrackerMutation();
  const [modal, setModal] = useState<TrackerModalMode | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [reopening, setReopening] = useState(false);
  const d = day.data;
  const running = d?.entries.some((e) => e.running);

  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
        <div className="btn-group" role="group" aria-label="Choose day">
          <Button
            variant="outline-secondary"
            size="sm"
            aria-label="Previous day"
            onClick={() => setDate(shift(date, -1))}
          >
            ‹
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            disabled={date >= today}
            aria-label="Next day"
            onClick={() => setDate(shift(date, 1))}
          >
            ›
          </Button>
        </div>
        <strong className="text-heading">{longDay(date)}</strong>
        <Form.Control
          type="date"
          size="sm"
          max={today}
          value={date}
          aria-label="Date"
          style={{ maxWidth: 160 }}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        {d && <LocationChip day={d} editable={d.can.edit} />}
        {d && <DayStatusBadge day={d} />}
        {d?.leave && <span className="badge bg-label-primary">{d.leave}</span>}
        {others.length > 0 && (
          <Form.Select
            size="sm"
            aria-label="Person"
            value={person}
            style={{ maxWidth: 220 }}
            className="ms-auto"
            onChange={(e) => setPerson(e.target.value)}
          >
            <option value="">My timesheet</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Form.Select>
        )}
      </div>
      <ErrorAlert error={day.error} />
      <ErrorAlert error={save.error} />
      {day.isPending ? (
        <LoadingRows />
      ) : d ? (
        <>
          {d.reopened.map((r) => (
            <div className="alert alert-warning py-2" role="status" key={r.at}>
              ↺ Reopened by {r.by.name} on {phDateTime(r.at)} · Reason: "{r.reason}"
            </div>
          ))}
          {d.status === 'SUBMITTED' && d.submittedAt && (
            <div className="alert alert-success py-2" role="status">
              ✓ Submitted {phDateTime(d.submittedAt)} · entries locked
            </div>
          )}
          {d.notSubmitted && d.status !== 'SUBMITTED' && !d.can.edit && (
            <div className="alert alert-secondary py-2" role="status">
              🔒 {shortDate(d.date)} wasn't submitted. It was locked as it stood at the weekly lock.
            </div>
          )}
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            {d.can.edit && (
              <Button
                size="sm"
                variant="outline-primary"
                onClick={() => setModal({ kind: 'add', date })}
              >
                + Add entry
              </Button>
            )}
            {d.can.submit && (
              <>
                <Button size="sm" disabled={running} onClick={() => setConfirmSubmit(true)}>
                  {date === today ? 'Submit day' : `Submit ${shortDate(date)}`}
                </Button>
                {running && (
                  <small className="text-warning">
                    Stop the running timer before submitting this day.
                  </small>
                )}
              </>
            )}
            {d.can.reopen && (
              <Button size="sm" variant="outline-warning" onClick={() => setReopening(true)}>
                Reopen day…{d.weekLocked ? ' (Admin)' : ''}
              </Button>
            )}
          </div>
          {d.entries.length === 0 ? (
            <EmptyState icon="bx-time" title={`No entries on ${shortDate(d.date)}`}>
              {d.can.edit
                ? 'Add an entry (asks for the day’s location first).'
                : 'Nothing was logged this day.'}
            </EmptyState>
          ) : (
            <div className="table-responsive">
              <table className="table table-stack-md">
                <thead>
                  <tr>
                    <th scope="col">Time in</th>
                    <th scope="col">Time out</th>
                    <th scope="col">Rendered</th>
                    <th scope="col">Project / task or activity</th>
                    <th scope="col">Activity type</th>
                    <th scope="col">Location</th>
                    <th scope="col">Billable</th>
                    <th scope="col">Module · Remarks</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.entries.map((e) => (
                    <tr key={e.id} data-testid={`entry-${e.id}`}>
                      <td data-label="Time in">
                        {e.startAt ? formatTime12(e.startAt) : 'Hours only'}
                      </td>
                      <td data-label="Time out">
                        {e.running ? (
                          <span className="badge bg-label-success">Running</span>
                        ) : e.endAt ? (
                          formatTime12(e.endAt)
                        ) : (
                          '–'
                        )}
                        {e.autoStopped && (
                          <span className="badge bg-label-warning d-block mt-1">
                            {AUTO_STOPPED_LABEL}
                          </span>
                        )}
                      </td>
                      <td data-label="Rendered" className="font-monospace">
                        {formatHHMM(e.minutes)}
                      </td>
                      <td className="cell-primary">
                        <span className="fw-medium">{entryName(e)}</span>
                        <div className="small text-body-secondary">
                          {e.kind === 'QUICK'
                            ? 'Quick activity'
                            : `${e.project?.name ?? ''}${e.client ? ` · ${e.client.name}` : ''}`}
                        </div>
                      </td>
                      <td data-label="Activity type">{e.activityType?.name ?? '–'}</td>
                      <td
                        data-label="Location"
                        className={e.locationOverridden ? 'fw-semibold' : 'text-body-secondary'}
                      >
                        {e.location?.name ?? '–'}
                        {e.locationOverridden && (
                          <span className="visually-hidden"> (changed)</span>
                        )}
                      </td>
                      <td data-label="Billable">{e.billable ? 'Yes' : 'No'}</td>
                      <td data-label="Module · Remarks">
                        {e.module?.name ?? '–'} · {e.notes ?? '–'}
                      </td>
                      <td className="text-end">
                        {d.can.edit && (
                          <Button
                            size="sm"
                            variant="link"
                            aria-label={`Edit ${entryName(e)}`}
                            onClick={() => setModal({ kind: 'edit', entry: e })}
                          >
                            ✎
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={2} scope="row">
                      Hours rendered
                    </th>
                    <td className="font-monospace fw-semibold" data-testid="hours-rendered">
                      {formatHHMM(d.totalMinutes)}
                    </td>
                    <td colSpan={6} className="small text-body-secondary">
                      Sum of time in/out pairs, exact minutes (running timer counted up to now)
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="small text-body-secondary mt-3 mb-0">
            Submit day locks the day's entries; before the weekly lock your supervisor or an Admin
            can reopen it with a reason. After the weekly lock only an Admin can reopen a day.
          </p>
        </>
      ) : null}
      {modal && <TrackerEntryModal mode={modal} onClose={() => setModal(null)} />}
      {confirmSubmit && d && (
        <Modal
          show
          onHide={() => setConfirmSubmit(false)}
          centered
          aria-labelledby="submit-day-title"
        >
          <Modal.Header closeButton>
            <Modal.Title as="h2" className="h5" id="submit-day-title">
              Submit {shortDate(d.date)}?
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {formatHHMM(d.totalMinutes)} in {d.entries.length}{' '}
            {d.entries.length === 1 ? 'entry' : 'entries'}. Submitting locks the day's entries.
            Before the weekly lock, your supervisor or an Admin can reopen it.
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setConfirmSubmit(false)}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate(
                  { path: `/days/${d.date}/submit` },
                  { onSettled: () => setConfirmSubmit(false) },
                )
              }
            >
              Submit day
            </Button>
          </Modal.Footer>
        </Modal>
      )}
      {reopening && d && (
        <ReasonModal
          title={`Reopen ${shortDate(d.date)} · ${d.user.name}`}
          label="Reason"
          confirmLabel="Reopen day"
          intro={`${d.user.name} can edit the day's entries again. The reason shows on the day, is recorded in the audit log, and ${d.user.name} gets an in-app notification.`}
          error={save.error}
          pending={save.isPending}
          onClose={() => setReopening(false)}
          onSubmit={(reason) =>
            save.mutate(
              { path: `/days/${d.date}/reopen`, body: { userId: d.user.id, reason } },
              { onSuccess: () => setReopening(false) },
            )
          }
        />
      )}
    </>
  );
}
