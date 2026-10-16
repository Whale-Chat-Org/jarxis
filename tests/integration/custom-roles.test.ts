import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { createCustomRole, deleteCustomRole, updateCustomRole } from '@/lib/custom-role-service';
import { authorize, grants } from '@/lib/rbac';

beforeEach(async () => {
  await db.$executeRaw`TRUNCATE custom_roles, app_user, audit_logs CASCADE`;
});
afterEach(async () => {
  await db.$executeRaw`TRUNCATE custom_roles, app_user, audit_logs CASCADE`;
});
afterAll(async () => {
  await db.$disconnect();
});

describe('stored role lifecycle', () => {
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
    const role = await createCustomRole(actorId, {
      name: 'Auditor',
      description: 'Reads audit records',
      permissions: ['dashboard:read', 'audit:read'],
    });
    expect(role.key).toMatch(/^custom_/);
    await db.user.update({ where: { id: memberId }, data: { role: role.key } });
    const identity = { userId: memberId, sessionId };
    await expect(authorize(identity, 'audit:read')).resolves.toBeDefined();
    await expect(authorize(identity, 'users:read')).rejects.toMatchObject({ status: 403 });
    await expect(deleteCustomRole(actorId, role.key)).rejects.toMatchObject({
      status: 409,
      code: 'ROLE_IN_USE',
    });
    await updateCustomRole(actorId, role.key, {
      name: 'Auditor Lite',
      description: '',
      permissions: ['dashboard:read', 'users:read'],
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: memberId } })).role).toBe(role.key);
    expect((await grants(memberId)).roles).toContain(role.key);
    await expect(authorize(identity, 'audit:read')).rejects.toMatchObject({ status: 403 });
    await expect(authorize(identity, 'users:read')).resolves.toBeDefined();
    await db.user.update({ where: { id: memberId }, data: { role: 'user' } });
    await deleteCustomRole(actorId, role.key);
    expect(await db.customRole.findUnique({ where: { key: role.key } })).toBeNull();
    const actions = (
      await db.auditLog.findMany({ where: { targetId: role.key }, orderBy: { createdAt: 'asc' } })
    ).map((item) => item.action);
    expect(actions).toEqual(['role.create', 'role.update', 'role.delete']);
  });
});
