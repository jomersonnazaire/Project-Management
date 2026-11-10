import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SavePhaseListInput, TimelineDto, TimelinePhaseDto } from '@xc8/shared';
import { api } from './client';

/** CR-22 Part B: the Timeline tab's data (FR-TL-01 to 07). Refetched after any task change. */
export const timelineKey = (projectId: string) => ['tasks', 'timeline', projectId] as const;

export function useTimeline(projectId: string, enabled = true) {
  return useQuery({
    queryKey: timelineKey(projectId),
    queryFn: () => api<TimelineDto>(`/projects/${projectId}/timeline`),
    enabled,
  });
}

/** FR-TL-23: the phase manager saves the whole list (order, names, target dates). */
export function useSavePhaseList(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SavePhaseListInput) =>
      api<{ items: TimelinePhaseDto[]; targetsOnly: boolean; changed: number }>(
        `/projects/${projectId}/phase-list`,
        { method: 'PUT', body },
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}
