import 'server-only';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, lstat, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '@/db';
import { isActiveUser } from '@/lib/user-status';
import { decryptCredential, encryptCredential } from './crypto';
import { refreshConnection } from '@/lib/ml/discovery';
import { publicLoginUrl, readIsolatedCredential } from './login';

const active = new Map<string, ChildProcessWithoutNullStreams | null>();
const deadlineMs = 10 * 60 * 1000;
const pause = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));

async function privateStateRoot(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  ) {
    throw new Error('Worker state directory must be private and owned by the worker');
  }
}

export function isolatedEnvironment(
  directory: string,
  capture: string,
  browser: string,
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    LANG: 'C.UTF-8',
    HOME: join(directory, 'home'),
    TMPDIR: join(directory, 'tmp'),
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_CACHE_HOME: join(directory, 'cache'),
    CODEX_HOME: join(directory, 'codex'),
    CLAUDE_CONFIG_DIR: join(directory, 'claude'),
    BROWSER: browser,
    ML_BROWSER_CAPTURE: capture,
    TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
  };
}

export function loginCommand(provider: string): { executable: string; args: string[] } {
  const executable =
    provider === 'codex'
      ? process.env.ML_CODEX_CLI_PATH
      : provider === 'claude'
        ? process.env.ML_CLAUDE_CLI_PATH
        : undefined;
  if (!executable || !isAbsolute(executable))
    throw new Error('Provider CLI configuration unavailable');
  return {
    executable,
    args: provider === 'codex' ? ['login', '--device-auth'] : ['auth', 'login', '--claudeai'],
  };
}

export function loginInput(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_#.+\/-]{1,4096}$/.test(value))
    throw new Error('Invalid login code');
  return `${value}\n`;
}

export function deviceInstructions(output: string): string | null {
  const match = output.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/);
  return match ? `Open the vendor login page and enter device code ${match[0]}.` : null;
}

function stopChild(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {}
  };
  const timer = setTimeout(() => kill('SIGKILL'), 1500);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
  kill('SIGTERM');
}

async function ownerEligible(ownerId: string) {
  const owner = await db.user.findUnique({ where: { id: ownerId } });
  return (
    !!owner &&
    isActiveUser(owner) &&
    owner.role
      ?.split(',')
      .map((role) => role.trim())
      .includes('owner')
  );
}

