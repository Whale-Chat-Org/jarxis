import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

const m = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), client: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: () => false, readFileSync: vi.fn() }));
vi.mock('@aws-sdk/client-s3', async (original) => {
  const sdk = await original<typeof import('@aws-sdk/client-s3')>();
  return {
    ...sdk,
    S3Client: class {
      constructor(config: unknown) {
        m.client(config);
      }
      send = m.send;
      destroy = m.destroy;
    },
  };
});
const saved = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  m.send.mockReset();
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STORAGE_PROVIDER: 's3',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_BUCKET: 'avatars',
    AWS_ACCESS_KEY_ID: 'test-only-key',
    AWS_SECRET_ACCESS_KEY: 'test-only-secret',
  });
});
afterEach(() => {
  process.env = { ...saved };
});
const setup = () => import('../../scripts/setup-minio.mjs');

describe('local MinIO bucket setup', () => {
  it('creates a missing private bucket without changing existing buckets', async () => {
    m.send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } }).mockResolvedValueOnce({});
    await setup();
    expect(m.send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    expect(m.send.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
    expect(m.send.mock.calls[1][0].input).toEqual({ Bucket: 'avatars' });
    expect(m.destroy).toHaveBeenCalled();
  });
  it('is idempotent when the bucket already exists', async () => {
    m.send.mockResolvedValue({});
    await setup();
    expect(m.send).toHaveBeenCalledTimes(1);
  });
  it('tolerates another local setup creating the bucket first', async () => {
    m.send
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockRejectedValueOnce({ name: 'BucketAlreadyOwnedByYou' });
    await expect(setup()).resolves.toBeDefined();
  });
  it('preserves provider errors as sanitized failures without attempting bucket creation', async () => {
    m.send.mockRejectedValue({ $metadata: { httpStatusCode: 403 }, message: 'secret' });
    await expect(setup()).rejects.toThrow('Local MinIO bucket setup failed');
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.destroy).toHaveBeenCalled();
  });
  it('skips bucket provisioning in Azure mode', async () => {
    delete process.env.S3_BUCKET;
    await setup();
    expect(m.client).not.toHaveBeenCalled();
  });
  it.each([
    { NODE_ENV: 'production' },
    { S3_ENDPOINT: 'https://remote.example.com' },
    { AWS_SECRET_ACCESS_KEY: '' },
  ])('refuses unsafe or incomplete setup configuration: %j', async (values) => {
    Object.assign(process.env, values);
    await expect(setup()).rejects.toThrow();
    expect(m.send).not.toHaveBeenCalled();
  });
});
