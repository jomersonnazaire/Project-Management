import type { NextFunction, Request, Response } from 'express';
import { badRequest, forbidden } from '../lib/errors.js';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'xc8-web';

/** Builds an origin matcher from a comma-separated allowlist with optional `*` wildcards. */
export function originMatcher(list: string): (origin: string) => boolean {
  const patterns = list
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((p) => new RegExp('^' + p.split('*').map(escape).join('[a-z0-9-]*') + '$', 'i'));
  return (origin: string) => patterns.some((re) => re.test(origin));
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * CSRF defence for cookie auth (NFR-03, TC-A10): every state-changing request must carry
 * a custom header (which a cross-site form or image can't send, and which CORS only allows
 * for allowlisted origins) and, when the browser sends an Origin, it must be allowlisted.
 */
export function csrfProtection(isAllowedOrigin: (o: string) => boolean) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      return next(forbidden('Request origin is not allowed.', 'CSRF_REJECTED'));
    }
    if (req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      return next(forbidden('Missing CSRF header.', 'CSRF_REJECTED'));
    }
    next();
  };
}

/** Rejects `$`-prefixed or dotted keys anywhere in body/query (NoSQL operator injection, NFR-04). */
export function rejectOperatorKeys(req: Request, _res: Response, next: NextFunction) {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query)) {
    return next(badRequest('Invalid input.', undefined, 'INVALID_INPUT'));
  }
  next();
}

function hasOperatorKey(value: unknown, depth = 0): boolean {
  if (depth > 20) return true;
  if (Array.isArray(value)) return value.some((v) => hasOperatorKey(v, depth + 1));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.') || k.includes('[')) return true;
      if (hasOperatorKey(v, depth + 1)) return true;
    }
  }
  return false;
}
