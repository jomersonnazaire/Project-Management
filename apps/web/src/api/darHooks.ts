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
