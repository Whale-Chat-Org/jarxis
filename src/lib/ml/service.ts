import 'server-only';
import { randomUUID } from 'node:crypto';
import type { MlConnection, MlGatewayKey, MlLoginJob, MlModel } from '@prisma/client';
import { db, type Transaction } from '@/db';
import { HttpError } from '@/lib/errors';
import { parseRoles } from '@/lib/permissions';
import { activeUserWhere } from '@/lib/rbac';
import { encryptCredential, mintGatewayKey } from './crypto';
import { discoverModels } from './discovery';
import { validateDestination } from './network';
import { defaultBaseUrl, isSubscription, type ProviderKind } from './types';
import { storedDiscoveryFailureMessage } from './errors';
import { poolModelId } from './model-id';
import {
  createConnectionSchema,
  updateConnectionSchema,
  modelIdSchema,
  gatewayKeySchema,
  loginInputSchema,
  discoveryPreviewSchema,
  type CreateConnectionInput,
  type DiscoveryPreviewInput,
  type UpdateConnectionInput,
} from './validation';

const activeJobs = ['queued', 'running', 'waiting'];
const connectionInclude = {
  models: { orderBy: { upstreamId: 'asc' as const } },
  loginJobs: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};
function missing(): never {
  throw new HttpError(404, 'NOT_FOUND', 'ML resource not found');
}
function conflict(): never {
  throw new HttpError(409, 'LOGIN_STATE', 'Login is not accepting this action');
}

async function owner(transaction: Transaction, actorId: string) {
  const user = await transaction.user.findFirst({
    where: { id: actorId, ...activeUserWhere() },
    select: { role: true },
  });
  if (!user || !parseRoles(user.role).includes('owner'))
    throw new HttpError(403, 'FORBIDDEN', 'Active verified owner required');
}
async function audit(
  transaction: Transaction,
  actorId: string,
  action: string,
  targetId: string,
  changes: Record<string, string | number | boolean>,
) {
  await transaction.auditLog.create({
    data: { id: randomUUID(), actorId, action: `ml:${action}`, targetId, changes },
  });
}
async function lockConnection(transaction: Transaction, id: string) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ml:connection:${id}`}, 0))`;
}

