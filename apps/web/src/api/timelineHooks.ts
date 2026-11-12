import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PROJECT_POLL_MS,
  CLIENT_IMPORT_TOKEN_HEADER,
  TIMELINE_CONFIRM_QUERY,
  TIMELINE_TEMPLATE_NAME,
  XLSX_MIME,
  phDateOf,
  timelineExportFileName,
  type TimelineImportCommitDto,
  type TimelineImportPreviewDto,
} from '@xc8/shared';
import type {
  SaveBaselineInput,
  SavePhaseListInput,
  TimelineBaselineDto,
  TimelineDto,
  TimelinePhaseDto,
} from '@xc8/shared';
import { api, downloadFile, qs } from './client';
import { usePoll } from './poll';

/** CR-22 Part B: the Timeline tab's data (FR-TL-01 to 07). Refetched after any task change. */
export const timelineKey = (projectId: string) => ['tasks', 'timeline', projectId] as const;

/** FR-ARF-03: `poll` on the Timeline tab refreshes every 30 s (and on focus). */
export function useTimeline(projectId: string, enabled = true, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: timelineKey(projectId),
    queryFn: () => api<TimelineDto>(`/projects/${projectId}/timeline`),
    enabled,
    ...usePoll(opts.poll ? PROJECT_POLL_MS : false),
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

/** FR-TL-08: Save baseline (Admin or a PM on the project; reason optional). */
export function useSaveBaseline(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveBaselineInput) =>
      api<{ baseline: TimelineBaselineDto }>(`/projects/${projectId}/baseline`, {
        method: 'POST',
        body,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

/** CR-22 FR-TL-16: the blank timeline template (headers, Instructions, no Task IDs). */
export const downloadTimelineTemplate = (projectId: string) =>
  downloadFile(`/projects/${projectId}/timeline/template`, TIMELINE_TEMPLATE_NAME);

/** CR-22 FR-TL-15: the project's tasks in the template, with hidden Task IDs. */
export const downloadTimelineExport = (projectId: string, projectName: string) =>
  downloadFile(
    `/projects/${projectId}/timeline/export`,
    timelineExportFileName(projectName, phDateOf(new Date())),
  );

const importPath = (
  projectId: string,
  step: 'preview' | 'commit',
  file: File,
  confirm: number[] = [],
) =>
  `/projects/${projectId}/timeline/import/${step}${qs({
    fileName: file.name,
    [TIMELINE_CONFIRM_QUERY]: confirm.length ? confirm.join(',') : undefined,
  })}`;

/** FR-TL-17: checks every row of the file; saves nothing. */
export function useTimelineImportPreview(projectId: string) {
  return useMutation({
    mutationFn: (file: File) =>
      api<TimelineImportPreviewDto>(importPath(projectId, 'preview', file), {
        method: 'POST',
        file: { body: file, type: XLSX_MIME },
      }),
  });
}

/**
 * FR-TL-18/25: the same file again with the preview's token and the confirmed Changed-since-export
 * rows. The API re-checks it and saves only if the result equals the preview (else 409
 * PREVIEW_STALE, nothing saved).
 */
export function useTimelineImportCommit(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, token, confirm }: { file: File; token: string; confirm: number[] }) =>
      api<TimelineImportCommitDto>(importPath(projectId, 'commit', file, confirm), {
        method: 'POST',
        file: { body: file, type: XLSX_MIME },
        headers: { [CLIENT_IMPORT_TOKEN_HEADER]: token },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}
