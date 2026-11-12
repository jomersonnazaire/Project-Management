import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CLIENT_IMPORT_TOKEN_HEADER,
  TIMELINE_CONFIRM_QUERY,
  TIMELINE_TEMPLATE_NAME,
  XLSX_MIME,
  phDateOf,
  timelineExportFileName,
  type TimelineImportCommitDto,
  type TimelineImportPreviewDto,
} from '@xc8/shared';
import { api, downloadFile, qs } from './client';

/**
 * CR-23: the one Excel import/export, on the Checklist tab (replaces the CR-22 Timeline import).
 * The file holds the CR-22 timeline columns plus Deliverables.
 */

/** The saved file's name: the server's Content-Disposition, else the expected one. */
const savedName = (h: Headers, fallback: string) =>
  /filename="([^"]+)"/.exec(h.get('Content-Disposition') ?? '')?.[1] ?? fallback;

/** CR-23 FR-CLX-01 (was CR-22 FR-TL-16): the blank template (headers, Instructions, no Task IDs). */
export const downloadChecklistTemplate = (projectId: string) =>
  downloadFile(`/projects/${projectId}/checklist/template`, TIMELINE_TEMPLATE_NAME).then((h) =>
    savedName(h, TIMELINE_TEMPLATE_NAME),
  );

/** CR-23 FR-CLX-01: the project's tasks and deliverables in the file, with hidden Task IDs. */
export const downloadChecklistExport = (projectId: string, projectName: string) => {
  const name = timelineExportFileName(projectName, phDateOf(new Date()));
  return downloadFile(`/projects/${projectId}/checklist/export`, name).then((h) =>
    savedName(h, name),
  );
};

const importPath = (
  projectId: string,
  step: 'preview' | 'commit',
  file: File,
  confirm: number[] = [],
) =>
  `/projects/${projectId}/checklist/import/${step}${qs({
    fileName: file.name,
    [TIMELINE_CONFIRM_QUERY]: confirm.length ? confirm.join(',') : undefined,
  })}`;

/** FR-TL-17: checks every row of the file; saves nothing. */
export function useChecklistImportPreview(projectId: string) {
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
export function useChecklistImportCommit(projectId: string) {
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
