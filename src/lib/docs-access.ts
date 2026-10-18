import { env } from './env';
import { HttpError } from './errors';
import { grants, identify } from './rbac';
export async function guardDocs(req: Request) {
  if (env().NODE_ENV !== 'development') {
    const identity = await identify(req.headers);
    const currentGrants = await grants(identity.userId);
    if (!currentGrants.roles.includes('owner'))
      throw new HttpError(403, 'FORBIDDEN', 'Owner access required');
  }
}
