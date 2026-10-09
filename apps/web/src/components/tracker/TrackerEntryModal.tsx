import { formatTime24, type TrackerEntryDto } from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import { useTimeOptions } from '../../api/m3Hooks';
import { useRunning, useTrackerDay, useTrackerMutation } from '../../api/trackerHooks';
import { ErrorAlert } from '../Feedback';
import { DayLocationField, EntryFields } from './EntryFields';
import { emptyFields, fieldErrors, fieldsBody, type EntryFieldValues } from './entryFieldValues';

type SaveReq = { path: string; method?: 'POST' | 'PATCH'; body: unknown };
export type TrackerModalMode =
  | {
      kind: 'start';
      task: { id: string; name: string; projectName: string };
      date: string;
      last?: TrackerEntryDto;
    }
  | { kind: 'quick'; date: string }
  | { kind: 'add'; date: string }
  | { kind: 'edit'; entry: TrackerEntryDto };

const QUICK = '__quick__';

function fromEntry(e: TrackerEntryDto): EntryFieldValues {
  return {
    activityTypeId: e.activityType?.id ?? '',
    moduleId: e.module?.id ?? '',
    locationId: e.locationOverridden ? (e.location?.id ?? '') : '',
    billable: e.billable,
    type: e.type ?? 'EXECUTION',
    notes: e.notes ?? '',
  };
}

/**
 * Time in on a task, "+ Quick activity", "Add entry" and editing an entry (doc 14 FR-ACT-02, -06,
 * -10, -15..18; mockup v0.8.7 tracker and daysheet). The server sets live timer times.
 */
