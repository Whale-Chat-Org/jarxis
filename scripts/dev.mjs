/**
 * `pnpm dev`: prepares the local environment, then starts the Next dev server. Extra arguments are
 * passed to `next dev`. Containers and Playwright use `pnpm dev:next`, which only starts the server.
 *
 * Plain Node with no dependencies so it runs straight after `git clone`, before `pnpm install`.
 * Every step is idempotent, so it is safe on every start:
 * - `.env` is created with generated secrets only when missing; an existing one is never touched.
 * - Migrations use `prisma migrate deploy`, which skips anything already applied.
 * - Fixture users are created only when missing (see scripts/seed-users.ts), so nothing duplicates.
 */
import { spawnSync } from 'node:child_process';

import { prepareEnv } from './lib/prepare-env.mjs';

const nextArgs = process.argv.slice(2);
const compose = ['compose', '-f', 'compose.yaml', '-f', 'compose.dev.yaml'];

function step(title) {
  console.log(`\n> ${title}`);
}

function run(command, args, { optional = false } = {}) {
  const result = spawnSync(command, args, { stdio: optional ? 'ignore' : 'inherit' });
  if (optional) return result.status === 0;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`\nFailed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
  return true;
}

if (process.env.NODE_ENV === 'production') {
  console.error(
    'pnpm dev is for local development only; refusing to run with NODE_ENV=production.',
  );
  process.exit(1);
}

step('Checking prerequisites');
const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  console.error(`Node 24+ is required (found ${process.versions.node}).`);
  process.exit(1);
}
if (!run('docker', ['compose', 'version'], { optional: true })) {
  console.error('Docker Compose v2 is required and the Docker daemon must be running.');
  process.exit(1);
}

step('Preparing .env');
prepareEnv({
  databaseVolumeExists: () =>
    run('docker', ['volume', 'inspect', 'jarxis_postgres-data'], { optional: true }),
  removeVolumeHint: 'docker volume rm jarxis_postgres-data',
});

step('Installing dependencies');
run('pnpm', ['install', '--frozen-lockfile']);
run('pnpm', ['db:generate']);

step('Starting PostgreSQL, Redis and Azurite');
run('docker', [...compose, 'up', '-d', '--wait', 'postgres', 'redis', 'azurite']);

step('Applying migrations');
run('pnpm', ['db:migrate']);

step('Verifying the role catalogue');
run('pnpm', ['db:seed']);

step('Seeding development users (existing ones are left unchanged)');
run('pnpm', ['db:seed:users']);

step('Starting the Next dev server');
run('pnpm', ['dev:next', ...nextArgs]);
