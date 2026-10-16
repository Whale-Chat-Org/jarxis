import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { getConnection, updateModelStates } from '@/lib/ml/service';

async function makeUser(role: string) {
  const id = randomUUID();
  await db.user.create({
    data: { id, name: 'Model test user', email: `${id}@example.test`, emailVerified: true, role },
  });
  return id;
}

beforeEach(async () => {
  await db.$executeRaw`TRUNCATE ml_connections, audit_logs, app_user CASCADE`;
});

describe('model state persistence', () => {
  it('saves every changed model, audits each change and rejects a stale catalog', async () => {
    const ownerId = await makeUser('owner');
    await db.mlConnection.create({
      data: {
        id: 'model-state-connection',
        name: 'Test provider',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        createdBy: ownerId,
        models: {
          create: [
            { id: 'm1', upstreamId: 'first', displayName: 'First', enabled: true },
            { id: 'm2', upstreamId: 'second', displayName: 'Second', enabled: false },
          ],
        },
      },
    });
    const before = await getConnection('model-state-connection');
    await updateModelStates(ownerId, before.id, {
      version: before.modelStateVersion,
      states: 'Ag',
      connection: { name: 'Renamed provider' },
    });
    expect(
      await db.mlModel.findMany({
        where: { connectionId: before.id },
        orderBy: { id: 'asc' },
        select: { enabled: true },
      }),
    ).toEqual([{ enabled: false }, { enabled: true }]);
    expect(
      (await db.auditLog.findMany({ where: { action: 'ml:model:update' } }))
        .map((entry) => entry.targetId)
        .sort(),
    ).toEqual(['m1', 'm2']);
    expect((await getConnection(before.id)).name).toBe('Renamed provider');
    await db.mlModel.create({
      data: { id: 'm3', connectionId: before.id, upstreamId: 'third', displayName: 'Third' },
    });
    await expect(
      updateModelStates(ownerId, before.id, { version: before.modelStateVersion, states: 'Ag' }),
    ).rejects.toMatchObject({ status: 409, code: 'MODEL_CATALOG_CHANGED' });
  });

  it('rejects a non-owner before updating any model', async () => {
    const ownerId = await makeUser('owner');
    const adminId = await makeUser('administrator');
    await db.mlConnection.create({
      data: {
        id: 'owner-only-connection',
        name: 'Test provider',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        createdBy: ownerId,
        models: { create: [{ id: 'only-model', upstreamId: 'first', displayName: 'First' }] },
      },
    });
    const before = await getConnection('owner-only-connection');
    await expect(
      updateModelStates(adminId, before.id, { version: before.modelStateVersion, states: 'AA' }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await db.mlModel.findUniqueOrThrow({ where: { id: 'only-model' } })).enabled).toBe(
      true,
    );
  });
});
