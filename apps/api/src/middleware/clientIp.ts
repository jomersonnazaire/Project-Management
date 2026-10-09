import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

/** Header our Vercel Routing Middleware sets to the visitor IP (apps/web/middleware.ts). */
export const EDGE_CLIENT_IP_HEADER = 'x-xc8-client-ip';
/** Shared secret proving the request really came through our Vercel middleware. */
export const EDGE_SECRET_HEADER = 'x-xc8-edge-secret';

export interface ClientIpOptions {
  /**
   * Number of trusted reverse proxies that APPEND to X-Forwarded-For on the direct path.
   * Azure App Service = 1 (its front end appends the TCP peer as `ip:port`); local = 0.
   */
  trustedHops: number;
  /** When set, `x-xc8-client-ip` is trusted only if `x-xc8-edge-secret` matches this value. */
  edgeSecret?: string;
}

export type ClientIpSource = 'edge' | 'proxy' | 'socket';

export interface ResolvedClientIp {
  ip: string;
  source: ClientIpSource;
}

/**
 * Resolves the client IP for rate limiting (DEF-002). Express' `trust proxy` is not used
 * because Azure's front end appends `ip:port` entries and the right hop count differs
 * between direct and Vercel-proxied traffic.
 *
 * 1. Via Vercel: our edge middleware sends the visitor IP plus a shared secret. Only a
 *    matching secret makes that header trusted (anyone can send headers directly to Azure).
 * 2. Otherwise: the entry the nearest trusted proxy appended, counting from the RIGHT of
 *    X-Forwarded-For. Entries further left are client-controlled and ignored.
 * 3. Otherwise: the socket address.
 */
export function resolveClientIp(req: Request, opts: ClientIpOptions): ResolvedClientIp {
  if (opts.edgeSecret) {
    const secret = header(req, EDGE_SECRET_HEADER);
    const edgeIp = normaliseIp(header(req, EDGE_CLIENT_IP_HEADER).split(',')[0] ?? '');
    if (secret && safeEqual(secret, opts.edgeSecret) && edgeIp) {
      return { ip: edgeIp, source: 'edge' };
    }
  }
  if (opts.trustedHops > 0) {
    const parts = header(req, 'x-forwarded-for')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const appended = parts[parts.length - opts.trustedHops];
    const ip = appended ? normaliseIp(appended) : null;
    if (ip) return { ip, source: 'proxy' };
  }
  return { ip: normaliseIp(req.socket.remoteAddress ?? '') ?? 'unknown', source: 'socket' };
}

/** Back-compat helper used by tests and logs. */
export function clientIp(req: Request, opts: ClientIpOptions): string {
  return resolveClientIp(req, opts).ip;
}

/**
 * Rate-limit key for an IP. IPv4 is grouped by network prefix (default /24) and IPv6 by /56,
 * because egress pools (carrier NAT, Cloudflare WARP / iCloud Private Relay style tunnels)
 * hand one client a different address from the same block on every connection.
 */
export function rateLimitKey(ip: string, ipv4Prefix = 24, ipv6Prefix = 56): string {
  if (isIP(ip) === 4) {
    const n = ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
    const mask = ipv4Prefix === 0 ? 0 : (0xffffffff << (32 - ipv4Prefix)) >>> 0;
    const net = (n & mask) >>> 0;
    const dotted = [24, 16, 8, 0].map((s) => (net >>> s) & 255).join('.');
    return ipv4Prefix === 32 ? dotted : `${dotted}/${ipv4Prefix}`;
  }
  if (isIP(ip) === 6) return ipKeyGenerator(ip, ipv6Prefix);
  return ip;
}

/** Strips ports (`1.2.3.4:5678`, `[::1]:443`), IPv4-mapped prefixes and zone ids; null if not an IP. */
export function normaliseIp(raw: string): string | null {
  let v = raw.trim().replace(/^"|"$/g, '');
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracket?.[1]) v = bracket[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(':'));
  v = v.replace(/%.*$/, '').toLowerCase();
  if (v.startsWith('::ffff:') && isIP(v.slice(7)) === 4) v = v.slice(7);
  return isIP(v) ? v : null;
}

function header(req: Request, name: string): string {
  const h = req.headers[name];
  return (Array.isArray(h) ? h.join(',') : (h ?? '')).trim();
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
