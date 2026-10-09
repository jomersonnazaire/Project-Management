import { useState } from 'react';
import { describeTimeLock, formatHour12, type TimeLockPolicy } from '@xc8/shared';
import { saveErrorMessage } from '../../api/client';
import { useSaveTimeLock, useTimeLock } from '../../api/m4Hooks';
import { useCan } from '../../auth/useCan';
import { ErrorAlert, LoadingRows } from '../../components/Feedback';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Q-09: Admins choose when last week's time entries lock. The default is every Monday at
 * 12:00 PM Philippine time; there is no approval step.
 */
export function TimeLockCard() {
  const q = useTimeLock();
  const save = useSaveTimeLock();
  const canEdit = useCan('settings', 'edit');
  // Local edits over the saved policy; cleared after a save.
  const [edit, setForm] = useState<TimeLockPolicy | null>(null);
  const [saved, setSaved] = useState(false);
  const form = edit ?? q.data?.policy ?? null;
  const dirty = form && q.data && JSON.stringify(form) !== JSON.stringify(q.data.policy);
  return (
    <div className="card mb-6">
      <div className="card-body">
        <h5 className="mb-1">Time entry lock</h5>
        <p className="small text-body-secondary">
          Entries for last week lock at this time. Nobody approves timesheets; after the lock, only
          an Admin can change them.
        </p>
        <ErrorAlert error={q.error} />
        {q.isPending || !form ? (
          <LoadingRows rows={2} />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSaved(false);
              save.mutate(
                { ...form, version: q.data!.version },
                {
                  onSuccess: () => {
                    setForm(null);
                    setSaved(true);
                  },
                },
              );
            }}
          >
            <div className="form-check form-switch mb-3">
              <input
                id="tl-enabled"
                className="form-check-input"
                type="checkbox"
                role="switch"
                checked={form.enabled}
                disabled={!canEdit}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              <label className="form-check-label" htmlFor="tl-enabled">
                Lock last week's entries
              </label>
            </div>
            <div className="d-flex flex-wrap gap-3 mb-3">
              <label className="small">
                Day
                <select
                  className="form-select form-select-sm"
                  value={form.weekday}
                  disabled={!canEdit || !form.enabled}
                  onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="small">
                Time (Philippine time)
                <select
                  className="form-select form-select-sm"
                  value={form.hour}
                  disabled={!canEdit || !form.enabled}
                  onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {formatHour12(h)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="small mb-3" aria-live="polite">
              {describeTimeLock(form)}
            </p>
            {save.error ? (
              <div className="alert alert-danger py-2 small" role="alert">
                {saveErrorMessage(save.error)}
              </div>
            ) : null}
            {saved && !dirty && <div className="small text-success mb-2">Saved.</div>}
            {canEdit && (
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!dirty || save.isPending}
              >
                Save
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

/** Read-only view of the Phase 1 defaults; Admin-editable settings come in a later milestone. */
export function SettingsPanel() {
  const rows: [string, string][] = [
    ['Session idle timeout', '30 minutes (FR-AUTH-03)'],
    ['Account lockout', '15 minutes after 5 consecutive failed sign-ins (FR-AUTH-07)'],
    ['Sign-in rate limit', '20 attempts per IP per 15 minutes (NFR-05)'],
    ['Password policy', '8+ characters, a number and a symbol'],
    ['Delayed threshold', 'Forecast more than 5 days past baseline (FR-PRJ-10)'],
    ['Default working hours per week', '40'],
  ];
  return (
    <>
      <TimeLockCard />
      <div className="card">
        <div className="card-body">
          <h5 className="mb-1">Settings</h5>
          <p className="small text-body-secondary">
            These defaults are set by environment configuration for now. Editing them in the app
            arrives in a later milestone.
          </p>
          <dl className="row mb-0">
            {rows.map(([k, v]) => (
              <div className="col-12 d-flex flex-wrap border-bottom py-2" key={k}>
                <dt className="col-sm-4 fw-medium text-heading">{k}</dt>
                <dd className="col-sm-8 mb-0">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </>
  );
}
