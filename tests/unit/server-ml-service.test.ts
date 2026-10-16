import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  mlConnection: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  mlModel: { upsert: vi.fn(), updateMany: vi.fn() },
  mlGatewayKey: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn(), createMany: vi.fn() },
  execute: vi.fn(),
  validateDestination: vi.fn(),
  discoverModels: vi.fn(),
}));
vi.mock('@/db', () => {
  const db = {
    user: m.user,
    mlConnection: m.mlConnection,
    mlModel: m.mlModel,
    mlGatewayKey: m.mlGatewayKey,
    auditLog: m.auditLog,
    $executeRaw: m.execute,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db };
});
vi.mock('@/lib/rbac', () => ({ activeUserWhere: () => ({ emailVerified: true }) }));
vi.mock('@/lib/ml/network', () => ({ validateDestination: m.validateDestination }));
vi.mock('@/lib/ml/discovery', () => ({ discoverModels: m.discoverModels }));

const service = await import('@/lib/ml/service');

const at = new Date('2026-01-01T00:00:00Z');
const row = (extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Provider',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  priority: 0,
  encryptedCredential: null,
  status: 'pending',
  discoveryStatus: 'failed',
  discoveryError: null,
  lastDiscoveredAt: at,
  nextDiscoveryAt: at,
  cooldownUntil: at,
  createdBy: 'owner',
  createdAt: at,
  updatedAt: at,
  models: [
    {
      id: 'm1',
      connectionId: 'c1',
      upstreamId: 'gpt-x',
      displayName: 'GPT X',
      enabled: true,
      discovered: true,
      createdAt: at,
    },
  ],
  ...extra,
});
const key = (extra: Record<string, unknown> = {}) => ({
  id: 'k1',
  name: 'CI',
  prefix: 'jml_abc',
  hash: 'secret-hash',
  createdBy: 'owner',
  revokedAt: null,
  lastUsedAt: null,
  createdAt: at,
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ML_ENCRYPTION_KEY', 'c'.repeat(64));
  m.user.findFirst.mockResolvedValue({ role: 'owner' });
  m.validateDestination.mockResolvedValue(undefined);
});

describe('ML connection reads', () => {
  it('lists connections by priority as DTOs with ISO timestamps and pool ids', async () => {
    m.mlConnection.findMany.mockResolvedValue([row()]);
    const [dto] = await service.listConnections();
    expect(m.mlConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ priority: 'asc' }, { id: 'asc' }] }),
    );
    expect(dto).toMatchObject({
      hasCredential: false,
      discoveryError: null,
      lastDiscoveredAt: at.toISOString(),
      cooldownUntil: at.toISOString(),
      models: [{ publicId: 'openai/gpt-x', createdAt: at.toISOString() }],
    });
    expect(dto).not.toHaveProperty('encryptedCredential');
  });

  it('returns 404 for an unknown connection', async () => {
    m.mlConnection.findUnique.mockResolvedValue(null);
    await expect(service.getConnection('missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    m.mlConnection.findUnique.mockResolvedValue(row());
    await expect(service.getConnection('c1')).resolves.toMatchObject({ id: 'c1' });
  });

  it('lists gateway keys without their hash', async () => {
    m.mlGatewayKey.findMany.mockResolvedValue([key({ revokedAt: at, lastUsedAt: at })]);
    const [dto] = await service.listGatewayKeys();
    expect(dto).toEqual({
      id: 'k1',
      name: 'CI',
      prefix: 'jml_abc',
      createdBy: 'owner',
      revokedAt: at.toISOString(),
      lastUsedAt: at.toISOString(),
      createdAt: at.toISOString(),
    });
  });
});

