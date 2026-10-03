import 'server-only';
import { db } from '@/db';
import { decryptCredential } from './crypto';
import { getUsableCredential } from './login';
import {
  discoveryFailureMessage,
  encodeDiscoveryFailure,
  type DiscoveryFailureReason,
} from './errors';
import { NetworkError, safeFetch } from './network';
import type { Credential } from './types';

export function providerHeaders(provider: string, credential: Credential): Record<string, string> {
  const token = credential.apiKey ?? credential.accessToken;
  if (!token) throw new Error('Provider requires reconnect');
  if (provider === 'anthropic') return { 'x-api-key': token, 'anthropic-version': '2023-06-01' };
  if (provider === 'claude')
    return {
      Authorization: `Bearer ${token}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
    };
  return {
    Authorization: `Bearer ${token}`,
    ...(provider === 'codex'
      ? {
          'ChatGPT-Account-Id': credential.accountId ?? '',
          'OpenAI-Beta': 'responses=experimental',
          originator: 'codex_cli_rs',
        }
      : {}),
  };
}

const DISCOVERY_TIMEOUT_MS = 15000;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_PAGES = 20;
const MAX_CATALOG_MODELS = 5000;
const emptyResult: DiscoveryResult = {
  status: 'ok',
  models: [],
  error: null,
  reason: null,
  httpStatus: null,
  retryAfterSeconds: null,
};

export type DiscoveredModel = { id: string; name: string };
export type DiscoveryResult = {
  status: 'ok' | 'unsupported' | 'failed';
  models: DiscoveredModel[];
  error: string | null;
  /** Set only for failures: a code the UI maps to fixed copy. */
  reason: DiscoveryFailureReason | null;
  /** Upstream HTTP status for failures that had one; an integer, never response text. */
  httpStatus: number | null;
  retryAfterSeconds: number | null;
};

class DiscoveryFailure extends Error {
  constructor(
    readonly reason: DiscoveryFailureReason,
    readonly httpStatus: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(reason);
  }
}

/** `Retry-After` as whole seconds (delta or HTTP date), capped at a day; anything else is null. */
function retryAfter(headers: Headers): number | null {
  const value = headers.get('retry-after');
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.ceil(seconds)) : null;
}

function classify(error: unknown, timedOut: boolean): DiscoveryFailure {
  if (error instanceof DiscoveryFailure) return error;
  if (error instanceof NetworkError) {
    if (error.code === 'DESTINATION_REJECTED' || error.code === 'REDIRECT')
      return new DiscoveryFailure('endpoint_rejected');
    if (error.code === 'DNS_FAILED' || error.code === 'TRANSPORT')
      return new DiscoveryFailure('unreachable');
    if (error.code === 'TOO_LARGE') return new DiscoveryFailure('invalid_catalog');
    return new DiscoveryFailure('timeout');
  }
  // JSON parse failures and malformed catalogs land here; an expired deadline does not.
  return new DiscoveryFailure(timedOut ? 'timeout' : 'invalid_catalog');
}

const failed = (failure: DiscoveryFailure): DiscoveryResult => ({
  status: 'failed',
  models: [],
  error: discoveryFailureMessage(failure.reason, failure.httpStatus, failure.retryAfterSeconds),
  reason: failure.reason,
  httpStatus: failure.httpStatus,
  retryAfterSeconds: failure.retryAfterSeconds,
});

/**
 * Reads an authenticated provider catalog. The whole run, every page included, shares one
 * 15-second deadline and the caller's signal. Failures never carry upstream text.
 */
export async function discoverModels(
  provider: string,
  baseUrl: string,
  credential: Credential,
  signal?: AbortSignal,
): Promise<DiscoveryResult> {
  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    let headers: Record<string, string>;
    try {
      headers = providerHeaders(provider, credential);
    } catch {
      throw new DiscoveryFailure('credential');
    }
    const models = new Map<string, string>();
    let after: string | undefined;
    for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
      const remaining = deadline - Date.now();
      if (combined.aborted || remaining <= 0) throw new DiscoveryFailure('timeout');
      const url = new URL(`${baseUrl.replace(/\/$/, '')}/models`);
      if (provider === 'codex') url.searchParams.set('client_version', '0.160.0');
      if (after) url.searchParams.set('after_id', after);
      const response = await safeFetch(url, {
        headers,
        signal: combined,
        timeoutMs: remaining,
        maxResponseBytes: MAX_CATALOG_BYTES,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([404, 405, 501].includes(response.status))
          return { ...emptyResult, status: 'unsupported' };
        if (response.status === 401 || response.status === 403)
          throw new DiscoveryFailure('auth', response.status);
        if (response.status === 429)
          throw new DiscoveryFailure('rate_limited', 429, retryAfter(response.headers));
        throw new DiscoveryFailure('provider_error', response.status);
      }
      const payload = (await response.json()) as {
        data?: { id?: unknown; display_name?: unknown }[];
        models?: { slug?: unknown; display_name?: unknown; visibility?: unknown }[];
        has_more?: boolean;
        last_id?: string;
      };
      const catalog = provider === 'codex' ? payload.models : payload.data;
      if (!Array.isArray(catalog)) throw new Error('Invalid catalog');
      for (const item of catalog) {
        if ('visibility' in item && item.visibility === 'hide') continue;
        const modelId = 'slug' in item ? item.slug : 'id' in item ? item.id : undefined;
        if (typeof modelId !== 'string' || !modelId || modelId.length > 256)
          throw new Error('Invalid catalog');
        if (models.has(modelId)) continue;
        if (models.size >= MAX_CATALOG_MODELS) throw new Error('Catalog too large');
        models.set(
          modelId,
          typeof item.display_name === 'string' ? item.display_name.slice(0, 256) : modelId,
        );
      }
      if (!payload.has_more)
        return { ...emptyResult, models: [...models].map(([id, name]) => ({ id, name })) };
      if (!payload.last_id || payload.last_id === after || page === MAX_CATALOG_PAGES - 1)
        throw new Error('Incomplete catalog');
      after = payload.last_id;
    }
    throw new Error('Incomplete catalog');
  } catch (error) {
    return failed(classify(error, timeout.aborted && !signal?.aborted));
  }
}

export async function refreshConnection(id: string, force = false): Promise<void> {
  let connection = await db.mlConnection.findUnique({ where: { id } });
  if (!connection || !connection.enabled || connection.status !== 'ready') return;
  const now = new Date();
  const nextDiscoveryAt = new Date(Date.now() + 3600000);
  // A forced run claims the exact due date it read, so it still loses to any concurrent claim.
  const claimed = await db.mlConnection.updateMany({
    where: {
      id,
      enabled: true,
      status: 'ready',
      nextDiscoveryAt: force ? connection.nextDiscoveryAt : { lte: now },
    },
    data: { nextDiscoveryAt },
  });
  if (!claimed.count) return;
  let snapshot = {
    id,
    baseUrl: connection.baseUrl,
    encryptedCredential: connection.encryptedCredential,
    status: 'ready',
    enabled: true,
    nextDiscoveryAt,
  };
  // Failures keep the last catalog and only touch the row this run claimed.
  const recordFailure = (status: 'unsupported' | 'failed', error: string | null) =>
    db.mlConnection.updateMany({
      where: snapshot,
      data: { discoveryStatus: status, discoveryError: error, nextDiscoveryAt },
    });
  try {
    const credential = await getUsableCredential(connection);
    const previous = connection;
    connection = await db.mlConnection.findUnique({ where: { id } });
    if (
      !connection ||
      connection.baseUrl !== previous.baseUrl ||
      connection.provider !== previous.provider ||
      !connection.encryptedCredential ||
      !connection.enabled ||
      connection.status !== 'ready' ||
      connection.nextDiscoveryAt.getTime() !== nextDiscoveryAt.getTime()
    )
      return;
    const currentCredential = decryptCredential<Credential>(connection.encryptedCredential, id);
    if (
      currentCredential.apiKey !== credential.apiKey ||
      currentCredential.accessToken !== credential.accessToken ||
      currentCredential.accountId !== credential.accountId
    )
      return;
    snapshot = {
      ...snapshot,
      baseUrl: connection.baseUrl,
      encryptedCredential: connection.encryptedCredential,
    };
    const result = await discoverModels(connection.provider, connection.baseUrl, credential);
    if (result.status !== 'ok') {
      await recordFailure(
        result.status,
        result.reason ? encodeDiscoveryFailure(result.reason, result.httpStatus) : null,
      );
      return;
    }
    const models = result.models;
    await db.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ml:connection:${id}`}, 0))`;
      const current = await transaction.mlConnection.findUnique({ where: { id } });
      if (
        !current ||
        current.baseUrl !== snapshot.baseUrl ||
        current.encryptedCredential !== snapshot.encryptedCredential ||
        current.status !== 'ready' ||
        !current.enabled ||
        current.nextDiscoveryAt.getTime() !== nextDiscoveryAt.getTime()
      )
        return;
      for (const model of models)
        await transaction.mlModel.upsert({
          where: { connectionId_upstreamId: { connectionId: id, upstreamId: model.id } },
          create: {
            connectionId: id,
            upstreamId: model.id,
            displayName: model.name,
            discovered: true,
          },
          update: { displayName: model.name },
        });
      await transaction.mlModel.deleteMany({
        where: {
          connectionId: id,
          discovered: true,
          upstreamId: { notIn: models.map((model) => model.id) },
        },
      });
      await transaction.mlConnection.update({
        where: { id },
        data: {
          discoveryStatus: 'ok',
          discoveryError: null,
          lastDiscoveredAt: new Date(),
          nextDiscoveryAt,
        },
      });
    });
  } catch {
    // Credential refresh or storage failures, not the catalog request itself.
    await recordFailure('failed', encodeDiscoveryFailure('credential'));
  }
}
