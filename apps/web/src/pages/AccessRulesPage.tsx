import {
  ACCESS_ACTIONS,
  ACCESS_ACTION_LABELS,
  FIXED_SCOPES,
  lockedOffReason,
  NOT_APPLICABLE_REASON,
  RECORD_TYPES,
  SYSTEM_ROLES,
  actionApplies,
  gridsEqual,
  isLockedOff,
  isLockedOn,
  lockedOnReason,
  setGrant,
  type AccessAction,
  type AccessRulesDto,
  type PermissionGrid,
  type RecordType,
  type SystemRole,
} from '@xc8/shared';
import { useEffect, useState } from 'react';
import { Alert, Button, Modal } from 'react-bootstrap';
import { useBlocker } from 'react-router-dom';
import { ApiError, NO_LONGER_PERMITTED } from '../api/client';
import { useAccessRules, useResetAccessRules, useSaveAccessRules } from '../api/hooks';
import { useCan } from '../auth/useCan';
import { ErrorAlert, LoadingRows } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';

/** Short tab labels as in mockup v0.5.2. */
const ROLE_TAB_LABELS: Record<SystemRole, string> = {
  ADMIN: 'Admin',
  PROJECT_MANAGER: 'PM',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

const VIEW_REQUIRED_MESSAGE = 'View is included in Create, Edit and Delete. Untick those first.';
const CONFLICT_MESSAGE =
  'Someone else saved these rules while you were editing. Reload to see their changes, then make yours again.';

type Notice =
  | { kind: 'conflict' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'saved'; message: string }
  | { kind: 'hint'; message: string };

/** Rows of `next` that differ from `base`, as a PUT payload. */
function changedRows(base: PermissionGrid, next: PermissionGrid): Partial<PermissionGrid> {
  const out: Partial<PermissionGrid> = {};
  for (const { key } of RECORD_TYPES) {
    if (ACCESS_ACTIONS.some((a) => base[key][a] !== next[key][a])) out[key] = next[key];
  }
  return out;
}

/**
 * Access rules screen (doc 11, mockup v0.5.2). Admin-only by default (Q-27). The API enforces
 * every rule (locked cells, implied View, n/a cells, version conflicts); this screen mirrors them.
 */
export function AccessRulesPage() {
  const rules = useAccessRules();
  const save = useSaveAccessRules();
  const reset = useResetAccessRules();
  const canEdit = useCan('accessRules', 'edit');
  const [role, setRole] = useState<SystemRole>('PROJECT_MANAGER');
  const [drafts, setDrafts] = useState<Partial<Record<SystemRole, PermissionGrid>>>({});
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const server = rules.data?.roles.find((r) => r.role === role);
  const isDirty = (r: SystemRole) => {
    const d = drafts[r];
    const s = rules.data?.roles.find((x) => x.role === r);
    return Boolean(d && s && !gridsEqual(d, s.permissions));
  };
  const anyDirty = SYSTEM_ROLES.some(isDirty);
  const dirty = isDirty(role);
  const grid = drafts[role] ?? server?.permissions;

  // Unsaved changes warn on leaving the page (FR-ACL-11).
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);
  // ...and on moving to another page in the app (TC-M17, Milestone 2).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      anyDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  const toggle = (record: RecordType, action: AccessAction, checked: boolean) => {
    if (!grid) return;
    const row = grid[record];
    if (action === 'view' && !checked && (row.create || row.edit || row.delete)) {
      setNotice({ kind: 'hint', message: VIEW_REQUIRED_MESSAGE });
      return;
    }
    setNotice(null);
    setDrafts((d) => ({ ...d, [role]: setGrant(grid, record, action, checked) }));
  };

  const discard = () => {
    setDrafts((d) => ({ ...d, [role]: undefined }));
    setNotice(null);
  };

  const handleError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) setNotice({ kind: 'conflict' });
    else if (e instanceof ApiError && e.status === 403) setNotice({ kind: 'forbidden' });
    else
      setNotice({ kind: 'error', message: e instanceof ApiError ? e.message : 'Could not save.' });
  };

  const doSave = async () => {
    setConfirm(null);
    if (!server || !grid) return;
    try {
      await save.mutateAsync({
        role,
        version: server.version,
        permissions: changedRows(server.permissions, grid),
      });
      setDrafts((d) => ({ ...d, [role]: undefined }));
      setNotice({
        kind: 'saved',
        message: `Saved. ${ROLE_TAB_LABELS[role]} permissions apply on each user's next action.`,
      });
    } catch (e) {
      handleError(e);
    }
  };

  const doReset = async () => {
    setConfirm(null);
    if (!server) return;
    try {
      await reset.mutateAsync({ role, version: server.version });
      setDrafts((d) => ({ ...d, [role]: undefined }));
      setNotice({
        kind: 'saved',
        message: `${ROLE_TAB_LABELS[role]} permissions reset to defaults.`,
      });
    } catch (e) {
      handleError(e);
    }
  };

  const reload = async () => {
    setDrafts({});
    setNotice(null);
    await rules.refetch();
  };

  return (
    <>
      <PageHeader title="Access rules">
        {canEdit && server && (
          <Button variant="outline-secondary" onClick={() => setConfirm('reset')}>
            Reset role to defaults
          </Button>
        )}
      </PageHeader>
      <ul className="nav nav-tabs nav-scrollable mb-4" role="tablist" aria-label="Access role">
        {SYSTEM_ROLES.map((r) => (
          <li className="nav-item" key={r} role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={r === role}
              className={`nav-link${r === role ? ' active' : ''}`}
              onClick={() => {
                setRole(r);
                if (notice?.kind === 'hint') setNotice(null);
              }}
            >
              {ROLE_TAB_LABELS[r]}
              {isDirty(r) && (
                <span className="ms-1 text-warning" aria-label="unsaved changes">
                  ●
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <ErrorAlert error={rules.error} />
      <NoticeBanner notice={notice} onReload={() => void reload()} />
      {rules.isPending ? (
        <LoadingRows />
      ) : (
        grid &&
        server && (
          <div className="row g-4">
            <div className="col-xl-9">
              <div className="card">
                <div className="card-body">
                  <p className="small text-body-secondary">
                    Tick what this role can do with each kind of record. Create, Edit or Delete
                    always include View. The scope column is fixed in the app and can&apos;t be
                    widened here.
                  </p>
                  <RulesTable role={role} grid={grid} readOnly={!canEdit} onToggle={toggle} />
                  <p className="small text-body-secondary mb-0 mt-3">
                    🔒 Admin access to Users and Access rules is locked so nobody can lock every
                    Admin out. n/a means the action doesn&apos;t exist for that record type.
                  </p>
                </div>
              </div>
            </div>
            <div className="col-xl-3">
              <div className="card">
                <div className="card-body">
                  <h6>How changes apply</h6>
                  <p className="small text-body-secondary mb-2">
                    Saved changes take effect on each user&apos;s very next request, with no
                    sign-out needed. Every changed box is recorded in the audit log.
                  </p>
                  <LastSaved rules={server} />
                </div>
              </div>
            </div>
          </div>
        )
      )}
      {dirty && canEdit && (
        <div className="card acl-savebar mt-4" role="region" aria-label="Unsaved changes">
          <div className="card-body d-flex flex-wrap align-items-center gap-3 py-3">
            <strong className="text-heading">
              You have unsaved changes for {ROLE_TAB_LABELS[role]}.
            </strong>
            <Button variant="outline-secondary" className="ms-auto" onClick={discard}>
              Discard
            </Button>
            <Button onClick={() => setConfirm('save')} disabled={save.isPending}>
              Save changes
            </Button>
          </div>
        </div>
      )}
      <Modal show={confirm === 'save'} onHide={() => setConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title as="h5">Save access rules?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          These changes apply right away to everyone with this role, on their next action in the
          app.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button onClick={() => void doSave()}>Save</Button>
        </Modal.Footer>
      </Modal>
      <Modal show={confirm === 'reset'} onHide={() => setConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title as="h5">Reset to defaults?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {ROLE_TAB_LABELS[role]} permissions go back to the original settings. This applies right
          away and is recorded in the audit log.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void doReset()}>
            Reset
          </Button>
        </Modal.Footer>
      </Modal>
      <Modal show={blocker.state === 'blocked'} onHide={() => blocker.reset?.()} centered>
        <Modal.Header closeButton>
          <Modal.Title as="h5">Leave without saving?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          You have unsaved access rule changes. They will be lost if you leave.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => blocker.reset?.()}>
            Stay on this page
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            Leave
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

function NoticeBanner({ notice, onReload }: { notice: Notice | null; onReload: () => void }) {
  if (!notice) return null;
  if (notice.kind === 'conflict')
    return (
      <Alert variant="danger" role="alert">
        <span aria-hidden="true">⚠ </span>
        {CONFLICT_MESSAGE}{' '}
        <Button size="sm" variant="outline-secondary" className="ms-2" onClick={onReload}>
          Reload
        </Button>
      </Alert>
    );
  if (notice.kind === 'forbidden')
    return (
      <Alert variant="danger" role="alert">
        {NO_LONGER_PERMITTED}
      </Alert>
    );
  if (notice.kind === 'saved')
    return (
      <Alert variant="success" role="status">
        {notice.message}
      </Alert>
    );
  return (
    <Alert variant={notice.kind === 'hint' ? 'warning' : 'danger'} role="alert">
      {notice.message}
    </Alert>
  );
}

function LastSaved({ rules }: { rules: AccessRulesDto }) {
  if (!rules.updatedAt)
    return <p className="small text-body-secondary mb-0">Using the defaults.</p>;
  return (
    <p className="small text-body-secondary mb-0">
      Last saved {new Date(rules.updatedAt).toLocaleString()}
      {rules.updatedBy ? ` by ${rules.updatedBy.name}` : ''}.
    </p>
  );
}

function RulesTable({
  role,
  grid,
  readOnly,
  onToggle,
}: {
  role: SystemRole;
  grid: PermissionGrid;
  readOnly: boolean;
  onToggle: (record: RecordType, action: AccessAction, checked: boolean) => void;
}) {
  const scopes = FIXED_SCOPES[role] ?? {};
  return (
    <div className="table-responsive">
      <table className="table acl-table align-middle mb-0">
        <thead>
          <tr>
            <th scope="col">Record type</th>
            {ACCESS_ACTIONS.map((a) => (
              <th scope="col" key={a} className="text-center">
                {ACCESS_ACTION_LABELS[a]}
              </th>
            ))}
            <th scope="col">Scope (fixed)</th>
          </tr>
        </thead>
        <tbody>
          {RECORD_TYPES.map((rt) => {
            const locked = ACCESS_ACTIONS.some((a) => isLockedOn(role, rt.key, a));
            return (
              <tr key={rt.key} data-record={rt.key}>
                <th scope="row" className="fw-normal">
                  <span className="fw-medium text-heading">{rt.label}</span>
                  {locked && (
                    <span className="ms-1" title={lockedOnReason(rt.key)} aria-label="Locked">
                      🔒
                    </span>
                  )}
                  <div className="small text-body-secondary">
                    <code>{rt.key}</code>
                  </div>
                </th>
                {ACCESS_ACTIONS.map((a) => (
                  <td key={a} className="text-center">
                    <Cell
                      role={role}
                      record={rt.key}
                      label={rt.label}
                      action={a}
                      checked={grid[rt.key][a]}
                      readOnly={readOnly}
                      onToggle={onToggle}
                    />
                  </td>
                ))}
                <td className="small text-body-secondary">{scopes[rt.key] ?? '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  role,
  record,
  label,
  action,
  checked,
  readOnly,
  onToggle,
}: {
  role: SystemRole;
  record: RecordType;
  label: string;
  action: AccessAction;
  checked: boolean;
  readOnly: boolean;
  onToggle: (record: RecordType, action: AccessAction, checked: boolean) => void;
}) {
  const aria = `${ACCESS_ACTION_LABELS[action]} ${label}`;
  if (!actionApplies(record, action)) {
    return (
      <span className="d-inline-flex align-items-center gap-1" title={NOT_APPLICABLE_REASON}>
        <input type="checkbox" className="form-check-input" disabled aria-label={`${aria} (n/a)`} />
        <span className="small text-body-secondary">n/a</span>
      </span>
    );
  }
  if (isLockedOn(role, record, action)) {
    return (
      <input
        type="checkbox"
        className="form-check-input"
        checked
        disabled
        readOnly
        title={lockedOnReason(record)}
        aria-label={`${aria} (locked)`}
      />
    );
  }
  if (isLockedOff(role, record, action)) {
    return (
      <span className="d-inline-flex align-items-center gap-1" title={lockedOffReason(record)}>
        <input
          type="checkbox"
          className="form-check-input"
          disabled
          aria-label={`${aria} (${role === 'PROJECT_MANAGER' ? 'archive only' : 'Admin only'})`}
        />
        <span className="small text-body-secondary">
          {role === 'PROJECT_MANAGER' ? 'Archive only' : 'Admin only'}
        </span>
      </span>
    );
  }
  return (
    <input
      type="checkbox"
      className="form-check-input"
      checked={checked}
      disabled={readOnly}
      aria-label={aria}
      onChange={(e) => onToggle(record, action, e.target.checked)}
    />
  );
}
