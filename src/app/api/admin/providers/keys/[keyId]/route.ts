import { gatewayKeySchema } from '@/lib/providers/validation';
import { body, handler, json } from '@/lib/http';
import { requireProviderOwner } from '@/lib/providers/admin-auth';
import { revokeGatewayKey, getGatewayKey, renameGatewayKey } from '@/lib/providers/service';

export const runtime = 'nodejs';
export const DELETE = handler<{ params: Promise<{ keyId: string }> }>(async (req, context) => {
  const actorId = await requireProviderOwner(req, 'providers:manage');
  await revokeGatewayKey(actorId, (await context.params).keyId);
  return json({ success: true });
});

export const GET = handler<{ params: Promise<{ keyId: string }> }>(async (req, context) => {
  await requireProviderOwner(req, 'providers:read');
  return json({ record: await getGatewayKey((await context.params).keyId) });
});
export const PATCH = handler<{ params: Promise<{ keyId: string }> }>(async (req, context) => {
  const actorId = await requireProviderOwner(req, 'providers:manage');
  const value = await body(req, gatewayKeySchema);
  return json({
    record: await renameGatewayKey(actorId, (await context.params).keyId, value.name),
  });
});
