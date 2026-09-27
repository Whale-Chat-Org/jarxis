import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  APIError,
  createAuthMiddleware,
  getAuthoritativeSessionFromCtx,
  isAPIError,
} from 'better-auth/api';
import { db } from '@/db';
import { parseRoles } from '@/lib/permissions';
import { isActiveUser } from '@/lib/user-status';

/**
 * Server-side guards for the Better Auth admin plugin's mutation endpoints.
 *
 * The plugin replaces `src/lib/admin-service.ts`, whose `adminWrite` helper reauthorized inside a
 * transaction under a PostgreSQL advisory lock. The plugin's endpoints cannot be wrapped that way,
 * so the equivalent rules run here:
 *
 * - `hooks.before` runs ahead of every matched endpoint with the endpoint context, so it can see
 *   the acting session **and** the target id, resolve the authoritative session, and throw to
 *   abort. This is where owner protection and the last-owner rule live.
 * - `databaseHooks` supply a defence-in-depth delete check and the ban side effects.
 * - `hooks.after` writes the audit record once the mutation has succeeded.
 *
 * Accepted trade-off: the checks run before the mutation without holding a lock, so a narrow
 * window exists between check and commit, and the audit row is written after commit rather than
 * atomically. See `.agent/rules/security.md`.
 */

/** Endpoints that mutate a user and therefore need owner/last-owner checks. */
const GUARDED_PATHS = new Set([
  '/admin/set-role',
  '/admin/update-user',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/remove-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
]);

/** Paths whose mutation always removes the target's access, so the owner count matters. */
const ACCESS_REMOVING_PATHS = new Set([
  '/admin/ban-user',
  '/admin/remove-user',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
]);

const AUDIT_ACTIONS: Record<string, string> = {
  '/admin/create-user': 'user.create',
  '/admin/update-user': 'user.update',
  '/admin/set-role': 'user.roles.replace',
  '/admin/set-user-password': 'user.password.set',
  '/admin/ban-user': 'user.ban',
  '/admin/unban-user': 'user.unban',
  '/admin/remove-user': 'user.delete',
  '/admin/revoke-user-session': 'user.session.revoke',
  '/admin/revoke-user-sessions': 'user.sessions.revoke',
  '/admin/impersonate-user': 'user.impersonate',
  '/admin/stop-impersonating': 'user.impersonate.stop',
};

type AdminUserRow = {
  id: string;
  role: string | null;
  banned: boolean;
  banExpires: Date | null;
  emailVerified: boolean;
};

function forbidden(message: string) {
  return new APIError('FORBIDDEN', { message, code: 'OWNER_PROTECTED' });
}

function conflict(message: string, code: string) {
  return new APIError('CONFLICT', { message, code });
}

async function findUser(userId: string): Promise<AdminUserRow | null> {
  return db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, banned: true, banExpires: true, emailVerified: true },
  });
}

/** Read the role off any user-shaped value (the session user type does not declare it). */
function roleOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const role = (value as { role?: unknown }).role;
  return typeof role === 'string' ? role : null;
}

function isOwner(value: unknown) {
  return parseRoles(roleOf(value)).includes('owner');
}

/** Count owners who can still sign in, so a lapsed or banned owner is not protected. */
async function activeOwnerIds(): Promise<string[]> {
  const candidates = await db.user.findMany({
    where: { emailVerified: true, role: { contains: 'owner' } },
    select: { id: true, role: true, banned: true, banExpires: true, emailVerified: true },
  });
  return candidates.filter((user) => isOwner(user) && isActiveUser(user)).map((user) => user.id);
}

/** The actor's authoritative session, or a 401. Mirrors the plugin's own admin middleware. */
async function requireActor(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) {
  const session = await getAuthoritativeSessionFromCtx(ctx);
  if (!session?.user) throw new APIError('UNAUTHORIZED', { message: 'Sign in required' });
  return session.user;
}

/** Target id from the request body, which every admin user endpoint names `userId`. */
function targetIdFrom(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as { userId?: unknown }).userId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Whether this request takes the target's owner access away. */
function removesOwnerAccess(path: string, body: unknown): boolean {
  if (ACCESS_REMOVING_PATHS.has(path)) return true;
  if (path !== '/admin/set-role') {
    if (path !== '/admin/update-user') return false;
    const data = (body as { data?: { banned?: unknown } } | undefined)?.data;
    return data?.banned === true;
  }
  const role = (body as { role?: unknown } | undefined)?.role;
  const requested = Array.isArray(role) ? role : [role];
  return !requested.includes('owner');
}

