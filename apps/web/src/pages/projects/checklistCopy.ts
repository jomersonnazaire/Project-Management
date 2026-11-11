import {
  DELIVERABLE_LOCKED_COPY,
  TIMELINE_IMPORT_COPY,
  importLockedTooltip,
  type ProjectDto,
  type TaskDto,
} from '@xc8/shared';

/** CR-23 UIE §3.1 / §5.1 copy and rules for the Checklist's Excel menu and deliverables. */

export const CHECKLIST_VIEW_ONLY =
  'View only. The project PM or an Admin changes the plan and imports from Excel. If you own a task, you can tick its deliverables in the task panel.';

/** Why Import is off on this project, or null when it's allowed. */
export function importLockReason(project: ProjectDto): string | null {
  if (project.can.checklistImport) return null;
  if (project.archived) return importLockedTooltip('archived');
  if (project.status === 'COMPLETED') return importLockedTooltip('completed');
  if (project.status === 'CANCELLED') return importLockedTooltip('cancelled');
  return TIMELINE_IMPORT_COPY.IMPORT_NOT_ALLOWED;
}

export function downloadedToast(name: string, tasks: TaskDto[]) {
  const n = tasks.length;
  const cancelled = tasks.some((t) => t.status === 'CANCELLED');
  return `Downloaded ${name} (${n} task${n === 1 ? '' : 's'}${cancelled ? ', cancelled included' : ''}).`;
}

/** Locked-project copy for deliverables (FR-DLV-06); also used by the task panel. */
export function deliverablesLockedLine(project: Pick<ProjectDto, 'archived' | 'status'>) {
  if (project.archived) return DELIVERABLE_LOCKED_COPY.ARCHIVED;
  if (project.status === 'COMPLETED') return DELIVERABLE_LOCKED_COPY.COMPLETED;
  if (project.status === 'CANCELLED') return DELIVERABLE_LOCKED_COPY.CANCELLED;
  return null;
}
