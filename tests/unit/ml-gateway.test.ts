import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  key: vi.fn(),
  keyUpdate: vi.fn(),
  user: vi.fn(),
  connections: vi.fn(),
  updateMany: vi.fn(),
  rateLimit: vi.fn(),
  credential: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/db', () => ({
  db: {
    mlGatewayKey: { findUnique: mocks.key, update: mocks.keyUpdate },
    user: { findUnique: mocks.user },
    mlConnection: { findMany: mocks.connections, updateMany: mocks.updateMany },
  },
}));
vi.mock('@/lib/redis', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('@/lib/ml/credential', () => ({ getUsableCredential: mocks.credential }));
vi.mock('@/lib/ml/network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ml/network')>()),
  safeFetch: mocks.fetch,
}));
import { cooldownUntil, handleGateway } from '@/lib/ml/gateway';
import { hashGatewayKey } from '@/lib/ml/crypto';
import { NetworkError } from '@/lib/ml/network';
import { poolModelId } from '@/lib/ml/model-id';
import { defaultBaseUrl, type ProviderKind } from '@/lib/ml/types';

const KEY = 'jml_test-key';
const connection = (id: string, provider: string, extra: Record<string, unknown> = {}) => ({
  id,
  provider,
  baseUrl: defaultBaseUrl(provider as ProviderKind) || `https://${id}.example.com/v1`,
  enabled: true,
  status: 'ready',
  priority: 0,
  encryptedCredential: `cipher-${id}`,
  cooldownUntil: null,
  models: [{ upstreamId: 'shared', enabled: true }],
  ...extra,
});
const post = (
  body: unknown,
  path = 'chat/completions',
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) =>
  new Request(`https://gateway.test/api/llm/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal,
  });
const chatBody = (model: string, extra: Record<string, unknown> = {}) => ({
  model,
  messages: [{ role: 'user', content: 'Hi' }],
  ...extra,
});
const sse = (frames: unknown[], status = 200) =>
  new Response(
    frames
      .map((frame) => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`)
      .join(''),
    { status, headers: { 'content-type': 'text/event-stream' } },
  );
