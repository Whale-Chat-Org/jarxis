import { AVATAR_CONTENT_TYPE, MAX_AVATAR_BYTES, isPng, uploadAvatar } from '@/lib/avatar-storage';
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

  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'IMAGE_REQUIRED', 'Avatar image required');

  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_AVATAR_BYTES) {
      await reader.cancel();
      throw new HttpError(413, 'TOO_LARGE', 'Avatar is too large');
    }
    chunks.push(value);
  }

  if (length === 0) throw new HttpError(400, 'IMAGE_REQUIRED', 'Avatar image required');
  const image = Buffer.concat(chunks);
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
