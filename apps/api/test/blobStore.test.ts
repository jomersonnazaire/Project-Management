import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AzureBlobStore } from '../src/storage/blobStore.js';

/** Reads use one GET without a Range header (ranged reads came back 416 on the live account). */
describe('AzureBlobStore.read', () => {
  const fake = (data: Buffer) => {
    const calls: unknown[][] = [];
    const blob = {
      download: async (...args: unknown[]) => {
        calls.push(args);
        return { readableStreamBody: Readable.from([data.subarray(0, 5), data.subarray(5)]) };
      },
    };
    const container = { containerName: 'c', getBlockBlobClient: () => blob };
    return { store: new AzureBlobStore({} as never, container as never, null), calls };
  };

  it('reads a small blob whole with no range, even when the cap is 25 MiB', async () => {
    const { store, calls } = fake(Buffer.from('%PDF-1.7 hello'));
    expect((await store.read('k', 26_214_400)).toString()).toBe('%PDF-1.7 hello');
    expect(calls).toEqual([[]]);
  });

  it('never returns more than the cap; an empty blob is an empty buffer', async () => {
    expect((await fake(Buffer.alloc(100, 1)).store.read('k', 10)).length).toBe(10);
    expect((await fake(Buffer.alloc(0)).store.read('k', 10)).length).toBe(0);
  });
});
