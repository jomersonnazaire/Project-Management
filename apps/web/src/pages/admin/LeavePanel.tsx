import { LEAVE_UNITS, todayPH, type EntitlementRowDto, type LeaveTypeDto } from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form, Modal, Table } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import {
  useAllLeaveTypes,
  useEntitlements,
  useLeaveTypeMutation,
  useSetEntitlement,
} from '../../api/leaveHooks';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { exportCsv } from '../../lib/reportCsv';

/** Admin › Leave: leave types (FR-LV-01) and yearly entitlements (FR-LV-02, EC-79). */
export function LeavePanel() {
  const types = useAllLeaveTypes();
  const canEdit = useCan('settings', 'edit');
  const [editing, setEditing] = useState<LeaveTypeDto | 'new' | null>(null);
  return (
    <>
      <div className="card mb-6">
        <div className="card-header d-flex align-items-center">
          <h2 className="h5 mb-0 me-auto">Leave types</h2>
          {canEdit && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <i className="bx bx-plus me-1" aria-hidden="true" />
              Leave type
            </Button>
          )}
        </div>
        <div className="card-body">
          {types.isLoading && <LoadingRows rows={4} />}
          {types.error ? <ErrorAlert error={types.error} /> : null}
          {types.data && types.data.length === 0 && (
            <EmptyState icon="bx-sun" title="No leave types yet">
              Add the types HR has confirmed.
            </EmptyState>
          )}
          {types.data && types.data.length > 0 && (
            <div className="table-responsive">
              <Table size="sm" className="align-middle">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Paid</th>
                    <th>Unit</th>
                    <th>Needs document</th>
                    <th>Carry-over limit</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {types.data.map((t) => (
                    <tr key={t.id} className={t.active ? undefined : 'text-body-secondary'}>
                      <td>
                        {t.name}
                        {!t.active && (
                          <span className="badge bg-label-secondary ms-1">Inactive</span>
                        )}
                      </td>
                      <td>{t.paid ? 'Paid' : 'Unpaid'}</td>
                      <td>{t.unit === 'DAY' ? 'Day' : 'Half-day'}</td>
                      <td>{t.needsDocument ? 'Yes' : 'No'}</td>
                      <td>
                        {!t.paid
                          ? '–'
                          : t.carryOverLimit === null
                            ? 'None'
                            : `${t.carryOverLimit} days`}
                      </td>
                      <td className="text-end">
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            aria-label={`Edit ${t.name}`}
                            onClick={() => setEditing(t)}
                          >
                            <i className="bx bx-edit" aria-hidden="true" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <p className="small text-body-secondary mb-0">
            Starting list from FR-LV-01; values are examples for HR to confirm (Q-44, Q-45). Types
            in use are deactivated, not deleted.
          </p>
        </div>
      </div>
      {types.data && (
        <EntitlementsCard types={types.data.filter((t) => t.paid)} canEdit={canEdit} />
      )}
      {editing && (
        <LeaveTypeModal
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function LeaveTypeModal({ type, onClose }: { type: LeaveTypeDto | null; onClose: () => void }) {
  const save = useLeaveTypeMutation();
  const [name, setName] = useState(type?.name ?? '');
  const [paid, setPaid] = useState(type?.paid ?? true);
  const [unit, setUnit] = useState(type?.unit ?? 'DAY');
  const [needsDocument, setDoc] = useState(type?.needsDocument ?? false);
  const [limit, setLimit] = useState(type?.carryOverLimit?.toString() ?? '');
  const [active, setActive] = useState(type?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: 'Add a name.' });
      return;
    }
    const body = {
      name: name.trim(),
      paid,
      unit,
      needsDocument,
      carryOverLimit: limit === '' ? null : Number(limit),
      ...(type ? { active } : {}),
    };
    save.mutate(
      { id: type?.id, body },
      {
        onSuccess: onClose,
        onError: (err) => err instanceof ApiError && setErrors(err.fieldErrors()),
      },
    );
  };
  return (
    <Modal show onHide={onClose} centered aria-labelledby="leave-type-title">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5" id="leave-type-title">
            {type ? 'Edit leave type' : 'Add leave type'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {save.error && !Object.keys(errors).length ? <ErrorAlert error={save.error} /> : null}
          <Form.Group className="mb-3" controlId="lt-name">
            <Form.Label>Name *</Form.Label>
            <Form.Control
              value={name}
              isInvalid={Boolean(errors.name)}
              onChange={(e) => setName(e.target.value)}
            />
            <Form.Control.Feedback type="invalid">{errors.name}</Form.Control.Feedback>
          </Form.Group>
          <Form.Group className="mb-3" controlId="lt-paid">
            <Form.Label>Paid</Form.Label>
            <Form.Select value={paid ? 'y' : 'n'} onChange={(e) => setPaid(e.target.value === 'y')}>
              <option value="y">Paid</option>
              <option value="n">Unpaid</option>
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-3" controlId="lt-unit">
            <Form.Label>Unit</Form.Label>
            <Form.Select
              value={unit}
              onChange={(e) => setUnit(e.target.value as LeaveTypeDto['unit'])}
            >
              {LEAVE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u === 'DAY' ? 'Day' : 'Half-day'}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Check
            className="mb-3"
            id="lt-doc"
            label="Needs a document"
            checked={needsDocument}
            onChange={(e) => setDoc(e.target.checked)}
          />
          <Form.Group className="mb-3" controlId="lt-limit">
            <Form.Label>Carry-over limit (days)</Form.Label>
            <Form.Control
              type="number"
              min={0}
              step={0.5}
              value={limit}
              isInvalid={Boolean(errors.carryOverLimit)}
              onChange={(e) => setLimit(e.target.value)}
            />
            <Form.Control.Feedback type="invalid">{errors.carryOverLimit}</Form.Control.Feedback>
            <Form.Text>Leave empty for no carry-over limit.</Form.Text>
          </Form.Group>
          {type && (
            <Form.Check
              id="lt-active"
              label="Active (inactive types can't be chosen for new leave)"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

function EntitlementsCard({ types, canEdit }: { types: LeaveTypeDto[]; canEdit: boolean }) {
  const [year, setYear] = useState(todayPH().getUTCFullYear());
  const [typeId, setTypeId] = useState<string | undefined>(types[0]?.id);
  const rows = useEntitlements(year, typeId);
  const type = types.find((t) => t.id === typeId);
  return (
    <div className="card">
      <div className="card-header d-flex flex-wrap align-items-center gap-2">
        <h2 className="h5 mb-0 me-auto">Entitlements · {year}</h2>
        <Form.Select
          size="sm"
          aria-label="Leave type"
          style={{ width: 'auto' }}
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Form.Select>
        <Form.Control
          size="sm"
          type="number"
          aria-label="Year"
          style={{ width: 100 }}
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || year)}
        />
        <Button
          size="sm"
          variant="outline-secondary"
          disabled={!rows.data}
          onClick={() =>
            exportCsv(
              `leave-balances-${type?.name ?? ''}-${year}.csv`,
              [
                { label: 'Person', value: (r: EntitlementRowDto) => r.user.name },
                { label: 'Entitlement', value: (r) => r.entitlement ?? '' },
                { label: `Carry-over from ${year - 1}`, value: (r) => r.carryOver },
                { label: 'Taken', value: (r) => r.taken },
                { label: 'Balance', value: (r) => r.balance ?? '' },
              ],
              rows.data ?? [],
            )
          }
        >
          Export balances
        </Button>
      </div>
      <div className="card-body">
        {rows.isLoading && <LoadingRows rows={4} />}
        {rows.error ? <ErrorAlert error={rows.error} /> : null}
        {rows.data && type && (
          <div className="table-responsive">
            <Table size="sm" className="align-middle">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Entitlement</th>
                  <th>Carry-over from {year - 1}</th>
                  <th className="text-end">Taken</th>
                  <th className="text-end">Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.data.map((r) => (
                  <EntitlementRow
                    key={`${r.user.id}-${year}-${typeId}`}
                    row={r}
                    type={type}
                    canEdit={canEdit}
                  />
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <p className="small text-body-secondary mb-0">Every entitlement change is audited.</p>
      </div>
    </div>
  );
}

function EntitlementRow({
  row,
  type,
  canEdit,
}: {
  row: EntitlementRowDto;
  type: LeaveTypeDto;
  canEdit: boolean;
}) {
  const save = useSetEntitlement();
  const [days, setDays] = useState(row.entitlement?.toString() ?? '');
  const [carry, setCarry] = useState(String(row.carryOver));
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = days !== (row.entitlement?.toString() ?? '') || carry !== String(row.carryOver);
  return (
    <>
      <tr>
        <td>{row.user.name}</td>
        <td style={{ width: 120 }}>
          <Form.Control
            size="sm"
            type="number"
            min={0}
            step={0.5}
            aria-label={`${row.user.name} entitlement`}
            disabled={!canEdit}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </td>
        <td style={{ width: 120 }}>
          <Form.Control
            size="sm"
            type="number"
            min={0}
            step={0.5}
            aria-label={`${row.user.name} carry-over`}
            disabled={!canEdit}
            value={carry}
            onChange={(e) => setCarry(e.target.value)}
          />
        </td>
        <td className="text-end">{row.taken}</td>
        <td className="text-end">
          {row.balance ?? '–'}
          {row.negative && <span className="badge bg-label-danger ms-1">Negative</span>}
        </td>
        <td className="text-end">
          {canEdit && (
            <Button
              size="sm"
              variant="outline-primary"
              disabled={!dirty || days === '' || save.isPending}
              onClick={() => {
                setError(null);
                save.mutate(
                  {
                    userId: row.user.id,
                    leaveTypeId: type.id,
                    year: row.year,
                    days: Number(days),
                    carryOver: Number(carry || 0),
                  },
                  {
                    onSuccess: (r) => setWarning(r.warning),
                    onError: (e) =>
                      setError(
                        e instanceof ApiError
                          ? (Object.values(e.fieldErrors())[0] ?? e.message)
                          : 'Could not save.',
                      ),
                  },
                );
              }}
            >
              Save
            </Button>
          )}
        </td>
      </tr>
      {(warning || error) && (
        <tr>
          <td colSpan={6}>
            <div
              className={`alert ${error ? 'alert-danger' : 'alert-warning'} py-1 small mb-0`}
              role="alert"
            >
              {error ?? `⚠ ${warning}`}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
