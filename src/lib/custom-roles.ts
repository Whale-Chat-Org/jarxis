import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/db';
import {
  ac,
  adminPermissionCatalog,
  ownerOnly,
  permissionCatalog,
  roleCatalog,
  roleNames,
  roles,
} from '@/lib/permissions';
import { HttpError } from '@/lib/errors';

const forbiddenGrants = new Set<string>([
  ...ownerOnly,
  'user:delete',
  'user:set-role',
  'user:impersonate-admins',
]);
const knownGrants = new Set<string>([
  ...Object.keys(permissionCatalog),
  ...Object.keys(adminPermissionCatalog),
]);
const reservedNames = new Set<string>(roleNames);
const roleContext = new AsyncLocalStorage<Record<string, (typeof roles)['user']>>();

export const roleInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Role name must be at least 2 characters')
    .max(64, 'Role name must be 64 characters or fewer'),
  description: z.string().trim().max(500, 'Description must be 500 characters or fewer'),
  permissions: z.array(z.string()).max(50, 'A role can have at most 50 permissions'),
});

export type RoleInput = z.infer<typeof roleInput>;

export function validateRoleInput(input: RoleInput) {
  const normalizedName = input.name.toLocaleLowerCase('en-US');
  if (reservedNames.has(normalizedName))
    throw new HttpError(409, 'ROLE_NAME_TAKEN', 'This role name is already in use');
  const permissions = [...new Set(input.permissions)];
  if (permissions.some((key) => !knownGrants.has(key) || forbiddenGrants.has(key)))
    throw new HttpError(400, 'INVALID_PERMISSION', 'This role contains an unavailable permission');
  return { ...input, normalizedName, permissions };
}

export function storedPermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (key): key is string =>
      typeof key === 'string' && knownGrants.has(key) && !forbiddenGrants.has(key),
  );
}

/** Users per custom role key; built-in roles are not counted because they can't be deleted. */
async function customRoleUserCounts() {
  const users = await db.user.findMany({
    where: { role: { contains: 'custom_' } },
    select: { role: true },
  });
  const counts = new Map<string, number>();
  for (const { role } of users)
    for (const key of new Set(role?.split(',').map((value) => value.trim())))
      if (key.startsWith('custom_')) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

export async function listRoles() {
  const [custom, counts] = await Promise.all([
    db.customRole.findMany({ orderBy: { name: 'asc' } }),
    customRoleUserCounts(),
  ]);
  return [
    ...roleNames.map((key) => ({
      key,
      name: roleCatalog[key].name,
      description: roleCatalog[key].description,
      permissions: Object.entries(roles[key].statements).flatMap(([resource, actions]) =>
        (actions as readonly string[]).map((action) => `${resource}:${action}`),
      ),
      system: true,
    })),
    ...custom.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: storedPermissions(role.permissions),
      system: false,
      userCount: counts.get(role.key) ?? 0,
    })),
  ];
}

export async function loadLiveRoles() {
  const custom = await db.customRole.findMany({ select: { key: true, permissions: true } });
  return Object.fromEntries(
    custom.map(({ key, permissions }) => {
      const statements: Record<string, string[]> = {};
      for (const grant of storedPermissions(permissions)) {
        const [resource, action] = grant.split(':');
        (statements[resource] ??= []).push(action);
      }
      return [key, ac.newRole(statements)];
    }),
  ) as Record<string, (typeof roles)['user']>;
}

/** Better Auth calls role.authorize synchronously; the proxy resolves the current request snapshot. */
export const liveAdminRoles = new Proxy(roles as Record<string, (typeof roles)['user']>, {
  get(target, key) {
    if (typeof key !== 'string') return undefined;
    const current = roleContext.getStore();
    if (current && Object.hasOwn(current, key)) return current[key];
    return Object.hasOwn(target, key) ? target[key] : undefined;
  },
});

export async function withLiveAdminRoles<T>(run: () => Promise<T>): Promise<T> {
  return roleContext.run(await loadLiveRoles(), run);
}

export function newRoleKey() {
  return `custom_${randomUUID()}`;
}
