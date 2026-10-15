import type { ProjectTypeDto, ProjectTypePreselectDto } from '@xc8/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/** Active project types for the project form (doc 14 FR-PTY-02). */
export function useProjectTypes(enabled = true, includeInactive = false) {
  return useQuery({
    queryKey: ['projectTypes', includeInactive ? 'all' : 'active'],
    queryFn: () =>
      api<{ items: ProjectTypeDto[] }>(
        `/project-types${includeInactive ? '?includeInactive=true' : ''}`,
      ).then((r) => r.items),
    staleTime: 60_000,
    enabled,
  });
}

/** Admin › Settings › Project types (FR-PTY-01). */
export function useAdminProjectTypes() {
  return useQuery({
    queryKey: ['projectTypes', 'admin'],
    queryFn: () => api<{ items: ProjectTypeDto[] }>('/project-types/all').then((r) => r.items),
  });
}

export function useProjectTypeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { path: string; method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) =>
      api<{ item?: ProjectTypeDto }>(`/project-types${req.path}`, {
        method: req.method ?? 'POST',
        body: req.body,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['projectTypes'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

/** FR-PTY-04: the Activity type Time in / + Add entry preselects on a project task. */
export function useProjectTypePreselect(taskId: string | null | undefined) {
  return useQuery({
    queryKey: ['projectTypes', 'preselect', taskId],
    queryFn: () =>
      api<{ preselect: ProjectTypePreselectDto }>(
        `/project-types/preselect?taskId=${encodeURIComponent(taskId!)}`,
      ).then((r) => r.preselect),
    enabled: Boolean(taskId),
    staleTime: 30_000,
  });
}
