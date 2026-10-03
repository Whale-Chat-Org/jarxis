# Jarxis

A Next.js App Router admin starter with Better Auth, the official Better Auth UI registry components, Tailwind v4/shadcn, Prisma/PostgreSQL, Redis rate limits, Zod validation, and Scalar OpenAPI documentation.

## Local development

Requirements: Node 24+, pnpm 12.8.1, Docker Compose v2. No default user or password is seeded.

`pnpm typecheck` uses TypeScript 7 through the `@typescript/native` npm alias. The `typescript` alias provides the TypeScript 6 API for ESLint tooling until `typescript-eslint` supports TypeScript 7.

```sh
cp .env.example .env
# Edit .env: set a URL-safe POSTGRES_PASSWORD and the same password in DATABASE_URL.
# Generate two DIFFERENT secrets with `openssl rand -hex 32`.
# Set BETTER_AUTH_SECRET and JWT_SECRET to those values.
# Set BREVO_API_KEY (Brevo API key) and MAIL_FROM (a Brevo-verified sender).
pnpm install --frozen-lockfile
pnpm db:generate
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres redis azurite
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Application: http://localhost:3000
- Azurite blob endpoint: http://localhost:10000 (development only)
- API docs: http://localhost:3000/api/docs
- Database/Redis development ports: **55432 / 56379**, bound to loopback to avoid existing local services. Override `POSTGRES_PORT` / `REDIS_PORT` and update host connection URLs together.

For the full containerized development stack:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build -d
```

The development override uses the tools image and Next dev server. Rebuild after source changes; use host `pnpm dev` for immediate hot reload. Do not run both on port 3000.

Register at `/auth/sign-up` with a real inbox, open the verification email (sent through Brevo; check spam and Brevo → Transactional → Logs), verify, then sign in. Every environment, including development, sends real email. New accounts have **no admin permissions**. Bootstrap the first verified, active owner:

```sh
pnpm owner you@example.com
# When using the full container stack:
docker compose run --rm migrate pnpm owner you@example.com
```

This command refuses when an active owner exists. Thereafter, owners assign roles in Admin → Users.

For local testing only, `pnpm db:seed:users` creates fixture accounts using the development-only password declared in `scripts/seed-users.ts`: `owner@`, `admin@`, `viewer@`, `member@`, `banned@` and `unverified@` (all `@jarxis.test`). It refuses production and non-local database hosts and resets those accounts' roles, passwords and sessions on each run.

## Authentication and API

Better Auth owns credentials, verification/reset flows, cookie sessions, and `/api/auth/*`. Browser pages use HttpOnly sessions and automatic session renewal, not localStorage bearer tokens. Pages live at `/auth/sign-in`, `sign-up`, `sign-out`, `forgot-password`, `reset-password`, `reset-link-sent`, and `verify-email`.

For non-browser clients:

