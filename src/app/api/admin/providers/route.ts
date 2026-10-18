import { body, handler, json } from '@/lib/http';
import { requireProviderOwner } from '@/lib/providers/admin-auth';
import { refreshConnection } from '@/lib/providers/discovery';
import {
  createConnection,
  getConnection,
  listConnections,
  listGatewayKeys,
} from '@/lib/providers/service';
import { createConnectionSchema } from '@/lib/providers/validation';

export const runtime = 'nodejs';
export const GET = handler(async (req) => {
  await requireProviderOwner(req, 'providers:read');
  const [connections, keys] = await Promise.all([listConnections(), listGatewayKeys()]);
  return json({ connections, keys });
});
export const POST = handler(async (req) => {
  const actorId = await requireProviderOwner(req, 'providers:manage');
  const created = await createConnection(actorId, await body(req, createConnectionSchema), true);
  // Only keyed connections fetch a catalog here.
  if (created.status !== 'ready') return json({ connection: created }, 201);
  // The connection is committed; a discovery failure is recorded on it, not returned as an error.
  try {
    await refreshConnection(created.id, true);
    return json({ connection: await getConnection(created.id) }, 201);
  } catch {
    return json({ connection: created }, 201);
  }
});
