import { resendInitialOwnerSetup } from '@/lib/initial-owner-setup';
import { body, handler, json } from '@/lib/http';
import { rateLimit, requestIP } from '@/lib/redis';
import { setupResendInput } from '@/lib/setup-validation';

/**
 * Public first-owner setup: send a new code for a pending request.
 *
 * Issuing a new code invalidates the previous one and resets the attempt counter, so this is also
 * the recovery path when the first delivery failed. Limited per IP before the body is parsed, and
 * per request by a 60-second cooldown.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (req) => {
  await rateLimit(`setup-resend:${requestIP(req.headers)}`, 5, 300);
  const input = await body(req, setupResendInput);
  return json(await resendInitialOwnerSetup(input), 202);
});
