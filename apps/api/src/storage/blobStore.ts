import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  type ContainerClient,
  type UserDelegationKey,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { AppConfig } from '../config.js';

/**
 * Private file storage (doc 10 §4, FR-DOC-41, FR-EVD-04). The browser uploads straight to the
 * store with a short-lived write-only link, and downloads with a read-only link that expires
 * within 5 minutes. Blobs are never public.
 */
export interface BlobInfo {
  size: number;
  /** Blob index tags, e.g. Microsoft Defender for Storage's "Malware Scanning scan result". */
  tags: Record<string, string>;
}

export interface BlobStore {
  readonly kind: 'azure' | 'memory';
  uploadUrl(
    key: string,
    minutes: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  downloadUrl(key: string, minutes: number, fileName: string, contentType: string): Promise<string>;
  info(key: string): Promise<BlobInfo | null>;
  read(key: string, maxBytes: number): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const contentDisposition = (fileName: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;

export class AzureBlobStore implements BlobStore {
  readonly kind = 'azure' as const;
  private delegationKey: { key: UserDelegationKey; expires: number } | null = null;

  constructor(
    private readonly service: BlobServiceClient,
    private readonly container: ContainerClient,
    private readonly sharedKey: StorageSharedKeyCredential | null,
  ) {}

  private async sign(key: string, permissions: string, minutes: number, extra: object = {}) {
    const startsOn = new Date(Date.now() - 2 * 60_000);
    const expiresOn = new Date(Date.now() + minutes * 60_000);
    const values = {
      containerName: this.container.containerName,
      blobName: key,
      permissions: BlobSASPermissions.parse(permissions),
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
      ...extra,
    };
    let query: string;
    if (this.sharedKey) {
      query = generateBlobSASQueryParameters(values, this.sharedKey).toString();
    } else {
      // Managed identity: a user delegation key, cached for up to an hour.
      if (!this.delegationKey || this.delegationKey.expires < Date.now() + 10 * 60_000) {
        const expires = Date.now() + 60 * 60_000;
        const k = await this.service.getUserDelegationKey(startsOn, new Date(expires));
        this.delegationKey = { key: k, expires };
      }
      query = generateBlobSASQueryParameters(
        values,
        this.delegationKey.key,
        this.service.accountName,
      ).toString();
    }
    return `${this.container.getBlockBlobClient(key).url}?${query}`;
  }

  async uploadUrl(key: string, minutes: number) {
    // Create/write only: the link can't read, list or delete anything.
    const url = await this.sign(key, 'cw', minutes);
    return { url, headers: { 'x-ms-blob-type': 'BlockBlob' } };
  }

  downloadUrl(key: string, minutes: number, fileName: string, contentType: string) {
    return this.sign(key, 'r', minutes, {
      contentDisposition: contentDisposition(fileName),
      contentType,
    });
  }

  async info(key: string): Promise<BlobInfo | null> {
    const blob = this.container.getBlockBlobClient(key);
    try {
      const props = await blob.getProperties();
      let tags: Record<string, string> = {};
      try {
        tags = (await blob.getTags()).tags;
      } catch {
        tags = {};
      }
      return { size: props.contentLength ?? 0, tags };
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode === 404) return null;
      throw e;
    }
  }

  async read(key: string, maxBytes: number) {
    const blob = this.container.getBlockBlobClient(key);
    // A range past the end of the blob is refused (416), so never ask for more than it holds.
    const size = (await blob.getProperties()).contentLength ?? 0;
    const count = Math.min(size, maxBytes);
    return count > 0 ? blob.downloadToBuffer(0, count) : Buffer.alloc(0);
  }

  async remove(key: string) {
    await this.container.getBlockBlobClient(key).deleteIfExists({ deleteSnapshots: 'include' });
  }
}

/**
 * Development and test store. Its "upload link" is an API route (PUT /api/v1/uploads/:id/blob)
 * so the web app's upload code runs unchanged without Azure.
 */
export class MemoryBlobStore implements BlobStore {
  readonly kind = 'memory' as const;
  readonly blobs = new Map<string, { data: Buffer; tags: Record<string, string> }>();

  async uploadUrl(key: string) {
    const id = key.split('/').pop()!;
    return { url: `/api/v1/uploads/${id}/blob`, headers: { 'x-ms-blob-type': 'BlockBlob' } };
  }

  async downloadUrl(key: string, minutes: number) {
    const exp = Date.now() + minutes * 60_000;
    return `memory://${encodeURIComponent(key)}?se=${exp}`;
  }

  async info(key: string) {
    const b = this.blobs.get(key);
    return b ? { size: b.data.length, tags: b.tags } : null;
  }

  async read(key: string, maxBytes: number) {
    return (this.blobs.get(key)?.data ?? Buffer.alloc(0)).subarray(0, maxBytes);
  }

  async remove(key: string) {
    this.blobs.delete(key);
  }

  put(key: string, data: Buffer, tags: Record<string, string> = {}) {
    this.blobs.set(key, { data, tags });
  }
}

export function createBlobStore(config: AppConfig): BlobStore | null {
  const container = config.AZURE_STORAGE_CONTAINER;
  if (config.AZURE_STORAGE_CONNECTION_STRING) {
    const service = BlobServiceClient.fromConnectionString(config.AZURE_STORAGE_CONNECTION_STRING);
    const cred = service.credential;
    return new AzureBlobStore(
      service,
      service.getContainerClient(container),
      cred instanceof StorageSharedKeyCredential ? cred : null,
    );
  }
  if (config.AZURE_STORAGE_ACCOUNT) {
    const service = new BlobServiceClient(
      `https://${config.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
    return new AzureBlobStore(service, service.getContainerClient(container), null);
  }
  return config.NODE_ENV === 'production' ? null : new MemoryBlobStore();
}
