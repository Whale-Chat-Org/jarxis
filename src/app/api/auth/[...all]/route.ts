import { getAuth } from '@/lib/auth';
import { handler, json } from '@/lib/http';
import { rateLimit, requestIP } from '@/lib/redis';
export const runtime = 'nodejs';
const run = handler(async (req) => {
  const path = decodeURIComponent(new URL(req.url).pathname).replace(/\/+$/, '');
  const endpoint = path.slice('/api/auth'.length);
  if (
    [
      '/sign-in/social',
      '/link-social',
      '/unlink-account',
      '/get-access-token',
      '/refresh-token',
      '/account-info',
    ].includes(endpoint) ||
    endpoint === '/callback' ||
    endpoint.startsWith('/callback/')
  )
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  // Scalar and the merged schema are served only through our guarded routes.
  if (path.endsWith('/reference') || path.endsWith('/open-api/generate-schema'))
    return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  // Read-heavy session refreshes must not consume the stricter mutation budget.
  const bucket = req.method === 'GET' ? 'read' : 'write';
  await rateLimit(`auth:${bucket}:${requestIP(req.headers)}`, req.method === 'GET' ? 120 : 30);
  return getAuth().handler(req);
});
export const GET = run;
export const POST = run;
