# Security invariants

- Authorization belongs on the server, never solely in UI visibility. Recheck live database session/user state and grants; banned/unverified users, expired/deleted sessions and revoked/expired token families must be rejected.
- Email verification and minimum password length remain enforced. Password resets and account bans revoke sessions and token families.
- JWT_SECRET and BETTER_AUTH_SECRET must be independent, different secrets of at least 32 characters. Keep secrets server-side and retain server-only boundaries.
- Persist refresh tokens as hashes only; rotate on use. Replay revokes the entire family and underlying session. Commit revocation before throwing outside the transaction; preserve lock order user → family → token.
- **Privileged administrative mutations are enforced by `src/lib/auth/admin-guards.ts`**, not by `adminWrite` (removed). The Better Auth admin plugin owns `/api/auth/admin/*`, so the rules run as:
  - `hooks.before` — resolves the _authoritative_ session (a database read, never a cookie cache), reads the target from the request body, and `throw`s to abort. This is where owner protection, the last-owner rule and the "an owner must be active and verified" rule live.
  - `databaseHooks.user.delete.before` — a defence-in-depth repeat of the owner checks for any delete that reaches the adapter by another route.
  - `databaseHooks.user.update.after` — revokes every live token family when an account is banned, closing the refresh path the plugin's own session deletion leaves open.
  - `hooks.after` — writes the `audit_logs` row once the mutation has committed.
- **Accepted trade-offs of that design** (approved with the migration): the checks run before the mutation without holding a lock, so a narrow window exists between check and commit; the audit row is written after commit rather than atomically and is logged-and-swallowed on failure; and because the plugin's endpoints require a session, administrative mutations are browser-session only — a bearer token cannot reach them.
- Never remove or ban the last active, verified owner. Only owners may modify owners. `roles:update` and `roles:assign` require owner membership as well as the permission grant.
- System roles are declared in `src/lib/permissions.ts` and seeded into `roles`; none can be deleted (a database trigger enforces it). Owner and User grants are pinned to code and cannot be edited; an owner may edit Viewer and Administrator grants and descriptions (not names). Editable and custom roles resolve fresh grants from `role_permissions` on each request, and owner-only grants are filtered out in code even if a row holds one. An unrecognised name in `user.role` grants nothing (fail closed) — do not map unknown roles to a permissive default.
- Keep origin/CSRF checks for mutations, including required Origin for cookie-bearing requests. Preserve JSON validation, 16 KiB body limits and no-store responses.
- Redis rate limiting stays atomic and fails closed on unavailability. Trust X-Real-IP only behind an explicitly trusted proxy that overwrites it.
- **First-owner bootstrap (`/setup`, `POST /api/setup`) is public until an owner exists, then closed permanently.** There is no setup secret and no environment switch: control of the submitted inbox is the gate. `POST /api/setup` creates an unverified account with no administrative privileges, records a pending request and emails a six-digit code. Only `POST /api/setup/verify` may verify the account and grant Owner access; no account is created auto-verified. Codes are 6 digits, expire in 10 minutes, allow at most 5 attempts, are stored hashed (never plaintext, never logged, never returned), and a resend (60-second cooldown) invalidates the previous code. Accept the code from the JSON body only (never a query parameter, never a GET), rate-limit all three endpoints per IP and per request, and keep responses sanitized. The first successful verification wins atomically under the installation lock, so concurrent verifications yield exactly one owner; later attempts get the completed response. Ordinary sign-up at `/auth/sign-up` keeps its normal email verification, and `pnpm owner <verified-email>` stays as the CLI recovery path and must not be removed.
- Production docs/OpenAPI remain owner-only; do not expose alternate unguarded auth documentation routes.
- Sanitize errors and logs; never expose request secrets, SQL parameters or raw provider errors. The admin audit hook whitelists the fields it records and must never log passwords or tokens.

# CI/CD security

The pipeline is `.github/workflows/ci-cd.yml`: **test → build (+ image scan) → SonarQube, Semgrep, Trivy → deploy** (deploy only on `main`). It runs only when application code, its build/test configuration or the workflow changes (`paths:` filter); `workflow_dispatch` forces a run without deploying. Keep these properties when editing it:

