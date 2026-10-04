# Test database isolation

- Integration tests execute TRUNCATE app_user, audit_logs CASCADE and alter role fixtures. Use only a dedicated disposable test database, never shared development or production data.
- tests/integration/setup.ts requires a database pathname matching jarxis_test or a jarxis_test_* variant. Independently verify the actual host and database before destructive tests.
- Explicitly set the verified test DATABASE_URL for both migrations and tests. Scripts load dotenv; do not accidentally inherit the normal database or edit a shared .env to switch targets.
- Apply the current Prisma-compatible migrations to the disposable database before integration tests. Inspect updated setup/scripts before running; never run migrations, seeds or owner bootstrap against an unverified target.
- Keep integration execution serial (fileParallelism: false), and do not run separate suites concurrently against the same database. Keep unit tests independent of live database/Redis services.

# Development user accounts

- During development and manual or browser verification, use only the seeded fixture users from scripts/seed-users.ts (owner@, admin@, viewer@, member@, banned@ and unverified@jarxis.test). They cover every role and account state.
- Do not create any other user or email address (sign-up, /setup, pnpm owner, direct SQL or Prisma writes) unless the task requirements explicitly call for it. If a scenario seems to need a new account, ask first.
- To restore a fixture you changed, run `pnpm db:seed:users --reset` instead of creating a replacement account.
- Automated suites against the disposable jarxis_test database may create the users their tests define, since those tables are truncated between runs.
