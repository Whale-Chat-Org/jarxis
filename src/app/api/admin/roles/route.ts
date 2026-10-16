import { body, handler, json } from '@/lib/http';
import { listRoles, roleInput } from '@/lib/custom-roles';
import { createCustomRole, requireRoleOwner, requireRoleReader } from '@/lib/custom-role-service';

export const runtime = 'nodejs';
export const GET = handler(async (req) => {
  await requireRoleReader(req);
  return json({ roles: await listRoles() });
});
export const POST = handler(async (req) => {
  const actorId = await requireRoleOwner(req);
  const role = await createCustomRole(actorId, await body(req, roleInput));
  return json({ role }, 201);
});
