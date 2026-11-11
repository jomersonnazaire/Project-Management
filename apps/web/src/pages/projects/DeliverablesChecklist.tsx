import {
  DELIVERABLE_COPY as COPY,
  DELIVERABLE_COUNTER_FROM,
  DELIVERABLE_COUNT_NOTE_FROM,
  DELIVERABLE_MAX_ITEMS,
  DELIVERABLE_MAX_TEXT,
  deliverableProgress,
  deliverableTooLongMessage,
  moveWithinGroup,
  phDateOf,
  type DeliverableItemDto,
  type ProjectDto,
  type TaskDto,
} from '@xc8/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Form } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import { useDeliverableChange, withTick, type DeliverableChange } from '../../api/deliverableHooks';
import { useAuth } from '../../auth/AuthContext';
import { DragHandle } from '../../components/ReorderControls';
import { dragHandleProps, dropTargetProps } from '../../lib/dragRow';
import { shortDate } from '../../lib/format';
import { deliverablesLockedLine } from './checklistCopy';

/**
 * CR-23 FR-DLV-01..07 (UIE §5): a task's deliverables as a checklist. The task owner, the project
 * PM and Admins add, tick, edit, reorder and remove items (the API checks this too, `can.
 * deliverables`); everyone else reads. Ticking every item doesn't change the task status (Q-162).
 */

const UNDO_MS = 6000;

/** Philippine calendar day of a tick ("Today" for today), like the rest of the app. */
const doneOn = (iso: string, today: string) => {
  const day = phDateOf(new Date(iso));
  return day === today ? 'Today' : shortDate(day);
};

function doneLine(i: DeliverableItemDto, today: string) {
  if (!i.done) return null;
  if (i.doneFromImport || !i.doneBy)
    return i.doneAt ? `Done · from import, ${doneOn(i.doneAt, today)}` : 'Done · from import';
  return `Done by ${i.doneBy.name}${i.doneAt ? ` · ${doneOn(i.doneAt, today)}` : ''}`;
}

/** The 200-character rule as the user types (counter from 180; Enter shows the error). */
function useTextRule(text: string) {
  const n = text.trim().length;
  return { n, over: n > DELIVERABLE_MAX_TEXT, counter: n >= DELIVERABLE_COUNTER_FROM };
}

function messageOf(e: unknown) {
  if (e instanceof ApiError && e.status === 409) return COPY.CONFLICT;
  if (e instanceof ApiError && e.status === 422) return e.message;
  return COPY.SAVE_FAILED;
}

