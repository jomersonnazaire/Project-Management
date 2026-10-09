/** Whole hours until the link expires, as issued by the API (72 for invites, 24 for resets). */
export function hoursUntil(iso: string): number {
  return Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
}
