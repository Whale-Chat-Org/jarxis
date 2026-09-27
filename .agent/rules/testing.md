# Test database isolation

- Integration tests execute TRUNCATE app_user, audit_logs CASCADE and alter role fixtures. Use only a dedicated disposable test database, never shared development or production data.
- tests/integration/setup.ts requires a database pathname matching jarxis_test or a jarxis_test_* variant. Independently verify the actual host and database before destructive tests.
- Explicitly set the verified test DATABASE_URL for both migrations and tests. Scripts load dotenv; do not accidentally inherit the normal database or edit a shared .env to switch targets.
- Apply the current Prisma-compatible migrations to the disposable database before integration tests. Inspect updated setup/scripts before running; never run migrations, seeds or owner bootstrap against an unverified target.
- Keep integration execution serial (fileParallelism: false), and do not run separate suites concurrently against the same database. Keep unit tests independent of live database/Redis services.
