import { db } from '@/db';
import {
  adminPermissionCatalog,
  permissionCatalog,
  restrictedPermissions,
} from '@/lib/permissions';
import { authorize, grants } from '@/lib/rbac';
import { seedRbac } from '@/lib/rbac-seed';
import { createRole, deleteRole, updateRole } from '@/lib/role-service';
import { listRoles } from '@/lib/roles';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetRoles } from './reset-roles';

beforeEach(async () => {
  await resetRoles();
});
afterEach(async () => {
  await resetRoles();
});
afterAll(async () => {
  await db.$disconnect();
});

describe('stored role lifecycle', () => {
  it('uses matching whitespace/deduplication rules in counts and both database triggers', async () => {
    const role = await createRole('fixture-actor', {
      name: 'Whitespace role',
      description: '',
      permissions: ['audit:read'],
    });
    const id = randomUUID();
    await db.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        name: 'Whitespace member',
        role: `\t${role.key}\n, ${role.key} ,`,
        emailVerified: true,
      },
    });
    expect((await listRoles()).find((entry) => entry.key === role.key)?.userCount).toBe(1);
    await expect(deleteRole('fixture-actor', role.key)).rejects.toMatchObject({
      code: 'ROLE_IN_USE',
    });
    await expect(db.role.delete({ where: { key: role.key } })).rejects.toThrow();
    await expect(
      db.user.update({ where: { id }, data: { role: '\tcustom_missing\n' } }),
    ).rejects.toThrow();
    await db.user.update({ where: { id }, data: { role: null } });
    expect((await listRoles()).find((entry) => entry.key === 'user')?.userCount).toBe(0);
  });
  it('applies edits on the next request, keeps the key on rename, and refuses deletion in use', async () => {
    const actorId = randomUUID();
    const memberId = randomUUID();
    await db.user.createMany({
      data: [
        {
          id: actorId,
          name: 'Owner',
          email: `${actorId}@example.test`,
          emailVerified: true,
          role: 'owner',
        },
        {
          id: memberId,
          name: 'Member',
          email: `${memberId}@example.test`,
          emailVerified: true,
          role: 'user',
        },
      ],
    });
    const sessionId = randomUUID();
    await db.session.create({
      data: {
        id: sessionId,
        userId: memberId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const role = await createRole(actorId, {
      name: 'Auditor',
      description: 'Reads audit records',
      permissions: ['dashboard:read', 'audit:read'],
    });
    expect(role.key).toMatch(/^custom_/);
    await db.user.update({ where: { id: memberId }, data: { role: role.key } });
    const identity = { userId: memberId, sessionId };
    await expect(authorize(identity, 'audit:read')).resolves.toBeDefined();
    await expect(authorize(identity, 'users:read')).rejects.toMatchObject({ status: 403 });
    await expect(deleteRole(actorId, role.key)).rejects.toMatchObject({
      status: 409,
      code: 'ROLE_IN_USE',
    });
    await updateRole(actorId, role.key, {
      name: 'Auditor Lite',
      description: '',
      permissions: ['dashboard:read', 'users:read'],
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: memberId } })).role).toBe(role.key);
    expect((await grants(memberId)).roles).toContain(role.key);
    await expect(authorize(identity, 'audit:read')).rejects.toMatchObject({ status: 403 });
    await expect(authorize(identity, 'users:read')).resolves.toBeDefined();
    await db.user.update({ where: { id: memberId }, data: { role: 'user' } });
    await deleteRole(actorId, role.key);
    expect(await db.role.findUnique({ where: { key: role.key } })).toBeNull();
    const actions = (
      await db.auditLog.findMany({ where: { targetId: role.key }, orderBy: { createdAt: 'asc' } })
    ).map((item) => item.action);
    expect(actions).toEqual(['role.create', 'role.update', 'role.delete']);
  });
});

describe('seeded permissions and system roles', () => {
  it('stores the code catalog and system roles, and refuses to delete a system role', async () => {
    const stored = (await db.permission.findMany()).toSorted((a, b) => (a.key < b.key ? -1 : 1));
    expect(stored.map((row) => row.key)).toEqual(
      [...Object.keys(permissionCatalog), ...Object.keys(adminPermissionCatalog)].sort(),
    );
    expect(stored.filter((row) => row.restricted).map((row) => row.key)).toEqual(
      [...restrictedPermissions].sort(),
    );
    const system = await db.role.findMany({ where: { system: true }, orderBy: { key: 'asc' } });
    expect(system.map((role) => role.key)).toEqual(['administrator', 'owner', 'user', 'viewer']);
    await expect(db.role.delete({ where: { key: 'viewer' } })).rejects.toThrow();
    expect(await seedRbac(db)).toMatchObject({ removedPermissions: 0, createdRoles: [] });
  });

  it('applies an owner edit to Viewer on the next request and keeps it across seeds', async () => {
    const actorId = randomUUID();
    const viewerId = randomUUID();
    await db.user.createMany({
      data: [
        {
          id: actorId,
          name: 'Owner',
          email: `${actorId}@example.test`,
          emailVerified: true,
          role: 'owner',
        },
        {
          id: viewerId,
          name: 'Viewer',
          email: `${viewerId}@example.test`,
          emailVerified: true,
          role: 'viewer',
        },
      ],
    });
    const sessionId = randomUUID();
    await db.session.create({
      data: {
        id: sessionId,
        userId: viewerId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const identity = { userId: viewerId, sessionId };
    await expect(authorize(identity, 'audit:read')).resolves.toBeDefined();
    await updateRole(actorId, 'viewer', {
      name: 'Renamed',
      description: 'Dashboard only',
      permissions: ['dashboard:read'],
    });
    await expect(authorize(identity, 'audit:read')).rejects.toMatchObject({ status: 403 });
    await expect(authorize(identity, 'dashboard:read')).resolves.toBeDefined();
    await seedRbac(db);
    const viewer = await db.role.findUniqueOrThrow({
      where: { key: 'viewer' },
      include: { permissions: true },
    });
    expect(viewer).toMatchObject({ name: 'Viewer', description: 'Dashboard only' });
    expect(viewer.permissions.map((grant) => grant.permissionKey)).toEqual(['dashboard:read']);
    await expect(
      updateRole(actorId, 'owner', { name: 'Owner', description: '', permissions: [] }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
