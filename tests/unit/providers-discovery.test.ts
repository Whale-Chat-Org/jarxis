import { discoverModels, refreshConnection } from '@/lib/providers/discovery';
import { NetworkError } from '@/lib/providers/network';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  txFind: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  update: vi.fn(),
  lock: vi.fn(),
  credential: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/db', () => ({
  db: {
    $transaction: (run: (tx: unknown) => Promise<unknown>) =>
      run({
        $executeRaw: mocks.lock,
        providerConnection: { findUnique: mocks.txFind, update: mocks.update },
        providerModel: { upsert: mocks.upsert, deleteMany: mocks.deleteMany },
      }),
  },
}));
vi.mock('@/lib/providers/credential', () => ({ getUsableCredential: mocks.credential }));
vi.mock('@/lib/providers/network', async (original) => ({
  NetworkError: (await original<typeof import('@/lib/providers/network')>()).NetworkError,
  safeFetch: mocks.fetch,
}));
vi.mock('@/lib/providers/crypto', () => ({
  decryptCredential: (value: string) => JSON.parse(value),
}));

const row = (extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1/',
  enabled: true,
  status: 'ready',
  encryptedCredential: JSON.stringify({ apiKey: 'sk' }),
  discoveryRevision: 0,
  ...extra,
});
type ConnectionRow = ReturnType<typeof row>;
let current: ConnectionRow;

beforeEach(() => {
  vi.clearAllMocks();
  current = row();
  mocks.txFind.mockImplementation(async () => ({ ...current }));
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const revision = data.discoveryRevision as { increment?: number } | undefined;
    if (revision?.increment) current.discoveryRevision += revision.increment;
    else Object.assign(current, data);
    return { ...current };
  });
  mocks.lock.mockResolvedValue(undefined);
  mocks.upsert.mockResolvedValue(undefined);
  mocks.deleteMany.mockResolvedValue({ count: 0 });
  mocks.credential.mockResolvedValue({ apiKey: 'sk' });
});

describe('refreshConnection', () => {
  it('reports an unsupported catalog without deleting the last successful models', async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 404 }));
    await refreshConnection('c1');
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[1][0].data).toMatchObject({
      discoveryStatus: 'unsupported',
      discoveryError: null,
    });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('claims a revision and replaces models without changing aliases or enabled state', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ data: [{ id: 'gpt-a' }, { id: 'gpt-b', display_name: 'B' }] }),
    );
    await refreshConnection('c1');
    expect(mocks.update.mock.calls[0][0].data).toEqual({
      discoveryRevision: { increment: 1 },
    });
    expect(current.discoveryRevision).toBe(1);
    expect(String(mocks.fetch.mock.calls[0][0])).toBe('https://api.example.com/v1/models');
    expect(mocks.fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer sk' });
    expect(mocks.lock).toHaveBeenCalledTimes(2);
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.upsert.mock.calls[1][0]).toMatchObject({
      create: { upstreamId: 'gpt-b', displayName: 'B', discovered: true },
      update: { displayName: 'B' },
    });
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty('enabled');
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty('alias');
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { connectionId: 'c1', discovered: true, upstreamId: { notIn: ['gpt-a', 'gpt-b'] } },
    });
    expect(mocks.update.mock.calls[1][0].data).toMatchObject({
      discoveryStatus: 'ok',
      discoveryError: null,
      lastDiscoveredAt: expect.any(Date),
    });
  });

  it('ignores disabled, non-ready or missing connections', async () => {
    current.enabled = false;
    await refreshConnection('c1');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();

    current = row({ status: 'reconnect_required' });
    await refreshConnection('c1');
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.txFind.mockResolvedValueOnce(null);
    await refreshConnection('missing');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('follows Anthropic pagination', async () => {
    current.provider = 'anthropic';
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'm1' }], has_more: true, last_id: 'm1' }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'm2' }], has_more: false }));
    await refreshConnection('c1');
    expect((mocks.fetch.mock.calls[1][0] as URL).searchParams.get('after_id')).toBe('m1');
    expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({ 'x-api-key': 'sk' });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });

  it('preserves the prior catalog and records a sanitised failure', async () => {
    mocks.fetch.mockResolvedValue(new Response('upstream secret', { status: 500 }));
    await refreshConnection('c1');
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[1][0].data).toMatchObject({
      discoveryStatus: 'failed',
      discoveryError: 'provider_error:500',
    });
    expect(JSON.stringify(mocks.update.mock.calls[1][0])).not.toContain('secret');
  });

  it('does not commit a stale successful result after a newer discovery starts', async () => {
    mocks.fetch.mockImplementation(async () => {
      current.discoveryRevision += 1;
      return Response.json({ data: [{ id: 'stale-model' }] });
    });
    await refreshConnection('c1');
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('does not record a stale failure after a newer discovery starts', async () => {
    mocks.fetch.mockImplementation(async () => {
      current.discoveryRevision += 1;
      return new Response('upstream secret', { status: 503 });
    });
    await refreshConnection('c1');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0].data).toEqual({
      discoveryRevision: { increment: 1 },
    });
  });

  it('discards a result when the saved credential changes during the request', async () => {
    mocks.fetch.mockImplementation(async () => {
      current.encryptedCredential = JSON.stringify({ apiKey: 'replacement' });
      current.discoveryRevision += 1;
      return Response.json({ data: [{ id: 'old-key-model' }] });
    });
    await refreshConnection('c1');
    expect(mocks.fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer sk' });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('discards results when the endpoint or provider changes before commit', async () => {
    mocks.fetch.mockImplementation(async () => {
      current.baseUrl = 'https://other.example.com/v1';
      current.provider = 'custom';
      current.discoveryRevision += 1;
      return Response.json({ data: [{ id: 'stale-model' }] });
    });
    await refreshConnection('c1');
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('records the failure reason for the connection card', async () => {
    mocks.fetch.mockResolvedValue(new Response('secret', { status: 429 }));
    await refreshConnection('c1');
    expect(mocks.update.mock.calls[1][0].data).toMatchObject({
      discoveryStatus: 'failed',
      discoveryError: 'rate_limited:429',
    });
  });

  it('records an empty successful catalog as ok during refresh', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ data: [] }));
    await refreshConnection('c1');
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { connectionId: 'c1', discovered: true, upstreamId: { notIn: [] } },
    });
    expect(mocks.update.mock.calls[1][0].data.discoveryStatus).toBe('ok');
  });
});