```sh
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"verified@example.com","password":"your-password"}'
# Returns accessToken, refreshToken, tokenType, expiresIn, refreshExpiresAt.
curl http://localhost:3000/api/v1/users -H 'Authorization: Bearer ACCESS_TOKEN'
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' -d '{"refreshToken":"REFRESH_TOKEN"}'
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Access JWTs expire in 10 minutes and use a dedicated HS256 signing secret. Refresh tokens are 48 random bytes, hashed at rest, single use, and have an absolute 30-day lifetime capped by their backing session. Clients **must serialize refresh requests** and atomically replace the stored refresh token: reuse, including concurrent refresh, revokes the entire family. Do not retry an old refresh token after an uncertain network result; sign in again. Store tokens in an OS keychain or equivalent secure client storage. Never put tokens in URLs, logs, or browser localStorage.

JWT signature/algorithm/issuer/audience/expiry **and** PostgreSQL session/family state are validated on every API request. Logout invalidates current family/session; account disabling and password reset invalidate all sessions/families. Browser sign-out deletes its current backing session, which also invalidates any linked API family. Permissions are not trusted from token claims.

The API supports users, user-role assignments, custom roles, permission catalog, and audit logs under `/api/v1`. Scalar at `/api/docs` and `/api/openapi` includes generated Better Auth documentation and Zod-derived input schemas. Both are owner-only outside development; the original auth plugin schema/reference endpoints are blocked. Error envelopes use `{ error: { code, message } }` (validation adds issue paths/messages), with 401 for absent/invalid authentication and 403 for insufficient permissions.

## RBAC architecture

User, role and permission management is the Better Auth `admin` plugin; the extra rules this
project needs are hooks. See [TECH.md](docs/TECH.md#authorization-and-rbac) for the full picture.

- **Roles are code-declared** in `src/lib/permissions.ts`: `user` (default, grants nothing),
  `viewer`, `administrator` and `owner`. `app_user.role` stores the assigned names
  comma-separated, and an unrecognised name grants nothing — a removed role fails closed.
- Roles ship with the application, so `/admin/roles` is read-only and the system roles cannot be
  edited or deleted at runtime. There is no custom-role CRUD.
- `roles:assign` and `roles:update` **also require actual owner membership**, not just the key.
- Only owners can modify owner accounts, and the last active verified owner cannot be demoted,
  banned, deleted or have their sessions revoked.
- Account status is the plugin's `banned` / `banReason` / `banExpires` fields. Banning revokes the
  account's sessions and API token families.
- Owner and last-owner checks run in `hooks.before` on the plugin's mutation endpoints using an
  authoritative (database) session read; audit records are written by `hooks.after` after commit.
  **These are not lock-serialized** and administrative mutations are browser-session only — see
  `.agent/rules/security.md` for the accepted trade-offs.
- Permission checks are database-backed, not cached across requests. Sidebar visibility is not an
  authorization boundary. All pages and endpoints check permissions independently.
- Single application-wide scope. No tenants, resource ownership rules, social login, MFA, or role
  inheritance are implemented.

## Security and deployment

```sh
docker compose up --build -d
```

Use the base Compose file for production with a `BREVO_API_KEY` and a `MAIL_FROM` on a Brevo-verified domain, a private Azure Blob Storage connection string, and an **HTTPS** `BETTER_AUTH_URL`. Place an HTTPS reverse proxy in front of the loopback app port. The production image runs as a non-root user. The migration/seed job must complete successfully before the app starts. Database/Redis ports are not published by the base file; never use the development override on an untrusted host. Azurite is development-only.

Profile photos are stored in the private container named by `AZURE_STORAGE_CONTAINER` and are served only through authenticated application routes. Keep `AZURE_STORAGE_CONNECTION_STRING` secret in production; the `UseDevelopmentStorage=true` value in `.env.example` is only for the loopback Azurite emulator.

Set `TRUST_PROXY=true` **only** when a trusted proxy overwrites `X-Real-IP` and clients cannot reach the app directly. Without it, limits intentionally use a shared bucket rather than trust spoofable forwarded headers. Redis rate limits use atomic Lua increments; unavailable Redis fails authentication closed. PostgreSQL is the source of truth and failures fail authorization closed. Cookie-authenticated mutations require the configured Origin, and foreign Origins are rejected. Native Better Auth adds its own origin/CSRF checks.

Use distinct cryptographically random auth/JWT secrets. Changing JWT_SECRET invalidates all API access JWTs; changing auth secrets invalidates cookie sessions. Coordinate secret rotation and client reauthentication. The starter uses a shared symmetric signing key; introducing independently trusted resource servers should replace this with managed asymmetric signing/JWKS.

Compose uses the `latest` tags for PostgreSQL, Redis and Azurite. The Dockerfile and CI service images remain pinned to verified registry digests. Review image releases before pulling updates. Before a database major upgrade, take and test a backup, follow PostgreSQL's supported upgrade procedure, migrate on staging, and test rollback. Do not point a new major at an old data volume without a supported upgrade.

Backup/restore examples (protect backups: they contain account data):

```sh
docker compose exec -T postgres pg_dump -U jarxis -d jarxis -Fc > jarxis.dump
# Restore to a separately provisioned database first, not blindly over production:
# pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" jarxis.dump
```

Monitor `/api/health` (database + Redis), container health, authentication failures, rate-limit spikes, and audit events. App errors omit request bodies and raw SQL parameters. Configure email delivery monitoring in Brevo (transactional logs and bounce/block events). Schedule retention/cleanup of expired token families and consumed tokens **only after family expiry**, preserving replay evidence while a family remains valid. No recurring cleanup job is installed automatically.

## CI/CD

`.github/workflows/ci-cd.yml` runs on pull requests to `main` and on pushes to `main`:

1. **test**: `format:check`, `lint`, `typecheck`, unit tests with coverage, then migrations, seed and integration tests against throwaway Postgres and Redis service containers (`jarxis_test`).
2. **build**: builds the `runner` and `tools` images for `linux/amd64`. They are kept as workflow artifacts, not pushed.
3. **security** (in parallel): SonarQube Cloud with the quality gate, Semgrep (fails on `ERROR` findings) and Trivy (repository and app image, fails on fixable `HIGH`/`CRITICAL`). SARIF reports are saved as artifacts. Secret-scan exceptions live in `trivy-secret.yaml`.
4. **deploy** (pushes to `main` only): signs in to Azure with OIDC, pushes both images to ACR tagged with the commit SHA, runs migrations and seed through a temporary Postgres firewall rule, deploys to the `staging` slot, waits for `/api/health`, then swaps staging into production. If production is unhealthy after the swap, it swaps back.

Migrations run **before** the swap, so the release still in production briefly runs against the new schema. Keep migrations backward-compatible (expand first, remove old columns in a later release).

The Azure environment and the pipeline's identity come from [jarxis-IaC](https://github.com/Whale-Chat-Org/jarxis-IaC): `scripts/setup-cicd.sh` there sets these with `az` and `gh`:

| Kind      | Names                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets   | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `SONAR_TOKEN`                                                                                              |
| Variables | `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `ACR_LOGIN_SERVER`, `WEBAPP_NAME`, `WEBAPP_SLOT`, `KEY_VAULT_NAME`, `POSTGRES_SERVER_NAME`, `SONAR_ORGANIZATION`, `SONAR_PROJECT_KEY` |

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Integration tests are destructive to test fixtures and refuse databases without `jarxis_test` in the URL. Never point them at development/production data:

