import type { db as Db } from '@/db';
import {
  adminPermissionCatalog,
  flattenStatements,
  lockedRoles,
  permissionCatalog,
  restrictedPermissions,
  roleCatalog,
  roleNames,
  roles,
} from '@/lib/permissions';

/**
 * Bring the `permissions` and system `roles` rows in line with `src/lib/permissions.ts`.
 *
 * Idempotent. Catalog descriptions and owner-only flags always follow code, and permissions no
 * longer declared are removed (their grants cascade). Owner and User grants are reset to code;
 * Viewer and Administrator receive their default grants only when first created, so an owner's
 * edits survive every deploy. Custom roles are never touched. `reset` also restores Viewer and
 * Administrator to their code description and grants (development and tests only).
 */
export async function seedRbac(db: typeof Db, { reset = false }: { reset?: boolean } = {}) {
  const catalog = Object.entries({ ...permissionCatalog, ...adminPermissionCatalog });
  return db.$transaction(async (tx) => {
    for (const [key, description] of catalog) {
      const restricted = restrictedPermissions.has(key);
      await tx.permission.upsert({
        where: { key },
        create: { key, description, restricted },
        update: { description, restricted },
      });
    }
    const removed = await tx.permission.deleteMany({
      where: { key: { notIn: catalog.map(([key]) => key) } },
    });

    const created: string[] = [];
    for (const key of roleNames) {
      const { name, description } = roleCatalog[key];
      const existing = await tx.role.findUnique({ where: { key }, select: { key: true } });
      if (existing) {
        await tx.role.update({
          where: { key },
          data: {
            name,
            normalizedName: name.toLocaleLowerCase('en-US'),
            system: true,
            ...(reset ? { description } : {}),
          },
        });
      } else {
        await tx.role.create({
          data: {
            key,
            name,
            normalizedName: name.toLocaleLowerCase('en-US'),
            description,
            system: true,
          },
        });
        created.push(key);
      }
      const locked = (lockedRoles as readonly string[]).includes(key);
      if (!existing || locked || reset) {
        await tx.rolePermission.deleteMany({ where: { roleKey: key } });
        await tx.rolePermission.createMany({
          data: flattenStatements(roles[key]).map((permissionKey) => ({
            roleKey: key,
            permissionKey,
          })),
        });
      }
    }
    // An editable role must never hold an owner-only grant, whatever an earlier release stored.
    await tx.rolePermission.deleteMany({
      where: {
        roleKey: { notIn: [...lockedRoles] },
        permissionKey: { in: [...restrictedPermissions] },
      },
    });
    return {
      permissions: catalog.length,
      removedPermissions: removed.count,
      createdRoles: created,
    };
  });
}
