import { createHash } from 'node:crypto';

export const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
export const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

export const PENDING_TTL_MS = 10 * 60_000;
export const CODE_TTL_MS = 60_000;

export const APP_REDIRECT = 'opstrack://auth/microsoft';

export function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function appRedirect(params: Record<string, string>): string {
  const q = new URLSearchParams(params);
  return `${APP_REDIRECT}?${q.toString()}`;
}
