# Jarxis

Jarxis is a secure administration starter for products that need account authentication, account
settings, role-based access control, user administration, audit logs and a small API token
surface. It provides production-ready foundations and leaves domain-specific features to the
product built on top of it.

Built with Next.js (App Router), Better Auth, Prisma/PostgreSQL, Redis, Tailwind CSS v4 with
shadcn/ui and Better Auth UI, Zod and Scalar OpenAPI docs.

## Get started

Requirements: Node 24+, pnpm 12.8.1 and Docker Compose v2 with Docker running.

```sh
git clone https://github.com/Whale-Chat-Org/jarxis.git
cd jarxis
pnpm dev
```

`pnpm dev` prepares everything, then starts the app at http://localhost:3000:

1. Creates `.env` with generated local secrets, only if it is missing.
2. Installs dependencies and generates the Prisma client.
3. Starts PostgreSQL, Redis and Azurite in Docker.
4. Applies migrations and seeds development users.

Every step is idempotent, so run `pnpm dev` every time. An existing `.env` is never changed,
applied migrations are skipped and existing users are left untouched.

Sign in with a seeded user such as `owner@jarxis.test`. All seeded users share the development
password in `scripts/seed-users.ts`. Seeding only runs in development and against a local
database. To send real email, set `BREVO_API_KEY` and `MAIL_FROM` in `.env`.

## Usage

| Command                        | What it does                                                         |
| ------------------------------ | -------------------------------------------------------------------- |
| `pnpm dev`                     | Set up the local environment and start the dev server                |
| `pnpm dev --port 3001`         | Same, passing extra arguments to `next dev`                          |
| `pnpm dev:next`                | Start only the Next dev server                                       |
| `pnpm db:seed:users --reset`   | Reset seeded users' roles and passwords and sign them out            |
| `pnpm db:migrate`              | Apply pending database migrations                                    |
| `pnpm ml:worker`               | Run the ML provider worker (model discovery and subscription logins) |
| `pnpm owner <email>`           | Recovery: make a verified account owner when none is active          |
| `pnpm lint` / `pnpm typecheck` | Lint and type-check                                                  |
| `pnpm test`                    | Run unit tests                                                       |
| `pnpm build`                   | Build for production                                                 |

Seeded users:

| Email                    | Role                     |
| ------------------------ | ------------------------ |
| `owner@jarxis.test`      | Owner                    |
| `admin@jarxis.test`      | Administrator            |
| `viewer@jarxis.test`     | Viewer                   |
| `member@jarxis.test`     | User                     |
| `banned@jarxis.test`     | Viewer, banned           |
| `unverified@jarxis.test` | User, email not verified |

Local URLs:

- App: http://localhost:3000
- Admin: http://localhost:3000/admin
- API docs: http://localhost:3000/api/docs

More documentation:

- [docs/PRD.md](docs/PRD.md): product behaviour
- [docs/TECH.md](docs/TECH.md): architecture, auth, RBAC and data model
- [docs/ml-providers.md](docs/ml-providers.md): ML provider pool, worker and gateway API
- [docs/REFERENCE.md](docs/REFERENCE.md): API clients, deployment, CI/CD, testing, UI conventions and attribution
- [AGENTS.md](AGENTS.md): rules for coding agents
