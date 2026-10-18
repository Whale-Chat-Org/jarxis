# Unused code findings

> **Remediation status (2026-10-18):** Implementation and item-by-item dispositions are recorded in [Findings remediation](findings-remediation.md). The original scan below is retained as historical evidence; its old paths, measurements and “not implemented” statements describe that snapshot. Compatibility aliases and intentional retention are documented in the resolution matrix.

|          |                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot | `chore/findings-rescan` @ `1afce0d` (same commit as `main`), 2026-10-17                                                            |
| Scope    | Inventory of 400 tracked files; import/export scan of `src/`, `scripts/`, tests and configs; cited docs, SQL and assets rechecked  |
| Purpose  | List what is unnecessary. **No removal is done or proposed here.** The "Also referenced by" notes show what a removal would touch. |

**Required naming change:** The project owner requires **ML providers → Providers** across the feature, including UI copy, files, components/functions, routes and supporting references. [REQ-PROVIDERS-01](code-consistency-findings.md#required-rename-providers) contains the current-to-required mappings and completion criteria. Current paths and identifiers below describe the scanned code; the rename is documented, not implemented.

---

## 1. How "unnecessary" was decided

### 1.1 Definitions

| Term                     | Meaning                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dead file**            | No production code path can reach the file from an entry point.                                                                               |
| **Dead in production**   | Only tests reach it. The tests keep it "covered", but users never run it.                                                                     |
| **Runtime-unreachable**  | The code is imported, but the configuration means it never renders or runs. Example: a branch for a Better Auth plugin that isn't registered. |
| **Dead export**          | An exported name that nothing outside its own file uses.                                                                                      |
| **Unnecessary `export`** | A name used only inside its own file. Only the `export` keyword is unnecessary.                                                               |
| **Unreachable code**     | A branch or condition that can never run, because an earlier check already decides the outcome.                                               |
| **Stale reference**      | A doc, comment or config entry that names a file, symbol, feature or path that no longer exists.                                              |

### 1.2 Entry points (what counts as "used")

**Production:**

- Next.js file conventions under `src/app`: `page`, `layout`, `route`, `loading`, `error`, `icon`, …
- Every file run by a `package.json` script.
- `next.config.ts`, `prisma.config.ts`, `postcss.config.mjs` and `eslint.config.mjs`.
- Files named in `Dockerfile`, `compose*.yaml` and CI.

**Tests:** everything under `tests/**`, plus the Vitest and Playwright configs.

### 1.3 Method

The original scan at `b3329bb` made two independent passes and then cross-checked them. The current rescan at `1afce0d` is described below; the original AOCI authoring pass was not repeated.

**Pass 1: mechanical scan.** `knip` and `ts-prune` are not installed and nothing was downloaded, so this pass used the TypeScript API already in `node_modules`.

1. **Import graph.** Built with the compiler API, using the `@/` alias from `tsconfig.json`. It follows static imports, re-exports, dynamic `import()`, `require`, `vi.mock`/`importActual`, `import type` and CSS `@import`. Anything reachable only from test entries is marked _dead in production_.
2. **Export references.** The language service ran find-references on all exports (633 named exports rechecked in the current scan, excluding defaults and reserved Next.js exports) in `src/` and `scripts/`. Each reference was classified as same file, live production, dead file or tests only. Reserved Next.js exports (`default`, `metadata`, `GET`, …) were skipped.
3. **Deletion simulation.** Candidate files were dropped in memory and the project was type-checked again. This caught one false positive (§9).
4. **Unused locals.** Ran `tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters` with both TS 7 and TS 6, plus ESLint `no-unused-vars`.
5. **Dependencies.** Each dependency was checked against imports, configs, scripts and peer dependencies.
6. **Docs and error codes.** Paths and identifiers named in tracked Markdown were checked against the tree. Allowlisted error codes were checked against what the code actually emits.

**Pass 2: AOCI index read-through.** Building the AOCI index (§11) meant reading every one of the 277 indexed files in full and writing an entry for each. Anything unnecessary seen during that read was recorded. This pass is what found the runtime-unreachable registry branches and the unused design tokens.

**Verification.** Every item below was grepped across `src`, `scripts`, `tests`, `docs`, `.agents` and configs, and the main ones were re-read by hand. One claim from pass 2 turned out to be wrong and was dropped: `@typescript/native` provides the `tsc` that `pnpm typecheck` runs, so it is used.

**Confidence:** **Confirmed** means no reference or path exists. **Likely** means only indirect references remain, or the item is registry code kept deliberately generic.

**Current rescan (2026-10-17).** Rebuilt the TypeScript import graph and language-service export references from tracked files, remeasured 210 source/script/style files (26,594 lines) and 96 test files (23,053 lines), and re-opened the reported configuration gates, stale references and changed code. The graph still finds F1–F3, plus the required ambient augmentation in §9. In-memory deletion again gives 0 errors without F1 and 38 without `auth-plugin.ts`. Both `pnpm exec tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters` (TS 7.0.2) and `pnpm exec tsc6 --noEmit --incremental false --noUnusedLocals --noUnusedParameters` (TS 6.0.3 compiler API) pass. `pnpm lint` exits 0 with 20 warnings: 4 in the current source and 16 in four local worktrees.

**Changes to the findings.** JAR-24 fixed X1. R6 is withdrawn because the admin API permits credentialless accounts; that branch is reachable. Internal uses of the auth-plugin types and dialog overlays/portals are now distinguished from unused exports. F5's tracked assets total 56,760 bytes, not ~120 KB. X6 and X7 record source-confirmed guard and password-policy gaps; X6 was also checked with an isolated invocation of the actual application guard using an in-memory database double. No application files, database records or dependencies were changed; no live HTTP, browser or Docker reproduction was run.

---

## 2. Summary

| Kind                                                     | Count                     | Lines                                                                                                 |
| -------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Dead files (production)                                  | 3                         | 543                                                                                                   |
| Runtime-unreachable files (imported, never rendered)     | 5                         | 1,222                                                                                                 |
| Dead code inside live files                              | 10 sites + 9 dead exports | ~130                                                                                                  |
| Inert registry branches (R3–R5, R7)                      | 4 groups                  | ~150                                                                                                  |
| **Total that never runs in production**                  |                           | **~2,000** (about 8 % of the 24,636 TypeScript lines in `src/`; approximate, with overlapping groups) |
| Tests that only exercise dead code                       | 2 places                  | ~112                                                                                                  |
| Unused dependency                                        | 1 confirmed               |                                                                                                       |
| Unused design tokens                                     | 4                         |                                                                                                       |
| Stale docs, comments and config entries                  | 18                        |                                                                                                       |
| Unused locals or parameters                              | **0**                     |                                                                                                       |
| Commented-out code, TODO, `@ts-ignore`, `eslint-disable` | **0**                     |                                                                                                       |

**Found in passing (not dead code):** 2 open security findings (X6–X7), 2 bugs (X2–X3), a tooling issue (X4), duplication (X5), and the fixed historical security finding X1 (§10).

---

## 3. Dead files

| #   | File                                               | Lines | Reached from                                                      | Also referenced by                                              | Confidence                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------- | ----- | ----------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | `src/components/admin/change-role-dialog.tsx`      | 267   | Nothing                                                           |                                                                 | Confirmed. Dropping it causes 0 type errors. Its last user was removed in `252f00b`. Its focus fallback queries `[data-access-user-id]`, which nothing sets.                                                                                 |
| F2  | `src/lib/access-display.ts`                        | 170   | Only F1 (dead) and `tests/unit/access-display.test.ts` (84 lines) | `docs/ml-providers.md:23`                                       | Confirmed. Its header describes an "access directory / change-role dialog / role guide" that no longer exists.                                                                                                                               |
| F3  | `src/components/ui/pagination.tsx`                 | 106   | Only `tests/unit/ui-primitives.test.tsx:228-260`                  | `scripts/registry-drift.ts` ITEMS, `docs/REFERENCE.md:210`      | Confirmed, low priority (shadcn copy). `PaginationSkeleton` is a different, live component.                                                                                                                                                  |
| F4  | `src/components/admin/users-workspace.tsx`         | 17    | `src/app/admin/users/page.tsx`                                    | `admin-ui-shell.test.tsx`, a mock in `app-pages-admin.test.tsx` | Likely. A pure pass-through to `<AdminUsers>` with identical props.                                                                                                                                                                          |
| F5  | `public/brand/**` (24 tracked files, 56,760 bytes) |       | Nothing in `src`, `tests` or `docs`                               | Output of `scripts/generate-brand.mjs`                          | Likely. The app inlines the mark and serves `src/app/icon.svg`, `favicon.ico` and `apple-icon.png`. `public/` is also left out of the Docker build context. `src/app/icon.svg` is byte-identical to `public/brand/jarxis-mark-adaptive.svg`. |

---

## 4. Runtime-unreachable code

This code is imported, but it never renders or runs with the current configuration. It is mostly registry code, so it is **Likely** rather than Confirmed. It is kept generic on purpose, and removing it would widen drift from the registry.

| #   | Location                                                                                                                                                                                                                                                                                                                        | Lines | Why it never runs                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `src/components/auth/additional-field.tsx`                                                                                                                                                                                                                                                                                      | 630   | Renders only when `additionalFields` is configured. Neither `providers.tsx` nor `auth.ts` configures any. Only `auth-ui-additional-field.test.tsx` renders it. |
| R2  | `src/components/ui/calendar.tsx` (180), `combobox.tsx` (282), `popover.tsx` (73), `slider.tsx` (57)                                                                                                                                                                                                                             | 592   | Their only `src` importer is R1. `combobox.tsx` is the only user of the `@base-ui/react` dependency, and `calendar.tsx` the only user of `react-day-picker`.   |
| R3  | `auth-form.tsx:251-275, 306-321` (`AuthFormAdditionalField`, `getAuthAdditionalFieldValidators`)                                                                                                                                                                                                                                | ~40   | Same reason as R1.                                                                                                                                             |
| R4  | `src/lib/auth/two-factor-methods.ts`, `use-sign-in-continuation.ts:33-45`                                                                                                                                                                                                                                                       | ~40   | No two-factor plugin is registered on the client (`providers.tsx:49-60`) or the server.                                                                        |
| R5  | Inert registry branches for plugins that aren't registered:<br>- `auth.tsx:29, 66-84, 106-116` (`PASSWORD_ONLY_VIEWS`, `fallbackViews`)<br>- `error-toaster.tsx:9, 54-56` (one-tap)<br>- `account-settings.tsx:33-41` (magic link)<br>- `sign-in.tsx:4-7, 19, 66` (passkey, captcha)<br>- `user-button.tsx:3-5` (multi-session) | ~60   | Only the theme and admin plugins are registered.                                                                                                               |
| R7  | `sign-up.tsx:33-37, 87-88` (`onSignUpSuccess`, the non-verification redirect)                                                                                                                                                                                                                                                   | ~8    | `requireEmailVerification` is always `true`. Only tests pass `onSignUpSuccess`.                                                                                |

**Withdrawn R6 — `SetPassword` is reachable.** `change-password.tsx:55-58, 71-136` handles accounts without a credential. Better Auth 1.7.7's `admin/create-user` accepts an omitted password and links a credential account only when one is supplied (`dist/plugins/admin/routes.mjs:122-127, 203-210`). OAuth removal does not prove all accounts have credentials.

---

## 5. Dead code inside live files

| #   | Location                                                     | Lines | What                                                                                                                                                                                                                                 | Confidence |
| --- | ------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| D1  | `src/lib/ml/protocol.ts`, `gateway.ts:308`                   | ~80   | **The "responses" upstream dialect can never be selected.** `upstreamDialect()` (`protocol.ts:1430-1432`) returns only `'anthropic'` or `'chat'`. Branches listed below.                                                             | Confirmed  |
| D2  | `src/lib/auth/admin-guards.ts:137-142, 178`                  | 8     | `bansTarget()` can never change the result. `ban-user` is already in `ACCESS_REMOVING_PATHS`, and `update-user` with `banned: true` is already handled by `removesOwnerAccess()` (`:124-129`). So `\|\| bansTarget(…)` adds nothing. | Confirmed  |
| D3  | `src/lib/auth/admin-guards.ts:154`                           | 1     | `&& path !== '/admin/set-role'` is redundant, because `GUARDED_PATHS` (`:33`) already contains it.                                                                                                                                   | Confirmed  |
| D4  | `src/lib/ml/network.ts:182-183`                              | 2     | The Teredo (`0x0000`) and benchmarking (`0x0002`) checks can never match, because `word2 < 0x0200` on `:181` already returns for both.                                                                                               | Confirmed  |
| D5  | `src/lib/ml/protocol.ts:1467`                                | 1     | The `system` role branch in the Anthropic renderer can't be reached, because the parsers move system text into `request.system`.                                                                                                     | Likely     |
| D6  | `src/lib/action-errors.ts:42`                                | 1     | `ROLE_HAS_MEMBERS` is allowlisted but never emitted. The app throws `ROLE_IN_USE` instead (`role-service.ts:133`), and that code is not allowlisted.                                                                                 | Confirmed  |
| D7  | `src/components/chat/chat-data.ts:4`, `chat-composer.tsx:84` | 2     | `ChatAttachment.file` is stored on every attachment and never read.                                                                                                                                                                  | Confirmed  |
| D8  | `src/components/landing/landing-page.tsx:16`                 | 1     | `export default LandingPage` duplicates the named export. `src/app/(public)/page.tsx` imports the named one.                                                                                                                         | Confirmed  |
| D9  | `src/components/ui/admin-panel.tsx:137`                      | 1     | A useless trailing `return`.                                                                                                                                                                                                         | Confirmed  |
| D10 | `scripts/registry-drift.ts:393-396`                          | 4     | An orphaned doc comment for `REVIEWED` sits above the `OMITTED` block.                                                                                                                                                               | Confirmed  |

**D1 dead branches in detail:**

| Location                                                                     | Lines | Dead part                                                          |
| ---------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `protocol.ts:1157`                                                           |       | `'responses'` in `UpstreamDialect`                                 |
| `protocol.ts:7-8`                                                            |       | Header comment says "three upstream dialects"                      |
| `parseUpstreamResult`, `protocol.ts:1231-1253`                               | 23    | The `else` branch                                                  |
| `createUpstreamStreamParser`, `protocol.ts:1376-1424`                        | 49    | The `else` branch                                                  |
| `renderUpstreamRequest`, `protocol.ts:1544-1550` and `:1556`                 |       | The non-chat tool shape and `tool_choice`                          |
| `gateway.ts:308`                                                             |       | The `dialect === 'responses' ? 'responses'` arm of the URL ternary |
| `server-ml-protocol.test.ts:590-610, 708-732`; `ml-protocol.test.ts:335-356` |       | Tests that cover only these branches                               |

The **client-facing** Responses API is live and is not part of this finding: `parseResponsesRequest`, `createResponsesStreamRenderer` and `/api/llm/v1/responses`.

---

## 6. Unused exports

### 6.1 Unused everywhere

| Location                                         | Name                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| `src/lib/permissions.ts:53`                      | `AdminPermission` (type)                        |
| `src/lib/ml/service.ts:118-119`                  | `ConnectionDto`, `GatewayKeyDto` (types)        |
| `src/lib/setup-validation.ts:30, 34`             | `SetupVerifyInput`, `SetupResendInput` (types)  |
| `src/components/auth/auth-form.tsx:279-280`      | `withAuthFieldGroup`, `withAuthForm` (registry) |
| `src/components/ui/message-scroller.tsx:124-126` | `useMessageScroller*` re-exports (registry)     |

### 6.2 Dead in production (used only by tests)

| Location                                    | Name                                                                                                        | Note                                                                                                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ml/types.ts:15-17`                 | `publicModelId`                                                                                             | Uses a **different formula** from the real `poolModelId()` in `model-id.ts`, so it is dead and misleading.                                                                                                       |
| `src/components/skeletons.tsx:148-166`      | `RoleCardsSkeleton`                                                                                         | Its last user was removed in `252f00b`. Still listed in `design-system.md:150`.                                                                                                                                  |
| `src/components/admin/nav-items.ts:89`      | `NAV_ITEMS`                                                                                                 | The app uses `NAV_GROUPS` / `visibleNavGroups`.                                                                                                                                                                  |
| `src/lib/access-display.ts`                 | `grantsForRoles`, `guideCategories`, `splitRoleValue`, `describeRoles`, `roleOptions`, `ownerBlockedReason` | The whole file is dead (F2).                                                                                                                                                                                     |
| `src/lib/auth/two-factor-methods.ts:52-75`  | `readTwoFactorMethods`, `clearTwoFactorMethods`                                                             | See R4.                                                                                                                                                                                                          |
| `src/components/auth/auth-form.tsx:104-119` | `runAuthFormAction`                                                                                         | Registry code.                                                                                                                                                                                                   |
| `src/components/ui/**`                      | 71 sub-exports                                                                                              | Examples: all of pagination; dropdown Sub/Radio/Checkbox/Shortcut; sidebar Group/MenuSub/Input/Badge/Separator; combobox Chips/Group; popover Header/Title. This is expected for registry copies (low priority). |

### 6.3 Used only in their own file

For these names, only the `export` keyword is unnecessary.

| Location                                                           | Name                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ml/errors.ts:53`                                          | `discoveryFailureReasons`                                                                                                                                           |
| `src/lib/roles.ts:68, 140`                                         | `storedPermissions`, `loadLiveRoles`                                                                                                                                |
| `src/lib/ml/validation.ts:68`                                      | `apiKeyProviders`. It also duplicates `providerKinds` (`types.ts:1`) verbatim.                                                                                      |
| `src/lib/ml/service.ts:107`                                        | `gatewayKeyDto`                                                                                                                                                     |
| `src/lib/ml/protocol.ts:296, 430`                                  | `chatCompletionsRequest`, `responsesRequest`                                                                                                                        |
| `src/components/skeletons.tsx:63`                                  | `TableRowsSkeleton`. `design-system.md:153` claims the users table renders it, but `admin-users.tsx` uses its own `UserRowsSkeleton`.                               |
| `src/components/auth/auth-form.tsx:86, 90, 121`                    | `clearAuthFormServerError`, `clearAuthFormFieldServerError`, `submitAuthForm`                                                                                       |
| `src/lib/permissions.ts:96`                                        | `roleStatements`. Its only outside user is the dead `access-display.ts`.                                                                                            |
| `src/lib/auth/auth-plugin.ts:14, 19, 24`                           | `AuthViewProps`, `SettingsViewProps`, `AuthPlugin`. All are used inside the required module augmentation; their export surface is unused, not the types themselves. |
| `src/components/ui/dialog.tsx:140-141`, `alert-dialog.tsx:175-176` | `DialogOverlay`, `DialogPortal`, `AlertDialogOverlay`, `AlertDialogPortal`. Each implementation is used internally; only the exports lack consumers.                |
| ~60 types                                                          | Mostly `*Props` in `src/components/auth/**` (registry convention) and `Canonical*` types in `ml/*`                                                                  |

---

## 7. Dependencies and design tokens

| Item                                                                                                                     | Status                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@radix-ui/react-slot` (`package.json:40`)                                                                               | **Unused (Confirmed).** Nothing imports it. `Slot` comes from the `radix-ui` umbrella package.                                                                                                                                                                                                       |
| `@base-ui/react`, `react-day-picker`                                                                                     | Used only by `combobox.tsx` and `calendar.tsx`, which never render (R2). Likely unnecessary while R1 stays unconfigured.                                                                                                                                                                             |
| `@utility h-inspector`, `@utility grid-rows-inspector` (`src/styles/tokens.css:473-480`), `--spacing-inspector` (`:169`) | **Unused (Confirmed).** No component uses them; only `grid-rows-inspector-form` is used. They are also listed in `design-system.md:89, 128` and in the theme test.                                                                                                                                   |
| `--spacing-col-icon` (`tokens.css:164`)                                                                                  | **Unused (Confirmed).** It is registered in `utils.ts:58` `designTokens`, but no component uses `*-col-icon`.                                                                                                                                                                                        |
| Kept on purpose                                                                                                          | `@typescript/native` provides `tsc` for `pnpm typecheck`. `clsx`, `tailwind-merge`, `pg`, `react-dom` and `@testing-library/dom` are peer dependencies. `@tailwindcss/postcss`, `jsdom`, `@vitest/coverage-v8`, `husky`, `lint-staged`, `tsx` and `prettier-plugin-tailwindcss` are used by configs. |

---

## 8. Stale docs, comments and config entries

### 8.1 Docs and agent rules

| Location                                  | What is stale                                                                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/REFERENCE.md:63, 74`                | Documents `GET /api/v1/users` and "users, user-role assignments, custom roles, permission catalog, and audit logs under `/api/v1`". `api/v1/[...path]/route.ts` serves only `auth/login\|refresh\|logout` and `GET me`. |
| `docs/REFERENCE.md:164`                   | Says CI "runs on pull requests to `main`". `ci-cd.yml` runs only on push to `main` and `workflow_dispatch`.                                                                                                             |
| `docs/REFERENCE.md:213`                   | Names the `@better-auth-ui/admin` package. It is not a dependency; the views are copied into `src/components/auth/admin`.                                                                                               |
| `docs/TECH.md:242`                        | Says "pnpm 11.19.0". `package.json` pins `pnpm@12.8.1`.                                                                                                                                                                 |
| `docs/TECH.md:164-176`                    | The data-model table is missing `ml_connections`, `ml_models`, `ml_gateway_keys` and `owner_setup_requests`, and it still describes `Account` as external-provider data.                                                |
| `docs/PRD.md:83-84`                       | Says account holders can inspect linked accounts. That UI was removed with OAuth.                                                                                                                                       |
| `docs/PRD.md:163`                         | Lists runtime creation or editing of roles as out of scope. That contradicts `PRD.md:95` and the shipped custom-roles feature.                                                                                          |
| `docs/ml-providers.md:23`                 | Cites a "Managing ML providers" row in the role guide. That row exists only in the dead `access-display.ts:139`.                                                                                                        |
| `.agents/rules/design-system.md:150, 153` | Lists `RoleCardsSkeleton` (dead) and `TableRowsSkeleton` (internal only) as shared blocks, and says the users table renders the latter.                                                                                 |
| `.agents/rules/design-system.md:187`      | Lists `provider-button(s)`, `linked-accounts` and `linked-account` as installed in `src/components/auth`. None of those files exist.                                                                                    |
| `tests/e2e/README.md:3`                   | Hard-codes one developer's absolute path.                                                                                                                                                                               |

### 8.2 Code comments and migrations

| Location                                                         | What is stale                                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/validation.ts:6-8`                                      | Says `roleInput` was removed. It lives at `src/lib/roles.ts:28` and backs both `/api/admin/roles` routes.                                       |
| `src/lib/admin-service.ts:7-10`                                  | Says the `roles`, `permissions` and `role_permissions` tables are gone. Migration `20261018000000_roles_and_permissions` re-created them.       |
| `prisma/schema.prisma:65-66`                                     | Says `role` holds "code-declared role names". It now also holds owner-created `custom_<uuid>` keys.                                             |
| `src/app/(public)/auth/layout.tsx:6-8`                           | Lists a "callback" view. `/api/auth/callback*` is blocked and OAuth is removed.                                                                 |
| `prisma/migrations/20261003010000_ml_providers/migration.sql:19` | The provider `CHECK` still allows `'codex'` and `'claude'`. `20261010000000_remove_oauth` deleted those rows but never narrowed the constraint. |

### 8.3 Config entries that point at nothing

| Location                                                                                                          | What is stale                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/generated` in `.gitignore:20`, `.prettierignore:8`, `eslint.config.mjs:210` and `sonar-project.properties:5` | Four ignore and exclude entries for a directory that is never created. The Prisma generator has no `output`, so nothing is written there. |
| `pnpm-workspace.yaml:15-17`                                                                                       | `ignoredOptionalDependencies: drizzle-orm, drizzle-kit` repeats the `'-'` overrides already on lines 9-11.                                |

---

## 9. Looks unused, but keep it

| Item                                                                                                                     | Why it must stay                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/auth/auth-plugin.ts`                                                                                            | No file imports it, but its `declare module '@better-auth-ui/core'` augmentation reaches the build through tsconfig `include`. Dropping it causes **38 type errors**. |
| `scripts/generate-brand.mjs`                                                                                             | A documented manual tool with no `package.json` script. It produces `src/app/icon.svg` and the other icons.                                                           |
| `@typescript/native`                                                                                                     | `node_modules/.bin/tsc` runs it, so `pnpm typecheck` depends on it.                                                                                                   |
| Test-only exports also used internally (`isBlockedAddress`, `workerTick`, `assertOrigin`, `parseSender`, `tokenHash`, …) | Deliberate test seams, not dead code.                                                                                                                                 |
| Test helpers (`server-only.ts`, `setup-dom.ts`, `integration/setup.ts`, `e2e/brevo-stub.ts`)                             | Referenced by the Vitest and Playwright configs.                                                                                                                      |

---

## 10. Found in passing: not dead code, but needs attention

| #   | Severity            | Finding                                                                                                                                                                                                                                                                                                                                                                                                                     | Status                                                                                                                                                                                                          |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | **High (security)** | **An administrator may be able to set an owner's password.** The owner check ("only owners may modify an owner") runs only for `GUARDED_PATHS` (`admin-guards.ts:32-40`). That set omits `/admin/set-user-password`, although `AUDIT_ACTIONS` (`:54`) knows about the endpoint, and the Administrator role holds `user:set-password` (`permissions.ts:108`).                                                                | **Fixed** in JAR-24 (Whale-Chat-Org/jarxis#25): Better Auth's handler checks only the caller's grant, so the path was added to `GUARDED_PATHS` with a regression test. Not reproduced against a running server. |
| X2  | Medium (bug)        | **The Docker worker image can't start the ML worker.** `.dockerignore` allows only `migrate.ts`, `seed.ts` and `owner.ts` from `scripts/`. The `worker` stage (`Dockerfile:42-44`, `compose.yaml` `ml-worker`) runs `pnpm ml:worker`, which runs `tsx scripts/ml-worker.ts`, so the file is missing from the image.                                                                                                         | Confirmed by reading. The image was not built.                                                                                                                                                                  |
| X3  | Low (bug)           | **The password strength meter shows only the "weak" colour.** The fair, good and strong segments use `bg-amber-500`, `bg-sky-500` and `bg-emerald-500` (`password-strength-meter.tsx:15-17`). `tokens.css:99` clears the palette with `--color-*: initial`, so those classes produce no colour. The lint ban misses them because they sit in an object literal, and `auth-ui-sign-up.test.tsx:296` asserts the class names. | Confirmed by reading. Not checked in a browser.                                                                                                                                                                 |
| X4  | Low (tooling)       | **`pnpm lint` also lints local agent worktrees.** `eslint.config.mjs:208-217` does not ignore `.claude/**`. The current run reports 20 warnings: 4 in this checkout and 16 across four worktrees. The original 608/919 file count was not reproduced and is no longer a current measurement.                                                                                                                                | Local only.                                                                                                                                                                                                     |
| X5  | Low (duplication)   | **The disabled Better Auth path list exists 3×:** `auth.ts:25-32`, `api/auth/[...all]/route.ts:10-19` and `openapi.ts:10-21`.                                                                                                                                                                                                                                                                                               | Confirmed                                                                                                                                                                                                       |

| X6 | **High (security)** | **Owner invariants are checked for one mutation shape but bypassed by others.** `admin-guards.ts:124-133, 168-173` handles role removal/granting only for `/admin/set-role`; `/admin/update-user` only treats `data.banned === true` as access removal. Better Auth 1.7.7 accepts `data.role` and checks `user:update` + `user:set-role` (`dist/plugins/admin/routes.mjs:252-274, 304`), so an owner can demote the last owner or grant Owner to an unverified/banned target through that endpoint. `data.emailVerified: false` can also deactivate the last owner without the count check. `/admin/create-user` is outside `GUARDED_PATHS` and can create an unverified owner. Nested role changes are omitted from `auditChanges` (`:229-234`). | Source-confirmed. An isolated execution of the actual application guard rejects the equivalent set-role requests with `LAST_OWNER`/`INACTIVE_OWNER`, but allows the update-user variants, unverifying the last owner and creating an inactive owner. The test double does not execute Better Auth's handler, SQL or HTTP. Its role-permission checks remain intact: this is not evidence that a non-owner can assign Owner. |
| X7 | **High (security)** | **Admin user creation does not enforce the 12-character password minimum.** The app config sets `minPasswordLength: 12` (`auth.ts:37`), but Better Auth 1.7.7's create-user handler calls only `assertPasswordNotTooLong` before hashing/linking the supplied password (`dist/plugins/admin/routes.mjs:194, 203-210`). The app has no create-user password check in `admin-guards.ts:32-42` or its database hooks. The separate set-user-password handler checks both bounds (`routes.mjs:828-829`). | Confirmed by following the pinned package handler and application hooks. The admin create form (`admin-users.tsx:744-759`) also sets only `required`, with no minimum validator. A caller with `user:create` can supply a shorter nonempty password; browser and HTTP paths were not exercised. Not reproduced through HTTP or a real database. |

---

## 11. Historical AOCI index build

The original scan also built the AOCI repository index on branch `chore/aoci-index`, using aoci 0.1.0-rc21 in host-agent mode. No AI endpoint or API key was used.

| Fact                     | Value                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Entries                  | 277 / 277 indexed files, written in 11 batches (one repair round)                    |
| Skipped                  | 20 binary app/brand assets (18 brand PNGs plus the app PNG and ICO; no Entry needed) |
| Whole-index size         | ~30.5k tokens                                                                        |
| `aoci verify`            | Structure valid; 0 scale mismatches                                                  |
| `aoci check`             | ✓ ready to commit. C7+ Entries with S: 49/50.                                        |
| `aoci index agent guide` | `stage: aligned`, `next_action: none`                                                |
| `aoci index score`       | Not supported for this index layout (`volumes-v1`): returns `error_code: config`     |

Files added by `aoci init`:

- `aoci.txt`, `aoci.meta.txt`, `aoci.code.txt`
- `.aoci/` (formal assets: `config.json`, `baseline.json`, `curation.json`)
- `.gitattributes` (forces LF line endings)
- A 104-line managed block appended to `AGENTS.md`
- An untracked `AGENTS.md.backup.<timestamp>.<hash>`, which shouldn't be committed

The current rescan loaded all 278 formal entries in five chunks (about 30.6k estimated tokens) with delivery confirmed. The strict challenge was partial (7/10), so complete cognition verification remains unfinished; the pre-existing report edit also made governance dirty. Findings above rely on current source and compiler evidence. The historical build results in this section are not new validation results.