- **Least privilege.** Workflow `permissions` default to `contents: read`. Only the deploy job adds `id-token: write`, for OIDC sign-in to Azure; the federated credential trusts `main` only. Only the cleanup job adds `actions: write`, to delete its own run's artifacts. Never add long-lived cloud credentials or broaden permissions workflow-wide.
- **Pinned supply chain.** Every third-party action is pinned to a full commit SHA with a `# vX.Y.Z` comment, and every container image (CI services, Semgrep, Dockerfile `FROM`) to a `@sha256:` digest. Update both together; never use a floating tag or branch.
- **Scans gate the deploy.** `deploy` needs `sonarqube`, `semgrep` and `trivy`. SonarQube's quality gate, Semgrep `ERROR` findings and Trivy `HIGH`/`CRITICAL` (fix available) all fail the run. Do not weaken thresholds, add `continue-on-error` or skip a job to get a release out.
- **Nothing reaches the registry before the scans pass.** Images are built once and the app image is Trivy-scanned in the build job. Only on a push to `main` are the image tars gzipped and kept as a 1-day artifact; only the deploy job pushes them to ACR, tagged by commit SHA.
- **Main only.** The workflow triggers only on a push to `main` (and manual `workflow_dispatch`, whose `test` job is skipped off `main`). Pull requests and other branches get no CI run, so their checks must be run locally before merging (see `git-rules.md`). Do not add `pull_request`, `pull_request_target` or other-branch triggers without the owner's approval.
- **Artifact storage.** Image tars are only uploaded on `main`, for deploy. Docker build-record artifacts are disabled (`DOCKER_BUILD_RECORD_UPLOAD: false`) and reports keep `retention-days: 7`. The final `cleanup` job (`if: always()`) deletes the run's artifacts once every job has finished, keeping only the SARIF reports when the run failed or was cancelled; any new job must be added to its `needs`. When adding a file that tests or the build read, add it to the `paths:` filter.
- **Secrets.** Use GitHub `secrets` for credentials and `vars` for non-secret settings. CI test secrets are generated per run (`openssl rand`); fake values must be obviously fake (`ci-not-a-real-key`). Production secrets come from Key Vault at run time and are written to a `umask 077` env file that is deleted on exit — never `echo` a secret, pass it as a command argument or let it reach a log.
- **Network.** The Postgres firewall opens only for the runner's IP for the migration and always closes (`if: always()`).
- **Safe rollout.** Migrations run before the slot swap, so they must stay compatible with the release still in production. Staging must pass health checks before the swap, and a failed production health check swaps back.
- **Dependencies.** Install with `pnpm install --frozen-lockfile`. Only packages listed in `pnpm-workspace.yaml` `allowBuilds` may run install scripts. Fix vulnerable transitive packages with a commented `overrides` entry. Adding to `minimumReleaseAgeExclude` (bypassing the new-release waiting period) needs a reason.
- **Containers** run as the unprivileged `node` user. Do not add `USER root` to runtime stages.
- **Scanner exceptions** are narrow and documented: Trivy secret exceptions live in `trivy-secret.yaml` with a comment saying why (e.g. the public Azurite dev key). Never ignore a whole rule, path or severity to silence an alert.
- The `.husky/pre-commit` hook (lint-staged) is a convenience, not a control. CI on `main` and the local checks before merging are the gate; never bypass the hook with `--no-verify` for security-relevant changes.

# Responding to a security alert

Applies to any alert or report: Trivy, Semgrep, SonarQube, GitHub Dependabot / secret scanning / code scanning, `pnpm audit`, or a person reporting a vulnerability.

## 1. Triage

- Record the source, rule or CVE ID, severity, and the affected package, file or image layer. Do not paste secret values or exploit payloads into tickets, PRs, commits or chat.
- **Leaked secret:** treat it as compromised. Have the owner **rotate or revoke it first**, then remove it from the code. Removing the commit alone does not help, and history rewrites need explicit approval (see `git-rules.md`).
- Create a Jira **Bug** with a `fix/JAR-<n>` branch (see `jira-ticket.md` and `git-rules.md`). Mark Critical or High findings that are exploitable in production as top priority.

## 2. Reproduce locally

Use the same settings as CI, so local and CI results match:

```bash
pnpm audit --prod
pnpm why <package>
trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed .
semgrep scan --metrics=off --config p/default --config p/typescript --config p/react --config p/nodejs --severity ERROR
```

## 3. Review the codebase

- **Reachability.** Find every place the affected package, API or pattern is used (`grep`, `pnpm why`). Decide if it is reachable from untrusted input: HTTP routes, gateway requests, uploads, provider responses, webhooks or env-driven config.
- **Data flow.** Trace untrusted input from where it enters to where it is used (SQL / Prisma raw queries, HTML rendering, redirects, outbound `fetch`, file paths, shell commands). Check that validation, size limits and output encoding hold along the whole path.
- **Invariants.** Check the finding against the rules above: server-side authorization, owner-only rules, CSRF / origin checks, rate limits, sanitized errors and logs, and the gateway's public-HTTPS / no-redirect rule for outbound calls.
- **Variants.** Search for the same pattern elsewhere in the codebase; a finding in one route usually means more like it.
- **History.** Use `git log -S '<pattern>'` to find when it came in, and whether a release containing it was deployed.
- Use the `security-review` command in Claude Code for a second pass over the fix branch, but don't treat it as a replacement for the steps above.

## 4. Fix

- Prefer the real fix: upgrade the direct dependency, add a commented `overrides` entry for a transitive one, or change the code.
- Add a regression test that fails before the fix (e.g. the malicious input is rejected).
- Suppress only a **confirmed false positive** or a finding that **cannot be reached**. Use the narrowest scope (one rule, one path), with a comment giving the reason and a link to the Jira ticket. Never suppress in order to ship.
- Run the full CI checks locally (`format:check`, `lint`, `typecheck`, `test`, `test:integration`, `build`) and the scan that raised the alert.

## 5. Close out

- In the Jira Bug, record: alert ID, reachability decision, fix or suppression reason, scan output after the fix, and whether production was affected.
- If secrets or user data may have been exposed, tell the owner. Check the `audit_logs` for misuse in the exposure window.
- Merge through a reviewed PR with the local checks and the alert's scanner passing; do not push security fixes straight to `main`. Confirm the CI run on `main` after merge is green and the alert is resolved.
