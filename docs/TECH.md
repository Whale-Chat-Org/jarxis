# Jarxis Technical Design

## 1. Architecture overview

Jarxis is a single Next.js application that serves React pages, Better Auth endpoints, a small
versioned HTTP API, health checks, and API documentation. PostgreSQL is the durable source of truth,
Redis supplies rate limiting, and the Brevo transactional email API supplies verification and password-reset email.

| Layer               | Technology                                         | Responsibility                                                           |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| Web application     | Next.js 16 App Router, React 19, TypeScript        | Server/client rendering, routing, route handlers                         |
| UI                  | Tailwind CSS v4, shadcn primitives, Better Auth UI | Accessible public, auth, settings, and admin views                       |
| Authentication      | Better Auth                                        | Credentials, email verification, recovery, cookie sessions, admin plugin |
| API tokens          | `jose`, Web Crypto                                 | Short-lived JWT access tokens and rotating refresh families              |
| Persistence         | PostgreSQL 18, Prisma 7                            | Accounts, sessions, tokens, and audit data                               |
| Rate limiting       | Redis, ioredis                                     | Atomic request counters and authentication protection                    |
| Validation and docs | Zod, OpenAPI 3.1, Scalar                           | Runtime inputs, API schema, interactive reference                        |
| Email               | Brevo transactional API (`@getbrevo/brevo`)        | Verification and password-reset delivery                                 |

The detailed product behavior is defined in [PRD.md](PRD.md).

## 2. Source layout and ownership

| Path                             | Purpose                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `src/app/`                       | App Router pages, layouts, loading/error states, and HTTP route handlers     |
| `src/components/ui/`             | Token-converted shadcn primitives                                            |
| `src/components/auth/`           | Better Auth UI registry components and local integration helpers             |
| `src/components/admin/`          | Administration shell, sidebar, header, and navigation metadata               |
| `src/components/landing/`        | Public landing page                                                          |
| `src/lib/auth.ts`                | Better Auth server configuration and plugins                                 |
| `src/lib/auth/admin-guards.ts`   | Owner protection, ban side effects, and admin audit hooks                    |
| `src/lib/initial-owner-setup.ts` | First-run setup status (`available` or `completed`) and email-code bootstrap |
| `src/lib/permissions.ts`         | Role, permission, and Better Auth access-control declarations                |
| `src/lib/rbac.ts`                | Identity resolution and database-backed authorization                        |
| `src/lib/tokens.ts`              | JWT issuance and refresh-token family rotation/revocation                    |
| `src/lib/http.ts`                | Origin checks, request validation, and sanitized error envelopes             |
| `src/lib/redis.ts`               | Redis client, atomic rate limits, and trusted-client IP behavior             |
| `src/lib/openapi.ts`             | Combined Better Auth and application OpenAPI document                        |
| `src/db/index.ts`                | Lazy Prisma client using the PostgreSQL adapter                              |
| `prisma/`                        | Schema and versioned SQL migrations                                          |
| `scripts/`                       | Migration, seed, owner bootstrap, fixtures, and registry checks              |

Registry components are copied source, not package-private implementation details. Update them by
reinstalling the relevant registry item, applying the documented token conversion, and running
`pnpm registry:drift`; avoid hand-editing copied registry files.

## 3. Web routes

| Route                | Rendering and access                                               |
| -------------------- | ------------------------------------------------------------------ |
| `/`                  | Public landing page with shared public header/footer               |
| `/auth/[path]`       | Better Auth UI views; unsupported paths return 404                 |
| `/settings/[path]`   | Authenticated account/security views; unsupported paths return 404 |
| `/admin`             | Permission-protected overview                                      |
| `/admin/users`       | Better Auth administration user table                              |
| `/admin/roles`       | Read-only code-declared role catalogue                             |
| `/admin/permissions` | Application and Better Auth permission catalogues                  |
| `/admin/audit`       | Administrative audit history                                       |
| `/setup`             | Public first-owner bootstrap; request-time availability check      |
| `/access-denied`     | Authorization failure page                                         |
| `/api/setup`         | `GET` status, `POST` request owner code; `/verify` and `/resend`   |
| `/api/auth/[...all]` | Better Auth endpoints, including cookie-only admin mutations       |
| `/api/v1/[...path]`  | Application token endpoints and identity endpoint                  |
| `/api/health`        | PostgreSQL and Redis readiness                                     |
| `/api/openapi`       | OpenAPI JSON                                                       |
| `/api/docs`          | Scalar API reference                                               |

