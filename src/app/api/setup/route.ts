import { body, handler, json } from '@/lib/http';
import { ensureInitialOwnerSetupStatus, startInitialOwnerSetup } from '@/lib/initial-owner-setup';
import { rateLimit, requestIP } from '@/lib/redis';
import { setupInput } from '@/lib/setup-validation';

/**
 * Public first-owner setup, step one.
 *
 * `GET` reports whether the flow is open so the UI can route; `POST` creates the unverified
 * candidate owner and emails a six-digit code. The rate limit is applied per source IP *before*
 * the body is read or parsed, so malformed or oversized requests cannot buy free attempts. The
 * response never contains the code, its digest or the password.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (req) => {
  await rateLimit(`setup-status:${requestIP(req.headers)}`, 30, 60);
  return json({ status: await ensureInitialOwnerSetupStatus() });
});

export const POST = handler(async (req) => {
  await rateLimit(`setup-start:${requestIP(req.headers)}`, 5, 300);
  const input = await body(req, setupInput);
  const started = await startInitialOwnerSetup(input);
  return json(started, 202);
});
