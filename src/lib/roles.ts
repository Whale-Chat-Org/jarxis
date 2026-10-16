import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Transaction } from '@/db';
import {
  ac,
  adminPermissionCatalog,
  flattenStatements,
  lockedRoles,
  permissionCatalog,
  restrictedPermissions,
  roleCatalog,
  roleNames,
  roles,
  type RoleName,
} from '@/lib/permissions';
import { HttpError } from '@/lib/errors';

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

export const isSystemRole = (key: string): key is RoleName =>
  (roleNames as readonly string[]).includes(key);
export const isLockedRole = (key: string) => (lockedRoles as readonly string[]).includes(key);

/** Grant set of a locked system role, which always comes from code. */
const codeGrants = (key: RoleName) => flattenStatements(roles[key]);

/** Grants an editable role may hold: catalogued and not owner-only. */
function assertGrantable(permissions: string[]) {
  const unique = [...new Set(permissions)];
  if (unique.some((key) => !knownGrants.has(key) || restrictedPermissions.has(key)))
    throw new HttpError(400, 'INVALID_PERMISSION', 'This role contains an unavailable permission');
  return unique;
}

export function validateRoleInput(input: RoleInput) {
  const normalizedName = input.name.toLocaleLowerCase('en-US');
  if (reservedNames.has(normalizedName))
    throw new HttpError(409, 'ROLE_NAME_TAKEN', 'This role name is already in use');
  return { ...input, normalizedName, permissions: assertGrantable(input.permissions) };
}

/** System roles keep their name; only the description and grants change. */
export function validateSystemRoleInput(input: RoleInput) {
  return { description: input.description, permissions: assertGrantable(input.permissions) };
}

/** Drops keys that are unknown to code or owner-only, so a tampered row can never escalate. */
export function storedPermissions(keys: readonly string[]): string[] {
  return keys.filter((key) => knownGrants.has(key) && !restrictedPermissions.has(key));
}

/** The database must still list every requested grant as a non-restricted permission. */
export async function assertCatalogued(
  permissions: string[],
  connection: typeof db | Transaction = db,
) {
  if (!permissions.length) return;
  const found = await connection.permission.count({
    where: { key: { in: permissions }, restricted: false },
  });
  if (found !== permissions.length)
    throw new HttpError(400, 'INVALID_PERMISSION', 'This role contains an unavailable permission');
}

type StoredRole = { key: string; system: boolean; permissions: { permissionKey: string }[] };

/** Effective grants of a stored role: code for locked roles, the join table for the rest. */
export function effectivePermissions(role: StoredRole) {
  if (isSystemRole(role.key) && isLockedRole(role.key)) return codeGrants(role.key);
  return storedPermissions(role.permissions.map((grant) => grant.permissionKey));
}

/** Users per role key; an empty `role` column counts as the default `user` role. */
async function roleUserCounts() {
  const rows = await db.$queryRaw<{ key: string; count: bigint }[]>`
    SELECT btrim(value) AS key, count(*) AS count
    FROM app_user, unnest(string_to_array(coalesce(nullif(role, ''), 'user'), ',')) AS value
    GROUP BY 1`;
  return new Map(rows.map((row) => [row.key, Number(row.count)]));
}

export async function listRoles() {
  const [stored, counts] = await Promise.all([
    db.role.findMany({
      include: { permissions: { select: { permissionKey: true } } },
      orderBy: { name: 'asc' },
    }),
    roleUserCounts(),
  ]);
  const byKey = new Map(stored.map((role) => [role.key, role]));
  // System roles first in their declared order; one missing from an unseeded database falls back
  // to its code definition so the page never hides it.
  const system = roleNames.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      name: roleCatalog[key].name,
      description: row?.description ?? roleCatalog[key].description,
      permissions: row ? effectivePermissions(row) : codeGrants(key),
      system: true,
      editable: !isLockedRole(key),
      userCount: counts.get(key) ?? 0,
    };
  });
  const custom = stored
    .filter((role) => !role.system && !isSystemRole(role.key))
    .map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: effectivePermissions(role),
      system: false,
      editable: true,
      userCount: counts.get(role.key) ?? 0,
    }));
  return [...system, ...custom];
}

/** Better Auth role objects for every editable stored role (custom roles, Viewer, Administrator). */
export async function loadLiveRoles() {
  const stored = await db.role.findMany({
    where: { key: { notIn: [...lockedRoles] } },
    select: { key: true, system: true, permissions: { select: { permissionKey: true } } },
  });
  return Object.fromEntries(
    stored.map((role) => {
      const statements: Record<string, string[]> = {};
      for (const grant of effectivePermissions(role)) {
        const [resource, action] = grant.split(':');
        (statements[resource] ??= []).push(action);
      }
      return [role.key, ac.newRole(statements)];
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

/**
 * The permission catalog from the `permissions` table, in code-declared order. Before the first
 * seed the table is empty, so the code catalog is used instead.
 */
export async function listPermissions() {
  const order = [...knownGrants];
  const rows = await db.permission.findMany({
    select: { key: true, description: true, restricted: true },
  });
  const entries = rows.length
    ? rows
    : order.map((key) => ({
        key,
        description: { ...permissionCatalog, ...adminPermissionCatalog }[key] ?? key,
        restricted: restrictedPermissions.has(key),
      }));
  return entries.toSorted((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}
