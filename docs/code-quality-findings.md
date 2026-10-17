# Code quality findings

|          |                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Snapshot | `main` @ `b3329bb`, 2026-10-17                                                                                                                                                       |
| Scope    | All 391 tracked files: 208 source files in `src/` + `scripts/` (~26k lines) and 23k lines in `tests/`. Also `prisma/`, `src/components/ui` (40 registry copies), styles and configs. |
| Purpose  | Find the issues and rank them. **No remediation is proposed here** — that comes later, per finding.                                                                                  |

---

## 1. How the quality rules were built

This review did not use a generic checklist. The rules come from three sources, used in this order:

1. **This repo's own written rules.** These are the strongest evidence, because the team has already agreed to them. A conflict with them is a finding.
   - `.agent/rules/architecture.md`: Prisma is the only ORM; `permissions.ts` is the single source of truth for roles and permissions; there is no second write path for user, role or permission data; `http.ts` owns error responses.
   - `.agent/rules/design-system.md`: compose UI from primitives and never hand-roll them.
   - `eslint.config.mjs`: design tokens only, no inline styles in feature code.
2. **The categories you asked for:** naming, junior readability, and reusability/scalability.
3. **Widely used industry standards**, used to set measurable thresholds:
   - Clean Code: function size, naming, single responsibility.
   - SonarQube cognitive complexity. The repo already runs Sonar (`sonar-project.properties`).
   - Google's engineering-practices readability guidance.
   - The React rule "one component, one job".

### 1.1 Rubric

| ID     | Category                     | What counts as an issue                                                                                                                                                                                                                                        | Measurable threshold                                                                                                                                                 |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** | Naming                       | Vague names (`data`, `root`, `perform`, `p`). Names or comments that say something the code doesn't do. One concept under several names, or one name for several concepts.                                                                                     | Any name that contradicts its behavior. Any concept with 2 or more names across files.                                                                               |
| **Q2** | Junior readability           | Long functions or components, deep nesting, files that mix concerns, magic numbers or strings, non-obvious logic with no "why" comment, boolean flag parameters.                                                                                               | Function or component > 60 lines. Nesting > 3 levels. File > 400 lines that mixes concerns. Component with > 8 `useState`. Unnamed literal used in 2 or more places. |
| **Q3** | Reusability                  | The same logic or JSX copy-pasted, or a shared helper re-implemented locally.                                                                                                                                                                                  | The same shape in 2 or more places.                                                                                                                                  |
| **Q4** | Scalability / structure      | God files or components. Something that has to change in N places to add one provider, role, field or action. More than one source of truth. Layering violations, such as a page or route doing DB or business logic. Breaking a documented architecture rule. | More than 3 edit sites to add one item. Any second source of truth.                                                                                                  |
| **Q5** | Error handling & type safety | Swallowed errors, `as` casts on data from outside, error codes that differ between server and client, inconsistent error shapes.                                                                                                                               | Any `catch {}` that loses the cause. Any unchecked cast of external data.                                                                                            |
| **Q6** | Testability                  | Pure logic buried in components. Hidden globals (`db`, `Date.now()`, module state) that can't be injected. Dead code.                                                                                                                                          | Logic that can only be tested by rendering or by using a real database.                                                                                              |

### 1.2 Severity scale

| Severity     | Meaning                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | Likely to cause real bugs, breaks a documented architecture rule, or makes every future change in the area risky or slow. |
| **High**     | Significant friction across a whole feature or module.                                                                    |
| **Medium**   | Local friction: one file or one flow.                                                                                     |
| **Low**      | Cosmetic.                                                                                                                 |

### 1.3 Process

1. **Measure.** Count lines per file. Use an AST script to measure function length and nesting. Count hooks per component.
2. **Read by area.** Five parallel reviewers each covered one area against the same rubric:
   - ML gateway and providers
   - Admin UI
   - Core lib, API and scripts
   - Auth and chat UI
   - Tests, Prisma, UI primitives and configs
3. **Verify.** Every finding cites `file:line`. The Critical findings were re-checked by hand against the source before ranking.
4. **Rank.** Findings are ranked across the whole repo, not per area. If the same root cause appears in several areas, it is merged into one finding.

---

## 2. Summary

### 2.1 Top 10, ranked

