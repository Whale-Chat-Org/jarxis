import { Readable } from 'node:stream';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '@/lib/errors';

const identify = vi.fn();
const rateLimit = vi.fn();
const uploadAvatar = vi.fn();
const downloadAvatar = vi.fn();
const deleteAvatar = vi.fn();

vi.mock('@/lib/rbac', () => ({ identify }));
vi.mock('@/lib/redis', () => ({ rateLimit }));
vi.mock('@/lib/avatar-storage', () => ({
  AVATAR_CONTENT_TYPE: 'image/png',
  MAX_AVATAR_BYTES: 1024 * 1024,
  isPng: (data: Uint8Array) =>
    Buffer.from(data.subarray(0, 8)).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
  isBlobNotFound: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === 404,
  uploadAvatar,
  downloadAvatar,
  deleteAvatar,
}));

const { POST } = await import('@/app/api/profile/avatar/route');
const { GET, DELETE } = await import('@/app/api/profile/avatar/[userId]/[blobId]/route');

const userId = 'user-1';
const blobId = '123e4567-e89b-42d3-a456-426614174000';
const routeContext = {
  params: Promise.resolve({ userId, blobId }),
} as RouteContext<'/api/profile/avatar/[userId]/[blobId]'>;

function png(bytes = 16) {
  const data = Buffer.alloc(bytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  return data;
}

function mutationRequest(body: BodyInit, contentType = 'image/png') {
  return new Request('http://localhost:3000/api/profile/avatar', {
    method: 'POST',
    headers: {
      Cookie: 'session=test',
      Origin: 'http://localhost:3000',
      'Content-Type': contentType,
    },
    body,
  });
}

beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/jarxis_test',
    REDIS_URL: 'redis://localhost:6379',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'a'.repeat(64),
    JWT_SECRET: 'b'.repeat(64),
    BREVO_API_KEY: 'xkeysib-test',
    MAIL_FROM: 'Jarxis <noreply@example.com>',
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  identify.mockResolvedValue({ userId, sessionId: 'session-1' });
  rateLimit.mockResolvedValue(undefined);
  uploadAvatar.mockResolvedValue({ blobId, url: `/api/profile/avatar/${userId}/${blobId}` });
});

describe('avatar upload route', () => {
  it('requires an active session and a same-origin mutation', async () => {
    identify.mockRejectedValueOnce(new HttpError(401, 'UNAUTHENTICATED', 'Sign in required'));
    expect((await POST(mutationRequest(png()))).status).toBe(401);

    const foreign = mutationRequest(png());
    foreign.headers.set('Origin', 'https://evil.test');
    expect((await POST(foreign)).status).toBe(403);
  });

  it('rejects unsupported, malformed, and oversized images', async () => {
    expect((await POST(mutationRequest(png(), 'image/jpeg'))).status).toBe(415);
    expect((await POST(mutationRequest(Buffer.from('not-png')))).status).toBe(400);
    expect((await POST(mutationRequest(png(1024 * 1024 + 1)))).status).toBe(413);
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it('rate limits and stores a valid PNG under the authenticated user', async () => {
    const response = await POST(mutationRequest(png()));
    expect(response.status).toBe(201);
    expect(rateLimit).toHaveBeenCalledWith(`avatar:${userId}`, 20, 3600);
    expect(uploadAvatar).toHaveBeenCalledWith(userId, expect.any(Uint8Array));
    expect(await response.json()).toEqual({
      url: `/api/profile/avatar/${userId}/${blobId}`,
    });
  });
});

describe('private avatar object route', () => {
  it('lets another signed-in user read the immutable avatar', async () => {
    identify.mockResolvedValueOnce({ userId: 'viewer', sessionId: 'session-2' });
    downloadAvatar.mockResolvedValueOnce({
      readableStreamBody: Readable.from(png()),
      contentType: 'image/png',
      contentLength: 16,
      etag: 'etag-1',
    });
    const response = await GET(new Request('http://localhost/avatar'), routeContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect(downloadAvatar).toHaveBeenCalledWith(userId, blobId);
  });

  it('returns a sanitized 404 for a missing blob', async () => {
    downloadAvatar.mockRejectedValueOnce({ statusCode: 404, details: 'provider detail' });
    const response = await GET(new Request('http://localhost/avatar'), routeContext);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Avatar not found' },
    });
  });

  it('allows only the owner to delete a blob and makes deletion idempotent', async () => {
    identify.mockResolvedValueOnce({ userId: 'other-user', sessionId: 'session-2' });
    const forbidden = await DELETE(
      new Request('http://localhost/avatar', {
        method: 'DELETE',
        headers: { Origin: 'http://localhost:3000' },
      }),
      routeContext,
    );
    expect(forbidden.status).toBe(403);

    identify.mockResolvedValueOnce({ userId, sessionId: 'session-1' });
    const deleted = await DELETE(
      new Request('http://localhost/avatar', {
        method: 'DELETE',
        headers: { Origin: 'http://localhost:3000' },
      }),
      routeContext,
    );
    expect(deleted.status).toBe(204);
    expect(deleteAvatar).toHaveBeenCalledWith(userId, blobId);
  });
});

describe('avatar route edge cases', () => {
  it('rejects a declared oversized body before reading it', async () => {
    const request = mutationRequest(png());
    request.headers.set('Content-Length', String(1024 * 1024 + 1));
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it('rejects an empty or missing image body', async () => {
    expect((await POST(mutationRequest(new Uint8Array(0)))).status).toBe(400);
    const noBody = new Request('http://localhost:3000/api/profile/avatar', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'image/png' },
    });
    const response = await POST(noBody);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('IMAGE_REQUIRED');
  });

  it('answers 503 when storage returns no stream and defaults headers', async () => {
    downloadAvatar.mockResolvedValueOnce({});
    expect((await GET(new Request('http://localhost/avatar'), routeContext)).status).toBe(503);

    downloadAvatar.mockResolvedValueOnce({ readableStreamBody: Readable.from(png()) });
    const response = await GET(new Request('http://localhost/avatar'), routeContext);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('ETag')).toBeNull();
    expect(response.headers.get('Content-Length')).toBeNull();
  });

  it('hides unexpected storage failures behind a generic 503', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    downloadAvatar.mockRejectedValueOnce(
      Object.assign(new Error('AccountKey=fake'), { statusCode: 500 }),
    );
    const response = await GET(new Request('http://localhost/avatar'), routeContext);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('AccountKey');
    log.mockRestore();
  });

  it('validates route parameters', async () => {
    const bad = {
      params: Promise.resolve({ userId, blobId: 'not-a-uuid' }),
    } as RouteContext<'/api/profile/avatar/[userId]/[blobId]'>;
    expect((await GET(new Request('http://localhost/avatar'), bad)).status).toBe(400);
    expect(downloadAvatar).not.toHaveBeenCalled();
  });
});
