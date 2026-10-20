import type { ProviderConnection, ProviderGatewayKey, ProviderModel } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import 'server-only';

import { db, type Transaction } from '@/db';
import type { ProviderAuditOperation } from '@/lib/audit-actions';
import { HttpError } from '@/lib/errors';
import { parseRoles } from '@/lib/permissions';
import { activeUserWhere } from '@/lib/rbac';

import { lockConnection } from './connection-lock';
import { DISCOVERY_TIMEOUT_MS } from './constants';
import { encryptCredential, mintGatewayKey } from './crypto';
import { discoverModels, refreshConnection } from './discovery';
import { storedDiscoveryFailureMessage } from './errors';
import { publicModelId } from './model-id';
import { poolModelId, poolSummaries } from './pools';
import { validateDestination } from './network';
import { defaultBaseUrl, type ProviderKind } from './types';
import {
  createConnectionSchema,
  discoveryPreviewSchema,
  gatewayKeySchema,
  modelIdSchema,
  modelAliasSchema,
  updateConnectionSchema,
  updateModelStatesSchema,
  type CreateConnectionInput,
  type DiscoveryPreviewInput,
  type GatewayKeyListQuery,
  type UpdateConnectionInput,
  type UpdateModelStatesInput,
} from './validation';

const connectionInclude = {
  models: { orderBy: { upstreamId: 'asc' as const } },
};
function orderedModels(models: ProviderModel[]) {
  return [...models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function modelStateVersion(models: ProviderModel[]) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        orderedModels(models).map(({ id, enabled, alias }) => [id, enabled, alias ?? null]),
      ),
    )
    .digest('hex');
}
function decodeModelStates(states: string, count: number) {
  const bytes = Buffer.from(states, 'base64url');
  if (bytes.length !== Math.ceil(count / 8) || bytes.toString('base64url') !== states)
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid model states');
  if (count % 8 && (bytes.at(-1)! & (0xff << (count % 8))) !== 0)
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid model states');
  return Array.from({ length: count }, (_, index) =>
    Boolean(bytes[index >> 3] & (1 << (index & 7))),
  );
}
function missing(): never {
  throw new HttpError(404, 'NOT_FOUND', 'Provider resource not found');
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
  action: ProviderAuditOperation,
  targetId: string,
  changes: Record<string, string | number | boolean | null>,
) {
  await transaction.auditLog.create({
    data: { id: randomUUID(), actorId, action: `providers:${action}`, targetId, changes },
  });
}