| #   | Severity | Category | Finding                                                                                                                                       | Where                                                                         |
| --- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Critical | Q4 Q3    | The comma-separated `user.role` value is parsed in ~11 places, and the rules differ between them                                              | lib, scripts, admin UI, ML gateway                                            |
| 2   | Critical | Q4       | A second write path for roles goes against `architecture.md`. Each route rebuilds its own auth guard, and the owner check is written ≥ 5 ways | `role-service.ts`, gateway, docs-access                                       |
| 3   | Critical | Q2 Q4    | God files and god components (971-, 855- and 410-line components; a 1,604-line protocol file)                                                 | `ml-providers-panel.tsx`, `admin-users.tsx`, `protocol.ts`, `owner-setup.tsx` |
| 4   | Critical | Q4       | The production `/chat` route runs entirely on hard-coded mock data and shows the fake user "Alex Morgan"                                      | `chat-data.ts`, `chat-page.tsx`                                               |
| 5   | Critical | Q3 Q4    | The password field and validator are copy-pasted 8×, and the password policy is defined in 4 places                                           | auth forms, `auth.ts`, `providers.tsx`, `owner-setup.tsx`                     |
| 6   | Critical | Q3 Q4    | Role editing UI is built 3 different ways from 2 different role sources, and one of the three is dead code                                    | `user-role-cell.tsx`, `admin-users.tsx`, `change-role-dialog.tsx`             |
| 7   | Critical | Q1 Q4    | The ML protocol advertises a "responses" upstream format that can never be selected (dead branches)                                           | `protocol.ts`, `gateway.ts`                                                   |
| 8   | High     | Q5       | Error codes differ between server and client, error shapes are inconsistent, and errors are swallowed                                         | `role-service.ts`, `action-errors.ts`, routes, `redis.ts`, gateway            |
| 9   | High     | Q1       | One concept goes by many names, the role modules overlap, and some comments lie                                                               | `ml/*`, `permissions.ts` / `roles.ts` / `rbac.ts` / `access-display.ts`       |
| 10  | High     | Q3 Q5    | Each panel has its own fetch and error handling with unchecked casts, and one UI branch depends on the wording of an error message            | `roles-manager.tsx`, `ml-providers-panel.tsx`                                 |

### 2.2 Counts by area

| Area                                                         | Critical | High | Medium | Low |
| ------------------------------------------------------------ | -------- | ---- | ------ | --- |
| ML gateway & providers (`src/lib/ml`, routes)                | 2        | 5    | 4      | 1   |
| Admin UI (`src/components/admin`, `auth/admin`, `app/admin`) | 3        | 4    | 5      | 3   |
| Core lib, API, scripts                                       | 2        | 5    | 5      | 0   |
| Auth & chat UI, pages                                        | 2        | 4    | 6      | 0   |
| Tests, Prisma, UI primitives, configs                        | 1        | 5    | 5      | 1   |

---

## 3. Critical findings

### C1. The `user.role` string is parsed ~11 ways, and the rules differ — Q4 / Q3

**Root cause.** `prisma/schema.prisma:67` stores the role keys in `app_user.role` as one comma-separated `String?`. There is no foreign key to `roles.key` and no join table (see §5). Each consumer splits the string itself:

