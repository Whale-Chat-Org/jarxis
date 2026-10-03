import 'server-only';
import { db } from '@/db';
import { HttpError } from '@/lib/errors';
import { authorize, identify } from '@/lib/rbac';
import { rateLimit } from '@/lib/redis';

export async function requireMlOwner(
  req: Request,
  permission: 'providers:read' | 'providers:manage',
) {
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
  const grants = await authorize(identity, permission);
  if (!grants.roles.includes('owner'))
    throw new HttpError(403, 'FORBIDDEN', 'Owner access required');
  await rateLimit(`ml-management:${identity.userId}`, 60, 60);
  return identity.userId;
}