export function connectionDto(connection: ProviderConnection & { models: ProviderModel[] }) {
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
    cooldownUntil: connection.cooldownUntil?.toISOString() ?? null,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
    modelStateVersion: modelStateVersion(connection.models),
    models: connection.models.map((model) => ({
      id: model.id,
      connectionId: model.connectionId,
      upstreamId: model.upstreamId,
      publicId: publicModelId(connection, model.upstreamId),
      alias: model.alias ?? null,
      poolId: poolModelId(model),
      displayName: model.displayName,
      enabled: model.enabled,
      discovered: model.discovered,
      createdAt: model.createdAt.toISOString(),
    })),
  };
}
function gatewayKeyDto(
  record: Pick<
    ProviderGatewayKey,
    'id' | 'name' | 'prefix' | 'createdBy' | 'revokedAt' | 'lastUsedAt' | 'createdAt'
  >,
) {
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

export async function listConnections() {
  return (
    await db.providerConnection.findMany({
      include: connectionInclude,
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
  ).map(connectionDto);
}
export async function getConnection(id: string) {
  const connection = await db.providerConnection.findUnique({
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
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const discoverySignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  await assertPublicEndpoint(baseUrl, { signal: discoverySignal, timeoutMs: DISCOVERY_TIMEOUT_MS });
  const { status, models, error, reason, httpStatus, retryAfterSeconds } = await discoverModels(
    value.provider,
    baseUrl,
    { apiKey: value.apiKey },
    discoverySignal,
  );
  return { status, models, error, reason, httpStatus, retryAfterSeconds };
}
export async function createConnection(actorId: string, input: CreateConnectionInput) {
  const value = createConnectionSchema.parse(input);
  const baseUrl = value.baseUrl ?? defaultBaseUrl(value.provider);
  await assertPublicEndpoint(baseUrl);
  const id = randomUUID();
  const encryptedCredential = value.apiKey ? encryptCredential({ apiKey: value.apiKey }, id) : null;
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    const connection = await transaction.providerConnection.create({
      data: {
        id,
        name: value.name,
        provider: value.provider,
        baseUrl,
        priority: value.priority ?? 0,
        createdBy: actorId,
        encryptedCredential,
        status: encryptedCredential ? 'ready' : 'pending',
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
async function connectionChanges(
  transaction: Transaction,
  actorId: string,
  id: string,
  value: UpdateConnectionInput,
) {
  const { apiKey, ...fields } = value;
  await audit(transaction, actorId, 'connection:update', id, {
    credentialReplaced: !!apiKey,
    endpointChanged: !!value.baseUrl,
    fields: Object.keys(fields).join(','),
  });
  return {
    ...fields,
    ...(apiKey
      ? {
          encryptedCredential: encryptCredential({ apiKey }, id),
          status: 'ready',
          cooldownUntil: null,
        }
      : {}),
    ...(apiKey || value.baseUrl || value.enabled !== undefined
      ? { discoveryRevision: { increment: 1 } }
      : {}),
    ...(apiKey || value.baseUrl ? { discoveryStatus: 'pending', discoveryError: null } : {}),
  };
}
export async function updateConnection(actorId: string, id: string, input: UpdateConnectionInput) {
  const value = updateConnectionSchema.parse(input);
  if (value.baseUrl) await assertPublicEndpoint(value.baseUrl);
  const saved = await db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    const previous = await transaction.providerConnection.findUnique({ where: { id } });
    if (!previous) missing();
    const connection = await transaction.providerConnection.update({
      where: { id },
      data: await connectionChanges(transaction, actorId, id, value),
      include: connectionInclude,
    });
    return connectionDto(connection);
  });
  return value.apiKey || value.baseUrl ? discoverSavedConnection(id, saved) : saved;
}
export async function updateModelStates(
  actorId: string,
  id: string,
  input: UpdateModelStatesInput,
) {
  const value = updateModelStatesSchema.parse(input);
  if (value.connection?.baseUrl) await assertPublicEndpoint(value.connection.baseUrl);
  const saved = await db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    const previous = await transaction.providerConnection.findUnique({
      where: { id },
      include: connectionInclude,
    });
    if (!previous) missing();
    if (modelStateVersion(previous.models) !== value.version)
      throw new HttpError(409, 'MODEL_CATALOG_CHANGED', 'Model catalog changed');
    const models = orderedModels(previous.models);
    const states = decodeModelStates(value.states, models.length);
    const changed = models.filter((model, index) => model.enabled !== states[index]);
    const enabledIds = changed.filter((model) => !model.enabled).map((model) => model.id);
    const disabledIds = changed.filter((model) => model.enabled).map((model) => model.id);
    if (enabledIds.length)
      await transaction.providerModel.updateMany({
        where: { id: { in: enabledIds }, connectionId: id },
        data: { enabled: true },
      });
    if (disabledIds.length)
      await transaction.providerModel.updateMany({
        where: { id: { in: disabledIds }, connectionId: id },
        data: { enabled: false },
      });
    if (changed.length)
      await transaction.auditLog.createMany({
        data: changed.map((model) => ({
          id: randomUUID(),
          actorId,
          action: 'providers:model:update',
          targetId: model.id,
          changes: { connectionId: id, upstreamId: model.upstreamId, enabled: !model.enabled },
        })),
      });
    if (value.connection)
      await transaction.providerConnection.update({
        where: { id },
        data: await connectionChanges(transaction, actorId, id, value.connection),
      });
    const connection = await transaction.providerConnection.findUnique({
      where: { id },
      include: connectionInclude,
    });
    if (!connection) missing();
    return connectionDto(connection);
  });
  return value.connection?.apiKey || value.connection?.baseUrl
    ? discoverSavedConnection(id, saved)
    : saved;
}
export async function deleteConnection(actorId: string, id: string) {
  await db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    if (!(await transaction.providerConnection.deleteMany({ where: { id } })).count) missing();
    await audit(transaction, actorId, 'connection:delete', id, {});
  });
}
async function discoverSavedConnection(id: string, saved: ReturnType<typeof connectionDto>) {
  try {
    await refreshConnection(id);
    return await getConnection(id);
  } catch (error) {
    console.error('Provider discovery could not complete', {
      kind: error instanceof Error ? error.name : 'UnknownError',
    });
    return saved;
  }
}
export async function refreshProviderConnection(actorId: string, id: string) {
  const saved = await db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    const connection = await transaction.providerConnection.findUnique({
      where: { id },
      include: connectionInclude,
    });
    if (!connection) missing();
    await audit(transaction, actorId, 'connection:refresh', id, {});
    return connectionDto(connection);
  });
  return discoverSavedConnection(id, saved);
}
export async function updateModelAlias(
  actorId: string,
  id: string,
  modelId: string,
  input: unknown,
) {
  const value = modelAliasSchema.parse(input);
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    const connection = await transaction.providerConnection.findUnique({
      where: { id },
      include: connectionInclude,
    });
    if (!connection) missing();
    if (modelStateVersion(connection.models) !== value.version)
      throw new HttpError(409, 'MODEL_CATALOG_CHANGED', 'Model catalog changed');
    const model = connection.models.find((entry) => entry.id === modelId);
    if (!model) missing();
    if ((model.alias ?? null) !== value.alias) {
      await transaction.providerModel.update({
        where: { id: modelId },
        data: { alias: value.alias },
      });
      await audit(transaction, actorId, 'model:alias', modelId, {
        connectionId: id,
        modelId,
        previousAlias: model.alias ?? null,
        alias: value.alias,
      });
    }
    const updated = await transaction.providerConnection.findUnique({
      where: { id },
      include: connectionInclude,
    });
    if (!updated) missing();
    return connectionDto(updated);
  });
}
export function listProviderPools(connections: Awaited<ReturnType<typeof listConnections>>) {
  return poolSummaries(
    connections.map((connection) => ({
      ...connection,
      cooldownUntil: connection.cooldownUntil ? new Date(connection.cooldownUntil) : null,
    })),
  );
}
export async function addManualModel(actorId: string, id: string, upstreamId: string) {
  const model = modelIdSchema.parse(upstreamId);
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    await lockConnection(transaction, id);
    if (!(await transaction.providerConnection.findUnique({ where: { id }, select: { id: true } })))
      missing();
    await transaction.providerModel.upsert({
      where: { connectionId_upstreamId: { connectionId: id, upstreamId: model } },
      create: { connectionId: id, upstreamId: model, displayName: model, discovered: false },
      update: { discovered: false },
    });
    await audit(transaction, actorId, 'model:add', id, { upstreamId: model });
    const connection = await transaction.providerConnection.findUnique({
      where: { id },
      include: connectionInclude,
    });
    if (!connection) missing();
    return connectionDto(connection);
  });
}
export async function listGatewayKeys() {
  return (await db.providerGatewayKey.findMany({ orderBy: { createdAt: 'desc' } })).map(
    gatewayKeyDto,
  );
}
export async function issueGatewayKey(actorId: string, name: string) {
  const value = gatewayKeySchema.parse({ name });
  const minted = mintGatewayKey();
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    const record = await transaction.providerGatewayKey.create({
      data: { name: value.name, prefix: minted.prefix, hash: minted.hash, createdBy: actorId },
    });
    await audit(transaction, actorId, 'key:issue', record.id, {});
    return { key: minted.key, record: gatewayKeyDto(record) };
  });
}
export async function revokeGatewayKey(actorId: string, id: string) {
  await db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    if (!(await transaction.providerGatewayKey.findUnique({ where: { id }, select: { id: true } })))
      missing();
    await transaction.providerGatewayKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(transaction, actorId, 'key:revoke', id, {});
  });
}

