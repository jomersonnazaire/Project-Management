/**
 * msIdToken.ts: signing keys come from the tenant's own endpoint (with appid), only for allowed
 * tenants, cached per tenant; refresh on TTL or an unknown kid (rate-limited); a failed refresh
 * keeps the cached keys; no cached keys at all fails closed.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { now as clockNow, resetTestTime, setTestTime } from '../src/lib/clock.js';
import {
  JWKS_TTL_MS,
  KID_REFRESH_MIN_MS,
  msJwksUrl,
  setMicrosoftJwksForTests,
  verifyMicrosoftIdToken,
} from '../src/services/msIdToken.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '99999999-9999-9999-9999-999999999999';
const CLIENT_ID = 'client-id-ms-test';
const config = { MS_CLIENT_ID: CLIENT_ID, msAllowedTenantIds: [TENANT] };
const T0 = new Date('2026-10-22T03:00:00.000Z');

const keyA = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyB = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = (k: { publicKey: KeyObject }, kid: string) => ({
  ...k.publicKey.export({ format: 'jwk' }),
  kid,
  use: 'sig',
});
const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

function token(kid: string, key: KeyObject, over: Record<string, unknown> = {}): string {
  const now = Math.floor(clockNow().getTime() / 1000);
  const payload = {
    aud: CLIENT_ID,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    tid: TENANT,
    oid: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
    email: 'member@xceler8.example',
    iat: now,
    nbf: now,
    exp: now + 3600,
    ...over,
  };
  const input = `${b64url({ alg: 'RS256', typ: 'JWT', kid })}.${b64url(payload)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}
/** Tokens are minted at the test clock so exp stays valid when the clock moves. */
const at = (d: Date) => setTestTime(d);

let keys: object[] = [];
const fetcher = vi.fn(async (_url: string) => ({ keys: keys as never[] }));
const warn = vi.fn();

beforeEach(() => {
  at(T0);
  keys = [jwk(keyA, 'kid-a')];
  fetcher.mockReset();
  fetcher.mockImplementation(async () => ({ keys: keys as never[] }));
  warn.mockClear();
  setMicrosoftJwksForTests({ fetcher, warn });
});
afterEach(() => {
  setMicrosoftJwksForTests();
  resetTestTime();
});

