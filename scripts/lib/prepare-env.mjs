/**
 * Creates or updates `.env` for local development. Shared by scripts/dev.mjs (Docker) and
 * scripts/setup-apple.mjs (Apple native containers). Plain Node with no dependencies.
 * - `.env` is created with generated secrets only when missing; existing values are never replaced.
 * - Keys added to `.env.example` later are appended, so older checkouts keep working.
 *
 * `databaseVolumeExists` reports whether a PostgreSQL volume from an earlier checkout exists, since
 * it keeps its original password and would not match a newly generated one.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function prepareEnv({ databaseVolumeExists, removeVolumeHint }) {
  const hex = () => randomBytes(32).toString('hex');
  // Independent secrets that are safe to generate whenever they are missing or empty. Existing
  // values are never replaced (ML_ENCRYPTION_KEY must be kept to decrypt stored credentials).
  const generated = { BETTER_AUTH_SECRET: hex, JWT_SECRET: hex, PROVIDERS_ENCRYPTION_KEY: hex };
  const keyOf = (line) =>
    /^[A-Z][A-Z0-9_]*=/.test(line) ? line.slice(0, line.indexOf('=')) : null;
  const example = readFileSync('.env.example', 'utf8').split('\n');

  if (existsSync('.env')) {
    // Keep existing developers working when .env.example gains variables: fill empty generated
    // secrets and append missing keys, without touching any value that is already set.
    const lines = readFileSync('.env', 'utf8').replace(/\n+$/, '').split('\n');
    const existing = Object.fromEntries(
      lines
        .filter((line) => keyOf(line))
        .map((line) => [
          keyOf(line),
          line.slice(line.indexOf('=') + 1).replace(/^['\"]|['\"]$/g, ''),
        ]),
    );
    generated.PROVIDERS_ENCRYPTION_KEY = () =>
      existing.PROVIDERS_ENCRYPTION_KEY || existing.ML_ENCRYPTION_KEY || hex();
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
    return;
  }

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
  if (databaseVolumeExists())
    console.warn(
      'Warning: an existing jarxis_postgres-data volume uses its original password. Restore the\n' +
        `old .env, or remove the volume (this deletes local data) before re-running:\n  ${removeVolumeHint}`,
    );
}
