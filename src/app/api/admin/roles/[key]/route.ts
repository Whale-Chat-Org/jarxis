import { body, handler, json } from '@/lib/http';
import { roleInput } from '@/lib/roles';
import { deleteRole, requireRoleOwner, updateRole } from '@/lib/role-service';

export const runtime = 'nodejs';
type Context = { params: Promise<{ key: string }> };
export const PATCH = handler(async (req, context: Context) => {
  const actorId = await requireRoleOwner(req);
  const { key } = await context.params;
  const role = await updateRole(actorId, key, await body(req, roleInput));
  return json({ role });
});
export const DELETE = handler(async (req, context: Context) => {
  const actorId = await requireRoleOwner(req);
  const { key } = await context.params;
  await deleteRole(actorId, key);
  return json({ deleted: true });
});
