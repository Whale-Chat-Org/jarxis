import { handler, json } from '@/lib/http';
import { requireMlOwner } from '@/lib/ml/admin-auth';
import { scheduleRefresh } from '@/lib/ml/service';

export const runtime = 'nodejs';
export const POST = handler<{ params: Promise<{ id: string }> }>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  return json({ connection: await scheduleRefresh(actorId, (await context.params).id) });
});
