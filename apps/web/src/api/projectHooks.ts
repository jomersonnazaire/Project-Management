import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONVERSATION_POLL_MS, PROJECT_POLL_MS } from '@xc8/shared';
import type {
  ConversationUnreadDto,
  ActionEmailStartDto,
  ProjectSaveNoteDto,
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
import { usePoll } from './poll';

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

export function useProjects(
  params: { status?: string; q?: string; clientId?: string; projectTypeId?: string } = {},
) {
  return useQuery({
    queryKey: ['projects', 'list', params],
    queryFn: () => api<ProjectList>(`/projects${qs({ ...params, pageSize: 100 })}`),
  });
}

/**
 * CR-24 FR-ARF-08 / Q-173: the Projects list's 30-second and focus check. Unread counts only, one
 * request for the listed projects (never the threads, never one per row).
 */
export function useConversationUnread(
  list: { items: ProjectListItemDto[] } | undefined,
  listUpdatedAt: number,
  enabled: boolean,
) {
  const key = (list?.items ?? [])
    .map((p) => p.id)
    .sort()
    .join(',');
  return useQuery({
    queryKey: ['projects', 'conversation-unread', key],
    queryFn: () => api<ConversationUnreadDto>(`/projects/conversation-unread${qs({ ids: key })}`),
    enabled: enabled && key.length > 0,
    ...usePoll(PROJECT_POLL_MS),
    // The list payload already carries the first counts (NFR-60), so nothing is fetched on mount;
    // only the 30-second and focus checks ask for counts.
    initialData: () => ({
      counts: Object.fromEntries((list?.items ?? []).map((p) => [p.id, p.conversationUnread ?? 0])),
    }),
    initialDataUpdatedAt: listUpdatedAt,
    staleTime: PROJECT_POLL_MS,
  });
}

/** FR-ARF-03: `poll` on the project page (header, Checklist, Board) refreshes every 30 s. */
export function useProject(id: string, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['projects', 'detail', id],
    queryFn: () => api<{ project: ProjectDto }>(`/projects/${id}`).then((r) => r.project),
    ...usePoll(opts.poll ? PROJECT_POLL_MS : false),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectInput) =>
      api<{ project: ProjectDto; warnings: string[]; email?: ActionEmailStartDto }>('/projects', {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidateProjects(qc),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    // `email` is there when the save asked to email the people it added (action emails).
    mutationFn: (body: UpdateProjectInput) =>
      api<{ project: ProjectDto; notes?: ProjectSaveNoteDto[]; email?: ActionEmailStartDto }>(
        `/projects/${id}`,
        {
          method: 'PATCH',
          body,
        },
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
export function useProjectTasks(
  projectId: string,
  assignee?: string,
  opts: { poll?: boolean } = {},
) {
  return useQuery({
    queryKey: ['tasks', 'project', projectId, assignee ?? ''],
    queryFn: () =>
      api<{ items: TaskDto[] }>(`/projects/${projectId}/tasks${qs({ assignee })}`).then(
        (r) => r.items,
      ),
    ...usePoll(opts.poll ? PROJECT_POLL_MS : false),
  });
}

/** FR-ARF-02: an open task panel (its Follow-ups) refreshes every 10 s with `poll`. */
export function useTask(id: string | null, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['tasks', 'detail', id],
    queryFn: () => api<{ task: TaskDto }>(`/tasks/${id}`).then((r) => r.task),
    enabled: Boolean(id),
    ...usePoll(opts.poll ? CONVERSATION_POLL_MS : false),
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
      // `email` is there when a task save asked to email the people it newly assigned.
      api<{ task?: TaskDto; email?: ActionEmailStartDto }>(req.path, {
        method: req.method ?? 'POST',
        body: req.body,
      }),
    // Also on errors: a 409 VERSION_CONFLICT means someone else changed the task, so refetch.
    onSettled: () => invalidateProjects(qc),
  });
}

/**
 * CR-20 FR-NTF-12: the user opened a task's follow-ups list, so all its follow-ups are seen.
 * Clears the badge's "new" state in the cached lists at once, then refetches them to confirm. The
 * open panel keeps its copy (so it can still mark which ones were new) and refetches next time.
 */
export function useMarkFollowUpsSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      api<{ followUps: number; followUpsUnseen: number }>(`/tasks/${taskId}/follow-ups/seen`, {
        method: 'POST',
      }),
    onMutate: (taskId) => {
      const clear = <T extends { id: string; followUpsUnseen: number }>(t: T): T =>
        t.id === taskId ? { ...t, followUpsUnseen: 0 } : t;
      qc.setQueriesData<TaskDto[]>({ queryKey: ['tasks', 'project'] }, (list) => list?.map(clear));
      qc.setQueriesData<MyTasksDto>(
        { queryKey: ['tasks', 'mine'] },
        (d) => d && { ...d, items: d.items.map(clear) },
      );
    },
    onSettled: (_data, _error, taskId) => {
      void qc.invalidateQueries({ queryKey: ['tasks', 'project'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'mine'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'detail', taskId], refetchType: 'none' });
    },
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
