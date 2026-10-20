import type { ActionEmailInput, EmailStatusDto } from '@xc8/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/** Whether the "Email {name}" option shows (flag on) and is usable (Microsoft-linked). */
export function useEmailStatus() {
  return useQuery({
    queryKey: ['email-status'],
    queryFn: () => api<EmailStatusDto>('/auth/me/email-status'),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Starts an action email: the API checks who may be emailed and returns the Microsoft consent
 * URL (same flow as DAR Send); the browser goes there and comes back to the item with
 * `?email=sent` or `?email_error=…`. The action itself is already saved.
 */
export async function sendActionEmail(body: ActionEmailInput) {
  const { url } = await api<{ url: string }>('/action-emails', { method: 'POST', body });
  window.location.assign(url);
}

/** True when the email should be sent with the action (flag on, linked, ticked). */
export function useWantsEmail(checked: boolean) {
  const status = useEmailStatus().data;
  return Boolean(status?.enabled && status.linked && checked);
}

/** Joins names like the in-app "Notifies …" line: "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
