import { db } from '@/db';
import { readBoundedBody } from '@/lib/bounded-body';
import { HttpError } from '@/lib/errors';
import { rateLimit } from '@/lib/redis';
import { hasOwnerRole } from '@/lib/role-keys';
import { isActiveUser } from '@/lib/user-status';
import 'server-only';
import { z } from 'zod';
import { GATEWAY_BODY_BYTES, GATEWAY_TIMEOUT_MS, MIN_COOLDOWN_MS } from './constants';
import { getUsableCredential } from './credential';
import { ProviderConfigurationError } from './credential-errors';
import { hashGatewayKey } from './crypto';
import { providerHeaders } from './discovery';
import { availability, buildPools, pruneRotations, rotateTier, uniqueCandidates } from './pools';
import { NetworkError, safeFetch } from './network';
import {
  createClientStreamRenderer,
  createUpstreamStreamParser,
  parseGatewayRequest,
  parseUpstreamResult,
  ProtocolError,
  renderClientResult,
  renderStreamError,
  renderUpstreamRequest,
  upstreamDialect,
  type CanonicalRequest,
  type CanonicalResult,
  type CanonicalStreamEvent,
} from './protocol';
import { encodeSse, readSse, SSE_HEADERS } from './sse';
import { isProviderKind, providerDefinitions } from './types';

class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export async function readGatewayBody(request: Request, signal: AbortSignal): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new GatewayError(415, 'INVALID_CONTENT_TYPE', 'JSON content type required');
  if (Number(request.headers.get('content-length')) > GATEWAY_BODY_BYTES)
    throw new GatewayError(413, 'BODY_TOO_LARGE', 'Request exceeds 1 MiB');
  if (!request.body) throw new GatewayError(400, 'INVALID_REQUEST', 'Request body required');
  const bytes = await readBoundedBody(
    request.body,
    GATEWAY_BODY_BYTES,
    {
      tooLarge: () => new GatewayError(413, 'BODY_TOO_LARGE', 'Request exceeds 1 MiB'),
      aborted: () => new GatewayError(504, 'TIMEOUT', 'Request timed out'),
    },
    signal,
  );
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new GatewayError(400, 'INVALID_REQUEST', 'Invalid JSON body');
  }
}

/** Persistence failures are availability failures, never provider failures. */
async function gatewayStorage<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    console.error('Gateway storage unavailable', {
      kind: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpError(503, 'UNAVAILABLE', 'Service temporarily unavailable');
  }
}

async function authenticate(request: Request) {
  const match = /^Bearer (jml_[A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new GatewayError(401, 'UNAUTHORIZED', 'Invalid gateway key');
  const key = await gatewayStorage(() =>
    db.providerGatewayKey.findUnique({ where: { hash: hashGatewayKey(match[1]) } }),
  );
  if (!key || key.revokedAt) throw new GatewayError(401, 'UNAUTHORIZED', 'Invalid gateway key');
  const issuer = await gatewayStorage(() => db.user.findUnique({ where: { id: key.createdBy } }));
  if (!issuer || !isActiveUser(issuer) || !hasOwnerRole(issuer.role))
    throw new GatewayError(401, 'UNAUTHORIZED', 'Invalid gateway key');
  await rateLimit(`ml:gateway:${key.id}`, 60, 60);
  await gatewayStorage(() =>
    db.providerGatewayKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }),
  );
}

function retryable(error: unknown) {
  return (
    error instanceof NetworkError && ['TRANSPORT', 'DNS_FAILED', 'TIMEOUT'].includes(error.code)
  );
}

/** Extend a connection cooldown, never shortening a later deadline set by a concurrent request. */
async function coolDown(id: string, until: Date) {
  await gatewayStorage(() =>
    db.providerConnection.updateMany({
      where: { id, OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: until } }] },
      data: { cooldownUntil: until },
    }),
  );
}

export function cooldownUntil(headers: Headers, now = Date.now()): Date {
  const deadlines = [now + MIN_COOLDOWN_MS];
  const retry = headers.get('retry-after');
  if (retry) {
    const seconds = Number(retry);
    const deadline = Number.isFinite(seconds)
      ? now + Math.max(0, seconds) * 1000
      : Date.parse(retry);
    if (Number.isFinite(deadline)) deadlines.push(deadline);
  }
  for (const name of [
    'x-ratelimit-reset',
    'ratelimit-reset',
    'x-ratelimit-reset-requests',
    'x-ratelimit-reset-tokens',
  ]) {
    const value = headers.get(name);
    if (!value) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      deadlines.push(
        numeric > 1e12
          ? numeric
          : numeric > 1e9
            ? numeric * 1000
            : now + Math.max(0, numeric) * 1000,
      );
    } else {
      const duration =
        /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/.exec(
          value,
        );
      if (duration && duration[0])
        deadlines.push(
          now +
            (Number(duration[1] ?? 0) * 3600000 +
              Number(duration[2] ?? 0) * 60000 +
              Number(duration[3] ?? 0) * 1000 +
              Number(duration[4] ?? 0)),
        );
      else if (Number.isFinite(Date.parse(value))) deadlines.push(Date.parse(value));
    }
  }
  return new Date(Math.max(...deadlines));
}

