import request from 'supertest';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserModel } from '../src/models/index.js';
import { avatarBlobKey, refreshUserAvatar, resizeAvatar } from '../src/services/userAvatar.js';
import { MemoryBlobStore } from '../src/storage/blobStore.js';
import { createUser, login, makeApp, PASSWORD, useDatabase } from './helpers.js';

useDatabase();

const png = (color: string) =>
  sharp({
    create: { width: 160, height: 120, channels: 3, background: color },
  })
    .png()
    .toBuffer();

describe('CR-21 Microsoft profile photo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resizes an incoming photo to a 96×96 JPEG (FR-USR-07)', async () => {
    const out = await resizeAvatar(await png('#3366ff'));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(96);
    expect(meta.height).toBe(96);
  });

  it('saves a Graph photo into blob storage and serves it (AC-68.1)', async () => {
    const user = await createUser({ password: PASSWORD });
    const store = new MemoryBlobStore();
    const body = await png('#2266aa');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        expect(String(input)).toBe('https://graph.microsoft.com/v1.0/me/photo/$value');
        return new Response(body, { status: 200, headers: { 'Content-Type': 'image/png' } });
      }),
    );
    await refreshUserAvatar(user._id.toString(), 'access-token-not-for-logs', store);
    const saved = await store.read(avatarBlobKey(user._id.toString()), 200_000);
    expect(saved.length).toBeGreaterThan(0);
    expect((await sharp(saved).metadata()).width).toBe(96);
    const fresh = await UserModel.findById(user._id);
    expect(fresh?.avatarUpdatedAt).toBeTruthy();

    const app = makeApp();
    (app.locals.blobStore as MemoryBlobStore).put(avatarBlobKey(user._id.toString()), saved);
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { avatarUpdatedAt: fresh!.avatarUpdatedAt } },
    );
    const agent = await login(app, user.email);
    const res = await agent.get(`/api/v1/users/${user._id.toString()}/avatar`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(res.headers.etag).toMatch(/^"/);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('a second photo replaces the stored image (AC-68.2)', async () => {
    const user = await createUser({ password: PASSWORD });
    const store = new MemoryBlobStore();
    const first = await resizeAvatar(await png('#111111'));
    store.put(avatarBlobKey(user._id.toString()), first);
    await UserModel.updateOne({ _id: user._id }, { $set: { avatarUpdatedAt: new Date(1) } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(await png('#eeeeee'), { status: 200 })),
    );
    await refreshUserAvatar(user._id.toString(), 'tok', store);
    const next = await store.read(avatarBlobKey(user._id.toString()), 200_000);
    expect(Buffer.compare(first, next)).not.toBe(0);
    const fresh = await UserModel.findById(user._id);
    expect(fresh?.avatarUpdatedAt?.getTime()).toBeGreaterThan(1);
  });

  it('Graph 404 clears a stored photo; sign-in path still succeeds (AC-68.3)', async () => {
    const user = await createUser({ password: PASSWORD });
    const store = new MemoryBlobStore();
    store.put(avatarBlobKey(user._id.toString()), await resizeAvatar(await png('#123456')));
    await UserModel.updateOne({ _id: user._id }, { $set: { avatarUpdatedAt: new Date() } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await refreshUserAvatar(user._id.toString(), 'tok', store);
    expect(await store.info(avatarBlobKey(user._id.toString()))).toBeNull();
    expect((await UserModel.findById(user._id))?.avatarUpdatedAt).toBeNull();

    const app = makeApp();
    const agent = await login(app, user.email);
    expect((await agent.get(`/api/v1/users/${user._id.toString()}/avatar`)).status).toBe(404);
  });

  it('a Graph error keeps the previous photo and does not log the token (AC-68.4)', async () => {
    const user = await createUser({ password: PASSWORD });
    const store = new MemoryBlobStore();
    const kept = await resizeAvatar(await png('#654321'));
    store.put(avatarBlobKey(user._id.toString()), kept);
    const at = new Date('2026-11-01T00:00:00.000Z');
    await UserModel.updateOne({ _id: user._id }, { $set: { avatarUpdatedAt: at } });
    const warn = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    await refreshUserAvatar(user._id.toString(), 'secret-access-token', store, { warn });
    expect(
      Buffer.compare(await store.read(avatarBlobKey(user._id.toString()), 200_000), kept),
    ).toBe(0);
    expect((await UserModel.findById(user._id))?.avatarUpdatedAt?.toISOString()).toBe(
      at.toISOString(),
    );
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-access-token');
  });

  it('refuses an unauthenticated avatar request (AC-68.5)', async () => {
    const user = await createUser({ password: PASSWORD });
    const res = await request(makeApp()).get(`/api/v1/users/${user._id.toString()}/avatar`);
    expect(res.status).toBe(401);
  });

  it('refuses an open session once the account is deactivated (Queen TC-AV-003b)', async () => {
    const user = await createUser({ password: PASSWORD });
    const app = makeApp();
    const agent = await login(app, user.email);
    await UserModel.updateOne({ _id: user._id }, { active: false });
    const res = await agent.get(`/api/v1/users/${user._id.toString()}/avatar`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('sign-in still completes when the photo step throws (FR-USR-12)', async () => {
    const user = await createUser({ password: PASSWORD });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('graph down');
      }),
    );
    const warn = vi.fn();
    await expect(
      refreshUserAvatar(user._id.toString(), 'tok', new MemoryBlobStore(), { warn }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
