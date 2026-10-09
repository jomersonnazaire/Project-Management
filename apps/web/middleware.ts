/**
 * Vercel Routing Middleware: the /api proxy (DEF-002, NFR-26).
 *
 * NFR-26: previews must never reach production data. vercel.json rewrites can't read env vars,
 * so the API origin is picked here from VERCEL_ENV: production → the production API, anything
 * else (preview, development) → STAGING_API_URL. A preview without STAGING_API_URL answers 503
 * instead of falling back to production.
 *
 * Azure would otherwise see Vercel's (rotating) egress address as the client. Here we pass the real visitor IP in `x-xc8-client-ip` together with
 * a shared secret (`EDGE_PROXY_SECRET`, set on both Vercel and Azure). The API trusts the
 * visitor IP only when the secret matches; anything else falls back to the address Azure's
 * front end appended. Any incoming copies of these headers are dropped first, so a browser
 * can't inject them.
 */
import { rewrite } from '@vercel/functions/middleware';

export const config = { matcher: '/api/:path*' };

export const EDGE_CLIENT_IP_HEADER = 'x-xc8-client-ip';
export const EDGE_SECRET_HEADER = 'x-xc8-edge-secret';

/** Request headers to forward: the originals minus spoofable copies, plus the signed client IP. */
export function edgeRequestHeaders(request: Request, secret: string | undefined): Headers {
  const headers = new Headers(request.headers);
  headers.delete(EDGE_CLIENT_IP_HEADER);
  headers.delete(EDGE_SECRET_HEADER);
  // Vercel sets x-real-ip / x-forwarded-for itself and overwrites client-sent values.
  const ip =
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (secret && ip) {
    headers.set(EDGE_CLIENT_IP_HEADER, ip);
    headers.set(EDGE_SECRET_HEADER, secret);
  }
  return headers;
}

function env(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[name] || undefined;
}

export const PRODUCTION_API_URL = 'https://xc8-projectmgmt-api-tc3w.azurewebsites.net';

/** The API origin for this deployment, or null when a non-production one has no staging API. */
export function apiOrigin(vercelEnv: string | undefined, stagingUrl: string | undefined) {
  if (vercelEnv === 'production') return PRODUCTION_API_URL;
  const staging = stagingUrl?.trim().replace(/\/+$/, '');
  return staging ? staging : null;
}

export default function middleware(request: Request): Response {
  const origin = apiOrigin(env('VERCEL_ENV'), env('STAGING_API_URL'));
  if (!origin) {
    return Response.json(
      {
        error: {
          code: 'STAGING_API_NOT_CONFIGURED',
          message: 'This preview has no staging API yet (STAGING_API_URL is not set).',
        },
      },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  return rewrite(new URL(url.pathname + url.search, origin), {
    request: { headers: edgeRequestHeaders(request, env('EDGE_PROXY_SECRET')) },
  });
}
