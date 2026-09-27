import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { authorize, grants, type Identity } from '@/lib/rbac';
import { userStatusHooks } from '@/lib/auth/admin-guards';
import { issueTokens, rotateTokens, verifyAccess, tokenHash } from '@/lib/tokens';
import { SignJWT } from 'jose';
import { env } from '@/lib/env';
import type { RoleName } from '@/lib/permissions';

async function makeUser(
  role?: RoleName,
  extra: { banned?: boolean; banExpires?: Date; emailVerified?: boolean } = {},
): Promise<Identity & { sessionToken: string }> {
  const id = randomUUID(),
    sid = randomUUID(),
    token = randomUUID();
  await db.user.create({
    data: {
      id,
      name: 'Test User',
      email: `${id}@example.test`,
      emailVerified: extra.emailVerified ?? true,
      role: role ?? null,
      banned: extra.banned ?? false,
      banExpires: extra.banExpires ?? null,
    },
  });
  await db.session.create({
    data: { id: sid, userId: id, token, expiresAt: new Date(Date.now() + 30 * 86400000) },
  });
  return { userId: id, sessionId: sid, sessionToken: token };
}

/** A minimal endpoint-context stand-in for the database hook's actor lookup. */
function contextFor(actor: { id: string; role: string } | null) {
  return { context: { session: actor ? { user: actor } : undefined } };
}

beforeAll(async () => {
  // Roles are code-declared; nothing to seed. Fail fast if the database is unreachable.
  await db.$queryRaw`SELECT 1`;
});
beforeEach(async () => {
  await db.$executeRaw`TRUNCATE app_user, audit_logs CASCADE`;
});
afterAll(async () => {
  await db.$disconnect();
});

describe('role-based access control', () => {
  it('denies accounts with no role and grants exactly what the role declares', async () => {
    const none = await makeUser();
    await expect(authorize(none, 'users:read')).rejects.toMatchObject({ status: 403 });
    expect((await grants(none.userId)).permissions.size).toBe(0);

    const viewer = await makeUser('viewer');
    expect((await grants(viewer.userId)).permissions.has('users:read')).toBe(true);
    expect((await grants(viewer.userId)).permissions.has('users:update')).toBe(false);
    await expect(authorize(viewer, 'users:read')).resolves.toMatchObject({
      roles: ['viewer'],
    });
    await expect(authorize(viewer, 'users:update')).rejects.toMatchObject({ status: 403 });
  });

  it('requires owner membership for owner-only permissions', async () => {
    const admin = await makeUser('administrator');
    expect((await grants(admin.userId)).permissions.has('roles:update')).toBe(false);
    await expect(authorize(admin, 'roles:update')).rejects.toMatchObject({ status: 403 });

    const owner = await makeUser('owner');
    await expect(authorize(owner, 'roles:update')).resolves.toBeDefined();
  });

  it('ignores role names that are no longer declared', async () => {
    const stale = await makeUser();
    await db.user.update({
      where: { id: stale.userId },
      data: { role: 'custom-role-not-in-code' },
    });
    const g = await grants(stale.userId);
    expect(g.roles).toEqual([]);
    expect(g.permissions.size).toBe(0);
    await expect(authorize(stale, 'users:read')).rejects.toMatchObject({ status: 403 });
  });

  it('sees a role change on the next request', async () => {
    const target = await makeUser('viewer');
    await expect(authorize(target, 'users:read')).resolves.toBeDefined();
    await db.user.update({ where: { id: target.userId }, data: { role: 'user' } });
    await expect(authorize(target, 'users:read')).rejects.toMatchObject({ status: 403 });
  });
});

