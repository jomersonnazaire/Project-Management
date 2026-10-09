import { Button } from 'react-bootstrap';

/** Keyboard alternative to drag-and-drop reordering: Move up / Move down (NFR-15). */
export function ReorderControls({
  name,
  index,
  count,
  disabled,
  onMove,
}: {
  name: string;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (to: number) => void;
}) {
  return (
    <span className="d-inline-flex gap-1 text-nowrap">
      <Button
        variant="link"
        size="sm"
        className="p-0"
        aria-label={`Move ${name} up`}
        title="Move up"
        disabled={disabled || index === 0}
        onClick={() => onMove(index - 1)}
      >
        <i className="bx bx-chevron-up fs-5" aria-hidden="true" />
      </Button>
      <Button
        variant="link"
        size="sm"
        className="p-0"
        aria-label={`Move ${name} down`}
        title="Move down"
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        <i className="bx bx-chevron-down fs-5" aria-hidden="true" />
      </Button>
    </span>
  );
}

/**
 * The ⋮⋮ drag handle. Drag it to reorder; from the keyboard, focus it and press Alt+↑ / Alt+↓.
 */
export function DragHandle({
  name,
  index,
  count,
  disabled,
  onMove,
  dragProps,
}: {
  name: string;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (to: number) => void;
  dragProps: object;
}) {
  return (
    <button
      type="button"
      className="drag-handle btn btn-link btn-sm p-0"
      aria-label={`Reorder ${name}`}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      aria-disabled={disabled || undefined}
      title="Drag to reorder, or press Alt+↑ / Alt+↓"
      onKeyDown={(e) => {
        if (!e.altKey || disabled) return;
        const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
        if (to === null) return;
        e.preventDefault();
        if (to >= 0 && to < count) onMove(to);
      }}
      {...dragProps}
    >
      <span aria-hidden="true">⋮⋮</span>
    </button>
  );
}
