import { APIError } from 'better-auth';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '@/lib/errors';

const m = vi.hoisted(() => ({
  requireProviderOwner: vi.fn(),
  refreshConnection: vi.fn(),
  createConnection: vi.fn(),
  getConnection: vi.fn(),
  listConnections: vi.fn(),
  listGatewayKeys: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  addManualModel: vi.fn(),
  updateModelStates: vi.fn(),
  scheduleRefresh: vi.fn(),
  issueGatewayKey: vi.fn(),
  revokeGatewayKey: vi.fn(),
  previewDiscovery: vi.fn(),
  guardDocs: vi.fn(),
  openapi: vi.fn(),
  apiReference: vi.fn(),
  queryRaw: vi.fn(),
  readyRedis: vi.fn(),
  rateLimit: vi.fn(),
  requestIP: vi.fn(),
  handleGateway: vi.fn(),
  signInEmail: vi.fn(),
  authHandler: vi.fn(),
  identify: vi.fn(),
  issueTokens: vi.fn(),
  rotateTokens: vi.fn(),
  revokeFamily: vi.fn(),
}));

vi.mock('@/lib/providers/admin-auth', () => ({ requireProviderOwner: m.requireProviderOwner }));
vi.mock('@/lib/providers/discovery', () => ({ refreshConnection: m.refreshConnection }));
vi.mock('@/lib/providers/service', () => ({
  createConnection: m.createConnection,
  getConnection: m.getConnection,
  listConnections: m.listConnections,
  listGatewayKeys: m.listGatewayKeys,
  updateConnection: m.updateConnection,
  deleteConnection: m.deleteConnection,
  addManualModel: m.addManualModel,
  updateModelStates: m.updateModelStates,
  scheduleRefresh: m.scheduleRefresh,
  issueGatewayKey: m.issueGatewayKey,
  revokeGatewayKey: m.revokeGatewayKey,
  previewDiscovery: m.previewDiscovery,
}));
vi.mock('@/lib/docs-access', () => ({ guardDocs: m.guardDocs }));
vi.mock('@/lib/openapi', () => ({ openapi: m.openapi }));
vi.mock('@scalar/nextjs-api-reference', () => ({ ApiReference: m.apiReference }));
vi.mock('@/db', () => ({ db: { $queryRaw: m.queryRaw } }));
vi.mock('@/lib/redis', () => ({
  readyRedis: m.readyRedis,
  rateLimit: m.rateLimit,
  requestIP: m.requestIP,
}));
vi.mock('@/lib/providers/gateway', () => ({ handleGateway: m.handleGateway }));
vi.mock('@/lib/auth', () => ({
  getAuth: () => ({ api: { signInEmail: m.signInEmail }, handler: m.authHandler }),
}));
vi.mock('@/lib/rbac', () => ({ identify: m.identify }));
vi.mock('@/lib/tokens', () => ({
  issueTokens: m.issueTokens,
  rotateTokens: m.rotateTokens,
  revokeFamily: m.revokeFamily,
}));

const providers = await import('@/app/api/admin/providers/route');
const providerById = await import('@/app/api/admin/providers/[id]/route');
const providerModels = await import('@/app/api/admin/providers/[id]/models/route');
const providerRefresh = await import('@/app/api/admin/providers/[id]/refresh/route');
const keys = await import('@/app/api/admin/providers/keys/route');
const keyById = await import('@/app/api/admin/providers/keys/[keyId]/route');
const discover = await import('@/app/api/admin/providers/discover/route');
const docs = await import('@/app/api/docs/route');
const openapiRoute = await import('@/app/api/openapi/route');
const health = await import('@/app/api/health/route');
const llm = await import('@/app/api/llm/v1/[...path]/route');
const v1 = await import('@/app/api/v1/[...path]/route');
const authRoute = await import('@/app/api/auth/[...all]/route');

const ORIGIN = 'http://localhost:3000';
const REFRESH = 'r'.repeat(64);

function send(
  path: string,
  method = 'POST',
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: 'session=fake',
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}
const params = <T>(value: T) => ({ params: Promise.resolve(value) });

beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/jarxis_test',
    REDIS_URL: 'redis://localhost:6379',
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: 'a'.repeat(64),
    JWT_SECRET: 'b'.repeat(64),
    BREVO_API_KEY: 'xkeysib-test',
    MAIL_FROM: 'Jarxis <noreply@example.com>',
  });
});

