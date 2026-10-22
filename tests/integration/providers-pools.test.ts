import { db } from '@/db';
import { hashGatewayKey } from '@/lib/providers/crypto';
import { handleGateway } from '@/lib/providers/gateway';
import {
  getConnection,
  updateModelAlias,
  updateModelStates,
  listConnections,
  listProviderPools,
} from '@/lib/providers/service';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/redis', () => ({ rateLimit: vi.fn() }));
vi.mock('@/lib/providers/credential', () => ({
  getUsableCredential: vi.fn(async () => ({ apiKey: 'test-only' })),
}));
vi.mock('@/lib/providers/network', async (original) => ({
  ...(await original<typeof import('@/lib/providers/network')>()),
  safeFetch: mocks.fetch,
}));
const key = 'jml_pool_integration';
const ownerId = 'pool-owner';
const post = (model: string) =>
  new Request('https://gateway.test/api/llm/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Hello' }] }),
  });
beforeEach(async () => {
  vi.resetAllMocks();
  await db.$executeRaw`TRUNCATE ml_connections, ml_gateway_keys, audit_logs, app_user CASCADE`;
  await db.user.createMany({
    data: [
      { id: ownerId, name: 'Owner', email: 'owner@pool.test', emailVerified: true, role: 'owner' },
      {
        id: 'pool-admin',
        name: 'Admin',
        email: 'admin@pool.test',
        emailVerified: true,
        role: 'administrator',
      },
    ],
  });
  await db.providerGatewayKey.create({
    data: { name: 'Pool key', prefix: 'jml_pool', hash: hashGatewayKey(key), createdBy: ownerId },
  });
  for (const [id, provider, baseUrl, upstreamId] of [
    ['pool-a', 'openai', 'https://api.openai.com/v1', 'gpt-4.1'],
    ['pool-b', 'openrouter', 'https://openrouter.ai/api/v1', 'openai/gpt-4.1-mini'],
  ])
    await db.providerConnection.create({
      data: {
        id,
        provider,
        baseUrl,
        name: id,
        status: 'ready',
        encryptedCredential: 'mock-cipher',
        createdBy: ownerId,
        models: { create: { id: `${id}-model`, upstreamId, displayName: upstreamId } },
      },
    });
  mocks.fetch.mockImplementation(async () =>
    Response.json({
      id: 'answer',
      choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
    }),
  );
});
afterAll(async () => db.$disconnect());
describe('persistent aliases and shared routing', () => {
  it('merges providers, forwards exact upstream IDs, audits changes and restores the pool on removal', async () => {
    const before = await getConnection('pool-b');
    const updated = await updateModelAlias(ownerId, 'pool-b', 'pool-b-model', {
      alias: 'gpt-4.1',
      version: before.modelStateVersion,
    });
    expect(updated.models[0]).toMatchObject({
      alias: 'gpt-4.1',
      poolId: 'gpt-4.1',
      publicId: 'openrouter/openai/gpt-4.1-mini',
    });
    expect(
      listProviderPools(await listConnections()).find(({ id }) => id === 'gpt-4.1')?.members,
    ).toHaveLength(2);
    for (let i = 0; i < 2; i++)
      expect((await handleGateway(post('gpt-4.1'), ['chat', 'completions'])).status).toBe(200);
    expect(new Set(mocks.fetch.mock.calls.map(([, init]) => JSON.parse(init.body).model))).toEqual(
      new Set(['gpt-4.1', 'openai/gpt-4.1-mini']),
    );
    expect(await db.auditLog.count({ where: { action: 'providers:model:alias' } })).toBe(1);
    await updateModelAlias(ownerId, 'pool-b', 'pool-b-model', {
      alias: 'gpt-4.1',
      version: updated.modelStateVersion,
    });
    expect(await db.auditLog.count({ where: { action: 'providers:model:alias' } })).toBe(1);
    await updateModelAlias(ownerId, 'pool-b', 'pool-b-model', {
      alias: null,
      version: updated.modelStateVersion,
    });
    const pools = listProviderPools(await listConnections());
    expect(pools.find(({ id }) => id === 'gpt-4.1')?.members).toHaveLength(1);
    expect(pools.find(({ id }) => id === 'gpt-4.1-mini')).toMatchObject({
      advertised: true,
      members: [{ upstreamId: 'openai/gpt-4.1-mini' }],
    });
    const listing = await handleGateway(
      new Request('https://gateway.test/api/llm/v1/models', {
        headers: { authorization: `Bearer ${key}` },
      }),
      ['models'],
    );
    expect((await listing.json()).data.map(({ id }: { id: string }) => id)).toEqual([
      'gpt-4.1',
      'gpt-4.1-mini',
    ]);
    mocks.fetch.mockClear();
    expect((await handleGateway(post('gpt-4.1-mini'), ['chat', 'completions'])).status).toBe(200);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).model).toBe('openai/gpt-4.1-mini');
  });
  it('restores the automatic shared name when an alias is removed from equivalent models', async () => {
    await db.providerModel.update({
      where: { id: 'pool-b-model' },
      data: { upstreamId: 'openai/gpt-4.1' },
    });
    const before = await getConnection('pool-b');
    expect(before.models[0].poolId).toBe('gpt-4.1');
    const renamed = await updateModelAlias(ownerId, 'pool-b', 'pool-b-model', {
      alias: 'my-model',
      version: before.modelStateVersion,
    });
    const removed = await updateModelAlias(ownerId, 'pool-b', 'pool-b-model', {
      alias: null,
      version: renamed.modelStateVersion,
    });
    expect(removed.models[0].poolId).toBe('gpt-4.1');
    expect(listProviderPools(await listConnections())).toMatchObject([
      {
        id: 'gpt-4.1',
        advertised: true,
        members: [{ connectionId: 'pool-a' }, { connectionId: 'pool-b' }],
      },
    ]);
    const listing = await handleGateway(
      new Request('https://gateway.test/api/llm/v1/models', {
        headers: { authorization: `Bearer ${key}` },
      }),
      ['models'],
    );
    expect((await listing.json()).data.map(({ id }: { id: string }) => id)).toEqual(['gpt-4.1']);
  });
  it('rejects nonowners, wrong connections, invalid aliases and stale versions', async () => {
    const before = await getConnection('pool-b');
    const value = { alias: 'gpt-4.1', version: before.modelStateVersion };
    await expect(
      updateModelAlias('pool-admin', 'pool-b', 'pool-b-model', value),
    ).rejects.toMatchObject({ status: 403 });
    await expect(updateModelAlias(ownerId, 'pool-b', 'pool-a-model', value)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      updateModelAlias(ownerId, 'pool-b', 'pool-b-model', { ...value, alias: 'vendor/model' }),
    ).rejects.toThrow();
    await updateModelAlias(ownerId, 'pool-b', 'pool-b-model', value);
    await expect(
      updateModelAlias(ownerId, 'pool-b', 'pool-b-model', { ...value, alias: null }),
    ).rejects.toMatchObject({ status: 409, code: 'MODEL_CATALOG_CHANGED' });
    await expect(
      updateModelStates(ownerId, 'pool-b', { version: before.modelStateVersion, states: 'AA' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.auditLog.count({ where: { action: 'providers:model:alias' } })).toBe(1);
  });
});
