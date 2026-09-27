import { Readable } from 'node:stream';
import { z } from 'zod';

import {
  AVATAR_CONTENT_TYPE,
  deleteAvatar,
  downloadAvatar,
  isBlobNotFound,
} from '@/lib/avatar-storage';
import { HttpError } from '@/lib/errors';
import { handler } from '@/lib/http';
import { identify } from '@/lib/rbac';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  userId: z.string().min(1).max(128),
  blobId: z.uuid(),
});

function routeParams(context: RouteContext<'/api/profile/avatar/[userId]/[blobId]'>) {
  return context.params.then((params) => paramsSchema.parse(params));
}

export const GET = handler<RouteContext<'/api/profile/avatar/[userId]/[blobId]'>>(
  async (req, context) => {
    await identify(req.headers);
    const { userId, blobId } = await routeParams(context);

    try {
      const result = await downloadAvatar(userId, blobId);
      if (!result.readableStreamBody)
        throw new HttpError(503, 'UNAVAILABLE', 'Avatar is temporarily unavailable');

      return new Response(Readable.toWeb(result.readableStreamBody) as ReadableStream, {
        headers: {
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Content-Type': result.contentType ?? AVATAR_CONTENT_TYPE,
          ...(result.contentLength === undefined
            ? {}
            : { 'Content-Length': String(result.contentLength) }),
          ...(result.etag ? { ETag: result.etag } : {}),
        },
      });
    } catch (error) {
      if (isBlobNotFound(error)) throw new HttpError(404, 'NOT_FOUND', 'Avatar not found');
      throw error;
    }
  },
);

export const DELETE = handler<RouteContext<'/api/profile/avatar/[userId]/[blobId]'>>(
  async (req, context) => {
    const actor = await identify(req.headers);
    const { userId, blobId } = await routeParams(context);
    if (actor.userId !== userId)
      throw new HttpError(403, 'FORBIDDEN', 'You cannot delete this avatar');
    await deleteAvatar(userId, blobId);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  },
);
