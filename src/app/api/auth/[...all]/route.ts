import { getAuth } from '@/lib/auth';
import { isBlockedAuthPath } from '@/lib/auth-paths';
import { handler, json } from '@/lib/http';
import { rateLimit, requestIP } from '@/lib/redis';
import { withLiveAdminRoles } from '@/lib/roles';
export const runtime = 'nodejs';
const run = handler(async (req) => {
  const path = decodeURIComponent(new URL(req.url).pathname).replace(/\/+$/, '');
  const endpoint = path.slice('/api/auth'.length);
  if (isBlockedAuthPath(endpoint))
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  // Read-heavy session refreshes must not consume the stricter mutation budget.
  const bucket = req.method === 'GET' ? 'read' : 'write';
  await rateLimit(`auth:${bucket}:${requestIP(req.headers)}`, req.method === 'GET' ? 120 : 30);
  return endpoint.startsWith('/admin/')
    ? withLiveAdminRoles(() => getAuth().handler(req))
    : getAuth().handler(req);
});
export const GET = run;
export const POST = run;
