import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260928000000_installation_setup/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('installation setup migration backfill', () => {
  it.each([
    ['fresh installation', null, false, 0],
    ['existing owner', 'user, owner', false, 1],
    ['unrelated role', 'co-owner', false, 0],
    ['deleted owner with bootstrap history', null, true, 1],
  ] as const)('%s', async (_name, role, hasHistory, expected) => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      const schema = `setup_probe_${randomBytes(8).toString('hex')}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query(`CREATE TABLE app_user (role text);
        CREATE TABLE audit_logs (id text, action text, target_id text, created_at timestamptz)`);
      if (role) await client.query('INSERT INTO app_user (role) VALUES ($1)', [role]);
      if (hasHistory)
        await client.query(
          `INSERT INTO audit_logs VALUES ('audit', 'owner.bootstrap', 'deleted', now())`,
        );
      await client.query(migration);
      const { rows } = await client.query('SELECT count(*)::int AS count FROM installation_setup');
      expect(rows[0].count).toBe(expected);
    } finally {
      // The schema and all fixture tables disappear with the transaction.
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
