import { HOURS_MESSAGE, todayPH, toDateOnly } from '@xc8/shared';
import { useState, type FormEvent } from 'react';
import { Button, Form } from 'react-bootstrap';
import { ApiError } from '../api/client';
import { useTimeMutation, useTimeOptions } from '../api/m3Hooks';
import { ErrorAlert } from './Feedback';
import { EntryFields } from './tracker/EntryFields';
import { emptyFields, fieldErrors, type EntryFieldValues } from './tracker/entryFieldValues';

export interface TimePreset {
  projectId?: string;
  taskId?: string;
}

const validHours = (h: number) => h >= 0.25 && h <= 24 && Number.isInteger(h * 4);

/** The Log time form (FR-TIME-01..03): project, task, work date, hours, type, notes. */
export function TimeEntryForm({
  preset,
  today,
  onSaved,
  onCancel,
  idPrefix = 'time',
}: {
  preset?: TimePreset;
  today?: string;
  onSaved?: () => void;
  onCancel?: () => void;
  idPrefix?: string;
}) {
  const options = useTimeOptions();
  const save = useTimeMutation();
  const maxDate = today || toDateOnly(todayPH());
  const [form, setForm] = useState({
    projectId: preset?.projectId ?? '',
    taskId: preset?.taskId ?? '',
    workDate: maxDate,
    hours: '',
  });
  // Doc 14 FR-ACT-15, FR-DAR-09: Activity type and Module on every entry, Log time included.
  const [fields, setFields] = useState<EntryFieldValues>(emptyFields('TASK'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const projects = options.data ?? [];
  const tasks = projects.find((p) => p.project.id === form.projectId)?.tasks ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const h = Number(form.hours);
    const next: Record<string, string> = {};
    if (!form.projectId) next.projectId = 'Choose a project.';
    if (!form.taskId) next.taskId = 'Choose a task.';
    if (!form.workDate) next.workDate = 'Enter the work date.';
    else if (form.workDate > maxDate) next.workDate = "Work date can't be in the future.";
    if (!form.hours || !validHours(h)) next.hours = HOURS_MESSAGE;
    Object.assign(next, fieldErrors(fields, 'TASK'));
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate(
      {
        body: {
          taskId: form.taskId,
          workDate: form.workDate,
          hours: h,
          type: fields.type,
          activityTypeId: fields.activityTypeId,
          module: fields.module.trim() || null,
          billable: fields.billable,
          ...(fields.locationId ? { locationId: fields.locationId } : {}),
          ...(fields.notes.trim() ? { notes: fields.notes.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          setForm((f) => ({ ...f, hours: '' }));
          setFields((f) => ({ ...f, notes: '' }));
          onSaved?.();
        },
        onError: (err) => {
          if (err instanceof ApiError) setErrors(err.fieldErrors());
        },
      },
    );
  };

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v, ...(k === 'projectId' ? { taskId: '' } : {}) }));
    setErrors((x) => ({ ...x, [k]: '' }));
  };

  return (
    <Form onSubmit={submit} noValidate>
      <ErrorAlert error={save.error} action />
      <ErrorAlert error={options.error} />
      <Form.Group className="mb-3" controlId={`${idPrefix}-project`}>
        <Form.Label>Project *</Form.Label>
        <Form.Select
          value={form.projectId}
          isInvalid={Boolean(errors.projectId)}
          onChange={(e) => set('projectId', e.target.value)}
        >
          <option value="">Choose a project…</option>
          {projects.map((p) => (
            <option key={p.project.id} value={p.project.id}>
              {p.project.name}
            </option>
          ))}
        </Form.Select>
        <Form.Control.Feedback type="invalid">{errors.projectId}</Form.Control.Feedback>
        {options.isSuccess && projects.length === 0 && (
          <Form.Text>You can log time only on active projects you're a member of.</Form.Text>
        )}
      </Form.Group>
      <Form.Group className="mb-3" controlId={`${idPrefix}-task`}>
        <Form.Label>Task *</Form.Label>
        <Form.Select
          value={form.taskId}
          disabled={!form.projectId}
          isInvalid={Boolean(errors.taskId)}
          onChange={(e) => set('taskId', e.target.value)}
        >
          <option value="">Choose a task…</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.phase ? `${t.phase} · ` : ''}
              {t.name}
            </option>
          ))}
        </Form.Select>
        <Form.Control.Feedback type="invalid">{errors.taskId}</Form.Control.Feedback>
      </Form.Group>
      <div className="row g-3 mb-3">
        <Form.Group className="col-sm-6" controlId={`${idPrefix}-date`}>
          <Form.Label>Work date *</Form.Label>
          <Form.Control
            type="date"
            max={maxDate}
            value={form.workDate}
            isInvalid={Boolean(errors.workDate)}
            onChange={(e) => set('workDate', e.target.value)}
          />
          <Form.Control.Feedback type="invalid">{errors.workDate}</Form.Control.Feedback>
        </Form.Group>
        <Form.Group className="col-sm-6" controlId={`${idPrefix}-hours`}>
          <Form.Label>Hours *</Form.Label>
          <Form.Control
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            inputMode="decimal"
            value={form.hours}
            isInvalid={Boolean(errors.hours)}
            onChange={(e) => set('hours', e.target.value)}
          />
          <Form.Control.Feedback type="invalid">{errors.hours}</Form.Control.Feedback>
        </Form.Group>
      </div>
      <EntryFields
        kind="TASK"
        values={fields}
        onChange={(patch) => {
          setFields((f) => ({ ...f, ...patch }));
          setErrors((x) => ({
            ...x,
            ...Object.fromEntries(Object.keys(patch).map((k) => [k, ''])),
          }));
        }}
        errors={errors}
        dayLocation={null}
        idPrefix={idPrefix}
      />
      <div className="d-flex gap-2 justify-content-end">
        {onCancel && (
          <Button variant="outline-secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={save.isPending} className={onCancel ? '' : 'w-100'}>
          Save entry
        </Button>
      </div>
    </Form>
  );
}
