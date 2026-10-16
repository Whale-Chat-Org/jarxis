# Coding agent instructions

Read the rules that apply to your task before starting. `CLAUDE.md` delegates here.

## `.agent/rules/`

| File                                              | When to use                                                                                                                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [git-rules.md](.agent/rules/git-rules.md)         | **Always, before any work.** Branching, commits, PRs and preserving other agents' changes.                                                                                                                            |
| [collaboration.md](.agent/rules/collaboration.md) | Always. File ownership with concurrent agents, secret handling, delegation.                                                                                                                                           |
| [architecture.md](.agent/rules/architecture.md)   | Any code change. Stack, where things live (auth, RBAC, admin service, HTTP), pnpm scripts and which checks to run.                                                                                                    |
| [design-system.md](.agent/rules/design-system.md) | Any UI change. Check the shadcn registry before creating components, use design tokens only (no ad-hoc Tailwind), colours, loading states, shadcn MCP setup, and the Better Auth UI discovery order for auth changes. |
| [security.md](.agent/rules/security.md)           | Auth, sessions, tokens, RBAC, admin mutations, rate limiting, HTTP handling, API docs or error/log output.                                                                                                            |
| [localhost.md](.agent/rules/localhost.md)         | Setting up a new machine, Apple native containers, or `ECONNREFUSED` on the local PostgreSQL, Redis or Azurite ports.                                                                                                 |
| [testing.md](.agent/rules/testing.md)             | Before running integration tests, migrations, seeds or owner bootstrap against any database, and before signing in or creating users during development.                                                              |

## Next.js docs

This project uses a Next.js version with breaking changes from older releases. Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/`:

| Path                         | When to use                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `01-app/01-getting-started/` | Routing, layouts/pages, server vs client components, data fetching, caching, errors, CSS, metadata, route handlers, proxy. |
| `01-app/02-guides/`          | Task guides: authentication, caching, forms, streaming, testing, deploying, etc.                                           |
| `01-app/03-api-reference/`   | File conventions (`loading.js`, `layout.js`, `error.js`), functions, components and config options.                        |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
