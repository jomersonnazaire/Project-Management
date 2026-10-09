import type { DragEvent } from 'react';

/**
 * HTML5 drag-and-drop for reorderable rows. The grip handle is the drag source; rows (and phase
 * cards) are drop targets. A scope keeps drops apart: a row only accepts drags of its own scope.
 */
const mime = (scope: string) =>
  `application/x-xc8-${scope.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export function dragHandleProps(enabled: boolean, scope: string, payload: string) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.setData(mime(scope), payload);
      e.dataTransfer.effectAllowed = 'move';
      const row = e.currentTarget.closest('tr');
      if (row && typeof e.dataTransfer.setDragImage === 'function') {
        e.dataTransfer.setDragImage(row, 16, 16);
      }
    },
  };
}

export function dropTargetProps(
  enabled: boolean,
  scope: string,
  onDrop: (payload: string) => void,
) {
  if (!enabled) return {};
  const type = mime(scope);
  return {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (e.dataTransfer.types.includes(type)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!e.dataTransfer.types.includes(type)) return;
      e.preventDefault();
      // A row inside a phase card handles the drop; the card itself doesn't also take it.
      e.stopPropagation();
      onDrop(e.dataTransfer.getData(type));
    },
  };
}
