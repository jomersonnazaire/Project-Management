import { useState } from 'react';
import { Button, Form } from 'react-bootstrap';

export interface DependencyOption {
  id: string;
  label: string;
  dependsOn: readonly string[];
}

/** Show the search box once the list is longer than this. */
const SEARCH_FROM = 6;

/** Ids of options that depend on `selfId`, directly or through others (picking one is a cycle). */
export function dependentsOf(selfId: string | null, options: readonly DependencyOption[]) {
  const out = new Set<string>();
  if (!selfId) return out;
  const byDep = new Map<string, string[]>();
  for (const o of options)
    for (const d of o.dependsOn) byDep.set(d, [...(byDep.get(d) ?? []), o.id]);
  const queue = [selfId];
  while (queue.length) {
    for (const next of byDep.get(queue.shift()!) ?? []) {
      if (next === selfId || out.has(next)) continue;
      out.add(next);
      queue.push(next);
    }
  }
  return out;
}

/**
 * CR-22 A3: "Depends on" as checkboxes plus removable chips. It used to be a native
 * `<select multiple>`: a plain click replaced the selection (adding or removing one needed
 * Ctrl/Cmd-click) and the theme painted selected options like the rest, so people could neither
 * see, add nor remove dependencies. The task itself is never offered, and tasks that already
 * depend on it (directly or not) are shown disabled, since picking one would be a cycle.
 */
export function DependsOnPicker({
  id,
  selfId,
  options,
  value,
  onChange,
  error,
}: {
  id: string;
  selfId: string | null;
  options: readonly DependencyOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const blocked = dependentsOf(selfId, options);
  const all = options.filter((o) => o.id !== selfId);
  const q = query.trim().toLowerCase();
  const choices = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  const labelOf = new Map(options.map((o) => [o.id, o.label]));
  const selected = value.filter((v) => labelOf.has(v));
  const toggle = (optId: string, on: boolean) =>
    onChange(on ? [...value.filter((v) => v !== optId), optId] : value.filter((v) => v !== optId));
  return (
    <fieldset>
      <legend className="form-label fs-6 d-flex align-items-center justify-content-between mb-1">
        <span>Depends on</span>
        {selected.length > 0 && (
          <Button variant="link" size="sm" className="p-0" onClick={() => onChange([])}>
            Clear all
          </Button>
        )}
      </legend>
      {selected.length > 0 && (
        <div className="d-flex flex-wrap gap-1 mb-1" data-testid={`${id}-chips`}>
          {selected.map((v) => (
            <span
              key={v}
              className="badge bg-label-primary d-inline-flex align-items-center gap-1 text-wrap text-start"
              style={{ maxWidth: '100%' }}
            >
              {labelOf.get(v)}
              <button
                type="button"
                className="btn btn-link btn-sm px-1 py-0 lh-1 text-reset text-decoration-none"
                aria-label={`Remove dependency ${labelOf.get(v)}`}
                onClick={() => toggle(v, false)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {all.length > SEARCH_FROM && (
        <Form.Control
          type="search"
          size="sm"
          className="mb-1"
          placeholder="Search tasks"
          aria-label="Search tasks to depend on"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div
        className={`border rounded p-2${error ? ' border-danger' : ''}`}
        style={{ maxHeight: 160, overflowY: 'auto' }}
        role="group"
        aria-label="Tasks this one depends on"
      >
        {all.length === 0 && (
          <div className="text-body-secondary small">No other tasks to depend on yet.</div>
        )}
        {all.length > 0 && choices.length === 0 && (
          <div className="text-body-secondary small">No tasks match “{query.trim()}”.</div>
        )}
        {choices.map((o) => {
          const cycle = blocked.has(o.id) && !value.includes(o.id);
          return (
            <Form.Check
              key={o.id}
              id={`${id}-${o.id}`}
              label={cycle ? `${o.label} (depends on this task)` : o.label}
              checked={value.includes(o.id)}
              disabled={cycle}
              onChange={(e) => toggle(o.id, e.target.checked)}
            />
          );
        })}
      </div>
      {error && <div className="invalid-feedback d-block">{error}</div>}
    </fieldset>
  );
}
