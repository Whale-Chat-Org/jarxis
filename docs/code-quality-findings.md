# Code quality findings

> **Remediation status (2026-10-18):** Implementation and item-by-item dispositions are recorded in [Findings remediation](findings-remediation.md). The original scan below is retained as historical evidence; its old paths, measurements and “not implemented” statements describe that snapshot. Compatibility aliases and intentional retention are documented in the resolution matrix.

|          |                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot | `chore/findings-rescan` @ `1afce0d` (same commit as `main`), 2026-10-17. Rescan of the report first written at `b3329bb`; §2.1 lists corrections.                                                                                                                 |
| Scope    | Inventory of 400 tracked files: 210 source/script/style files (26,594 lines), 96 test files (23,053 lines), Prisma and configs. The 40 UI files include the custom `admin-panel.tsx`. Findings and changed source rechecked; not a fresh full-file manual review. |
| Purpose  | Find and rank issues; record the explicit Providers naming and reusable admin table/form requirements. No application remediation is implemented here.                                                                                                            |

**Required naming change:** The project owner requires **ML providers → Providers** across the feature, including UI copy, files, components/functions, routes and supporting references. [REQ-PROVIDERS-01](code-consistency-findings.md#required-rename-providers) contains the current-to-required mappings and completion criteria. Current paths and identifiers below describe the scanned code; the rename is documented, not implemented.

**Required admin reuse:** The project owner requires a reusable table system that gathers each admin page's columns/parameters and shared record panels/forms for **view, create and edit** across Users, Roles and Providers. **REQ-ADMIN-TABLE-01** and **REQ-ADMIN-FORM-01**, including the full page inventory and acceptance criteria, are documented in [redundant-code-findings.md](redundant-code-findings.md#required-admin-table-and-form-reuse). Audit and Permissions remain read-only. These are confirmed requirements for later implementation.

---

## 1. How the quality rules were built

This review did not use a generic checklist. The rules come from three sources, used in this order:

1. **This repo's own written rules.** These are the strongest evidence, because the team has already agreed to them. A conflict with them is a finding.
   - `.agents/rules/architecture.md`: Prisma is the only ORM; `permissions.ts` is the single source of truth for roles and permissions; there is no second write path for user, role or permission data; `http.ts` owns error responses.
   - `.agents/rules/design-system.md`: compose UI from primitives and never hand-roll them.
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
5. **Current rescan.** One reviewer rechecked the cited claims and changed source at `1afce0d`, rebuilt the import/export graph using the installed TypeScript API, and remeasured function spans, hooks and JSX nesting. The prior draft described five parallel verifiers; that is not the method used for this rescan. The original review's parallel passes above are historical.

   `pnpm lint` exits 0 with **20 warnings**: 4 in the current source and 16 in four `.claude/worktrees` checkouts. `pnpm exec tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters` and the equivalent `pnpm exec tsc6` invocation both pass. Deletion simulation confirms 0 errors without `change-role-dialog.tsx` and 38 without the required ambient `auth-plugin.ts`. The current package normalizer and admin handlers were read locally; an isolated invocation of the application guard reproduced X6 with an in-memory database double. No live API, browser, database, Docker build, SonarQube or dependency-vulnerability scan was run.

   Registry duplication, a documented prototype and intentional schema choices are not automatically defects. The corrections below narrow those claims. Dead and runtime-unreachable code are detailed in `unused-code-findings.md`; duplicate implementations and extra wrappers are inventoried in `redundant-code-findings.md`.

---

## 2. Summary

### 2.1 What changed since `b3329bb`

**Code changes in between.** Only three source files changed:

- **JAR-24:** `admin-guards.ts` now guards `/admin/set-user-password`.
- **JAR-25:** the `admin-users.tsx` inspector sends `set-role` only when the roles changed.
- **`registry-drift.ts`:** one `REVIEWED` note was updated.

JAR-24 closes the password-setting gap X1 in the companion report. JAR-25 fixes the inspector's unwanted role replacement when saving an unchanged selection. The broad structural findings remain. Line numbers moved: by +3 after `admin-users.tsx:151`, by +9 after `admin-users.tsx:~1043`, and by +2 after `admin-guards.ts:34`.

**First-scan claims corrected by the rescan:**

| Where                 | Was                                                                              | Is                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| C1                    | The `contains: 'owner'` pre-filter could match a custom role                     | It only over-fetches. Every pre-filter is followed by an exact check, and custom keys are `custom_<uuid>`. A third pre-filter was missed. |
| C2                    | `requireRoleReader` skips the active-session re-check                            | `identify()` already re-checks the session. It skips only the owner-only gate, which read grants don't need.                              |
| C2                    | Owner check in ≥ 5 forms; `admin/roles/page.tsx` is client-side                  | 11 places. That page is a server component.                                                                                               |
| C3 `UserInspector`    | 11 `useAdminPermission` calls; ~855 lines                                        | 10 calls (also 10 at `b3329bb`); 861 lines after JAR-25                                                                                   |
| C3 `MlProvidersPanel` | ~14 levels of JSX nesting                                                        | 9 element levels; 11 when fragments are counted                                                                                           |
| C3 `OwnerSetup`       | 8 `useState`, a 5-deep ternary                                                   | 9 `useState`; 4 nested `?:` plus 2 `??`                                                                                                   |
| C3 Responses renderer | 11 mutable variables                                                             | 13 (9 `let` + 4 mutable `Map`/`Set`)                                                                                                      |
| H1                    | Non-allowlisted role codes reach users as generic copy                           | They reach users as **raw server text**, because `roles-manager.tsx` never calls `safeActionErrorMessage`.                                |
| H1                    | `api/auth/[...all]` bypasses `http.ts`                                           | It is wrapped in `handler()` and only builds its 404 body by hand.                                                                        |
| H1                    | 6 ML error styles; 3 codes for one 401                                           | 8 styles; at least 5 codes                                                                                                                |
| H4                    | Sign-in shows errors inline                                                      | In practice sign-in is toast-only too. Only `owner-setup.tsx` shows errors inline.                                                        |
| H6                    | Size-limited body reader 2×; "find active owners" 3×                             | Reader 3×; owners 2 true copies plus 1 variant                                                                                            |
| §5                    | 15 inline `new QueryClient`; `renderWithAuth` in 7 files                         | 12 in `tests/` (also 12 at `b3329bb`); `makeClient` in 7 of 9 files, `renderWithAuth` in 6                                                |
| §6                    | `'/auth/sign-in'` in 7 places; an outside click can close the inspector mid-save | 9 places (also 9 at `b3329bb`); the outside click cannot close it, because the Root `onOpenChange` guard blocks it                        |
| §6                    | Adding a provider takes 4 edit sites                                             | 6 code sites                                                                                                                              |

**Further corrections in the current rescan:**

- **C4 withdrawn.** `/chat` is a public, documented frontend demo (`docs/chat-ui.md:1-14`); the fake profile is fixture data. It is not evidence of a broken authenticated chat implementation.
- **C5 corrected.** Better Auth UI fills the omitted maximum with **128**. Running the installed `resolveAuthConfig` with this app's options confirms `minPasswordLength: 12`, `maxPasswordLength: 128`; registry forms do not receive an undefined maximum. The server-side create-user minimum gap is recorded as X7 instead.
- **C2 narrowed.** Custom-role CRUD in `role-service.ts` is the only implementation of that operation; Better Auth's `set-role` assigns roles to users. The architecture rule conflicts with the shipped custom-role design, rather than proving there are two competing CRUD implementations.
- **§5 corrected.** Assigned custom roles have a delete trigger; renaming a role changes its display name, not its stable key. Audit targets can be role/model IDs, so a User foreign key on every target would be wrong. The Prisma `String` fields for ML provider/status also have SQL CHECK constraints. `auth-admin-users.test.tsx` fakes auth hooks, not Prisma.
- **Lint corrected.** Four warnings belong to the current source; `pnpm lint` reports twenty in total because it also visits four local worktrees.
- **JAR-25 edge case narrowed.** The duplicate-array issue in `sameRoles` requires multiple-role mode; the deployed configuration truncates both comparison arrays to one item. Preserving the remaining stored roles is intentional JAR-25 behavior, not a newly established defect.

**New evidence retained or added:**

- **Security gaps.** X6 covers update-user role/verification changes and create-user owner eligibility; X7 covers the missing server-side minimum password check during admin creation. Both are in `unused-code-findings.md` and referenced from C2/C5. X6 is reproduced at the application-guard level, not over HTTP.
- **H1: gateway outer catch.** `gateway.ts:378-402` logs nothing, and it reports DB failures and 503 `UNAVAILABLE` as 502 `UPSTREAM_ERROR`.
- **H1: second allowlist.** A second error-code allowlist exists in `ml/errors.ts:7-22`.
- **§6 Low: JAR-25 helper limitation.** `sameRoles` does not compare duplicate-containing arrays as sets; this requires multiple-role mode to affect the current call site.
- **§6 Low: lint warnings.** Four `react-hooks/exhaustive-deps` warnings affect the current `admin-users.tsx`; the full lint command reports twenty including local worktrees.
- **§6 Low: time literals.** More unnamed time literals were found.

### 2.2 Priority findings across the repo

| #   | Severity | Category | Finding                                                                                                                            | Where                                                                         |
| --- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Critical | Q4 Q3    | The comma-separated `user.role` value is parsed in ~11 places, and the rules differ between them                                   | lib, scripts, admin UI, ML gateway                                            |
| 2   | Critical | Q4       | Mutation guards drift across endpoint/body shapes (X6), and the architecture rule conflicts with custom-role CRUD                  | `role-service.ts`, gateway, docs-access                                       |
| 3   | Critical | Q2 Q4    | God files and god components (971-, 861- and 411-line components; a 1,604-line protocol file)                                      | `ml-providers-panel.tsx`, `admin-users.tsx`, `protocol.ts`, `owner-setup.tsx` |
| 4   | Critical | Q3 Q4    | Password UX/policy is repeated, and admin create-user skips the server minimum (X7)                                                | auth forms, `auth.ts`, `providers.tsx`, `owner-setup.tsx`                     |
| 5   | Critical | Q3 Q4    | Role editing UI is built 3 different ways from 2 different role sources, and one of the three is dead code                         | `user-role-cell.tsx`, `admin-users.tsx`, `change-role-dialog.tsx`             |
| 6   | Critical | Q1 Q4    | The ML protocol advertises a "responses" upstream format that can never be selected (dead branches)                                | `protocol.ts`, `gateway.ts`                                                   |
| 7   | High     | Q5       | Error codes differ between server and client, error shapes are inconsistent, and errors are swallowed                              | `role-service.ts`, `action-errors.ts`, routes, `redis.ts`, gateway            |
| 8   | High     | Q1       | One concept goes by many names, the role modules overlap, and some comments lie                                                    | `ml/*`, `permissions.ts` / `roles.ts` / `rbac.ts` / `access-display.ts`       |
| 9   | High     | Q3 Q5    | Each panel has its own fetch and error handling with unchecked casts, and one UI branch depends on the wording of an error message | `roles-manager.tsx`, `ml-providers-panel.tsx`                                 |

### 2.3 Current finding status

Six Critical groups remain active under this report's maintenance/readability rubric: C1, C2, C3, C5, C6 and C7. C4 is withdrawn. H1–H7 remain seven High groups. The detailed tables include additional local Medium/Low observations, and their entries overlap these groups; they are not an additive defect count. X6/X7 are the security findings referenced by C2/C5, not additional independent quality groups. “Critical” in this rubric is not a CVSS security score. The original per-area totals are withdrawn because they double-counted shared root causes.

---

## 3. Critical findings

### C1. The `user.role` string is parsed ~11 ways, and the rules differ — Q4 / Q3

**Root cause.** `prisma/schema.prisma:67` stores the role keys in `app_user.role` as one comma-separated `String?`. There is no foreign key to `roles.key` and no join table (see §5). A trigger in migration `20261018000000_roles_and_permissions` (`:119-131`) validates `custom_*` keys on write. Nothing else ties the string to the roles table. Each consumer splits the string itself:

| Site                                                                                    | Behavior                                                                                                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/permissions.ts:168-173` `parseRoles`                                           | Trims and drops unknown names                                                                                                                                  |
| `src/lib/access-display.ts:28-33` `splitRoleValue`                                      | Keeps unknown names; empty value → `[]`, shown as "No role". Its only consumer is the dead `change-role-dialog.tsx`, so no live screen shows this.             |
| `src/components/auth/admin/admin-users.tsx:141-152` `parseAdminRoles`                   | Empty value → `config.defaultRole`; single-role mode keeps only the first role                                                                                 |
| `src/components/admin/user-role-cell.tsx:43-50` (inline)                                | Empty value → `'user'`                                                                                                                                         |
| `src/lib/rbac.ts:60-63` (inline)                                                        | Its own split, then `parseRoles` again at `:69`: two rule sets in one function                                                                                 |
| `src/lib/initial-owner-setup.ts:68-73` `hasOwnerRole`                                   | Its own split                                                                                                                                                  |
| `src/lib/ml/gateway.ts:82-90` (inline)                                                  | Its own split and owner check                                                                                                                                  |
| `scripts/owner.ts:27-29`                                                                | `split(',').includes('owner')` with **no trim**                                                                                                                |
| `scripts/owner.ts:37-40` (same file)                                                    | **Does** trim                                                                                                                                                  |
| `src/lib/auth/admin-guards.ts:131-133`, `:169-171`                                      | The requested role in the request body: `Array.isArray(role) ? role : [role]`, with no split or trim. Safe only because Better Auth rejects unknown role keys. |
| SQL `src/lib/roles.ts:96-97`                                                            | `btrim(...)`, and an empty value counts as `'user'` (`coalesce(nullif(role,''),'user')`)                                                                       |
| SQL `src/lib/role-service.ts:128`                                                       | `replace(coalesce(role,''),' ','')`: strips spaces only                                                                                                        |
| SQL triggers in migration `20261018000000_roles_and_permissions:122, 141`               | One uses the `btrim` form, the other the `replace` form                                                                                                        |
| `src/lib/auth/admin-guards.ts:103`, `initial-owner-setup.ts:105`, `scripts/owner.ts:24` | Pre-filter with substring `role: { contains: 'owner' }`                                                                                                        |
| `admin-users.tsx:154-155` `sameRoles` (JAR-25)                                          | Compares role arrays after re-parsing with `parseAdminRoles`, so it follows that file's rules                                                                  |

On top of this, the cast `as ('user' | 'admin')[]` is repeated at `admin-users.tsx:139`, `change-role-dialog.tsx:113` (`as unknown as`) and `user-role-cell.tsx:58`.

**Why it is the most critical:**

- It is a security-relevant value, and its meaning depends on which file reads it.
- `"user, owner"` counts as an owner in `permissions.ts`, but not in `scripts/owner.ts:28`.
- An empty value means `'user'` in `user-role-cell.tsx` and in the SQL counts, but the configured default in `admin-users.tsx`.
- The three `contains: 'owner'` pre-filters are a fourth way to read the value. They are safe today, because each is followed by an exact check and custom keys are `custom_<uuid>`, so they only over-fetch.

### C2. Mutation guards drift across body shapes; the architecture rule is stale — Q4

- **Written rule and shipped design disagree.** `architecture.md:13` assigns user, role and permission writes to the admin plugin. `src/lib/role-service.ts:58-151` implements custom-role CRUD through Prisma and `/api/admin/roles`. That is the only custom-role CRUD implementation: Better Auth's `set-role` assigns role keys to a user. The inconsistency is in the architecture contract; it does not establish duplicate CRUD functionality.
- **Policy is distributed.** Custom-role rate limiting/audits live in `role-service.ts`; user mutation guards/audits live in `admin-guards.ts`. The concrete defect is X6: equivalent owner changes sent under `data.role` bypass checks implemented for top-level `role`. Unverifying the last owner and creating an inactive owner are additional unchecked shapes.
- **Guards are hand-assembled per route, each a different recipe:**
  - `requireRoleReader` (`role-service.ts:21-28`) calls `identify()` and the grants directly instead of `authorize()`. `identify()` (`rbac.ts:26-46`) still re-checks the session. What it skips is `isAllowed`'s owner-only gate, which makes no difference for read grants today.
  - `requireRoleOwner` (`role-service.ts:30-44`) runs its own `db.session.findFirst` (`:34-37`) with no `expiresAt` filter. `authorize()` at `:39` covers expiry.
  - `requireMlOwner` (`ml/admin-auth.ts:7-29`) runs a similar query that does filter on `expiresAt`.
  - `guardDocs` (`docs-access.ts:4-10`), `post-login/route.ts:11-13` and `app/admin/ml-providers/page.tsx:9-15` build their own versions.
- **The owner check is repeated in at least 11 places:**
  - a hand-rolled split at `gateway.ts:82-90`
  - `parseRoles` at `ml/service.ts:56`
  - `authorize().roles.includes('owner')` at `ml/admin-auth.ts:24-25`
  - the same call at `role-service.ts:39-40`
  - `docs-access.ts:8`
  - `grants.roles.includes('owner')` in the server component `app/admin/roles/page.tsx:12`
  - `app/admin/ml-providers/page.tsx:10`
  - `isOwner` at `admin-guards.ts:96-98`
  - `hasOwnerRole` at `initial-owner-setup.ts:68`
  - `scripts/owner.ts:28`
  - inside `isAllowed` at `permissions.ts:181`
- **Why it hurts:** every new endpoint has to choose and rebuild a guard recipe, and the authorization rules drift apart. The per-path rules in `admin-guards.ts` have already missed a path twice:
  - `/admin/set-user-password`, fixed in JAR-24
  - the `data.role` field of `/admin/update-user`, still open (see `unused-code-findings.md` X6)

### C3. God files and god components — Q2 / Q4

| Unit                                                                        | Span        | Measurements                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MlProvidersPanel` (`src/components/admin/ml-providers-panel.tsx:270-1240`) | 971 lines   | 17 `useState`, 3 `useEffect`, 4 `useRef`, 2 `useCallback`, a module-level `request()` fetch wrapper (`:249-268`), 3 dialogs (`:827`, `:1152`, `:1195`), 9 JSX element levels (11 including fragments)                                                                               |
| `UserInspector` (`src/components/auth/admin/admin-users.tsx:863-1723`)      | 861 lines   | 10 near-identical `useAdminPermission` calls (`:888-952`), 8 mutations. Adding one admin action means editing 5 places: the permission list, the mutations (`:974-1005`), `confirm()` (`:1091`), the `dangerousMutation` ternary (`:1154`) and the `dangerLabel` ternary (`:1166`). |
| `admin-users.tsx` (file)                                                    | 1,813 lines | 8 components in one file                                                                                                                                                                                                                                                            |
| `src/lib/ml/protocol.ts` (file)                                             | 1,604 lines | Schemas, parsing, 2 stream renderers, upstream parser and upstream renderer all in one file                                                                                                                                                                                         |
| `createResponsesStreamRenderer` (`protocol.ts:932-1129`)                    | 198 lines   | A closure state machine with 13 mutable pieces of state (9 `let`, 4 `Map`/`Set`)                                                                                                                                                                                                    |
| `createUpstreamStreamParser.parse` (`protocol.ts:1276-1426`)                | 151 lines   | **8 levels of nesting** when each `else if` counts as a level (5 with chains flattened)                                                                                                                                                                                             |
| `renderUpstreamRequest` (`protocol.ts:1434-1604`)                           | 171 lines   |                                                                                                                                                                                                                                                                                     |
| `handleGateway` (`src/lib/ml/gateway.ts:249-409`)                           | 161 lines   | 6 levels of nesting. Auth, DB, routing, body reading, failover, credentials, cooldown state and streaming, all in one function                                                                                                                                                      |
| `OwnerSetup` (`src/components/auth/owner-setup.tsx:138-548`)                | 411 lines   | 9 `useState` (one of them a dummy `setTick` re-render counter at `:151`), 3 hand-rolled `fetch` flows (`:181`, `:236`, `:282`), a ternary with 4 nested `?:` and 2 `??` (`:423-433`)                                                                                                |
| `ChatWorkspace` (`src/components/chat/chat-page.tsx:74-412`)                | 339 lines   | Dialog title, description, label and icon each picked by repeated `modal?.type === …` chains (`:365-404`)                                                                                                                                                                           |
| `RolesManager` (`src/components/admin/roles-manager.tsx:81-426`)            | 346 lines   | 3 inline `fetch` calls (`:99`, `:125`, `:158`), 6 `useState`                                                                                                                                                                                                                        |

**Why it hurts:**

- A junior engineer can't hold these in their head.
- Every change touches shared `busy`/`dialogKey`/`perform` state.
- Several inner functions require exercising the containing component or state machine rather than importing a small helper.
- Adding a provider format means editing three deeply nested `dialect === …` chains: `protocol.ts:1202/1290/1447`.

### Withdrawn C4. `/chat` is a documented frontend demo

`docs/chat-ui.md:1-14` explicitly specifies mock models, profile, history, local attachments and simulated replies, with no API or persistence. `src/app/chat/page.tsx` is public and renders that demo; no signed-in-user contract is established there. `chat-data.ts:21-225`, `chat-page.tsx:239-248` and `chat-state.ts:19` implement the documented scope. Connecting a real chat backend would be new work, not remediation of a proven defect in this scan. The existing fixture coupling is relevant only if that scope changes.

### C5. Password UX/policy is repeated; admin creation skips the minimum — Q3 / Q4

- **The validator is copied.** The same `validateStringLength({ maxLength: emailAndPassword?.maxPasswordLength, … tooLong.replace('{{max}}', …) })` block appears 7 times, plus a current-password variant at `change-password.tsx:204`. The cited lines are the `maxLength:` line:
  - `sign-in.tsx:148`
  - `sign-up.tsx:252,334`
  - `reset-password.tsx:115,197`
  - `settings/security/change-password.tsx:268,349`
- **The show/hide field is copied 8 times.** Each copy has its own visibility `useState`. The `InputGroup` alone is 33-41 lines, and ~60-80 lines with the field wrapper. Copies:
  - `sign-in.tsx:168-208`
  - `sign-up.tsx:273-313, 362-397`
  - `reset-password.tsx:136-176, 225-262`
  - `change-password.tsx:216-251, 290-323, 375-405`
- **The copies have already drifted.** `change-password.tsx` uses `emailAndPassword.maxPasswordLength` (no `?.`).
- **The policy has 4 owners:**
  - `src/lib/auth.ts:37` (`minPasswordLength: 12`)
  - `src/components/providers.tsx:72`
  - `src/lib/setup-validation.ts:15-16` ("Mirrors Better Auth's…", then `min(12).max(128)`)
  - `owner-setup.tsx:513-528`, which hard-codes `maxLength: 128, minLength: 12` and English copy instead of `localization`
- **The client maximum is 128.** The installed `@better-auth-ui/core` normalizer merges the app's options with `defaultAuthConfig.emailAndPassword.maxPasswordLength = 128`. An execution of `resolveAuthConfig` confirms 12/128 for this app. The earlier undefined-maximum claim is withdrawn.
- **The server minimum has a concrete gap.** The pinned Better Auth create-user handler checks only the maximum before hashing a supplied password, while set-user-password checks both bounds. The app's hooks add no create-user minimum check (X7 in `unused-code-findings.md`). Browser validation does not cover a direct API call.
- **Registry context.** Most duplicated password fields are copied registry code, which the project deliberately preserves. Their duplication is a maintenance cost rather than an independent violation of the registry-first rule.

### C6. Role editing UI built 3 ways; one copy is dead — Q3 / Q4

| Implementation                                                                                           | Role source                                                                     |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `user-role-cell.tsx`: Select (`:72`) + AlertDialog (`:97`)                                               | `roles: RoleView[]` prop (DB roles, including custom roles)                     |
| `admin-users.tsx:767-811` (create) and `1343-1397` (inspector): copy-pasted checkbox/radio/Select picker | DB roles                                                                        |
| `change-role-dialog.tsx`: radio dialog                                                                   | Static `roleOptions` from `access-display.ts:58`, **which has no custom roles** |

- **One copy is dead.** Nothing in `src/` imports `ChangeRoleDialog`. Its focus fallback queries `[data-access-user-id]` (`:144`), and no element in `src/` sets that attribute.
- **The rules have drifted.** Only the dead copy knows `ownerBlockedReason` (`:99`). JAR-25 changed the save rule in the inspector copy only (§6 Low).
- **Why it hurts:** readers will edit the wrong file, and self-edit, owner-block and multi-role rules already differ between the copies.

### C7. A "responses" upstream format that can never be selected — Q1 / Q4

- **It can never be returned.** `protocol.ts:1430-1432` `upstreamDialect()` is `provider === 'anthropic' ? 'anthropic' : 'chat'`, so `'responses'` is never returned. Its only callers are `protocol.ts:1438` and `gateway.ts:159, 306, 361`.
- **The comments and code claim it anyway.**
  - The file header (lines 7-8) says "three upstream dialects".
  - Upstream-Responses branches exist in `parseUpstreamResult` (`:1231`), the stream parser (`:1376`) and `renderUpstreamRequest` (`:1534`, `:1554`).
  - There is a URL ternary at `gateway.ts:308`.
- **The dead branch is also wrong.** The Responses branch of `renderUpstreamRequest` would still emit Chat-shaped `messages`, `max_completion_tokens` and `response_format` (`:1565-1582`).
- **Tests keep it alive.** `server-ml-protocol.test.ts:599-610` exercises these branches directly.

**Why it hurts:** readers maintain and trust code that never runs, and turning it on later would send invalid requests.

---

## 4. High findings

### H1. Error codes, error shapes and swallowed errors — Q5

- **There are two client allowlists.** `action-errors.ts` serves the auth and admin tables. `ml/errors.ts:7-22` serves the ML panel. Server codes are checked against one or the other, depending on the screen.
- **Server and client codes don't match.**
  - `role-service.ts:133` throws `'ROLE_IN_USE'`, but `action-errors.ts:42` allowlists `ROLE_HAS_MEMBERS`, which nothing emits (only `tests/unit/action-errors.test.ts:65` uses it).
  - `ROLE_NAME_TAKEN`, `SYSTEM_ROLE` and `INVALID_PERMISSION` (`role-service.ts:48,79,119`; `roles.ts:51,58,82`) are not allowlisted either.
  - None of this matters today, for the wrong reason: the only client of `/api/admin/roles` is `roles-manager.tsx`, which shows the **raw server message** (`:142, 149, 163, 169`) instead of calling `safeActionErrorMessage` (see H3).
  - `RATE_LIMITED` is allowlisted in `ml/errors.ts:21`. Elsewhere it falls back to the specific 429 copy.
- **One 401 condition has at least 5 codes:**
  - `UNAUTHENTICATED` (`rbac.ts:30`)
  - `SESSION_REQUIRED` (`role-service.ts:23`, `ml/admin-auth.ts:12`). This one means "bearer sent to a session-only route", so it is related but not identical.
  - `INVALID_TOKEN` (`tokens.ts:9`)
  - `UNAUTHORIZED` (`admin-guards.ts:112`)
  - `AUTH_ERROR` (`http.ts:77`)
- **Routes bypass `http.ts`:**
  - `api/health/route.ts:4-12` swallows the cause in a bare `catch` (`:9`).
  - `auth/post-login/route.ts:15` re-throws non-401 errors as raw 500s.
  - `api/auth/[...all]/route.ts` is wrapped in `handler()`, but builds its 404 body by hand (`:21, 24`).
  - `api/llm/v1/[...path]/route.ts:9-15` goes straight to `gateway.ts`, which has its own `json()` and `GatewayError`. This may be intentional, because that API is OpenAI-compatible.
- **Errors are swallowed.**
  - `src/lib/redis.ts:13`: `instance.on('error', () => {})`. Redis outages leave no log.
  - `gateway.ts:301-305` drops credential errors and silently tries the next connection.
  - `gateway.ts:225-237` is a bare `catch` around streaming. It emits a fixed `UPSTREAM_ERROR` frame and drops the cause.
  - `gateway.ts:378-402` (new in the rescan): the outer `catch` logs nothing. Any error that isn't a `GatewayError` or `ProtocolError` is reported as 502 `UPSTREAM_ERROR` "Gateway request failed". That includes DB failures in `authenticate` and the 503 `UNAVAILABLE` from `readyRedis`/`rateLimit`.
  - `discovery.ts:262-264` labels DB or transaction failures as `'credential'`.
- **The ML layer has 8 error styles:**
  - `GatewayError` (`gateway.ts:27`, unexported)
  - `ProtocolError` (`protocol.ts:20`)
  - `NetworkError` (`network.ts:26`)
  - `DiscoveryFailure` (`discovery.ts:46`, unexported; its reasons are lowercase while every other code is uppercase)
  - `HttpError` (`errors.ts:1`)
  - `SseError` (`sse.ts:21`)
  - `MlRequestError` (`ml/errors.ts:25`)
  - plain `Error`

  It also detects Zod errors by `error.name === 'ZodError'` (`gateway.ts:383`), while `http.ts:62` uses `instanceof z.ZodError`.

### H2. One concept under many names; overlapping modules; comments that lie — Q1

- **The client-facing model id has 3 names, plus a 4th helper:**
  - `publicModel` (`protocol.ts:79`)
  - `publicId` (`ml/service.ts:99`, also `ml-providers-panel.tsx:59`)
  - `poolModelId` (`model-id.ts:12`)
  - `publicModelId` (`types.ts:15-17`): the same idea under a **different formula** (`${provider}/${upstreamId}`, while `poolModelId` hashes the endpoint). Only a test calls it.
- **The provider list is declared twice:** `providerKinds` (`types.ts:1`) and `apiKeyProviders` (`validation.ts:68`). `validation.ts` even imports `providerKinds` (`:2`) and uses it at `:33`, then re-declares the same list.
- **"dialect" means two things:** the client format (`ClientDialect`, `protocol.ts:74`) and the upstream format (`UpstreamDialect`, `:1157`).
- **Permission flags have overlapping names:**
  - `canManage` means `grants.roles.includes('owner')` on `admin/roles/page.tsx:12`.
  - It means `providers:manage` plus an owner redirect on `admin/ml-providers/page.tsx:10,19`.
  - The `roles:assign` variant is called `canManageAccess` (`admin/users/page.tsx:15`).
  - Role fields are `RoleView.key/name` in one place (`roles-manager.tsx:48-50`) and `RoleDescription.id/label` in another (`access-display.ts:35-37`).
- **Six modules answer "what can role X do?":**
  - `permissions.ts`: the documented source of truth
  - `roles.ts`: Zod schema (`:28`), SQL counts (`:95`), an `AsyncLocalStorage` (`:26`) + `Proxy` (`:158`) adapter
  - `rbac.ts`
  - `role-service.ts`
  - `rbac-seed.ts`
  - `access-display.ts`
- **Some comments and names say the opposite of the code:**
  - `access-display.ts:61-83` says grants are "read from the role's live grants", but `roleGrants` reads code-only statements.
  - `grantsForRoles` (`access-display.ts:67`) has no production callers.
  - `validation.ts:6-8` says `roleInput` was removed, but it lives at `roles.ts:28`.
  - `admin-guards.ts:16` says the plugin "replaces `admin-service.ts`", but that file still exists.
- **Near-synonyms in `permissions.ts`:** `ownerOnly`, `restrictedPermissions`, `lockedRoles`, `adminRoles` (`:25, 56, 91, 94`).

### H3. Each panel has its own fetch and error policy — Q3 / Q5

There is no shared client, so three panels follow three different error policies:

| Location                                | Behavior                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ml-providers-panel.tsx:249-268`        | `request<T>()` ends with `response.json() as Promise<T>` (`:267`). Errors become `MlRequestError`, which carries only the code (`:265`).                                        |
| `roles-manager.tsx:98-173`              | Raw `fetch` with `(await response.json()) as {...}` (`:101, 138, 162`), and shows the server message directly (`setError(cause.message)` at `:149`, `setDeleteError` at `:169`) |
| Auth tables (`admin-users.tsx:165-170`) | Route errors through `safeActionErrorMessage` and say server messages must never be shown                                                                                       |

**One recovery action depends on error copy.** `ml-providers-panel.tsx:1024` (`shownDialogError.includes('Reload models')`) decides whether that button appears. The copy comes from `ml/errors.ts:12` (`MODEL_CATALOG_CHANGED`). Rewording the error removes the button.

### H4. Auth forms show errors in two different ways — Q5

- **Toast only:** `sign-up.tsx:130`, `reset-password.tsx:92` and `change-password.tsx:186` swallow submit errors and rely on the global toaster.
- **Sign-in looks inline but isn't.** `sign-in.tsx:85-91` lets the error reach `submitAuthForm` (`auth-form.tsx:129-132`). But the toaster marks it handled (`error-toaster.tsx:63`), so `auth-form.tsx:80` suppresses it. Sign-in also renders no `AuthFormServerError` slot. In practice it is toast-only like the other three, and if no toast fires, the failure is silent.
- **Inline slot:** `owner-setup.tsx` (`:399`, `:535`) is the only form that uses the inline `AuthFormServerError` slot.
- **Field resets differ** on error:
  - sign-up clears both password fields (`:77-78`)
  - sign-in clears only the password (`:56`)
  - change-password and reset-password clear nothing (change-password resets only on success, `:162`)

### H5. Copy-paste within the ML layer — Q3

- The connection-update + audit block is duplicated almost verbatim (`ml/service.ts:212-235` and `281-304`). The copies differ only in `value.baseUrl` vs `fields.baseUrl`, an `include`, and an `if (value.connection)` wrapper.
- The advisory-lock SQL is written twice (`service.ts:71`, `discovery.ts:223`).
- The "render in the client's format" ternary appears twice (`gateway.ts:341-345`, `363-367`).
- The tool-choice transform appears twice (`protocol.ts:236-245`, `389-398`).
- The "join text parts" mapping appears 6 times in `protocol.ts` (`:209, 581, 645, 656-659, 664-667, 1572`).
- The stale-row check is repeated inside `refreshConnection` (`discovery.ts:196-204`, `225-232`). The first copy checks `provider`; the second compares `encryptedCredential` against the snapshot.

### H6. Copy-paste across lib, routes and scripts — Q3

- The size-limited body reader exists 3×: `http.ts:21-34`, `profile/avatar/route.ts:17-31` and `gateway.ts:45-64`. `gateway.ts:36-37` also re-declares `http.ts`'s `json()`.
- Credential-account row creation is in `initial-owner-setup.ts:220-229` and `scripts/seed-users.ts:64-72`.
- "Find active owners" is written twice (`admin-guards.ts:101-107`, `scripts/owner.ts:23-29`). `initial-owner-setup.ts:103-117` is a variant that finds any owner and falls back to the audit log.
- The audit-row literal `{ id: randomUUID(), actorId, action: '<free string>', … }` appears 9 times:
  - `role-service.ts:60, 95, 137`
  - `initial-owner-setup.ts:390`
  - `admin-guards.ts:254`
  - `ml/service.ts:66, 272`. The `:272` copy ignores the module's own `audit()` helper.
  - `scripts/seed-users.ts:79`
  - `scripts/owner.ts:46`

  The action names are untyped (`action String` in the schema, `Record<string,string>` in `admin-guards.ts`) and mix styles: `role.create` vs `ml:connection:update`.

- The disabled Better Auth paths are listed in both `auth.ts:25-32` and `api/auth/[...all]/route.ts:10-17`.
- `scripts/seed-users.ts:36` hard-codes `pg_advisory_xact_lock(72419831)` although `SETUP_ADVISORY_LOCK` exists (`owner-bootstrap-state.ts:4`).
- The "Setup already completed" card is built twice, and the copies look different: `app/setup/page.tsx:35-58` and `owner-setup.tsx:325-343`.

### H7. Unchecked casts at trust boundaries — Q5

- **Request bodies:** `admin-guards.ts` casts the untyped request body 7 times (`:119, 128, 131, 140, 169, 222, 232`) instead of parsing it once.
- **Upstream JSON:**
  - `discovery.ts:132-136` casts upstream JSON straight to a shape.
  - `gateway.ts:347-348` re-reads the raw body via a cast, because the canonical request lacks `includeUsage`.
- **Other casts:**
  - `protocol.ts:571/614/650/1493`
  - `model-id.ts:13-14` (`as ProviderKind` twice)
  - `reset-password.tsx:70, 82` (`searchParams.get('token') as string`, parsed twice, which hides the `null` that the next line checks for)

---

## 5. Tests, Prisma, UI primitives and configs

### Measurements

- `tests/` holds 96 files and ~23k lines.
- **Largest test files:**

  | File                             | Lines |
  | -------------------------------- | ----- |
  | `auth-admin-users.test.tsx`      | 1,076 |
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
  - Assertions on class names: 27. Another 6 `querySelector('.class')` existence checks are not counted.
  - `vi.mock('@/db', …)` redefined in 17 files
  - Inline `new QueryClient` in 12 places in `tests/` (11 files)

### Findings

| Severity     | Category | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** | Q4       | **This schema field underlies C1.** `prisma/schema.prisma:67` stores comma-separated role keys without an FK/join table. Custom-key assignment and assigned-role deletion are guarded by SQL triggers (`20261018000000_roles_and_permissions:119-151`); `updateRole` changes a display name, not the stable key. Normal deletion/rename is therefore not evidence of stale user roles. Membership queries still parse strings with differing whitespace rules; no supporting membership index is declared.                                                                                           |
| High         | Q1       | **Table names mix singular and plural.** Singular: `app_user`, `session`, `account`, `verification`, `installation_setup`. Plural: `roles`, `audit_logs`, `ml_connections`, `refresh_tokens`, `owner_setup_requests`. Some indexes are named explicitly, and others (`:28`, `:42`, `:116`) use Prisma defaults.                                                                                                                                                                                                                                                                                      |
| High         | Q4       | **Several identity/reference fields are plain strings:** `AuditLog.actorId`/`targetId` (`:197`, `:199`), `MlConnection.createdBy` (`:23`), `MlGatewayKey.createdBy` (`:51`), `Session.impersonatedBy` (`:129`), `InstallationSetup.completedBy` (`:221`). `AuditLog.targetId` is intentionally polymorphic (user, role or model IDs), so a User relation would not fit. `MlConnection.provider`/`status` are strings in Prisma but constrained by SQL CHECKs; `InstallationSetup.method` has no Prisma enum. These are schema/design observations, not demonstrated orphaning or invalid-value bugs. |
| High         | Q3       | **Test harnesses are re-implemented per file.** `setup.test.ts:33-187` hand-rolls an in-memory Prisma fake, while `auth-admin-users.test.tsx:23` builds a separate auth-hook/client fake, not a Prisma fake. These doubles model different boundaries. Of the 9 `auth-ui-*.test.tsx` files, 7 define their own `makeClient` and 6 their own `renderWithAuth`, with different signatures. `vi.mock('@/db')` is redefined in 17 files.                                                                                                                                                                 |
| High         | Q1       | **Test file prefixes overlap.** `ml-protocol.test.ts` and `server-ml-protocol.test.ts` test the same module, and so do `avatar-storage` and `server-avatar-storage`. Roles are covered across 4 files. The prefixes in use are `server-`, `ml-`, `auth-ui-`, `auth-`, `admin-ui-`, `ui-`, `misc-`, `app-pages-` and `chat-`, plus files with no prefix. `misc-chrome.test.tsx` groups unrelated components.                                                                                                                                                                                          |
| High         | Q2       | **Very large test files.** `auth-admin-users.test.tsx` is 1,076 lines. `setup.test.ts` runs ~246 lines of bespoke fake infrastructure before the first `describe`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Medium       | Q4       | **Tests assert on Tailwind class strings.** Examples: `ui-admin-panel.test.tsx:346-353, 369, 379-380` (`toContain('p-xl')`, `toContain('bg-muted/50')`), `ui-primitives.test.tsx:139` (`text-destructive`) and `auth-ui-sign-up.test.tsx:296`. Some intentionally guard the token/layout contract, so their coupling is not automatically unnecessary. Others can fail after styling changes with unchanged behavior.                                                                                                                                                                                |
| Medium       | Q4       | **Heavy use of mock call counts** (46 `toHaveBeenCalledTimes`; 13 in `ml-gateway.test.ts`). The tests are tied to internal call structure.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Medium       | Q5       | **Casts hide drift between test doubles and real types.** `server-auth-config.test.ts:82` reaches into library internals with `as unknown as`. `authClient={… as never}` appears 11 times in 9 files.                                                                                                                                                                                                                                                                                                                                                                                                |
| Medium       | Q6       | **Modules without direct test imports (not a coverage verdict):** `change-role-dialog.tsx` (dead, see C6), `chat-messages.tsx`, `session-actions.tsx`, `server-table-state.ts`, `error-toaster.tsx`, `last-used-badge.tsx`, `auth-plugin.ts`, `user-status.ts`, `admin-table.ts`, `owner-bootstrap-state.ts`.                                                                                                                                                                                                                                                                                        |
| Medium       | Q4 Q3    | **The chat suite is manual-only, and the test-database guard is copied.** `playwright.chat.config.ts` has no `package.json` script and no CI step; the documented invocation is the manual command in `docs/chat-ui.md:20`. The test-DB guard regex `/^\/jarxis_test…$/` is copied in 3 places (`playwright.config.ts:5-8`, `tests/integration/setup.ts:2-5`, `tests/e2e/helpers.ts:13-14`).                                                                                                                                                                                                         |
| Low          | Q1 Q2    | **`updatedAt` is defined inconsistently.** Some models use `@updatedAt` (`:25`, `:93`), some only `@default(now())` (`:72`, `:125`, `:149`, `:162`; writers must explicitly update those timestamps), and one uses both (`:255`). `chat-state.test.ts` uses relative imports while 61 other files use `@/`.                                                                                                                                                                                                                                                                                          |

**UI files (`src/components/ui`):** registry comparison was not rerun. `admin-panel.tsx` is a substantial custom composition; the directory is not entirely registry copies. **Configs** (`next.config.ts`, Dockerfile, compose, CI, `.husky`): no quality issues beyond the bugs recorded in `unused-code-findings.md` §10. X2 is the Docker worker image, and X4 is ESLint linting local agent worktrees.

---

## 6. Medium and Low findings

### Readability (Q2)

- **Magic numbers with no named constant:**
  - 60 s cooldown (`gateway.ts:110, 371`)
  - 120 s timeout (`gateway.ts:251`, and `network.ts:76` defines its own)
  - `1048576` twice (`gateway.ts:42, 59`)
  - 15 s three times (`ml/service.ts:151,153,186`), plus the copy "within 15 seconds" (`ml/errors.ts:96`, `openapi.ts:162`, `discovery.ts:91`). A named `DISCOVERY_TIMEOUT_MS = 15000` already exists, unexported, at `discovery.ts:21`.
  - `max_tokens ?? 4096` (`protocol.ts:1502`)
  - `1e12`/`1e9` timestamp thresholds (`gateway.ts:130-134`) with no comment
  - `15000` (`ml-providers-panel.tsx:346`)
  - `86_400` (`admin-users.tsx:161`)
  - `cursor + 18` and `setInterval(…, 35)` in chat (`chat-state.ts:64`, `chat-page.tsx:87`)
  - Rate-limit budgets scattered as literals at 12 call sites:
    - `5,300`: `setup/route.ts:23`, `setup/resend/route.ts:17`
    - `10,300`: `api/v1/[...path]/route.ts:25`, `setup/verify/route.ts:16`
    - `30,60`: `setup/route.ts:18`, `auth/[...all]/route.ts:27`
    - `20,3600`: `profile/avatar/route.ts:41`
    - `60,60`: `role-service.ts:42`, `ml/admin-auth.ts:27`, `ml/gateway.ts:91`
    - `120`: `api/v1/[...path]/route.ts:48`, `auth/[...all]/route.ts:27`
    - Plus an implicit default of `20,60` (`redis.ts:23`)
  - Found in the rescan:
    - `Date.now() + 3600000` and `86400` (`discovery.ts:166`, `:63`)
    - `30 * 86400000` (`tokens.ts:48`)
    - `3600000`/`60000` (`gateway.ts:144-145`)
    - `slice(0, 60)` for chat titles (`chat-state.ts:122`)
- **Repeated string literals:**
  - `'better-auth-ui.verify-email'` (`sign-in.tsx:59`, `sign-up.tsx:83`, `verify-email.tsx:39,44`)
  - `'/auth/sign-in'` hard-coded 9 times in 8 files:
    - `settings/layout.tsx:17`
    - `auth/post-login/route.ts:16`
    - `setup/page.tsx:54`
    - `admin/layout.tsx:15`
    - `public-chrome.tsx:53`
    - `public-account-nav.tsx:23`
    - `owner-setup.tsx:270, 338`
    - `rbac.ts:113`
- **Single-letter names** (`p`, `g`, `i`, `s`, `u`, `f`, `t`) in `api/v1/[...path]/route.ts`, `rbac.ts`, `tokens.ts` and `docs-access.ts`. `api/v1/[...path]/route.ts:16-52` is a hand-rolled router on `p[0]`/`p[1]`.
- **Boolean flag parameters:**
  - `createConnection(actorId, input, deferDiscovery = false)` (`ml/service.ts:165`) and `refreshConnection(id, force = false)` (`discovery.ts:162`) are both called with a bare `true` (`api/admin/ml-providers/route.ts:20, 25`).
  - `roles-manager.tsx:105` has `open(role?, duplicate = false)`.
- **One long if-chain:** `AdditionalField` (`additional-field.tsx:124-381`, 258 lines) is mostly a ~214-line `if (inputType === …)` chain (`:167-380`). 6 of its 9 branches repeat the same inline `Field` wrapper.
- **Terse names in the chat reducer:** action names `'new'`, `'model'`, `'tick'` (`chat-state.ts:24-42`). Its `send`/`edit`/`retry` share a fall-through tail (`:101-124`), so a new action type would fall into the streaming path. Today only TypeScript narrowing at `:116-117` stops one from compiling.
- **Long functions:**
  - `initial-owner-setup.ts`: `verifyInitialOwnerSetup` 89 lines (`:330-418`), `startInitialOwnerSetup` 68 lines (`:188-255`)
  - `network.ts`: `safeFetch` 127 lines (`:422-548`)
  - `discovery.ts`: `refreshConnection` 105 lines (`:162-266`)

### Structure and testability (Q4 / Q6)

- **Layering:**
  - `ml-providers-panel.tsx:7` imports a route file (`@/app/admin/ml-providers/loading`).
  - Pages run Prisma inline (`app/admin/ml-providers/page.tsx:11-14`, `app/admin/page.tsx:17-18`).
  - The domain type `RoleView` is exported from a UI component (`roles-manager.tsx:48`) and imported by 3 other files.
- **Pure logic buried in components:**
  - the PATCH diff builder (`ml-providers-panel.tsx:476-504`)
  - the list-params builder (`admin-users.tsx:236-263`)
  - the role draft builder (`roles-manager.tsx:105-119`)

  The module-level helpers (`encodeModelStates`, `parseDiscovery`, `getBanDurationSeconds`, and now `sameRoles`) are not exported, so tests can't import them.

- **Hidden globals:**
  - `ml/service.ts`, `discovery.ts`, `gateway.ts` and `worker.ts` import the global `db`. The first three call `Date.now()` directly; `worker.ts` uses `new Date()`.
  - Role resolution depends on a module-level `AsyncLocalStorage` + `Proxy` (`roles.ts:26,158-169`). It silently falls back to code roles outside `/admin/*`.
- **Avatar API client in the providers file.** `components/providers.tsx:16-37` holds the avatar upload/delete logic, a cast, and a regex copy of the server route.
- **One provider, six edit sites.** Adding one ML provider means editing:
  - `providerKinds` (`types.ts:1`)
  - `apiKeyProviders` (`validation.ts:68`)
  - `providerHeaders` (`discovery.ts:13`)
  - `defaultBaseUrl` (`types.ts:6`)
  - `upstreamDialect` (`protocol.ts:1430`)
  - the endpoint ternary (`gateway.ts:308`)
  - plus the provider list in the OpenAPI description (`openapi.ts:162`)

### Correctness smells

- **Unreachable lines:** `network.ts:182-183` can never run, because `word2 < 0x0200` (`:181`) already covers Teredo `0x0000` and `0x0002`. This makes the blocklist harder to review. (The first scan cited `:181-182`.)
- **Dismissal guards are written differently in each dialog:**
  - In the inspector (`admin-users.tsx:1187-1190`), `onEscapeKeyDown` checks `profileInFlight.current`, but `onInteractOutside` checks only `isSavingProfile`. This is only an inconsistency: the Root `onOpenChange` guard (`:1179-1183`) still blocks an outside-click close mid-save.
  - The full "block dismissal while pending" trio is re-implemented in 5 dialogs: `admin-users.tsx:690-699, 1177-1190, 1770-1779`, `roles-manager.tsx:291-295` and `change-role-dialog.tsx:128-153`.
  - A sixth (`admin-users.tsx:1651-1663`) has only the guard and Escape.
  - 5 more repeat only the `onOpenChange` guard: `roles-manager.tsx:401`, `user-role-cell.tsx:99`, `session-actions.tsx:69` and `ml-providers-panel.tsx:829, 1197`.
- **Duplicated condition:** `admin-guards.ts:154` checks `/admin/set-role` twice. `bansTarget` (`:137-142`) can only return true when `removesOwnerAccess` (`:124-134`) already does, so `|| bansTarget(…)` at `:178` is dead. The role-array parsing is repeated at `:131-132` and `:169-170`.
- **Pass-through file:** `users-workspace.tsx` adds nothing (17 lines).

### Low

- `audit/page.tsx:94-101` and `page.tsx:114` re-annotate types that Prisma already infers.
- `permissions/page.tsx:20` uses a lowercase `table()` render function where a component is expected.
- `CanonicalMessage` has a `system` role (`protocol.ts:50`) that never reaches `messages`. The chat transform builds one at `:178`, but both parsers move it into `request.system` (`:580-583`, `:655-661`).
- **New in the rescan:**
  - **JAR-25 role compare (`admin-users.tsx:154-155`, `1048-1051`).** `sameRoles` compares length and `every(includes)`, so `['admin','admin']` compares equal to `['admin','user']`. This is a helper limitation for duplicate-containing arrays in multiple-role mode; today's `allowMultipleRoles: false` truncates comparison inputs to one item.
  - **Intentional single-role preservation.** JAR-25 preserves a multi-role user's full stored assignment when the displayed first role is unchanged (`admin-users.tsx:1046-1047`). The inspector cannot request “collapse to the same first role”; that is a control limitation, not evidence that preserving the roles is incorrect.
  - **Lint warnings.** The current source has 4 `react-hooks/exhaustive-deps` warnings in `admin-users.tsx:673, 980, 984, 1080`. The dependency arrays list method references (`form.setFieldValue`, `updateUser.reset`, `profileForm.reset`) while ESLint asks for their containing objects. The scan has not established a runtime bug or that every reference is stable. `pnpm lint` reports 20 warnings including the worktrees.

---

## 7. What was not flagged

- **Route handlers under `src/app/api/admin/ml-providers` and `api/llm`** are thin (8 files, 9-30 lines each) and delegate correctly.
- **`landing-page.tsx` and `skeletons.tsx`** are clean. `landing-page.tsx` is 16 lines. `skeletons.tsx` is 291 lines, made of 12 small components.
- **Design-token use** is lint-enforced (`eslint.config.mjs:18-46`) and was not re-audited by hand.
- **Most `src/components/ui` files** are registry copies. `admin-panel.tsx` is custom; no new upstream registry comparison was performed (§5).
