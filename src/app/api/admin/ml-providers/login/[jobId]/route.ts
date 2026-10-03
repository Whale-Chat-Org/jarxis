import { handler, body, json } from '@/lib/http';
import { requireMlOwner } from '@/lib/ml/admin-auth';
import { getLogin, submitLogin, cancelLogin } from '@/lib/ml/service';
import { loginInputSchema } from '@/lib/ml/validation';

export const runtime = 'nodejs';
type Context = { params: Promise<{ jobId: string }> };
export const GET = handler<Context>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:read');
  return json({ job: await getLogin(actorId, (await context.params).jobId) });
});
export const POST = handler<Context>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  const value = await body(req, loginInputSchema);
  return json({ job: await submitLogin(actorId, (await context.params).jobId, value.input) });
});
export const PATCH = POST;
export const DELETE = handler<Context>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  return json({ job: await cancelLogin(actorId, (await context.params).jobId) });
});
