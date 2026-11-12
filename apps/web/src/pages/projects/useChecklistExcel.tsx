import { TIMELINE_IMPORT_COPY, type ProjectDto, type TaskDto } from '@xc8/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { downloadChecklistExport, downloadChecklistTemplate } from '../../api/checklistHooks';
import { useIsCompact } from '../../lib/useMediaQuery';
import { ChecklistImportModal } from './ChecklistImportModal';
import { downloadedToast } from './checklistCopy';

/** Excel state shared by the menu and the empty-state buttons. */
export function useChecklistExcel(project: ProjectDto, tasks: TaskDto[]) {
  const compact = useIsCompact();
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'danger' | 'info' } | null>(
    null,
  );
  const failed = (e: unknown, text: string) =>
    setToast({ text: e instanceof ApiError && e.status !== 0 ? e.message : text, tone: 'danger' });
  return {
    toast,
    clearToast: () => setToast(null),
    openImport: () => {
      if (compact) setToast({ text: TIMELINE_IMPORT_COPY.PHONE, tone: 'info' });
      else setImportOpen(true);
    },
    downloadExport: () =>
      downloadChecklistExport(project.id, project.name)
        .then((name) => setToast({ text: downloadedToast(name, tasks), tone: 'success' }))
        .catch((e: unknown) => failed(e, "Couldn't download the checklist. Try again.")),
    downloadTemplate: () =>
      downloadChecklistTemplate(project.id)
        .then((name) => setToast({ text: `Template downloaded: ${name}`, tone: 'success' }))
        .catch((e: unknown) => failed(e, "Couldn't download the template. Try again.")),
    modal: importOpen ? (
      <ChecklistImportModal
        projectId={project.id}
        projectName={project.name}
        onClose={() => setImportOpen(false)}
      />
    ) : null,
  };
}
export type ChecklistExcel = ReturnType<typeof useChecklistExcel>;
