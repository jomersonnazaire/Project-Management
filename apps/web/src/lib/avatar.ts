/** CR-21 avatars (UI spec v0.9.19 "Avatars"): initials fallback and its stable label colour. */

/**
 * Two letters: the first letter of the first and of the last word, or the first two letters of a
 * single word ("Maria Member" → "MM", "Ana" → "AN"). Text in brackets is ignored ("Ken L. (PM)").
 */
export function avatarInitials(name: string | null | undefined): string {
  const words = (name ?? '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!;
  const second = words.length > 1 ? words[words.length - 1]!.charAt(0) : first.charAt(1);
  return (first.charAt(0) + second).toUpperCase();
}

export const AVATAR_TONES = [
  'primary',
  'success',
  'info',
  'warning',
  'danger',
  'secondary',
] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/** A Sneat label tone picked by a hash of the name, so a name always gets the same colour. */
export function avatarTone(name: string | null | undefined): AvatarTone {
  let h = 0;
  for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/** GET /api/v1/users/:id/avatar (signed in); `version` busts the browser cache after a change. */
export function avatarUrl(userId: string, version?: string | null): string {
  const v = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${API_ORIGIN}/api/v1/users/${encodeURIComponent(userId)}/avatar${v}`;
}
