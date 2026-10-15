import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ReportFilterOptionsDto,
  DashboardDto,
  EffortRowDto,
  IssueReportDto,
  MyProjectsDto,
  OverdueRowDto,
  ProjectStatusRowDto,
  ReportList,
  TimeLockDto,
  TimeLockPolicy,
  TimesheetReportDto,
  WorkloadDto,
} from '@xc8/shared';
import { api, qs } from './client';

/** Data hooks for Milestone 4: dashboard, My projects, workload, reports, time-lock setting. */

export type Filters = Record<string, string | undefined>;

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardDto>('/dashboard') });
}

export function useMyProjects(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'my-projects'],
    queryFn: () => api<MyProjectsDto>('/dashboard/my-projects'),
    enabled,
  });
}

export function useWorkload(week: string | undefined, teamId: string | undefined) {
  return useQuery({
    queryKey: ['workload', week ?? '', teamId ?? ''],
    queryFn: () => api<WorkloadDto>(`/workload${qs({ week, teamId })}`),
  });
}

export const REPORTS = [
  'effort-variance',
  'overdue',
  'timesheets',
  'project-status',
  'issues',
] as const;
export type ReportKey = (typeof REPORTS)[number];
export interface ReportBodies {
  'effort-variance': ReportList<EffortRowDto>;
  overdue: ReportList<OverdueRowDto>;
  timesheets: TimesheetReportDto;
  'project-status': ReportList<ProjectStatusRowDto>;
  issues: IssueReportDto;
}

/** DR-43: Project and Client filter options within the caller's report scope. */
export function useReportFilters() {
  return useQuery({
    queryKey: ['reports', 'filters'],
    queryFn: () => api<ReportFilterOptionsDto>('/reports/filters'),
  });
}

export function useReport<K extends ReportKey>(key: K, filters: Filters, enabled = true) {
  return useQuery({
    queryKey: ['reports', key, filters],
    queryFn: () => api<ReportBodies[K]>(`/reports/${key}${qs(filters)}`),
    enabled,
  });
}

/** FR-ACL-16: the rows to export come from the audited export route (needs Reports Export). */
export function fetchReportExport<K extends ReportKey>(key: K, filters: Filters) {
  return api<ReportBodies[K]>(`/reports/${key}/export${qs(filters)}`);
}

export function useTimeLock(enabled = true) {
  return useQuery({
    queryKey: ['settings', 'time-lock'],
    queryFn: () => api<TimeLockDto>('/settings/time-lock'),
    enabled,
  });
}

export function useSaveTimeLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TimeLockPolicy & { version: number }) =>
      api<TimeLockDto>('/settings/time-lock', { method: 'PUT', body }),
    onSuccess: (dto) => qc.setQueryData(['settings', 'time-lock'], dto),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'time-lock'] });
      void qc.invalidateQueries({ queryKey: ['time'] });
    },
  });
}