describe('previewDiscovery', () => {
  it('validates the destination and returns only the discovery summary', async () => {
    m.discoverModels.mockResolvedValue({
      status: 'ok',
      models: [{ id: 'a', name: 'A' }],
      error: undefined,
      reason: undefined,
      httpStatus: 200,
      retryAfterSeconds: undefined,
      extra: 'not returned',
    });
    const controller = new AbortController();
    const result = await service.previewDiscovery(
      { provider: 'openai', apiKey: 'sk-fake' },
      controller.signal,
    );
    expect(result).not.toHaveProperty('extra');
    expect(result).toMatchObject({ status: 'ok', httpStatus: 200 });
    expect(m.validateDestination).toHaveBeenCalledWith('https://api.openai.com/v1', {
      signal: expect.any(AbortSignal),
      timeoutMs: 15000,
    });
    expect(m.discoverModels).toHaveBeenCalledWith(
      'openai',
      'https://api.openai.com/v1',
      { apiKey: 'sk-fake' },
      expect.any(AbortSignal),
    );
  });

  it('uses the custom endpoint and a timeout signal alone when none is given', async () => {
    m.discoverModels.mockResolvedValue({ status: 'failed', models: [] });
    await service.previewDiscovery({
      provider: 'custom',
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'k',
    });
    expect(m.discoverModels.mock.calls[0][1]).toBe('https://llm.example.com/v1');
  });

  it('reports a private destination as a 400 and never calls the provider', async () => {
    m.validateDestination.mockRejectedValue(new Error('private address 10.0.0.1'));
    await expect(
      service.previewDiscovery({
        provider: 'custom',
        baseUrl: 'https://internal.example.com',
        apiKey: 'k',
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_ENDPOINT',
      message: 'Endpoint must be a public HTTPS destination',
    });
    expect(m.discoverModels).not.toHaveBeenCalled();
  });

  it('rejects invalid input', async () => {
    await expect(
      service.previewDiscovery({ provider: 'custom', apiKey: 'k' } as never),
    ).rejects.toThrow();
  });
});

describe('ML connection mutations', () => {
  it('saves model states and connection fields together with per-model audit entries', async () => {
    const current = row({
      models: [
        { ...row().models[0], id: 'm1', enabled: true },
        { ...row().models[0], id: 'm2', upstreamId: 'gpt-y', enabled: false },
      ],
    });
    m.mlConnection.findUnique.mockResolvedValue(current);
    m.mlConnection.update.mockResolvedValue(current);
    const version = service.connectionDto(current as never).modelStateVersion;
    await service.updateModelStates('owner', 'c1', {
      version,
      states: 'Ag',
      connection: { name: 'Renamed' },
    });
    expect(m.mlModel.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1'] }, connectionId: 'c1' },
      data: { enabled: false },
    });
    expect(m.auditLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          action: 'ml:model:update',
          targetId: 'm1',
          changes: { connectionId: 'c1', upstreamId: 'gpt-x', enabled: false },
        }),
        expect.objectContaining({
          action: 'ml:model:update',
          targetId: 'm2',
          changes: { connectionId: 'c1', upstreamId: 'gpt-y', enabled: true },
        }),
      ]),
    });
    expect(m.mlConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Renamed' } }),
    );
    expect(m.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'ml:connection:update' }),
      }),
    );
  });

  it('rejects stale, malformed and unknown model snapshots before writing', async () => {
    m.mlConnection.findUnique.mockResolvedValue(row());
    await expect(
      service.updateModelStates('owner', 'c1', { version: 'a'.repeat(64), states: 'AA' }),
    ).rejects.toMatchObject({ status: 409, code: 'MODEL_CATALOG_CHANGED' });
    const version = service.connectionDto(row() as never).modelStateVersion;
    await expect(
      service.updateModelStates('owner', 'c1', { version, states: 'Ag' }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(m.mlModel.updateMany).not.toHaveBeenCalled();
    expect(m.auditLog.createMany).not.toHaveBeenCalled();
  });

  it('requires an active owner for every mutation', async () => {
    m.user.findFirst.mockResolvedValue({ role: 'administrator' });
    await expect(service.deleteConnection('a1', 'c1')).rejects.toMatchObject({ status: 403 });
    m.user.findFirst.mockResolvedValue(null);
    await expect(service.revokeGatewayKey('a1', 'k1')).rejects.toMatchObject({ status: 403 });
    await expect(service.addManualModel('a1', 'c1', 'gpt-x')).rejects.toMatchObject({
      status: 403,
    });
    expect(m.mlConnection.deleteMany).not.toHaveBeenCalled();
    expect(m.mlGatewayKey.updateMany).not.toHaveBeenCalled();
    expect(m.auditLog.create).not.toHaveBeenCalled();
  });

  it('updates fields without touching credentials or discovery when only metadata changes', async () => {
    m.mlConnection.findUnique.mockResolvedValue(row());
    m.mlConnection.update.mockResolvedValue(row({ name: 'Renamed' }));
    await service.updateConnection('owner', 'c1', { name: 'Renamed', priority: 2 });
    expect(m.validateDestination).not.toHaveBeenCalled();
    expect(m.execute).toHaveBeenCalled();
    expect(m.mlConnection.update.mock.calls[0][0].data).toEqual({ name: 'Renamed', priority: 2 });
    expect(m.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'ml:connection:update',
      changes: { credentialReplaced: false, endpointChanged: false, fields: 'name,priority' },
    });
  });

  it('resets discovery when the endpoint changes and validates it', async () => {
    m.mlConnection.findUnique.mockResolvedValue(row());
    m.mlConnection.update.mockResolvedValue(row());
    await service.updateConnection('owner', 'c1', { baseUrl: 'https://llm.example.com/v1' });
    expect(m.validateDestination).toHaveBeenCalledWith('https://llm.example.com/v1', undefined);
    expect(m.mlConnection.update.mock.calls[0][0].data).toMatchObject({
      baseUrl: 'https://llm.example.com/v1',
      discoveryStatus: 'pending',
      discoveryError: null,
    });
    expect(m.mlConnection.update.mock.calls[0][0].data).not.toHaveProperty('encryptedCredential');
  });

  it('returns 404 when updating an unknown connection', async () => {
    m.mlConnection.findUnique.mockResolvedValue(null);
    await expect(service.updateConnection('owner', 'x', { enabled: false })).rejects.toMatchObject({
      status: 404,
    });
    expect(m.mlConnection.update).not.toHaveBeenCalled();
  });

  it('deletes a connection and audits it, or answers 404', async () => {
    m.mlConnection.deleteMany.mockResolvedValue({ count: 1 });
    await service.deleteConnection('owner', 'c1');
    expect(m.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'ml:connection:delete',
      targetId: 'c1',
      actorId: 'owner',
    });

    m.mlConnection.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.deleteConnection('owner', 'c1')).rejects.toMatchObject({ status: 404 });
    expect(m.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('answers 404 when refreshing an unknown connection', async () => {
    m.mlConnection.findUnique.mockResolvedValue(null);
    await expect(service.scheduleRefresh('owner', 'x')).rejects.toMatchObject({ status: 404 });
    expect(m.mlConnection.update).not.toHaveBeenCalled();
  });

  it('adds a manual model idempotently and returns the refreshed connection', async () => {
    m.mlConnection.findUnique.mockResolvedValueOnce({ id: 'c1' }).mockResolvedValueOnce(row());
    const dto = await service.addManualModel('owner', 'c1', 'gpt-x');
    expect(m.mlModel.upsert).toHaveBeenCalledWith({
      where: { connectionId_upstreamId: { connectionId: 'c1', upstreamId: 'gpt-x' } },
      create: { connectionId: 'c1', upstreamId: 'gpt-x', displayName: 'gpt-x', discovered: false },
      update: { discovered: false },
    });
    expect(m.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'ml:model:add',
      changes: { upstreamId: 'gpt-x' },
    });
    expect(dto.id).toBe('c1');
  });

  it('rejects invalid model ids and unknown connections when adding a model', async () => {
    await expect(service.addManualModel('owner', 'c1', '../etc')).rejects.toThrow();
    m.mlConnection.findUnique.mockResolvedValue(null);
    await expect(service.addManualModel('owner', 'c1', 'gpt-x')).rejects.toMatchObject({
      status: 404,
    });
    m.mlConnection.findUnique.mockResolvedValueOnce({ id: 'c1' }).mockResolvedValueOnce(null);
    await expect(service.addManualModel('owner', 'c1', 'gpt-x')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('revokes an active gateway key once and answers 404 for unknown keys', async () => {
    m.mlGatewayKey.findUnique.mockResolvedValue({ id: 'k1' });
    await service.revokeGatewayKey('owner', 'k1');
    expect(m.mlGatewayKey.updateMany).toHaveBeenCalledWith({
      where: { id: 'k1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(m.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'ml:key:revoke',
      targetId: 'k1',
    });

    m.mlGatewayKey.findUnique.mockResolvedValue(null);
    await expect(service.revokeGatewayKey('owner', 'nope')).rejects.toMatchObject({ status: 404 });
  });
});