```sh
docker compose exec -T postgres createdb -U jarxis jarxis_test
# Set DATABASE_URL to postgresql://jarxis:<password>@localhost:55432/jarxis_test
DATABASE_URL='<test-url>' pnpm db:migrate
DATABASE_URL='<test-url>' pnpm db:seed
DATABASE_URL='<test-url>' pnpm test:integration
pnpm exec playwright install chromium
# Stop any non-test dev server first; browser tests must use the test database.
DATABASE_URL='<test-url>' pnpm test:e2e
```

Design-system rules (tokens and shadcn MCP setup) are in `.agent/rules/design-system.md`. Agent instructions are indexed in `AGENTS.md`, with the rules in `.agent/rules/`.

`pnpm registry:drift` (network required) re-fetches every copied shadcn / Better Auth UI component and fails if one has drifted from upstream by anything other than the documented token conversion.

## UI

The interface is assembled from registry components rather than hand-rolled markup:

- **Primitives** — `src/components/ui/*` are shadcn items (`sidebar`, `breadcrumb`, `alert-dialog`, `tabs`, `radio-group`, `avatar`, `item`, `pagination`, `collapsible`, `field`, `input-group`, …), token-converted.
- **Auth and account** — every view under `src/components/auth/*` is a Better Auth UI registry item: the `auth` view router, the `user-button` menu, the `theme` plugin, and the `settings` account/security cards.
- **Admin shell** — the shadcn `Sidebar` composition (`SidebarProvider` → `Sidebar` + `SidebarInset`), a `Breadcrumb` header, and the registry `UserButton` in `SidebarFooter`.
- **Administration** — the Better Auth `admin` plugin and the `@better-auth-ui/admin` user-management UI.
- **Routes** — `/auth/*`, `/settings/*` and `/admin/*`; see [TECH.md](docs/TECH.md#web-routes).

Never hand-edit a registry file: re-`add` the item, re-apply the token conversion, and verify with `pnpm registry:drift`.

## Attribution

Authentication components were installed from the MIT-licensed [Better Auth UI](https://better-auth-ui.com/) shadcn registry; primitives from [shadcn/ui](https://ui.shadcn.com/). [shadcn-admin](https://github.com/satnaing/shadcn-admin) is a layout reference only, not a copied Vite application.
