# ML providers and worker

Owners manage connections and dedicated gateway keys in the ML providers administration page. API-key providers use their configured HTTPS endpoint. Subscription connections use the vendor CLI's own sign-in flow: Codex runs `codex login --device-auth`; Claude runs `claude auth login --claudeai`. The worker captures Claude's browser authorization URL and forwards the owner's pasted authorization code to that CLI's stdin. OAuth state, PKCE and code exchange belong to the isolated vendor CLI process. Only the initiating owner can view, submit or cancel a login. Code submission uses a protected POST to `/api/admin/ml-providers/login/{jobId}`.

Run the worker separately from Next.js. Set an independent `ML_ENCRYPTION_KEY` consisting of exactly 64 hex characters in both processes; it must differ from the auth and JWT secrets. Keep this key backed up securely: replacing it makes stored provider credentials unreadable. The worker also needs the application's normal runtime environment and database access. No automatic sign-in occurs on startup.

For a local worker, install verified vendor CLI versions and set `ML_CODEX_CLI_PATH` and `ML_CLAUDE_CLI_PATH` to absolute executable paths. Set `ML_WORKER_STATE_DIR` to an absolute directory owned exclusively by the worker. Run `pnpm ml:worker`; the script sets the `react-server` Node condition required by server-only modules. Each login gets separate HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, temporary and XDG directories. Host credential stores and inherited provider tokens are never used. CLI output is bounded and never logged. Vendor URLs are restricted to approved HTTPS authorization hosts and paths. Login sessions expire after ten minutes, and cancellation or shutdown terminates the CLI process group. Temporary credentials are removed when a job finishes; old directories left by a crash are removed on worker startup after their ten-minute lifetime.

Compose runs a dedicated `ml-worker` service. The pinned CLI defaults are Codex `0.160.0` and Claude Code `2.1.288` (`ML_CODEX_CLI_VERSION` and `ML_CLAUDE_CLI_VERSION` in `.env.example`, Compose and the Dockerfile). Override them only with exact, reviewed versions. The Docker `worker` target installs these CLI versions and runs as the unprivileged node user; its private named volume holds only transient login state. Never mount a host home directory or existing vendor credential directory into this container. Limit access to the worker volume, database and encryption key. After changing CLI versions, verify both the documented login flags and the isolated credential file formats in a disposable environment before enabling sign-in.

Access tokens nearing expiration refresh through the known vendor token endpoint under a per-account PostgreSQL advisory transaction lock. Set `ML_CODEX_OAUTH_CLIENT_ID` and `ML_CLAUDE_OAUTH_CLIENT_ID` in **both app and worker** environments to the public OAuth client identifiers verified against the installed vendor CLI release. No copied hardcoded OAuth client identifier is shipped. Missing identifiers fail refresh closed; obtain the correct identifier from the audited vendor CLI release before deployment. Codex refresh uses `https://auth.openai.com/oauth/token`; Claude refresh uses `https://console.anthropic.com/v1/oauth/token`. Invalid grants require owner reconnection. Temporary transport/provider failures do not overwrite credentials. A compare-and-set guard prevents a refresh or completed login from overwriting a concurrent credential replacement.

The worker polls queued logins and due model discovery. Discovery runs automatically after credential replacement and then hourly; manual refresh requests enqueue work. Codex discovery is authenticated and automatic: the worker calls `<baseUrl>/models?client_version=0.160.0` with the connection's access token and `ChatGPT-Account-Id`, reads `models[].slug` and skips entries with `visibility: "hide"`. API-key providers read `data[].id` from `<baseUrl>/models`. Catalogs that cannot be discovered require owner-entered model identifiers.

Catalog discovery is shared by the worker, the preview endpoint and connection creation. Each run uses the stored or supplied credential against a public HTTPS destination with no redirects, a 15-second total deadline across all pages, at most 2 MiB per response, 20 pages and 5000 unique models. A missing catalog endpoint (404, 405 or 501) is reported as `unsupported`; an empty list is a successful discovery; any other failure is `failed` with a generic message and never upstream text. Failed or unsupported runs keep the last successful catalog.

Before saving, owners can check an API-key provider with `POST /api/admin/ml-providers/discover` (`providers:manage`, same origin and body limits as other mutations). It accepts `provider` (`openai`, `anthropic`, `openrouter` or `custom`), `apiKey` and an optional HTTPS `baseUrl` (required for `custom`) and returns `{ "discovery": { "status", "models": [{ "id", "name" }], "error" } }`. The key is not stored or logged. Creating an API-key connection commits it first, with its scheduled discovery deferred by 15 seconds so the worker cannot take it, then claims and runs the same bounded discovery itself and returns the saved connection with `201` whether or not upstream discovery succeeded; the preview result is never trusted as input. If that request dies, the worker discovers the connection once the 15 seconds pass. Connections without a key, and subscription connections, stay pending until a key or sign in is supplied.

