import { handler, body, json } from '@/lib/http';
import { requireMlOwner } from '@/lib/ml/admin-auth';
import { issueGatewayKey } from '@/lib/ml/service';
import { gatewayKeySchema } from '@/lib/ml/validation';

export const runtime = 'nodejs';
export const POST = handler(async (req) => {
  const actorId = await requireMlOwner(req, 'providers:manage');
  const value = await body(req, gatewayKeySchema);
  return json(await issueGatewayKey(actorId, value.name), 201);
});
