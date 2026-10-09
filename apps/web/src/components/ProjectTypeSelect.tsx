import { PROJECT_TYPE_INACTIVE_HINT, type ProjectTypeRefDto } from '@xc8/shared';
import { Form } from 'react-bootstrap';
import { useProjectTypes } from '../api/projectTypeHooks';

/**
 * Project type picker for project information (doc 14 FR-PTY-02/03; mockup v0.9.2). Lists active
 * types only; a project whose type was deactivated keeps it, shown with "(inactive)", and it
 * stays valid on save. A project created before project types starts blank ("Not set").
 */
export function ProjectTypeSelect({
  id,
  value,
  onChange,
  current,
  error,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  /** The project's saved type (edit only). */
  current?: ProjectTypeRefDto | null;
  error?: string;
}) {
  const types = useProjectTypes();
  const keepInactive = current && !current.active ? current : null;
  const hint = keepInactive && value === keepInactive.id ? PROJECT_TYPE_INACTIVE_HINT : null;
  const notSet = current === null && !value && !error;
  return (
    <Form.Group className="col-md-6" controlId={id}>
      <Form.Label>Project type *</Form.Label>
      <Form.Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        isInvalid={Boolean(error)}
        aria-describedby={`${id}-hint`}
        required
      >
        <option value="" disabled>
          Choose a project type
        </option>
        {keepInactive && <option value={keepInactive.id}>{keepInactive.name} (inactive)</option>}
        {(types.data ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        {!types.data && current?.active && <option value={current.id}>{current.name}</option>}
      </Form.Select>
      <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
      <Form.Text id={`${id}-hint`} className="d-block">
        {hint ??
          (notSet
            ? 'Not set. Pick a project type to save.'
            : "Sets the default activity type when people time in on this project's tasks. Only active types are listed.")}
      </Form.Text>
    </Form.Group>
  );
}
