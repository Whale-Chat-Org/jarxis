import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  fromConnectionString: vi.fn(),
  getContainerClient: vi.fn(),
  createIfNotExists: vi.fn(),
  getBlockBlobClient: vi.fn(),
  uploadData: vi.fn(),
  download: vi.fn(),
  deleteIfExists: vi.fn(),
}));
vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: { fromConnectionString: m.fromConnectionString },
}));
vi.mock('@/lib/env', () => ({
  avatarEnv: () => ({
    AZURE_STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
    AZURE_STORAGE_CONTAINER: 'profile-photos',
  }),
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  m.fromConnectionString.mockReturnValue({ getContainerClient: m.getContainerClient });
  m.getContainerClient.mockReturnValue({
    createIfNotExists: m.createIfNotExists,
    getBlockBlobClient: m.getBlockBlobClient,
  });
  m.getBlockBlobClient.mockReturnValue({
    uploadData: m.uploadData,
    download: m.download,
    deleteIfExists: m.deleteIfExists,
  });
});

describe('avatar storage', () => {
  it('uploads a PNG under an encoded user path with private immutable caching', async () => {
    const storage = await import('@/lib/avatar-storage');
    const data = new Uint8Array([1, 2, 3]);
    const result = await storage.uploadAvatar('user/1', data);
    expect(result.blobId).toMatch(UUID);
    expect(result.url).toBe(`/api/profile/avatar/user%2F1/${result.blobId}`);
    expect(m.fromConnectionString).toHaveBeenCalledWith('UseDevelopmentStorage=true');
    expect(m.getContainerClient).toHaveBeenCalledWith('profile-photos');
    // Created without a public access level.
    expect(m.createIfNotExists).toHaveBeenCalledWith();
    expect(m.getBlockBlobClient).toHaveBeenCalledWith(`user%2F1/${result.blobId}.png`);
    expect(m.uploadData).toHaveBeenCalledWith(data, {
      blobHTTPHeaders: {
        blobContentType: 'image/png',
        blobCacheControl: 'private, max-age=31536000, immutable',
      },
    });
  });

  it('initialises the container once across operations', async () => {
    const storage = await import('@/lib/avatar-storage');
    m.download.mockResolvedValue({ contentType: 'image/png' });
    await expect(storage.downloadAvatar('u1', 'b1')).resolves.toEqual({ contentType: 'image/png' });
    await storage.deleteAvatar('u1', 'b1');
    expect(m.getBlockBlobClient).toHaveBeenCalledWith('u1/b1.png');
    expect(m.deleteIfExists).toHaveBeenCalled();
    expect(m.createIfNotExists).toHaveBeenCalledTimes(1);
  });

  it('identifies blob-not-found errors only by a 404 status', async () => {
    const { isBlobNotFound } = await import('@/lib/avatar-storage');
    expect(isBlobNotFound({ statusCode: 404 })).toBe(true);
    expect(isBlobNotFound({ statusCode: 500 })).toBe(false);
    expect(isBlobNotFound({})).toBe(false);
    expect(isBlobNotFound(null)).toBe(false);
    expect(isBlobNotFound('404')).toBe(false);
  });
});
