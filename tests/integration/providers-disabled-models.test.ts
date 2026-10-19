import { db } from '@/db';
import { hashGatewayKey } from '@/lib/providers/crypto';
import { refreshConnection } from '@/lib/providers/discovery';
import { handleGateway } from '@/lib/providers/gateway';
import { getConnection, updateModelStates } from '@/lib/providers/service';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ credential: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/redis', () => ({ rateLimit: vi.fn() }));
vi.mock('@/lib/providers/credential', () => ({ getUsableCredential: mocks.credential }));
vi.mock('@/lib/providers/network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/network')>()),
  safeFetch: mocks.fetch,
}));

const KEY = 'jml_disabled_model_regression';
const CONNECTION_ID = 'disabled-model-connection';

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.credential.mockResolvedValue({ apiKey: 'test-only-provider-key' });
  await db.$executeRaw`TRUNCATE ml_connections, ml_gateway_keys, audit_logs, app_user CASCADE`;
  const ownerId = randomUUID();
  await db.user.create({
    data: {
      id: ownerId,
      name: 'Model owner',
      email: `${ownerId}@example.test`,
      emailVerified: true,
      role: 'owner',
    },
  });
  await db.providerGatewayKey.create({
    data: {
      name: 'Regression key',
      prefix: KEY.slice(0, 12),
      hash: hashGatewayKey(KEY),
      createdBy: ownerId,
    },
  });
  await db.providerConnection.create({
    data: {
      id: CONNECTION_ID,
      name: 'Test provider',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      status: 'ready',
      createdBy: ownerId,
      encryptedCredential: 'test-only-mocked-credential',
      models: {
        create: [
          {
            id: 'model-disabled',
            upstreamId: 'disabled',
            displayName: 'Before refresh',
            discovered: true,
          },
          { id: 'model-enabled', upstreamId: 'enabled', displayName: 'Enabled', discovered: true },
        ],
      },
    },
  });
  const connection = await getConnection(CONNECTION_ID);
  await updateModelStates(ownerId, CONNECTION_ID, {
    version: connection.modelStateVersion,
    states: 'Ag',
  });
});
afterAll(async () => db.$disconnect());

const request = (endpoint: string, payload?: unknown) =>
  new Request(`https://gateway.test/api/llm/v1/${endpoint}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

describe('disabled model regressions', () => {
  it('hides switched-off models and refuses both inference endpoints without calling upstream', async () => {
    const listing = await handleGateway(request('models'), ['models']);
    expect(listing.status).toBe(200);
    expect((await listing.json()).data.map((model: { id: string }) => model.id)).toEqual([
      'openai/enabled',
    ]);
    for (const [endpoint, input] of [
      ['chat/completions', { messages: [{ role: 'user', content: 'Hello' }] }],
      ['responses', { input: 'Hello' }],
    ] as const) {
      const response = await handleGateway(
        request(endpoint, { model: 'openai/disabled', ...input }),
        endpoint.split('/'),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'MODEL_NOT_FOUND' } });
    }
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('preserves switched-off models when catalog discovery updates metadata and adds models', async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        data: [
          { id: 'disabled', display_name: 'After refresh' },
          { id: 'enabled', display_name: 'Enabled after refresh' },
          { id: 'new', display_name: 'New model' },
        ],
      }),
    );
    await refreshConnection(CONNECTION_ID, true);
    const connection = await getConnection(CONNECTION_ID);
    expect(connection.discoveryStatus).toBe('ok');
    expect(connection.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          upstreamId: 'disabled',
          displayName: 'After refresh',
          enabled: false,
        }),
        expect.objectContaining({
          upstreamId: 'enabled',
          displayName: 'Enabled after refresh',
          enabled: true,
        }),
        expect.objectContaining({ upstreamId: 'new', enabled: true, discovered: true }),
      ]),
    );
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
