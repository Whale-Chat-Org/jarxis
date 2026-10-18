# Bounded acceptance suite

Run from `<repository-root>` after the parent finishes Prisma migrations, normal role/permission seeding, dependency setup and Chromium installation.

```sh
DATABASE_URL='postgresql://USER:PASSWORD@localhost:55432/jarxis_test' \
BETTER_AUTH_URL='http://localhost:3000' \
TRUST_PROXY=true REDIS_URL='redis://localhost:56379/1' \
AZURE_STORAGE_CONNECTION_STRING='UseDevelopmentStorage=true' \
AZURE_STORAGE_CONTAINER='profile-photos-e2e' \
pnpm exec playwright test
```

Also provide the application's normal environment: `REDIS_URL`, distinct 32+ character `BETTER_AUTH_SECRET` and `JWT_SECRET`, and the rest of `.env`. Playwright starts `tests/e2e/brevo-stub.ts`, a local stand-in for Brevo's transactional API, and runs the app with `BREVO_API_URL` pointing at it plus a fake `BREVO_API_KEY` and `MAIL_FROM`, so no real email is sent. A reused dev server does not get these overrides and would send through real Brevo; stop it first. Azurite must expose its blob service at localhost:10000. `PLAYWRIGHT_BASE_URL` overrides the default application origin; ensure the server binds there. `BREVO_STUB_URL` overrides the stub origin (default `http://127.0.0.1:4010`).

Set `PLAYWRIGHT_WEB_SERVER_COMMAND='pnpm build && pnpm start'` to test an optimized build instead of the default development server.

**Database isolation:** both runner and app server must use the same dedicated `jarxis_test` database (safe suffixed names such as `jarxis_test_prisma` are also accepted). The application server is never reused: stop any server occupying the configured port before running. Playwright starts the app with the explicit test database configuration. Server startup and every pg connection enforce the database name. Test discovery (including VS Code and `playwright test --list`) does not require a test database. The first-owner setup suite resets account, verification, audit and installation-setup tables in that disposable database and tests Owner inactivity. It needs no setup secret: `/setup` is public until an owner exists, and the suite reads the emailed six-digit owner code from the Brevo stub. Other suites assign roles to newly registered, email-verified fixture users.

Run integration DB tests and acceptance tests **sequentially**, not concurrently: existing security integration fixtures truncate shared tables. Use an isolated Redis instance/database (for example `/1`). The test-only server enables `TRUST_PROXY=true`; each test supplies a unique synthetic `X-Real-IP` to both API and browser fixtures. A reused test server must also enable `TRUST_PROXY=true`. Never enable this configuration on an unprotected production server. These tests do not clear Redis. Captured mail lives only in the stub's memory; the first-owner setup suite performs its documented database reset. Unique test users are intentionally retained in the dedicated test database. A custom role is created/updated/deleted only through owner-authorized APIs.

Coverage: public `/setup` first-owner bootstrap through the emailed six-digit code, including resend and the completed state; request-fixture registration; actual recipient-matched verification/reset links captured by the Brevo stub; unverified login rejection; successful browser/API login; unprivileged admin denial; password reset, stale session and old-password rejection, token single-use and logout; anonymous/bad bearer denial; owner role CRUD API; desktop/mobile sidebar and users-table layout. Registration uses the API intentionally, not the sign-up UI. Owner browser coverage also creates, edits and deletes its own unique role through the editor dialogs, without conditional skips.

Bounds: one Chromium worker, no retries, 90 seconds/test, 10 minutes/suite, 20-second email polling, 5-second stub/SQL operations, 10-second UI assertions/actions. Failure traces/screenshots are retained. These tests must not be run concurrently with other auth-heavy traffic on the same rate-limit bucket.
