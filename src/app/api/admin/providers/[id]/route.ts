import { body, handler, json } from '@/lib/http';
import { requireProviderOwner } from '@/lib/providers/admin-auth';
import { deleteConnection, updateConnection } from '@/lib/providers/service';
import { updateConnectionSchema } from '@/lib/providers/validation';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export const PATCH = handler<Context>(async (req, context) => {
  const actorId = await requireProviderOwner(req, 'providers:manage');
  return json({
    connection: await updateConnection(
      actorId,
      (await context.params).id,
      await body(req, updateConnectionSchema),
    ),
  });
});
export const DELETE = handler<Context>(async (req, context) => {
  const actorId = await requireProviderOwner(req, 'providers:manage');
  await deleteConnection(actorId, (await context.params).id);
  return json({ success: true });
});