| Site                                                              | Behavior                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/lib/permissions.ts:168` `parseRoles`                         | Trims and drops unknown names                               |
| `src/lib/access-display.ts:28` `splitRoleValue`                   | Keeps unknown names; empty value → `[]`, shown as "No role" |
| `src/components/auth/admin/admin-users.tsx:141` `parseAdminRoles` | Empty value → `config.defaultRole`                          |
| `src/components/admin/user-role-cell.tsx:43` (inline)             | Empty value → `'user'`                                      |
| `src/lib/rbac.ts:60` (inline)                                     | Its own split                                               |
| `src/lib/initial-owner-setup.ts:68` `hasOwnerRole`                | Its own split                                               |
| `src/lib/ml/gateway.ts:86` (inline)                               | Its own split and owner check                               |
| `scripts/owner.ts:28`                                             | `split(',').includes('owner')` with **no trim**             |
| `scripts/owner.ts:38` (same file)                                 | **Does** trim                                               |
| SQL `src/lib/roles.ts:97`                                         | `btrim(...)`                                                |
| SQL `src/lib/role-service.ts:128`                                 | `replace(coalesce(role,''),' ','')`                         |
| `src/lib/auth/admin-guards.ts:101`, `initial-owner-setup.ts:105`  | Pre-filter with substring `role: { contains: 'owner' }`     |

On top of this, the cast `as ('user' | 'admin')[]` is repeated at `admin-users.tsx:139`, `change-role-dialog.tsx:113` (`as unknown as`) and `user-role-cell.tsx:58`.

**Why it is the most critical:**

- It is a security-relevant value, and its meaning depends on which file reads it.
- `"user, owner"` counts as an owner in `permissions.ts`, but not in `scripts/owner.ts:28`.
- An empty value shows as "No role", "user" or the configured default, depending on the screen.
- A substring match on `'owner'` would also match a custom role key that contains "owner".

### C2. A second role write path, guards rebuilt per route, and the owner check written ≥ 5 ways — Q4

- **Rule broken.** `architecture.md:13` says: _"User, role and permission writes belong to the admin plugin; do not reintroduce a second write path."_ But `src/lib/role-service.ts:58-137` creates, updates and deletes `role`, `rolePermission` and `auditLog` rows directly with Prisma. These functions are exposed through `src/app/api/admin/roles/route.ts` and `[key]/route.ts`.
- **Code and rule disagree.** Either the code or the rule is now wrong. Either way, rate limiting and audit format for role writes live outside `admin-guards.ts`.
- **Guards are hand-assembled per route, each with different strictness:**
  - `requireRoleReader` (`role-service.ts:21`) skips `authorize`'s active-session re-check.
  - `requireRoleOwner` (`role-service.ts:30-44`) runs its own `db.session.findFirst`.
  - `guardDocs` (`docs-access.ts:4-9`) and `post-login/route.ts:11-13` build their own versions.
- **The owner check exists in at least 5 forms:**
  - a hand-rolled split at `gateway.ts:82-90`
  - `parseRoles` at `ml/service.ts:56`
  - `authorize().roles.includes('owner')` at `ml/admin-auth.ts:24`
  - the same call at `role-service.ts`
  - `docs-access.ts`
  - plus the client-side `grants.roles.includes('owner')` at `app/admin/roles/page.tsx:12`
- **Why it hurts:** every new endpoint has to choose and rebuild a guard recipe, and the authorization rules drift apart.

### C3. God files and god components — Q2 / Q4

| Unit                                                                        | Span        | Measurements                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MlProvidersPanel` (`src/components/admin/ml-providers-panel.tsx:270-1240`) | 971 lines   | 17 `useState`, 3 `useEffect`, 4 `useRef`, its own `request()` fetch wrapper, 3 dialogs, ~14 levels of JSX nesting                                                                                                                    |
| `UserInspector` (`src/components/auth/admin/admin-users.tsx:860-~1714`)     | ~855 lines  | 11 near-identical `useAdminPermission` calls (885-949), 8 mutations. Adding one admin action means editing 5 places: the permission list, the mutations, `confirm()`, the `dangerousMutation` ternary and the `dangerLabel` ternary. |
| `admin-users.tsx` (file)                                                    | 1,804 lines | 8 components in one file                                                                                                                                                                                                             |
| `src/lib/ml/protocol.ts` (file)                                             | 1,604 lines | Schemas, parsing, 2 stream renderers, upstream parser and upstream renderer all in one file                                                                                                                                          |
| `createResponsesStreamRenderer` (`protocol.ts:932-1129`)                    | 198 lines   | A closure state machine with 11 mutable variables                                                                                                                                                                                    |
| `createUpstreamStreamParser.parse` (`protocol.ts:1276-1426`)                | 151 lines   | **8 levels of nesting**                                                                                                                                                                                                              |
| `renderUpstreamRequest` (`protocol.ts:1434-1604`)                           | 171 lines   |                                                                                                                                                                                                                                      |
| `handleGateway` (`src/lib/ml/gateway.ts:249-409`)                           | 161 lines   | 6 levels of nesting. Auth, DB, routing, body reading, failover, credentials, cooldown state and streaming, all in one function                                                                                                       |
| `OwnerSetup` (`src/components/auth/owner-setup.tsx:138-548`)                | ~410 lines  | 8 `useState` (one of them a dummy `setTick` re-render counter), 3 hand-rolled `fetch` flows, a 5-deep nested ternary (423-433)                                                                                                       |
| `ChatWorkspace` (`src/components/chat/chat-page.tsx:74-412`)                | ~340 lines  | Dialog title, description, label and icon each picked by repeated `modal?.type === …` chains                                                                                                                                         |
| `RolesManager` (`src/components/admin/roles-manager.tsx:81-426`)            | 346 lines   | 3 inline `fetch` calls                                                                                                                                                                                                               |

