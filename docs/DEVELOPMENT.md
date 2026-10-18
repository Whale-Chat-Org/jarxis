# Development

## Get started

Requirements: Node 24+, pnpm 12.14.0, and either Docker Compose v2 with Docker running or Apple
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
3. Start PostgreSQL, Redis and the configured object-storage services (MinIO by default).
   Create the private local MinIO bucket when S3 is selected.
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
- Runs `jarxis-postgres`, `jarxis-redis` and the configured `jarxis-storage` and/or `jarxis-azurite` on the same host ports as Docker
  (55432, 56379, and 9000 for MinIO or 10000 for Azurite). Existing containers are started again, never recreated; data lives in
  the `jarxis_*-data` volumes.

In VS Code, the "Dev" launch configuration runs the same setup as a pre-launch task, then starts
Next with the debugger attached. "Dev (Docker setup)" uses `pnpm dev` instead.

Containers do not restart on their own after a reboot; the next `pnpm dev:apple` or "Dev" launch
starts them again. Stop the containers you use with `container stop jarxis-postgres jarxis-redis jarxis-storage`
(include `jarxis-azurite` too if you enabled Azure).

## Object storage

The shared server-side storage manager detects **Azure Blob Storage** from
`AZURE_STORAGE_CONNECTION_STRING` and **S3-compatible storage** from `S3_BUCKET`. Configure either
or both. Uploads go to every configured backend concurrently and succeed when at least one copy
is stored. The manager returns `storedIn` and `failedProviders`; partial failures also produce a
sanitized warning. Callers can retry the same key and bytes; no background retry queue is included.
Reads try Azure first and fall back to S3. Deletes attempt every configured backend and report
failed cleanup so callers can retry. A missing object returns 404 only when every backend reports
it missing; an unavailable backend with no readable copy returns an availability error.

| Setting                                                           | Purpose                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `AZURE_STORAGE_CONNECTION_STRING`                                 | Enable Azure Blob; use `UseDevelopmentStorage=true` for local Azurite      |
| `AZURE_STORAGE_CONTAINER`                                         | Azure container; defaults to `jarxis-storage`                              |
| `S3_BUCKET`                                                       | Enable S3 using an existing private bucket; local default `jarxis-storage` |
| `S3_REGION`                                                       | S3 signing region; local default `us-east-1`                               |
| `S3_ENDPOINT`                                                     | Optional custom endpoint; leave empty for AWS S3                           |
| `S3_FORCE_PATH_STYLE`                                             | `true` for MinIO; normally `false` for AWS                                 |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Standard AWS SDK credentials; omit for IAM role credentials                |
| `MINIO_PORT`                                                      | Local MinIO host port, defaults to `9000`                                  |

Both development commands start the configured local storage services. MinIO uses the container
name `jarxis-storage`; Azurite keeps `jarxis-azurite` on Apple containers. MinIO is built from pinned
upstream source in `Dockerfile.minio` because upstream no longer publishes the community image.
Apple setup forwards `NODE_EXTRA_CA_CERTS` as an optional build secret for enterprise TLS proxies;
the CA stays out of the runtime image. Subsequent builds reuse the cache. Setup generates the local MinIO password in `.env` and creates
the private local bucket. Never use these local root credentials for production. For production,
pre-provision a private bucket and grant only object read, write and delete permissions.

Existing `.env` values and storage volumes are retained. `.env.example` enables MinIO only; add an
Azure connection string to write to both. Switching configuration or changing bucket/container
names does not migrate photos. Retain the old settings or copy existing objects separately when
existing URLs must continue working.

For a custom local MinIO port, update both `MINIO_PORT` and `S3_ENDPOINT`. `pnpm dev` runs Next on
the host using `.env`. The Compose development app uses `http://minio:9000`; to also use Azurite
inside that app, start Compose with `--profile azure` and set `AZURE_STORAGE_DOCKER_CONNECTION_STRING`
to an Azurite connection string whose BlobEndpoint is `http://azurite:10000/devstoreaccount1`.
This separate override avoids using a host-loopback connection string inside the app container.

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

`ECONNREFUSED` on `localhost:55432`, `56379`, `9000` or `10000` means PostgreSQL, Redis, MinIO or Azurite is not
running. Run `pnpm dev`, `pnpm dev:apple` or the matching VS Code launch configuration, which start
them.