export function loginDto(job: MlLoginJob, interactive = true) {
  let loginUrl: string | null = null;
  if (
    interactive &&
    job.loginUrl &&
    activeJobs.includes(job.status) &&
    job.expiresAt > new Date()
  ) {
    try {
      const url = new URL(job.loginUrl);
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !url.port &&
        job.loginUrl.length <= 4096 &&
        ((url.hostname === 'auth.openai.com' && url.pathname === '/codex/device') ||
          (['claude.ai', 'console.anthropic.com', 'platform.claude.com'].includes(url.hostname) &&
            ['/oauth/authorize', '/oauth/authorize/'].includes(url.pathname))) &&
        [...url.searchParams.keys()].every((key) =>
          [
            'client_id',
            'response_type',
            'redirect_uri',
            'scope',
            'state',
            'code_challenge',
            'code_challenge_method',
            'organization_uuid',
          ].includes(key),
        )
      )
        loginUrl = url.toString();
    } catch {}
  }
  return {
    id: job.id,
    connectionId: job.connectionId,
    ownerId: job.ownerId,
    status: job.status,
    expiresAt: job.expiresAt.toISOString(),
    loginUrl,
    instructions: loginUrl
      ? job.instructions &&
        /^Open the vendor login page and enter device code [A-Z0-9]{4,5}-[A-Z0-9]{4,5}\.$/.test(
          job.instructions,
        )
        ? job.instructions
        : 'Open the vendor login page, then paste its authorization code here if requested.'
      : null,
    error: job.error ? 'Sign in failed. Start a new login to reconnect.' : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
export function connectionDto(
  connection: MlConnection & { models: MlModel[]; loginJobs: MlLoginJob[] },
) {
  return {
    id: connection.id,
    name: connection.name,
    provider: connection.provider as ProviderKind,
    baseUrl: connection.baseUrl,
    enabled: connection.enabled,
    priority: connection.priority,
    status: connection.status,
    hasCredential: !!connection.encryptedCredential,
    discoveryStatus: connection.discoveryStatus,
    // Stored as a reason code; only fixed copy derived from it ever leaves the server.
    discoveryError: connection.discoveryError
      ? storedDiscoveryFailureMessage(connection.discoveryError)
      : null,
    lastDiscoveredAt: connection.lastDiscoveredAt?.toISOString() ?? null,
    nextDiscoveryAt: connection.nextDiscoveryAt.toISOString(),
    cooldownUntil: connection.cooldownUntil?.toISOString() ?? null,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
    models: connection.models.map((model) => ({
      id: model.id,
      connectionId: model.connectionId,
      upstreamId: model.upstreamId,
      publicId: poolModelId(connection, model.upstreamId),
      displayName: model.displayName,
      enabled: model.enabled,
      discovered: model.discovered,
      createdAt: model.createdAt.toISOString(),
    })),
    // The pool is shared by owners, but the login flow belongs only to its initiator.
    loginJob: connection.loginJobs[0] ? loginDto(connection.loginJobs[0], false) : null,
  };
}
export function gatewayKeyDto(record: MlGatewayKey) {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    createdBy: record.createdBy,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}
export type ConnectionDto = ReturnType<typeof connectionDto>;
export type LoginDto = ReturnType<typeof loginDto>;
export type GatewayKeyDto = ReturnType<typeof gatewayKeyDto>;

export async function listConnections() {
  return (
    await db.mlConnection.findMany({
      include: connectionInclude,
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
  ).map(connectionDto);
}
export async function getConnection(id: string) {
  const connection = await db.mlConnection.findUnique({
    where: { id },
    include: connectionInclude,
  });
  if (!connection) missing();
  return connectionDto(connection);
}
/** Destination failures are owner input errors, so report them as 400 rather than a 503. */
async function assertPublicEndpoint(
  baseUrl: string,
  options?: Parameters<typeof validateDestination>[1],
) {
  try {
    await validateDestination(baseUrl, options);
  } catch {
    throw new HttpError(400, 'INVALID_ENDPOINT', 'Endpoint must be a public HTTPS destination');
  }
}
export async function previewDiscovery(input: DiscoveryPreviewInput, signal?: AbortSignal) {
  const value = discoveryPreviewSchema.parse(input);
  const baseUrl = value.baseUrl ?? defaultBaseUrl(value.provider);
  const timeout = AbortSignal.timeout(15000);
  const discoverySignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  await assertPublicEndpoint(baseUrl, { signal: discoverySignal, timeoutMs: 15000 });
  const { status, models, error, reason, httpStatus, retryAfterSeconds } = await discoverModels(
    value.provider,
    baseUrl,
    { apiKey: value.apiKey },
    discoverySignal,
  );
  return { status, models, error, reason, httpStatus, retryAfterSeconds };
}
export async function createConnection(
  actorId: string,
  input: CreateConnectionInput,
  deferDiscovery = false,
) {
  const value = createConnectionSchema.parse(input);
  const baseUrl = value.baseUrl ?? defaultBaseUrl(value.provider);
  if (isSubscription(value.provider) && baseUrl !== defaultBaseUrl(value.provider))
    throw new HttpError(400, 'INVALID_ENDPOINT', 'Subscription endpoint is fixed');
  await assertPublicEndpoint(baseUrl);
  const id = randomUUID();
  const encryptedCredential = value.apiKey ? encryptCredential({ apiKey: value.apiKey }, id) : null;
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    const connection = await transaction.mlConnection.create({
      data: {
        id,
        name: value.name,
        provider: value.provider,
        baseUrl,
        priority: value.priority ?? 0,
        createdBy: actorId,
        encryptedCredential,
        status: encryptedCredential ? 'ready' : 'pending',
        // A deferred keyed connection stays out of the worker's reach while the create request
        // runs the first discovery itself; the worker picks it up later if that request dies.
        nextDiscoveryAt: deferDiscovery && value.apiKey ? new Date(Date.now() + 15000) : new Date(),
        models: {
          create: [...new Set(value.manualModels ?? [])].map((upstreamId) => ({
            upstreamId,
            displayName: upstreamId,
            discovered: false,
          })),
        },
      },
      include: connectionInclude,
    });
    await audit(transaction, actorId, 'connection:create', id, {
      provider: value.provider,
      credentialSupplied: !!value.apiKey,
    });
    return connectionDto(connection);
  });
}
export async function updateConnection(actorId: string, id: string, input: UpdateConnectionInput) {
  const value = updateConnectionSchema.parse(input);
  if (value.baseUrl) await assertPublicEndpoint(value.baseUrl);
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    const previous = await transaction.mlConnection.findUnique({ where: { id } });
    if (!previous) missing();
    if (
      isSubscription(previous.provider) &&
      (value.apiKey ||
        (value.baseUrl && value.baseUrl !== defaultBaseUrl(previous.provider as ProviderKind)))
    )
      throw new HttpError(
        400,
        'INVALID_CREDENTIAL',
        'Subscription providers require vendor sign in and endpoint',
      );
    const { apiKey, ...fields } = value;
    const reset = !!apiKey || !!value.baseUrl;
    if (apiKey)
      await transaction.mlLoginJob.updateMany({
        where: { connectionId: id, status: { in: activeJobs } },
        data: { status: 'canceled', encryptedInput: null, encryptedState: null },
      });
    const connection = await transaction.mlConnection.update({
      where: { id },
      data: {
        ...fields,
        ...(apiKey
          ? {
              encryptedCredential: encryptCredential({ apiKey }, id),
              status: 'ready',
              cooldownUntil: null,
            }
          : {}),
        ...(reset
          ? { nextDiscoveryAt: new Date(), discoveryStatus: 'pending', discoveryError: null }
          : {}),
      },
      include: connectionInclude,
    });
    await audit(transaction, actorId, 'connection:update', id, {
      credentialReplaced: !!apiKey,
      endpointChanged: !!value.baseUrl,
      fields: Object.keys(fields).join(','),
    });
    return connectionDto(connection);
  });
}
export async function deleteConnection(actorId: string, id: string) {
  await db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    if (!(await transaction.mlConnection.deleteMany({ where: { id } })).count) missing();
    await audit(transaction, actorId, 'connection:delete', id, {});
  });
}
export async function scheduleRefresh(actorId: string, id: string) {
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    if (!(await transaction.mlConnection.findUnique({ where: { id }, select: { id: true } })))
      missing();
    const connection = await transaction.mlConnection.update({
      where: { id },
      data: { nextDiscoveryAt: new Date(), discoveryStatus: 'pending', discoveryError: null },
      include: connectionInclude,
    });
    await audit(transaction, actorId, 'connection:refresh', id, {});
    return connectionDto(connection);
  });
}
export async function addManualModel(actorId: string, id: string, upstreamId: string) {
  const model = modelIdSchema.parse(upstreamId);
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    if (!(await transaction.mlConnection.findUnique({ where: { id }, select: { id: true } })))
      missing();
    await transaction.mlModel.upsert({
      where: { connectionId_upstreamId: { connectionId: id, upstreamId: model } },
      create: { connectionId: id, upstreamId: model, displayName: model, discovered: false },
      update: { discovered: false },
    });
    await audit(transaction, actorId, 'model:add', id, { upstreamId: model });
    const connection = await transaction.mlConnection.findUnique({
      where: { id },
      include: connectionInclude,
    });
    if (!connection) missing();
    return connectionDto(connection);
  });
}
export async function listGatewayKeys() {
  return (await db.mlGatewayKey.findMany({ orderBy: { createdAt: 'desc' } })).map(gatewayKeyDto);
}
export async function issueGatewayKey(actorId: string, name: string) {
  const value = gatewayKeySchema.parse({ name });
  const minted = mintGatewayKey();
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    const record = await transaction.mlGatewayKey.create({
      data: { name: value.name, prefix: minted.prefix, hash: minted.hash, createdBy: actorId },
    });
    await audit(transaction, actorId, 'key:issue', record.id, {});
    return { key: minted.key, record: gatewayKeyDto(record) };
  });
}
export async function revokeGatewayKey(actorId: string, id: string) {
  await db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    if (!(await transaction.mlGatewayKey.findUnique({ where: { id }, select: { id: true } })))
      missing();
    await transaction.mlGatewayKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(transaction, actorId, 'key:revoke', id, {});
  });
}
export async function startLogin(actorId: string, id: string) {
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    const connection = await transaction.mlConnection.findUnique({ where: { id } });
    if (!connection) missing();
    if (!isSubscription(connection.provider))
      throw new HttpError(400, 'LOGIN_UNSUPPORTED', 'This provider uses an API key');
    await transaction.mlLoginJob.updateMany({
      where: { connectionId: id, status: { in: activeJobs } },
      data: { status: 'canceled', encryptedInput: null, encryptedState: null },
    });
    const job = await transaction.mlLoginJob.create({
      data: { connectionId: id, ownerId: actorId, expiresAt: new Date(Date.now() + 600000) },
    });
    await audit(transaction, actorId, 'login:start', job.id, { connectionId: id });
    return loginDto(job);
  });
}
export async function getLogin(actorId: string, id: string) {
  const job = await db.mlLoginJob.findFirst({ where: { id, ownerId: actorId } });
  if (!job) missing();
  return loginDto(job);
}
export async function submitLogin(actorId: string, id: string, input: string) {
  const value = loginInputSchema.parse({ input });
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    const job = await transaction.mlLoginJob.findFirst({ where: { id, ownerId: actorId } });
    if (!job) missing();
    const result = await transaction.mlLoginJob.updateMany({
      where: {
        id,
        ownerId: actorId,
        status: 'waiting',
        encryptedInput: null,
        expiresAt: { gt: new Date() },
      },
      data: { encryptedInput: encryptCredential(value.input, `login:${id}:input`) },
    });
    if (!result.count) conflict();
    await audit(transaction, actorId, 'login:input', id, {});
    const updated = await transaction.mlLoginJob.findUnique({ where: { id } });
    if (!updated) missing();
    return loginDto(updated);
  });
}
export async function cancelLogin(actorId: string, id: string) {
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    const job = await transaction.mlLoginJob.findFirst({ where: { id, ownerId: actorId } });
    if (!job) missing();
    const result = await transaction.mlLoginJob.updateMany({
      where: { id, ownerId: actorId, status: { in: activeJobs } },
      data: {
        status: 'canceled',
        encryptedInput: null,
        encryptedState: null,
        loginUrl: null,
        instructions: null,
      },
    });
    if (!result.count) conflict();
    await audit(transaction, actorId, 'login:cancel', id, {});
    const updated = await transaction.mlLoginJob.findUnique({ where: { id } });
    if (!updated) missing();
    return loginDto(updated);
  });
}
