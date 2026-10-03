import { handler, body, json } from '@/lib/http';
import { requireMlOwner } from '@/lib/ml/admin-auth';
import { deleteConnection, updateConnection } from '@/lib/ml/service';
import { updateConnectionSchema } from '@/lib/ml/validation';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export const PATCH = handler<Context>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  return json({
    connection: await updateConnection(
      actorId,
      (await context.params).id,
      await body(req, updateConnectionSchema),
    ),
  });
});
export const DELETE = handler<Context>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  await deleteConnection(actorId, (await context.params).id);
  return json({ success: true });
});
