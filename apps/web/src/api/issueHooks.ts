import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateIssueInput,
  IssueActivityDto,
  IssueDto,
  IssueListDto,
  IssueOptionsDto,
  IssueStatusInput,
  PhaseDto,
  UpdateIssueInput,
  UploadTicketDto,
} from '@xc8/shared';
import { api, qs } from './client';
import { fileMeta } from './m3Hooks';

/** Data hooks for Milestone 3.5 issue tracking (doc 13) and phase delete. */

export interface IssueFilters {
  status?: string;
  severity?: string;
  stage?: string;
  ownerId?: string;
  projectId?: string;
  clientId?: string;
  taskId?: string;
  q?: string;
}

const NO_COUNTS: IssueListDto['counts'] = { open: 0, critical: 0, high: 0, overdue: 0, waiting: 0 };
/** Tolerates partial bodies (older API, test doubles) so the page never crashes on a missing field. */
function normalizeList(r: Partial<IssueListDto> | undefined): IssueListDto {
  return {
    items: Array.isArray(r?.items) ? r.items : [],
    counts: { ...NO_COUNTS, ...(r?.counts ?? {}) },
    can: { create: Boolean(r?.can?.create) },
  };
}

export function useProjectIssues(projectId: string, filters: IssueFilters = {}, enabled = true) {
  return useQuery({
    queryKey: ['issues', 'project', projectId, filters],
    queryFn: () =>
      api<IssueListDto>(`/projects/${projectId}/issues${qs({ ...filters })}`).then(normalizeList),
    enabled,
  });
}

export function useAllIssues(filters: IssueFilters = {}, enabled = true) {
  return useQuery({
    queryKey: ['issues', 'all', filters],
    queryFn: () => api<IssueListDto>(`/issues${qs({ ...filters })}`).then(normalizeList),
    enabled,
  });
}

export function useIssue(id: string) {
  return useQuery({
    queryKey: ['issues', 'one', id],
    queryFn: () => api<{ issue: IssueDto }>(`/issues/${id}`).then((r) => r.issue),
  });
}

export function useIssueActivity(id: string) {
  return useQuery({
    queryKey: ['issues', 'activity', id],
    queryFn: () =>
      api<{ items?: IssueActivityDto[] }>(`/issues/${id}/activity`).then((r) => r?.items ?? []),
  });
}

export function useIssueOptions(projectId: string | null) {
  return useQuery({
    queryKey: ['issues', 'options', projectId],
    queryFn: () =>
      api<Partial<IssueOptionsDto>>(`/projects/${projectId}/issue-options`).then(
        (r): IssueOptionsDto => ({
          users: r?.users ?? [],
          contacts: r?.contacts ?? [],
          tasks: r?.tasks ?? [],
          messages: r?.messages ?? [],
          defaultStage: r?.defaultStage ?? 'BEFORE_GO_LIVE',
          defaultDue: r?.defaultDue ?? ({} as IssueOptionsDto['defaultDue']),
        }),
      ),
    enabled: Boolean(projectId),
  });
}

export function useInvalidateIssues() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['issues'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['documents'] });
    // Linking issues changes whether a task can be deleted.
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  };
}

export function useRaiseIssue(projectId: string) {
  const done = useInvalidateIssues();
  return useMutation({
    mutationFn: (body: CreateIssueInput) =>
      api<{ issue: IssueDto }>(`/projects/${projectId}/issues`, { method: 'POST', body }).then(
        (r) => r.issue,
      ),
    onSuccess: done,
  });
}

export function useIssueMutation(id: string) {
  const done = useInvalidateIssues();
  return useMutation({
    mutationFn: (
      req:
        | { kind: 'update'; body: UpdateIssueInput }
        | { kind: 'status'; body: IssueStatusInput }
        | { kind: 'comment'; text: string }
        | { kind: 'delete' },
    ) => {
      if (req.kind === 'update') {
        return api<{ issue: IssueDto }>(`/issues/${id}`, { method: 'PATCH', body: req.body });
      }
      if (req.kind === 'status') {
        return api<{ issue: IssueDto }>(`/issues/${id}/status`, { method: 'POST', body: req.body });
      }
      if (req.kind === 'comment') {
        return api<unknown>(`/issues/${id}/comments`, {
          method: 'POST',
          body: { text: req.text },
        });
      }
      return api<void>(`/issues/${id}`, { method: 'DELETE' });
    },
    // Also on errors: a 409 VERSION_CONFLICT means someone else changed it, so refetch.
    onSettled: done,
  });
}

export const issueTickets = (issueId: string, files: File[]) =>
  api<{ uploads: UploadTicketDto[] }>(`/issues/${issueId}/attachments/uploads`, {
    method: 'POST',
    body: { files: files.map(fileMeta) },
  });

// ----- Phases (M3.5 delete) -----
export function useProjectPhases(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ['tasks', 'phases', projectId],
    queryFn: () =>
      api<{ items?: PhaseDto[] }>(`/projects/${projectId}/phases`).then((r) =>
        Array.isArray(r?.items) ? r.items : [],
      ),
    enabled,
  });
}

export function useDeletePhase(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<void>(`/projects/${projectId}/phases${qs({ name })}`, { method: 'DELETE' }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}
