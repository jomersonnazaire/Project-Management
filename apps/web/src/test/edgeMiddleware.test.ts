import { describe, expect, it } from 'vitest';
import middleware, { config, edgeRequestHeaders } from '../../middleware';

const SECRET = 'edge-secret-for-tests-0123456789abcdef';
const vercelRequest = (extra: Record<string, string> = {}) =>
  new Request('https://preview.example/api/v1/auth/login', {
    method: 'POST',
    // Vercel overwrites x-forwarded-for / x-real-ip with the visitor address.
    headers: { 'x-forwarded-for': '104.28.226.106', 'x-real-ip': '104.28.226.106', ...extra },
  });

describe('Vercel /api middleware (DEF-002)', () => {
  it('only runs on /api', () => {
    expect(config.matcher).toBe('/api/:path*');
  });

  it('adds the visitor IP and the shared secret', () => {
    const h = edgeRequestHeaders(vercelRequest(), SECRET);
    expect(h.get('x-xc8-client-ip')).toBe('104.28.226.106');
    expect(h.get('x-xc8-edge-secret')).toBe(SECRET);
    expect(h.get('x-forwarded-for')).toBe('104.28.226.106');
  });

  it('drops client-sent copies of the trusted headers', () => {
    const forged = vercelRequest({ 'x-xc8-client-ip': '9.9.9.9', 'x-xc8-edge-secret': 'guess' });
    const h = edgeRequestHeaders(forged, SECRET);
    expect(h.get('x-xc8-client-ip')).toBe('104.28.226.106');
    expect(h.get('x-xc8-edge-secret')).toBe(SECRET);
    const noSecret = edgeRequestHeaders(forged, undefined);
    expect(noSecret.has('x-xc8-client-ip')).toBe(false);
    expect(noSecret.has('x-xc8-edge-secret')).toBe(false);
  });

  it('forwards the request with header overrides for the rewrite', () => {
    const res = middleware(vercelRequest());
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-forwarded-for');
  });
});