export function TrackerEntryModal({
  mode,
  onClose,
}: {
  mode: TrackerModalMode;
  onClose: () => void;
}) {
  const date = mode.kind === 'edit' ? mode.entry.date : mode.date;
  const day = useTrackerDay(date);
  const running = useRunning();
  const options = useTimeOptions(mode.kind === 'add');
  const save = useTrackerMutation();
  const editing = mode.kind === 'edit' ? mode.entry : null;
  const [target, setTarget] = useState(
    mode.kind === 'quick' ? QUICK : mode.kind === 'start' ? mode.task.id : '',
  );
  const kind: 'TASK' | 'QUICK' = editing ? editing.kind : target === QUICK ? 'QUICK' : 'TASK';
  const [fields, setFields] = useState<EntryFieldValues>(() =>
    editing
      ? fromEntry(editing)
      : mode.kind === 'start' && mode.last
        ? { ...fromEntry(mode.last), notes: '' }
        : emptyFields(mode.kind === 'quick' ? 'QUICK' : 'TASK'),
  );
  const [title, setTitle] = useState(editing?.title ?? '');
  const [when, setWhen] = useState<'now' | 'times'>(
    mode.kind === 'add' || mode.kind === 'edit' ? 'times' : 'now',
  );
  const [timeIn, setTimeIn] = useState(editing?.startAt ? formatTime24(editing.startAt) : '');
  const [timeOut, setTimeOut] = useState(editing?.endAt ? formatTime24(editing.endAt) : '');
  const [dayLocationId, setDayLocationId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const needsDayLocation = !editing && day.isSuccess && !day.data.location;
  const runningEntry = running.data?.entry;
  const stopsRunning = !editing && when === 'now' && runningEntry;
  const projects = options.data ?? [];

  const change = (patch: Partial<EntryFieldValues>) => {
    setFields((f) => ({ ...f, ...patch }));
    setErrors((e) => ({ ...e, ...Object.fromEntries(Object.keys(patch).map((k) => [k, ''])) }));
  };

  const pickTarget = (v: string) => {
    setTarget(v);
    setFields((f) => ({
      ...f,
      billable: v !== QUICK,
      ...(v === QUICK ? { type: 'EXECUTION' } : {}),
    }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = { ...fieldErrors(fields, kind) };
    if (!editing && !target) next.target = 'Choose a task or Quick activity.';
    if (kind === 'QUICK' && !title.trim()) next.title = 'Add a title.';
    if (when === 'times' && !(editing && !editing.timed)) {
      if (!timeIn) next.timeIn = 'Enter the time in.';
      if (!timeOut) next.timeOut = 'Enter the time out.';
      else if (timeIn && timeOut <= timeIn) next.timeOut = 'Time out must be after time in.';
    }
    if (needsDayLocation && !dayLocationId && !fields.locationId)
      next.dayLocationId = 'Choose where you’re working today.';
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    const body: Record<string, unknown> = { ...fieldsBody(fields, kind) };
    if (needsDayLocation && dayLocationId) body.dayLocationId = dayLocationId;
    let req: SaveReq;
    if (editing) {
      delete body.dayLocationId;
      if (kind === 'QUICK') body.title = title.trim();
      if (editing.timed && !editing.running) Object.assign(body, { timeIn, timeOut });
      req = { path: `/entries/${editing.id}`, method: 'PATCH', body };
    } else {
      Object.assign(body, kind === 'QUICK' ? { title: title.trim() } : { taskId: target });
      if (body.moduleId === null) delete body.moduleId;
      if (body.locationId === null) delete body.locationId;
      if (body.notes === null) delete body.notes;
      req =
        when === 'now'
          ? { path: '/start', body }
          : { path: '/entries', body: { ...body, date, timeIn, timeOut } };
    }
    send(req);
  };

  // Half-day leave (FR-LV-06, TC-S09): a warning the user can confirm; a full day is refused.
  const [leaveWarning, setLeaveWarning] = useState<{ message: string; req: SaveReq } | null>(null);
  const send = (req: SaveReq) => {
    setLeaveWarning(null);
    save.mutate(req, {
      onSuccess: onClose,
      onError: (err) => {
        if (err instanceof ApiError) {
          if (err.code === 'HALF_DAY_LEAVE') {
            setLeaveWarning({
              message: err.message,
              req: { ...req, body: { ...(req.body as object), confirmLeave: true } },
            });
            return;
          }
          const f = err.fieldErrors();
          if (err.code === 'TIME_OVERLAP' || err.code === 'DAILY_LIMIT') return;
          setErrors(f);
        }
      },
    });
  };

  const titleText =
    mode.kind === 'start'
      ? 'Time in'
      : mode.kind === 'quick'
        ? 'Quick activity'
        : mode.kind === 'add'
          ? `Add entry · ${date}`
          : 'Edit entry';
  const timed = editing ? editing.timed && !editing.running : when === 'times';

  return (
    <Modal show onHide={onClose} centered aria-labelledby="tracker-modal-title">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5" id="tracker-modal-title">
            {titleText}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {leaveWarning ? (
            <div
              className="alert alert-warning d-flex flex-wrap align-items-center gap-2"
              role="alert"
            >
              <span className="me-auto">{leaveWarning.message}</span>
              <Button size="sm" variant="warning" onClick={() => send(leaveWarning.req)}>
                Log time anyway
              </Button>
            </div>
          ) : (
            <ErrorAlert error={save.error} action />
          )}
          {mode.kind === 'start' && (
            <p className="mb-3">
              <strong>{mode.task.name}</strong>
              <span className="d-block small text-body-secondary">{mode.task.projectName}</span>
            </p>
          )}
          {mode.kind === 'quick' && (
            <p className="small text-body-secondary">
              Not linked to a project. Only you, your supervisor and Admins can see it.
            </p>
          )}
          {mode.kind === 'add' && (
            <Form.Group className="mb-3" controlId="tracker-target">
              <Form.Label>Task or quick activity *</Form.Label>
              <Form.Select
                value={target}
                isInvalid={Boolean(errors.target)}
                onChange={(e) => pickTarget(e.target.value)}
              >
                <option value="">Choose…</option>
                {projects.map((p) => (
                  <optgroup key={p.project.id} label={p.project.name}>
                    {p.tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {p.project.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={QUICK}>Quick activity…</option>
              </Form.Select>
              <Form.Control.Feedback type="invalid">{errors.target}</Form.Control.Feedback>
            </Form.Group>
          )}
          {editing?.kind === 'TASK' && (
            <p className="mb-3">
              <strong>{editing.task?.name}</strong>
              <span className="d-block small text-body-secondary">{editing.project?.name}</span>
            </p>
          )}
          {kind === 'QUICK' && (
            <Form.Group className="mb-3" controlId="tracker-title">
              <Form.Label>Title *</Form.Label>
              <Form.Control
                value={title}
                maxLength={150}
                isInvalid={Boolean(errors.title)}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setErrors((x) => ({ ...x, title: '' }));
                }}
              />
              <Form.Control.Feedback type="invalid">{errors.title}</Form.Control.Feedback>
            </Form.Group>
          )}
          {needsDayLocation && (
            <DayLocationField
              idPrefix="tracker"
              value={dayLocationId}
              error={errors.dayLocationId}
              onChange={(v) => {
                setDayLocationId(v);
                setErrors((x) => ({ ...x, dayLocationId: '' }));
              }}
            />
          )}
          <EntryFields
            kind={kind}
            values={fields}
            onChange={change}
            errors={errors}
            dayLocation={day.data?.location?.name ?? null}
            keep={
              editing ? { activityType: editing.activityType, module: editing.module } : undefined
            }
            idPrefix="tracker"
          />
          {mode.kind === 'quick' && (
            <Form.Group className="mb-3">
              <Form.Label as="div" id="tracker-when">
                When
              </Form.Label>
              <div role="radiogroup" aria-labelledby="tracker-when">
                <Form.Check
                  type="radio"
                  id="tracker-when-now"
                  label="Start timer now"
                  checked={when === 'now'}
                  onChange={() => setWhen('now')}
                />
                <Form.Check
                  type="radio"
                  id="tracker-when-times"
                  label="Enter time in and time out"
                  checked={when === 'times'}
                  onChange={() => setWhen('times')}
                />
              </div>
            </Form.Group>
          )}
          {timed && (
            <div className="row g-3 mb-3">
              <Form.Group className="col-6" controlId="tracker-time-in">
                <Form.Label>Time in *</Form.Label>
                <Form.Control
                  type="time"
                  value={timeIn}
                  isInvalid={Boolean(errors.timeIn)}
                  onChange={(e) => setTimeIn(e.target.value)}
                />
                <Form.Control.Feedback type="invalid">{errors.timeIn}</Form.Control.Feedback>
              </Form.Group>
              <Form.Group className="col-6" controlId="tracker-time-out">
                <Form.Label>Time out *</Form.Label>
                <Form.Control
                  type="time"
                  value={timeOut}
                  isInvalid={Boolean(errors.timeOut)}
                  onChange={(e) => setTimeOut(e.target.value)}
                />
                <Form.Control.Feedback type="invalid">{errors.timeOut}</Form.Control.Feedback>
              </Form.Group>
              <Form.Text className="col-12 mt-1">Philippine time · {date}</Form.Text>
            </div>
          )}
          {stopsRunning && (
            <p className="small text-warning mb-0" role="status">
              Starting this stops the running timer on "
              {runningEntry.task?.name ?? runningEntry.title}".
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {editing ? 'Save' : when === 'now' ? 'Start timer' : 'Save entry'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
