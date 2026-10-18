import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/check-test-database.mjs', import.meta.url));

describe('test database startup check', () => {
  it.each(['jarxis_test', 'jarxis_test_e2e'])('accepts %s without connecting', (database) => {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, DATABASE_URL: `postgresql://test:test@127.0.0.1:9/${database}` },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
  });

  it.each(['', 'invalid-url', 'postgresql://test:test@127.0.0.1:9/jarxis'])(
    'rejects unsafe configuration (%s)',
    (databaseURL) => {
      const result = spawnSync(process.execPath, [script], {
        env: { ...process.env, DATABASE_URL: databaseURL },
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Tests require DATABASE_URL pointing to a dedicated jarxis_test database',
      );
    },
  );
});
