/**
 * Vercel Routing Middleware for the /api proxy (DEF-002).
 *
 * vercel.json rewrites /api/* to the Azure API, so Azure sees Vercel's (rotating) egress
 * address as the client. Here we pass the real visitor IP in `x-xc8-client-ip` together with
 * a shared secret (`EDGE_PROXY_SECRET`, set on both Vercel and Azure). The API trusts the
 * visitor IP only when the secret matches; anything else falls back to the address Azure's
 * front end appended. Any incoming copies of these headers are dropped first, so a browser
 * can't inject them.
 */
import { next, rewrite } from '@vercel/functions/middleware';

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

/**
 * Preview-only API target (CR-19 staging). When `API_PROXY_ORIGIN` is set as a Vercel
 * Preview env var (scoped to a branch), /api/* goes there instead of the vercel.json
 * destination. Ignored in production and when the value isn't a plain https origin, so
 * production always calls the production API.
 */
export function previewApiOrigin(
  origin: string | undefined,
  vercelEnv: string | undefined,
): string | undefined {
  if (!origin || vercelEnv === 'production') return undefined;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash) return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

export default function middleware(request: Request): Response {
  const headers = edgeRequestHeaders(request, env('EDGE_PROXY_SECRET'));
  const origin = previewApiOrigin(env('API_PROXY_ORIGIN'), env('VERCEL_ENV'));
  if (origin) {
    const url = new URL(request.url);
    return rewrite(new URL(url.pathname + url.search, origin), { request: { headers } });
  }
  return next({ request: { headers } });
}