const keyMetadataSelect = {
  id: true,
  name: true,
  prefix: true,
  createdBy: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const;
export async function queryGatewayKeys(input: GatewayKeyListQuery) {
  const where = {
    ...(input.search
      ? { [input.searchField]: { contains: input.search, mode: 'insensitive' as const } }
      : {}),
    ...(input.status === 'active'
      ? { revokedAt: null }
      : input.status === 'revoked'
        ? { revokedAt: { not: null } }
        : {}),
  };
  const [records, total] = await Promise.all([
    db.providerGatewayKey.findMany({
      where,
      select: keyMetadataSelect,
      orderBy: [{ createdAt: input.sortDirection }, { id: input.sortDirection }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.providerGatewayKey.count({ where }),
  ]);
  return { keys: records.map(gatewayKeyDto), total, page: input.page, pageSize: input.pageSize };
}
export async function getGatewayKey(id: string) {
  const record = await db.providerGatewayKey.findUnique({
    where: { id },
    select: keyMetadataSelect,
  });
  if (!record) missing();
  return gatewayKeyDto(record);
}
export async function renameGatewayKey(actorId: string, id: string, name: string) {
  const value = gatewayKeySchema.parse({ name });
  return db.$transaction(async (transaction) => {
    await owner(transaction, actorId);
    const updated = await transaction.providerGatewayKey.updateMany({
      where: { id, revokedAt: null },
      data: { name: value.name },
    });
    if (updated.count !== 1) {
      const exists = await transaction.providerGatewayKey.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) missing();
      throw new HttpError(409, 'API_KEY_REVOKED', 'Revoked API keys cannot be renamed');
    }
    const record = await transaction.providerGatewayKey.findUnique({
      where: { id },
      select: keyMetadataSelect,
    });
    if (!record) missing();
    await audit(transaction, actorId, 'key:rename', id, { name: value.name });
    return gatewayKeyDto(record);
  });
}
