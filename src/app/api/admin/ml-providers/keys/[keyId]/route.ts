import { handler, json } from '@/lib/http';
import { requireMlOwner } from '@/lib/ml/admin-auth';
import { revokeGatewayKey } from '@/lib/ml/service';

export const runtime = 'nodejs';
export const DELETE = handler<{ params: Promise<{ keyId: string }> }>(async (req, context) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  await revokeGatewayKey(actorId, (await context.params).keyId);
  return json({ success: true });
});
