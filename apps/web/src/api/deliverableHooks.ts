import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { DeliverableItemDto, TaskDto } from '@xc8/shared';
import { api } from './client';

/**
 * CR-23 FR-DLV-02..07: one call per deliverable change (add, tick/untick, edit, reorder, remove,
 * Undo). Each sends the task version (409 VERSION_CONFLICT when someone else changed it) and gets
 * the whole task back, which goes straight into the cache.
 */
export type DeliverableChange =
  | { kind: 'add'; text: string }
  | { kind: 'tick'; itemId: string; done: boolean }
  | { kind: 'edit'; itemId: string; text: string }
  | { kind: 'reorder'; itemIds: string[] }
  | { kind: 'remove'; itemId: string }
  | { kind: 'restore'; itemId: string };

function request(task: Pick<TaskDto, 'id' | 'version'>, c: DeliverableChange) {
  const base = `/tasks/${task.id}/deliverable-items`;
  const version = task.version;
  switch (c.kind) {
    case 'add':
      return api<{ task: TaskDto }>(base, { method: 'POST', body: { text: c.text, version } });
    case 'tick':
      return api<{ task: TaskDto }>(`${base}/${c.itemId}`, {
        method: 'PATCH',
        body: { done: c.done, version },
      });
    case 'edit':
      return api<{ task: TaskDto }>(`${base}/${c.itemId}`, {
        method: 'PATCH',
        body: { text: c.text, version },
      });
    case 'reorder':
      return api<{ task: TaskDto }>(`${base}/reorder`, {
        method: 'POST',
        body: { itemIds: c.itemIds, version },
      });
    case 'remove':
      return api<{ task: TaskDto }>(`${base}/${c.itemId}?version=${version}`, { method: 'DELETE' });
    case 'restore':
      return api<{ task: TaskDto }>(`${base}/${c.itemId}/restore`, {
        method: 'POST',
        body: { version },
      });
  }
}

/** Puts the saved task into every cached copy (detail and the project's lists) at once. */
export function putTask(qc: QueryClient, task: TaskDto) {
  qc.setQueryData(['tasks', 'detail', task.id], task);
  qc.setQueriesData<TaskDto[]>({ queryKey: ['tasks', 'project', task.projectId] }, (list) =>
    list?.map((t) => (t.id === task.id ? task : t)),
  );
}

/** The list as it looks right after a tick (optimistic; FR-DLV §5.3). */
export function withTick(
  items: DeliverableItemDto[],
  itemId: string,
  done: boolean,
  me: { id: string; name: string } | null,
  at: string,
): DeliverableItemDto[] {
  return items.map((i) =>
    i.id === itemId
      ? {
          ...i,
          done,
          doneBy: done ? me : null,
          doneAt: done ? at : null,
          doneFromImport: false,
        }
      : i,
  );
}

export function useDeliverableChange(task: Pick<TaskDto, 'id' | 'version' | 'projectId'>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: DeliverableChange) => request(task, c).then((r) => r.task),
    onSuccess: (fresh) => putTask(qc, fresh),
    onError: () => {
      // A 409 means someone else changed the task: reload it (and the lists that show chips).
      void qc.invalidateQueries({ queryKey: ['tasks', 'detail', task.id] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'project', task.projectId] });
    },
    onSettled: () => {
      // The timeline and other lists only need a background refresh.
      void qc.invalidateQueries({ queryKey: ['tasks', 'timeline'], refetchType: 'none' });
      void qc.invalidateQueries({ queryKey: ['tasks', 'mine'], refetchType: 'none' });
    },
  });
}
