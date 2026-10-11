import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import { resolveClientIp, type ClientIpOptions } from '../middleware/clientIp.js';

/** Who made the current request, for the audit trail (FR-AUD-01). */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

const store = new AsyncLocalStorage<RequestContext>();

/** The current request's context; null outside a request (startup jobs, sweeps, scripts). */
export const requestContext = (): RequestContext | null => store.getStore() ?? null;

/** User agents are client-controlled: keep a bounded copy. */
export const MAX_USER_AGENT = 512;

/**
 * Records the client IP (the same trusted resolution the auth rate limiter uses: Vercel edge
 * header with its secret, then the trusted proxy hop, then the socket) and the user agent for
 * everything the request does, so `audit()` can stamp them without each route passing `req`.
 */
export function requestContextMiddleware(opts: ClientIpOptions): RequestHandler {
  return (req, _res, next) => {
    const ua = req.get('user-agent');
    const ip = resolveClientIp(req, opts).ip;
    store.run(
      {
        ip: ip === 'unknown' ? null : ip,
        userAgent: ua ? ua.slice(0, MAX_USER_AGENT) : null,
      },
      next,
    );
  };
}
