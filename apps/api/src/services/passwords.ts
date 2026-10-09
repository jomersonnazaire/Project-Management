import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

/**
 * argon2id (the library default) with OWASP-recommended parameters (NFR-01):
 * 19 MiB memory, 2 iterations, 1 lane.
 */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Runs a verification against a throwaway hash so that sign-in attempts for unknown
 * emails take about as long as attempts with a wrong password (TC-A02).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
}