async function executeLogin(jobId: string, signal: AbortSignal) {
  let ownsClaim = false;
  let directory: string | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  let closed: Promise<void> | undefined;
  try {
    const job = await db.mlLoginJob.findUnique({
      where: { id: jobId },
      include: { connection: true },
    });
    if (!job || job.status !== 'queued' || job.expiresAt <= new Date()) return;
    if (!(await ownerEligible(job.ownerId))) {
      await db.mlLoginJob.updateMany({
        where: { id: job.id, status: 'queued' },
        data: {
          status: 'failed',
          error: 'Login owner unavailable; start a new login.',
          encryptedState: null,
          encryptedInput: null,
          loginUrl: null,
          instructions: null,
        },
      });
      return;
    }
    const claimed = await db.mlLoginJob.updateMany({
      where: { id: job.id, ownerId: job.ownerId, status: 'queued', expiresAt: { gt: new Date() } },
      data: { status: 'running', claimedAt: new Date() },
    });
    if (claimed.count !== 1) return;
    ownsClaim = true;
    const command = loginCommand(job.connection.provider);
    const root = process.env.ML_WORKER_STATE_DIR;
    if (!root || !isAbsolute(root)) throw new Error('Worker state directory unavailable');
    await privateStateRoot(root);
    directory = await mkdtemp(join(root, 'login-'));
    await Promise.all(
      ['home', 'tmp', 'config', 'cache', 'codex', 'claude'].map((name) =>
        mkdir(join(directory!, name), { mode: 0o700 }),
      ),
    );
    const capture = join(directory, 'browser-url');
    const browser = join(directory, 'browser');
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const helper = fileURLToPath(new URL('../../../scripts/ml-browser.ts', import.meta.url));
    await writeFile(
      browser,
      `#!/bin/sh\nexec ${quote(process.execPath)} --conditions=react-server --import ${quote(import.meta.resolve('tsx'))} ${quote(helper)} "$@"\n`,
      { mode: 0o700 },
    );
    await db.mlLoginJob.updateMany({
      where: { id: job.id, status: 'running' },
      data: {
        encryptedState: encryptCredential(
          { provider: job.connection.provider },
          `login:${job.id}:state`,
        ),
      },
    });
    child = spawn(command.executable, command.args, {
      cwd: directory,
      env: isolatedEnvironment(directory, capture, browser),
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    active.set(job.id, child);
    let output = '';
    let bytes = 0;
    let exitCode: number | null | undefined;
    let spawnFailed = false;
    closed = new Promise<void>((done) => {
      child!.once('error', () => {
        spawnFailed = true;
      });
      child!.once('close', (code) => {
        exitCode = code;
        done();
      });
    });
    child.stdin.on('error', () => {
      spawnFailed = true;
    });
    const consume = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 262144) {
        spawnFailed = true;
        stopChild(child!);
        return;
      }
      output = (output + chunk.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '')).slice(-16384);
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    const expiresAt = Math.min(job.expiresAt.getTime(), Date.now() + deadlineMs);
    let publishedUrl: string | null = null;
    let publishedInstructions: string | null = null;
    while (!signal.aborted && Date.now() < expiresAt) {
      const current = await db.mlLoginJob.findUnique({ where: { id: job.id } });
      if (
        !current ||
        !['running', 'waiting'].includes(current.status) ||
        !(await ownerEligible(job.ownerId))
      )
        break;
      if (spawnFailed) throw new Error('Provider CLI login failed');
      let candidate: string | undefined;
      if (job.connection.provider === 'claude') {
        const stat = await lstat(capture).catch(() => null);
        if (stat?.isFile() && !stat.isSymbolicLink() && stat.size <= 4096)
          candidate = await readFile(capture, 'utf8');
      } else
        candidate = output.match(/https:\/\/auth\.openai\.com\/codex\/device\b[^\s\u001b]*/)?.[0];
      const url = candidate ? publicLoginUrl(job.connection.provider, candidate) : null;
      const instructions =
        job.connection.provider === 'codex'
          ? deviceInstructions(output)
          : url
            ? 'Open the vendor login page, then paste its authorization code here.'
            : null;
      if (url && (url !== publishedUrl || instructions !== publishedInstructions)) {
        await db.mlLoginJob.updateMany({
          where: { id: job.id, ownerId: job.ownerId, status: { in: ['running', 'waiting'] } },
          data: { status: 'waiting', loginUrl: url, instructions },
        });
        publishedUrl = url;
        publishedInstructions = instructions;
      }
      if (current.encryptedInput && job.connection.provider === 'claude') {
        const input = loginInput(
          decryptCredential<unknown>(current.encryptedInput, `login:${job.id}:input`),
        );
        const consumed = await db.mlLoginJob.updateMany({
          where: {
            id: job.id,
            ownerId: job.ownerId,
            status: 'waiting',
            encryptedInput: current.encryptedInput,
          },
          data: { encryptedInput: null },
        });
        if (consumed.count === 1) child.stdin.write(input);
      }
      if (exitCode !== undefined) {
        if (exitCode !== 0) throw new Error('Provider CLI login failed');
        const credential = await readIsolatedCredential(job.connection.provider, directory);
        await db.$transaction(async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ml:connection:${job.connectionId}`}, 0))`;
          const latestOwner = await transaction.user.findUnique({ where: { id: job.ownerId } });
          if (
            !latestOwner ||
            !isActiveUser(latestOwner) ||
            !latestOwner.role
              ?.split(',')
              .map((role) => role.trim())
              .includes('owner')
          )
            throw new Error('Login owner unavailable');
          const completed = await transaction.mlLoginJob.updateMany({
            where: {
              id: job.id,
              ownerId: job.ownerId,
              status: { in: ['running', 'waiting'] },
              expiresAt: { gt: new Date() },
            },
            data: {
              status: 'completed',
              encryptedState: null,
              encryptedInput: null,
              loginUrl: null,
              instructions: null,
              error: null,
            },
          });
          if (completed.count !== 1) throw new Error('Login no longer active');
          const saved = await transaction.mlConnection.updateMany({
            where: {
              id: job.connectionId,
              encryptedCredential: job.connection.encryptedCredential,
            },
            data: {
              encryptedCredential: encryptCredential(credential, job.connectionId),
              status: 'ready',
              discoveryStatus: 'pending',
              nextDiscoveryAt: new Date(),
              discoveryError: null,
              cooldownUntil: null,
            },
          });
          if (saved.count !== 1) throw new Error('Connection changed during login');
        });
        return;
      }
      await pause(500);
    }
    await db.mlLoginJob.updateMany({
      where: { id: job.id, status: { in: ['running', 'waiting'] } },
      data: {
        status: 'failed',
        error: signal.aborted
          ? 'Worker stopped; start a new login.'
          : 'Login expired or owner unavailable; start a new login.',
        encryptedState: null,
        encryptedInput: null,
        loginUrl: null,
        instructions: null,
      },
    });
  } catch {
    if (ownsClaim)
      await db.mlLoginJob
        .updateMany({
          where: { id: jobId, status: { in: ['queued', 'running', 'waiting'] } },
          data: {
            status: 'failed',
            error: 'Provider login failed. Check worker CLI configuration and start a new login.',
            encryptedState: null,
            encryptedInput: null,
            loginUrl: null,
            instructions: null,
          },
        })
        .catch(() => undefined);
  } finally {
    if (child) {
      stopChild(child);
      await closed;
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    active.delete(jobId);
  }
}

