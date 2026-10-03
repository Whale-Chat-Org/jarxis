import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  owner: vi.fn(),
  due: vi.fn(),
  save: vi.fn(),
  transaction: vi.fn(),
  discover: vi.fn(),
  credentials: vi.fn(),
  lock: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@/db', () => ({
  db: {
    mlLoginJob: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
    user: { findUnique: mocks.owner },
    mlConnection: { findMany: mocks.due },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/ml/discovery', () => ({ refreshConnection: mocks.discover }));
vi.mock('@/lib/ml/crypto', () => ({
  encryptCredential: (value: unknown, context: string) => JSON.stringify({ value, context }),
  decryptCredential: (value: string) => JSON.parse(value).value,
}));
vi.mock('@/lib/ml/login', async (original) => ({
  ...(await original<typeof import('@/lib/ml/login')>()),
  readIsolatedCredential: mocks.credentials,
}));
import {
  deviceInstructions,
  isolatedEnvironment,
  loginCommand,
  loginInput,
  runWorker,
  workerTick,
} from '@/lib/ml/worker';

let root: string;
let controller: AbortController;
let job: Record<string, unknown>;
let child: EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: string | null;
  kill: () => boolean;
};

beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'ml-worker-test-'));
  vi.stubEnv('ML_WORKER_STATE_DIR', root);
  vi.stubEnv('ML_CODEX_CLI_PATH', '/vendor/codex');
  vi.stubEnv('ML_CLAUDE_CLI_PATH', '/vendor/claude');
  controller = new AbortController();
  job = {
    id: 'job',
    ownerId: 'owner',
    connectionId: 'connection',
    status: 'queued',
    encryptedInput: null,
    expiresAt: new Date(Date.now() + 600000),
    connection: { provider: 'codex', encryptedCredential: null },
  };
  mocks.owner.mockResolvedValue({ role: 'owner', emailVerified: true, banned: false });
  mocks.findMany.mockImplementation(async () => (job.status === 'queued' ? [job] : []));
  mocks.findUnique.mockImplementation(async () => ({ ...job }));
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    if (!where.id) return { count: 0 };
    const statuses = typeof where.status === 'string' ? [where.status] : where.status?.in;
    if (statuses && !statuses.includes(job.status)) return { count: 0 };
    Object.assign(job, data);
    return { count: 1 };
  });
  mocks.due.mockResolvedValue([]);
  mocks.discover.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ count: 1 });
  mocks.credentials.mockResolvedValue({
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: Date.now() + 3600000,
  });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $executeRaw: mocks.lock,
      user: { findUnique: mocks.owner },
      mlLoginJob: { updateMany: mocks.updateMany },
      mlConnection: { updateMany: mocks.save },
    }),
  );
  child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => {
      child.signalCode = 'SIGTERM';
      child.emit('close', null);
      return true;
    }),
  });
  mocks.spawn.mockReturnValue(child);
});
afterEach(async () => {
  controller.abort();
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await chmod(root, 0o700);
  await runWorker(controller.signal);
  await vi.waitFor(async () => expect(await readdir(root)).toEqual([]));
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('worker CLI isolation', () => {
  it('selects only supported actual login commands and absolute CLI paths', () => {
    expect(loginCommand('codex').args).toEqual(['login', '--device-auth']);
    expect(loginCommand('claude').args).toEqual(['auth', 'login', '--claudeai']);
    expect(() => loginCommand('custom')).toThrow('configuration');
    vi.stubEnv('ML_CODEX_CLI_PATH', 'codex');
    expect(() => loginCommand('codex')).toThrow('configuration');
  });

  it('replaces host credential environment and bounds stdin to a single code', () => {
    vi.stubEnv('OPENAI_API_KEY', 'host-secret');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'host-secret');
    const env = isolatedEnvironment('/isolated', '/isolated/capture', '/isolated/browser');
    expect(env.HOME).toBe('/isolated/home');
    expect(env.CODEX_HOME).toBe('/isolated/codex');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/isolated/claude');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(loginInput('code#state')).toBe('code#state\n');
    expect(() => loginInput('code\ncommand')).toThrow('Invalid login code');
    expect(deviceInstructions('untrusted token=secret code ABCD-EFGHI')).toBe(
      'Open the vendor login page and enter device code ABCD-EFGHI.',
    );
  });

  it('claims jobs, publishes only approved URL/code, then encrypts successful credentials and cleans files', async () => {
    await workerTick(controller.signal);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    expect(mocks.spawn.mock.calls[0][2].shell).toBe(false);
    child.stdout.write(
      'secret unrelated output\nhttps://auth.openai.com/codex/device\nABCD-EFGHI\n',
    );
    await vi.waitFor(() => expect(job.status).toBe('waiting'), { timeout: 2000 });
    expect(job.loginUrl).toBe('https://auth.openai.com/codex/device');
    expect(job.instructions).not.toContain('secret');
    child.exitCode = 0;
    child.emit('close', 0);
    await vi.waitFor(() => expect(job.status).toBe('completed'), { timeout: 2000 });
    expect(JSON.parse(mocks.save.mock.calls[0][0].data.encryptedCredential).context).toBe(
      'connection',
    );
    expect(job.encryptedState).toBeNull();
    expect(job.loginUrl).toBeNull();
  });

  it('terminates a canceled CLI and never persists its credentials', async () => {
    await workerTick(controller.signal);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    job.status = 'canceled';
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalled(), { timeout: 2000 });
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(job.status).toBe('canceled');
  });

  it('captures Claude browser URLs and consumes encrypted owner codes once', async () => {
    job.connection = { provider: 'claude', encryptedCredential: null };
    await workerTick(controller.signal);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    const { env } = mocks.spawn.mock.calls[0][2];
    const { writeFile } = await import('node:fs/promises');
    await writeFile(env.ML_BROWSER_CAPTURE, 'https://claude.ai/oauth/authorize?state=test');
    await vi.waitFor(() => expect(job.status).toBe('waiting'), { timeout: 2000 });
    const writes = vi.spyOn(child.stdin, 'write');
    job.encryptedInput = JSON.stringify({
      value: 'authorization#state',
      context: 'login:job:input',
    });
    await vi.waitFor(() => expect(writes).toHaveBeenCalledWith('authorization#state\n'), {
      timeout: 2000,
    });
    expect(job.encryptedInput).toBeNull();
    job.status = 'canceled';
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalled(), { timeout: 2000 });
    expect(writes).toHaveBeenCalledOnce();
  });

  it('fails closed on CLI failure without exposing output or importing credentials', async () => {
    await workerTick(controller.signal);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    child.stderr.write('access_token=provider-secret');
    child.exitCode = 1;
    child.emit('close', 1);
    await vi.waitFor(() => expect(job.status).toBe('failed'), { timeout: 2000 });
    expect(job.error).not.toContain('provider-secret');
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('rejects unverified owners without launching the CLI', async () => {
    mocks.owner.mockResolvedValue({ role: 'owner', emailVerified: false, banned: false });
    await workerTick(controller.signal);
    await vi.waitFor(() => expect(mocks.owner).toHaveBeenCalled());
    expect(mocks.spawn).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(job.status).toBe('failed'));
  });

  it('refuses a state directory readable by other users', async () => {
    await chmod(root, 0o755);
    await expect(runWorker(controller.signal)).rejects.toThrow('private and owned');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('expires login secrets and discovers only due enabled ready connections', async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.due.mockResolvedValue([{ id: 'due' }]);
    await workerTick(controller.signal);
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'failed',
      encryptedState: null,
      encryptedInput: null,
      loginUrl: null,
    });
    expect(mocks.due.mock.calls[0][0].where).toMatchObject({ enabled: true, status: 'ready' });
    expect(mocks.discover).toHaveBeenCalledWith('due');
  });

  it('accepts an already aborted shutdown without launching jobs', async () => {
    controller.abort();
    await runWorker(controller.signal);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
