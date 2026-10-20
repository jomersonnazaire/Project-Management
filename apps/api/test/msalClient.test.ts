import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createMsalClient } from '../src/services/microsoftAuth.js';

/**
 * No token storage (DAR Send, action emails): the MSAL client is created per request and has no
 * shared token cache, so a refresh token from one exchange can never be reused by another.
 */
describe('MSAL client per request (no shared token cache)', () => {
  const config = loadConfig({
    MONGODB_URI: 'mongodb://x',
    MS_TENANT_ID: '11111111-1111-1111-1111-111111111111',
    MS_CLIENT_ID: 'client-id-ms-test',
    MS_CLIENT_SECRET: 'ms-test-client-secret-32chars-minimum!!',
    MS_REDIRECT_URI: 'http://localhost:5173/api/auth/microsoft/callback',
  });

  it('every call builds a new client with its own empty cache and no cache plugin', async () => {
    const a = createMsalClient(config);
    const b = createMsalClient(config);
    expect(a).not.toBe(b);
    expect(a.getTokenCache()).not.toBe(b.getTokenCache());
    for (const client of [a, b]) {
      expect(await client.getTokenCache().getAllAccounts()).toEqual([]);
      const cache = JSON.parse(client.getTokenCache().serialize()) as Record<string, object>;
      expect(Object.keys(cache.RefreshToken ?? {})).toHaveLength(0);
      expect(Object.keys(cache.AccessToken ?? {})).toHaveLength(0);
      const cfg = (client as unknown as { config: { cache?: { cachePlugin?: unknown } } }).config;
      expect(cfg.cache?.cachePlugin).toBeUndefined();
    }
  });
});
