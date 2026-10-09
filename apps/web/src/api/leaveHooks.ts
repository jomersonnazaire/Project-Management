import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EntitlementRowDto,
  LeaveBalanceDto,
  LeaveDto,
  LeaveTypeDto,
  Ref,
  RecordLeaveInput,
} from '@xc8/shared';
import { api, qs } from './client';

/** Data hooks for Milestone 7: Leave (doc 14 §4, §12 Q-46, §16). */

export function useLeaveTypes() {
  return useQuery({
    queryKey: ['leave', 'types'],
    queryFn: () => api<{ items: LeaveTypeDto[] }>('/leave/types').then((r) => r.items),
  });
}

export function useLeaveBalances(year: number) {
  return useQuery({
    queryKey: ['leave', 'balances', year],
    queryFn: () =>
      api<{ year: number; items: LeaveBalanceDto[]; supervisor: Ref | null }>(
        `/leave/balances${qs({ year })}`,
      ),
  });
}

export function useMyLeave(year: number) {
  return useQuery({
    queryKey: ['leave', 'mine', year],
    queryFn: () => api<{ items: LeaveDto[] }>(`/leave${qs({ year })}`).then((r) => r.items),
  });
}

export interface TeamLeave {
  items: LeaveDto[];
  people: { user: Ref; noSupervisor: boolean; items: LeaveBalanceDto[] }[];
  year: number;
}
export function useTeamLeave(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['leave', 'team'],
    queryFn: () => api<TeamLeave>('/leave/team'),
  });
}

function useInvalidateLeave() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['leave'] });
    void qc.invalidateQueries({ queryKey: ['tracker'] });
    void qc.invalidateQueries({ queryKey: ['dar'] });
  };
}

export function useRecordLeave() {
  const done = useInvalidateLeave();
  return useMutation({
    mutationFn: (body: RecordLeaveInput) =>
      api<{ item: LeaveDto }>('/leave', { method: 'POST', body }).then((r) => r.item),
    onSuccess: done,
  });
}

export function useCancelLeave() {
  const done = useInvalidateLeave();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ item: LeaveDto }>(`/leave/${id}/cancel`, { method: 'POST' }).then((r) => r.item),
    onSuccess: done,
  });
}

export function useAllLeaveTypes() {
  return useQuery({
    queryKey: ['leave', 'types', 'all'],
    queryFn: () => api<{ items: LeaveTypeDto[] }>('/leave/types/all').then((r) => r.items),
  });
}

export function useLeaveTypeMutation() {
  const done = useInvalidateLeave();
  return useMutation({
    mutationFn: (req: { id?: string; body: unknown }) =>
      api<{ item: LeaveTypeDto }>(req.id ? `/leave/types/${req.id}` : '/leave/types', {
        method: req.id ? 'PATCH' : 'POST',
        body: req.body,
      }).then((r) => r.item),
    onSuccess: done,
  });
}

export function useEntitlements(year: number, leaveTypeId: string | undefined) {
  return useQuery({
    enabled: Boolean(leaveTypeId),
    queryKey: ['leave', 'entitlements', year, leaveTypeId],
    queryFn: () =>
      api<{ items: EntitlementRowDto[] }>(`/leave/entitlements${qs({ year, leaveTypeId })}`).then(
        (r) => r.items,
      ),
  });
}

export function useSetEntitlement() {
  const done = useInvalidateLeave();
  return useMutation({
    mutationFn: (body: {
      userId: string;
      leaveTypeId: string;
      year: number;
      days: number;
      carryOver: number;
    }) =>
      api<{ item: EntitlementRowDto; warning: string | null }>('/leave/entitlements', {
        method: 'PUT',
        body,
      }),
    onSuccess: done,
  });
}
