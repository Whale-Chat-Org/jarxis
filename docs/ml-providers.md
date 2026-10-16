# ML providers and worker

Owners manage OpenAI, Anthropic, OpenRouter and custom HTTPS API-key connections and dedicated gateway keys in the ML providers administration page. Subscription sign-in and OAuth account linking are not supported.

Run `pnpm ml:worker` separately from Next.js for scheduled model discovery. Set an independent `ML_ENCRYPTION_KEY` consisting of exactly 64 hex characters in both processes; it must differ from the auth and JWT secrets. Keep it backed up securely: replacing it makes stored API keys unreadable. Compose runs the dedicated worker as the unprivileged node user, without vendor CLIs or a login-state volume.

Discovery runs automatically after credential replacement and then hourly; manual refresh requests enqueue work. API-key providers read `data[].id` from `<baseUrl>/models`. Catalogs that cannot be discovered require owner-entered model identifiers.

Owners can turn models on or off in **Edit connection**. Search matches model names and IDs; **Enable all** and **Disable all** affect only current search results. The count shows enabled and total models. Changes remain in the editor until **Save connection** succeeds; **Cancel** discards them. Discovery retains the enabled state of models it has seen before. The provider card shows three models until **Show all** is selected. The add and edit API key fields start hidden and can be revealed temporarily with the eye button; closing the editor hides them again. Saved keys are never returned to the browser.

`PATCH /api/admin/ml-providers/{id}/models` saves the complete model state and optional connection fields in one transaction. The connection listing supplies `modelStateVersion`; clients send it as `version` with `states`, an unpadded base64url string of enabled bits ordered by model ID, least significant bit first within each byte. The compact encoding keeps the payload within the 16 KiB body limit for a 5,000-model catalog. A changed catalog or concurrent model edit returns `409 MODEL_CATALOG_CHANGED`; reload models and review the selection before retrying. Each changed model receives an audit entry. The gateway immediately excludes disabled models from `/api/llm/v1/models` and inference routing.

## Upgrading from subscription connections

Stop the old app and worker before applying the removal migration. It permanently deletes Codex/Claude connections and their model mappings and drops all login jobs, including encrypted login state/input. API-key connections and audit history are preserved. Start the updated app and discovery worker after migration. Remove the old `jarxis_ml-worker-state` Docker volume once the old worker is stopped and detached; never use `docker compose down --volumes`, which also deletes database and Redis volumes. Remove obsolete vendor CLI and OAuth settings from deployment environments.

Catalog discovery is shared by the worker, the preview endpoint and connection creation. Each run uses the stored or supplied credential against a public HTTPS destination with no redirects, a 15-second total deadline across all pages, at most 2 MiB per response, 20 pages and 5000 unique models. A missing catalog endpoint (404, 405 or 501) is reported as `unsupported`; an empty list is a successful discovery; any other failure is `failed` with a generic message and never upstream text. Failed or unsupported runs keep the last successful catalog.

Before saving, owners can check an API-key provider with `POST /api/admin/ml-providers/discover` (`providers:manage`, same origin and body limits as other mutations). It accepts `provider` (`openai`, `anthropic`, `openrouter` or `custom`), `apiKey` and an optional HTTPS `baseUrl` (required for `custom`) and returns `{ "discovery": { "status", "models": [{ "id", "name" }], "error" } }`. The key is not stored or logged. Creating an API-key connection commits it first, with its scheduled discovery deferred by 15 seconds so the worker cannot take it, then claims and runs the same bounded discovery itself and returns the saved connection with `201` whether or not upstream discovery succeeded; the preview result is never trusted as input. If that request dies, the worker discovers the connection once the 15 seconds pass. Connections without a key stay pending until an API key is supplied.

## Access and errors

ML provider access is owner only. `providers:read` and `providers:manage` belong only to the Owner role and are listed as owner-only in `src/lib/permissions.ts`, so `isAllowed` also requires the `owner` role. The page guard, every `/api/admin/ml-providers` handler, and the "Managing ML providers" row in the role guide all read that same rule. Viewers and administrators do not see the navigation entry, are redirected away from the page, and get `403` from the API. Impersonated sessions and bearer tokens are rejected. Changing someone's role in Users changes their provider access immediately, because every request re-checks the owner's live session and role.

Management endpoints return `{ error: { code, message } }` with sanitized messages. A rejected custom endpoint (private, local, redirecting or non-HTTPS) returns `400 INVALID_ENDPOINT`. The panel reads only the status and an allowlisted error code (`src/lib/ml/errors.ts`) and never displays server text. Failures of page actions such as enabling, refreshing, deleting or issuing keys appear as a single toast. Failures inside a dialog appear inline in that dialog. Load and background-refresh failures show a page alert with a retry.

## Gateway

Gateway keys are independent of browser sessions and belong to their issuing owner. The gateway exposes `GET /api/llm/v1/models`, `POST /api/llm/v1/chat/completions` and `POST /api/llm/v1/responses`, authenticated with `Authorization: Bearer jml_...`. Keys are rate limited to 60 requests per minute.

Model identifiers are `<namespace>/<upstream model>`. A connection using its provider's preset endpoint uses the provider name as namespace, for example `openai/gpt-4.1` or `anthropic/claude-sonnet`. Any other endpoint, including every `custom` connection, uses `<provider>-<24 hex characters>`, derived from a SHA-256 hash of the normalized base URL (trailing slashes ignored). Connections at the same endpoint therefore pool and fail over together, while unrelated custom gateways never collide on a shared model name. Use the IDs returned by `/models` exactly.

```bash
export JML_KEY=jml_REPLACE_ME
curl -s https://app.example.com/api/llm/v1/models -H "Authorization: Bearer $JML_KEY"
curl -s https://app.example.com/api/llm/v1/chat/completions \
  -H "Authorization: Bearer $JML_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-4.1","messages":[{"role":"user","content":"Hello"}]}'
curl -s https://app.example.com/api/llm/v1/responses \
  -H "Authorization: Bearer $JML_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-5","input":"Hello","stream":true}'
```

Protocol limits, enforced before any upstream call:

- Requests are JSON only, at most 1 MiB, and time out after 120 seconds. `model` is at most 512 characters; at most 512 messages or input items and 128 tools.
- Unknown fields are rejected. Chat rejects `functions`, `function_call`, `logit_bias`, `logprobs`, `top_logprobs`, `seed`, `service_tier`, `store`, `audio`, `modalities`, `prediction`, `web_search_options`, `reasoning_effort`, `frequency_penalty`, `presence_penalty` and any `n` other than 1.
- Responses is stateless: `store` must be false or omitted, and `previous_response_id`, `conversation`, `background`, `include`, `truncation`, `reasoning`, `prompt`, `prompt_cache_key`, `safety_identifier`, `service_tier`, `logprobs`, `top_logprobs` and `max_tool_calls` are rejected. Only function tools are accepted.
- Image input is rejected for every provider.
- Anthropic rejects structured output, `user`, strict tools and `temperature` above 1.
- Failover across pooled connections happens on credential failures, transport errors, 401, 429 and 5xx, only before the first output byte. 429 responses set a cooldown from `Retry-After` or rate-limit reset headers (minimum one minute); 401 also marks the connection for reconnection. Upstream error bodies are never returned.
