# Jarxis

Jarxis is a secure administration starter for products that need account authentication, account
settings, role-based access control, user administration, audit logs and a small API token
surface. It provides production-ready foundations and leaves domain-specific features to the
product built on top of it.

Built with Next.js (App Router), Better Auth, Prisma/PostgreSQL, Redis, Tailwind CSS v4 with
shadcn/ui and Better Auth UI, Zod and Scalar OpenAPI docs.

## Vision

Product teams repeatedly rebuild the same security-sensitive foundations before they can work on
their actual product: verified accounts, password recovery, secure sessions, API authentication,
administrative roles, protected owner operations and audit records. Built ad hoc, these pieces
lead to inconsistent experiences and avoidable authorization risks.

Jarxis supplies them as one coherent application with deny-by-default permissions and clear
extension points, so teams can start from a secure base and focus on what makes their product
different.

## What it provides

- Self-service accounts: registration, email verification, sign-in, password recovery and account
  settings without administrator help.
- An administration area for users, sessions, roles, permissions and audit events.
- Server-side, database-backed authorization on every request for privileged operations.
- Short-lived access tokens with rotating refresh tokens for non-browser clients.

## Documentation

- [docs/PRD.md](docs/PRD.md): product behaviour
- [docs/TECH.md](docs/TECH.md): architecture, auth, RBAC and data model
- [docs/providers.md](docs/providers.md): Provider pools, discovery and gateway API
- [docs/REFERENCE.md](docs/REFERENCE.md): API clients, deployment, CI/CD, testing, UI conventions and attribution
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): local development setup