beforeEach(() => {
  vi.resetAllMocks();
  m.requireProviderOwner.mockResolvedValue('owner-1');
  m.rateLimit.mockResolvedValue(undefined);
  m.requestIP.mockReturnValue('shared');
});

describe('Provider administration routes', () => {
  it('lists connections and key metadata after an owner read check', async () => {
    m.listConnections.mockResolvedValue([{ id: 'c1' }]);
    m.listGatewayKeys.mockResolvedValue([{ id: 'k1' }]);
    const response = await providers.GET(send('/api/admin/providers', 'GET'));
    expect(response.status).toBe(200);
    expect(m.requireProviderOwner).toHaveBeenCalledWith(expect.any(Request), 'providers:read');
    expect(await response.json()).toEqual({ connections: [{ id: 'c1' }], keys: [{ id: 'k1' }] });
  });

  it('rejects callers who are not owners before any service call', async () => {
    m.requireProviderOwner.mockRejectedValue(
      new HttpError(403, 'FORBIDDEN', 'Owner access required'),
    );
    expect((await providers.GET(send('/api/admin/providers', 'GET'))).status).toBe(403);
    expect(
      (
        await providers.POST(
          send('/api/admin/providers', 'POST', { name: 'x', provider: 'openai' }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await keyById.DELETE(send('/api/admin/providers/keys/k', 'DELETE'), params({ keyId: 'k' })))
        .status,
    ).toBe(403);
    expect(m.listConnections).not.toHaveBeenCalled();
    expect(m.createConnection).not.toHaveBeenCalled();
    expect(m.revokeGatewayKey).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin mutation before authorization', async () => {
    const response = await providers.POST(
      send(
        '/api/admin/providers',
        'POST',
        { name: 'x', provider: 'openai' },
        { Origin: 'https://evil.test' },
      ),
    );
    expect(response.status).toBe(403);
    expect(m.requireProviderOwner).not.toHaveBeenCalled();
  });

  it('creates a keyless connection without discovery', async () => {
    m.createConnection.mockResolvedValue({ id: 'c1', status: 'needs_credentials' });
    const input = { name: 'Main', provider: 'openai' };
    const response = await providers.POST(send('/api/admin/providers', 'POST', input));
    expect(response.status).toBe(201);
    expect(m.createConnection).toHaveBeenCalledWith('owner-1', input, true);
    expect(m.refreshConnection).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      connection: { id: 'c1', status: 'needs_credentials' },
    });
  });

  it('runs the first discovery for a keyed connection and returns the refreshed record', async () => {
    m.createConnection.mockResolvedValue({ id: 'c1', status: 'ready' });
    m.refreshConnection.mockResolvedValue(undefined);
    m.getConnection.mockResolvedValue({ id: 'c1', status: 'ready', models: 3 });
    const response = await providers.POST(
      send('/api/admin/providers', 'POST', {
        name: 'Main',
        provider: 'openai',
        apiKey: 'sk-fake',
      }),
    );
    expect(response.status).toBe(201);
    expect(m.refreshConnection).toHaveBeenCalledWith('c1', true);
    expect(await response.json()).toEqual({ connection: { id: 'c1', status: 'ready', models: 3 } });
  });

  it('keeps the committed connection when first discovery fails', async () => {
    m.createConnection.mockResolvedValue({ id: 'c1', status: 'ready' });
    m.refreshConnection.mockRejectedValue(new Error('upstream down'));
    const response = await providers.POST(
      send('/api/admin/providers', 'POST', {
        name: 'Main',
        provider: 'openai',
        apiKey: 'sk-fake',
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ connection: { id: 'c1', status: 'ready' } });
  });

  it('validates create input, including custom endpoints', async () => {
    const response = await providers.POST(
      send('/api/admin/providers', 'POST', { name: 'Custom', provider: 'custom' }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(m.createConnection).not.toHaveBeenCalled();
  });

  it('updates and deletes a connection by id', async () => {
    m.updateConnection.mockResolvedValue({ id: 'c1', enabled: false });
    const patched = await providerById.PATCH(
      send('/api/admin/providers/c1', 'PATCH', { enabled: false }),
      params({ id: 'c1' }),
    );
    expect(patched.status).toBe(200);
    expect(m.updateConnection).toHaveBeenCalledWith('owner-1', 'c1', { enabled: false });
    expect(await patched.json()).toEqual({ connection: { id: 'c1', enabled: false } });

    const empty = await providerById.PATCH(
      send('/api/admin/providers/c1', 'PATCH', {}),
      params({ id: 'c1' }),
    );
    expect(empty.status).toBe(400);

    const deleted = await providerById.DELETE(
      send('/api/admin/providers/c1', 'DELETE'),
      params({ id: 'c1' }),
    );
    expect(deleted.status).toBe(200);
    expect(m.deleteConnection).toHaveBeenCalledWith('owner-1', 'c1');
    expect(await deleted.json()).toEqual({ success: true });
  });

  it('adds a manual model and schedules a refresh', async () => {
    m.addManualModel.mockResolvedValue({ id: 'c1' });
    const added = await providerModels.POST(
      send('/api/admin/providers/c1/models', 'POST', { upstreamId: 'gpt-x' }),
      params({ id: 'c1' }),
    );
    expect(added.status).toBe(201);
    expect(m.addManualModel).toHaveBeenCalledWith('owner-1', 'c1', 'gpt-x');

    const invalid = await providerModels.POST(
      send('/api/admin/providers/c1/models', 'POST', { upstreamId: '../bad' }),
      params({ id: 'c1' }),
    );
    expect(invalid.status).toBe(400);

    m.scheduleRefresh.mockResolvedValue({ id: 'c1', status: 'ready' });
    const refreshed = await providerRefresh.POST(
      send('/api/admin/providers/c1/refresh'),
      params({ id: 'c1' }),
    );
    expect(refreshed.status).toBe(200);
    expect(m.scheduleRefresh).toHaveBeenCalledWith('owner-1', 'c1');
  });

  it('validates and authorizes model state updates', async () => {
    m.updateModelStates.mockResolvedValue({ id: 'c1', models: [] });
    const input = { version: 'a'.repeat(64), states: 'AQ', connection: { name: 'Renamed' } };
    const saved = await providerModels.PATCH(
      send('/api/admin/providers/c1/models', 'PATCH', input),
      params({ id: 'c1' }),
    );
    expect(saved.status).toBe(200);
    expect(m.requireProviderOwner).toHaveBeenCalledWith(expect.any(Request), 'providers:manage');
    expect(m.updateModelStates).toHaveBeenCalledWith('owner-1', 'c1', input);
    const bad = await providerModels.PATCH(
      send('/api/admin/providers/c1/models', 'PATCH', { ...input, states: 'bad+' }),
      params({ id: 'c1' }),
    );
    expect(bad.status).toBe(400);
    m.requireProviderOwner.mockRejectedValueOnce(
      new HttpError(403, 'FORBIDDEN', 'Owner access required'),
    );
    const denied = await providerModels.PATCH(
      send('/api/admin/providers/c1/models', 'PATCH', input),
      params({ id: 'c1' }),
    );
    expect(denied.status).toBe(403);
  });

  it('issues and revokes gateway keys', async () => {
    m.issueGatewayKey.mockResolvedValue({ id: 'k1', key: 'jml_fake' });
    const issued = await keys.POST(send('/api/admin/providers/keys', 'POST', { name: 'CI' }));
    expect(issued.status).toBe(201);
    expect(m.issueGatewayKey).toHaveBeenCalledWith('owner-1', 'CI');
    expect(await issued.json()).toEqual({ id: 'k1', key: 'jml_fake' });

    const bad = await keys.POST(send('/api/admin/providers/keys', 'POST', { name: '' }));
    expect(bad.status).toBe(400);

    const revoked = await keyById.DELETE(
      send('/api/admin/providers/keys/k1', 'DELETE'),
      params({ keyId: 'k1' }),
    );
    expect(revoked.status).toBe(200);
    expect(m.revokeGatewayKey).toHaveBeenCalledWith('owner-1', 'k1');
  });

  it('previews discovery with the request signal and requires manage permission', async () => {
    m.previewDiscovery.mockResolvedValue({ status: 'ok', models: [] });
    const input = { provider: 'openai', apiKey: 'sk-fake' };
    const response = await discover.POST(send('/api/admin/providers/discover', 'POST', input));
    expect(response.status).toBe(200);
    expect(m.requireProviderOwner).toHaveBeenCalledWith(expect.any(Request), 'providers:manage');
    expect(m.previewDiscovery).toHaveBeenCalledWith(input, expect.any(AbortSignal));
    expect(await response.json()).toEqual({ discovery: { status: 'ok', models: [] } });
  });
});

describe('documentation routes', () => {
  it('serves the API reference only after the docs guard passes', async () => {
    m.apiReference.mockReturnValue(() => new Response('<html>docs</html>'));
    const response = await docs.GET(send('/api/docs', 'GET'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>docs</html>');
    expect(m.apiReference).toHaveBeenCalledWith({ url: '/api/openapi', theme: 'default' });

    m.guardDocs.mockRejectedValueOnce(new HttpError(403, 'FORBIDDEN', 'Owner access required'));
    expect((await docs.GET(send('/api/docs', 'GET'))).status).toBe(403);
  });

  it('serves the OpenAPI document only after the docs guard passes', async () => {
    m.openapi.mockResolvedValue({ openapi: '3.1.1' });
    const response = await openapiRoute.GET(send('/api/openapi', 'GET'));
    expect(await response.json()).toEqual({ openapi: '3.1.1' });

    m.guardDocs.mockRejectedValueOnce(new HttpError(401, 'UNAUTHENTICATED', 'Sign in required'));
    const denied = await openapiRoute.GET(send('/api/openapi', 'GET'));
    expect(denied.status).toBe(401);
    expect(m.openapi).toHaveBeenCalledTimes(1);
  });
});

describe('health route', () => {
  it('reports ok when database and Redis respond', async () => {
    const ping = vi.fn().mockResolvedValue('PONG');
    m.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    m.readyRedis.mockResolvedValue({ ping });
    const response = await health.GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(ping).toHaveBeenCalled();
  });

  it('returns a sanitized 503 when a dependency fails', async () => {
    m.queryRaw.mockRejectedValue(new Error('connection refused at 10.0.0.1'));
    const response = await health.GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });

    m.queryRaw.mockResolvedValue([]);
    m.readyRedis.mockRejectedValue(new Error('redis down'));
    expect((await health.GET()).status).toBe(503);
  });
});

describe('model gateway route', () => {
  it('forwards GET and POST with the path segments', async () => {
    m.handleGateway.mockResolvedValue(new Response('ok'));
    const request = new Request(`${ORIGIN}/api/llm/v1/models`);
    await llm.GET(request, params({ path: ['models'] }));
    expect(m.handleGateway).toHaveBeenCalledWith(request, ['models']);
    await llm.POST(request, params({ path: ['chat', 'completions'] }));
    expect(m.handleGateway).toHaveBeenLastCalledWith(request, ['chat', 'completions']);
  });
});

describe('bearer token API route', () => {
  const bearer = (
    path: string,
    method = 'POST',
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

  it('logs in with rate limits per IP and per lower-cased email', async () => {
    m.signInEmail.mockResolvedValue({ user: { id: 'u1' }, token: 'session-token' });
    m.issueTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    const response = await v1.POST(
      bearer('/api/v1/auth/login', 'POST', {
        email: 'User@Example.com',
        password: 'fake-password',
      }),
    );
    expect(response.status).toBe(200);
    expect(m.rateLimit).toHaveBeenNthCalledWith(1, 'tokens:shared');
    expect(m.rateLimit).toHaveBeenNthCalledWith(2, 'login:user@example.com', 10, 300);
    expect(m.issueTokens).toHaveBeenCalledWith('u1', 'session-token');
    expect(await response.json()).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('fails closed when the rate limiter rejects', async () => {
    m.rateLimit.mockRejectedValue(new HttpError(429, 'RATE_LIMITED', 'Too many requests.'));
    const response = await v1.POST(
      bearer('/api/v1/auth/login', 'POST', { email: 'u@example.com', password: 'x' }),
    );
    expect(response.status).toBe(429);
    expect(m.signInEmail).not.toHaveBeenCalled();

    m.rateLimit.mockRejectedValue(
      new HttpError(503, 'UNAVAILABLE', 'Security service unavailable'),
    );
    expect(
      (await v1.POST(bearer('/api/v1/auth/refresh', 'POST', { refreshToken: REFRESH }))).status,
    ).toBe(503);
    expect(m.rotateTokens).not.toHaveBeenCalled();
  });

  it('returns a generic auth error for failed sign-in', async () => {
    m.signInEmail.mockRejectedValue(
      new APIError('UNAUTHORIZED', { message: 'Invalid email or password' }),
    );
    const response = await v1.POST(
      bearer('/api/v1/auth/login', 'POST', { email: 'u@example.com', password: 'wrong' }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'AUTH_ERROR', message: 'Authentication failed' },
    });
  });

  it('rejects malformed login and refresh bodies', async () => {
    expect(
      (await v1.POST(bearer('/api/v1/auth/login', 'POST', { email: 'nope', password: 'x' })))
        .status,
    ).toBe(400);
    expect(
      (await v1.POST(bearer('/api/v1/auth/refresh', 'POST', { refreshToken: 'short' }))).status,
    ).toBe(400);
  });

  it('rotates refresh tokens', async () => {
    m.rotateTokens.mockResolvedValue({ accessToken: 'a2' });
    const response = await v1.POST(
      bearer('/api/v1/auth/refresh', 'POST', { refreshToken: REFRESH }),
    );
    expect(response.status).toBe(200);
    expect(m.rotateTokens).toHaveBeenCalledWith(REFRESH);
  });

  it('revokes only the bearer token family on logout', async () => {
    m.identify.mockResolvedValue({ userId: 'u1', sessionId: 's1', familyId: 'f1' });
    const response = await v1.POST(
      bearer('/api/v1/auth/logout', 'POST', undefined, { Authorization: 'Bearer x' }),
    );
    expect(response.status).toBe(200);
    expect(m.revokeFamily).toHaveBeenCalledWith('u1', 'f1');

    m.identify.mockResolvedValue({ userId: 'u1', sessionId: 's1' });
    const cookie = await v1.POST(bearer('/api/v1/auth/logout'));
    expect(cookie.status).toBe(400);
    expect((await cookie.json()).error.code).toBe('BEARER_REQUIRED');
    expect(m.revokeFamily).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for unknown auth actions, wrong methods and extra segments', async () => {
    expect((await v1.GET(bearer('/api/v1/auth/login', 'GET'))).status).toBe(404);
    expect((await v1.POST(bearer('/api/v1/auth/login/extra'))).status).toBe(404);
    expect((await v1.POST(bearer('/api/v1/auth/unknown'))).status).toBe(404);
    expect((await v1.DELETE(bearer('/api/v1/users/1', 'DELETE'))).status).toBe(404);
    expect((await v1.PUT(bearer('/api/v1/me', 'PUT'))).status).toBe(404);
    expect((await v1.PATCH(bearer('/api/v1/me', 'PATCH'))).status).toBe(404);
  });

  it('resolves the caller identity on GET /me with a per-user limit', async () => {
    m.identify.mockResolvedValue({ userId: 'u1', sessionId: 's1', familyId: 'f1' });
    const response = await v1.GET(bearer('/api/v1/me', 'GET'));
    expect(response.status).toBe(200);
    expect(m.rateLimit).toHaveBeenCalledWith('api:u1', 120);
    expect(await response.json()).toEqual({ userId: 'u1', sessionId: 's1' });

    m.identify.mockRejectedValue(new HttpError(401, 'UNAUTHENTICATED', 'Sign in required'));
    expect((await v1.GET(bearer('/api/v1/me', 'GET'))).status).toBe(401);
  });
});

describe('Better Auth catch-all route', () => {
  it('hides disabled social and token endpoints', async () => {
    for (const path of [
      '/sign-in/social',
      '/link-social',
      '/callback',
      '/callback/github',
      '/account-info/',
    ]) {
      const response = await authRoute.POST(send(`/api/auth${path}`, 'POST'));
      expect(response.status).toBe(404);
    }
    expect(m.authHandler).not.toHaveBeenCalled();
  });

  it('hides the native reference and schema generator', async () => {
    expect((await authRoute.GET(send('/api/auth/reference', 'GET'))).status).toBe(404);
    expect((await authRoute.GET(send('/api/auth/open-api/generate-schema', 'GET'))).status).toBe(
      404,
    );
    expect(m.authHandler).not.toHaveBeenCalled();
  });

  it('uses separate read and write budgets before delegating', async () => {
    m.authHandler.mockResolvedValue(new Response('{}'));
    await authRoute.GET(send('/api/auth/get-session', 'GET'));
    expect(m.rateLimit).toHaveBeenCalledWith('auth:read:shared', 120);
    await authRoute.POST(send('/api/auth/sign-in/email', 'POST'));
    expect(m.rateLimit).toHaveBeenCalledWith('auth:write:shared', 30);
    expect(m.authHandler).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the limiter is unavailable', async () => {
    m.rateLimit.mockRejectedValue(
      new HttpError(503, 'UNAVAILABLE', 'Security service unavailable'),
    );
    expect((await authRoute.POST(send('/api/auth/sign-in/email', 'POST'))).status).toBe(503);
    expect(m.authHandler).not.toHaveBeenCalled();
  });
});
