import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const m = vi.hoisted(() => ({ send: vi.fn(), client: vi.fn(), azure: vi.fn() }));
vi.mock('@aws-sdk/client-s3', async (original) => {
  const sdk = await original<typeof import('@aws-sdk/client-s3')>();
  return {
    ...sdk,
    S3Client: class {
      constructor(config: unknown) {
        m.client(config);
      }
      send = m.send;
    },
  };
});
vi.mock('@azure/storage-blob', () => ({ BlobServiceClient: { fromConnectionString: m.azure } }));
vi.mock('@/lib/env', () => ({
  storageEnv: () => [
    {
      STORAGE_PROVIDER: 's3',
      S3_BUCKET: 'avatars',
      S3_REGION: 'us-east-1',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_FORCE_PATH_STYLE: true,
    },
  ],
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  m.send.mockReset();
});

describe('S3 avatar storage', () => {
  it('uploads privately using the existing object keys and application URLs', async () => {
    const { uploadAvatar } = await import('@/lib/avatar-storage');
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await uploadAvatar('user/1', bytes);
    expect(result.url).toBe(`/api/profile/avatar/user%2F1/${result.blobId}`);
    const command = m.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'avatars',
      Key: `user%2F1/${result.blobId}.png`,
      Body: bytes,
      ContentType: 'image/png',
      CacheControl: 'private, max-age=31536000, immutable',
    });
    expect(m.client).toHaveBeenCalledWith({
      region: 'us-east-1',
      endpoint: 'http://localhost:9000',
      forcePathStyle: true,
    });
    expect(m.azure).not.toHaveBeenCalled();
  });

  it('streams the body and maps headers to the existing download contract', async () => {
    const { downloadAvatar, deleteAvatar } = await import('@/lib/avatar-storage');
    const body = Readable.from(['png']);
    m.send.mockResolvedValueOnce({
      Body: body,
      ContentType: 'image/png',
      ContentLength: 3,
      ETag: 'etag',
    });
    const result = await downloadAvatar('user/1', 'id');
    expect(result).toEqual({
      readableStreamBody: body,
      contentType: 'image/png',
      contentLength: 3,
      etag: 'etag',
    });
    expect(m.send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect(m.send.mock.calls[0][0].input).toEqual({ Bucket: 'avatars', Key: 'user%2F1/id.png' });
    expect(await body.toArray()).toEqual(['png']);
    await deleteAvatar('user/1', 'id');
    expect(m.send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand);
    expect(m.send.mock.calls[1][0].input).toEqual({ Bucket: 'avatars', Key: 'user%2F1/id.png' });
    expect(m.client).toHaveBeenCalledTimes(1);
  });

  it('preserves missing-body handling and propagates provider failures', async () => {
    const { downloadAvatar, uploadAvatar, deleteAvatar, isBlobNotFound } =
      await import('@/lib/avatar-storage');
    m.send.mockResolvedValueOnce({});
    await expect(downloadAvatar('u', 'id')).rejects.toThrow('Storage download failed');
    const missing = { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } };
    m.send.mockRejectedValueOnce(missing);
    await expect(downloadAvatar('u', 'id')).rejects.toMatchObject({ statusCode: 404 });
    expect(isBlobNotFound(missing)).toBe(true);
    expect(isBlobNotFound({ name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } })).toBe(
      false,
    );
    const denied = { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } };
    expect(isBlobNotFound(denied)).toBe(false);
    m.send.mockRejectedValueOnce(denied).mockRejectedValueOnce(denied);
    await expect(uploadAvatar('u', new Uint8Array([1]))).rejects.toThrow('Storage upload failed');
    await expect(deleteAvatar('u', 'id')).rejects.toThrow('Storage delete failed');
  });
});
