import { TIME_TYPES, TIME_TYPE_LABELS, toDateOnly, todayPH, type TimeType } from '@xc8/shared';
import { Form } from 'react-bootstrap';
import { useLookups } from '../../api/trackerHooks';
import { whereWorkingQuestion } from '../../lib/format';
import type { EntryFieldValues } from './entryFieldValues';

/**
 * Activity type, Location, Billable, Module, Time type and Remarks (doc 14 FR-ACT-15..18, mockup
 * v0.8.7). Inactive list values aren't offered, but an entry keeps the one it already has.
 */
export function EntryFields({
  kind,
  values,
  onChange,
  errors,
  dayLocation,
  keep,
  idPrefix,
  hideLocation = false,
}: {
  kind: 'TASK' | 'QUICK';
  values: EntryFieldValues;
  onChange: (patch: Partial<EntryFieldValues>) => void;
  errors: Record<string, string>;
  /** The day's location name, when set. */
  dayLocation: string | null;
  /** Values the entry already has (shown even when inactive). */
  keep?: {
    activityType?: { id: string; name: string } | null;
    module?: { id: string; name: string } | null;
  };
  idPrefix: string;
  /** DR-30: the entry that sets the day's location doesn't ask for a per-entry one too. */
  hideLocation?: boolean;
}) {
  const lists = useLookups();
  const withKept = (
    items: { id: string; name: string }[],
    kept?: { id: string; name: string } | null,
  ) => (kept && !items.some((i) => i.id === kept.id) ? [...items, kept] : items);
  const activityTypes = withKept(lists.data?.activityTypes ?? [], keep?.activityType);
  const modules = withKept(lists.data?.modules ?? [], keep?.module);
  return (
    <>
      <div className="row g-3 mb-3">
        <Form.Group className="col-sm-6" controlId={`${idPrefix}-activity`}>
          <Form.Label>Activity type *</Form.Label>
          <Form.Select
            value={values.activityTypeId}
            isInvalid={Boolean(errors.activityTypeId)}
            onChange={(e) => onChange({ activityTypeId: e.target.value })}
          >
            <option value="">Choose…</option>
            {activityTypes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Form.Select>
          <Form.Control.Feedback type="invalid">{errors.activityTypeId}</Form.Control.Feedback>
        </Form.Group>
        {kind === 'TASK' && (
          <Form.Group className="col-sm-6" controlId={`${idPrefix}-type`}>
            <Form.Label>Time type</Form.Label>
            <Form.Select
              value={values.type}
              onChange={(e) => onChange({ type: e.target.value as TimeType })}
            >
              {TIME_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TIME_TYPE_LABELS[t]}
                </option>
              ))}
            </Form.Select>
            <Form.Text>Project tasks only · default Execution</Form.Text>
          </Form.Group>
        )}
      </div>
      <div className="row g-3 mb-3">
        {!hideLocation && (
          <Form.Group className="col-sm-6" controlId={`${idPrefix}-location`}>
            <Form.Label>Location</Form.Label>
            <Form.Select
              value={values.locationId}
              onChange={(e) => onChange({ locationId: e.target.value })}
            >
              <option value="">
                {dayLocation ? `Today's location (${dayLocation})` : "The day's location"}
              </option>
              {(lists.data?.locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Form.Select>
            <Form.Text>Change for this entry only</Form.Text>
          </Form.Group>
        )}
        <Form.Group className="col-sm-6">
          <Form.Label as="div" id={`${idPrefix}-billable-label`}>
            Billable
          </Form.Label>
          <div role="radiogroup" aria-labelledby={`${idPrefix}-billable-label`}>
            <Form.Check
              inline
              type="radio"
              id={`${idPrefix}-billable-yes`}
              label="Yes"
              checked={values.billable}
              onChange={() => onChange({ billable: true })}
            />
            <Form.Check
              inline
              type="radio"
              id={`${idPrefix}-billable-no`}
              label="No"
              checked={!values.billable}
              onChange={() => onChange({ billable: false })}
            />
          </div>
          <Form.Text>
            {kind === 'TASK' ? 'Yes for client projects' : 'No for quick activities'}
          </Form.Text>
        </Form.Group>
      </div>
      <Form.Group className="mb-3" controlId={`${idPrefix}-module`}>
        <Form.Label>{kind === 'TASK' ? 'Module *' : 'Module (optional)'}</Form.Label>
        <Form.Select
          value={values.moduleId}
          isInvalid={Boolean(errors.moduleId)}
          onChange={(e) => onChange({ moduleId: e.target.value })}
        >
          <option value="">{kind === 'TASK' ? 'Choose…' : 'None'}</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Form.Select>
        <Form.Control.Feedback type="invalid">{errors.moduleId}</Form.Control.Feedback>
      </Form.Group>
      <Form.Group className="mb-3" controlId={`${idPrefix}-notes`}>
        <Form.Label>Remarks</Form.Label>
        <Form.Control
          as="textarea"
          rows={2}
          maxLength={1000}
          value={values.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Form.Group>
    </>
  );
}

/**
 * "Where are you working today?" (FR-ACT-17), asked on the first entry of a day. For an
 * earlier day it reads "Where were you working on Wed, Oct 7?" (DR-41).
 */
export function DayLocationField({
  date,
  value,
  onChange,
  error,
  idPrefix,
}: {
  /** The entry's day, YYYY-MM-DD (Philippine time). */
  date: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  idPrefix: string;
}) {
  const lists = useLookups();
  const today = toDateOnly(todayPH());
  return (
    <Form.Group className="mb-3" controlId={`${idPrefix}-day-location`}>
      <Form.Label>{whereWorkingQuestion(date, today)} *</Form.Label>
      <Form.Select
        value={value}
        isInvalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {(lists.data?.locations ?? []).map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Form.Select>
      <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
      <Form.Text>
        Every entry {date === today ? 'today' : 'that day'} uses it; you can change one entry later.
      </Form.Text>
    </Form.Group>
  );
}
