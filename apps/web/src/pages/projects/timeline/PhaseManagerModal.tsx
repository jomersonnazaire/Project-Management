import {
  PHASE_HAS_TASKS_TIP,
  PHASE_NAMES_LOCKED_TIP,
  PHASE_NAME_DUPLICATE,
  PHASE_NAME_REQUIRED,
  PHASES_HISTORY_NOTE,
  PHASES_INTRO,
  phasesLockedAlert,
  phasesSavedToast,
  timelinePhaseKey,
  type TimelineDto,
} from '@xc8/shared';
import { useState, type ReactNode } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { useSavePhaseList } from '../../../api/timelineHooks';
import { ErrorAlert } from '../../../components/Feedback';

interface Row {
  key: string;
  id: string | null;
  originalName: string | null;
  name: string;
  targetDate: string;
  taskCount: number;
  documentCount: number;
}

let seq = 0;

/** Disabled controls fire no hover events, so the wrapper carries the tooltip (UIE §2.7). */
function Locked({ locked, tip, children }: { locked: boolean; tip: string; children: ReactNode }) {
  return locked ? (
    <span className="d-inline-block tlx-locked" title={tip}>
      {children}
    </span>
  ) : (
    <>{children}</>
  );
}

/**
 * CR-22 FR-TL-23 phase manager (UIE §2.7). PMs change target dates while the project is Planning,
 * Active or On hold; adding, renaming, reordering and removing are Planning-only for PMs; Admins
 * any time. The API checks the same rules and audits every change.
 */
export function PhaseManagerModal({
  timeline,
  onClose,
  onSaved,
}: {
  timeline: TimelineDto;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const save = useSavePhaseList(timeline.project.id);
  const namesOk = timeline.can.editPhaseNames;
  const [rows, setRows] = useState<Row[]>(() =>
    timeline.phases.map((p) => ({
      key: `r${++seq}`,
      id: p.id,
      originalName: p.id ? null : p.name,
      name: p.name,
      targetDate: p.targetDate ?? '',
      taskCount: p.taskCount,
      documentCount: p.documentCount,
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lockId = 'phase-lock-alert';
  const set = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      const [r] = next.splice(i, 1);
      next.splice(i + d, 0, r!);
      return next;
    });

  const submit = () => {
    const errs: Record<string, string> = {};
    const seen = new Set<string>();
    for (const r of rows) {
      const k = timelinePhaseKey(r.name);
      if (!k) errs[r.key] = PHASE_NAME_REQUIRED;
      else if (seen.has(k)) errs[r.key] = PHASE_NAME_DUPLICATE;
      seen.add(k);
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate(
      {
        phases: rows.map((r) => ({
          id: r.id,
          originalName: r.originalName,
          name: r.name.trim(),
          targetDate: r.targetDate || null,
        })),
      },
      {
        onSuccess: (res) => {
          onSaved(phasesSavedToast(res.targetsOnly));
          onClose();
        },
      },
    );
  };

  return (
    <Modal show onHide={onClose} size="lg" aria-labelledby="phase-manager-title">
      <Modal.Header closeButton>
        <Modal.Title id="phase-manager-title">Phases</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!namesOk && (
          <Alert variant="info" id={lockId} data-testid="phase-lock-alert">
            {/* UIE: the status word is bold ("This project is **Active**."). */}
            {(() => {
              const text = phasesLockedAlert(timeline.project.status);
              const m = /^This project is ([^.]+)\.(.*)$/.exec(text);
              return m ? (
                <>
                  This project is <strong>{m[1]}</strong>.{m[2]}
                </>
              ) : (
                text
              );
            })()}
          </Alert>
        )}
        <p className="text-body-secondary small">{PHASES_INTRO}</p>
        <ErrorAlert error={save.error} action />
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-2">
            <thead>
              <tr>
                <th scope="col" className="visually-hidden-focusable">
                  Order
                </th>
                <th scope="col">Phase</th>
                <th scope="col">Target completion</th>
                <th scope="col" className="text-end">
                  Tasks
                </th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                // UIE retest: outside Planning the Planning lock is the reason that applies.
                const removeTip = !namesOk
                  ? PHASE_NAMES_LOCKED_TIP
                  : r.taskCount
                    ? PHASE_HAS_TASKS_TIP
                    : r.documentCount
                      ? 'Move or remove the documents in its folder first'
                      : PHASE_NAMES_LOCKED_TIP;
                const removeLocked = !namesOk || r.taskCount > 0 || r.documentCount > 0;
                const describedBy = namesOk ? undefined : lockId;
                return (
                  <tr key={r.key} data-testid="phase-row">
                    <td className="text-nowrap">
                      <Locked locked={!namesOk} tip={PHASE_NAMES_LOCKED_TIP}>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          aria-label={`Move ${r.name || 'phase'} up`}
                          aria-describedby={describedBy}
                          disabled={!namesOk || i === 0}
                          onClick={() => move(i, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          aria-label={`Move ${r.name || 'phase'} down`}
                          aria-describedby={describedBy}
                          disabled={!namesOk || i === rows.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          ↓
                        </Button>
                      </Locked>
                    </td>
                    <td>
                      <Locked locked={!namesOk} tip={PHASE_NAMES_LOCKED_TIP}>
                        <Form.Control
                          size="sm"
                          aria-label="Phase name"
                          aria-describedby={describedBy}
                          value={r.name}
                          maxLength={120}
                          disabled={!namesOk}
                          isInvalid={Boolean(errors[r.key])}
                          onChange={(e) => set(r.key, { name: e.target.value })}
                        />
                      </Locked>
                      {errors[r.key] && (
                        <div className="invalid-feedback d-block">{errors[r.key]}</div>
                      )}
                    </td>
                    <td>
                      <Form.Control
                        size="sm"
                        type="date"
                        aria-label={`Target completion for ${r.name || 'new phase'}`}
                        value={r.targetDate}
                        onChange={(e) => set(r.key, { targetDate: e.target.value })}
                      />
                    </td>
                    <td className="text-end">{r.taskCount}</td>
                    <td className="text-end">
                      <Locked locked={removeLocked} tip={removeTip}>
                        <Button
                          size="sm"
                          variant="link"
                          className="text-body-secondary p-0"
                          aria-describedby={describedBy}
                          disabled={removeLocked}
                          onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        >
                          Remove
                        </Button>
                      </Locked>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
          <Locked locked={!namesOk} tip={PHASE_NAMES_LOCKED_TIP}>
            <Button
              size="sm"
              variant="outline-primary"
              disabled={!namesOk}
              aria-describedby={namesOk ? undefined : lockId}
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  {
                    key: `r${++seq}`,
                    id: null,
                    originalName: null,
                    name: '',
                    targetDate: '',
                    taskCount: 0,
                    documentCount: 0,
                  },
                ])
              }
            >
              + Add phase
            </Button>
          </Locked>
          <small className="text-body-secondary">
            <i className="bx bx-history me-1" aria-hidden="true" />
            {PHASES_HISTORY_NOTE}
          </small>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={save.isPending}>
          Save phases
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
