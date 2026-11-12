import { pollInterval } from '@xc8/shared';
import { onlineManager, useIsMutating, type Query } from '@tanstack/react-query';

/**
 * CR-24 FR-ARF-01..07: polling for the in-scope screens only (the app-wide defaults in main.tsx
 * stay `refetchOnWindowFocus: false`). Each opted-in query:
 * - refetches every `base` ms while mounted and the browser tab is visible (TanStack's
 *   `refetchIntervalInBackground: false` skips hidden tabs), and again on focus;
 * - skips the interval while the browser is offline, or while a save from this browser is in
 *   flight (Q-182), so a refetch can't race the save;
 * - backs off after failed checks (doubling, at most 60 s) and returns to `base` after a success.
 * - is fresh on every mount, so a tab you come back to never shows old data.
 * Pass `false` to turn it off (e.g. the hook is also used off the in-scope screens).
 */
export function usePoll(base: number | false) {
  const saving = useIsMutating() > 0;
  if (base === false) return {};
  return {
    // Fresh whenever the screen mounts (e.g. coming back to the Timeline or Conversation tab).
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query: Pick<Query, 'state'>) =>
      saving || !onlineManager.isOnline() ? false : pollInterval(base, failuresInARow(query)),
  } as const;
}

/** Errors since the last success. `fetchFailureCount` resets on every fetch, so count here. */
const errorsAtSuccess = new WeakMap<object, number>();
export function failuresInARow(query: Pick<Query, 'state'>): number {
  const { state } = query;
  if (state.status === 'success' || state.dataUpdatedAt >= state.errorUpdatedAt) {
    errorsAtSuccess.set(query, state.errorUpdateCount);
    return 0;
  }
  return state.errorUpdateCount - (errorsAtSuccess.get(query) ?? 0);
}