const chatResult = (text: string) =>
  Response.json({
    id: 'c',
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.key.mockImplementation(async ({ where }: { where: { hash: string } }) =>
    where.hash === hashGatewayKey(KEY) ? { id: 'k1', createdBy: 'owner', revokedAt: null } : null,
  );
  mocks.user.mockResolvedValue({ id: 'owner', role: 'owner', emailVerified: true, banned: false });
  mocks.connections.mockResolvedValue([connection('a', 'openai'), connection('b', 'openai')]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.credential.mockResolvedValue({ apiKey: 'sk' });
});
afterEach(() => vi.useRealTimers());

describe('authentication', () => {
  it.each([
    ['missing', { authorization: '' }],
    ['cookie only', { authorization: '', cookie: 'better-auth.session_token=x' }],
    ['wrong prefix', { authorization: 'Bearer jxml_test-key' }],
    ['unknown key', { authorization: 'Bearer jml_other' }],
  ])('rejects %s credentials', async (_name, headers) => {
    const response = await handleGateway(
      post(chatBody('openai/shared'), 'chat/completions', headers as Record<string, string>),
      ['chat', 'completions'],
    );
    expect(response.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects revoked keys and inactive or non-owner issuers', async () => {
    mocks.key.mockResolvedValueOnce({ id: 'k1', createdBy: 'owner', revokedAt: new Date() });
    expect(
      (await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions'])).status,
    ).toBe(401);
    mocks.user.mockResolvedValueOnce({ id: 'owner', role: 'admin', emailVerified: true });
    expect(
      (await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions'])).status,
    ).toBe(401);
    mocks.user.mockResolvedValueOnce({
      id: 'owner',
      role: 'owner',
      emailVerified: true,
      banned: true,
    });
    expect(
      (await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions'])).status,
    ).toBe(401);
  });

  it('applies the per-key rate limit', async () => {
    mocks.rateLimit.mockRejectedValueOnce(Object.assign(new Error('limited'), { status: 429 }));
    const response = await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions']);
    expect(response.status).toBe(429);
    expect(mocks.rateLimit).toHaveBeenCalledWith('ml:gateway:k1', 60, 60);
  });
});

describe('model listing', () => {
  it('lists provider-qualified models including cooled connections', async () => {
    mocks.connections.mockResolvedValue([
      connection('a', 'anthropic', { cooldownUntil: new Date(Date.now() + 60000) }),
      connection('b', 'openrouter'),
    ]);
    const response = await handleGateway(
      new Request('https://gateway.test/api/llm/v1/models', {
        headers: { authorization: `Bearer ${KEY}` },
      }),
      ['models'],
    );
    const body = await response.json();
    expect(body.data.map((model: { id: string }) => model.id)).toEqual([
      'anthropic/shared',
      'openrouter/shared',
    ]);
    expect(mocks.connections).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true, status: 'ready' },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      }),
    );
  });
});

describe('request validation', () => {
  it('rejects bodies over 1 MiB by header and by stream', async () => {
    expect(
      (
        await handleGateway(
          post(chatBody('openai/shared'), 'chat/completions', {
            'content-length': String(2 * 1024 * 1024),
          }),
          ['chat', 'completions'],
        )
      ).status,
    ).toBe(413);
    const big = JSON.stringify(chatBody('openai/shared', { user: 'x'.repeat(1024 * 1024) }));
    expect((await handleGateway(post(big), ['chat', 'completions'])).status).toBe(413);
  });

  it('rejects non-JSON content, unknown endpoints and unsupported options without calling upstream', async () => {
    expect(
      (
        await handleGateway(
          post(chatBody('openai/shared'), 'chat/completions', { 'content-type': 'text/plain' }),
          ['chat', 'completions'],
        )
      ).status,
    ).toBe(415);
    expect(
      (await handleGateway(post(chatBody('openai/shared'), 'embeddings'), ['embeddings'])).status,
    ).toBe(404);
    expect(
      (await handleGateway(post(chatBody('openai/shared', { seed: 1 })), ['chat', 'completions']))
        .status,
    ).toBe(400);
    expect(
      (await handleGateway(post(chatBody('openai/missing')), ['chat', 'completions'])).status,
    ).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('routing and failover', () => {
  it('keeps the Responses endpoint working with an API-key provider', async () => {
    mocks.fetch.mockResolvedValue(chatResult('API-key response'));
    const response = await handleGateway(
      post({ model: 'openai/shared', input: 'Hi' }, 'responses'),
      ['responses'],
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      object: 'response',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'API-key response' }] }],
    });
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk' });
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'shared',
      messages: [{ role: 'user', content: 'Hi' }],
    });
  });

  it('strips the provider and translates native Anthropic responses', async () => {
    mocks.connections.mockResolvedValue([connection('a', 'anthropic')]);
    mocks.credential.mockResolvedValue({ apiKey: 'ak' });
    mocks.fetch.mockResolvedValue(
      Response.json({
        id: 'm',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 2, output_tokens: 3 },
      }),
    );
    const response = await handleGateway(post(chatBody('anthropic/shared')), [
      'chat',
      'completions',
    ]);
    expect(await response.json()).toMatchObject({
      model: 'anthropic/shared',
      choices: [{ message: { content: 'Hello' } }],
      usage: { total_tokens: 5 },
    });
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'ak', 'anthropic-version': '2023-06-01' });
    expect(JSON.parse(init.body)).toMatchObject({ model: 'shared', messages: [{ role: 'user' }] });
  });

  it('fails over on 429 and records the Retry-After cooldown', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        new Response('busy', { status: 429, headers: { 'retry-after': '120' } }),
      )
      .mockResolvedValueOnce(chatResult('from b'));
    const before = Date.now();
    const response = await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions']);
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'from b' } }] });
    const update = mocks.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ id: 'a' });
    expect(update.data.cooldownUntil.getTime()).toBeGreaterThanOrEqual(before + 120000);
    expect(update.where.OR).toEqual([
      { cooldownUntil: null },
      { cooldownUntil: { lt: update.data.cooldownUntil } },
    ]);
  });

  it('fails over on retryable transport errors and 5xx', async () => {
    mocks.connections.mockResolvedValue([
      connection('a', 'openai'),
      connection('b', 'openai'),
      connection('c', 'openai'),
    ]);
    mocks.fetch
      .mockRejectedValueOnce(new NetworkError('TRANSPORT', 'down'))
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockResolvedValueOnce(chatResult('from c'));
    expect(
      (await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions'])).status,
    ).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it('skips cooled connections when choosing candidates', async () => {
    mocks.connections.mockResolvedValue([
      connection('a', 'openai', { cooldownUntil: new Date(Date.now() + 60000) }),
      connection('b', 'openai'),
    ]);
    mocks.fetch.mockResolvedValue(chatResult('b'));
    await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions']);
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(mocks.credential).toHaveBeenCalledTimes(1);
    expect(mocks.credential.mock.calls[0][0]).toMatchObject({ id: 'b' });
  });

  it('namespaces custom endpoints and routes only to the matching endpoint', async () => {
    const first = connection('first', 'custom');
    const second = connection('second', 'custom');
    mocks.connections.mockResolvedValue([first, second]);
    const listed = await handleGateway(
      new Request('https://gateway.test/api/llm/v1/models', {
        headers: { authorization: `Bearer ${KEY}` },
      }),
      ['models'],
    );
    const ids = (await listed.json()).data.map((model: { id: string }) => model.id);
    const secondId = poolModelId(second, 'shared');
    expect(ids).toEqual([poolModelId(first, 'shared'), secondId]);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('custom/shared');
    expect(
      (await handleGateway(post(chatBody('custom/shared')), ['chat', 'completions'])).status,
    ).toBe(404);
    mocks.fetch.mockResolvedValue(chatResult('second'));
    const response = await handleGateway(post(chatBody(secondId)), ['chat', 'completions']);
    expect(await response.json()).toMatchObject({ model: secondId });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://second.example.com/v1/chat/completions');
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ model: 'shared' });
  });

  it('marks 401 as reconnect required and fails over without retrying the same account', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response('no', { status: 401 }))
      .mockResolvedValueOnce(chatResult('from b'));
    const response = await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions']);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'from b' } }] });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.credential.mock.calls.map(([c]) => c.id)).toEqual(['a', 'b']);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'a', encryptedCredential: 'cipher-a' },
      data: { status: 'reconnect_required' },
    });
  });

  it('fails over to the next candidate when credential refresh fails', async () => {
    mocks.credential
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce({ apiKey: 'sk-b' });
    mocks.fetch.mockResolvedValueOnce(chatResult('from b'));
    const response = await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions']);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'from b' } }] });
    expect(mocks.credential).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('never retries validation errors and does not leak upstream bodies', async () => {
    mocks.fetch.mockResolvedValue(
      new Response('{"error":"secret upstream detail"}', { status: 400 }),
    );
    const response = await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions']);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns 502 once every candidate is exhausted', async () => {
    mocks.fetch.mockResolvedValue(new Response('x', { status: 500 }));
    expect(
      (await handleGateway(post(chatBody('openai/shared')), ['chat', 'completions'])).status,
    ).toBe(502);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('streaming', () => {
  it('streams Responses events from an API-key Chat upstream', async () => {
    mocks.fetch.mockResolvedValue(
      sse([
        { id: 'c', choices: [{ delta: { content: 'Hello' } }] },
        { id: 'c', choices: [{ delta: {}, finish_reason: 'stop' }] },
        '[DONE]',
      ]),
    );
    const response = await handleGateway(
      post({ model: 'openai/shared', input: 'Hi', stream: true }, 'responses'),
      ['responses'],
    );
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('response.output_text.delta');
    expect(text).toContain('Hello');
    expect(text).toContain('response.completed');
  });

  it('translates Anthropic SSE into Chat chunks', async () => {
    mocks.connections.mockResolvedValue([connection('a', 'anthropic')]);
    mocks.credential.mockResolvedValue({ apiKey: 'ak' });
    mocks.fetch.mockResolvedValue(
      sse([
        { type: 'message_start', message: { id: 'm', usage: { input_tokens: 1 } } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]),
    );
    const response = await handleGateway(
      post(chatBody('anthropic/shared', { stream: true, stream_options: { include_usage: true } })),
      ['chat', 'completions'],
    );
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('"content":"Hi"');
    expect(text).toContain('"total_tokens":2');
    expect(text.trim().endsWith('data: [DONE]')).toBe(true);
    expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({
      'x-api-key': 'ak',
      'anthropic-version': '2023-06-01',
    });
  });

  it('fails over when the stream breaks before the first output byte', async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new NetworkError('TRANSPORT', 'reset'));
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    mocks.fetch
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(sse([{ id: 'c', choices: [{ delta: { content: 'B' } }] }, '[DONE]']));
    const response = await handleGateway(post(chatBody('openai/shared', { stream: true })), [
      'chat',
      'completions',
    ]);
    expect(await response.text()).toContain('"content":"B"');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not replay after output started and ends with a sanitised error frame', async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    const partial = new Response(
      new ReadableStream({
        pull(controller) {
          if (pulls++ === 0)
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ id: 'c', choices: [{ delta: { content: 'A' } }] })}\n\n`,
              ),
            );
          else controller.error(new NetworkError('TRANSPORT', 'internal 10.0.0.5 reset'));
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    mocks.fetch.mockResolvedValueOnce(partial);
    const response = await handleGateway(post(chatBody('openai/shared', { stream: true })), [
      'chat',
      'completions',
    ]);
    const text = await response.text();
    expect(text).toContain('"content":"A"');
    expect(text).toContain('Provider stream failed');
    expect(text).not.toContain('10.0.0.5');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('cancellation and deadlines', () => {
  const hang = () =>
    mocks.fetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            'abort',
            () => reject(new NetworkError('ABORTED', 'aborted')),
            { once: true },
          );
        }),
    );

  it('aborts upstream when the client disconnects', async () => {
    hang();
    const client = new AbortController();
    const pending = handleGateway(
      post(chatBody('openai/shared'), 'chat/completions', {}, client.signal),
      ['chat', 'completions'],
    );
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    client.abort();
    const response = await pending;
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(response.status).toBe(504);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('enforces the 120 second inference deadline', async () => {
    vi.useFakeTimers();
    hang();
    const pending = handleGateway(post(chatBody('openai/shared')), ['chat', 'completions']);
    await vi.advanceTimersByTimeAsync(119000);
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).status).toBe(504);
  });

  it('cancels upstream when a streaming client cancels', async () => {
    let upstreamCancelled = false;
    const encoder = new TextEncoder();
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ id: 'c', choices: [{ delta: { content: 'A' } }] })}\n\n`,
              ),
            );
          },
          cancel() {
            upstreamCancelled = true;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    const response = await handleGateway(post(chatBody('openai/shared', { stream: true })), [
      'chat',
      'completions',
    ]);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await vi.waitFor(() => expect(upstreamCancelled).toBe(true));
  });
});

describe('cooldownUntil', () => {
  const now = Date.UTC(2026, 9, 3);
  it('defaults to one minute', () =>
    expect(cooldownUntil(new Headers(), now).getTime()).toBe(now + 60000));
  it('honours Retry-After seconds and HTTP dates', () => {
    expect(cooldownUntil(new Headers({ 'retry-after': '300' }), now).getTime()).toBe(now + 300000);
    expect(
      cooldownUntil(
        new Headers({ 'retry-after': new Date(now + 600000).toUTCString() }),
        now,
      ).getTime(),
    ).toBe(now + 600000);
  });
  it('honours reset headers as durations, epochs and dates', () => {
    expect(
      cooldownUntil(new Headers({ 'x-ratelimit-reset-requests': '1m30s' }), now).getTime(),
    ).toBe(now + 90000);
    expect(
      cooldownUntil(
        new Headers({ 'x-ratelimit-reset': String((now + 900000) / 1000) }),
        now,
      ).getTime(),
    ).toBe(now + 900000);
    expect(
      cooldownUntil(
        new Headers({ 'ratelimit-reset': new Date(now + 700000).toISOString() }),
        now,
      ).getTime(),
    ).toBe(now + 700000);
  });
  it('never shortens below the default', () =>
    expect(cooldownUntil(new Headers({ 'retry-after': '1' }), now).getTime()).toBe(now + 60000));
});
