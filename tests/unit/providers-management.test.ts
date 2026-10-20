import { GET, POST } from '@/app/api/admin/providers/route';
import { db } from '@/db';
import { flattenStatements, isAllowed, roles } from '@/lib/permissions';
import { requireProviderOwner } from '@/lib/providers/admin-auth';
import { decryptCredential } from '@/lib/providers/crypto';
import {
  connectionDto,
  createConnection,
  issueGatewayKey,
  queryGatewayKeys,
  getGatewayKey,
  renameGatewayKey,
  refreshProviderConnection,
  updateConnection,
} from '@/lib/providers/service';
import { createConnectionSchema, updateConnectionSchema } from '@/lib/providers/validation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  identify: vi.fn(),
  authorize: vi.fn(),
  rateLimit: vi.fn(),
  validateDestination: vi.fn(),
  transaction: vi.fn(),
  user: { findFirst: vi.fn() },
  session: { findFirst: vi.fn() },
  providerConnection: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  providerGatewayKey: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  auditLog: { create: vi.fn() },
  execute: vi.fn(),
}));
vi.mock('@/db', () => ({
  db: {
    $transaction: mocks.transaction,
    $executeRaw: mocks.execute,
    user: mocks.user,
    session: mocks.session,
    providerConnection: mocks.providerConnection,
    providerGatewayKey: mocks.providerGatewayKey,
    auditLog: mocks.auditLog,
  },
}));
vi.mock('@/lib/rbac', () => ({
  identify: mocks.identify,
  authorize: mocks.authorize,
  activeUserWhere: () => ({ emailVerified: true }),
}));
vi.mock('@/lib/redis', () => ({ rateLimit: mocks.rateLimit }));
vi.mock('@/lib/env', () => ({ env: () => ({ BETTER_AUTH_URL: 'https://app.test' }) }));
vi.mock('@/lib/providers/network', () => ({ validateDestination: mocks.validateDestination }));

