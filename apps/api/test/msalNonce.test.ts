/**
 * Runs the REAL msal-node token exchange (acquireTokenByCode), so MSAL's own ID-token nonce
 * check runs. Only the network is faked: MSAL's system.networkClient is swapped for an in-memory
 * client that serves the authority metadata and the token endpoint response with a test ID token
 * signed (RS256) by a test key. MSAL doesn't verify signatures on the confidential-client code
 * flow, so our own check (msIdToken.ts: signature, issuer, audience) runs on top and is tested
 * here too, with signing keys served by a test JWKS fetcher.
 *
 * Regression for the production failure on 2026-10-20: msal-node 6 rejects an ID token that
 * carries a nonce when the request doesn't pass the expected nonce (ClientAuthError
 * nonce_mismatch), so every Microsoft sign-in ended at /login?error=ms_signin_failed.
 */
import type * as Msal from '@azure/msal-node';
import type { INetworkModule, NetworkResponse } from '@azure/msal-node';
import { generateKeyPairSync, sign } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';

const TENANT = '22222222-2222-2222-2222-222222222222';
const CLIENT_ID = 'client-id-msal-nonce-test';
const OID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const HOST = 'https://login.microsoftonline.com';

const config = {
  MS_TENANT_ID: TENANT,
  MS_CLIENT_ID: CLIENT_ID,
  MS_CLIENT_SECRET: 'msal-nonce-test-client-secret-not-real',
  MS_REDIRECT_URI: 'http://localhost:5173/api/auth/microsoft/callback',
  msAllowedTenantIds: [TENANT],
} as AppConfig;

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

const KID = 'test-signing-key-1';
const signingKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
let tokenMode: 'signed' | 'unsigned' | 'wrong-key' = 'signed';

/** Test ID token, RS256-signed by the test key (or unsigned / signed by another key). */
function idToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: CLIENT_ID,
    iss: `${HOST}/${TENANT}/v2.0`,
    iat: now,
    nbf: now,
    exp: now + 3600,
    sub: 'test-subject',
    oid: OID,
    tid: TENANT,
    ver: '2.0',
    ...claims,
  };
  if (tokenMode === 'unsigned') return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
  const input = `${b64url({ alg: 'RS256', typ: 'JWT', kid: KID })}.${b64url(payload)}`;
  const key = tokenMode === 'wrong-key' ? otherKeys.privateKey : signingKeys.privateKey;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

type Fake = {
  network: INetworkModule;
  tokenRequests: URLSearchParams[];
  setIdTokenClaims: (claims: Record<string, unknown>) => void;
};

function fakeNetwork(): Fake {
  let claims: Record<string, unknown> = {};
  const tokenRequests: URLSearchParams[] = [];
  const ok = <T>(body: unknown): NetworkResponse<T> => ({
    headers: {},
    body: body as T,
    status: 200,
  });
  const network: INetworkModule = {
    async sendGetRequestAsync<T>(url: string): Promise<NetworkResponse<T>> {
      if (url.includes('/discovery/instance')) {
        return ok<T>({
          tenant_discovery_endpoint: `${HOST}/${TENANT}/v2.0/.well-known/openid-configuration`,
          'api-version': '1.1',
          metadata: [
            {
              preferred_network: 'login.microsoftonline.com',
              preferred_cache: 'login.windows.net',
              aliases: ['login.microsoftonline.com', 'login.windows.net', 'login.microsoft.com'],
            },
          ],
        });
      }
      if (url.includes('openid-configuration')) {
        return ok<T>({
          token_endpoint: `${HOST}/${TENANT}/oauth2/v2.0/token`,
          authorization_endpoint: `${HOST}/${TENANT}/oauth2/v2.0/authorize`,
          end_session_endpoint: `${HOST}/${TENANT}/oauth2/v2.0/logout`,
          issuer: `${HOST}/${TENANT}/v2.0`,
          jwks_uri: `${HOST}/${TENANT}/discovery/v2.0/keys`,
        });
      }
      throw new Error(`Unexpected GET in MSAL test: ${url}`);
    },
    async sendPostRequestAsync<T>(
      url: string,
      options?: { body?: string },
    ): Promise<NetworkResponse<T>> {
      if (!url.includes('/oauth2/v2.0/token')) {
        throw new Error(`Unexpected POST in MSAL test: ${url}`);
      }
      const form = new URLSearchParams(options?.body ?? '');
      tokenRequests.push(form);
      return ok<T>({
        token_type: 'Bearer',
        scope: form.get('scope') ?? '',
        expires_in: 3600,
        ext_expires_in: 3600,
        access_token: 'test-access-token',
        id_token: idToken(claims),
        client_info: b64url({ uid: OID, utid: TENANT }),
      });
    },
  };
  return {
    network,
    tokenRequests,
    setIdTokenClaims: (c) => {
      claims = c;
    },
  };
}

let current: Fake = fakeNetwork();

// Keep the real msal-node; only inject the fake network client into every client it builds.
vi.mock('@azure/msal-node', async (importOriginal) => {
  const actual = await importOriginal<typeof Msal>();
  class ConfidentialClientApplication extends actual.ConfidentialClientApplication {
    constructor(cfg: ConstructorParameters<typeof actual.ConfidentialClientApplication>[0]) {
      super({ ...cfg, system: { ...cfg.system, networkClient: current.network } });
    }
  }
  return { ...actual, ConfidentialClientApplication };
});

