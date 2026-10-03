import { handler, json } from '@/lib/http';
import { requireMlOwner } from '@/lib/ml/admin-auth';
import { startLogin } from '@/lib/ml/service';

export const runtime = 'nodejs';
export const POST = handler<{ params: Promise<{ id: string }> }>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  return json({ job: await startLogin(actorId, (await context.params).id) }, 201);
});
