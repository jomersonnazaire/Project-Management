import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DarRange, DarReportDto, SavedReportDto, SavedReportSummaryDto } from '@xc8/shared';
import { api, qs } from './client';

/** Data hooks for Milestone 6: the Daily Accomplishment Report (doc 14 §3, §14, §15). */

export function useDar(range: DarRange | null) {
  return useQuery({
    enabled: Boolean(range),
    queryKey: ['dar', range?.from, range?.to],
    queryFn: () => api<{ report: DarReportDto }>(`/dar${qs({ ...range })}`).then((r) => r.report),
  });
}

export interface SavedFilters {
  from?: string;
  to?: string;
  label?: 'ALL' | 'LATEST' | 'EARLIER';
  sent?: 'ALL' | 'SENT' | 'NOT_SENT';
}

export function useSavedReports(f: SavedFilters) {
  return useQuery({
    queryKey: ['dar', 'saved', f],
    queryFn: () =>
      api<{ items: SavedReportSummaryDto[] }>(`/dar/saved${qs({ ...f })}`).then((r) => r.items),
  });
}

export function useSavedReport(id: string | null) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ['dar', 'saved', 'one', id],
    queryFn: () => api<{ item: SavedReportDto }>(`/dar/saved/${id}`).then((r) => r.item),
  });
}

export function useSaveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (range: DarRange) =>
      api<{ item: SavedReportDto }>('/dar/saved', { method: 'POST', body: range }).then(
        (r) => r.item,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dar', 'saved'] }),
  });
}

export interface DarSendStatus {
  enabled: boolean;
  reason: 'ms_disabled' | 'not_linked' | 'no_supervisor' | null;
  canNotify: boolean;
  to: { name: string; email: string } | null;
  cc: string[];
}

export function useDarSendStatus() {
  return useQuery({
    queryKey: ['dar', 'send-status'],
    queryFn: () => api<DarSendStatus>('/dar/send-status'),
  });
}

export function useNotifySupervisor() {
  return useMutation({
    mutationFn: (savedId: string) =>
      api<{ notified: number }>(`/dar/saved/${savedId}/notify-supervisor`, {
        method: 'POST',
        body: {},
      }),
  });
}

/** Starts Send (a CSRF-protected POST, D1); the API answers with the Microsoft URL to open. */
export function useStartSend() {
  return useMutation({
    mutationFn: (savedId: string) =>
      api<{ url: string }>(`/dar/saved/${savedId}/send`, { method: 'POST', body: {} }),
  });
}
