import { db, type Transaction } from '@/db';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import 'server-only';
import { getAuth } from './auth';
import { HttpError } from './errors';
import { flattenStatements, isAllowed, parseRoles, roles, type Permission } from './permissions';
import { parseRoleKeys } from './role-keys';
import { effectivePermissions, isSystemRole } from './roles';
import { verifyAccess } from './tokens';
export type Identity = { userId: string; sessionId: string; familyId?: string };

/**
 * Prisma fragment for "usable account": email verified and not under an active ban.
 *
 * `banExpires` in the past means the ban has lapsed, so such an account is active again even
 * though `banned` is still true. Returning a fresh object matters — the comparison uses `now`.
 */
export function activeUserWhere() {
  return {
    emailVerified: true,
    OR: [{ banned: false }, { banExpires: { lt: new Date() } }],
  };
}

export async function identify(requestHeaders: Headers): Promise<Identity> {
  const bearer = requestHeaders.get('authorization');
  if (bearer) {
    if (!bearer.startsWith('Bearer '))
      throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
    return verifyAccess(bearer.slice(7));
  }
  const data = await getAuth().api.getSession({ headers: requestHeaders });
  if (!data) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
  // Database remains authoritative even if an upstream session implementation caches.
  const session = await db.session.findFirst({
    where: {
      id: data.session.id,
      expiresAt: { gt: new Date() },
      user: activeUserWhere(),
    },
    select: { id: true, userId: true },
  });
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
  return { userId: session.userId, sessionId: session.id };
}

/**
 * Resolve a user's role names and the permissions they grant.
 *
 * Owner and User grants come from code; Viewer, Administrator and custom roles come from the
 * `role_permissions` table. An editable system role missing from an unseeded database falls back
 * to its code grant, and an unknown key resolves to nothing, which fails closed.
 */
export async function grants(userId: string, connection: typeof db | Transaction = db) {
  const user = await connection.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const raw = parseRoleKeys(user?.role);
  const stored = await connection.role.findMany({
    where: { key: { in: raw } },
    select: { key: true, system: true, permissions: { select: { permissionKey: true } } },
  });
  const byKey = new Map(stored.map((role) => [role.key, role]));
  const system = parseRoles(user?.role);
  const custom = stored.filter((role) => !isSystemRole(role.key));
  return {
    roles: [...system, ...custom.map((role) => role.key)],
    permissions: new Set([
      ...system.flatMap((name) => {
        const row = byKey.get(name);
        return row ? effectivePermissions(row) : flattenStatements(roles[name]);
      }),
      ...custom.flatMap((role) => effectivePermissions(role)),
    ]),
  };
}
export async function authorize(
  identity: Identity,
  permission: Permission,
  connection: typeof db | Transaction = db,
) {
  const active = await connection.session.findFirst({
    where: {
      id: identity.sessionId,
      userId: identity.userId,
      expiresAt: { gt: new Date() },
      user: activeUserWhere(),
    },
    select: { id: true },
  });
  if (!active) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
  const currentGrants = await grants(identity.userId, connection);
  if (!isAllowed(currentGrants.permissions, currentGrants.roles, permission))
    throw new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action');
  return currentGrants;
}
const pageIdentity = cache(async () => identify(await headers()));
export const pageGrants = cache(async () => {
  const identity = await pageIdentity();
  return { ...identity, ...(await grants(identity.userId)) };
});
export async function requirePage(permission: Permission) {
  try {
    const identity = await pageIdentity();
    await authorize(identity, permission);
    return { ...identity, ...(await pageGrants()) };
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect('/auth/sign-in');
    if (e instanceof HttpError && e.status === 403) redirect('/access-denied');
    throw e;
  }
}
