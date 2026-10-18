# Local environment on a new machine

Use this when setting up a fresh Mac, or when the app fails with `ECONNREFUSED` on
`localhost:55432` (PostgreSQL), `56379` (Redis) or `9000` (MinIO) / `10000` (Azurite). That error means the local
infrastructure is not running; it is not an application bug. Human-facing setup lives in
[docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md); keep the README free of development content.

## Setup is automated

Do not set up infrastructure by hand. One idempotent command prepares everything:

- **Docker**: `pnpm dev`, or the VS Code "Dev (Docker setup)" configuration.
- **Apple native containers** (macOS 26+, Apple silicon): `pnpm dev:apple`, or the VS Code "Dev"
  configuration, whose pre-launch task runs `pnpm setup:apple` (scripts/setup-apple.mjs).

`setup:apple` installs the `container` CLI with Homebrew when missing, starts its services
(downloading the kernel on first start), prepares `.env` through scripts/lib/prepare-env.mjs,
installs dependencies, runs the `jarxis-postgres`, `jarxis-redis` and the configured `jarxis-storage` (MinIO) and/or `jarxis-azurite`
containers, provisions the local MinIO bucket when S3 is configured, then applies migrations and seeds fixture users. After a reboot, running it again
starts the stopped containers.

## Rules

- Before migrations or seeds, confirm `DATABASE_URL` points at the local database
  ([testing.md](testing.md)). Sign in only with the seeded fixture users.
- Never print `.env` values. A `.env` copied from another machine may lack newer keys; the setup
  scripts append missing keys without changing existing values.
- Keep the images, commands, ports and volumes in scripts/setup-apple.mjs in sync with
  compose.yaml and compose.dev.yaml.
- Do not reintroduce Container Compose or an Apple-specific compose file. It accepts only one
  `-f`, cannot merge the dev override, and copies every `.env` variable into every container.
- Redis on Apple containers: new volumes are ext4 images with `lost+found`, which makes the Redis
  entrypoint skip fixing `/data` ownership (`Permission denied` for `appendonlydir`). setup-apple
  chowns `/data` before the entrypoint; keep that wrapper.
- `containerd` is unrelated and not needed.
- Contained (github.com/tdeverx/contained-app) is an optional GUI for Apple container. Its nightly
  builds are not notarized, so Gatekeeper blocks them. Never bypass Gatekeeper or remove
  quarantine attributes; the user opens it via System Settings → Privacy & Security → Open Anyway.
- Installing software and downloading files need the user's request or approval, except the
  Homebrew install that setup:apple performs as part of a requested setup.
