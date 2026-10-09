import { afterEach, describe, expect, it, vi } from 'vitest';
import middleware, {
  PRODUCTION_API_URL,
  apiOrigin,
  config,
  edgeRequestHeaders,
} from '../../middleware';

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
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('EDGE_PROXY_SECRET', SECRET);
    const res = middleware(vercelRequest());
    expect(res.headers.get('x-middleware-rewrite')).toBe(`${PRODUCTION_API_URL}/api/v1/auth/login`);
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-xc8-edge-secret');
    expect(res.headers.get('x-middleware-request-x-xc8-edge-secret')).toBe(SECRET);
  });
});

describe('Staging vs production API (NFR-26)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('production goes to the production API; previews only ever to STAGING_API_URL', () => {
    expect(apiOrigin('production', 'https://staging.example')).toBe(PRODUCTION_API_URL);
    expect(apiOrigin('preview', 'https://staging.example/')).toBe('https://staging.example');
    expect(apiOrigin('development', 'https://staging.example')).toBe('https://staging.example');
    expect(apiOrigin('preview', undefined)).toBeNull();
    expect(apiOrigin('preview', '  ')).toBeNull();
  });

  it('a preview rewrites to staging with the edge secret and keeps the query string', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('STAGING_API_URL', 'https://xc8-staging.example');
    vi.stubEnv('EDGE_PROXY_SECRET', SECRET);
    const res = middleware(
      new Request('https://preview.example/api/v1/issues?status=OPEN', {
        headers: { 'x-real-ip': '104.28.226.106' },
      }),
    );
    expect(res.headers.get('x-middleware-rewrite')).toBe(
      'https://xc8-staging.example/api/v1/issues?status=OPEN',
    );
    expect(res.headers.get('x-middleware-request-x-xc8-edge-secret')).toBe(SECRET);
    expect(res.headers.get('x-middleware-request-x-xc8-client-ip')).toBe('104.28.226.106');
  });

  it('a preview without STAGING_API_URL answers 503 and never reaches production', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('STAGING_API_URL', '');
    const res = middleware(vercelRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect((await res.json()).error.code).toBe('STAGING_API_NOT_CONFIGURED');
  });
});
