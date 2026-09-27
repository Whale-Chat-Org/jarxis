import { identify, grants } from './rbac';
import { env } from './env';
import { HttpError } from './errors';
export async function guardDocs(req: Request) {
  if (env().NODE_ENV !== 'development') {
    const i = await identify(req.headers);
    const g = await grants(i.userId);
    if (!g.roles.includes('owner')) throw new HttpError(403, 'FORBIDDEN', 'Owner access required');
  }
}