const now = new Date();
const connection = {
  id: 'connection',
  name: 'Provider',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  priority: 0,
  encryptedCredential: 'secret-credential',
  status: 'ready',
  discoveryStatus: 'pending',
  discoveryError: 'raw upstream secret',
  lastDiscoveredAt: null,
  discoveryRevision: 0,
  cooldownUntil: null,
  createdBy: 'owner',
  createdAt: now,
  updatedAt: now,
  models: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ML_ENCRYPTION_KEY', 'a'.repeat(64));
  mocks.identify.mockResolvedValue({ userId: 'owner', sessionId: 'session' });
  mocks.session.findFirst.mockResolvedValue({ id: 'session' });
  mocks.authorize.mockResolvedValue({ roles: ['owner'] });
  mocks.user.findFirst.mockResolvedValue({ role: 'owner' });
  mocks.transaction.mockImplementation(async (callback) => callback(db));
  mocks.providerConnection.findUnique.mockResolvedValue(connection);
  mocks.providerConnection.create.mockResolvedValue(connection);
  mocks.providerConnection.update.mockResolvedValue(connection);
});
afterEach(() => vi.unstubAllEnvs());
describe('Provider management authorization', () => {
  it('rejects any Authorization header before identity resolution', async () => {
    await expect(
      requireProviderOwner(
        new Request('https://app.test', { headers: { authorization: '' } }),
        'providers:read',
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocks.identify).not.toHaveBeenCalled();
  });
  it('rejects impersonated sessions before permission checks', async () => {
    mocks.session.findFirst.mockResolvedValue(null);
    await expect(
      requireProviderOwner(new Request('https://app.test'), 'providers:read'),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ impersonatedBy: null }) }),
    );
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it('checks live grants and fails closed when rate limiting fails', async () => {
    mocks.authorize.mockResolvedValue({ roles: ['administrator'] });
    await expect(
      requireProviderOwner(new Request('https://app.test'), 'providers:manage'),
    ).rejects.toMatchObject({ status: 403 });
    mocks.authorize.mockResolvedValue({ roles: ['owner'] });
    mocks.rateLimit.mockRejectedValue(new Error('unavailable'));
    await expect(
      requireProviderOwner(new Request('https://app.test'), 'providers:read'),
    ).rejects.toThrow('unavailable');
  });
  it('grants provider permissions only to owners', () => {
    for (const role of ['user', 'viewer', 'administrator'] as const)
      expect(flattenStatements(roles[role])).not.toContain('providers:read');
    expect(flattenStatements(roles.owner)).toContain('providers:manage');
    expect(isAllowed(new Set(['providers:manage']), ['administrator'], 'providers:manage')).toBe(
      false,
    );
  });
});
describe('Provider management records', () => {
  it('projects safe JSON DTOs instead of encrypted fields or raw errors', () => {
    const text = JSON.stringify(connectionDto(connection));
    for (const secret of [
      'encryptedCredential',
      'encryptedState',
      'encryptedInput',
      'secret-credential',
      'raw secret',
      'raw upstream',
    ])
      expect(text).not.toContain(secret);
    expect(connectionDto(connection).createdAt).toBe(now.toISOString());
  });
  it('encrypts API keys with the connection ID and redacts the atomic audit', async () => {
    await createConnection('owner', {
      name: 'Provider',
      provider: 'openai',
      apiKey: 'sensitive-api-key',
      manualModels: ['model', 'model'],
    });
    const argumentsValue = mocks.providerConnection.create.mock.calls[0][0];
    expect(
      decryptCredential(argumentsValue.data.encryptedCredential, argumentsValue.data.id),
    ).toEqual({ apiKey: 'sensitive-api-key' });
    expect(argumentsValue.data.models.create).toHaveLength(1);
    expect(JSON.stringify(mocks.auditLog.create.mock.calls)).not.toContain('sensitive-api-key');
    expect(mocks.validateDestination).toHaveBeenCalledWith('https://api.openai.com/v1', undefined);
  });
  it('reports a blocked endpoint as an owner input error, not an outage', async () => {
    mocks.validateDestination.mockRejectedValueOnce(new Error('private address'));
    await expect(
      createConnection('owner', {
        name: 'Private gateway',
        provider: 'custom',
        baseUrl: 'https://internal.example.test/v1',
        apiKey: 'key',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_ENDPOINT' });
    expect(mocks.providerConnection.create).not.toHaveBeenCalled();
  });
  it('creates without a scheduling timestamp', async () => {
    await createConnection('owner', { name: 'Keyed', provider: 'openai', apiKey: 'k' });
    expect(mocks.providerConnection.create.mock.calls[0][0].data).not.toHaveProperty(
      'nextDiscoveryAt',
    );
  });
  it('rechecks active owner membership inside mutation transactions', async () => {
    mocks.user.findFirst.mockResolvedValue({ role: 'administrator' });
    await expect(
      createConnection('owner', { name: 'Provider', provider: 'openai' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.providerConnection.create).not.toHaveBeenCalled();
  });
  it('replaces credentials and discovers without returning secrets', async () => {
    await updateConnection('owner', 'connection', { apiKey: 'replacement-key' });
    const value = mocks.providerConnection.update.mock.calls[0][0].data;
    expect(value.discoveryStatus).toBe('pending');
    expect(value.discoveryRevision).toEqual({ increment: 1 });
    expect(decryptCredential(value.encryptedCredential, 'connection')).toEqual({
      apiKey: 'replacement-key',
    });
    expect(JSON.stringify(mocks.auditLog.create.mock.calls)).not.toContain('replacement-key');
    await refreshProviderConnection('owner', 'connection');
    expect(mocks.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'providers:connection:refresh' }),
      }),
    );
  });
  it('issues a gateway key once while hiding its hash from the DTO', async () => {
    mocks.providerGatewayKey.create.mockImplementation(async ({ data }) => ({
      ...data,
      id: 'key-id',
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
    }));
    const issued = await issueGatewayKey('owner', 'Gateway');
    expect(issued.key).toMatch(/^jml_/);
    expect(issued.record).not.toHaveProperty('hash');
    expect(JSON.stringify(mocks.auditLog.create.mock.calls)).not.toContain(issued.key);
  });

  it('validates strict inputs and rejects removed providers', () => {
    expect(createConnectionSchema.safeParse({ name: 'Custom', provider: 'custom' }).success).toBe(
      false,
    );
    expect(
      createConnectionSchema.safeParse({
        name: 'Subscription',
        provider: 'codex',
        apiKey: 'secret',
      }).success,
    ).toBe(false);
    expect(createConnectionSchema.safeParse({ name: 'Removed', provider: 'claude' }).success).toBe(
      false,
    );
    expect(updateConnectionSchema.safeParse({ encryptedCredential: 'attacker' }).success).toBe(
      false,
    );
    expect(updateConnectionSchema.safeParse({}).success).toBe(false);
  });
});

describe('Provider management HTTP boundary', () => {
  it('returns sanitized no-store lists', async () => {
    mocks.providerConnection.findMany.mockResolvedValue([connection]);
    mocks.providerGatewayKey.findMany.mockResolvedValue([]);
    const response = await GET(new Request('https://app.test/api/admin/providers'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      connections: [connectionDto(connection)],
      keys: [],
      pools: [],
    });
  });
  it('requires Origin for cookie-bearing mutations', async () => {
    const response = await POST(
      new Request('https://app.test/api/admin/providers', {
        method: 'POST',
        headers: { cookie: 'session=present', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Provider', provider: 'openai' }),
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.identify).not.toHaveBeenCalled();
  });
  it('enforces the 16KiB management cap before mutation', async () => {
    const response = await POST(
      new Request('https://app.test/api/admin/providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'a'.repeat(16384), provider: 'openai' }),
      }),
    );
    expect(response.status).toBe(413);
    expect(mocks.providerConnection.create).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON and unknown credential fields', async () => {
    for (const input of [
      '{',
      JSON.stringify({ name: 'Provider', provider: 'openai', encryptedCredential: 'raw' }),
    ]) {
      const response = await POST(
        new Request('https://app.test/api/admin/providers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: input,
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.providerConnection.create).not.toHaveBeenCalled();
  });
});

describe('API key metadata management', () => {
  const key = {
    id: 'k1',
    name: 'Deploy',
    prefix: 'jx_test',
    hash: 'must-not-leak',
    createdBy: 'owner',
    createdAt: now,
    revokedAt: null,
    lastUsedAt: null,
  };
  it('filters and pages metadata without selecting hashes', async () => {
    mocks.providerGatewayKey.findMany.mockResolvedValue([key]);
    mocks.providerGatewayKey.count.mockResolvedValue(21);
    const result = await queryGatewayKeys({
      page: 2,
      pageSize: 20,
      search: 'jx_',
      searchField: 'prefix',
      status: 'active',
      sortDirection: 'asc',
    });
    expect(result).toMatchObject({ total: 21, page: 2, pageSize: 20 });
    expect(result.keys[0]).not.toHaveProperty('hash');
    expect(mocks.providerGatewayKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { prefix: { contains: 'jx_', mode: 'insensitive' }, revokedAt: null },
        skip: 20,
        take: 20,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(mocks.providerGatewayKey.findMany.mock.calls[0][0].select).not.toHaveProperty('hash');
  });
  it('returns details and rejects missing keys', async () => {
    mocks.providerGatewayKey.findUnique.mockResolvedValueOnce(key).mockResolvedValueOnce(null);
    expect(await getGatewayKey('k1')).toMatchObject({
      createdAt: now.toISOString(),
      revokedAt: null,
      lastUsedAt: null,
    });
    await expect(getGatewayKey('missing')).rejects.toMatchObject({ status: 404 });
  });
  it('renames only an active key and audits in the transaction', async () => {
    mocks.providerGatewayKey.updateMany.mockResolvedValue({ count: 1 });
    mocks.providerGatewayKey.findUnique.mockResolvedValue({ ...key, name: 'Renamed' });
    const result = await renameGatewayKey('owner', 'k1', ' Renamed ');
    expect(result.name).toBe('Renamed');
    expect(result).not.toHaveProperty('hash');
    expect(mocks.providerGatewayKey.updateMany).toHaveBeenCalledWith({
      where: { id: 'k1', revokedAt: null },
      data: { name: 'Renamed' },
    });
    expect(mocks.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'providers:key:rename',
          changes: { name: 'Renamed' },
        }),
      }),
    );
  });
  it('refuses revoked and nonexistent keys without an audit', async () => {
    mocks.providerGatewayKey.updateMany.mockResolvedValue({ count: 0 });
    mocks.providerGatewayKey.findUnique
      .mockResolvedValueOnce({ id: 'k1' })
      .mockResolvedValueOnce(null);
    await expect(renameGatewayKey('owner', 'k1', 'Renamed')).rejects.toMatchObject({
      status: 409,
      code: 'API_KEY_REVOKED',
    });
    await expect(renameGatewayKey('owner', 'missing', 'Renamed')).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.auditLog.create).not.toHaveBeenCalled();
  });
  it('rechecks the live owner before changing a name', async () => {
    mocks.user.findFirst.mockResolvedValue(null);
    await expect(renameGatewayKey('owner', 'k1', 'Renamed')).rejects.toMatchObject({ status: 403 });
    expect(mocks.providerGatewayKey.updateMany).not.toHaveBeenCalled();
  });
});