const { buildMicrosoftLoginUrl, exchangeMicrosoftCode, exchangeMicrosoftMailCode } =
  await import('../src/services/microsoftAuth.js');
const { setMicrosoftJwksForTests, msJwksUrl } = await import('../src/services/msIdToken.js');

const jwksRequests: string[] = [];
beforeAll(() => {
  setMicrosoftJwksForTests({
    fetcher: async (url) => {
      jwksRequests.push(url);
      const jwk = signingKeys.publicKey.export({ format: 'jwk' });
      return { keys: [{ ...jwk, kid: KID, use: 'sig' }] };
    },
  });
});
afterAll(() => setMicrosoftJwksForTests());

afterEach(() => {
  current = fakeNetwork();
  tokenMode = 'signed';
});

describe('real MSAL token exchange keeps the auth-URL nonce', () => {
  it('sign-in: the nonce sent in the auth URL is accepted by MSAL and returned', async () => {
    const login = await buildMicrosoftLoginUrl(config);
    const urlNonce = new URL(login.url).searchParams.get('nonce');
    expect(urlNonce).toBe(login.nonce);

    current.setIdTokenClaims({
      nonce: urlNonce,
      email: 'jonathan@xceler8.example',
      name: 'Jonathan Test',
      acct: 0,
    });
    const claims = await exchangeMicrosoftCode(
      config,
      'auth-code-1',
      login.codeVerifier,
      login.nonce,
    );
    expect(claims).toMatchObject({
      oid: OID,
      tid: TENANT,
      email: 'jonathan@xceler8.example',
      acct: 0,
      nonce: login.nonce,
    });
    expect(current.tokenRequests).toHaveLength(1);
    expect(current.tokenRequests[0]!.get('code')).toBe('auth-code-1');
    expect(current.tokenRequests[0]!.get('code_verifier')).toBe(login.codeVerifier);
  });

  it('sign-in: an ID token with a different nonce is still refused', async () => {
    current.setIdTokenClaims({ nonce: 'someone-elses-nonce', email: 'a@xceler8.example', acct: 0 });
    await expect(
      exchangeMicrosoftCode(config, 'auth-code-2', 'v'.repeat(43), 'expected-nonce'),
    ).rejects.toThrow(/nonce/i);
  });

  it('DAR mail: the Mail.Send exchange accepts the auth-URL nonce', async () => {
    const login = await buildMicrosoftLoginUrl(config, { scopes: ['Mail.Send'] });
    expect(new URL(login.url).searchParams.get('nonce')).toBe(login.nonce);

    current.setIdTokenClaims({ nonce: login.nonce, acct: 0 });
    const token = await exchangeMicrosoftMailCode(
      config,
      'auth-code-3',
      login.codeVerifier,
      login.nonce,
    );
    expect(token).toMatchObject({
      oid: OID,
      tid: TENANT,
      acct: 0,
      accessToken: 'test-access-token',
    });
    expect(current.tokenRequests).toHaveLength(1);
  });

  it('DAR mail: an ID token with a different nonce is still refused', async () => {
    current.setIdTokenClaims({ nonce: 'someone-elses-nonce', acct: 0 });
    await expect(
      exchangeMicrosoftMailCode(config, 'auth-code-4', 'v'.repeat(43), 'expected-nonce'),
    ).rejects.toThrow(/nonce/i);
  });
});

describe('sign-in ID token is verified (signature, issuer, audience) before any claim is used', () => {
  const run = (claims: Record<string, unknown>) => {
    current.setIdTokenClaims({
      nonce: 'n-1',
      email: 'jonathan@xceler8.example',
      acct: 0,
      ...claims,
    });
    return exchangeMicrosoftCode(config, 'auth-code-v', 'v'.repeat(43), 'n-1');
  };

  it('a valid signed token passes; keys come from the Microsoft JWKS endpoint', async () => {
    await expect(run({})).resolves.toMatchObject({ tid: TENANT, oid: OID });
    expect(jwksRequests.at(-1)).toBe(msJwksUrl(TENANT, CLIENT_ID));
  });

  it('an unsigned (alg none) token is refused', async () => {
    tokenMode = 'unsigned';
    await expect(run({})).rejects.toThrow(/not signed|algorithm/i);
  });

  it('a token signed by another key is refused', async () => {
    tokenMode = 'wrong-key';
    await expect(run({})).rejects.toThrow(/signature/i);
  });

  it('another audience is refused', async () => {
    await expect(run({ aud: 'someone-elses-client-id' })).rejects.toThrow(/audience/i);
  });

  it('an issuer that does not match the token tid is refused', async () => {
    await expect(run({ iss: `${HOST}/99999999-9999-9999-9999-999999999999/v2.0` })).rejects.toThrow(
      /issuer/i,
    );
  });

  it('an expired token is refused', async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    await expect(run({ iat: past - 3600, nbf: past - 3600, exp: past })).rejects.toThrow(
      /expired/i,
    );
  });

  it('xms_edov keeps three states from the verified token: true, false, missing', async () => {
    expect((await run({ xms_edov: true })).xms_edov).toBe(true);
    expect((await run({ xms_edov: false })).xms_edov).toBe(false);
    expect((await run({})).xms_edov).toBeUndefined();
  });
});
