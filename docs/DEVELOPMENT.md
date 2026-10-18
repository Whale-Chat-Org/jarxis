# Development

## Get started

Requirements: Node 24+, pnpm 12.8.1, and either Docker Compose v2 with Docker running or Apple
native containers (macOS 26+ on Apple silicon).

```sh
git clone https://github.com/Whale-Chat-Org/jarxis.git
cd jarxis
pnpm dev        # Docker
pnpm dev:apple  # Apple native containers
```

Both commands prepare everything, then start the app at http://localhost:3000:

1. Create `.env` with generated local secrets, only if it is missing. Keys added to `.env.example`
   later are appended; existing values are never changed.
2. Install dependencies and generate the Prisma client.
3. Start PostgreSQL, Redis and Azurite.
4. Apply migrations and seed development users.

Every step is idempotent, so run the same command every time. Applied migrations are skipped and
existing users are left untouched.

Sign in with a seeded user such as `owner@jarxis.test`. All seeded users share the development
password in `scripts/seed-users.ts`. Seeding only runs in development and against a local
database. To send real email, set `BREVO_API_KEY` and `MAIL_FROM` in `.env`.

### Apple native containers

`pnpm dev:apple` runs `pnpm setup:apple` (scripts/setup-apple.mjs) and then `next dev`. Setup:

- Installs Apple's `container` CLI with Homebrew when it is missing, and starts its services. The
  first start downloads the Linux kernel.
- Runs `jarxis-postgres`, `jarxis-redis` and `jarxis-azurite` on the same host ports as Docker
  (55432, 56379 and 10000). Existing containers are started again, never recreated; data lives in
  the `jarxis_*-data` volumes.

In VS Code, the "Dev" launch configuration runs the same setup as a pre-launch task, then starts
Next with the debugger attached. "Dev (Docker setup)" uses `pnpm dev` instead.

Containers do not restart on their own after a reboot; the next `pnpm dev:apple` or "Dev" launch
starts them again. Stop them with `container stop jarxis-postgres jarxis-redis jarxis-azurite`.

## Commands

| Command                        | What it does                                                |
| ------------------------------ | ----------------------------------------------------------- |
| `pnpm dev`                     | Set up the local environment with Docker and start Next     |
| `pnpm dev --port 3001`         | Same, passing extra arguments to `next dev`                 |
| `pnpm dev:apple`               | Set up the local environment with Apple containers and Next |
| `pnpm setup:apple`             | Only the Apple container setup, without starting Next       |
| `pnpm dev:next`                | Start only the Next dev server                              |
| `pnpm db:seed:users --reset`   | Reset seeded users' roles and passwords and sign them out   |
| `pnpm db:migrate`              | Apply pending database migrations                           |
| `pnpm providers:worker`        | Run the Provider worker (scheduled model discovery)         |
| `pnpm owner <email>`           | Recovery: make a verified account owner when none is active |
| `pnpm lint` / `pnpm typecheck` | Lint and type-check                                         |
| `pnpm test`                    | Run unit tests                                              |
| `pnpm build`                   | Build for production                                        |

## Seeded users

| Email                    | Role                     |
| ------------------------ | ------------------------ |
| `owner@jarxis.test`      | Owner                    |
| `admin@jarxis.test`      | Administrator            |
| `viewer@jarxis.test`     | Viewer                   |
| `member@jarxis.test`     | User                     |
| `banned@jarxis.test`     | Viewer, banned           |
| `unverified@jarxis.test` | User, email not verified |

## Local URLs

- App: http://localhost:3000
- Admin: http://localhost:3000/admin
- API docs: http://localhost:3000/api/docs
- Chat demo: http://localhost:3000/chat, a frontend-only workspace with mock conversations (see
  [chat-ui.md](chat-ui.md))

## Troubleshooting

`ECONNREFUSED` on `localhost:55432`, `56379` or `10000` means PostgreSQL, Redis or Azurite is not
running. Run `pnpm dev`, `pnpm dev:apple` or the matching VS Code launch configuration, which start
them.
