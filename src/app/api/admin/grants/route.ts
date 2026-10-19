import { HttpError } from '@/lib/errors';
import { handler, json } from '@/lib/http';
import { grants, identify } from '@/lib/rbac';
import { rateLimit } from '@/lib/redis';

export const runtime = 'nodejs';

export const GET = handler(async (req) => {
  if (req.headers.has('authorization'))
    throw new HttpError(401, 'SESSION_REQUIRED', 'Session required');
  const identity = await identify(req.headers);
  await rateLimit(`admin-grants:${identity.userId}`, 120);
  const current = await grants(identity.userId);
  return json({ permissions: [...current.permissions] });
});
