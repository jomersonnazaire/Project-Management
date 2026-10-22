import { createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { now as clockNow } from '../lib/clock.js';

/**
 * Verifies a Microsoft identity platform v2.0 ID token ourselves: RS256 signature against
 * Microsoft's published signing keys, issuer (https://login.microsoftonline.com/{tid}/v2.0 with
 * the token's own tid), audience (our client id), and exp/nbf. MSAL-node does not check the
 * signature on the code flow, and sign-in decisions (tenant allow-list, the xms_edov fallback)
 * must only use claims from a token that passed these checks.
 */

export const MS_JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';
const CLOCK_SKEW_S = 300;
const JWKS_TTL_MS = 60 * 60 * 1000;

type Jwk = JsonWebKey & { kid?: string; kty?: string; use?: string };
type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

const defaultFetcher: JwksFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  return (await res.json()) as { keys: Jwk[] };
};

let fetcher: JwksFetcher = defaultFetcher;
let cache: { at: number; keys: Jwk[] } | null = null;

/** Tests only: serve signing keys without the network (null restores the real fetch). */
export function setMicrosoftJwksFetcherForTests(f: JwksFetcher | null): void {
  fetcher = f ?? defaultFetcher;
  cache = null;
}

async function signingKey(kid: string): Promise<Jwk> {
  const fresh = cache && Date.now() - cache.at < JWKS_TTL_MS;
  let key = fresh ? cache!.keys.find((k) => k.kid === kid) : undefined;
  if (!key) {
    // Unknown kid: Microsoft may have rolled its keys, so refetch once.
    const { keys } = await fetcher(MS_JWKS_URL);
    cache = { at: Date.now(), keys: Array.isArray(keys) ? keys : [] };
    key = cache.keys.find((k) => k.kid === kid);
  }
  if (!key || key.kty !== 'RSA') throw new Error('ID token signing key not found');
  return key;
}

function decodePart(part: string | undefined): Record<string, unknown> {
  if (!part) throw new Error('Malformed ID token');
  const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Malformed ID token');
  return v as Record<string, unknown>;
}

export async function verifyMicrosoftIdToken(
  raw: string,
  config: Pick<AppConfig, 'MS_CLIENT_ID'>,
): Promise<Record<string, unknown>> {
  const parts = raw.split('.');
  if (parts.length !== 3 || !parts[2]) throw new Error('ID token is not signed');
  const header = decodePart(parts[0]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('ID token algorithm not allowed');
  }
  const jwk = await signingKey(header.kid);
  const ok = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  );
  if (!ok) throw new Error('ID token signature invalid');

  const claims = decodePart(parts[1]);
  const tid = claims.tid;
  if (typeof tid !== 'string' || !tid) throw new Error('Missing tid');
  if (claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) {
    throw new Error('ID token issuer invalid');
  }
  const aud = claims.aud;
  if (aud !== config.MS_CLIENT_ID) throw new Error('ID token audience invalid');
  const nowS = Math.floor(clockNow().getTime() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) {
    throw new Error('ID token expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > nowS) {
    throw new Error('ID token not yet valid');
  }
  return claims;
}