describe('discoverModels', () => {
  afterEach(() => vi.restoreAllMocks());
  const pending = (_url: URL, init: { signal: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      if (init.signal.aborted) reject(new Error('aborted'));
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });

  it('bounds every page with a shared deadline, signal and response cap', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ data: [{ id: 'm' }] }));
    const result = await discoverModels('openai', 'https://api.example.com/v1', { apiKey: 'sk' });
    expect(result).toMatchObject({ status: 'ok', models: [{ id: 'm', name: 'm' }], error: null });
    const init = mocks.fetch.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.timeoutMs).toBeLessThanOrEqual(15000);
    expect(init.maxResponseBytes).toBe(2 * 1024 * 1024);
  });

  it('fails once the total deadline expires between pages', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    mocks.fetch.mockImplementationOnce(async () => {
      clock.mockReturnValue(start + 15001);
      return Response.json({ data: [{ id: 'm1' }], has_more: true, last_id: 'm1' });
    });
    const result = await discoverModels('anthropic', 'https://api.example.com/v1', {
      apiKey: 'sk',
    });
    expect(result.status).toBe('failed');
    expect(result.models).toEqual([]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('stops when the caller cancels', async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementation(pending);
    const running = discoverModels(
      'openai',
      'https://api.example.com/v1',
      { apiKey: 'sk' },
      controller.signal,
    );
    controller.abort();
    expect((await running).status).toBe('failed');
    mocks.fetch.mockClear();
    expect(
      (
        await discoverModels(
          'openai',
          'https://api.example.com/v1',
          { apiKey: 'sk' },
          controller.signal,
        )
      ).status,
    ).toBe('failed');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('authenticates per provider and fails without a credential', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ data: [] }));
    await discoverModels('anthropic', 'https://api.example.com/v1', { apiKey: 'ak' });
    expect(mocks.fetch.mock.calls[0][1].headers).toEqual({
      'x-api-key': 'ak',
      'anthropic-version': '2023-06-01',
    });
    mocks.fetch.mockClear();
    expect((await discoverModels('openai', 'https://api.example.com/v1', {})).status).toBe(
      'failed',
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('reports missing catalog endpoints as unsupported and empty lists as ok', async () => {
    for (const status of [404, 405, 501]) {
      mocks.fetch.mockResolvedValueOnce(new Response('secret', { status }));
      expect(
        await discoverModels('custom', 'https://api.example.com/v1', { apiKey: 'sk' }),
      ).toMatchObject({ status: 'unsupported', models: [], error: null });
    }
    mocks.fetch.mockResolvedValueOnce(new Response('secret', { status: 401 }));
    expect(
      (await discoverModels('custom', 'https://api.example.com/v1', { apiKey: 'sk' })).status,
    ).toBe('failed');
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: [] }));
    expect(
      await discoverModels('custom', 'https://api.example.com/v1', { apiKey: 'sk' }),
    ).toMatchObject({
      status: 'ok',
      models: [],
      error: null,
    });
  });

  it('rejects malformed catalogs with a sanitised error', async () => {
    for (const response of [
      () => new Response('not json secret'),
      () => Response.json(null),
      () => Response.json({ data: [null] }),
      () => Response.json({ data: [{ id: 'x'.repeat(257) }] }),
      () => Response.json({ data: [{ id: 'm' }], has_more: true }),
    ]) {
      mocks.fetch.mockResolvedValueOnce(response());
      const result = await discoverModels('openai', 'https://api.example.com/v1', {
        apiKey: 'sk',
      });
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('invalid_catalog');
      expect(result.error).not.toContain('secret');
    }
  });

  it('explains each failure precisely without upstream text', async () => {
    const run = () => discoverModels('openai', 'https://api.example.com/v1', { apiKey: 'sk' });
    const body = '{"error":"upstream secret"}';
    mocks.fetch.mockResolvedValueOnce(new Response(body, { status: 401 }));
    expect(await run()).toMatchObject({ reason: 'auth', httpStatus: 401 });
    mocks.fetch.mockResolvedValueOnce(
      new Response(body, { status: 429, headers: { 'Retry-After': '30' } }),
    );
    const limited = await run();
    expect(limited).toMatchObject({
      reason: 'rate_limited',
      httpStatus: 429,
      retryAfterSeconds: 30,
    });
    expect(limited.error).toContain('HTTP 429');
    expect(limited.error).toContain('30 seconds');
    expect(limited.error).not.toMatch(/API key and base URL/);
    mocks.fetch.mockResolvedValueOnce(new Response(body, { status: 503 }));
    expect(await run()).toMatchObject({ reason: 'provider_error', httpStatus: 503 });
    for (const [code, reason] of [
      ['DNS_FAILED', 'unreachable'],
      ['TRANSPORT', 'unreachable'],
      ['TIMEOUT', 'timeout'],
      ['DESTINATION_REJECTED', 'endpoint_rejected'],
      ['REDIRECT', 'endpoint_rejected'],
    ] as const) {
      mocks.fetch.mockRejectedValueOnce(new NetworkError(code, 'upstream secret'));
      const result = await run();
      expect(result).toMatchObject({ status: 'failed', reason, httpStatus: null });
      expect(result.error).not.toContain('secret');
    }
  });

  it('stores the failure reason for the connection card', async () => {
    mocks.fetch.mockResolvedValue(new Response('secret', { status: 429 }));
    await refreshConnection('c1');
    expect(mocks.update.mock.calls.at(-1)![0].data).toMatchObject({
      discoveryStatus: 'failed',
      discoveryError: 'rate_limited:429',
    });
  });

  it('collapses duplicates and caps unique models', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ data: [{ id: 'm' }, { id: 'm' }] }));
    expect(
      (await discoverModels('openai', 'https://api.example.com/v1', { apiKey: 'sk' })).models,
    ).toEqual([{ id: 'm', name: 'm' }]);
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ data: Array.from({ length: 5001 }, (_, index) => ({ id: `m${index}` })) }),
    );
    expect(
      (await discoverModels('openai', 'https://api.example.com/v1', { apiKey: 'sk' })).status,
    ).toBe('failed');
  });

  it('gives up after twenty pages', async () => {
    let page = 0;
    mocks.fetch.mockImplementation(async () => {
      page += 1;
      return Response.json({ data: [{ id: `m${page}` }], has_more: true, last_id: `m${page}` });
    });
    expect(
      (await discoverModels('anthropic', 'https://api.example.com/v1', { apiKey: 'sk' })).status,
    ).toBe('failed');
    expect(mocks.fetch).toHaveBeenCalledTimes(20);
  });

  it('records an empty successful catalog as ok during refresh', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ data: [] }));
    await refreshConnection('c1');
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { connectionId: 'c1', discovered: true, upstreamId: { notIn: [] } },
    });
    expect(mocks.update.mock.calls.at(-1)![0].data.discoveryStatus).toBe('ok');
  });
});
