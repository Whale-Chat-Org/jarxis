import { body, handler, json } from '@/lib/http';
import { requireProviderOwner } from '@/lib/providers/admin-auth';
import { issueGatewayKey, queryGatewayKeys } from '@/lib/providers/service';
import { gatewayKeySchema, gatewayKeyListQuerySchema } from '@/lib/providers/validation';

export const runtime = 'nodejs';
export const POST = handler(async (req) => {
  const actorId = await requireProviderOwner(req, 'providers:manage');
  const value = await body(req, gatewayKeySchema);
  return json(await issueGatewayKey(actorId, value.name), 201);
});

export const GET = handler(async (req) => {
  await requireProviderOwner(req, 'providers:read');
  const input = gatewayKeyListQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json(await queryGatewayKeys(input));
});
