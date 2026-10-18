# Architecture and commands

## Stack and architecture

- Next.js 16 App Router, React 19, strict TypeScript, pnpm (version in package.json), PostgreSQL, Redis/ioredis, Better Auth, jose JWTs, Zod and email via the Brevo transactional API (`@getbrevo/brevo`).
- **Prisma is the required ORM.** Schema and versioned SQL migrations live in prisma/; src/db/index.ts provides the lazy Prisma client with the PostgreSQL adapter. Do not introduce a second ORM.
- **Permission keys and system roles are declared in code and seeded into the database.** `src/lib/permissions.ts` defines them; `pnpm db:seed` (`src/lib/rbac-seed.ts`) syncs the `permissions` catalog and the system rows of `roles`. Grants live in `role_permissions`. Owner and User grants always come from code; Viewer, Administrator and custom roles are read from `role_permissions`. `app_user.role` holds one or more role keys (comma-separated); there is no `user_roles` table. Account status is the admin plugin's ban fields (`banned`/`banReason`/`banExpires`) — there is no separate `disabled` flag.
- Tailwind CSS v4 and shadcn-style UI components in src/components/ui; semantic tokens in src/styles/tokens.css. Follow [design-system.md](design-system.md); preserve accessibility and keyboard behavior.
- UI is registry-first: shadcn primitives and Better Auth UI views are copied from the registries and converted to design tokens — never hand-rolled. The admin frame is the shadcn `Sidebar` composition (`SidebarProvider`/`Sidebar`/`SidebarInset`) in src/components/admin, the account area is the Better Auth UI `settings` item under `/settings`, and the account menu is the registry `UserButton` driven by `themePlugin` registered in src/components/providers.tsx. Run `pnpm registry:drift` after any `shadcn add` to confirm the copies still match upstream apart from the documented token conversion.
- src/app/api/auth/[...all]/route.ts wraps every Better Auth endpoint, including the admin plugin's `/api/auth/admin/*` mutations and the UI's permission checks. src/app/api/v1/[...path]/route.ts serves bearer-token auth only: `POST auth/{login,refresh,logout}` and `GET me`; identity resolution accepts a bearer token or a session cookie.
- src/lib/auth.ts configures authentication, including the Better Auth `admin` plugin; tokens.ts manages JWTs and refresh families; rbac.ts resolves identity and checks database-backed permissions; permissions.ts declares the single source of truth for roles, permissions and the access-control statements.
- src/lib/auth/admin-guards.ts enforces the extra administration rules (owner protection, last owner, ban side effects, audit) as Better Auth hooks. src/lib/user-status.ts owns the ban/active predicates used by rbac, tokens and the auth hooks.
- src/lib/audit-service.ts exposes read-only audit queries. Better Auth owns user mutations and role assignment; src/lib/role-service.ts owns custom-role CRUD and editable role grants through Prisma transactions. Do not introduce competing write paths.
- src/lib/http.ts handles origin checks, validation and sanitized error responses; redis.ts provides rate limiting; docs-access.ts protects production API documentation; env.ts validates shared environment configuration; mailer.ts sends email through the Brevo API.

## Commands and verification

Use pnpm from the repository root. Run pnpm db:generate after installation and after changing prisma/schema.prisma. Generate and review a versioned migration for database changes; never use db push against deployed data.

| Command                     | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| pnpm dev                    | Next.js development server                                   |
| pnpm build / pnpm start     | Build / serve production application                         |
| pnpm lint                   | ESLint                                                       |
| pnpm lint:fix               | ESLint with auto-fix                                         |
| pnpm format                 | Format all files with Prettier                               |
| pnpm format:check           | Check Prettier formatting (runs in CI)                       |
| pnpm typecheck              | TypeScript checking                                          |
| pnpm test                   | Vitest unit tests                                            |
| pnpm test:integration       | Database integration tests; destructive, see isolation rules |
| pnpm test:e2e               | Playwright browser and HTTP acceptance tests                 |
| pnpm db:generate            | Generate the Prisma client (does not apply schema changes)   |
| pnpm db:migrate             | Apply database migrations; verify target first               |
| pnpm db:seed                | Seed permission catalog and system roles, not credentials    |
| pnpm db:seed:users          | Local-only role fixture users; refuses non-local databases   |
| pnpm owner <verified-email> | Bootstrap the first owner from an active, verified account   |

Prettier owns formatting (ESLint handles code quality only); run pnpm format before handoff.

For code changes, run relevant lint, typecheck and unit tests; use build and integration/end-to-end checks where applicable. Report exact checks and blockers, never claim unrun tests passed. For documentation-only tasks, verify references and accuracy without unnecessary builds or database mutations.
