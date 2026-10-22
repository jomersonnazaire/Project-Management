import { createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import type { Logger } from 'pino';
import type { AppConfig } from '../config.js';
import { now as clockNow } from '../lib/clock.js';
import { createLogger } from '../logger.js';

/**
 * Verifies a Microsoft identity platform v2.0 ID token ourselves: RS256 signature against the
 * tenant's signing keys, issuer (https://login.microsoftonline.com/{tid}/v2.0 with the token's
 * own tid), audience (our client id), and exp/nbf. MSAL-node does not check the signature on the
 * code flow, and sign-in decisions (tenant allow-list, the xms_edov fallback) must only use claims
 * from a token that passed these checks.
 *
 * Keys come from the tenant's own endpoint with `appid`, so app-specific keys (a claims-mapping
 * policy) are covered: https://login.microsoftonline.com/{tid}/discovery/v2.0/keys?appid={client}.
 * Only tenants in MS_ALLOWED_TENANT_IDS are ever fetched; another tid is refused before any
 * network call. Keys are cached per tenant in memory: refreshed after JWKS_TTL_MS, or once when a
 * kid is unknown (at most once per KID_REFRESH_MIN_MS per tenant). A failed or timed-out refresh
 * keeps the cached keys (a warning is logged, never token data); with no cached keys it fails.
 */

const CLOCK_SKEW_S = 300;
export const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
export const KID_REFRESH_MIN_MS = 5 * 60 * 1000;
const JWKS_TIMEOUT_MS = 10_000;

export const msJwksUrl = (tid: string, clientId: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tid)}/discovery/v2.0/keys?appid=${encodeURIComponent(clientId)}`;

type Jwk = JsonWebKey & { kid?: string; kty?: string; use?: string };
type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;
type Warn = (obj: Record<string, unknown>, msg: string) => void;

const defaultFetcher: JwksFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new Error('JWKS response has no keys');
  return { keys: body.keys as Jwk[] };
};

let logger: Logger | null = null;
const defaultWarn: Warn = (obj, msg) => {
  logger ??= createLogger(process.env.LOG_LEVEL ?? 'info');
  logger.warn(obj, msg);
};

let fetcher: JwksFetcher = defaultFetcher;
let warn: Warn = defaultWarn;

type Entry = { keys: Jwk[]; fetchedAt: number; lastKidRefreshAt: number };
const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry | null>>();

/** Tests only: serve signing keys without the network, capture warnings, clear the cache. */
export function setMicrosoftJwksForTests(
  opts: { fetcher?: JwksFetcher | null; warn?: Warn | null } = {},
): void {
  fetcher = opts.fetcher ?? defaultFetcher;
  warn = opts.warn ?? defaultWarn;
  cache.clear();
  inFlight.clear();
}

/** Refetches a tenant's keys; on failure keeps what is cached (null when nothing is). */
function refresh(tid: string, clientId: string, nowMs: number): Promise<Entry | null> {
  const running = inFlight.get(tid);
  if (running) return running;
  const p = (async () => {
    const prev = cache.get(tid);
    try {
      const { keys } = await fetcher(msJwksUrl(tid, clientId));
      const entry: Entry = {
        keys: keys.filter((k) => k && typeof k.kid === 'string'),
        fetchedAt: nowMs,
        lastKidRefreshAt: prev?.lastKidRefreshAt ?? 0,
      };
      cache.set(tid, entry);
      return entry;
    } catch (err) {
      warn(
        {
          msTid: tid,
          cachedKeys: prev?.keys.length ?? 0,
          error: err instanceof Error ? err.name : 'Error',
          detail: err instanceof Error ? err.message.slice(0, 200) : undefined,
        },
        prev
          ? 'Microsoft signing keys refresh failed; using cached keys'
          : 'Microsoft signing keys fetch failed; no cached keys',
      );
      return prev ?? null;
    } finally {
      inFlight.delete(tid);
    }
  })();
  inFlight.set(tid, p);
  return p;
}

async function signingKey(tid: string, kid: string, clientId: string): Promise<Jwk> {
  const nowMs = clockNow().getTime();
  let entry = cache.get(tid) ?? null;
  let fetchedNow = false;
  if (!entry || nowMs - entry.fetchedAt >= JWKS_TTL_MS) {
    entry = await refresh(tid, clientId, nowMs);
    fetchedNow = entry !== null && entry.fetchedAt === nowMs;
  }
  if (!entry) throw new Error('No Microsoft signing keys available');
  let key = entry.keys.find((k) => k.kid === kid);
  if (!key && !fetchedNow && nowMs - entry.lastKidRefreshAt >= KID_REFRESH_MIN_MS) {
    // Unknown kid: Microsoft may have rolled its keys. Refresh once, rate-limited per tenant.
    entry.lastKidRefreshAt = nowMs;
    const fresh = await refresh(tid, clientId, nowMs);
    if (fresh) fresh.lastKidRefreshAt = nowMs;
    key = fresh?.keys.find((k) => k.kid === kid);
  }
  if (!key || key.kty !== 'RSA') throw new Error('ID token signing key not found');
  return key;
}

function decodePart(part: string | undefined): Record<string, unknown> {
  if (!part) throw new Error('Malformed ID token');
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed ID token');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Malformed ID token');
  return v as Record<string, unknown>;
}

export async function verifyMicrosoftIdToken(
  raw: string,
  config: Pick<AppConfig, 'MS_CLIENT_ID' | 'msAllowedTenantIds'>,
): Promise<Record<string, unknown>> {
  const parts = raw.split('.');
  if (parts.length !== 3 || !parts[2]) throw new Error('ID token is not signed');
  const header = decodePart(parts[0]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('ID token algorithm not allowed');
  }
  // The unverified tid only picks which allowed tenant's keys to use; anything else is refused
  // here, before any network call.
  const unverifiedTid = decodePart(parts[1]).tid;
  if (
    typeof unverifiedTid !== 'string' ||
    !config.msAllowedTenantIds.includes(unverifiedTid.toLowerCase())
  ) {
    throw new Error('ID token tenant not allowed');
  }
  const keyTid = unverifiedTid.toLowerCase();
  const jwk = await signingKey(keyTid, header.kid, config.MS_CLIENT_ID);
  const ok = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  );
  if (!ok) throw new Error('ID token signature invalid');

  const claims = decodePart(parts[1]);
  const tid = claims.tid;
  if (typeof tid !== 'string' || tid.toLowerCase() !== keyTid) throw new Error('Missing tid');
  if (claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) {
    throw new Error('ID token issuer invalid');
  }
  if (claims.aud !== config.MS_CLIENT_ID) throw new Error('ID token audience invalid');
  const nowS = Math.floor(clockNow().getTime() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) {
    throw new Error('ID token expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > nowS) {
    throw new Error('ID token not yet valid');
  }
  return claims;
}