describe('Microsoft ID token signing keys', () => {
  it("uses the tenant's own endpoint with appid (not common)", async () => {
    await expect(
      verifyMicrosoftIdToken(token('kid-a', keyA.privateKey), config),
    ).resolves.toMatchObject({
      tid: TENANT,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys?appid=${CLIENT_ID}`,
    );
    expect(msJwksUrl(TENANT, CLIENT_ID)).not.toMatch(/common/);
  });

  it('a tid that is not allowed is refused before any fetch', async () => {
    const t = token('kid-a', keyA.privateKey, {
      tid: OTHER_TENANT,
      iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0`,
    });
    await expect(verifyMicrosoftIdToken(t, config)).rejects.toThrow(/tenant not allowed/);
    const noTid = token('kid-a', keyA.privateKey, { tid: undefined });
    await expect(verifyMicrosoftIdToken(noTid, config)).rejects.toThrow(/tenant not allowed/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('after verification the tid and issuer must still match', async () => {
    const t = token('kid-a', keyA.privateKey, {
      iss: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0`,
    });
    await expect(verifyMicrosoftIdToken(t, config)).rejects.toThrow(/issuer/);
  });

  it('the cache is reused per tenant until the TTL, then refreshed', async () => {
    for (let i = 0; i < 3; i += 1) {
      await verifyMicrosoftIdToken(token('kid-a', keyA.privateKey), config);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    at(new Date(T0.getTime() + JWKS_TTL_MS - 1000));
    await verifyMicrosoftIdToken(token('kid-a', keyA.privateKey), config);
    expect(fetcher).toHaveBeenCalledTimes(1);
    at(new Date(T0.getTime() + JWKS_TTL_MS));
    await verifyMicrosoftIdToken(token('kid-a', keyA.privateKey), config);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('an unknown kid triggers one refresh (rate-limited to one per 5 minutes)', async () => {
    await verifyMicrosoftIdToken(token('kid-a', keyA.privateKey), config);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Microsoft rolls to kid-b.
    keys = [jwk(keyA, 'kid-a'), jwk(keyB, 'kid-b')];
    at(new Date(T0.getTime() + 60_000));
    await expect(
      verifyMicrosoftIdToken(token('kid-b', keyB.privateKey), config),
    ).resolves.toMatchObject({ tid: TENANT });
    expect(fetcher).toHaveBeenCalledTimes(2);
    // kid-b is now cached: no more fetches.
    await verifyMicrosoftIdToken(token('kid-b', keyB.privateKey), config);
    expect(fetcher).toHaveBeenCalledTimes(2);

    // A kid nobody has: refused; a second one within 5 minutes does not fetch again.
    at(new Date(T0.getTime() + 2 * 60_000));
    await expect(verifyMicrosoftIdToken(token('kid-x', keyB.privateKey), config)).rejects.toThrow(
      /signing key not found/,
    );
    expect(fetcher).toHaveBeenCalledTimes(2); // last kid refresh was 1 minute ago
    at(new Date(T0.getTime() + 60_000 + KID_REFRESH_MIN_MS));
    await expect(verifyMicrosoftIdToken(token('kid-x', keyB.privateKey), config)).rejects.toThrow(
      /signing key not found/,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(verifyMicrosoftIdToken(token('kid-y', keyB.privateKey), config)).rejects.toThrow(
      /signing key not found/,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('a failed or timed-out refresh keeps the cached keys and logs a warning without token data', async () => {
    const t1 = token('kid-a', keyA.privateKey);
    await verifyMicrosoftIdToken(t1, config);
    fetcher.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    // TTL expired and the refresh times out: the cached keys still verify.
    at(new Date(T0.getTime() + JWKS_TTL_MS + 1000));
    const t2 = token('kid-a', keyA.privateKey);
    await expect(verifyMicrosoftIdToken(t2, config)).resolves.toMatchObject({ tid: TENANT });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const [obj, msg] = warn.mock.calls[0]!;
    expect(msg).toMatch(/using cached keys/);
    expect(obj).toMatchObject({ msTid: TENANT, cachedKeys: 1, error: 'TimeoutError' });
    const logged = JSON.stringify(warn.mock.calls);
    for (const part of t2.split('.')) expect(logged).not.toContain(part);
    expect(logged).not.toMatch(/member@xceler8\.example|aaaaaaaa-aaaa/);

    // Unknown kid and the refresh fails: refused (the key isn't there), keys still kept.
    fetcher.mockRejectedValueOnce(new Error('JWKS fetch failed: HTTP 503'));
    at(new Date(T0.getTime() + JWKS_TTL_MS + KID_REFRESH_MIN_MS + 2000));
    await expect(verifyMicrosoftIdToken(token('kid-b', keyB.privateKey), config)).rejects.toThrow(
      /signing key not found/,
    );
    await expect(
      verifyMicrosoftIdToken(token('kid-a', keyA.privateKey), config),
    ).resolves.toMatchObject({ tid: TENANT });
  });

  it('a cold cache with a failed fetch is refused', async () => {
    fetcher.mockRejectedValueOnce(new Error('JWKS fetch failed: HTTP 500'));
    await expect(verifyMicrosoftIdToken(token('kid-a', keyA.privateKey), config)).rejects.toThrow(
      /No Microsoft signing keys/,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatch(/no cached keys/);
    expect(warn.mock.calls[0]![0]).toMatchObject({ msTid: TENANT, cachedKeys: 0 });
    // The next sign-in tries again and works once Microsoft answers.
    await expect(
      verifyMicrosoftIdToken(token('kid-a', keyA.privateKey), config),
    ).resolves.toMatchObject({ tid: TENANT });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('concurrent sign-ins on a cold cache share one fetch', async () => {
    await Promise.all(
      [1, 2, 3].map(() => verifyMicrosoftIdToken(token('kid-a', keyA.privateKey), config)),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
