import {
  availability,
  buildPools,
  poolSummaries,
  poolModelId,
  pruneRotations,
  rotateTier,
  uniqueCandidates,
  type PoolConnection,
} from '@/lib/providers/pools';
import { beforeEach, describe, expect, it } from 'vitest';

const connection = (id: string, extra: Partial<PoolConnection> = {}): PoolConnection => ({
  id,
  name: id,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  priority: 0,
  enabled: true,
  status: 'ready',
  models: [{ id: `${id}-model`, upstreamId: 'gpt-4.1', enabled: true }],
  ...extra,
});
beforeEach(() => pruneRotations(new Set()));
describe('pool identities', () => {
  it('merges explicit aliases without changing upstream or legacy IDs', () => {
    const connections = [
      connection('a'),
      connection('b', {
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: [{ id: 'b-model', upstreamId: 'openai/gpt-4.1', alias: 'gpt-4.1', enabled: true }],
      }),
    ];
    const index = buildPools(connections);
    expect(index.pools.get('gpt-4.1')?.map(({ model }) => model.upstreamId)).toEqual([
      'gpt-4.1',
      'openai/gpt-4.1',
    ]);
    expect(index.legacy.get('openai/gpt-4.1')).toHaveLength(1);
    expect(index.legacy.get('openrouter/openai/gpt-4.1')).toHaveLength(1);
    expect(index.advertised('gpt-4.1')).toBe(true);
  });
  it('normalizes OpenRouter IDs automatically and keeps legacy scopes separate', () => {
    const direct = connection('a');
    const router = connection('b', {
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: [{ id: 'b-model', upstreamId: 'openai/gpt-4.1', enabled: true }],
    });
    const index = buildPools([direct, router]);
    expect([...index.pools.keys()]).toEqual(['gpt-4.1']);
    expect(index.pools.get('gpt-4.1')).toHaveLength(2);
    expect(index.legacy.get('openai/gpt-4.1')?.[0].connection.id).toBe('a');
    expect(index.legacy.get('openrouter/openai/gpt-4.1')?.[0].connection.id).toBe('b');
    expect(poolModelId({ upstreamId: 'openai/gpt-4.1', alias: 'chosen' })).toBe('chosen');
    expect(poolModelId({ upstreamId: 'openai/gpt-4.1', alias: null })).toBe('gpt-4.1');
    expect(poolModelId({ upstreamId: 'gpt-4.1' })).toBe('gpt-4.1');
    expect(poolModelId({ upstreamId: 'vendor/' })).toBe('vendor/');
  });
  it.each(['custom', 'future-provider', 'openai', 'anthropic'])(
    'derives model names from vendor IDs on %s connections',
    (provider) => {
      const conn = connection('a', { provider });
      expect(poolModelId({ upstreamId: 'new-vendor/new-model' })).toBe('new-model');
      const index = buildPools([
        { ...conn, models: [{ id: 'model', upstreamId: 'new-vendor/new-model', enabled: true }] },
      ]);
      expect([...index.pools.keys()]).toEqual(['new-model']);
      expect(index.advertised('new-model')).toBe(true);
      expect(poolModelId({ upstreamId: 'new-vendor/new-model', alias: 'chosen' })).toBe('chosen');
    },
  );
  it('does not advertise a raw custom pool shadowed by a legacy ID', () => {
    const index = buildPools([
      connection('a'),
      connection('b', {
        provider: 'custom',
        baseUrl: 'https://custom.example/v1',
        models: [{ id: 'b-model', upstreamId: 'vendor/openai/gpt-4.1', enabled: true }],
      }),
    ]);
    expect(index.advertised('openai/gpt-4.1')).toBe(false);
  });
  it('requires explicit aliases when vendor stripping would merge unrelated models', () => {
    const router = connection('b', {
      provider: 'openrouter',
      models: [{ id: 'b-model', upstreamId: 'other/gpt-4.1', enabled: true }],
    });
    const index = buildPools([connection('a'), router]);
    expect(index.ambiguous('gpt-4.1')).toBe(true);
    expect(index.advertised('gpt-4.1')).toBe(false);
    router.enabled = false;
    expect(buildPools([connection('a'), router]).advertised('gpt-4.1')).toBe(true);
    router.enabled = true;
    router.models[0].alias = 'other-gpt';
    const resolved = buildPools([connection('a'), router]);
    expect(resolved.ambiguous('gpt-4.1')).toBe(false);
    expect(resolved.advertised('gpt-4.1')).toBe(true);
    expect(resolved.advertised('other-gpt')).toBe(true);
  });
  it('keeps owner visibility of unavailable members', () => {
    const summaries = poolSummaries([
      connection('a', { status: 'reconnect_required' }),
      connection('b', { enabled: false }),
    ]);
    expect(summaries[0].members.map(({ availability }) => availability)).toEqual([
      'reconnect_required',
      'disabled',
    ]);
  });
  it('deduplicates keys and prefers exact upstream matches', () => {
    const conn = connection('a', {
      models: [
        { id: 'other', upstreamId: 'vendor/gpt-4.1', alias: 'gpt-4.1', enabled: true },
        { id: 'exact', upstreamId: 'gpt-4.1', enabled: true },
      ],
    });
    expect(
      uniqueCandidates(buildPools([conn]).pools.get('gpt-4.1')!, 'gpt-4.1').map(
        ({ model }) => model.id,
      ),
    ).toEqual(['exact']);
  });
  it('reports each availability reason without provider errors', () => {
    const conn = connection('a');
    const model = conn.models[0];
    expect(availability(conn, model)).toBe('ready');
    expect(availability(conn, { ...model, enabled: false })).toBe('model_disabled');
    expect(availability({ ...conn, status: 'pending' }, model)).toBe('pending');
    expect(availability({ ...conn, cooldownUntil: new Date(Date.now() + 1000) }, model)).toBe(
      'cooldown',
    );
  });
});
describe('process-local rotation', () => {
  const members = ['a', 'b', 'c'].map((id) => ({
    connection: connection(id),
    model: connection(id).models[0],
  }));
  it('rotates starting keys, with independent scopes and tiers', () => {
    expect([0, 1, 2, 3].map(() => rotateTier('pool:gpt-4.1', 0, members)[0].connection.id)).toEqual(
      ['a', 'b', 'c', 'a'],
    );
    expect(rotateTier('legacy:openai/gpt-4.1', 0, members)[0].connection.id).toBe('a');
    expect(rotateTier('pool:gpt-4.1', 1, members)[0].connection.id).toBe('a');
  });
  it('normalizes changed membership and resets removed pools', () => {
    rotateTier('pool:gpt-4.1', 0, members);
    rotateTier('pool:gpt-4.1', 0, members);
    expect(rotateTier('pool:gpt-4.1', 0, members.slice(0, 2))[0].connection.id).toBe('a');
    pruneRotations(new Set());
    expect(rotateTier('pool:gpt-4.1', 0, members)[0].connection.id).toBe('a');
  });
  it('bounds counters and evicts old scopes', () => {
    rotateTier('old', 0, members);
    for (let i = 0; i < 2048; i++) rotateTier(`pool:${i}`, 0, members);
    expect(rotateTier('old', 0, members)[0].connection.id).toBe('a');
  });
});
