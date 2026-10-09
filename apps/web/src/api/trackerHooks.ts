import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LookupDto,
  LookupKind,
  Ref,
  RunningDto,
  TrackerDayDto,
  TrackerEntryDto,
} from '@xc8/shared';
import { LOOKUP_LABELS } from '@xc8/shared';
import { api, qs } from './client';

/** Data hooks for Milestone 5: the Activity tracker (doc 14 §2) and its Admin lists. */

export interface LookupOptions {
  activityTypes: Ref[];
  locations: Ref[];
  modules: Ref[];
}

/** Active Activity types, Locations and Modules for entry forms. */
export function useLookups() {
  return useQuery({
    queryKey: ['lookups'],
    queryFn: () => api<LookupOptions>('/lookups'),
    staleTime: 5 * 60_000,
  });
}

export function useTrackerDay(date: string, userId?: string, enabled = true) {
  return useQuery({
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(date),
    queryKey: ['tracker', 'day', date, userId ?? 'me'],
    queryFn: () =>
      api<{ day: TrackerDayDto }>(`/tracker/day${qs({ date, userId })}`).then((r) => r.day),
  });
}

export function useTrackerPeople(enabled = true) {
  return useQuery({
    queryKey: ['tracker', 'people'],
    queryFn: () => api<{ items: Ref[] }>('/tracker/people').then((r) => r.items),
    enabled,
  });
}

/** The running timer, refreshed every minute (and after every tracker change). */
export function useRunning(enabled = true) {
  return useQuery({
    queryKey: ['tracker', 'running'],
    queryFn: () => api<RunningDto>('/tracker/running'),
    refetchInterval: 60_000,
    enabled,
  });
}

function useInvalidateTracker() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['tracker'] });
    void qc.invalidateQueries({ queryKey: ['time'] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['my-tasks'] });
  };
}

export function useTrackerMutation() {
  const done = useInvalidateTracker();
  return useMutation({
    mutationFn: (req: {
      path: string;
      method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      body?: unknown;
    }) =>
      api<{ entry?: TrackerEntryDto; day?: TrackerDayDto; stopped?: string | null }>(
        `/tracker${req.path}`,
        { method: req.method ?? 'POST', body: req.body ?? {} },
      ),
    onSettled: done,
  });
}

export function useAdminLookups(kind: LookupKind) {
  return useQuery({
    queryKey: ['lookups', 'admin', kind],
    queryFn: () =>
      api<{ items: LookupDto[] }>(`/lookups/${LOOKUP_LABELS[kind].path}/all`).then((r) => r.items),
  });
}

export function useLookupMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { path: string; method?: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) =>
      api<{ item?: LookupDto }>(`/lookups${req.path}`, {
        method: req.method ?? 'POST',
        body: req.body,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['lookups'] }),
  });
}
