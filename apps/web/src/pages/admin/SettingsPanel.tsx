import { useState } from 'react';
import { describeTimeLock, type TimeLockPolicy } from '@xc8/shared';
import { saveErrorMessage } from '../../api/client';
import { useSaveTimeLock, useTimeLock } from '../../api/m4Hooks';
import { useCan } from '../../auth/useCan';
import { ErrorAlert, LoadingRows } from '../../components/Feedback';
import { LookupsPanel } from './LookupsPanel';
import { ProjectTypesPanel } from './ProjectTypesPanel';

/**
 * Q-09: a day locks at 00:00 PHT on the third day after it. Admins can turn locking off; there is
 * no approval step.
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
          Each day's entries lock at 12:00 AM PHT on the third day after it. Nobody approves
          timesheets; after the lock, only an Admin can reopen the day.
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
                Lock days after two days
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
function GeneralSettings() {
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

const SETTINGS_TABS = [
  { key: 'general', label: 'General' },
  { key: 'ACTIVITY_TYPE', label: 'Activity types' },
  // Doc 14 FR-PTY-01 (mockup v0.9.2): Project types sits between Activity types and Locations.
  { key: 'PROJECT_TYPE', label: 'Project types' },
  { key: 'LOCATION', label: 'Locations' },
  // FR-ACT-22: no Modules screen; Module is free text on each entry (FR-ACT-20).
] as const;

/** Admin › Settings with the tracker lists (doc 14 FR-ACT-15, mockup v0.8.7). */
export function SettingsPanel() {
  const [tab, setTab] = useState<(typeof SETTINGS_TABS)[number]['key']>('general');
  return (
    <>
      <ul className="nav nav-pills nav-scrollable mb-4" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <button
              type="button"
              className={`nav-link${tab === t.key ? ' active' : ''}`}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
      {tab === 'general' ? (
        <GeneralSettings />
      ) : tab === 'PROJECT_TYPE' ? (
        <ProjectTypesPanel />
      ) : (
        <LookupsPanel kind={tab} />
      )}
    </>
  );
}
