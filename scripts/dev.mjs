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
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

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
const hex = () => randomBytes(32).toString('hex');
// Independent secrets that are safe to generate whenever they are missing or empty. Existing
// values are never replaced (ML_ENCRYPTION_KEY must be kept to decrypt stored credentials).
const generated = { BETTER_AUTH_SECRET: hex, JWT_SECRET: hex, ML_ENCRYPTION_KEY: hex };
const keyOf = (line) => (/^[A-Z][A-Z0-9_]*=/.test(line) ? line.slice(0, line.indexOf('=')) : null);
const example = readFileSync('.env.example', 'utf8').split('\n');

if (existsSync('.env')) {
  // Keep existing developers working when .env.example gains variables: fill empty generated
  // secrets and append missing keys, without touching any value that is already set.
  const lines = readFileSync('.env', 'utf8').replace(/\n+$/, '').split('\n');
  const present = new Set(lines.map(keyOf).filter(Boolean));
  const changed = [];
  const updated = lines.map((line) => {
    const key = keyOf(line);
    if (key in generated && line === `${key}=`) {
      changed.push(key);
      return `${key}=${generated[key]()}`;
    }
    return line;
  });
  const missing = example.filter((line) => keyOf(line) && !present.has(keyOf(line)));
  for (const line of missing) {
    const key = keyOf(line);
    changed.push(key);
    updated.push(key in generated && line === `${key}=` ? `${key}=${generated[key]()}` : line);
  }
  if (changed.length) {
    writeFileSync('.env', `${updated.join('\n')}\n`);
    console.log(`Added to .env (values not shown): ${changed.join(', ')}`);
  } else {
    console.log('.env is up to date; leaving it unchanged.');
  }
} else {
  const dbPassword = randomBytes(24).toString('hex');
  const values = {
    POSTGRES_PASSWORD: dbPassword,
    ...Object.fromEntries(Object.entries(generated).map(([key, make]) => [key, make()])),
    // The app requires a value to boot. Email delivery fails until a real Brevo key is set, but
    // the seeded fixture users are already verified and can sign in without email.
    BREVO_API_KEY: 'local-dev-placeholder',
  };
  const env = example
    .map((line) => {
      const key = keyOf(line);
      if (key === 'DATABASE_URL') return line.replace('replace-with-url-safe-password', dbPassword);
      return key in values ? `${key}=${values[key]}` : line;
    })
    .join('\n');
  writeFileSync('.env', env, { mode: 0o600 });
  console.log('Created .env with generated local secrets (values not shown).');
  console.log('Set BREVO_API_KEY and MAIL_FROM in .env to send real email.');
  // A database volume from an earlier checkout keeps its original password.
  if (run('docker', ['volume', 'inspect', 'jarxis_postgres-data'], { optional: true }))
    console.warn(
      'Warning: an existing jarxis_postgres-data volume uses its original password. Restore the\n' +
        'old .env, or remove the volume (this deletes local data) before re-running.',
    );
}

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
