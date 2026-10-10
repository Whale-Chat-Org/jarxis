import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  identify: vi.fn(),
  authorize: vi.fn(),
  rateLimit: vi.fn(),
  validateDestination: vi.fn(),
  transaction: vi.fn(),
  user: { findFirst: vi.fn() },
  session: { findFirst: vi.fn() },
  mlConnection: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  mlGatewayKey: { create: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  execute: vi.fn(),
}));
vi.mock('@/db', () => ({
  db: {
    $transaction: mocks.transaction,
    $executeRaw: mocks.execute,
    user: mocks.user,
    session: mocks.session,
    mlConnection: mocks.mlConnection,
    mlGatewayKey: mocks.mlGatewayKey,
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
vi.mock('@/lib/ml/network', () => ({ validateDestination: mocks.validateDestination }));
import { db } from '@/db';
import { requireMlOwner } from '@/lib/ml/admin-auth';
import {
  connectionDto,
  createConnection,
  issueGatewayKey,
  scheduleRefresh,
  updateConnection,
} from '@/lib/ml/service';
import { createConnectionSchema, updateConnectionSchema } from '@/lib/ml/validation';
import { decryptCredential } from '@/lib/ml/crypto';
import { flattenStatements, isAllowed, roles } from '@/lib/permissions';
import { GET, POST } from '@/app/api/admin/ml-providers/route';

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
  nextDiscoveryAt: now,
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
  mocks.mlConnection.findUnique.mockResolvedValue(connection);
  mocks.mlConnection.create.mockResolvedValue(connection);
  mocks.mlConnection.update.mockResolvedValue(connection);
});
afterEach(() => vi.unstubAllEnvs());
describe('ML management authorization', () => {
  it('rejects any Authorization header before identity resolution', async () => {
    await expect(
      requireMlOwner(
        new Request('https://app.test', { headers: { authorization: '' } }),
        'providers:read',
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocks.identify).not.toHaveBeenCalled();
  });
  it('rejects impersonated sessions before permission checks', async () => {
    mocks.session.findFirst.mockResolvedValue(null);
    await expect(
      requireMlOwner(new Request('https://app.test'), 'providers:read'),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ impersonatedBy: null }) }),
    );
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it('checks live grants and fails closed when rate limiting fails', async () => {
    mocks.authorize.mockResolvedValue({ roles: ['administrator'] });
    await expect(
      requireMlOwner(new Request('https://app.test'), 'providers:manage'),
    ).rejects.toMatchObject({ status: 403 });
    mocks.authorize.mockResolvedValue({ roles: ['owner'] });
    mocks.rateLimit.mockRejectedValue(new Error('unavailable'));
    await expect(requireMlOwner(new Request('https://app.test'), 'providers:read')).rejects.toThrow(
      'unavailable',
    );
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
describe('ML management records', () => {
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
    const argumentsValue = mocks.mlConnection.create.mock.calls[0][0];
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
    expect(mocks.mlConnection.create).not.toHaveBeenCalled();
  });
  it('defers worker discovery only for keyed connections the request will refresh', async () => {
    const before = Date.now();
    await createConnection('owner', { name: 'Keyed', provider: 'openai', apiKey: 'k' }, true);
    await createConnection('owner', { name: 'Keyless', provider: 'openai' }, true);
    await createConnection('owner', { name: 'Default', provider: 'openai', apiKey: 'k' });
    const [deferred, keyless, immediate] = mocks.mlConnection.create.mock.calls.map(([value]) =>
      value.data.nextDiscoveryAt.getTime(),
    );
    expect(deferred).toBeGreaterThanOrEqual(before + 15000);
    expect(deferred).toBeLessThanOrEqual(Date.now() + 15000);
    expect(keyless).toBeLessThanOrEqual(Date.now());
    expect(immediate).toBeLessThanOrEqual(Date.now());
  });
  it('rechecks active owner membership inside mutation transactions', async () => {
    mocks.user.findFirst.mockResolvedValue({ role: 'administrator' });
    await expect(
      createConnection('owner', { name: 'Provider', provider: 'openai' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.mlConnection.create).not.toHaveBeenCalled();
  });
  it('replaces credentials and schedules discovery without returning secrets', async () => {
    await updateConnection('owner', 'connection', { apiKey: 'replacement-key' });
    const value = mocks.mlConnection.update.mock.calls[0][0].data;
    expect(value.discoveryStatus).toBe('pending');
    expect(value.nextDiscoveryAt).toBeInstanceOf(Date);
    expect(decryptCredential(value.encryptedCredential, 'connection')).toEqual({
      apiKey: 'replacement-key',
    });
    expect(JSON.stringify(mocks.auditLog.create.mock.calls)).not.toContain('replacement-key');
    await scheduleRefresh('owner', 'connection');
    expect(mocks.mlConnection.update.mock.calls[1][0].data.discoveryStatus).toBe('pending');
  });
  it('issues a gateway key once while hiding its hash from the DTO', async () => {
    mocks.mlGatewayKey.create.mockImplementation(async ({ data }) => ({
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

describe('ML management HTTP boundary', () => {
  it('returns sanitized no-store lists', async () => {
    mocks.mlConnection.findMany.mockResolvedValue([connection]);
    mocks.mlGatewayKey.findMany.mockResolvedValue([]);
    const response = await GET(new Request('https://app.test/api/admin/ml-providers'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ connections: [connectionDto(connection)], keys: [] });
  });
  it('requires Origin for cookie-bearing mutations', async () => {
    const response = await POST(
      new Request('https://app.test/api/admin/ml-providers', {
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
      new Request('https://app.test/api/admin/ml-providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'a'.repeat(16384), provider: 'openai' }),
      }),
    );
    expect(response.status).toBe(413);
    expect(mocks.mlConnection.create).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON and unknown credential fields', async () => {
    for (const input of [
      '{',
      JSON.stringify({ name: 'Provider', provider: 'openai', encryptedCredential: 'raw' }),
    ]) {
      const response = await POST(
        new Request('https://app.test/api/admin/ml-providers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: input,
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.mlConnection.create).not.toHaveBeenCalled();
  });
});
