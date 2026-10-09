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
import { next } from '@vercel/functions/middleware';

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

export default function middleware(request: Request): Response {
  return next({ request: { headers: edgeRequestHeaders(request, env('EDGE_PROXY_SECRET')) } });
}
