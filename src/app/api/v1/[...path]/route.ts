import { getAuth } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { body, handler, json } from '@/lib/http';
import { identify } from '@/lib/rbac';
import { rateLimit, requestIP } from '@/lib/redis';
import { issueTokens, revokeFamily, rotateTokens } from '@/lib/tokens';
import { loginInput, refreshInput } from '@/lib/validation';
export const runtime = 'nodejs';
/**
 * Bearer-token authentication only.
 *
 * Administrative mutations are served by the Better Auth admin plugin under
 * `/api/auth/admin/*`, which requires a session cookie and is guarded by
 * `src/lib/auth/admin-guards.ts`. That means they are not reachable with a bearer token.
 */
const run = handler(async (req) => {
  const url = new URL(req.url);
  const segments = url.pathname.replace('/api/v1/', '').split('/');
  const method = req.method;
  if (segments[0] === 'auth') {
    if (method !== 'POST' || segments.length !== 2)
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    await rateLimit(`tokens:${requestIP(req.headers)}`);
    if (segments[1] === 'login') {
      const input = await body(req, loginInput);
      await rateLimit(`login:${input.email.toLowerCase()}`, 10, 300);
      const data = await getAuth().api.signInEmail({ body: input });
      return json(await issueTokens(data.user.id, data.token));
    }
    if (segments[1] === 'refresh') {
      const input = await body(req, refreshInput);
      return json(await rotateTokens(input.refreshToken));
    }
    if (segments[1] === 'logout') {
      const actor = await identify(req.headers);
      if (!actor.familyId)
        throw new HttpError(
          400,
          'BEARER_REQUIRED',
          'Use the browser sign-out endpoint for cookie sessions',
        );
      await revokeFamily(actor.userId, actor.familyId);
      return json({ success: true });
    }
  }
  // Identity check for API clients: accepts a bearer access token or a session cookie.
  if (segments.length === 1 && segments[0] === 'me' && method === 'GET') {
    const actor = await identify(req.headers);
    await rateLimit(`api:${actor.userId}`, 120);
    return json({ userId: actor.userId, sessionId: actor.sessionId });
  }
  throw new HttpError(404, 'NOT_FOUND', 'Not found');
});
export const GET = run;
export const POST = run;
export const PATCH = run;
export const PUT = run;
export const DELETE = run;
