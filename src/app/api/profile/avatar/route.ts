import { AVATAR_CONTENT_TYPE, MAX_AVATAR_BYTES, isPng, uploadAvatar } from '@/lib/avatar-storage';
import { readBoundedBody } from '@/lib/bounded-body';
import { HttpError } from '@/lib/errors';
import { handler, json } from '@/lib/http';
import { identify } from '@/lib/rbac';
import { rateLimit } from '@/lib/redis';

export const runtime = 'nodejs';

async function readAvatar(req: Request) {
  if (req.headers.get('content-type') !== AVATAR_CONTENT_TYPE)
    throw new HttpError(415, 'CONTENT_TYPE', 'Expected image/png');

  const declaredLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_BYTES)
    throw new HttpError(413, 'TOO_LARGE', 'Avatar is too large');

  if (!req.body) throw new HttpError(400, 'IMAGE_REQUIRED', 'Avatar image required');
  const image = await readBoundedBody(req.body, MAX_AVATAR_BYTES, {
    tooLarge: () => new HttpError(413, 'TOO_LARGE', 'Avatar is too large'),
  });
  if (image.length === 0) throw new HttpError(400, 'IMAGE_REQUIRED', 'Avatar image required');
  if (!isPng(image)) throw new HttpError(400, 'INVALID_IMAGE', 'Invalid PNG image');
  return image;
}

export const POST = handler(async (req) => {
  const actor = await identify(req.headers);
  await rateLimit(`avatar:${actor.userId}`, 20, 60 * 60);
  const image = await readAvatar(req);
  const uploaded = await uploadAvatar(actor.userId, image);
  return json({ url: uploaded.url }, 201);
});
