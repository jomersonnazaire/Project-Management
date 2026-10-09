import type { ApiErrorBody } from '@xc8/shared';

const BASE = `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')}/api/v1`;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  /** Field errors from a 400 VALIDATION_ERROR, keyed by field path. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as { path?: string; message?: string }[])
        .filter((d) => d.path)
        .map((d) => [d.path as string, d.message ?? 'Invalid value.']),
    );
  }
}

/** Shown when the API's per-IP sign-in limiter answers 429 (NFR-05). */
export const RATE_LIMITED_MESSAGE =
  'Too many sign-in attempts. Please wait 15 minutes and try again.';

/** User-facing message for errors on the sign-in and set-password screens. */
export function authErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.status === 429 ? RATE_LIMITED_MESSAGE : e.message;
  return 'Something went wrong. Please try again.';
}

type Listener = (err: ApiError) => void;
const unauthorizedListeners = new Set<Listener>();

/** Lets the auth layer react when any request finds the session gone (AC-01.5). */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Don't broadcast 401s (used by the initial /auth/me probe and the sign-in form). */
  quiet401?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    // Custom header required by the API's CSRF check (NFR-03).
    headers['X-Requested-With'] = 'xc8-web';
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      "Can't reach the server. Check your connection and try again.",
    );
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    const apiError = new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Request failed (${res.status}).`,
      err?.details,
    );
    if (res.status === 401 && !opts.quiet401) unauthorizedListeners.forEach((l) => l(apiError));
    throw apiError;
  }
  return data as T;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
