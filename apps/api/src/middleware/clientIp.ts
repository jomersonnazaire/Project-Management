import type { Request } from 'express';

/**
 * Resolves the client IP for rate limiting. We don't rely on Express' `trust proxy`
 * because Azure App Service appends `ip:port` entries to X-Forwarded-For.
 * With N trusted proxies, the client is the N-th entry from the right; entries further
 * left can be spoofed by the client and are ignored.
 */
export function clientIp(req: Request, trustedHops: number): string {
  const socketIp = normalise(req.socket.remoteAddress ?? 'unknown');
  if (trustedHops <= 0) return socketIp;
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const candidate = parts[parts.length - trustedHops] ?? parts[0];
  return candidate ? normalise(candidate) : socketIp;
}

function normalise(ip: string): string {
  let v = ip.trim();
  // [v6]:port
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracket?.[1]) v = bracket[1];
  // v4:port
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(':'));
  if (v.startsWith('::ffff:')) v = v.slice(7);
  return v.toLowerCase();
}