export async function workerTick(signal: AbortSignal) {
  await db.mlLoginJob.updateMany({
    where: { status: { in: ['queued', 'running', 'waiting'] }, expiresAt: { lte: new Date() } },
    data: {
      status: 'failed',
      error: 'Login expired; start a new login.',
      encryptedState: null,
      encryptedInput: null,
      loginUrl: null,
      instructions: null,
    },
  });
  if (signal.aborted) return;
  const queued = await db.mlLoginJob.findMany({
    where: { status: 'queued', expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: Math.max(0, 4 - active.size),
  });
  for (const job of queued) {
    if (active.has(job.id)) continue;
    active.set(job.id, null);
    void executeLogin(job.id, signal).catch(() => {
      active.delete(job.id);
    });
  }
  const due = await db.mlConnection.findMany({
    where: { enabled: true, status: 'ready', nextDiscoveryAt: { lte: new Date() } },
    orderBy: { nextDiscoveryAt: 'asc' },
    take: 5,
  });
  for (const connection of due) {
    if (signal.aborted) break;
    await refreshConnection(connection.id).catch(() => undefined);
  }
}

export async function runWorker(signal: AbortSignal) {
  const root = process.env.ML_WORKER_STATE_DIR;
  if (!root || !isAbsolute(root))
    throw new Error('ML_WORKER_STATE_DIR must be an absolute private directory');
  await privateStateRoot(root);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('login-')) continue;
    const directory = resolve(root, entry.name);
    const stat = await lstat(directory);
    if (Date.now() - (stat.birthtimeMs || stat.mtimeMs) > deadlineMs)
      await rm(directory, { recursive: true, force: true });
  }
  while (!signal.aborted) {
    try {
      await workerTick(signal);
    } catch {
      console.error('ML worker poll failed; retrying.');
    }
    if (!signal.aborted) await pause(1000);
  }
  for (const child of active.values()) if (child) stopChild(child);
  while (active.size) await pause(100);
}
