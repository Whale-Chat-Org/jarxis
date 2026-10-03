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
  mlLoginJob: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
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
    mlLoginJob: mocks.mlLoginJob,
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
  getLogin,
  issueGatewayKey,
  loginDto,
  scheduleRefresh,
  startLogin,
  submitLogin,
  updateConnection,
} from '@/lib/ml/service';
import { createConnectionSchema, updateConnectionSchema } from '@/lib/ml/validation';
import { decryptCredential } from '@/lib/ml/crypto';
import { flattenStatements, isAllowed, roles } from '@/lib/permissions';
import { GET, POST } from '@/app/api/admin/ml-providers/route';

const now = new Date();
const job = {
  id: 'job',
  connectionId: 'connection',
  ownerId: 'owner',
  status: 'waiting',
  expiresAt: new Date(Date.now() + 600000),
  encryptedState: 'secret-state',
  encryptedInput: null,
  loginUrl: 'https://claude.ai/oauth/authorize?state=public-state',
  instructions: 'raw secret output',
  error: 'raw secret error',
  claimedAt: now,
  createdAt: now,
  updatedAt: now,
};
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
  loginJobs: [job],
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
  mocks.mlLoginJob.findFirst.mockResolvedValue(job);
  mocks.mlLoginJob.findUnique.mockResolvedValue(job);
  mocks.mlLoginJob.updateMany.mockResolvedValue({ count: 1 });
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
    expect(connectionDto(connection).loginJob?.loginUrl).toBeNull();
    expect(connectionDto(connection).loginJob?.instructions).toBeNull();
    expect(loginDto({ ...job, loginUrl: 'https://evil.test/steal' }).loginUrl).toBeNull();
    expect(loginDto({ ...job, expiresAt: new Date(0) }).loginUrl).toBeNull();
    expect(
      loginDto({ ...job, loginUrl: 'https://claude.ai/oauth/authorize?access_token=secret' })
        .loginUrl,
    ).toBeNull();
    expect(
      loginDto({
        ...job,
        loginUrl: 'https://auth.openai.com/codex/device',
        instructions: 'Open the vendor login page and enter device code ABCD-1234.',
      }).instructions,
    ).toContain('ABCD-1234');
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
  it('restricts jobs to the initiating owner and rejects stale login input', async () => {
    mocks.mlLoginJob.findFirst.mockResolvedValue(null);
    await expect(getLogin('other', 'job')).rejects.toMatchObject({ status: 404 });
    expect(mocks.mlLoginJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'job', ownerId: 'other' },
    });
    mocks.mlLoginJob.findFirst.mockResolvedValue(job);
    mocks.mlLoginJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(submitLogin('owner', 'job', 'login-code')).rejects.toMatchObject({ status: 409 });
    expect(mocks.mlLoginJob.updateMany.mock.calls[0][0].where).toMatchObject({
      status: 'waiting',
      ownerId: 'owner',
      encryptedInput: null,
    });
    expect(mocks.auditLog.create).not.toHaveBeenCalled();
  });
  it('encrypts pasted input with a purpose-specific context and audits no code', async () => {
    await submitLogin('owner', 'job', 'login-code');
    const encrypted = mocks.mlLoginJob.updateMany.mock.calls[0][0].data.encryptedInput;
    expect(decryptCredential(encrypted, 'login:job:input')).toBe('login-code');
    expect(JSON.stringify(mocks.auditLog.create.mock.calls)).not.toContain('login-code');
  });
  it('rejects login for API providers', async () => {
    await expect(startLogin('owner', 'connection')).rejects.toMatchObject({ status: 400 });
    expect(mocks.mlLoginJob.create).not.toHaveBeenCalled();
  });
  it('validates strict inputs and subscription credentials', () => {
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
