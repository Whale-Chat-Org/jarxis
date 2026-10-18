/**
 * `pnpm setup:apple`: prepares local infrastructure with Apple native containers (macOS 26+, Apple
 * silicon) instead of Docker. The VS Code "Dev" launch configuration runs it before starting Next,
 * and `pnpm dev:apple` runs it before `pnpm dev:next`.
 *
 * Plain Node with no dependencies so it runs straight after `git clone`. Every step is idempotent,
 * so it is safe on every start:
 * - The `container` CLI is installed with Homebrew when missing, and its services are started.
 * - `.env` is prepared exactly as `pnpm dev` does (see scripts/lib/prepare-env.mjs).
 * - PostgreSQL, Redis and configured object storage run as `jarxis-*` containers on the host ports that
 *   compose.dev.yaml uses. Existing containers are started again, never recreated, and data
 *   lives in named volumes. Keep images, commands and volumes in sync with compose*.yaml.
 * - Migrations, the role check and fixture users are applied like `pnpm dev`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { parseEnv } from 'node:util';

import { prepareEnv } from './lib/prepare-env.mjs';

function step(title) {
  console.log(`\n> ${title}`);
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function run(command, args, { optional = false } = {}) {
  const result = spawnSync(command, args, { stdio: optional ? 'ignore' : 'inherit' });
  if (optional) return !result.error && result.status === 0;
  if (result.error) fail(`${command} could not be started: ${result.error.message}`);
  if (result.status !== 0) fail(`Failed: ${command} ${args.join(' ')}`);
  return true;
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

function reachable(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 1000 });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitFor(title, check, seconds = 90) {
  for (let elapsed = 0; elapsed < seconds; elapsed++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(`${title} did not become ready within ${seconds}s. Check: container logs ${title}`);
}

if (process.env.NODE_ENV === 'production') {
  fail('setup:apple is for local development only; refusing to run with NODE_ENV=production.');
}

step('Checking prerequisites');
if (process.platform !== 'darwin' || output('sysctl', ['-n', 'hw.optional.arm64']) !== '1') {
  fail('Apple native containers need macOS 26+ on Apple silicon. Use `pnpm dev` with Docker.');
}
const [major] = process.versions.node.split('.').map(Number);
if (major < 24) fail(`Node 24+ is required (found ${process.versions.node}).`);

if (output('container', ['--version']) === null) {
  if (output('brew', ['--version']) === null) {
    fail(
      'Apple container is not installed and Homebrew was not found. Install Homebrew from\n' +
        '  https://brew.sh, or the signed package from https://github.com/apple/container/releases',
    );
  }
  console.log('Apple container is not installed; installing it with Homebrew.');
  run('brew', ['install', 'container']);
}
const version = output('container', ['--version']);
if (version === null) fail('Apple container is still not on PATH. Open a new terminal and retry.');
console.log(version);

if (!run('container', ['system', 'status'], { optional: true })) {
  console.log('Starting container services (the first start downloads the Linux kernel).');
  run('container', ['system', 'start', '--enable-kernel-install']);
}

step('Preparing .env');
prepareEnv({
  databaseVolumeExists: () =>
    run('container', ['volume', 'inspect', 'jarxis_postgres-data'], { optional: true }),
  removeVolumeHint: 'container volume delete jarxis_postgres-data',
});
const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
env.MINIO_ROOT_USER = env.AWS_ACCESS_KEY_ID;
env.MINIO_ROOT_PASSWORD = env.AWS_SECRET_ACCESS_KEY;

step('Installing dependencies');
run('pnpm', ['install', '--frozen-lockfile']);
run('pnpm', ['db:generate']);

step('Starting PostgreSQL, Redis and configured object storage');
const port = (key, fallback) => Number(env[key] || fallback);
const services = [
  {
    name: 'jarxis-postgres',
    image: 'postgres:latest',
    port: port('POSTGRES_PORT', 55432),
    target: 5432,
    volume: 'jarxis_postgres-data:/var/lib/postgresql',
    // `-e KEY` passes the value from this process, so secrets never appear in the argument list.
    env: [
      'POSTGRES_USER=jarxis',
      'POSTGRES_PASSWORD',
      `POSTGRES_DB=${env.POSTGRES_DB || 'jarxis'}`,
    ],
    command: [],
  },
  {
    name: 'jarxis-redis',
    image: 'redis:latest',
    port: port('REDIS_PORT', 56379),
    target: 6379,
    volume: 'jarxis_redis-data:/data',
    env: [],
    // Apple container volumes are ext4 images with a `lost+found` directory, which makes the
    // image's entrypoint skip fixing /data ownership, so Redis could not write its append-only
    // files. Fix ownership first, then hand over to the normal entrypoint.
    command: [
      'sh',
      '-c',
      'chown redis:redis /data && exec docker-entrypoint.sh redis-server --appendonly yes ' +
        '--maxmemory 256mb --maxmemory-policy noeviction',
    ],
  },
  {
    name: 'jarxis-storage',
    image: 'jarxis-minio:local',
    port: port('MINIO_PORT', 9000),
    target: 9000,
    volume: 'jarxis_minio-data:/data',
    env: ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD'],
    command: [],
  },
  {
    name: 'jarxis-azurite',
    image: 'mcr.microsoft.com/azure-storage/azurite:latest',
    port: port('AZURITE_BLOB_PORT', 10000),
    target: 10000,
    volume: 'jarxis_azurite-data:/data',
    env: [],
    command: [
      'azurite-blob',
      '--blobHost',
      '0.0.0.0',
      '--location',
      '/data',
      '--skipApiVersionCheck',
    ],
  },
].filter((service) => {
  if (service.name === 'jarxis-storage') return Boolean(env.S3_BUCKET);
  if (service.name === 'jarxis-azurite') return Boolean(env.AZURE_STORAGE_CONNECTION_STRING);
  return true;
});

const existing = new Map(
  JSON.parse(output('container', ['list', '--all', '--format', 'json']) ?? '[]').map((item) => [
    item.configuration.id,
    item.status.state,
  ]),
);
const volumes = new Set(
  JSON.parse(output('container', ['volume', 'list', '--format', 'json']) ?? '[]').map(
    (item) => item.configuration.name,
  ),
);
for (const service of services) {
  const state = existing.get(service.name);
  if (state === 'running') {
    console.log(`${service.name} is already running.`);
    continue;
  }
  if (state) {
    console.log(`Starting existing ${service.name}.`);
    run('container', ['start', service.name]);
    continue;
  }
  if (service.name === 'jarxis-storage') {
    const trust = process.env.NODE_EXTRA_CA_CERTS;
    run('container', [
      'build',
      '-f',
      'Dockerfile.minio',
      '-t',
      service.image,
      ...(trust ? ['--secret', `id=corporate_ca,src=${trust}`] : []),
      '.',
    ]);
  }
  const volumeName = service.volume.split(':')[0];
  if (!volumes.has(volumeName)) run('container', ['volume', 'create', volumeName]);
  if (service.name === 'jarxis-storage') {
    // Apple volumes do not inherit the image directory's unprivileged ownership.
    run('container', [
      'run',
      '--rm',
      '--user',
      '0',
      '--volume',
      service.volume,
      service.image,
      'chown',
      'node:node',
      '/data',
    ]);
  }
  console.log(`Creating ${service.name}.`);
  const result = spawnSync(
    'container',
    [
      'run',
      '--detach',
      '--name',
      service.name,
      '--publish',
      `127.0.0.1:${service.port}:${service.target}`,
      '--volume',
      service.volume,
      ...service.env.flatMap((value) => ['--env', value]),
      service.image,
      ...service.command,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...env } },
  );
  if (result.status !== 0) fail(`Could not start ${service.name}.`);
}

for (const service of services) {
  await waitFor(service.name, () => reachable('127.0.0.1', service.port));
}
await waitFor('jarxis-postgres', () =>
  run('container', ['exec', 'jarxis-postgres', 'pg_isready', '-U', 'jarxis'], { optional: true }),
);
console.log('PostgreSQL, Redis and configured object storage are ready.');

if (env.S3_BUCKET) {
  await waitFor('jarxis-storage', async () => {
    try {
      return (
        await fetch(`http://127.0.0.1:${port('MINIO_PORT', 9000)}/minio/health/ready`, {
          signal: AbortSignal.timeout(1000),
        })
      ).ok;
    } catch {
      return false;
    }
  });
}
step('Preparing local MinIO bucket');
run('node', ['scripts/setup-minio.mjs']);

step('Applying migrations');
run('pnpm', ['db:migrate']);

step('Verifying the role catalogue');
run('pnpm', ['db:seed']);

step('Seeding development users (existing ones are left unchanged)');
run('pnpm', ['db:seed:users']);

console.log('\n✓ Apple container infrastructure is ready.');
