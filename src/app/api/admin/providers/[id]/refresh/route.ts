import { handler, json } from '@/lib/http';
import { requireProviderOwner } from '@/lib/providers/admin-auth';
import { refreshProviderConnection } from '@/lib/providers/service';

export const runtime = 'nodejs';
export const POST = handler<{ params: Promise<{ id: string }> }>(async (req, context) => {
  const actorId = await requireProviderOwner(req, 'providers:manage');
  return json({ connection: await refreshProviderConnection(actorId, (await context.params).id) });
});