**Why it hurts:**

- A junior engineer can't hold these in their head.
- Every change touches shared `busy`/`dialogKey`/`perform` state.
- None of the inner logic can be tested on its own.
- Adding a provider format means editing three deeply nested `dialect === …` chains: `protocol.ts:1202/1290/1447`.

### C4. The production `/chat` route runs on mock data — Q4

- `src/components/chat/chat-data.ts:21-217` hard-codes a profile (`profile: { name: 'Alex Morgan', initials: 'AM', … }`), models, seeded conversations and canned replies.
- `responseFor()` (line 219) picks a reply with a regex on the prompt.
- `chat-page.tsx:240-247` renders the fake profile in the sidebar footer for the signed-in user.
- `chat-state.ts:19`, `chat-page.tsx:131,148,357` and `chat-composer.tsx:54,143` import `data` directly.

**Why it hurts:** there is no data or service seam. Wiring a real backend means rewriting the page, the composer and the reducer. Until then, a real user sees someone else's name.

### C5. Password UX copy-pasted 8×; password policy defined in 4 places — Q3 / Q4

- **The validator is copied.** The same `validateStringLength({ maxLength: emailAndPassword?.maxPasswordLength, … tooLong.replace('{{max}}', …) })` block appears at:
  - `sign-in.tsx:148`
  - `sign-up.tsx:252,334`
  - `reset-password.tsx:115,197`
  - `settings/security/change-password.tsx:268,349`
- **The show/hide field is copied.** Each show/hide password `InputGroup` (~60-80 lines of JSX) is repeated with its own visibility `useState`.
- **The copies have already drifted.** `change-password.tsx` uses `emailAndPassword.maxPasswordLength` (no `?.`).
- **The policy has 4 owners:**
  - `src/lib/auth.ts:37` (`minPasswordLength: 12`)
  - `src/components/providers.tsx:72`
  - `src/lib/setup-validation.ts:15` ("Mirrors Better Auth's…")
  - `owner-setup.tsx:514-528`, which hard-codes `maxLength: 128, minLength: 12` and English copy instead of `localization`
- **The max is never set on the client.** The client never sets `maxPasswordLength`, so every registry form passes `undefined` as the max.

### C6. Role editing UI built 3 ways; one copy is dead — Q3 / Q4

| Implementation                                                                                           | Role source                                                                  |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `user-role-cell.tsx`: Select + AlertDialog                                                               | `roles: RoleView[]` prop (DB roles, including custom roles)                  |
| `admin-users.tsx:766-805` (create) and `1336-1385` (inspector): copy-pasted checkbox/radio/Select picker | DB roles                                                                     |
| `change-role-dialog.tsx`: radio dialog                                                                   | Static `roleOptions` from `access-display.ts`, **which has no custom roles** |

- **One copy is dead.** Nothing in `src/` imports `ChangeRoleDialog`. Its focus fallback queries `[data-access-user-id]`, and no element in `src/` sets that attribute.
- **The rules have drifted.** Only the dead copy knows `ownerBlockedReason`.
- **Why it hurts:** readers will edit the wrong file, and self-edit, owner-block and multi-role rules already differ between the copies.

### C7. A "responses" upstream format that can never be selected — Q1 / Q4

- **It can never be returned.** `protocol.ts:1430` `upstreamDialect()` is `provider === 'anthropic' ? 'anthropic' : 'chat'`, so `'responses'` is never returned.
- **The comments and code claim it anyway.**
  - The file header (lines 7-8) says "three upstream dialects".
  - There are upstream-Responses branches in `parseUpstreamResult`, the stream parser and `renderUpstreamRequest`.
  - There is a URL ternary at `gateway.ts:308`.
- **The dead branch is also wrong.** The Responses branch of `renderUpstreamRequest` would still emit Chat-shaped `messages`.

**Why it hurts:** readers maintain and trust code that never runs, and turning it on later would send invalid requests.

---

## 4. High findings

### H1. Error codes, error shapes and swallowed errors — Q5

