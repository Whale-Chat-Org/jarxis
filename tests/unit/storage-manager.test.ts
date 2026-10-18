import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageConfig } from '@/lib/storage';

const m = vi.hoisted(() => ({
  s3: vi.fn(),
  azureUpload: vi.fn(),
  azureDownload: vi.fn(),
  azureDelete: vi.fn(),
  create: vi.fn(),
  container: vi.fn(),
  blob: vi.fn(),
}));
vi.mock('@aws-sdk/client-s3', async (original) => ({
  ...(await original<typeof import('@aws-sdk/client-s3')>()),
  S3Client: class {
    send = m.s3;
  },
}));
vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: m.container }) },
}));
const config: StorageConfig = [
  {
    STORAGE_PROVIDER: 'azure',
    AZURE_STORAGE_CONNECTION_STRING: 'test',
    AZURE_STORAGE_CONTAINER: 'jarxis-storage',
  },
  {
    STORAGE_PROVIDER: 's3',
    S3_BUCKET: 'jarxis-storage',
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: true,
  },
];
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  m.container.mockReturnValue({ createIfNotExists: m.create, getBlockBlobClient: m.blob });
  m.blob.mockReturnValue({
    uploadData: m.azureUpload,
    download: m.azureDownload,
    deleteIfExists: m.azureDelete,
  });
});

describe('storage manager replication and failover', () => {
  it('uploads the same key, bytes and metadata to every configured backend', async () => {
    const { createStorage } = await import('@/lib/storage');
    const manager = createStorage(config);
    const data = new Uint8Array([1, 2]);
    const result = await manager.upload('example/file.png', data, { contentType: 'image/png' });
    expect(result).toEqual({ storedIn: ['azure', 's3'], failedProviders: [] });
    expect(m.azureUpload).toHaveBeenCalledWith(data, {
      blobHTTPHeaders: { blobContentType: 'image/png', blobCacheControl: undefined },
    });
    expect(m.blob).toHaveBeenCalledWith('example/file.png');
    expect(m.s3.mock.calls[0][0].input).toMatchObject({
      Key: 'example/file.png',
      Body: data,
      ContentType: 'image/png',
    });
  });
  it.each(['azure', 's3'] as const)(
    'succeeds and reports a failed %s copy for retry',
    async (failed) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { createStorage } = await import('@/lib/storage');
      (failed === 'azure' ? m.azureUpload : m.s3).mockRejectedValue(new Error('do-not-log-secret'));
      const result = await createStorage(config).upload('key', new Uint8Array([1]), {
        contentType: 'text/plain',
      });
      expect(result.failedProviders).toEqual([failed]);
      expect(result.storedIn).toEqual([failed === 'azure' ? 's3' : 'azure']);
      expect(JSON.stringify(warning.mock.calls)).not.toContain('do-not-log-secret');
      warning.mockRestore();
    },
  );
  it('fails only after attempting both uploads when neither succeeds', async () => {
    const { createStorage } = await import('@/lib/storage');
    m.azureUpload.mockRejectedValue(new Error('azure'));
    m.s3.mockRejectedValue(new Error('s3'));
    await expect(
      createStorage(config).upload('key', new Uint8Array(), { contentType: 'text/plain' }),
    ).rejects.toThrow('Storage upload failed');
    expect(m.azureUpload).toHaveBeenCalledOnce();
    expect(m.s3).toHaveBeenCalledOnce();
  });
  it.each([{ statusCode: 404 }, new Error('unavailable'), undefined])(
    'falls back when Azure has no readable copy: %j',
    async (failure) => {
      const { createStorage } = await import('@/lib/storage');
      if (failure) m.azureDownload.mockRejectedValue(failure);
      else m.azureDownload.mockResolvedValue({});
      const body = Readable.from(['data']);
      m.s3.mockResolvedValue({ Body: body });
      expect((await createStorage(config).download('key')).readableStreamBody).toBe(body);
      expect(await body.toArray()).toEqual(['data']);
    },
  );
  it('uses the first readable copy without opening another download stream', async () => {
    const { createStorage } = await import('@/lib/storage');
    const body = Readable.from(['data']);
    m.azureDownload.mockResolvedValue({ readableStreamBody: body });
    expect((await createStorage(config).download('key')).readableStreamBody).toBe(body);
    expect(m.s3).not.toHaveBeenCalled();
    body.destroy();
  });
  it('returns 404 only when every backend reports the object missing', async () => {
    const { createStorage } = await import('@/lib/storage');
    const manager = createStorage(config);
    m.azureDownload.mockRejectedValue({ statusCode: 404 });
    m.s3.mockRejectedValue({ name: 'NoSuchKey' });
    await expect(manager.download('key')).rejects.toMatchObject({ statusCode: 404 });
    m.azureDownload.mockRejectedValue(new Error('offline'));
    await expect(manager.download('key')).rejects.toThrow('Storage download failed');
  });
  it('attempts deletion everywhere, ignoring missing objects but reporting failed cleanup', async () => {
    const { createStorage } = await import('@/lib/storage');
    const manager = createStorage(config);
    m.azureDelete.mockRejectedValue(new Error('offline'));
    await expect(manager.delete('key')).rejects.toThrow('Storage delete failed');
    expect(m.s3).toHaveBeenCalledOnce();
    m.azureDelete.mockRejectedValue({ statusCode: 404 });
    m.s3.mockRejectedValue({ name: 'NoSuchKey' });
    await expect(manager.delete('key')).resolves.toBeUndefined();
  });
  it('retries Azure initialization after a transient failure', async () => {
    const { createStorage } = await import('@/lib/storage');
    const manager = createStorage([config[0]]);
    m.create.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
    await expect(manager.delete('key')).rejects.toThrow('Storage delete failed');
    await expect(manager.delete('key')).resolves.toBeUndefined();
    expect(m.create).toHaveBeenCalledTimes(2);
  });
  it('rejects an empty backend set', async () => {
    const { createStorage } = await import('@/lib/storage');
    expect(() => createStorage([])).toThrow('No storage backend configured');
  });
});
