# Bounded acceptance suite

Run from `/Users/lowjungxuan/Desktop/jarxis` after the parent finishes Prisma migrations, normal role/permission seeding, dependency setup and Chromium installation.

```sh
DATABASE_URL='postgresql://USER:PASSWORD@localhost:55432/jarxis_test' \
BETTER_AUTH_URL='http://localhost:3000' \
TRUST_PROXY=true REDIS_URL='redis://localhost:56379/1' \
MAILPIT_URL='http://localhost:8025' \
pnpm exec playwright test
```

Also provide the application's normal environment: `REDIS_URL`, distinct 32+ character `BETTER_AUTH_SECRET` and `JWT_SECRET`, `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false`, and `MAIL_FROM`. Mailpit must accept application SMTP and expose its API at localhost:8025. `PLAYWRIGHT_BASE_URL` overrides the default application origin; ensure the server binds there. `MAILPIT_URL` overrides the inbox API origin.

**Database isolation:** both runner and app server must use the same dedicated `jarxis_test` database (safe suffixed names such as `jarxis_test_prisma` are also accepted). A non-CI existing server is reused: stop/restart any normal development server against the test database BEFORE running. The runner cannot determine a reused server's database before registration; immediately after registration it asserts that the generated user exists in the runner's test database. Never point these tests at a production/development-data server. Config and every pg connection enforce the database name. The only direct database mutation assigns the existing seeded `owner` role to a newly registered, email-verified test user; it does not rewrite seed roles or permissions.

Run integration DB tests and acceptance tests **sequentially**, not concurrently: existing security integration fixtures truncate shared tables. Use an isolated Redis instance/database (for example `/1`). The test-only server enables `TRUST_PROXY=true`; each test supplies a unique synthetic `X-Real-IP` to both API and browser fixtures. A reused test server must also enable `TRUST_PROXY=true`. Never enable this configuration on an unprotected production server. These tests do not clear Redis. No Mailpit global deletion or database cleanup/truncation is performed. Unique test users are intentionally retained in the dedicated test database. A custom role is created/updated/deleted only through owner-authorized APIs.

Coverage: request-fixture registration; actual recipient-matched Mailpit verification/reset links; unverified login rejection; successful browser/API login; unprivileged admin denial; password reset, stale session and old-password rejection, token single-use and logout; anonymous/bad bearer denial; owner role CRUD API; desktop/mobile sidebar and users-table layout. Registration uses the API intentionally, not the sign-up UI. Owner browser coverage also creates, edits and deletes its own unique role through the editor dialogs, without conditional skips.

Bounds: one Chromium worker, no retries, 90 seconds/test, 10 minutes/suite, 20-second email polling, 5-second Mailpit/SQL operations, 10-second UI assertions/actions. Failure traces/screenshots are retained. These tests must not be run concurrently with other auth-heavy traffic on the same rate-limit bucket.