describe('ban state is authoritative', () => {
  it('rejects a banned account even with a live session', async () => {
    const viewer = await makeUser('viewer');
    await db.user.update({ where: { id: viewer.userId }, data: { banned: true } });
    await expect(authorize(viewer, 'users:read')).rejects.toMatchObject({ status: 401 });
  });

  it('treats a lapsed ban as active again', async () => {
    const viewer = await makeUser('viewer');
    await db.user.update({
      where: { id: viewer.userId },
      data: { banned: true, banExpires: new Date(Date.now() - 60_000) },
    });
    await expect(authorize(viewer, 'users:read')).resolves.toBeDefined();
  });

  it('treats a permanent ban as active', async () => {
    const viewer = await makeUser('viewer');
    await db.user.update({
      where: { id: viewer.userId },
      data: { banned: true, banExpires: null },
    });
    await expect(authorize(viewer, 'users:read')).rejects.toMatchObject({ status: 401 });
  });

  it('revokes token families when the ban hook fires', async () => {
    const target = await makeUser('viewer');
    const tokens = await issueTokens(target.userId, target.sessionToken);
    await db.user.update({ where: { id: target.userId }, data: { banned: true } });
    await userStatusHooks.update.after({ id: target.userId, banned: true });
    expect((await db.tokenFamily.findMany())[0].revokedAt).not.toBeNull();
    await expect(verifyAccess(tokens.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(rotateTokens(tokens.refreshToken)).rejects.toMatchObject({ status: 401 });
  });
});

describe('owner protection', () => {
  it('refuses to delete an owner on behalf of a non-owner', async () => {
    const admin = await makeUser('administrator');
    const owner = await makeUser('owner');
    await expect(
      userStatusHooks.delete.before(
        { id: owner.userId, role: 'owner' },
        contextFor({ id: admin.userId, role: 'administrator' }),
      ),
    ).rejects.toMatchObject({ body: { code: 'OWNER_PROTECTED' } });
  });

  it('refuses to delete the last active owner, even by an owner', async () => {
    const owner = await makeUser('owner');
    await expect(
      userStatusHooks.delete.before(
        { id: owner.userId, role: 'owner' },
        contextFor({ id: owner.userId, role: 'owner' }),
      ),
    ).rejects.toMatchObject({ body: { code: 'LAST_OWNER' } });
  });

  it('allows deleting an owner once another active owner exists', async () => {
    const first = await makeUser('owner');
    const second = await makeUser('owner');
    await expect(
      userStatusHooks.delete.before(
        { id: second.userId, role: 'owner' },
        contextFor({ id: first.userId, role: 'owner' }),
      ),
    ).resolves.toBeUndefined();
  });

  it('does not protect an owner who is already banned', async () => {
    const owner = await makeUser('owner', { banned: true });
    const other = await makeUser('owner');
    await expect(
      userStatusHooks.delete.before(
        { id: owner.userId, role: 'owner' },
        contextFor({ id: other.userId, role: 'owner' }),
      ),
    ).resolves.toBeUndefined();
  });

  it('leaves non-owner deletes alone', async () => {
    const admin = await makeUser('administrator');
    const target = await makeUser('viewer');
    await expect(
      userStatusHooks.delete.before(
        { id: target.userId, role: 'viewer' },
        contextFor({ id: admin.userId, role: 'administrator' }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('token lifecycle', () => {
  it('persists hashes only and rotates tokens', async () => {
    const u = await makeUser();
    const first = await issueTokens(u.userId, u.sessionToken);
    expect(await verifyAccess(first.accessToken)).toMatchObject({ userId: u.userId });
    const hashes = await db.refreshToken.findMany();
    expect(hashes[0].hash).toBe(tokenHash(first.refreshToken));
    expect(hashes[0].hash).not.toBe(first.refreshToken);
    const second = await rotateTokens(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.refreshExpiresAt).toBe(first.refreshExpiresAt);
  });
  it('commits family revocation after replay and rejects previously minted access', async () => {
    const u = await makeUser();
    const a = await issueTokens(u.userId, u.sessionToken);
    const b = await rotateTokens(a.refreshToken);
    await expect(rotateTokens(a.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(verifyAccess(b.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(rotateTokens(b.refreshToken)).rejects.toMatchObject({ status: 401 });
    expect((await db.tokenFamily.findMany())[0].revokedAt).not.toBeNull();
  });
  it('handles simultaneous refresh by revoking on reuse', async () => {
    const u = await makeUser();
    const a = await issueTokens(u.userId, u.sessionToken);
    const results = await Promise.allSettled([
      rotateTokens(a.refreshToken),
      rotateTokens(a.refreshToken),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(verifyAccess(a.accessToken)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects malformed and wrong-audience JWTs', async () => {
    await expect(verifyAccess('invalid')).rejects.toMatchObject({ status: 401 });
    const token = await new SignJWT({ sid: 'x', fid: 'y' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('x')
      .setIssuer(env().BETTER_AUTH_URL)
      .setAudience('wrong')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(env().JWT_SECRET));
    await expect(verifyAccess(token)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects tokens for a banned account', async () => {
    const u = await makeUser();
    const a = await issueTokens(u.userId, u.sessionToken);
    await db.user.update({ where: { id: u.userId }, data: { banned: true } });
    await expect(verifyAccess(a.accessToken)).rejects.toMatchObject({ status: 401 });
    await expect(rotateTokens(a.refreshToken)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects unverified accounts when issuing tokens', async () => {
    const u = await makeUser(undefined, { emailVerified: false });
    await expect(issueTokens(u.userId, u.sessionToken)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects deleted sessions and expired families', async () => {
    const u = await makeUser();
    const a = await issueTokens(u.userId, u.sessionToken);
    await db.tokenFamily.updateMany({ data: { expiresAt: new Date(0) } });
    await expect(rotateTokens(a.refreshToken)).rejects.toMatchObject({ status: 401 });
    await db.session.deleteMany({ where: { id: u.sessionId } });
    await expect(verifyAccess(a.accessToken)).rejects.toMatchObject({ status: 401 });
  });
});
