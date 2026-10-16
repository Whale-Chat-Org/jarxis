import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  redisInstances: [] as Array<Record<string, unknown>>,
  redisArgs: [] as unknown[][],
  prismaArgs: [] as unknown[][],
  adapterArgs: [] as unknown[][],
}));

vi.mock('ioredis', () => {
  class FakeRedis {
    status = 'wait';
    connect = vi.fn(async () => {
      this.status = 'ready';
    });
    eval = vi.fn(async () => 1);
    on = vi.fn();
    constructor(...args: unknown[]) {
      m.redisArgs.push(args);
      m.redisInstances.push(this as unknown as Record<string, unknown>);
    }
  }
  return { default: FakeRedis };
});
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(...args: unknown[]) {
      m.adapterArgs.push(args);
    }
  },
}));
vi.mock('@prisma/client', () => ({
  Prisma: { marker: true },
  PrismaClient: class {
    tag = 'client';
    constructor(...args: unknown[]) {
      m.prismaArgs.push(args);
    }
    whoAmI() {
      return this.tag;
    }
  },
}));

const BASE_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/jarxis_test',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'a'.repeat(64),
  JWT_SECRET: 'b'.repeat(64),
  BREVO_API_KEY: 'xkeysib-test',
  MAIL_FROM: 'Jarxis <noreply@example.com>',
};
const saved = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  m.redisInstances.length = 0;
  m.redisArgs.length = 0;
  m.prismaArgs.length = 0;
  m.adapterArgs.length = 0;
  for (const key of ['TRUST_PROXY', 'AZURE_STORAGE_CONNECTION_STRING', 'AZURE_STORAGE_CONTAINER'])
    delete process.env[key];
  Object.assign(process.env, BASE_ENV);
});
afterEach(() => {
  process.env = { ...saved };
  delete (globalThis as { jarxisPrisma?: unknown }).jarxisPrisma;
});

describe('env', () => {
  it('parses and caches valid configuration', async () => {
    const { env } = await import('@/lib/env');
    const first = env();
    expect(first.TRUST_PROXY).toBe(false);
    process.env.REDIS_URL = 'not a url';
    expect(env()).toBe(first);
  });

  it('rejects invalid configuration and short secrets', async () => {
    process.env.JWT_SECRET = 'short';
    const { env } = await import('@/lib/env');
    expect(() => env()).toThrow();
  });

  it('rejects a JWT secret that reuses the session secret', async () => {
    process.env.JWT_SECRET = process.env.BETTER_AUTH_SECRET;
    const { env } = await import('@/lib/env');
    expect(() => env()).toThrow('JWT_SECRET must differ from BETTER_AUTH_SECRET');
  });

  it('parses avatar storage settings lazily with a private default container', async () => {
    const { avatarEnv } = await import('@/lib/env');
    expect(() => avatarEnv()).toThrow();
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    expect(avatarEnv().AZURE_STORAGE_CONTAINER).toBe('profile-photos');
  });

  it('rejects an invalid container name', async () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    process.env.AZURE_STORAGE_CONTAINER = 'Bad_Name';
    const { avatarEnv } = await import('@/lib/env');
    expect(() => avatarEnv()).toThrow();
  });
});

describe('redis', () => {
  it('creates one lazy client without an offline queue', async () => {
    const { redis } = await import('@/lib/redis');
    const client = redis();
    expect(redis()).toBe(client);
    expect(m.redisArgs).toEqual([
      [
        'redis://localhost:6379',
        { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false },
      ],
    ]);
    expect(m.redisInstances[0].on).toHaveBeenCalledWith('error', expect.any(Function));
    const onError = (m.redisInstances[0].on as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(() => onError(new Error('boom'))).not.toThrow();
  });

  it('connects on first use and fails closed when not ready', async () => {
    const { readyRedis, redis } = await import('@/lib/redis');
    await readyRedis();
    expect(m.redisInstances[0].connect).toHaveBeenCalledTimes(1);
    await readyRedis();
    expect(m.redisInstances[0].connect).toHaveBeenCalledTimes(1);

    (redis() as unknown as { status: string }).status = 'reconnecting';
    await expect(readyRedis()).rejects.toMatchObject({ status: 503, code: 'UNAVAILABLE' });
  });

  it('counts with a hashed key and rejects above the limit', async () => {
    const { rateLimit, redis } = await import('@/lib/redis');
    const client = redis() as unknown as { eval: ReturnType<typeof vi.fn> };
    client.eval.mockResolvedValueOnce(20);
    await rateLimit('login:user@example.com');
    const [, keys, key, seconds] = client.eval.mock.calls[0];
    expect(keys).toBe(1);
    expect(key).toMatch(/^limit:[0-9a-f]{64}$/);
    expect(key).not.toContain('user@example.com');
    expect(seconds).toBe(60);

    client.eval.mockResolvedValueOnce(21);
    await expect(rateLimit('login:user@example.com')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    });
    client.eval.mockResolvedValueOnce(5);
    await expect(rateLimit('x', 4, 10)).rejects.toMatchObject({ status: 429 });
    expect(client.eval.mock.calls[2][3]).toBe(10);
  });

  it('fails closed when Redis is unavailable', async () => {
    const { rateLimit, redis } = await import('@/lib/redis');
    const client = redis() as unknown as { connect: ReturnType<typeof vi.fn> };
    client.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(rateLimit('k')).rejects.toThrow('ECONNREFUSED');
  });

  it('trusts X-Real-IP only behind a configured proxy', async () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.9' });
    let mod = await import('@/lib/redis');
    expect(mod.requestIP(headers)).toBe('shared');

    vi.resetModules();
    process.env.TRUST_PROXY = 'true';
    mod = await import('@/lib/redis');
    expect(mod.requestIP(headers)).toBe('203.0.113.9');
    expect(mod.requestIP(new Headers())).toBe('unknown');
  });
});

describe('db', () => {
  it('creates the Prisma client lazily on first property access', async () => {
    const { db, Prisma } = await import('@/db');
    expect(Prisma).toEqual({ marker: true });
    expect(m.prismaArgs).toHaveLength(0);
    expect((db as unknown as { tag: string }).tag).toBe('client');
    expect((db as unknown as { whoAmI: () => string }).whoAmI()).toBe('client');
    expect(m.prismaArgs).toHaveLength(1);
    expect(m.adapterArgs).toEqual([[{ connectionString: BASE_ENV.DATABASE_URL, max: 10 }]]);
  });

  it('reuses a global client across module reloads', async () => {
    const first = await import('@/db');
    void (first.db as unknown as { tag: string }).tag;
    vi.resetModules();
    const second = await import('@/db');
    void (second.db as unknown as { tag: string }).tag;
    expect(m.prismaArgs).toHaveLength(1);
  });
});
