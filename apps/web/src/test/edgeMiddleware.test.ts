import { describe, expect, it } from 'vitest';
import middleware, { config, edgeRequestHeaders, previewApiOrigin } from '../../middleware';

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

  it('uses API_PROXY_ORIGIN only on previews, and only a plain https origin', () => {
    const o = 'https://ops-track-staging.azurewebsites.net';
    expect(previewApiOrigin(o, 'preview')).toBe(o);
    expect(previewApiOrigin(o + '/', 'preview')).toBe(o);
    expect(previewApiOrigin(o, 'production')).toBeUndefined();
    expect(previewApiOrigin(undefined, 'preview')).toBeUndefined();
    expect(previewApiOrigin('http://ops-track-staging.azurewebsites.net', 'preview')).toBeUndefined();
    expect(previewApiOrigin(o + '/x', 'preview')).toBeUndefined();
    expect(previewApiOrigin('not a url', 'preview')).toBeUndefined();
  });

  it('rewrites /api to the preview origin when set', () => {
    const g = globalThis as { process: { env: Record<string, string | undefined> } };
    const saved = { ...g.process.env };
    g.process.env.API_PROXY_ORIGIN = 'https://ops-track-staging.azurewebsites.net';
    g.process.env.VERCEL_ENV = 'preview';
    try {
      const res = middleware(
        new Request('https://preview.example/api/v1/clients/import/template?x=1', {
          headers: { 'x-real-ip': '1.2.3.4' },
        }),
      );
      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://ops-track-staging.azurewebsites.net/api/v1/clients/import/template?x=1',
      );
      g.process.env.VERCEL_ENV = 'production';
      expect(middleware(vercelRequest()).headers.get('x-middleware-next')).toBe('1');
    } finally {
      g.process.env = saved;
    }
  });
});