async function* streamEvents(
  response: Response,
  provider: string,
): AsyncGenerator<CanonicalStreamEvent> {
  const parser = createUpstreamStreamParser(upstreamDialect(provider));
  for await (const frame of readSse(response.body)) {
    if (!frame.data) continue;
    for (const event of parser.parse(frame.data)) yield event;
    if (parser.completed) return;
  }
  if (!parser.completed)
    throw new ProtocolError('UPSTREAM_PROTOCOL', 'Upstream stream ended prematurely');
}

async function collectStream(
  events: AsyncGenerator<CanonicalStreamEvent>,
  model: string,
): Promise<CanonicalResult> {
  const result: CanonicalResult = {
    id: crypto.randomUUID(),
    model,
    createdAt: Math.floor(Date.now() / 1000),
    text: '',
    toolCalls: [],
    finishReason: 'stop',
  };
  const tools = new Map<number, CanonicalResult['toolCalls'][number]>();
  for await (const event of events) {
    if (event.type === 'start') result.id = event.id;
    else if (event.type === 'text.delta') result.text += event.text;
    else if (event.type === 'tool_call.start')
      tools.set(event.index, { id: event.id, name: event.name, arguments: '' });
    else if (event.type === 'tool_call.delta') {
      const tool = tools.get(event.index);
      if (tool) tool.arguments += event.argumentsDelta;
    } else if (event.type === 'finish') {
      result.finishReason = event.finishReason;
      result.usage = event.usage;
    } else if (event.type === 'usage') result.usage = event.usage;
  }
  result.toolCalls = Array.from(tools.values());
  return result;
}

