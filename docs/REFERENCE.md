# Jarxis Reference

Operational and integration details. Local setup is in [DEVELOPMENT.md](DEVELOPMENT.md); architecture and
product behaviour are in [TECH.md](TECH.md) and [PRD.md](PRD.md).

## Containerized development

For the full containerized development stack:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build -d
```

The development override uses the tools image and Next dev server. Rebuild after source changes; use host `pnpm dev` for immediate hot reload. Do not run both on port 3000.

For a fresh installation, the homepage and `/auth/sign-in` automatically open `/setup` while no owner exists, so just visit the application and follow the emailed-code flow below (`/setup` is also reachable directly). Ordinary registration at `/auth/sign-up` also requires email verification through Brevo (check spam and Brevo → Transactional → Logs). Every environment, including development, sends real email outside the isolated test suite. New accounts have **no admin permissions**.

CLI recovery remains available for an active, email-verified account:

```sh
pnpm owner you@example.com
# When using the full container stack:
docker compose run --rm migrate pnpm owner you@example.com
```

This command refuses when an active owner exists. Thereafter, owners assign roles in Admin → Users.

## First-run owner setup (`/setup`)

`/setup` is a public first-run page: anyone can open it while the installation has no owner, and it
needs no environment variable and no CLI access. It asks for name, email and password, emails a
six-digit code to that address, and creates the owner only after the code is verified.

- Any email address is accepted; control of that inbox is the gate. Starting setup creates an
  unverified account with no admin privileges. Verifying the emailed code enables Owner access.
- Codes are 6 digits, expire after 10 minutes, allow 5 attempts, and can be resent after a
  60-second cooldown. A resend invalidates the previous code and replaces the expiry. Codes are
  stored hashed, never in plaintext.
- The first successful verification wins atomically: concurrent attempts leave exactly one owner,
  and `/setup` then reports "Setup already completed" and links to sign-in, permanently. From then
  on the homepage and `/auth/sign-in` render normally again, including when the owner is later
  deactivated.
- If email delivery fails the page says so and offers a resend, while still accepting a code that
  did arrive.
- Every ordinary sign-up at `/auth/sign-up` keeps its usual email verification. The CLI
  (`pnpm owner <verified-email>`) is retained as a recovery path but is not required to bootstrap.
- Verify after first run: `/setup` reports "Setup already completed", the new account signs in at
  `/auth/sign-in`, and Admin → Users shows it with the `owner` role.

For local testing only, `pnpm db:seed:users` creates fixture accounts using the development-only password declared in `scripts/seed-users.ts`: `owner@`, `admin@`, `viewer@`, `member@`, `banned@` and `unverified@` (all `@jarxis.test`). It refuses production and non-local database hosts. It only creates missing accounts and leaves existing ones unchanged; `pnpm db:seed:users --reset` restores their roles and passwords and revokes their sessions.

## Authentication and API

Better Auth owns credentials, verification/reset flows, cookie sessions, and `/api/auth/*`. Browser pages use HttpOnly sessions and automatic session renewal, not localStorage bearer tokens. Pages live at `/auth/sign-in`, `sign-up`, `sign-out`, `forgot-password`, `reset-password`, `reset-link-sent`, and `verify-email`.

For non-browser clients:

```sh
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"verified@example.com","password":"your-password"}'
# Returns accessToken, refreshToken, tokenType, expiresIn, refreshExpiresAt.
curl http://localhost:3000/api/v1/me -H 'Authorization: Bearer ACCESS_TOKEN'
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' -d '{"refreshToken":"REFRESH_TOKEN"}'
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Access JWTs expire in 10 minutes and use a dedicated HS256 signing secret. Refresh tokens are 48 random bytes, hashed at rest, single use, and have an absolute 30-day lifetime capped by their backing session. Clients **must serialize refresh requests** and atomically replace the stored refresh token: reuse, including concurrent refresh, revokes the entire family. Do not retry an old refresh token after an uncertain network result; sign in again. Store tokens in an OS keychain or equivalent secure client storage. Never put tokens in URLs, logs, or browser localStorage.

JWT signature/algorithm/issuer/audience/expiry **and** PostgreSQL session/family state are validated on every API request. Logout invalidates current family/session; account disabling and password reset invalidate all sessions/families. Browser sign-out deletes its current backing session, which also invalidates any linked API family. Permissions are not trusted from token claims.

The `/api/v1` API supports token login, refresh, logout and `GET me`. Browser-session user mutations use `/api/auth/admin/*`; custom-role CRUD uses `/api/admin/roles`; permission and audit pages use their server-side read services. Scalar at `/api/docs` and `/api/openapi` includes generated Better Auth documentation and Zod-derived input schemas. Both are owner-only outside development; the original auth plugin schema/reference endpoints are blocked. Error envelopes use `{ error: { code, message } }` (validation adds issue paths/messages), with 401 for absent/invalid authentication and 403 for insufficient permissions.

## Provider pool

Owners manage connections and application keys at `/admin/providers`. OpenAI, Anthropic, OpenRouter and custom API-key providers share a priority-ordered model pool.
The persistent worker discovers model catalogs on connection and hourly thereafter.

Applications use an owner-issued gateway key with the base URL `/api/llm/v1` for model listing,
Chat Completions, and stateless Responses, including streaming and tool calls. Upstream credentials
remain encrypted on the server. See [Provider deployment and API usage](providers.md)
for worker setup, supported features, and validation limits.

## RBAC architecture

The Better Auth `admin` plugin manages users and role assignments; the Prisma role service manages custom roles and editable grants; the extra rules this
project needs are hooks. See [TECH.md](TECH.md#authorization-and-rbac) for the full picture.

- **System roles** are declared in `src/lib/permissions.ts` and seeded into the `roles` table:
  `user` (default, grants nothing), `viewer`, `administrator` and `owner`. None can be deleted.
  Owner and User are locked to their code grants; owners can edit the description and grants of
  Viewer and Administrator (seeding never overwrites those edits; `pnpm db:seed --reset-roles`
  restores them outside production). `app_user.role` stores the assigned keys comma-separated, and
  an unrecognised key grants nothing — a removed role fails closed.
- **Permissions** live in the `permissions` table, seeded from the code catalog by `pnpm db:seed`;
  role grants are rows in `role_permissions`.
- **Custom roles** live in the `roles` table under `custom_<uuid>` keys. Owners create, edit,
  duplicate and delete them on `/admin/roles`; they pick from the code-defined permission catalog
  (no new keys) and can never hold owner-only grants (`roles:update`, `roles:assign`,
  `providers:*`, `user:delete`, `user:set-role`, `user:impersonate-admins`). Names are unique
  case-insensitively and cannot reuse a system role name.
- Custom grants are read from the database on every request (`grants()` in `src/lib/rbac.ts`, and
  `withLiveAdminRoles` for Better Auth's `/admin/*` endpoints), so edits apply on the user's next
  request with no sign-out or deploy. A database trigger refuses assigning an unknown custom key
  and deleting a role that users still have; the API answers `409 ROLE_IN_USE` with the count.
- Role API (owner browser session only; bearer tokens get `401`, impersonated sessions and
  non-owners `403`; rate limited). Every create, edit and delete writes a `role.create`,
  `role.update` or `role.delete` audit entry with before and after permissions:

  | Method   | Path                    | Purpose                                                       |
  | -------- | ----------------------- | ------------------------------------------------------------- |
  | `GET`    | `/api/admin/roles`      | System and custom roles; open to `roles:read` or `users:read` |
  | `POST`   | `/api/admin/roles`      | Create `{ name, description, permissions[] }`                 |
  | `PATCH`  | `/api/admin/roles/:key` | Update a custom, Viewer or Administrator role                 |
  | `DELETE` | `/api/admin/roles/:key` | Delete an unused custom role                                  |

- Roles are assigned from the Role dropdown on `/admin/users`, which lists system and custom roles
  and saves through Better Auth's `set-role` after a confirmation (audited as
  `user.roles.replace`).
- `roles:assign` and `roles:update` **also require actual owner membership**, not just the key.
- Only owners can modify owner accounts, and the last active verified owner cannot be demoted,
  banned, deleted or have their sessions revoked.
- Account status is the plugin's `banned` / `banReason` / `banExpires` fields. Banning revokes the
  account's sessions and API token families.
- Owner and last-owner checks run in `hooks.before` on the plugin's mutation endpoints using an
  authoritative (database) session read; audit records are written by `hooks.after` after commit.
  **These are not lock-serialized** and administrative mutations are browser-session only — see
  `.agents/rules/security.md` for the accepted trade-offs.
- Permission checks are database-backed, not cached across requests. Sidebar visibility is not an
  authorization boundary. All pages and endpoints check permissions independently.
- Single application-wide scope. No tenants, resource ownership rules, social login, MFA, or role
  inheritance are implemented.

## Security and deployment

```sh
docker compose up --build -d
```

Use the base Compose file for production with a `BREVO_API_KEY` and a `MAIL_FROM` on a Brevo-verified domain, private Azure Blob Storage or S3 bucket settings, and an **HTTPS** `BETTER_AUTH_URL`. Place an HTTPS reverse proxy in front of the loopback app port. The production image runs as a non-root user. The migration/seed job must complete successfully before the app starts. Database/Redis ports are not published by the base file; never use the development override on an untrusted host. MinIO and Azurite are development-only.

Profile photos use the shared storage manager, which detects configured Azure Blob and S3 backends.
With both configured, uploads go to both and succeed if at least one copy is stored. Reads fall back
between backends; deletion attempts every configured copy. Partial upload failures are reported for retry.
Azure uses `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER`; S3 uses an existing
private bucket, region and standard AWS SDK credentials. Optional endpoint and path-style settings
support MinIO and other S3-compatible services. Photos are served only through authenticated app
routes. Local setup defaults to MinIO; Azurite remains available. See [storage configuration](DEVELOPMENT.md#object-storage).
Switching backends does not migrate existing objects.

Set `TRUST_PROXY=true` **only** when a trusted proxy overwrites `X-Real-IP` and clients cannot reach the app directly. Without it, limits intentionally use a shared bucket rather than trust spoofable forwarded headers. Redis rate limits use atomic Lua increments; unavailable Redis fails authentication closed. PostgreSQL is the source of truth and failures fail authorization closed. Cookie-authenticated mutations require the configured Origin, and foreign Origins are rejected. Native Better Auth adds its own origin/CSRF checks.

Use distinct cryptographically random auth/JWT secrets. Changing JWT_SECRET invalidates all API access JWTs; changing auth secrets invalidates cookie sessions. Coordinate secret rotation and client reauthentication. The starter uses a shared symmetric signing key; introducing independently trusted resource servers should replace this with managed asymmetric signing/JWKS.

Compose uses the `latest` tags for PostgreSQL, Redis and optional Azurite. MinIO is built locally from pinned upstream source. The Dockerfile and CI service images remain pinned to verified registry digests. Review image releases before pulling updates. Before a database major upgrade, take and test a backup, follow PostgreSQL's supported upgrade procedure, migrate on staging, and test rollback. Do not point a new major at an old data volume without a supported upgrade.

Backup/restore examples (protect backups: they contain account data):

```sh
docker compose exec -T postgres pg_dump -U jarxis -d jarxis -Fc > jarxis.dump
# Restore to a separately provisioned database first, not blindly over production:
# pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" jarxis.dump
```

Monitor `/api/health` (database + Redis), container health, authentication failures, rate-limit spikes, and audit events. App errors omit request bodies and raw SQL parameters. Configure email delivery monitoring in Brevo (transactional logs and bounce/block events). Schedule retention/cleanup of expired token families and consumed tokens **only after family expiry**, preserving replay evidence while a family remains valid. No recurring cleanup job is installed automatically.

## CI/CD

`.github/workflows/cicd.yml` runs CI on pushes to `main` and manual dispatch. The cloud provider is blank and the deployment job is disabled until a provider is configured:

1. **test**: `format:check`, `lint`, `typecheck`, unit tests with coverage, then migrations, seed and integration tests against throwaway Postgres and Redis service containers (`jarxis_test`).
2. **build**: builds the `runner` and `tools` images for `linux/amd64`. They are kept as workflow artifacts, not pushed.
3. **security** (in parallel): SonarQube Cloud with the quality gate, Semgrep (fails on `ERROR` findings) and Trivy (repository and app image, fails on fixable `HIGH`/`CRITICAL`). SARIF reports are saved as artifacts. Secret-scan exceptions live in `trivy-secret.yaml`.
4. **deploy**: a disabled template with blank `CLOUD_PROVIDER`. Configure provider authentication, image publishing, migrations, staging, health checks, promotion and rollback before enabling it for pushes to `main`. No cloud uploads or deployments run from this template.

Migrations run **before** the swap, so the release still in production briefly runs against the new schema. Keep migrations backward-compatible (expand first, remove old columns in a later release).

The previous Azure implementation is preserved unchanged in `.github/archive/cicd.azure.yml` and is not an active workflow. Its environment and identity come from [jarxis-IaC](https://github.com/Whale-Chat-Org/jarxis-IaC): `scripts/setup-cicd.sh` there sets these with `az` and `gh`:

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

Design-system rules (tokens and shadcn MCP setup) are in `.agents/rules/design-system.md`. Agent instructions are indexed in `AGENTS.md`, with the rules in `.agents/rules/`.

`pnpm registry:drift` (network required) re-fetches every copied shadcn / Better Auth UI component and fails if one has drifted from upstream by anything other than the documented token conversion.

## UI

The interface is assembled from registry components rather than hand-rolled markup:

- **Primitives** — `src/components/ui/*` are shadcn items (`sidebar`, `breadcrumb`, `alert-dialog`, `tabs`, `radio-group`, `avatar`, `item`, `pagination`, `collapsible`, `field`, `input-group`, …), token-converted.
- **Auth and account** — every view under `src/components/auth/*` is a Better Auth UI registry item: the `auth` view router, the `user-button` menu, the `theme` plugin, and the `settings` account/security cards.
- **Admin shell** — the shadcn `Sidebar` composition (`SidebarProvider` → `Sidebar` + `SidebarInset`), a `Breadcrumb` header, and the registry `UserButton` in `SidebarFooter`.
- **Administration** — the Better Auth `admin` plugin and the copied Better Auth admin UI user-management UI.
- **Routes** — `/auth/*`, `/settings/*` and `/admin/*`; see [TECH.md](TECH.md#web-routes).

Never hand-edit a registry file: re-`add` the item, re-apply the token conversion, and verify with `pnpm registry:drift`.

## Attribution

Authentication components were installed from the MIT-licensed [Better Auth UI](https://better-auth-ui.com/) shadcn registry; primitives from [shadcn/ui](https://ui.shadcn.com/). [shadcn-admin](https://github.com/satnaing/shadcn-admin) is a layout reference only, not a copied Vite application.