export function DeliverablesChecklist({ task, project }: { task: TaskDto; project: ProjectDto }) {
  const { user } = useAuth();
  const change = useDeliverableChange(task);
  const uid = useId();
  const editable = task.can.deliverables;
  const locked = deliverablesLockedLine(project);
  const today = phDateOf(new Date());
  const me = user ? { id: user.id, name: user.name } : null;

  // Optimistic ticks: shown at once, dropped when the save settles (the cache has the answer).
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  let items = task.deliverableItems ?? [];
  for (const [id, done] of Object.entries(ticks))
    items = withTick(items, id, done, me, new Date().toISOString());

  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; error: string | null } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; text: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<string | null>(null);
  const rule = useTextRule(draft);
  const atLimit = items.length >= DELIVERABLE_MAX_ITEMS;
  const done = items.filter((i) => i.done).length;

  // The Undo bar lasts about 6 seconds (or until the next action / the panel closes).
  useEffect(() => {
    if (!undo) return;
    undoRef.current?.focus();
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [flash]);
  // After Undo, focus the restored row's checkbox (UIE §5.7).
  useEffect(() => {
    const id = focusAfter.current;
    if (id && items.some((i) => i.id === id)) {
      focusAfter.current = null;
      document.getElementById(`${uid}-cb-${id}`)?.focus();
    }
  });

  const run = (c: DeliverableChange, onDone?: (t: TaskDto) => void, onFail?: () => void) => {
    setToast(null);
    if (c.kind !== 'restore') setUndo(null);
    change.mutate(c, {
      onSuccess: (t) => onDone?.(t),
      onError: (e) => {
        onFail?.();
        setToast(messageOf(e));
      },
    });
  };

  const add = () => {
    const text = draft.trim();
    if (!text || atLimit) return;
    if (rule.over) return setAddError(deliverableTooLongMessage(text.length));
    setAddError(null);
    run({ kind: 'add', text }, (t) => {
      setDraft('');
      setFlash(t.deliverableItems.at(-1)?.id ?? null);
      addRef.current?.focus();
    });
  };
  const tick = (i: DeliverableItemDto, next: boolean) => {
    setTicks((s) => ({ ...s, [i.id]: next }));
    const clear = () =>
      setTicks((s) => {
        const { [i.id]: _gone, ...rest } = s;
        void _gone;
        return rest;
      });
    run({ kind: 'tick', itemId: i.id, done: next }, clear, clear);
  };
  const saveEdit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return setEditing({ ...editing, error: COPY.TEXT_REQUIRED });
    if (text.length > DELIVERABLE_MAX_TEXT)
      return setEditing({ ...editing, error: deliverableTooLongMessage(text.length) });
    const id = editing.id;
    run({ kind: 'edit', itemId: id, text }, () => {
      setEditing(null);
      document.getElementById(`${uid}-cb-${id}`)?.focus();
    });
  };
  const remove = (i: DeliverableItemDto) =>
    run({ kind: 'remove', itemId: i.id }, () => setUndo({ id: i.id, text: i.text }));
  const restore = () => {
    if (!undo) return;
    const id = undo.id;
    setUndo(null);
    focusAfter.current = id;
    run({ kind: 'restore', itemId: id });
  };
  // Lean: the old Deliverable text (read-only until the first add) never moves.
  const movable = items.some((i) => i.legacy) ? [] : items;
  const move = (from: number, to: number) => {
    if (!movable.length) return;
    const ids = items.map((i) => i.id);
    const next = moveWithinGroup(ids, () => true, from, to);
    if (next.join() !== ids.join()) run({ kind: 'reorder', itemIds: next });
  };

  const countId = `${uid}-count`;
  const addHelpId = `${uid}-add-help`;
  const scope = `deliverables-${task.id}`;
  const readOnlyLine = locked ?? (editable ? null : COPY.VIEW_ONLY);

  return (
    <section className="dlv mb-4" aria-labelledby={`${uid}-h`} data-testid="deliverables">
      <div className="d-flex align-items-center gap-2 mb-2">
        <h3 className="h6 mb-0" id={`${uid}-h`}>
          Deliverables
        </h3>
        {items.length > 0 && (
          <>
            <span
              id={countId}
              className={`small ${items.length >= DELIVERABLE_MAX_ITEMS ? 'text-danger' : 'text-body-secondary'}`}
              aria-live="polite"
            >
              {deliverableProgress(items)}
              {items.length >= DELIVERABLE_COUNT_NOTE_FROM &&
                ` · ${items.length}/${DELIVERABLE_MAX_ITEMS} items`}
            </span>
            <div
              className="progress dlv-bar ms-auto"
              role="progressbar"
              aria-label="Deliverables done"
              aria-valuemin={0}
              aria-valuemax={items.length}
              aria-valuenow={done}
            >
              <div
                className={`progress-bar${done === items.length ? ' bg-success' : ''}`}
                style={{ width: `${(done / items.length) * 100}%` }}
              />
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className="alert alert-danger py-2 small" role="alert">
          {toast}
        </div>
      )}

      {items.length === 0 ? (
        <div className="dlv-empty small text-body-secondary">
          {editable ? COPY.EMPTY_EDIT : COPY.EMPTY_READ}
        </div>
      ) : (
        <ul className={`list-group dlv-list${items.length > 12 ? ' dlv-scroll' : ''}`}>
          {items.map((i, n) => {
            const cb = `${uid}-cb-${i.id}`;
            const line = doneLine(i, today);
            if (i.legacy)
              return (
                <li
                  key={i.id}
                  className="list-group-item dlv-row dlv-legacy d-flex align-items-start gap-2"
                  data-testid="deliverable-legacy"
                >
                  <input
                    id={cb}
                    type="checkbox"
                    className="form-check-input dlv-cb"
                    checked={false}
                    disabled
                    aria-describedby={`${cb}-note`}
                  />
                  <div className="flex-grow-1 min-w-0">
                    <label htmlFor={cb} className="dlv-text">
                      {i.text}
                    </label>{' '}
                    <LegacyBadge />
                    <div id={`${cb}-note`} className="small text-body-secondary">
                      {editable ? COPY.LEGACY_NOTE : COPY.LEGACY_NOTE_READ}
                    </div>
                  </div>
                </li>
              );
            if (editing?.id === i.id) {
              const r = editing.text.trim().length;
              const errId = `${uid}-edit-err`;
              return (
                <li key={i.id} className="list-group-item dlv-row">
                  <Form.Control
                    size="sm"
                    autoFocus
                    aria-label={`Edit ${i.text}`}
                    value={editing.text}
                    isInvalid={Boolean(editing.error) || r > DELIVERABLE_MAX_TEXT}
                    aria-describedby={editing.error ? errId : undefined}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setEditing({ ...editing, text: e.target.value, error: null })}
                    onKeyDown={(e: KeyboardEvent) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        saveEdit();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                  />
                  <div className="d-flex align-items-center gap-2 mt-1">
                    <span className="small text-body-secondary me-auto">
                      Enter saves · Esc cancels
                    </span>
                    {r >= DELIVERABLE_COUNTER_FROM && (
                      <span
                        className={`small ${r > DELIVERABLE_MAX_TEXT ? 'text-danger' : 'text-body-secondary'}`}
                        aria-live="polite"
                      >
                        {r}/{DELIVERABLE_MAX_TEXT}
                      </span>
                    )}
                    <Button size="sm" variant="outline-secondary" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveEdit} disabled={change.isPending}>
                      Save
                    </Button>
                  </div>
                  {editing.error && (
                    <div id={errId} className="small text-danger mt-1" role="alert">
                      {editing.error}
                    </div>
                  )}
                </li>
              );
            }
            return (
              <li
                key={i.id}
                className={`list-group-item dlv-row d-flex align-items-start gap-2${flash === i.id ? ' dlv-flash' : ''}`}
                {...dropTargetProps(editable, scope, (from) => move(Number(from), n))}
              >
                {editable && (
                  <span className="dlv-grip">
                    <DragHandle
                      name={i.text}
                      index={n}
                      count={items.length}
                      disabled={change.isPending}
                      onMove={(to) => move(n, to)}
                      dragProps={dragHandleProps(editable, scope, String(n))}
                    />
                  </span>
                )}
                <input
                  id={cb}
                  type="checkbox"
                  className="form-check-input dlv-cb"
                  checked={i.done}
                  disabled={!editable}
                  onChange={(e) => tick(i, e.target.checked)}
                />
                <div className="flex-grow-1 min-w-0">
                  <label htmlFor={cb} className={`dlv-text${i.done ? ' is-done' : ''}`}>
                    {i.text}
                  </label>
                  {line && <div className="small dlv-by">{line}</div>}
                </div>
                {editable && (
                  <span className="dlv-actions d-flex gap-1">
                    <span className="dlv-touch d-flex gap-1">
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        aria-label={`Move up ${i.text}`}
                        disabled={n === 0 || change.isPending}
                        onClick={() => move(n, n - 1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        aria-label={`Move down ${i.text}`}
                        disabled={n === items.length - 1 || change.isPending}
                        onClick={() => move(n, n + 1)}
                      >
                        ↓
                      </Button>
                    </span>
                    <Button
                      size="sm"
                      variant="link"
                      className="dlv-icon"
                      aria-label={`Edit ${i.text}`}
                      title="Edit"
                      onClick={() => setEditing({ id: i.id, text: i.text, error: null })}
                    >
                      <i className="bx bx-pencil" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="link"
                      className="dlv-icon text-danger"
                      aria-label={`Remove ${i.text}`}
                      title="Remove"
                      disabled={change.isPending}
                      onClick={() => remove(i)}
                    >
                      <i className="bx bx-trash" aria-hidden="true" />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {undo && (
        <div className="dlv-undo d-flex align-items-center gap-2 mt-2" role="status">
          <span className="me-auto">Removed “{undo.text}”.</span>
          <Button
            ref={undoRef}
            size="sm"
            variant="link"
            className="text-white p-0"
            onClick={restore}
          >
            Undo
          </Button>
        </div>
      )}

      {editable && (
        <div className="mt-2">
          <div className="d-flex align-items-center gap-2 dlv-add">
            <i className="bx bx-plus text-body-secondary" aria-hidden="true" />
            <label htmlFor={`${uid}-add`} className="visually-hidden">
              {COPY.ADD_LABEL}
            </label>
            <Form.Control
              id={`${uid}-add`}
              ref={addRef}
              size="sm"
              value={draft}
              disabled={atLimit}
              placeholder={atLimit ? COPY.AT_LIMIT_PLACEHOLDER : COPY.ADD_PLACEHOLDER}
              isInvalid={rule.over}
              aria-describedby={addError ? addHelpId : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button
              size="sm"
              variant="outline-primary"
              disabled={atLimit || change.isPending}
              onClick={add}
            >
              Add
            </Button>
          </div>
          {rule.counter && (
            <div
              className={`small text-end ${rule.over ? 'text-danger' : 'text-body-secondary'}`}
              aria-live="polite"
            >
              {rule.n}/{DELIVERABLE_MAX_TEXT}
            </div>
          )}
          {addError && (
            <div id={addHelpId} className="small text-danger" role="alert">
              {addError}
            </div>
          )}
          {atLimit && <div className="small text-body-secondary mt-1">{COPY.AT_LIMIT_NOTE}</div>}
        </div>
      )}
      {readOnlyLine && <p className="small text-body-secondary mt-2 mb-0">{readOnlyLine}</p>}
    </section>
  );
}

/** Marks the read-only item that shows a pre-CR-23 Deliverable text (Lean). */
function LegacyBadge() {
  return (
    <span className="badge rounded-pill text-bg-light border dlv-legacy-badge">
      <i className="bx bx-lock-alt me-1" aria-hidden="true" />
      {COPY.LEGACY_BADGE}
    </span>
  );
}

/**
 * CR-23 FR-DLV-01: the new-task form's deliverables, kept in the form until the task is saved
 * (then sent as `deliverableItems`). Same 200-character and 50-item rules; no ticks yet.
 */
export function DeliverableDraftList({
  items,
  onChange,
  legacyFirst = false,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  /** Templates (Lean): items[0] is the activity's old Deliverable text, shown read-only. */
  legacyFirst?: boolean;
}) {
  const uid = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rule = useTextRule(draft);
  const atLimit = items.length >= DELIVERABLE_MAX_ITEMS;
  const add = () => {
    const text = draft.trim();
    if (!text || atLimit) return;
    if (rule.over) return setError(deliverableTooLongMessage(text.length));
    onChange([...items, text]);
    setDraft('');
    setError(null);
  };
  return (
    <div className="dlv" data-testid="deliverables-draft">
      {items.length > 0 && (
        <ul className="list-group dlv-list mb-2">
          {items.map((text, n) => (
            <li
              key={`${n}-${text}`}
              className="list-group-item dlv-row d-flex align-items-start gap-2"
            >
              <span className="flex-grow-1 dlv-text">
                {text}
                {legacyFirst && n === 0 && (
                  <>
                    {' '}
                    <LegacyBadge />
                    <span className="d-block small text-body-secondary">{COPY.LEGACY_NOTE}</span>
                  </>
                )}
              </span>
              {!(legacyFirst && n === 0) && (
                <Button
                  size="sm"
                  variant="link"
                  className="dlv-icon text-danger"
                  aria-label={`Remove ${text}`}
                  onClick={() => onChange(items.filter((_, i) => i !== n))}
                >
                  <i className="bx bx-trash" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="d-flex align-items-center gap-2 dlv-add">
        <i className="bx bx-plus text-body-secondary" aria-hidden="true" />
        <Form.Control
          id={`${uid}-add`}
          aria-label={COPY.ADD_LABEL}
          value={draft}
          disabled={atLimit}
          placeholder={atLimit ? COPY.AT_LIMIT_PLACEHOLDER : COPY.ADD_PLACEHOLDER}
          isInvalid={rule.over}
          aria-describedby={error ? `${uid}-err` : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" variant="outline-primary" disabled={atLimit} onClick={add}>
          Add
        </Button>
      </div>
      {rule.counter && (
        <div className={`small text-end ${rule.over ? 'text-danger' : 'text-body-secondary'}`}>
          {rule.n}/{DELIVERABLE_MAX_TEXT}
        </div>
      )}
      {error && (
        <div id={`${uid}-err`} className="small text-danger" role="alert">
          {error}
        </div>
      )}
      {atLimit && <div className="small text-body-secondary mt-1">{COPY.AT_LIMIT_NOTE}</div>}
    </div>
  );
}
