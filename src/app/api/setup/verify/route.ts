import { verifyInitialOwnerSetup } from '@/lib/initial-owner-setup';
import { body, handler, json } from '@/lib/http';
import { rateLimit, requestIP } from '@/lib/redis';
import { setupVerifyInput } from '@/lib/setup-validation';

/**
 * Public first-owner setup, step two: present the emailed code.
 *
 * The per-IP limit runs before the body is parsed and sits on top of the per-request attempt
 * counter, so neither a single request nor a spread of guesses gets unlimited tries.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (req) => {
  await rateLimit(`setup-verify:${requestIP(req.headers)}`, 10, 300);
  const input = await body(req, setupVerifyInput);
  const owner = await verifyInitialOwnerSetup(input);
  return json({ success: true, owner: { id: owner.id, name: owner.name, email: owner.email } });
});
