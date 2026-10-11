import {
  DAY_PARTS,
  DAY_PART_LABELS,
  FULL_DAY_AM_PM,
  LEAVE_REASON_HINT,
  mergeHalfDays,
  NO_SUPERVISOR_LEAVE,
  leaveRangeLabel,
  recordLeaveSchema,
  todayPH,
  toDateOnly,
  type DayPart,
  type LeaveBalanceDto,
  type LeaveDto,
  type LeaveRow,
} from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Dropdown, Form, Modal, Table } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import {
  useCancelLeave,
  useLeaveBalances,
  useLeaveTypes,
  useMyLeave,
  useRecordLeave,
  useTeamLeave,
} from '../../api/leaveHooks';
import { useAuth } from '../../auth/AuthContext';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { LeaveBalance } from '../../components/LeaveBalance';
import { daysLabel, shortDate } from '../../lib/format';

/** Days with a real minus sign (DR-38): the shared helper. */
const num = daysLabel;

/** DR-33: a merged AM + PM row reads "Full day (AM + PM)". */
const dayPartLabel = (l: LeaveRow) => (l.halves ? FULL_DAY_AM_PM : DAY_PART_LABELS[l.dayPart]);

/** Leave (doc 14 §4, Q-46: no approval; §16 FR-LV-11; mockup v0.8.7). */
export function LeavePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'team' ? 'team' : 'mine';
  const [recording, setRecording] = useState(false);
  return (
    <>
      <PageHeader title="Leave">
        <Button onClick={() => setRecording(true)} aria-label="Record leave" title="Record leave">
          <i className="bx bx-plus me-1" aria-hidden="true" />
          <span className="btn-collapse-label">Record leave</span>
        </Button>
      </PageHeader>
      <ul className="nav nav-tabs nav-scrollable mb-0" role="tablist">
        {(
          [
            ['mine', 'My leave'],
            ['team', 'Team on leave'],
          ] as const
        ).map(([key, label]) => (
          <li key={key} className="nav-item">
            <button
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`nav-link ${tab === key ? 'active' : ''}`}
              onClick={() => setParams(key === 'team' ? { tab: 'team' } : {}, { replace: true })}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
      <div className="card rounded-top-0">
        <div className="card-body">
          {tab === 'mine' ? <MyLeave onRecord={() => setRecording(true)} /> : <TeamLeaveTab />}
        </div>
      </div>
      {recording && <RecordLeaveModal onClose={() => setRecording(false)} />}
    </>
  );
}

function MyLeave({ onRecord }: { onRecord: () => void }) {
  const [year, setYear] = useState(todayPH().getUTCFullYear());
  const balances = useLeaveBalances(year);
  const leave = useMyLeave(year);
  const [cancelling, setCancelling] = useState<LeaveDto | null>(null);
  const today = toDateOnly(todayPH());
  return (
    <>
      {balances.data && !balances.data.supervisor && (
        <div className="alert alert-warning py-2" role="status">
          <span className="badge bg-label-warning me-2">Supervisor needed</span>
          {NO_SUPERVISOR_LEAVE}
        </div>
      )}
      <div className="d-flex align-items-center gap-2 mb-2">
        <h2 className="h6 mb-0 me-2">My balances</h2>
        <Button
          size="sm"
          variant="outline-secondary"
          aria-label="Previous year"
          onClick={() => setYear(year - 1)}
        >
          ‹
        </Button>
        <strong>{year}</strong>
        <Button
          size="sm"
          variant="outline-secondary"
          aria-label="Next year"
          onClick={() => setYear(year + 1)}
        >
          ›
        </Button>
        <span className="ms-auto small text-body-secondary">Calendar year Jan–Dec</span>
      </div>
      {balances.isLoading && <LoadingRows rows={3} />}
      {balances.error ? <ErrorAlert error={balances.error} /> : null}
      {balances.data && <BalancesTable items={balances.data.items} />}
      <p className="small text-body-secondary">
        Balance = entitlement + carry-over − recorded (past and future), in working days.
      </p>

      <h2 className="h6 mt-4">My leave</h2>
      {leave.isLoading && <LoadingRows rows={3} />}
      {leave.error ? <ErrorAlert error={leave.error} /> : null}
      {leave.data && leave.data.length === 0 && (
        <EmptyState
          icon="bx-sun"
          title="No leave recorded yet"
          action={<Button onClick={onRecord}>Record leave</Button>}
        >
          Leave you record shows here.
        </EmptyState>
      )}
      {leave.data && leave.data.length > 0 && (
        <div className="table-responsive">
          <Table size="sm" hover className="align-middle">
            <thead>
              <tr>
                <th>Dates</th>
                <th>Type</th>
                <th>Day part</th>
                <th className="text-end">Working days</th>
                <th>Recorded on</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mergeHalfDays(leave.data).map((l) => (
                <tr key={l.id}>
                  <td className="text-nowrap">{leaveRangeLabel(l.from, l.to)}</td>
                  <td>{l.type.name}</td>
                  <td>{dayPartLabel(l)}</td>
                  <td className="text-end">{l.days}</td>
                  <td className="text-nowrap">{shortDate(l.recordedAt.slice(0, 10))}</td>
                  <td>
                    {l.status === 'RECORDED' ? (
                      <span className="badge bg-label-success">Recorded</span>
                    ) : (
                      <span className="badge bg-label-secondary">Cancelled</span>
                    )}
                  </td>
                  <td className="text-end text-nowrap">
                    {l.halves && l.can.cancel ? (
                      <Dropdown align="end">
                        <Dropdown.Toggle size="sm" variant="outline-danger" id={`cancel-${l.id}`}>
                          Cancel
                        </Dropdown.Toggle>
                        <Dropdown.Menu>
                          {l.halves.map(
                            (h) =>
                              h.can.cancel && (
                                <Dropdown.Item
                                  key={h.id}
                                  as="button"
                                  onClick={() => setCancelling(h)}
                                >
                                  Cancel {h.dayPart === 'AM' ? 'morning (AM)' : 'afternoon (PM)'}
                                </Dropdown.Item>
                              ),
                          )}
                        </Dropdown.Menu>
                      </Dropdown>
                    ) : l.can.cancel ? (
                      <Button size="sm" variant="outline-danger" onClick={() => setCancelling(l)}>
                        Cancel
                      </Button>
                    ) : l.status === 'RECORDED' && l.from <= today ? (
                      <span className="small text-body-secondary">Past · Admin can cancel</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <p className="small text-body-secondary">
        No approval: recorded leave shows right away as &quot;On leave&quot; on My tasks and the
        report, and your supervisor gets an in-app notice. You can cancel leave that hasn&apos;t
        started; that restores your balance and tells your supervisor. Past leave can be cancelled
        only by an Admin. Everything is audited.
      </p>
      {cancelling && (
        <CancelLeaveModal
          leave={cancelling}
          supervisor={balances.data?.supervisor?.name ?? null}
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  );
}

function BalancesTable({ items }: { items: LeaveBalanceDto[] }) {
  return (
    <div className="table-responsive">
      <Table size="sm" className="align-middle">
        <thead>
          <tr>
            <th>Leave type</th>
            <th>Paid</th>
            <th className="text-end">Entitlement</th>
            <th className="text-end">Carry-over</th>
            <th className="text-end">Recorded</th>
            <th className="text-end">Balance</th>
          </tr>
        </thead>
        <tbody>
          {items.map((b) => (
            <tr key={b.type.id}>
              <td>{b.type.name}</td>
              <td>{b.type.paid ? 'Paid' : 'Unpaid'}</td>
              {b.type.paid && b.entitlement === null && b.recorded === 0 ? (
                <td colSpan={4} className="text-body-secondary">
                  No entitlement set for you
                </td>
              ) : (
                <>
                  <td className="text-end">{b.type.paid ? num(b.entitlement ?? 0) : '–'}</td>
                  <td className="text-end">{b.type.paid ? b.carryOver : '–'}</td>
                  <td className="text-end">{b.recorded}</td>
                  <td className="text-end">
                    <LeaveBalance value={b.balance} negative={b.negative} />
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function CancelLeaveModal({
  leave,
  supervisor,
  onClose,
}: {
  leave: LeaveDto;
  supervisor: string | null;
  onClose: () => void;
}) {
  const cancel = useCancelLeave();
  return (
    <Modal show onHide={onClose} centered aria-labelledby="cancel-leave-title">
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5" id="cancel-leave-title">
          Cancel this leave?
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <ErrorAlert error={cancel.error} />
        <p className="mb-2">
          {leave.type.name} · {leaveRangeLabel(leave.from, leave.to)} ·{' '}
          {DAY_PART_LABELS[leave.dayPart]} · {leave.days} working{' '}
          {leave.days === 1 ? 'day' : 'days'}
        </p>
        <p className="small mb-0">
          Your balance is restored and {supervisor ?? 'the Admins'} {supervisor ? 'is' : 'are'} told
          you cancelled. Recorded in the audit log.
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onClose}>
          Keep leave
        </Button>
        <Button
          variant="danger"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(leave.id, { onSuccess: onClose })}
        >
          Cancel leave
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export function RecordLeaveModal({
  onClose,
  initialDate,
}: {
  onClose: () => void;
  /** FR-LV-12: the Day timesheet's + Add leave opens the form for that date. */
  initialDate?: string;
}) {
  const types = useLeaveTypes();
  const year = todayPH().getUTCFullYear();
  const balances = useLeaveBalances(year);
  const record = useRecordLeave();
  const today = toDateOnly(todayPH());
  const [leaveTypeId, setType] = useState('');
  const [dayPart, setDayPart] = useState<DayPart>('FULL');
  const [from, setFrom] = useState(initialDate ?? today);
  const [to, setTo] = useState(initialDate ?? today);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const type = types.data?.find((t) => t.id === leaveTypeId);
  const bal = (id: string) => balances.data?.items.find((b) => b.type.id === id);
  const supervisor = balances.data?.supervisor?.name;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      leaveTypeId,
      dayPart,
      from,
      to: dayPart === 'FULL' ? to : from,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    const p = recordLeaveSchema.safeParse(body);
    if (!leaveTypeId) {
      setErrors({ leaveTypeId: 'Choose a leave type.' });
      return;
    }
    if (!p.success) {
      setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    record.mutate(p.data, {
      onSuccess: onClose,
      onError: (err) => {
        if (err instanceof ApiError) setErrors(err.fieldErrors());
      },
    });
  };
  const fieldError = Object.values(errors)[0];

  return (
    <Modal show onHide={onClose} centered aria-labelledby="record-leave-title">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5" id="record-leave-title">
            Record leave
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {record.error && !fieldError ? <ErrorAlert error={record.error} /> : null}
          <Form.Group className="mb-3" controlId="leave-type">
            <Form.Label>Leave type *</Form.Label>
            <Form.Select
              value={leaveTypeId}
              isInvalid={Boolean(errors.leaveTypeId)}
              onChange={(e) => {
                setType(e.target.value);
                const t = types.data?.find((x) => x.id === e.target.value);
                if (t?.unit === 'DAY') setDayPart('FULL');
              }}
            >
              <option value="">Choose…</option>
              {(types.data ?? []).map((t) => {
                const b = bal(t.id);
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.paid && b && b.balance !== null ? ` (balance ${b.balance})` : ''}
                  </option>
                );
              })}
            </Form.Select>
            <Form.Control.Feedback type="invalid">{errors.leaveTypeId}</Form.Control.Feedback>
          </Form.Group>
          <fieldset className="mb-3">
            <legend className="form-label fs-6">Day part *</legend>
            {DAY_PARTS.map((p) => (
              <Form.Check
                key={p}
                inline
                type="radio"
                id={`day-part-${p}`}
                name="dayPart"
                label={DAY_PART_LABELS[p]}
                checked={dayPart === p}
                disabled={p !== 'FULL' && type?.unit === 'DAY'}
                isInvalid={Boolean(errors.dayPart)}
                onChange={() => setDayPart(p)}
              />
            ))}
            {errors.dayPart && <div className="invalid-feedback d-block">{errors.dayPart}</div>}
            <Form.Text className="d-block">
              Half days are for leave types whose unit is half-day, on a single date.
            </Form.Text>
          </fieldset>
          <div className="d-flex gap-2 mb-3">
            <Form.Group controlId="leave-from" className="flex-fill">
              <Form.Label>{dayPart === 'FULL' ? 'From *' : 'Date *'}</Form.Label>
              <Form.Control
                type="date"
                value={from}
                isInvalid={Boolean(errors.from)}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (to < e.target.value) setTo(e.target.value);
                }}
              />
              <Form.Control.Feedback type="invalid">{errors.from}</Form.Control.Feedback>
            </Form.Group>
            {dayPart === 'FULL' && (
              <Form.Group controlId="leave-to" className="flex-fill">
                <Form.Label>To *</Form.Label>
                <Form.Control
                  type="date"
                  value={to}
                  isInvalid={Boolean(errors.to)}
                  onChange={(e) => setTo(e.target.value)}
                />
                <Form.Control.Feedback type="invalid">{errors.to}</Form.Control.Feedback>
              </Form.Group>
            )}
          </div>
          <Form.Group className="mb-3" controlId="leave-reason">
            <Form.Label>Reason</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Form.Text>{LEAVE_REASON_HINT}</Form.Text>
          </Form.Group>
          <p className="small text-body-secondary mb-0">
            Weekends and holidays aren&apos;t counted. No approval needed. It shows as On leave
            right away, and{' '}
            {supervisor ? `${supervisor} (your supervisor)` : 'all Admins (no supervisor set)'}{' '}
            {supervisor ? 'gets' : 'get'} an in-app notice.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={record.isPending}>
            Record leave
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

function TeamLeaveTab() {
  const { user } = useAuth();
  const team = useTeamLeave();
  const d = team.data;
  const paidTypes = d?.people[0]?.items.map((b) => b.type) ?? [];
  return (
    <>
      <h2 className="h6">
        Team on leave · next 30 days <span className="badge bg-label-secondary">Read-only</span>
      </h2>
      {team.isLoading && <LoadingRows rows={3} />}
      {team.error ? <ErrorAlert error={team.error} /> : null}
      {d && d.items.length === 0 && (
        <EmptyState icon="bx-sun" title="No team leave in the next 30 days" />
      )}
      {d && d.items.length > 0 && (
        <div className="table-responsive">
          <Table size="sm" className="align-middle">
            <thead>
              <tr>
                <th>Person</th>
                <th>Type</th>
                <th>Dates</th>
                <th>Day part</th>
                <th className="text-end">Working days</th>
                <th>Reason</th>
                <th>Recorded on</th>
              </tr>
            </thead>
            <tbody>
              {mergeHalfDays(d.items).map((l) => (
                <tr key={l.id}>
                  <td>{l.user.name}</td>
                  <td>{l.type.name}</td>
                  <td className="text-nowrap">{leaveRangeLabel(l.from, l.to)}</td>
                  <td>{dayPartLabel(l)}</td>
                  <td className="text-end">{l.days}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{l.reason ?? ''}</td>
                  <td className="text-nowrap">{shortDate(l.recordedAt.slice(0, 10))}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <p className="small text-body-secondary">
        {user?.systemRole === 'ADMIN' ? 'Everyone. ' : 'People who report to you. '}
        No approval: each person records their own leave and you get an in-app notice. Reasons are
        visible only to the person, their supervisor and Admins. Cancelled leave drops off this
        list.
      </p>
      {d && d.people.length > 0 && (
        <>
          <h2 className="h6 mt-4">My team&apos;s balances · {d.year}</h2>
          <div className="table-responsive">
            <Table size="sm" className="align-middle">
              <thead>
                <tr>
                  <th>Person</th>
                  {paidTypes.map((t) => (
                    <th key={t.id} className="text-end">
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.people.map((p) => (
                  <tr key={p.user.id}>
                    <td>
                      {p.user.name}
                      {p.noSupervisor && (
                        <span className="badge bg-label-warning ms-1">Supervisor needed</span>
                      )}
                    </td>
                    {p.items.map((b) => (
                      <td key={b.type.id} className="text-end">
                        <LeaveBalance value={b.balance} negative={b.negative} noLimit="–" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