The auth layout and landing page share `PublicHeader` and `PublicFooter`. The settings layout uses the
same chrome but requires a valid page grant before rendering. Administration uses the shadcn
`SidebarProvider`/`Sidebar`/`SidebarInset` composition. Layouts own page landmarks and viewport
sizing; nested page and loading components must not introduce duplicate full-height containers.

## 4. Authentication architecture

### Browser sessions

Better Auth owns credential hashing, email verification, password reset, and session cookies. The
web UI uses HttpOnly cookies and does not store bearer tokens in browser storage. Cookie-authenticated
mutations pass both Better Auth's protection and the origin checks in the application HTTP wrapper.

The auth catch-all route wraps Better Auth so administrative hooks and application security rules
apply consistently to native endpoints.

### API token flow

1. `POST /api/v1/auth/login` rate-limits the request, validates credentials through Better Auth,
   and creates a token family tied to the backing session.
2. The server returns a 10-minute HS256 access JWT and a random 48-byte refresh token. Only the
   refresh token hash is stored.
3. `POST /api/v1/auth/refresh` consumes the presented refresh token and issues a replacement.
4. Reuse of a consumed token is treated as replay and revokes the entire family.
5. The family expires after at most 30 days and never outlives its backing session.
6. `POST /api/v1/auth/logout` revokes the caller's bearer-token family.

Access-token validation checks signature, algorithm, issuer, audience, expiry, session state, token
family state, account status, and current permissions. Claims do not override PostgreSQL state.

Clients must serialize refresh calls, atomically replace their stored refresh token, and sign in
again after an uncertain refresh result rather than retrying the old token.

## 5. Authorization and RBAC

`src/lib/permissions.ts` is the single source of truth. `app_user.role` stores one or more
comma-separated role names. Recognized roles are `user`, `viewer`, `administrator`, and `owner`;
unknown names grant nothing.

- `user` has no administration permission.
- `viewer` can read the dashboard, users, roles, permissions, and audit history.
- `administrator` can additionally create/update/ban ordinary users, set their email/password, and
  inspect or revoke their sessions.
- `owner` receives all administration actions, including role assignment and user deletion.

Every protected page calls the server-side RBAC helpers. Better Auth's admin plugin separately checks
its `user:*` and `session:*` actions on mutation endpoints. Navigation visibility is only a user
experience feature and is never treated as the security boundary.

`src/lib/auth/admin-guards.ts` adds constraints that the plugin does not provide:

- a non-owner cannot modify an owner;
- the last active, verified owner cannot be demoted, banned, deleted, or have sessions revoked;
- `owner` cannot be granted to a banned or unverified account;
- a ban revokes all token families after the user update;
- successful admin mutations create sanitized audit records.

The pre-mutation owner checks and the mutation are not lock-serialized, and audit creation occurs
after the mutation commits. These are explicit trade-offs; do not imply transactional guarantees in
new code without changing the implementation.

## 6. HTTP API contract

Application-owned endpoints are intentionally small:

| Method | Path                   | Authentication         | Purpose                              |
| ------ | ---------------------- | ---------------------- | ------------------------------------ |
| `POST` | `/api/v1/auth/login`   | Credentials in body    | Issue access/refresh tokens          |
| `POST` | `/api/v1/auth/refresh` | Refresh token in body  | Rotate the refresh token             |
| `POST` | `/api/v1/auth/logout`  | Bearer token           | Revoke the current family            |
| `GET`  | `/api/v1/me`           | Bearer token or cookie | Return current user/session identity |

User administration uses Better Auth endpoints under `/api/auth/admin/*` and requires a browser
session; bearer tokens cannot invoke these mutations.

