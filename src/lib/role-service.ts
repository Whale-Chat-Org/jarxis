import 'server-only';

import { randomUUID } from 'node:crypto';
import { db, Prisma } from '@/db';
import { HttpError } from '@/lib/errors';
import { authorize, grants, identify } from '@/lib/rbac';
import { rateLimit } from '@/lib/redis';
import {
  assertCatalogued,
  isLockedRole,
  isSystemRole,
  newRoleKey,
  validateRoleInput,
  validateSystemRoleInput,
  type RoleInput,
} from '@/lib/roles';

const grantRows = (roleKey: string, permissions: string[]) =>
  permissions.map((permissionKey) => ({ roleKey, permissionKey }));

export async function requireRoleReader(req: Request) {
  if (req.headers.has('authorization'))
    throw new HttpError(401, 'SESSION_REQUIRED', 'Session required');
  const identity = await identify(req.headers);
  const current = await grants(identity.userId);
  if (!current.permissions.has('roles:read') && !current.permissions.has('users:read'))
    throw new HttpError(403, 'FORBIDDEN', 'Role access required');
}

export async function requireRoleOwner(req: Request) {
  if (req.headers.has('authorization'))
    throw new HttpError(401, 'SESSION_REQUIRED', 'Owner session required');
  const identity = await identify(req.headers);
  const session = await db.session.findFirst({
    where: { id: identity.sessionId, userId: identity.userId, impersonatedBy: null },
    select: { id: true },
  });
  if (!session) throw new HttpError(403, 'FORBIDDEN', 'Owner session required');
  const current = await authorize(identity, 'roles:update');
  if (!current.roles.includes('owner'))
    throw new HttpError(403, 'FORBIDDEN', 'Owner access required');
  await rateLimit(`role-management:${identity.userId}`, 60, 60);
  return identity.userId;
}

function duplicateName(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    throw new HttpError(409, 'ROLE_NAME_TAKEN', 'This role name is already in use');
  throw error;
}

export async function createRole(actorId: string, input: RoleInput) {
  const { permissions, ...data } = validateRoleInput(input);
  const key = newRoleKey();
  try {
    return await db.$transaction(async (tx) => {
      await assertCatalogued(permissions, tx);
      const role = await tx.role.create({ data: { key, ...data } });
      await tx.rolePermission.createMany({ data: grantRows(key, permissions) });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId,
          action: 'role.create',
          targetId: key,
          changes: { before: null, after: { name: role.name, permissions } },
        },
      });
      return { ...role, permissions };
    });
  } catch (error) {
    duplicateName(error);
  }
}

/** Custom roles change name, description and grants; Viewer and Administrator keep their name. */
export async function updateRole(actorId: string, key: string, input: RoleInput) {
  if (isLockedRole(key))
    throw new HttpError(403, 'SYSTEM_ROLE', 'This system role cannot be changed');
  const system = isSystemRole(key);
  const { permissions, ...data } = system
    ? validateSystemRoleInput(input)
    : validateRoleInput(input);
  try {
    return await db.$transaction(async (tx) => {
      const before = await tx.role.findUnique({
        where: { key },
        include: { permissions: { select: { permissionKey: true } } },
      });
      if (!before) throw new HttpError(404, 'ROLE_NOT_FOUND', 'Role not found');
      await assertCatalogued(permissions, tx);
      const role = await tx.role.update({ where: { key }, data });
      await tx.rolePermission.deleteMany({ where: { roleKey: key } });
      await tx.rolePermission.createMany({ data: grantRows(key, permissions) });
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId,
          action: 'role.update',
          targetId: key,
          changes: {
            before: {
              name: before.name,
              description: before.description,
              permissions: before.permissions.map((grant) => grant.permissionKey),
            },
            after: { name: role.name, description: role.description, permissions },
          },
        },
      });
      return { ...role, permissions };
    });
  } catch (error) {
    duplicateName(error);
  }
}

export async function deleteRole(actorId: string, key: string) {
  if (isSystemRole(key)) throw new HttpError(403, 'SYSTEM_ROLE', 'System roles cannot be deleted');
  return db.$transaction(async (tx) => {
    const before = await tx.role.findUnique({
      where: { key },
      include: { permissions: { select: { permissionKey: true } } },
    });
    if (!before) throw new HttpError(404, 'ROLE_NOT_FOUND', 'Role not found');
    const users = await tx.$queryRaw<
      [{ count: bigint }]
    >`SELECT count(*) AS count FROM app_user WHERE ${key} = ANY(string_to_array(replace(coalesce(role, ''), ' ', ''), ','))`;
    const count = Number(users[0]?.count ?? 0);
    if (count)
      throw new HttpError(
        409,
        'ROLE_IN_USE',
        `${count} user${count === 1 ? '' : 's'} must change role first`,
      );
    await tx.role.delete({ where: { key } });
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorId,
        action: 'role.delete',
        targetId: key,
        changes: {
          before: {
            name: before.name,
            permissions: before.permissions.map((grant) => grant.permissionKey),
          },
          after: null,
        },
      },
    });
  });
}