- **Server and client codes don't match.**
  - `role-service.ts:133` throws `'ROLE_IN_USE'`, but `action-errors.ts:42` allowlists `ROLE_HAS_MEMBERS`, which nothing emits.
  - `ROLE_NAME_TAKEN`, `SYSTEM_ROLE`, `INVALID_PERMISSION` and `RATE_LIMITED` are not allowlisted, so users get generic copy for them.
- **One 401 condition has 3 codes:** `UNAUTHENTICATED` (`rbac.ts:30`), `SESSION_REQUIRED` (`role-service.ts:23`) and `INVALID_TOKEN` (`tokens.ts:9`).
- **Routes bypass `http.ts`:**
  - `api/health/route.ts:4-12` swallows the cause in `catch {}`.
  - `auth/post-login/route.ts:7` lets non-401 errors escape as raw 500s.
  - `api/auth/[...all]/route.ts:21,24` builds the error body by hand.
- **Errors are swallowed.**
  - `src/lib/redis.ts:13`: `instance.on('error', () => {})`. Redis outages leave no log.
  - `gateway.ts:301-305` drops credential errors and silently tries the next connection.
  - `gateway.ts:225` is a bare `catch {}` around streaming.
  - `discovery.ts:262-264` labels DB or transaction failures as `'credential'`.
- **The ML layer has 6 error styles:**
  - `GatewayError` (unexported)
  - `ProtocolError`
  - `NetworkError`
  - `DiscoveryFailure`
  - `HttpError`
  - plain `Error`

  It also detects Zod errors by `error.name === 'ZodError'` (`gateway.ts:383`).

### H2. One concept under many names; overlapping modules; comments that lie — Q1

- **The client-facing model id has 3 names, plus a 4th helper:**
  - `publicModel` (`protocol.ts:79`)
  - `publicId` (`ml/service.ts:99`)
  - `poolModelId` (`model-id.ts:12`)
  - `publicModelId` (`types.ts:15`): the same idea under a **different formula**, never called
- **The provider list is declared twice:** `providerKinds` (`types.ts:1`) and `apiKeyProviders` (`validation.ts:68`).
- **"dialect" means two things:** the client format (`ClientDialect`) and the upstream format (`UpstreamDialect`).
- **Permission flags share one name.** `canManage` means `roles:assign` on one page, `grants.roles.includes('owner')` on another, and `providers:manage` + owner redirect on a third. Role fields are `RoleView.key/name` in one place and `RoleDescription.id/label` in another.
- **Six modules answer "what can role X do?":**
  - `permissions.ts`: the documented source of truth
  - `roles.ts`: Zod schema, SQL counts, an `AsyncLocalStorage` + `Proxy` adapter
  - `rbac.ts`
  - `role-service.ts`
  - `rbac-seed.ts`
  - `access-display.ts`
- **Some comments and names say the opposite of the code:**
  - `access-display.ts:60-83` says grants are "read from the role's live grants", but `roleGrants` reads code-only statements.
  - `grantsForRoles` has no callers.
  - `validation.ts:6-8` says `roleInput` was removed, but it lives at `roles.ts:28`.
  - `admin-guards.ts:16` says the plugin "replaces `admin-service.ts`", but that file still exists.
- **Near-synonyms in `permissions.ts`:** `ownerOnly`, `restrictedPermissions`, `lockedRoles`, `adminRoles`.

### H3. Each panel has its own fetch and error policy — Q3 / Q5

There is no shared client, so three panels follow three different error policies:

