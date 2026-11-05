import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ImportPlan, PlannedClient, PlannedContact } from './plan.js';

/**
 * CR-19 FR-CLI-35b (Q-116, Locked): the signed preview token.
 *
 * The preview returns `base64url(payload).base64url(HMAC-SHA256(key, payload))`, where the payload
 * is `{ v, uid, iat, h }`: the previewing user, the issue time (ms) and `h`, a SHA-256 over a
 * canonical form of the result (the file's SHA-256 and, per row, its tag, reasons, warnings, the
 * matched record's id + updatedAt + version, and the field changes). Nothing is stored on the
 * server (NFR-37). At commit the server recomputes `h` from the same file and the current data;
 * any mismatch, another user, a token older than 15 minutes or a bad signature is 409
 * PREVIEW_STALE.
 */

export const PREVIEW_TOKEN_TTL_MS = 15 * 60_000;
const VERSION = 1;

/** Injectable clock, so tests can move time forward (AC-62.22). */
export const previewTokenClock = { now: (): number => Date.now() };

interface Payload {
  v: number;
  uid: string;
  iat: number;
  h: string;
}

/** JSON with sorted object keys, so the hash never depends on property order. */
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof (value as { toHexString?: unknown }).toHexString === 'function')
    return JSON.stringify(String(value));
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

type Versioned = { _id: unknown; updatedAt?: Date | null; __v?: number | null };
const matched = (rec: Versioned | undefined) =>
  rec ? { id: String(rec._id), updatedAt: rec.updatedAt ?? null, version: rec.__v ?? null } : null;

/**
 * SHA-256 of the canonical result. New-record ids are random per run, so they're left out; a
 * contact linked to a new client from the same file names that client's row instead.
 */
export function resultHash(fileSha256: string, plan: ImportPlan): string {
  const newClientRow = new Map(
    plan.clients.filter((c) => c.newId).map((c) => [c.newId!.toString(), c.row]),
  );
  const common = (p: PlannedClient | PlannedContact) => ({
    row: p.row,
    result: p.result,
    reasons: p.reasons,
    warnings: p.warnings,
    inactive: Boolean(p.inactive),
    matched: matched(p.existing as Versioned | undefined),
    changes: p.changes,
  });
  const body = {
    file: fileSha256,
    clients: plan.clients.map((c) => ({ ...common(c), activeChange: c.activeChange ?? null })),
    contacts: plan.contacts.map((c) => {
      const id = c.clientId?.toString();
      const client = !id
        ? null
        : newClientRow.has(id)
          ? { newClientRow: newClientRow.get(id) }
          : { id };
      return { ...common(c), client };
    }),
  };
  return createHash('sha256').update(canonical(body)).digest('hex');
}

const sign = (key: string, data: string) =>
  createHmac('sha256', key).update(data).digest('base64url');

export function issuePreviewToken(key: string, userId: string, hash: string): string {
  const payload: Payload = { v: VERSION, uid: userId, iat: previewTokenClock.now(), h: hash };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(key, data)}`;
}

export type TokenCheck = { ok: true; hash: string } | { ok: false; why: string };

/**
 * Signature (constant-time), version, user and age. The hash comparison happens at commit, once
 * the result has been recomputed. `why` is for server logs only; the client always gets the same
 * PREVIEW_STALE answer, which never says whose token it was (AC-62.21).
 */
export function verifyPreviewToken(
  key: string,
  token: string | undefined,
  userId: string,
): TokenCheck {
  if (!token || token.length > 2048) return { ok: false, why: 'missing' };
  const [data, mac, extra] = token.split('.');
  if (!data || !mac || extra !== undefined) return { ok: false, why: 'malformed' };
  const expected = Buffer.from(sign(key, data));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, why: 'signature' };
  let p: Partial<Payload>;
  try {
    p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Partial<Payload>;
  } catch {
    return { ok: false, why: 'malformed' };
  }
  if (
    p.v !== VERSION ||
    typeof p.uid !== 'string' ||
    typeof p.iat !== 'number' ||
    typeof p.h !== 'string'
  )
    return { ok: false, why: 'malformed' };
  if (p.uid !== userId) return { ok: false, why: 'user' };
  const age = previewTokenClock.now() - p.iat;
  if (age > PREVIEW_TOKEN_TTL_MS || age < -60_000) return { ok: false, why: 'expired' };
  return { ok: true, hash: p.h };
}

/** Constant-time compare of two hex hashes. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
