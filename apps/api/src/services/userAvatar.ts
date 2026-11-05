import sharp from 'sharp';
import { now as clockNow } from '../lib/clock.js';
import { UserModel } from '../models/index.js';
import type { BlobStore } from '../storage/blobStore.js';

/** CR-21: Microsoft profile photos live next to documents in the existing blob store. */
export const AVATAR_BLOB_PREFIX = 'avatars/';
export const AVATAR_SIZE = 96;
const GRAPH_PHOTO = 'https://graph.microsoft.com/v1.0/me/photo/$value';
const MAX_STORE_BYTES = 100_000;

export type AvatarLog = { warn: (obj: object, msg: string) => void };

export function avatarBlobKey(userId: string): string {
  return `${AVATAR_BLOB_PREFIX}${userId}`;
}

/** Square 96×96 JPEG (cover crop). FR-USR-07. */
export async function resizeAvatar(input: Buffer): Promise<Buffer> {
  const out = await sharp(input)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  if (out.length > MAX_STORE_BYTES) {
    return sharp(out).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
  }
  return out;
}

async function clearStoredAvatar(userId: string, blobStore: BlobStore): Promise<void> {
  await blobStore.remove(avatarBlobKey(userId));
  await UserModel.updateOne({ _id: userId }, { $set: { avatarUpdatedAt: null } });
}

/**
 * Refresh the stored Microsoft profile photo from this sign-in's access token (FR-SSO-12).
 * Never throws to the caller (FR-USR-12); never logs or keeps the token (NFR-48).
 * Graph 404 / empty body clears a previous photo (A-46); any other error keeps it.
 */
export async function refreshUserAvatar(
  userId: string,
  accessToken: string,
  blobStore: BlobStore | null,
  log?: AvatarLog,
): Promise<void> {
  if (!accessToken || !blobStore) return;
  try {
    const res = await fetch(GRAPH_PHOTO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) {
      await clearStoredAvatar(userId, blobStore);
      return;
    }
    if (!res.ok) {
      log?.warn({ status: res.status, userId }, 'avatar photo fetch failed');
      return;
    }
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length === 0) {
      await clearStoredAvatar(userId, blobStore);
      return;
    }
    const jpeg = await resizeAvatar(raw);
    await blobStore.write(avatarBlobKey(userId), jpeg, 'image/jpeg');
    await UserModel.updateOne({ _id: userId }, { $set: { avatarUpdatedAt: clockNow() } });
  } catch (err) {
    log?.warn({ err, userId }, 'avatar photo refresh failed');
  }
}
