import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProjectInput,
  CreateTaskInput,
  MyTasksDto,
  PersonDto,
  ReorderTasksInput,
  ProjectDto,
  ProjectListItemDto,
  TaskDto,
  TaskHistoryDto,
  TemplateDto,
  TemplateInput,
  TemplateSummaryDto,
  UpdateProjectInput,
  UpdateTaskInput,
} from '@xc8/shared';
import { api, qs } from './client';

/** Data hooks for Milestone 2: templates, projects, tasks and My tasks. */

const invalidateProjects = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['projects'] });
  void qc.invalidateQueries({ queryKey: ['tasks'] });
  void qc.invalidateQueries({ queryKey: ['clients'] });
  void qc.invalidateQueries({ queryKey: ['contacts'] });
  void qc.invalidateQueries({ queryKey: ['templates'] });
};

// ----- People picker -----
export function usePeople(enabled = true) {
  return useQuery({
    queryKey: ['people'],
    queryFn: () => api<{ items: PersonDto[] }>('/people').then((r) => r.items),
    enabled,
    staleTime: 60_000,
  });
}

// ----- Templates -----
export function useTemplates(params: { status?: string; q?: string } = {}) {
  return useQuery({
    queryKey: ['templates', 'list', params],
    queryFn: () => api<{ items: TemplateSummaryDto[] }>(`/templates${qs(params)}`),
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ['templates', 'detail', id],
    queryFn: () => api<{ template: TemplateDto }>(`/templates/${id}`).then((r) => r.template),
    enabled: Boolean(id),
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<TemplateInput> }) =>
      (id
        ? api<{ template: TemplateDto }>(`/templates/${id}`, { method: 'PATCH', body })
        : api<{ template: TemplateDto }>('/templates', { method: 'POST', body })
      ).then((r) => r.template),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export type TemplateAction = 'publish' | 'new-version' | 'duplicate' | 'archive' | 'restore';

export function useTemplateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: TemplateAction }) =>
      api<{ template: TemplateDto }>(`/templates/${id}/${action}`, { method: 'POST' }).then(
        (r) => r.template,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

// ----- Projects -----
export interface ProjectList {
  items: ProjectListItemDto[];
  total: number;
  counts: Record<string, number>;
}

export function useProjects(params: { status?: string; q?: string; clientId?: string } = {}) {
  return useQuery({
    queryKey: ['projects', 'list', params],
    queryFn: () => api<ProjectList>(`/projects${qs({ ...params, pageSize: 100 })}`),
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['projects', 'detail', id],
    queryFn: () => api<{ project: ProjectDto }>(`/projects/${id}`).then((r) => r.project),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectInput) =>
      api<{ project: ProjectDto; warnings: string[] }>('/projects', { method: 'POST', body }),
    onSuccess: () => invalidateProjects(qc),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectInput) =>
      api<{ project: ProjectDto }>(`/projects/${id}`, { method: 'PATCH', body }).then(
        (r) => r.project,
      ),
    onSuccess: () => invalidateProjects(qc),
  });
}

export function useProjectAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      req: 'archive' | 'unarchive' | 'delete' | { action: 'archive'; confirmOpenIssues: true },
    ): Promise<void> => {
      if (req === 'delete') await api<void>(`/projects/${id}`, { method: 'DELETE' });
      else if (typeof req === 'object') {
        // FR-ISS-13: archive anyway after the open-issues warning.
        await api<{ project: ProjectDto }>(`/projects/${id}/archive`, {
          method: 'POST',
          body: { confirmOpenIssues: true },
        });
      } else await api<{ project: ProjectDto }>(`/projects/${id}/${req}`, { method: 'POST' });
    },
    onSuccess: () => invalidateProjects(qc),
  });
}

export interface ContactOption {
  id: string;
  name: string;
  position: string | null;
  email: string | null;
  added: boolean;
}

export function useContactOptions(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['projects', 'contact-options', projectId],
    queryFn: () =>
      api<{ items: ContactOption[] }>(`/projects/${projectId}/contact-options`).then(
        (r) => r.items,
      ),
    enabled,
  });
}

export function useProjectContact(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, remove }: { contactId: string; remove?: boolean }) =>
      remove
        ? api<{ project: ProjectDto }>(`/projects/${projectId}/contacts/${contactId}`, {
            method: 'DELETE',
          })
        : api<{ project: ProjectDto }>(`/projects/${projectId}/contacts`, {
            method: 'POST',
            body: { contactId },
          }),
    onSuccess: () => invalidateProjects(qc),
  });
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  action: string;
  changes: { field: string; old: unknown; new: unknown }[];
  reason: string | null;
}

export function useProjectActivity(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['projects', 'activity', projectId],
    queryFn: () =>
      api<{ items: ActivityEntry[] }>(`/projects/${projectId}/activity`).then((r) => r.items),
    enabled,
  });
}

// ----- Tasks -----
export function useProjectTasks(projectId: string, assignee?: string) {
  return useQuery({
    queryKey: ['tasks', 'project', projectId, assignee ?? ''],
    queryFn: () =>
      api<{ items: TaskDto[] }>(`/projects/${projectId}/tasks${qs({ assignee })}`).then(
        (r) => r.items,
      ),
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: ['tasks', 'detail', id],
    queryFn: () => api<{ task: TaskDto }>(`/tasks/${id}`).then((r) => r.task),
    enabled: Boolean(id),
  });
}

export function useTaskHistory(id: string | null) {
  return useQuery({
    queryKey: ['tasks', 'history', id],
    queryFn: () => api<{ items: TaskHistoryDto[] }>(`/tasks/${id}/history`).then((r) => r.items),
    enabled: Boolean(id),
  });
}

export function useMyTasks(view?: string, q?: string) {
  return useQuery({
    queryKey: ['tasks', 'mine', view ?? '', q ?? ''],
    queryFn: () => api<MyTasksDto>(`/tasks/mine${qs({ view, q })}`),
  });
}

/** Any task write: status, unblock, approve, reject, evidence, follow-up, plan edit, delete. */
export function useTaskMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { path: string; method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) =>
      api<{ task?: TaskDto }>(req.path, { method: req.method ?? 'POST', body: req.body }),
    // Also on errors: a 409 VERSION_CONFLICT means someone else changed the task, so refetch.
    onSettled: () => invalidateProjects(qc),
  });
}

export function taskPatch(id: string, body: UpdateTaskInput) {
  return { path: `/tasks/${id}`, method: 'PATCH' as const, body };
}

export function taskCreate(projectId: string, body: CreateTaskInput) {
  return { path: `/projects/${projectId}/tasks`, method: 'POST' as const, body };
}

/** Reorder one phase's tasks (Checklist drag-and-drop / Move up/down). */
export function useReorderTasks(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReorderTasksInput) =>
      api<{ items: TaskDto[] }>(`/projects/${projectId}/tasks/reorder`, { method: 'POST', body }),
    onSuccess: (res) => {
      // Show the new order at once, then refetch everything that numbers tasks.
      qc.setQueryData(['tasks', 'project', projectId, ''], res.items);
    },
    onSettled: () => invalidateProjects(qc),
  });
}