function clientStream(
  events: AsyncGenerator<CanonicalStreamEvent>,
  firstFrames: { event?: string; data: string }[],
  renderer: ReturnType<typeof createClientStreamRenderer>,
  request: CanonicalRequest,
  controller: AbortController,
  cleanup: () => void,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(output) {
      for (const frame of firstFrames) output.enqueue(encoder.encode(encodeSse(frame)));
    },
    async pull(output) {
      if (closed) return;
      try {
        const next = await events.next();
        const frames = next.done ? renderer.finish() : renderer.render(next.value);
        if (closed) return;
        for (const frame of frames) output.enqueue(encoder.encode(encodeSse(frame)));
        if (next.done) {
          closed = true;
          cleanup();
          output.close();
        }
      } catch (error) {
        console.error('Gateway stream failed', {
          kind: error instanceof Error ? error.name : 'UnknownError',
        });
        if (closed) return;
        closed = true;
        for (const frame of renderStreamError(
          request.dialect,
          'UPSTREAM_ERROR',
          'Provider stream failed',
        ))
          output.enqueue(encoder.encode(encodeSse(frame)));
        cleanup();
        controller.abort();
        output.close();
      }
    },
    async cancel() {
      closed = true;
      controller.abort();
      cleanup();
      await events.return(undefined).catch(() => {});
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

export async function handleGateway(request: Request, path: string[]): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  let streaming = false;
  const cleanup = () => {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
  };
  try {
    await authenticate(request);
    const endpoint = path.join('/');
    const connections = await gatewayStorage(() =>
      db.providerConnection.findMany({
        include: { models: true },
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      }),
    );
    const index = buildPools(connections);
    pruneRotations(
      new Set([
        ...[...index.pools.keys()].map((id) => `pool:${id}`),
        ...[...index.legacy.keys()].map((id) => `legacy:${id}`),
      ]),
    );
    if (request.method === 'GET' && endpoint === 'models') {
      const ids = [...index.pools]
        .filter(
          ([id, members]) =>
            index.advertised(id) &&
            members.some(
              ({ connection, model }) =>
                connection.enabled && connection.status === 'ready' && model.enabled,
            ),
        )
        .map(([id]) => id)
        .sort();
      return json({
        object: 'list',
        data: ids.map((id) => ({ id, object: 'model', created: 0, owned_by: 'jarxis' })),
      });
    }
    if (request.method !== 'POST' || !['chat/completions', 'responses'].includes(endpoint))
      throw new GatewayError(404, 'NOT_FOUND', 'Unknown gateway endpoint');
    const payload = await readGatewayBody(request, controller.signal);
    const parsed = parseGatewayRequest(endpoint === 'responses' ? 'responses' : 'chat', payload);
    const legacy = index.legacy.has(parsed.publicModelId);
    if (!legacy && index.ambiguous(parsed.publicModelId))
      throw new GatewayError(
        409,
        'AMBIGUOUS_MODEL',
        'Model name is ambiguous; use a distinct alias',
      );
    const scope = `${legacy ? 'legacy' : 'pool'}:${parsed.publicModelId}`;
    const members = (legacy ? index.legacy : index.pools).get(parsed.publicModelId) ?? [];
    const enabled = members.filter(({ connection, model }) => connection.enabled && model.enabled);
    if (!enabled.length) throw new GatewayError(404, 'MODEL_NOT_FOUND', 'Model is unavailable');
    const candidates = uniqueCandidates(
      enabled.filter(({ connection, model }) => availability(connection, model) === 'ready'),
      parsed.publicModelId,
    );
    if (!candidates.length)
      throw new GatewayError(502, 'UPSTREAM_UNAVAILABLE', 'No provider is available');
    const compatible = candidates.flatMap((candidate) => {
      try {
        return [
          {
            ...candidate,
            body: renderUpstreamRequest(
              { ...parsed, model: candidate.model.upstreamId },
              candidate.connection.provider,
            ),
          },
        ];
      } catch (error) {
        if (error instanceof ProtocolError && error.code === 'UNSUPPORTED') return [];
        throw error;
      }
    });
    if (!compatible.length)
      throw new ProtocolError('UNSUPPORTED', 'No connection supports this request');
    const priorities = [...new Set(compatible.map(({ connection }) => connection.priority))].sort(
      (a, b) => a - b,
    );
    function* ordered() {
      for (const priority of priorities) {
        const tier = compatible.filter(({ connection }) => connection.priority === priority);
        // Reserve the next start synchronously, before credentials or network work.
        for (const candidate of rotateTier(scope, priority, tier)) yield candidate;
      }
    }
    for (const { connection, body } of ordered()) {
      if (controller.signal.aborted) throw new GatewayError(504, 'TIMEOUT', 'Request timed out');
      let response: Response | undefined;
      try {
        let credential: Awaited<ReturnType<typeof getUsableCredential>>;
        try {
          credential = await getUsableCredential(connection);
        } catch (error) {
          if (error instanceof ProviderConfigurationError) {
            console.error('Gateway encryption configuration unavailable', { kind: error.name });
            throw new HttpError(503, 'UNAVAILABLE', 'Service temporarily unavailable');
          }
          if (controller.signal.aborted)
            throw new GatewayError(504, 'TIMEOUT', 'Request timed out');
          continue;
        }
        response = await safeFetch(
          `${connection.baseUrl.replace(/\/$/, '')}/${isProviderKind(connection.provider) ? providerDefinitions[connection.provider].endpoint : 'chat/completions'}`,
          {
            method: 'POST',
            headers: {
              ...providerHeaders(connection.provider, credential),
              'Content-Type': 'application/json',
              Accept: body.stream ? 'text/event-stream' : 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401) {
            await gatewayStorage(() =>
              db.providerConnection.updateMany({
                where: { id: connection.id, encryptedCredential: connection.encryptedCredential },
                data: { status: 'reconnect_required' },
              }),
            );
            continue;
          }
          if (response.status === 429 || response.status >= 500) {
            await coolDown(connection.id, cooldownUntil(response.headers));
            continue;
          }
          throw new GatewayError(502, 'UPSTREAM_ERROR', 'Provider rejected request');
        }
        if (body.stream) {
          if (!response.headers.get('content-type')?.includes('text/event-stream'))
            throw new ProtocolError('UPSTREAM_PROTOCOL', 'Invalid provider stream');
          const events = streamEvents(response, connection.provider);
          if (!parsed.stream) {
            const result = await collectStream(events, parsed.publicModelId);
            return json(renderClientResult(parsed.dialect, result, parsed.publicModelId));
          }
          const includeUsage = parsed.includeUsage;
          const renderer = createClientStreamRenderer(parsed, { includeUsage });
          let firstFrames: { event?: string; data: string }[] = [];
          while (!firstFrames.length) {
            const next = await events.next();
            if (next.done) throw new ProtocolError('UPSTREAM_PROTOCOL', 'Empty provider stream');
            firstFrames = renderer.render(next.value);
          }
          streaming = true;
          return clientStream(events, firstFrames, renderer, parsed, controller, cleanup);
        }
        const result = parseUpstreamResult(
          await response.json(),
          upstreamDialect(connection.provider),
        );
        return json(renderClientResult(parsed.dialect, result, parsed.publicModelId));
      } catch (error) {
        await response?.body?.cancel().catch(() => {});
        if (retryable(error) && !controller.signal.aborted) {
          await coolDown(connection.id, new Date(Date.now() + MIN_COOLDOWN_MS));
          continue;
        }
        throw error;
      }
    }
    throw new GatewayError(502, 'UPSTREAM_UNAVAILABLE', 'No provider is available');
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof GatewayError)
      return json({ error: { code: error.code, message: error.message } }, error.status);
    if (
      (error instanceof ProtocolError && error.code !== 'UPSTREAM_PROTOCOL') ||
      error instanceof z.ZodError
    )
      return json(
        { error: { code: 'INVALID_REQUEST', message: 'Invalid or unsupported request' } },
        400,
      );
    console.error('Gateway request failed', {
      kind: error instanceof Error ? error.name : 'UnknownError',
    });
    const status = controller.signal.aborted
      ? 504
      : error && typeof error === 'object' && 'status' in error && error.status === 429
        ? 429
        : 502;
    return json(
      {
        error: {
          code: status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
          message: status === 429 ? 'Too many requests' : 'Gateway request failed',
        },
      },
      status,
    );
  } finally {
    if (!streaming) {
      cleanup();
      controller.abort();
    }
  }
}
