import { db } from '@/db';
import 'server-only';
import { z } from 'zod';
import { lockConnection } from './connection-lock';
import { DISCOVERY_TIMEOUT_MS } from './constants';
import { getUsableCredential } from './credential';
import { CredentialError } from './credential-errors';
import {
  discoveryFailureMessage,
  encodeDiscoveryFailure,
  type DiscoveryFailureReason,
} from './errors';
import { NetworkError, safeFetch } from './network';
import { providerKinds, type Credential } from './types';

export function providerHeaders(provider: string, credential: Credential): Record<string, string> {
  if (!providerKinds.some((kind) => kind === provider) || !credential.apiKey)
    throw new Error('Provider requires an API key');
  if (provider === 'anthropic')
    return { 'x-api-key': credential.apiKey, 'anthropic-version': '2023-06-01' };
  return { Authorization: `Bearer ${credential.apiKey}` };
}

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
      const payload = z
        .object({
          data: z.array(
            z.object({ id: z.string().min(1).max(256), display_name: z.string().optional() }),
          ),
          has_more: z.boolean().optional(),
          last_id: z.string().optional(),
        })
        .parse(await response.json());
      const catalog = payload.data;
      if (!Array.isArray(catalog)) throw new Error('Invalid catalog');
      for (const item of catalog) {
        const modelId = item.id;
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

type DiscoverySnapshot = {
  id: string;
  discoveryRevision: number;
  baseUrl: string;
  provider: string;
  encryptedCredential: string | null;
  enabled: boolean;
  status: string;
};

function matchesSnapshot(
  connection: DiscoverySnapshot | null,
  snapshot: DiscoverySnapshot,
): connection is DiscoverySnapshot {
  return (
    !!connection &&
    connection.id === snapshot.id &&
    connection.discoveryRevision === snapshot.discoveryRevision &&
    connection.baseUrl === snapshot.baseUrl &&
    connection.provider === snapshot.provider &&
    connection.encryptedCredential === snapshot.encryptedCredential &&
    connection.enabled === snapshot.enabled &&
    connection.status === snapshot.status
  );
}

async function recordResult(
  snapshot: DiscoverySnapshot,
  status: 'ok' | 'unsupported' | 'failed',
  error: string | null,
  models?: DiscoveredModel[],
) {
  await db.$transaction(async (transaction) => {
    await lockConnection(transaction, snapshot.id);
    const current = await transaction.providerConnection.findUnique({
      where: { id: snapshot.id },
    });
    if (!matchesSnapshot(current, snapshot)) return;

    if (status === 'ok') {
      const catalog = models ?? [];
      for (const model of catalog)
        await transaction.providerModel.upsert({
          where: {
            connectionId_upstreamId: { connectionId: snapshot.id, upstreamId: model.id },
          },
          create: {
            connectionId: snapshot.id,
            upstreamId: model.id,
            displayName: model.name,
            discovered: true,
          },
          // Preserve the owner's alias and enabled selection on models that survive discovery.
          update: { displayName: model.name },
        });
      await transaction.providerModel.deleteMany({
        where: {
          connectionId: snapshot.id,
          discovered: true,
          upstreamId: { notIn: catalog.map((model) => model.id) },
        },
      });
      await transaction.providerConnection.update({
        where: { id: snapshot.id },
        data: {
          discoveryStatus: 'ok',
          discoveryError: null,
          lastDiscoveredAt: new Date(),
        },
      });
      return;
    }
    // Failures preserve the last successful catalog.
    await transaction.providerConnection.update({
      where: { id: snapshot.id },
      data: { discoveryStatus: status, discoveryError: error },
    });
  });
}

export async function refreshConnection(id: string, signal?: AbortSignal): Promise<void> {
  const connection = await db.$transaction(async (transaction) => {
    await lockConnection(transaction, id);
    const current = await transaction.providerConnection.findUnique({ where: { id } });
    if (!current || !current.enabled || current.status !== 'ready') return null;
    // Each request gets a new generation so a newer discovery supersedes any older in-flight run.
    return transaction.providerConnection.update({
      where: { id },
      data: { discoveryRevision: { increment: 1 } },
    });
  });
  if (!connection) return;
  const snapshot: DiscoverySnapshot = {
    id: connection.id,
    discoveryRevision: connection.discoveryRevision,
    baseUrl: connection.baseUrl,
    provider: connection.provider,
    encryptedCredential: connection.encryptedCredential,
    enabled: connection.enabled,
    status: connection.status,
  };
  try {
    const credential = await getUsableCredential(connection);
    const result = await discoverModels(
      connection.provider,
      connection.baseUrl,
      credential,
      signal,
    );
    if (result.status !== 'ok') {
      await recordResult(
        snapshot,
        result.status,
        result.reason ? encodeDiscoveryFailure(result.reason, result.httpStatus) : null,
      );
      return;
    }
    await recordResult(snapshot, 'ok', null, result.models);
  } catch (error) {
    console.error('Provider discovery refresh failed', {
      kind: error instanceof Error ? error.name : 'UnknownError',
    });
    await recordResult(
      snapshot,
      'failed',
      encodeDiscoveryFailure(error instanceof CredentialError ? 'credential' : 'unavailable'),
    );
  }
}
