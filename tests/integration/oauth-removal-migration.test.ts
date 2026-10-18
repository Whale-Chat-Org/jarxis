import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { expect, it } from 'vitest';
const migration = readFileSync(
  new URL('../../prisma/migrations/20261010000000_remove_oauth/migration.sql', import.meta.url),
  'utf8',
);
it('deletes only subscription connections and dependent models/jobs while preserving audit history', async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = `oauth_probe_${randomBytes(8).toString('hex')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`CREATE TABLE ml_connections (id text PRIMARY KEY, provider text, encrypted_credential text);
      CREATE TABLE ml_models (connection_id text REFERENCES ml_connections(id) ON DELETE CASCADE);
      CREATE TABLE ml_login_jobs (connection_id text REFERENCES ml_connections(id) ON DELETE CASCADE, encrypted_state text);
      CREATE TABLE audit_logs (action text);
      INSERT INTO ml_connections VALUES ('key', 'openai', 'api-key'), ('codex', 'codex', 'token'), ('claude', 'claude', 'token');
      INSERT INTO ml_models VALUES ('key'), ('codex'), ('claude');
      INSERT INTO ml_login_jobs VALUES ('codex', 'state'), ('claude', 'state');
      INSERT INTO audit_logs VALUES ('ml:login:start');`);
    await client.query(migration);
    expect((await client.query('SELECT * FROM ml_connections')).rows).toEqual([
      { id: 'key', provider: 'openai', encrypted_credential: 'api-key' },
    ]);
    expect((await client.query('SELECT * FROM ml_models')).rows).toEqual([
      { connection_id: 'key' },
    ]);
    expect(
      (await client.query("SELECT to_regclass('ml_login_jobs') AS table_name")).rows[0].table_name,
    ).toBeNull();
    expect((await client.query('SELECT * FROM audit_logs')).rows).toEqual([
      { action: 'ml:login:start' },
    ]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