| Location                                | Behavior                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ml-providers-panel.tsx:249-268`        | `request<T>()` ends with `response.json() as Promise<T>`                                                                         |
| `roles-manager.tsx:99-164`              | Raw `fetch` with `(await response.json()) as {...}`, and shows the server message directly (`setError(cause.message)`, line 149) |
| Auth tables (`admin-users.tsx:164-167`) | Route errors through `safeActionErrorMessage` and say server messages must never be shown                                        |

**One recovery action depends on error copy.** `ml-providers-panel.tsx:1024` (`shownDialogError.includes('Reload models')`) decides whether that button appears. Rewording the error removes the button.

### H4. Auth forms show errors in two different ways — Q5

- **Toast only:** `sign-up.tsx:130`, `reset-password.tsx:92` and `change-password.tsx:186` swallow submit errors and rely on the global toaster.
- **Inline path:** `sign-in.tsx:86-92` lets the error reach the inline path in `auth-form.tsx:78`.
- **Inline slot:** `owner-setup.tsx` is the only form that uses the inline `AuthFormServerError` slot.
- **Field resets differ** on error:
  - sign-up clears both password fields
  - sign-in clears only the password
  - change-password clears nothing

### H5. Copy-paste within the ML layer — Q3

- The connection-update + audit block is duplicated word for word (`ml/service.ts:212-235` and `281-304`).
- The advisory-lock SQL is written twice (`service.ts:71`, `discovery.ts:223`).
- The "render in the client's format" ternary appears twice (`gateway.ts:341-345`, `363-367`).
- The tool-choice transform appears twice (`protocol.ts:236-245`, `389-398`).
- The "join text parts" mapping appears 6 times in `protocol.ts`.
- The stale-row check is repeated inside `refreshConnection` (`discovery.ts:196-204`, `225-232`).

### H6. Copy-paste across lib, routes and scripts — Q3

- The size-limited body reader is in `http.ts:21-34` and again in `profile/avatar/route.ts:17-31`.
- Credential-account row creation is in `initial-owner-setup.ts:220-229` and `scripts/seed-users.ts:64-72`.
- "Find active owners" exists 3× (`admin-guards.ts:99-105`, `initial-owner-setup.ts:103-117`, `scripts/owner.ts:23-29`).
- The audit-row literal `{ id: randomUUID(), actorId, action: '<free string>', … }` appears 8+ times, and the action names are untyped.
- The disabled Better Auth paths are listed in both `auth.ts:25-32` and `api/auth/[...all]/route.ts:10-17`.
- `scripts/seed-users.ts:36` hard-codes `pg_advisory_xact_lock(72419831)` although `SETUP_ADVISORY_LOCK` exists.
- The "Setup already completed" card is built twice, and the copies look different: `app/setup/page.tsx:35-58` and `owner-setup.tsx:325-343`.

### H7. Unchecked casts at trust boundaries — Q5

- **Request bodies:** `admin-guards.ts` casts the untyped request body ~7 times (lines 90-220) instead of parsing it once.
- **Upstream JSON:**
  - `discovery.ts:132` casts upstream JSON straight to a shape.
  - `gateway.ts:347` re-reads the raw body via a cast, because the canonical request lacks `includeUsage`.
- **Other casts:**
  - `protocol.ts:571/614/650/1493`
  - `model-id.ts:13-14` (`as ProviderKind` twice)
  - `reset-password.tsx:70-71, 81-82` (`searchParams.get('token') as string`, parsed twice, which hides the `null` that the next line checks for)

---

## 5. Tests, Prisma, UI primitives and configs

### Measurements

- `tests/` holds 96 files and ~23k lines.
- **Largest test files:**

  | File                             | Lines |
  | -------------------------------- | ----- |
  | `auth-admin-users.test.tsx`      | 1,044 |
  | `server-ml-protocol.test.ts`     | 876   |
  | `ml-gateway.test.ts`             | 800   |
  | `admin-ui-ml-providers.test.tsx` | 780   |
  | `setup.test.ts`                  | 693   |

- **Casts:**
  - `as any`: 0
  - `as unknown as`: 31
  - `as never`: 19
- **Other counts:**
  - `toHaveBeenCalledTimes`: 46
  - Assertions on class names: 27
  - `vi.mock('@/db', …)` redefined in 17 files
  - Inline `new QueryClient` in 15 places

### Findings

| Severity     | Category | Finding                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | Q4       | **This schema field is the root cause of C1.** `prisma/schema.prisma:67` is `role String?`, documented as "one or more … role names, comma-separated". There is no FK to `Role.key` and no join table. Deleting or renaming a role leaves stale names in user rows, "who holds role X" can't be indexed, and every consumer has to re-parse the string.                                         |
| High         | Q1       | **Table names mix singular and plural.** Singular: `app_user`, `session`, `account`, `verification`, `installation_setup`. Plural: `roles`, `audit_logs`, `ml_connections`, `refresh_tokens`, `owner_setup_requests`. Some indexes are named explicitly and others use Prisma defaults.                                                                                                         |
| High         | Q4       | **Actor columns are plain strings with no `@relation` to User:** `AuditLog.actorId`/`targetId` (197-198), `MlConnection.createdBy` (23), `MlGatewayKey.createdBy` (51), `Session.impersonatedBy`, `InstallationSetup.completedBy`. `MlConnection.provider`/`status` and `InstallationSetup.method` are free strings rather than enums.                                                          |
| High         | Q3       | **Test harnesses are re-implemented per file.** `setup.test.ts:36-200` hand-rolls an in-memory Prisma fake, and `auth-admin-users.test.tsx:9` has a different one. `makeClient`/`renderWithAuth` is redefined in all 7 `auth-ui-*.test.tsx` files with different signatures. `vi.mock('@/db')` is redefined in 17 files.                                                                        |
| High         | Q1       | **Test file prefixes overlap.** `ml-protocol.test.ts` and `server-ml-protocol.test.ts` test the same module, and so do `avatar-storage` and `server-avatar-storage`. Roles are covered across 4 files. The prefixes in use are `server-`, `ml-`, `auth-ui-`, `auth-`, `admin-ui-`, `ui-`, `misc-`, `app-pages-`, plus files with no prefix. `misc-chrome.test.tsx` groups unrelated components. |
| High         | Q2       | **Very large test files.** `auth-admin-users.test.tsx` is 1,044 lines. `setup.test.ts` runs ~200 lines of bespoke fake infrastructure before the first test.                                                                                                                                                                                                                                    |
| Medium       | Q4       | **Tests assert on Tailwind class strings** (`ui-admin-panel.test.tsx:346-369`: `toContain('p-xl')`, `toContain('bg-muted/50')`; also `brand.test.tsx:17`). A token tweak breaks tests even when behavior is unchanged.                                                                                                                                                                          |
| Medium       | Q4       | **Heavy use of mock call counts** (46 `toHaveBeenCalledTimes`; 13 in `ml-gateway.test.ts`). The tests are tied to internal call structure.                                                                                                                                                                                                                                                      |
| Medium       | Q5       | **Casts hide drift between test doubles and real types.** `server-auth-config.test.ts:82` reaches into library internals with `as unknown as`. `authClient={client as never}` appears in 9 files.                                                                                                                                                                                               |
| Medium       | Q6       | **Modules no test imports:** `change-role-dialog.tsx` (dead, see C6), `chat-messages.tsx`, `session-actions.tsx`, `server-table-state.ts`, `error-toaster.tsx`, `last-used-badge.tsx`, `auth-plugin.ts`, `user-status.ts`, `admin-table.ts`, `owner-bootstrap-state.ts`.                                                                                                                        |
| Medium       | Q4 Q3    | **The chat suite never runs, and the test-database guard is copied.** `playwright.chat.config.ts` has no `package.json` script and no CI step. The test-DB guard regex `/^\/jarxis_test…$/` is copied in 3 places (`playwright.config.ts:5-8`, `tests/integration/setup.ts:2-5`, `tests/e2e/helpers.ts:13-14`).                                                                                 |
| Low          | Q1 Q2    | **`updatedAt` is defined inconsistently.** Some models use `@updatedAt`, some only `@default(now())` (those never auto-update), and one uses both. `chat-state.test.ts` uses relative imports while ~61 other files use `@/`.                                                                                                                                                                   |

**UI primitives (`src/components/ui`) and the remaining configs** (`next.config.ts`, Dockerfile, compose, CI, `.husky`): no local divergence or quality issues were found beyond those above.

---

## 6. Medium and Low findings

### Readability (Q2)

- **Magic numbers with no named constant:**
  - 60 s cooldown (`gateway.ts:110, 371`)
  - 120 s timeout (`gateway.ts:251`, and `network.ts:76` defines its own)
  - `1048576` twice (`gateway.ts:42, 59`)
  - 15 s, three times (`ml/service.ts:151,153,186`), plus the UI copy "within 15 seconds" (`ml/errors.ts:96`)
  - `max_tokens ?? 4096` (`protocol.ts:1502`)
  - `1e12`/`1e9` timestamp thresholds (`gateway.ts:130-134`) with no comment
  - `15000` (`ml-providers-panel.tsx:346`)
  - `86_400` (`admin-users.tsx:158`)
  - `cursor + 18` and `setInterval(…, 35)` in chat (`chat-state.ts:64`, `chat-page.tsx:87`)
  - Rate-limit budgets scattered as literals: `5,300`, `10,300`, `30,60`, `20,3600`, `60,60`, `120`
- **Repeated string literals:**
  - `'better-auth-ui.verify-email'` (`sign-in.tsx:59`, `sign-up.tsx:83`, `verify-email.tsx:39,44`)
  - `'/auth/sign-in'` hard-coded in 7 places
- **Single-letter names** (`p`, `g`, `i`, `s`, `u`, `f`, `t`) in `api/v1/[...path]/route.ts`, `rbac.ts`, `tokens.ts` and `docs-access.ts`. `api/v1/[...path]/route.ts:16-52` is a hand-rolled router on `p[0]`/`p[1]`.
- **Boolean flag parameters:** `createConnection(actorId, input, deferDiscovery = false)` is called with a bare `true`. `refreshConnection(id, force = false)` is the same.
- **One long if-chain:** `additional-field.tsx:124-382` is a ~260-line `if (inputType === …)` chain, and every branch repeats the same Field wrapper.
- **Terse names in the chat reducer:** action names `'new'`, `'model'`, `'tick'`. Its `send`/`edit`/`retry` share a fall-through tail, so a new action type would silently start streaming (`chat-state.ts:86-125`).
- **Long functions:**
  - `initial-owner-setup.ts`: `verifyInitialOwnerSetup` ~88 lines, `startInitialOwnerSetup` ~67 lines
  - `network.ts`: `safeFetch` 127 lines
  - `discovery.ts`: `refreshConnection` 105 lines

### Structure and testability (Q4 / Q6)

- **Layering:**
  - `ml-providers-panel.tsx:7` imports a route file (`@/app/admin/ml-providers/loading`).
  - Pages run Prisma inline (`app/admin/ml-providers/page.tsx:11-14`, `app/admin/page.tsx:17-18`).
  - The domain type `RoleView` is exported from a UI component (`roles-manager.tsx:48`).
- **Pure logic buried in components:**
  - the PATCH diff builder (`ml-providers-panel.tsx:476-504`)
  - the list-params builder (`admin-users.tsx:233-260`)
  - the role draft builder (`roles-manager.tsx:105-119`)

  The module-level helpers (`encodeModelStates`, `parseDiscovery`, `getBanDurationSeconds`) are not exported, so tests can't import them.

- **Hidden globals:**
  - `ml/service.ts`, `discovery.ts`, `gateway.ts` and `worker.ts` import the global `db` and call `Date.now()` directly.
  - Role resolution depends on a module-level `AsyncLocalStorage` + `Proxy` (`roles.ts:26,158-169`). It silently falls back to code roles outside `/admin/*`.
- **Avatar API client in the providers file.** `components/providers.tsx:16-37` holds the avatar upload/delete logic, a cast, and a regex copy of the server route.
- **One provider, four edit sites.** Adding one ML provider means editing:
  - `providerHeaders` (`discovery.ts:13`)
  - `defaultBaseUrl` (`types.ts:6`)
  - `upstreamDialect` (`protocol.ts:1430`)
  - the endpoint ternary (`gateway.ts:308`)

### Correctness smells

- **Unreachable lines:** `network.ts:181-182` can never run, because `word2 < 0x0200` already covers Teredo `0x0000` and `0x0002`. This makes the blocklist harder to review.
- **Mismatched dismissal guards:**
  - `admin-users.tsx:1178-1181`: `onEscapeKeyDown` checks `profileInFlight.current`, but `onInteractOutside` does not, so an outside click can close the dialog mid-save.
  - The "block dismissal while pending" trio is re-implemented in 6 dialogs.
- **Duplicated condition:** `admin-guards.ts:152` checks `/admin/set-role` twice. `removesOwnerAccess` (122-132) partly duplicates `bansTarget`.
- **Pass-through file:** `users-workspace.tsx` adds nothing (17 lines).

### Low

- `audit/page.tsx:94-101` and `page.tsx:114` re-annotate types that Prisma already infers.
- `permissions/page.tsx:20` uses a lowercase `table()` render function where a component is expected.
- `CanonicalMessage` has a `system` role that the parsers never produce (`protocol.ts:50`).

---

## 7. What was not flagged

- **Route handlers under `src/app/api/admin/ml-providers` and `api/llm`** are thin (9-30 lines) and delegate correctly.
- **`landing-page.tsx` and `skeletons.tsx`** are small and clean.
- **Design-token use** is lint-enforced (`eslint.config.mjs`) and was not re-audited by hand.
- **`src/components/ui/**`** are registry copies. Only local divergence was reviewed (§5).