## Access and errors

ML provider access is owner only. `providers:read` and `providers:manage` belong only to the Owner role and are listed as owner-only in `src/lib/permissions.ts`, so `isAllowed` also requires the `owner` role. The page guard, every `/api/admin/ml-providers` handler, and the "Managing ML providers" row in the role guide all read that same rule. Viewers and administrators do not see the navigation entry, are redirected away from the page, and get `403` from the API. Impersonated sessions and bearer tokens are rejected. Changing someone's role in Users & access changes their provider access immediately, because every request re-checks the owner's live session and role.

Management endpoints return `{ error: { code, message } }` with sanitized messages. A rejected custom endpoint (private, local, redirecting or non-HTTPS) returns `400 INVALID_ENDPOINT`. The panel reads only the status and an allowlisted error code (`src/lib/ml/errors.ts`) and never displays server text. Failures of page actions such as enabling, refreshing, deleting or issuing keys appear as a single toast. Failures inside a dialog appear inline in that dialog. Load and background-refresh failures show a page alert with a retry.

## Gateway

Gateway keys are independent of browser sessions and belong to their issuing owner. The gateway exposes `GET /api/llm/v1/models`, `POST /api/llm/v1/chat/completions` and `POST /api/llm/v1/responses`, authenticated with `Authorization: Bearer jml_...`. Keys are rate limited to 60 requests per minute.

Model identifiers are `<namespace>/<upstream model>`. A connection using its provider's preset endpoint uses the provider name as namespace, for example `openai/gpt-4.1` or `codex/gpt-5`. Any other endpoint, including every `custom` connection, uses `<provider>-<24 hex characters>`, derived from a SHA-256 hash of the normalized base URL (trailing slashes ignored). Connections at the same endpoint therefore pool and fail over together, while unrelated custom gateways never collide on a shared model name. Use the IDs returned by `/models` exactly.

```bash
export JML_KEY=jml_REPLACE_ME
curl -s https://app.example.com/api/llm/v1/models -H "Authorization: Bearer $JML_KEY"
curl -s https://app.example.com/api/llm/v1/chat/completions \
  -H "Authorization: Bearer $JML_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-4.1","messages":[{"role":"user","content":"Hello"}]}'
curl -s https://app.example.com/api/llm/v1/responses \
  -H "Authorization: Bearer $JML_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"codex/gpt-5","input":"Hello","stream":true}'
```

Protocol limits, enforced before any upstream call:

- Requests are JSON only, at most 1 MiB, and time out after 120 seconds. `model` is at most 512 characters; at most 512 messages or input items and 128 tools.
- Unknown fields are rejected. Chat rejects `functions`, `function_call`, `logit_bias`, `logprobs`, `top_logprobs`, `seed`, `service_tier`, `store`, `audio`, `modalities`, `prediction`, `web_search_options`, `reasoning_effort`, `frequency_penalty`, `presence_penalty` and any `n` other than 1.
- Responses is stateless: `store` must be false or omitted, and `previous_response_id`, `conversation`, `background`, `include`, `truncation`, `reasoning`, `prompt`, `prompt_cache_key`, `safety_identifier`, `service_tier`, `logprobs`, `top_logprobs` and `max_tool_calls` are rejected. Only function tools are accepted.
- Image input is rejected for every provider.
- Anthropic and Claude reject structured output, `user`, strict tools and `temperature` above 1.
- Codex rejects `stop`, `temperature`, `top_p`, output token limits, `user` and structured output.
- Failover across pooled connections happens on credential failures, transport errors, 401, 429 and 5xx, only before the first output byte. 429 responses set a cooldown from `Retry-After` or rate-limit reset headers (minimum one minute); 401 also marks the connection for reconnection. Upstream error bodies are never returned.

**Live OAuth is unverified.** Implementation and mocked unit checks do not establish that an installed vendor CLI supports a hosted container, browser capture, pasted-code stdin, or file-based credential storage. Claude releases that use a platform keychain rather than the isolated `.credentials.json` file fail closed. Do not advertise either subscription connection as ready unless the CLI exits successfully and valid credentials are read from its isolated directory. A deployed owner must explicitly test login, cancellation, expiration and refresh against the selected CLI releases. This implementation does not run live login or read host credentials during development.
