import { describe, expect, it } from 'vitest';
import { AzureBlobStore } from '../src/storage/blobStore.js';

/** Azure answers 416 when a read asks for more bytes than the blob holds (found on the live smoke test). */
describe('AzureBlobStore.read', () => {
  const fake = (data: Buffer) => {
    const calls: number[] = [];
    const blob = {
      getProperties: async () => ({ contentLength: data.length }),
      downloadToBuffer: async (offset: number, count: number) => {
        calls.push(count);
        if (offset + count > data.length)
          throw Object.assign(new Error('InvalidRange'), { statusCode: 416 });
        return data.subarray(offset, offset + count);
      },
    };
    const container = { containerName: 'c', getBlockBlobClient: () => blob };
    const store = new AzureBlobStore({} as never, container as never, null);
    return { store, calls };
  };

  it('reads a small blob whole even when the cap is 25 MiB', async () => {
    const { store, calls } = fake(Buffer.from('%PDF-1.7 hello'));
    expect((await store.read('k', 26_214_400)).toString()).toBe('%PDF-1.7 hello');
    expect(calls).toEqual([14]);
  });

  it('never reads past the cap, and an empty blob is an empty buffer', async () => {
    const big = fake(Buffer.alloc(100, 1));
    expect((await big.store.read('k', 10)).length).toBe(10);
    const empty = fake(Buffer.alloc(0));
    expect((await empty.store.read('k', 10)).length).toBe(0);
    expect(empty.calls).toEqual([]);
  });
});
