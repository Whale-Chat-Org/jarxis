import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('@/lib/ml/network', () => ({ safeFetch: mocks.fetch }));
vi.mock('@/lib/ml/crypto', () => ({
  encryptCredential: (value: unknown, context: string) => JSON.stringify({ value, context }),
  decryptCredential: (value: string, context: string) => {
    const envelope = JSON.parse(value);
    if (envelope.context !== context) throw new Error('Context mismatch');
    return envelope.value;
  },
}));
import {
  getUsableCredential,
  parseCliCredential,
  publicLoginUrl,
  readIsolatedCredential,
} from '@/lib/ml/login';
import type { Credential } from '@/lib/ml/types';

const wrap = (credential: Credential, id = 'connection') =>
  JSON.stringify({ value: credential, context: id });
const connection = (credential: Credential) => ({
  id: 'connection',
  provider: 'codex',
  status: 'ready',
  encryptedCredential: wrap(credential),
});
const expired = {
  accessToken: 'old',
  refreshToken: 'refresh-secret',
  expiresAt: Date.now() - 1000,
  accountId: 'account',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ML_CODEX_OAUTH_CLIENT_ID', 'audited-test-client');
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $executeRaw: mocks.lock,
      mlConnection: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    }),
  );
  mocks.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe('isolated vendor login credentials', () => {
  it('only publishes known HTTPS vendor authorization URLs', () => {
    expect(publicLoginUrl('codex', 'https://auth.openai.com/codex/device')).toBeTruthy();
    expect(
      publicLoginUrl(
        'claude',
        'https://claude.ai/oauth/authorize?state=opaque&code_challenge=test',
      ),
    ).toBeTruthy();
    for (const url of [
      'http://auth.openai.com/codex/device',
      'https://auth.openai.com.evil.test/codex/device',
      'https://user:secret@auth.openai.com/codex/device',
      'https://auth.openai.com/codex/device?access_token=secret',
      'https://auth.openai.com/codex/device#secret',
      'https://auth.openai.com:8443/codex/device',
    ]) {
      expect(publicLoginUrl('codex', url)).toBeNull();
    }
  });

  it('extracts subscription credentials and rejects API key/invalid expiry files', () => {
    const access = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
    expect(
      parseCliCredential('codex', {
        tokens: { access_token: access, refresh_token: 'refresh', account_id: 'account' },
      }),
    ).toMatchObject({ accountId: 'account', refreshToken: 'refresh' });
    expect(
      parseCliCredential('claude', {
        claudeAiOauth: {
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: Date.now() + 3600000,
        },
      }),
    ).toMatchObject({ accessToken: 'access' });
    expect(() => parseCliCredential('codex', { OPENAI_API_KEY: 'key' })).toThrow(
      'CLI credential unavailable',
    );
    expect(() =>
      parseCliCredential('claude', {
        claudeAiOauth: { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1 },
      }),
    ).toThrow('CLI credential expiry unavailable');
  });

  it('reads only isolated files and rejects symlinks outside the login directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ml-login-test-'));
    try {
      await mkdir(join(root, 'claude'));
      const filename = join(root, 'claude/.credentials.json');
      await writeFile(
        filename,
        JSON.stringify({
          claudeAiOauth: {
            accessToken: 'access',
            refreshToken: 'refresh',
            expiresAt: Date.now() + 3600000,
          },
        }),
      );
      expect((await readIsolatedCredential('claude', root)).accessToken).toBe('access');
      await rm(filename);
      await writeFile(join(root, 'external'), '{}');
      await symlink(join(root, 'external'), filename);
      await expect(readIsolatedCredential('claude', root)).rejects.toThrow(
        'CLI credential unavailable',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('credential refresh', () => {
  it('returns a ready API key without invoking refresh', async () => {
    expect(await getUsableCredential(connection({ apiKey: 'key' }))).toEqual({ apiKey: 'key' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    await expect(
      getUsableCredential({ ...connection(expired), status: 'pending' }),
    ).rejects.toThrow('reconnect');
  });

  it('locks before rereading and encrypts rotated credentials in connection context', async () => {
    mocks.findUnique.mockResolvedValue(connection(expired));
    mocks.fetch.mockResolvedValue(
      Response.json({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }),
    );
    const result = await getUsableCredential(connection(expired));
    expect(result.accessToken).toBe('new');
    expect(result.refreshToken).toBe('rotated');
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.findUnique.mock.invocationCallOrder[0],
    );
    const saved = mocks.updateMany.mock.calls[0][0];
    expect(saved.where.encryptedCredential).toBe(wrap(expired));
    expect(JSON.parse(saved.data.encryptedCredential).context).toBe('connection');
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://auth.openai.com/oauth/token');
  });

  it('uses the credential another request already refreshed under the lock', async () => {
    mocks.findUnique.mockResolvedValue(
      connection({ ...expired, accessToken: 'fresh', expiresAt: Date.now() + 3600000 }),
    );
    expect((await getUsableCredential(connection(expired))).accessToken).toBe('fresh');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('serializes competing refreshes and reads the rotated token before the second request', async () => {
    let current = connection(expired);
    let tail = Promise.resolve();
    mocks.transaction.mockImplementation((callback) => {
      const operation = tail.then(() =>
        callback({
          $executeRaw: mocks.lock,
          mlConnection: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
        }),
      );
      tail = operation.then(() => undefined);
      return operation;
    });
    mocks.findUnique.mockImplementation(async () => current);
    mocks.updateMany.mockImplementation(async ({ data }) => {
      current = { ...current, ...data };
      return { count: 1 };
    });
    mocks.fetch.mockResolvedValue(
      Response.json({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }),
    );
    const results = await Promise.all([
      getUsableCredential(connection(expired)),
      getUsableCredential(connection(expired)),
    ]);
    expect(results.map((value) => value.accessToken)).toEqual(['new', 'new']);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.lock).toHaveBeenCalledTimes(4);
  });

  it('commits invalid-grant reconnect status before throwing a sanitized error', async () => {
    mocks.findUnique.mockResolvedValue(connection(expired));
    mocks.fetch.mockResolvedValue(
      Response.json({ error: 'invalid_grant', detail: 'provider-secret' }, { status: 400 }),
    );
    await expect(getUsableCredential(connection(expired))).rejects.toThrow(
      'Provider requires reconnect',
    );
    expect(mocks.updateMany.mock.calls[0][0].data).toEqual({ status: 'reconnect_required' });
  });

  it('preserves credentials on transient errors and concurrent replacement', async () => {
    mocks.findUnique.mockResolvedValue(connection(expired));
    mocks.fetch.mockResolvedValue(Response.json({ detail: 'provider-secret' }, { status: 503 }));
    await expect(getUsableCredential(connection(expired))).rejects.toThrow(
      'Provider refresh unavailable',
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue(Response.json({ access_token: 'new', expires_in: 3600 }));
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(getUsableCredential(connection(expired))).rejects.toThrow(
      'Provider requires reconnect',
    );
  });

  it('does not guess an OAuth client identifier', async () => {
    vi.stubEnv('ML_CODEX_OAUTH_CLIENT_ID', '');
    mocks.findUnique.mockResolvedValue(connection(expired));
    await expect(getUsableCredential(connection(expired))).rejects.toThrow(
      'configuration unavailable',
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