/** Whether this request bans the target (through either the ban endpoint or an update). */
function bansTarget(path: string, body: unknown): boolean {
  if (path === '/admin/ban-user') return true;
  if (path !== '/admin/update-user') return false;
  const data = (body as { data?: { banned?: unknown } } | undefined)?.data;
  return data?.banned === true;
}

/**
 * Owner protection and last-owner protection for every admin mutation.
 *
 * - Only an owner may modify another owner.
 * - The last active, verified owner cannot be demoted, banned, deleted or have their sessions
 *   revoked (which would lock them out just as effectively).
 * - `owner` can only be granted to an account that is verified and not banned.
 */
export const adminMutationGuard = createAuthMiddleware(async (ctx) => {
  const path = ctx.path ?? '';
  if (!GUARDED_PATHS.has(path) && path !== '/admin/set-role') return;

  const actor = await requireActor(ctx);
  const targetId = targetIdFrom(ctx.body);
  if (!targetId) return;

  const target = await findUser(targetId);
  if (!target) return; // Let the endpoint answer NOT_FOUND.

  const actorIsOwner = isOwner(actor);
  const targetIsOwner = isOwner(target);

  if (targetIsOwner && !actorIsOwner) throw forbidden('Only owners may modify an owner account');

  if (path === '/admin/set-role') {
    const role = (ctx.body as { role?: unknown }).role;
    const requested = (Array.isArray(role) ? role : [role]).map(String);
    const grantingOwner = requested.includes('owner');
    if (grantingOwner && !isActiveUser(target))
      throw conflict('An owner must be active and verified', 'INACTIVE_OWNER');
  }

  if (!targetIsOwner) return;

  const removingAccess = removesOwnerAccess(path, ctx.body) || bansTarget(path, ctx.body);
  if (!removingAccess) return;

  const owners = await activeOwnerIds();
  if (owners.length <= 1 && owners.includes(target.id))
    throw conflict('The last active owner cannot be removed or disabled', 'LAST_OWNER');
});

/**
 * Ban side effect: revoke the user's refresh-token families.
 *
 * The plugin already deletes their sessions, but a live token family would let a banned account
 * mint a new bearer token.
 */
export const userStatusHooks = {
  update: {
    after: async (user: { id: string } & Record<string, unknown>) => {
      if (user.banned !== true) return;
      await db.tokenFamily.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  },
  delete: {
    // Defence in depth: the request-level guard already covers the admin endpoints, but a delete
    // that reaches the adapter by another route must still respect owner protection.
    before: async (user: { id: string } & Record<string, unknown>, context: unknown) => {
      if (!isOwner(user)) return;
      const sessionUser =
        context && typeof context === 'object'
          ? (context as { context?: { session?: { user?: unknown } } }).context?.session?.user
          : undefined;
      if (!isOwner(sessionUser)) throw forbidden('Only owners may delete an owner account');
      const owners = await activeOwnerIds();
      if (owners.length <= 1 && owners.includes(user.id))
        throw conflict('The last active owner cannot be deleted', 'LAST_OWNER');
    },
  },
};

/** Only these request-body fields ever reach the audit log — never passwords or tokens. */
function auditChanges(path: string, body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const source = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (source.role !== undefined) out.role = source.role;
  if (source.banReason !== undefined) out.banReason = source.banReason;
  if (source.banExpiresIn !== undefined) out.banExpiresIn = source.banExpiresIn;
  if (path === '/admin/unban-user') out.banned = false;
  if (path === '/admin/remove-user' || path === '/admin/impersonate-user') out.confirmed = true;
  const data = source.data;
  if (data && typeof data === 'object') {
    for (const key of ['name', 'email', 'emailVerified', 'banned', 'banReason', 'banExpires']) {
      const value = (data as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

/**
 * Audit every successful admin mutation.
 *
 * A failure here must not turn a committed mutation into a 500, so it is logged and swallowed.
 */
export const adminAuditHook = createAuthMiddleware(async (ctx) => {
  const path = ctx.path ?? '';
  const action = AUDIT_ACTIONS[path];
  if (!action) return;
  if (isAPIError(ctx.context.returned)) return;

  try {
    const session = await getAuthoritativeSessionFromCtx(ctx);
    const actorId = session?.user?.id ?? 'unknown';
    const targetId = targetIdFrom(ctx.body) ?? actorId;
    await db.auditLog.create({
      data: {
        id: randomUUID(),
        actorId,
        action,
        targetId,
        changes: {
          path,
          ...auditChanges(path, ctx.body),
        },
      },
    });
  } catch (error) {
    ctx.context.logger.error('Admin audit record failed', error);
  }
});
