import { handler, body, json } from '@/lib/http';
import { requireMlOwner } from '@/lib/ml/admin-auth';
import { addManualModel, updateModelStates } from '@/lib/ml/service';
import { manualModelSchema, updateModelStatesSchema } from '@/lib/ml/validation';

export const runtime = 'nodejs';
export const POST = handler<{ params: Promise<{ id: string }> }>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  const input = await body(req, manualModelSchema);
  return json(
    { connection: await addManualModel(actorId, (await context.params).id, input.upstreamId) },
    201,
  );
});

export const PATCH = handler<{ params: Promise<{ id: string }> }>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  const input = await body(req, updateModelStatesSchema);
  return json({ connection: await updateModelStates(actorId, (await context.params).id, input) });
});
