import { POST as discover } from '@/app/api/admin/providers/discover/route';
import { POST as create } from '@/app/api/admin/providers/route';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  identify: vi.fn(),
  authorize: vi.fn(),
  rateLimit: vi.fn(),
  session: vi.fn(),
  validateDestination: vi.fn(),
  fetch: vi.fn(),
  createConnection: vi.fn(),
  getConnection: vi.fn(),
  refreshConnection: vi.fn(),
  dbWrite: vi.fn(),
}));
vi.mock('@/db', () => ({
  db: {
    session: { findFirst: mocks.session },
    $transaction: mocks.dbWrite,
    providerConnection: { create: mocks.dbWrite, update: mocks.dbWrite, updateMany: mocks.dbWrite },
  },
}));
vi.mock('@/lib/rbac', () => ({
  identify: mocks.identify,
  authorize: mocks.authorize,
  activeUserWhere: () => ({}),
}));
vi.mock('@/lib/redis', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('@/lib/env', () => ({ env: () => ({ BETTER_AUTH_URL: 'https://app.test' }) }));
vi.mock('@/lib/providers/network', async (original) => ({
  NetworkError: (await original<typeof import('@/lib/providers/network')>()).NetworkError,
  validateDestination: mocks.validateDestination,
  safeFetch: mocks.fetch,
}));
vi.mock('@/lib/providers/discovery', async (original) => ({
  ...(await original<typeof import('@/lib/providers/discovery')>()),
  refreshConnection: mocks.refreshConnection,
}));
vi.mock('@/lib/providers/service', async (original) => ({
  ...(await original<typeof import('@/lib/providers/service')>()),
  createConnection: mocks.createConnection,
  getConnection: mocks.getConnection,
}));

const request = (path: string, value: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.test/api/admin/providers${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.test', ...headers },
    body: typeof value === 'string' ? value : JSON.stringify(value),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.identify.mockResolvedValue({ userId: 'owner', sessionId: 'session' });
  mocks.session.mockResolvedValue({ id: 'session' });
  mocks.authorize.mockResolvedValue({ roles: ['owner'] });
  mocks.fetch.mockResolvedValue(
    Response.json({ data: [{ id: 'gpt-a', display_name: 'A' }, { id: 'gpt-b' }] }),
  );
});

describe('POST /api/admin/providers/discover', () => {
  it('returns the catalog DTO without persisting or echoing the key', async () => {
    const response = await discover(
      request('/discover', { provider: 'openai', apiKey: 'sk-secret' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      discovery: {
        status: 'ok',
        models: [
          { id: 'gpt-a', name: 'A' },
          { id: 'gpt-b', name: 'gpt-b' },
        ],
        error: null,
      },
    });
    expect(text).not.toContain('sk-secret');
    expect(mocks.validateDestination).toHaveBeenCalledWith('https://api.openai.com/v1', {
      timeoutMs: 15000,
      signal: expect.any(AbortSignal),
    });
    const destinationSignal = mocks.validateDestination.mock.calls[0][1].signal;
    expect(destinationSignal.aborted).toBe(false);
    expect(mocks.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(String(mocks.fetch.mock.calls[0][0])).toBe('https://api.openai.com/v1/models');
    expect(mocks.fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer sk-secret' });
    expect(mocks.dbWrite).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), 'providers:manage');
  });

  it('reports unsupported and failed catalogs as sanitized DTOs', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('secret', { status: 404 }));
    const missing = await discover(
      request('/discover', {
        provider: 'custom',
        baseUrl: 'https://gw.example.com/v1',
        apiKey: 'k',
      }),
    );
    expect((await missing.json()).discovery).toMatchObject({
      status: 'unsupported',
      models: [],
      error: null,
    });
    mocks.fetch.mockResolvedValueOnce(new Response('upstream secret', { status: 500 }));
    const failed = await discover(request('/discover', { provider: 'openrouter', apiKey: 'k' }));
    expect(failed.status).toBe(200);
    const text = await failed.text();
    expect(JSON.parse(text).discovery.status).toBe('failed');
    expect(text).not.toContain('secret');
  });

  it('requires an owner with a same-origin session', async () => {
    const noOrigin = await discover(
      new Request('https://app.test/api/admin/providers/discover', {
        method: 'POST',
        headers: { cookie: 'session=present', 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', apiKey: 'k' }),
      }),
    );
    expect(noOrigin.status).toBe(403);
    expect(mocks.identify).not.toHaveBeenCalled();
    const foreign = await discover(
      request('/discover', { provider: 'openai', apiKey: 'k' }, { origin: 'https://evil.test' }),
    );
    expect(foreign.status).toBe(403);
    mocks.authorize.mockResolvedValue({ roles: ['administrator'] });
    expect((await discover(request('/discover', { provider: 'openai', apiKey: 'k' }))).status).toBe(
      403,
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('accepts only API-key providers with a strict body', async () => {
    for (const value of [
      { provider: 'codex', apiKey: 'k' },
      { provider: 'claude', apiKey: 'k' },
      { provider: 'openai' },
      { provider: 'openai', apiKey: '' },
      { provider: 'custom', apiKey: 'k' },
      { provider: 'openai', apiKey: 'k', baseUrl: 'http://api.example.com/v1' },
      { provider: 'openai', apiKey: 'k', baseUrl: 'https://user:pw@api.example.com/v1' },
      { provider: 'openai', apiKey: 'k', name: 'extra' },
    ])
      expect((await discover(request('/discover', value))).status).toBe(400);
    expect((await discover(request('/discover', '{'))).status).toBe(400);
    expect(
      (await discover(request('/discover', { provider: 'openai', apiKey: 'k'.repeat(20000) })))
        .status,
    ).toBe(413);
    expect(mocks.validateDestination).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('delegates destination defence and never fetches a rejected endpoint', async () => {
    mocks.validateDestination.mockRejectedValue(new Error('private address 10.0.0.1'));
    const response = await discover(
      request('/discover', {
        provider: 'custom',
        baseUrl: 'https://internal.example/v1',
        apiKey: 'k',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('10.0.0.1');
    expect(mocks.validateDestination).toHaveBeenCalledWith(
      'https://internal.example/v1',
      expect.anything(),
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/providers', () => {
  const saved = (extra: Record<string, unknown> = {}) => ({ id: 'c1', status: 'ready', ...extra });

  it('commits first, runs discovery, then returns the fresh connection', async () => {
    const order: string[] = [];
    mocks.createConnection.mockImplementation(async () => (order.push('create'), saved()));
    mocks.refreshConnection.mockImplementation(async () => void order.push('refresh'));
    mocks.getConnection.mockImplementation(
      async () => (order.push('get'), saved({ discoveryStatus: 'ok' })),
    );
    const response = await create(
      request('', { name: 'OpenAI', provider: 'openai', apiKey: 'sk-secret' }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ connection: saved({ discoveryStatus: 'ok' }) });
    expect(order).toEqual(['create', 'refresh', 'get']);
    expect(mocks.createConnection).toHaveBeenCalledWith('owner', {
      name: 'OpenAI',
      provider: 'openai',
      apiKey: 'sk-secret',
    });
    expect(mocks.refreshConnection).toHaveBeenCalledWith('c1');
  });

  it('still returns 201 when discovery throws', async () => {
    mocks.createConnection.mockResolvedValue(saved());
    mocks.refreshConnection.mockRejectedValue(new Error('upstream secret'));
    const response = await create(request('', { name: 'OpenAI', provider: 'openai', apiKey: 'k' }));
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ connection: saved() });
    expect(text).not.toContain('secret');
  });

  it('leaves keyless connections pending', async () => {
    for (const value of [{ name: 'OpenAI', provider: 'openai' }]) {
      mocks.createConnection.mockResolvedValueOnce(saved({ status: 'pending' }));
      expect((await create(request('', value))).status).toBe(201);
    }
    expect(mocks.refreshConnection).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });

  it('does not accept a client-supplied catalog', async () => {
    const response = await create(
      request('', {
        name: 'OpenAI',
        provider: 'openai',
        apiKey: 'k',
        discovery: { status: 'ok', models: [{ id: 'm', name: 'm' }] },
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createConnection).not.toHaveBeenCalled();
  });
});