Application errors use this envelope:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Safe client-facing message"
  }
}
```

Validation failures may add issue paths and messages. Expected status codes include 400, 401, 403,
404, 409, 429, and 503. Internal exceptions, request bodies, tokens, and SQL details must not be
returned to clients.

## 7. Data model

| Model               | Purpose                                                           |
| ------------------- | ----------------------------------------------------------------- |
| `User`              | Profile, verification, code-declared roles, and ban state         |
| `Session`           | Better Auth browser/backing sessions and impersonation actor      |
| `Account`           | Credential or external-provider account data                      |
| `Verification`      | Time-limited verification/reset values                            |
| `TokenFamily`       | API refresh family, session link, expiry, and revocation state    |
| `RefreshToken`      | Hashed, single-use refresh tokens with consumption evidence       |
| `AuditLog`          | Actor, action, target, sanitized changes, and timestamp           |
| `InstallationSetup` | Permanent singleton marker closing the web first-owner setup flow |

Prisma is the only ORM. Schema changes require a reviewed, versioned SQL migration. Do not use
schema push against persistent environments. Token families intentionally outlive deleted sessions
until expiry so replay evidence remains available.

## 8. Security boundaries

- `BETTER_AUTH_SECRET` and `JWT_SECRET` must be distinct and at least 32 characters.
- Production traffic must use HTTPS, with a trusted reverse proxy in front of the loopback app port.
- `TRUST_PROXY=true` is valid only when the proxy replaces `X-Real-IP` and blocks direct client
  access; otherwise forwarded addresses are treated as untrusted.
- Redis rate limiting uses atomic increments. Redis failure rejects protected authentication work.
- PostgreSQL is authoritative; database failure rejects identity and permission resolution.
- Admin audit payloads use allowlists and never contain passwords, cookies, or tokens.
- API documentation is owner-only outside development.
- `/setup` and `POST /api/setup` are public while no owner exists and close permanently once one
  does. No environment variable or shell access gates them: control of the submitted inbox does.
  `POST /api/setup` only records a request and emails a six-digit code; the owner is created by
  `POST /api/setup/verify`, so there is no auto-verified account creation. Codes are 6 digits, live
  10 minutes, allow 5 attempts, are stored hashed, and a resend (60-second cooldown) invalidates
  the previous code. The first successful verification wins atomically, so concurrent attempts
  yield exactly one owner. Ordinary sign-up keeps its normal email verification, and `pnpm owner`
  remains available as recovery without being required for bootstrap.
- The base Compose file does not expose PostgreSQL or Redis ports. The development override binds
  them to loopback and adds Azurite.
- Production containers run as a non-root user and use pinned base image digests.

## 9. Configuration

Required runtime values are validated by `src/lib/env.ts`:

- `DATABASE_URL`
- `REDIS_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `JWT_SECRET`
- `BREVO_API_KEY`
- `MAIL_FROM` (a sender or domain verified in Brevo)

`TRUST_PROXY` has a validated default. `BREVO_API_URL` is a test-only override that points the SDK at
the acceptance suite's local Brevo stub. First-owner setup has no configuration of its own: `/setup`
reports `available` until an owner exists and `completed` afterwards, and the emailed owner code uses
the same Brevo sender as every other message. Avatar storage separately validates `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER`
when used. The local fixture seeder's fixed development password lives
in `scripts/seed-users.ts`; it is not an application runtime setting.

Never commit a populated `.env` file. Use `.env.example` only to document names and safe placeholders.

## 10. Deployment and operations

The multi-stage Dockerfile provides:

- `tools`: migration, seed, owner bootstrap, and development source;
- `runner`: minimal production Next.js runtime running as `node`.

The base Compose topology starts PostgreSQL and Redis, runs the migration/seed job to completion,
then starts the application. Production must provide a Brevo API key with a verified sender, HTTPS `BETTER_AUTH_URL`, durable
volumes, backup procedures, and external monitoring.

Monitor `/api/health`, authentication failures, rate-limit spikes, container health, email delivery,
and audit events. Backups contain account data and must be encrypted and access-controlled. Database
major upgrades require a supported PostgreSQL upgrade path and a tested restore/rollback plan.

## 11. Development and verification

Use Node.js 24+, pnpm 11.19.0, and Docker Compose v2. The normal quality gates are:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm db:generate` after dependency installation or Prisma schema changes. Integration and E2E tests require an isolated database whose URL contains `jarxis_test`; follow `.agent/rules/testing.md`
before running migrations, seeds, integration tests, or browser tests. Never point destructive test
commands at development or production data.

## 12. Extension principles

- Add product-specific pages and APIs without bypassing `identify`, `authorize`, `requirePage`, or
  the HTTP error wrapper.
- Declare new permissions centrally before using them in UI or route guards.
- Keep authentication/account administration in Better Auth rather than creating a parallel write
  path.
- Preserve server-side authorization even when the client hides unavailable actions.
- Use semantic design tokens and registry components for UI changes.
- Keep Prisma as the sole database access abstraction and use versioned migrations.
- Update both [PRD.md](PRD.md) and this document when product scope or architecture changes.
