import { db } from '@/db';
import 'server-only';
import { HttpError } from './errors';
import type { Permission } from './permissions';
import { authorize, identify } from './rbac';
import { rateLimit } from './redis';

/** Shared browser-only management boundary; each feature retains its permission and rate bucket. */
export async function requireOwnerSession(req: Request, permission: Permission, bucket: string) {
  if (req.headers.has('authorization'))
    throw new HttpError(401, 'SESSION_REQUIRED', 'Owner session required');
  const identity = await identify(req.headers);
  const session = await db.session.findFirst({
    where: {
      id: identity.sessionId,
      userId: identity.userId,
      impersonatedBy: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (!session) throw new HttpError(403, 'FORBIDDEN', 'Owner session required');
  const current = await authorize(identity, permission);
  if (!current.roles.includes('owner'))
    throw new HttpError(403, 'FORBIDDEN', 'Owner access required');
  await rateLimit(`${bucket}:${identity.userId}`, 60, 60);
  return identity.userId;
}
