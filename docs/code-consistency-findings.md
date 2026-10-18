# Code consistency findings

> **Remediation status (2026-10-18):** Implementation and item-by-item dispositions are recorded in [Findings remediation](findings-remediation.md). The original scan below is retained as historical evidence; its old paths, measurements and “not implemented” statements describe that snapshot. Compatibility aliases and intentional retention are documented in the resolution matrix.

|          |                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot | `chore/findings-rescan` @ `1afce0d` (same commit as `main`), 2026-10-17                                                               |
| Scope    | File/module names, component and function names, identifiers, error codes, behavior contracts, test naming and schema conventions     |
| Purpose  | Record inconsistent conventions and meanings with current source evidence. No renames, code changes or new naming policy are applied. |

## Required rename: Providers

**REQ-PROVIDERS-01 — Required by the project owner, 2026-10-17.** Rename the entire **ML providers** feature to **Providers** consistently. This is an explicit implementation requirement, separate from the scan's inferred findings. It is recorded here; the application rename has not been implemented in this documentation task.

The requirement covers user-facing copy, file and directory names, exported components, functions, types, routes, scripts, tests and documentation. Current source paths and symbol names elsewhere in these reports remain evidence of the scanned snapshot; they are not the required final names.

| Surface                              | Current naming                                                    | Required naming                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Feature name and UI copy             | `ML providers`, `ML provider`, provider-specific “ML” labels      | `Providers`, `Provider`, with matching sentence case in descriptions                                           |
| Feature documentation                | `docs/ml-providers.md` and links to it                            | `docs/providers.md` and updated links/headings                                                                 |
| Management component                 | `src/components/admin/ml-providers-panel.tsx`, `MlProvidersPanel` | `src/components/admin/providers-panel.tsx`, `ProvidersPanel`                                                   |
| Admin page segment and navigation    | `src/app/admin/ml-providers/`, `/admin/ml-providers`              | `src/app/admin/providers/`, `/admin/providers`                                                                 |
| Management API and clients           | `src/app/api/admin/ml-providers/`, `/api/admin/ml-providers`      | `src/app/api/admin/providers/`, `/api/admin/providers`, including nested endpoints and generated documentation |
| Domain module namespace              | Provider-feature code under `src/lib/ml/`                         | `src/lib/providers/`, with all imports updated                                                                 |
| Owner guard                          | `requireMlOwner`                                                  | `requireProviderOwner`, matching the singular-domain `requireRoleOwner` convention                             |
| Domain types / Prisma models         | `MlConnection`, `MlModel`, `MlGatewayKey`                         | `ProviderConnection`, `ProviderModel`, `ProviderGatewayKey`, with regenerated types and callers                |
| Worker entry, command and service    | `scripts/ml-worker.ts`, `ml:worker`, `ml-worker`                  | `scripts/providers-worker.ts`, `providers:worker`, `providers-worker`, including Docker/compose/CI references  |
| Feature tests                        | `admin-ui-ml-providers.test.tsx` and feature references/mocks     | `admin-ui-providers.test.tsx` and matching Providers references/mocks                                          |
| Provider-management audit vocabulary | `ml:connection:*`, `ml:model:*`                                   | `providers:connection:*`, `providers:model:*` for new events, with historical events still interpretable       |

**Completion criteria:**

1. Providers is the feature name throughout navigation, headings, dialogs, errors and documentation; related files, components, functions and test descriptions use the same vocabulary.
2. Update callers, import paths, route links, OpenAPI, registry drift metadata, scripts, worker/container configuration and tests together. Each current-to-required mapping above must be accounted for.
3. Route/API changes need an explicit compatibility decision for existing bookmarks and clients. Model/table naming must use a reviewed versioned migration when physical SQL names change; Prisma `@map`/`@@map` names and existing data are not renamed by blind text replacement.
4. Preserve stored credentials, public model IDs and historical audit interpretation across the rename; any persisted string used as an identifier or encryption context needs compatibility treatment.
5. Verify the resulting imports/types, API/navigation behavior, registry exceptions, worker startup and affected tests. Existing `providers:read`, `providers:manage`, `providerKinds` and `ProviderKind` already use the required vocabulary.

## Required reusable admin components

**REQ-ADMIN-TABLE-01** requires one reusable admin table contract and a catalog gathering each page's columns, query parameters/defaults, result states and permitted actions. **REQ-ADMIN-FORM-01** requires the existing admin detail/edit panel and form lifecycle to be shared across **Users, Roles and Providers**, using consistent **view, create and edit** modes; update is the submit operation. Audit and Permissions remain read-only.

The project owner confirmed documentation first. The [page inventory, shared contracts and completion criteria](redundant-code-findings.md#required-admin-table-and-form-reuse) are the canonical requirements. Apply the Providers naming requirement above to the future shared definitions and feature adapters. No reusable component has been implemented in this audit.

## 1. Method and ranking

The scan used the tracked-file inventory, TypeScript symbols/import references and targeted reads of each implementation and its callers. File names were compared with their exported symbols and actual responsibilities. Similar functions were compared by inputs, output shape, side effects and error behavior, not just spelling.

**High** means inconsistent behavior crosses an authorization or password-policy boundary. **Medium** means a name or convention obscures a material contract or allows parallel implementations to drift. **Low** means discoverability or style friction without an established correctness issue. Observed conventions are not presented as repository rules unless a written rule exists.

The common naming scheme is already coherent: kebab-case source files, PascalCase React components/types, camelCase functions and framework-reserved route file names. Different casing between `user-role-cell.tsx` and `UserRoleCell` is intentional. The findings concern inconsistent meaning, ownership or behavior within that scheme.

## 2. File names and module responsibilities

| ID  | Priority | File / current meaning                                                                                              | Consistency finding                                                                                                                                                                                                                                                                         |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Medium   | `src/lib/admin-service.ts:7-15`                                                                                     | The broad “admin service” name now contains only `listAudit`; its header also says role/permission tables are gone although they were reintroduced. The name/comment describe an older module boundary. User mutations live in Better Auth hooks and custom-role CRUD in `role-service.ts`. |
| F2  | Low      | `src/components/auth/server-table-state.ts:1,13`                                                                    | The file is explicitly `'use client'` and exports `useServerTableState`. “Server” means a table driven by server data, not code running on the server. It is a naming ambiguity, not an incorrect client/server boundary.                                                                   |
| F3  | Low      | `src/components/admin/access-skeleton.tsx:10-28`, `users-workspace.tsx:12-13`, `src/app/admin/users/page.tsx:13-19` | One user-directory feature is called “Access”, “Users”, “Accounts” (wrapper comment), and “people” (loading label). Search by the route's feature name does not find every related component. This is vocabulary drift, not four separate features.                                         |
| F4  | Medium   | `src/lib/ml/types.ts:1-17` and `src/lib/ml/model-id.ts:12-21`                                                       | `types.ts` includes provider defaults and a runtime `publicModelId` function, while the production ID implementation is in `model-id.ts`. A file named for types also contains an alternative ID formula that production does not use. See N1.                                              |
| F5  | Low      | `src/app/admin/permissions/page.tsx:20,87,95`                                                                       | The JSX-producing helper is named `table` and invoked as a function, while comparable UI units elsewhere use named React components. It is a legal render helper with no hooks, not a runtime React violation.                                                                              |

The naming/ownership conflict between `.agents/rules/architecture.md:13` and `role-service.ts` is real, but the scan does not establish two competing custom-role CRUD implementations. The rule predates the shipped service boundary; Better Auth's `set-role` assigns keys to a user rather than maintaining the custom-role tables.

## 3. Function names, identifiers and code vocabulary

### N1. Public model IDs have multiple names and two formulas — Medium

| Name            | Evidence                                                                     | Meaning                                                                       |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `publicModel`   | `src/lib/ml/protocol.ts:79,589,704`                                          | Canonical request's client-facing model ID                                    |
| `publicId`      | `src/lib/ml/service.ts:99`, `src/components/admin/ml-providers-panel.tsx:59` | DTO/UI name for the same client-facing ID                                     |
| `poolModelId`   | `src/lib/ml/model-id.ts:12-21`                                               | Production ID builder; includes an endpoint hash for non-preset endpoints     |
| `publicModelId` | `src/lib/ml/types.ts:15-17`                                                  | Test-only helper using `${provider}/${upstreamId}` without endpoint isolation |

The first two are naming drift across layers. The helper pair is more substantial: similarly named ID builders have different collision behavior. The test-only formula does not demonstrate a production collision.

### N2. “Parse roles” does not mean the same role set — Medium

- `permissions.ts:168-173` `parseRoles` returns only recognized **system** role names.
- `admin-users.tsx:141-151` `parseAdminRoles` preserves arbitrary keys, supplies a configured fallback and optionally truncates to one role.
- `access-display.ts:28-33` `splitRoleValue` preserves unknown keys and returns an empty array for no role; this module is dead in production.
- `rbac.ts:60-79` builds `grants().roles` from both parsed system roles and stored custom roles.
- SQL role counts in `roles.ts:95-98` treat an empty string as `user`, unlike the system-role parser.

The names and array types do not reveal these distinctions. Some differences are purposeful, particularly system-versus-custom resolution. The confirmed issue is that a reader cannot assume these helpers share a normalization contract. The singular database field `user.role` also represents a comma-separated collection, following the Better Auth contract.

### N3. Two `readErrorCode` functions accept different kinds of input — Low

`src/lib/action-errors.ts:73-77` reads a code from an already-materialized error chain and uppercases it. `src/lib/ml/errors.ts:42-48` asynchronously consumes a `Response` body and accepts only `/^[A-Z_]{1,64}$/`. They share a name but differ in input, normalization and whether they consume a stream. Both are typed and module-scoped, so this is discoverability/contract ambiguity, not an unsafe call proven by the scan.

### N4. Audit action strings use different grammars — Medium

- User mutations: `user.create`, `user.roles.replace`, `user.password.set` (`auth/admin-guards.ts:52-63`).
- Role CRUD: `role.create`, `role.update`, `role.delete` (`role-service.ts:65,100,142`).
- ML operations: `ml:connection:update`, `ml:model:update` (`ml/service.ts:59-67,276`).

The same persisted `AuditLog.action` field uses dots and colons, different entity naming, and free strings rather than one checked action vocabulary (`prisma/schema.prisma:198`). A consumer grouping actions by one delimiter cannot assume the other domains follow it. No broken consumer is claimed.

### N5. Generic names conceal larger responsibilities — Low

| Evidence                                 | Name               | Responsibility obscured by the name                                                     |
| ---------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `ml-providers-panel.tsx:96,447`          | `root`, `perform`  | ML-management API base path; operation execution with shared busy/error/reload behavior |
| `tokens.ts:12,23`                        | `access`, `pair`   | Signs an access JWT; persists a refresh token and returns a token pair                  |
| `api/v1/[...path]/route.ts:18-46`        | `p`                | Path segments used to dispatch authentication and identity routes                       |
| `rbac.ts:26,36,97`, `docs-access.ts:6-8` | `h`, `s`, `g`, `i` | Headers, live session, grants and identity in authorization code                        |

Short callback variables are not generally defects. These examples sit in long-lived flow/security code, where neighboring modules use fuller names such as `identity`, `session`, `actorId`, and `permission`.

### N6. A getter performs durable writes — Medium, documented behavior

`getInitialOwnerSetupStatus` (`initial-owner-setup.ts:150-154`) opens a transaction and takes an advisory lock. Its `setupStillOpen` call can write the permanent setup-completion marker (`:125-132`). The function's comment documents this self-healing behavior (`:143-148`), so it is not an undiscovered bug. Its getter-like name still does not communicate the durable side effect to a new caller.

## 4. Inconsistent code and behavior contracts

| ID  | Priority | Inconsistency                                                        | Evidence / practical limit                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | High     | Equivalent owner changes follow different guard rules                | `auth/admin-guards.ts:124-133,168-183` inspects top-level roles for set-role but not nested `data.role` for update-user. Email unverification and inactive-owner creation are also outside those eligibility/count checks. Source review and isolated execution of the application guard confirm the difference; Better Auth still requires the relevant caller grants. See X6 in `unused-code-findings.md`; no live endpoint/database reproduction.    |
| B2  | High     | Password minimum differs between creation and password-setting paths | App policy is 12 (`auth.ts:37`). Pinned Better Auth create-user calls only the maximum-length check before hashing, whereas set-user-password checks both bounds (`dist/plugins/admin/routes.mjs:194,203-210,828-829`). The admin create field (`admin-users.tsx:744-759`) has `required` but no minimum validator. See X7; source-confirmed, not browser/HTTP tested. Client auth-form maximum 128 is correctly supplied by the UI package normalizer. |
| B3  | Medium   | Server role-error code and shared client code do not match           | `role-service.ts:133` emits `ROLE_IN_USE`; `action-errors.ts:42` allows `ROLE_HAS_MEMBERS`, which no server path emits. The roles manager currently displays server messages directly, so this mismatch is dormant in the shared mapper rather than proof that this screen currently shows generic copy.                                                                                                                                                |
| B4  | Medium   | Screens follow different error-display rules                         | Auth/admin table uses `safeActionErrorMessage` (`admin-users.tsx:165-170`); ML adds a domain allowlist (`ml/errors.ts:7-38`); roles manager displays caught server messages (`roles-manager.tsx:138-169`). An ML domain extension is reasonable; raw role-server text versus the documented safe-copy policy is the substantive inconsistency.                                                                                                          |
| B5  | Medium   | Owner-session guard recipes differ                                   | `requireRoleOwner` (`role-service.ts:30-44`) and `requireMlOwner` (`ml/admin-auth.ts:7-29`) use nearly the same guard flow but differ in explicit expiry filtering and domain permission/rate-limit names. `identify` and `authorize` cover expiry for both, so the difference does not establish acceptance of an expired session. `guardDocs` intentionally has a development bypass and a different read-only contract.                              |
| B6  | Medium   | Error copy controls application behavior                             | `ml-providers-panel.tsx:1024` looks for the words `Reload models` in the displayed error to decide whether a recovery button appears, while the actual machine condition is `MODEL_CATALOG_CHANGED` (`ml/errors.ts:11-12`). Rewording/localizing presentation text can change behavior.                                                                                                                                                                 |
| B7  | Low      | Same completed state uses different UI composition                   | `app/setup/page.tsx:35-58` includes an icon; `auth/owner-setup.tsx:325-343` omits it and changes button/content classes. Same title, description and navigation, two presentation conventions. See redundant-code U4.                                                                                                                                                                                                                                   |
| B8  | Low      | Session presentation differs between account and admin UI            | Settings (`active-session.tsx:66-110`) shows parsed browser/OS and relative age; admin (`admin-users.tsx:1586-1619`) shows raw user-agent text and created/expiry dates. Different authority/current-session actions are legitimate; shared device/time vocabulary is a consistency observation, not proof that the screens should be identical.                                                                                                        |

Distinct authentication error codes are not automatically synonyms: `SESSION_REQUIRED` means a session-only route rejected a bearer request, whereas `UNAUTHENTICATED`, `INVALID_TOKEN`, `UNAUTHORIZED` and `AUTH_ERROR` arise at different boundaries. Their naming is fragmented, but merging their semantics is not supported by the scan.

## 5. Tests, imports and schema conventions

| ID  | Priority | Evidence                                                                                                                  | Finding and limit                                                                                                                                                                                                                                                                                                      |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Low      | `tests/unit/ml-protocol.test.ts`, `server-ml-protocol.test.ts`; `avatar-storage.test.ts`, `server-avatar-storage.test.ts` | Both pairs import the same production module. The `server-` prefix is not a separate test project or directory, and some suites without it also test server code. The avatar suites cover different pure/storage-adapter responsibilities; a shared import does not prove duplicate tests.                             |
| T2  | Low      | `admin-ui-*`, `auth-admin-*`, `auth-ui-*`, `app-pages-*`, `misc-*` under `tests/unit`                                     | Prefixes mix application area, implementation origin, layer and miscellaneous grouping. `misc-chrome.test.tsx`/`misc-providers.test.tsx` are less discoverable by the production module's feature name. No missing coverage follows from the names alone.                                                              |
| T3  | Low      | `tests/unit/chat-state.test.ts:2-3` versus `tests/unit/ml-protocol.test.ts:14`                                            | Chat tests use `../../src/...` while many peers use `@/...`. Both resolve; this is a local import convention difference. Relative imports between neighboring production modules are also valid and not globally prohibited.                                                                                           |
| S1  | Low      | `prisma/schema.prisma:29,80,95,133,153,165,181,192,205,227,259`                                                           | Mapped table names mix singular (`app_user`, `session`, `account`, `verification`, `installation_setup`) and plural (`roles`, `ml_connections`, `token_families`, `audit_logs`). Prisma model names remain singular PascalCase. Physical names are persisted contracts, not cosmetic files that can simply be renamed. |
| S2  | Medium   | `prisma/schema.prisma:25,72,93,125,149,162,255`                                                                           | Some `updatedAt` fields use Prisma `@updatedAt`, some only `@default(now())`, and one uses both. Default-only timestamps require writer-supplied updates; the difference alone does not establish stale data because Better Auth can set them explicitly.                                                              |
| S3  | Low      | `discovery.ts:21,166`, `ml/service.ts:151,153,186`, `gateway.ts:110,251,371`, `tokens.ts:48`                              | Similar deadlines/durations alternate between named `_MS` constants and bare numeric millisecond/second values. This is a units/readability inconsistency, not a claim that the configured durations are wrong.                                                                                                        |

## 6. Intentional differences excluded

- Framework `page`, `layout`, `route`, `loading`, default exports and HTTP verb exports follow Next.js conventions, not feature-file naming rules.
- Dependency-free `.mjs` bootstrap/generation scripts and typed `.ts` application tools have different runtime needs; mixed extensions alone are not a finding.
- `RoleView.key/name` and the dead `RoleDescription.id/label` use different vocabularies, but also represent DB-role versus static system-role views. This is not evidence that their field names can be substituted without conversion.
- `ClientDialect` and `UpstreamDialect` describe separate protocol boundaries. The unused upstream `responses` alternative is a reachability finding, not a reason to merge the types.
- `AuditLog.targetId` can identify users, roles and models. Its plain-string type does not establish a missing User relation; custom-role deletion and provider/status values also have SQL guards beyond the Prisma types.
- shadcn/Better Auth UI component names and their copied file layout follow the upstream registry contract. Registry drift was not rerun, and local renaming was not attempted.

## 7. Verification

The common rescan inventory contains 400 tracked files before the two new reports, 210 source/script/style files and 96 test files. The TypeScript 7 and TypeScript 6 unused-local/parameter checks pass. ESLint exits 0 with 20 warnings, including 16 from local worktrees. Findings above are supported by current source, import references, installed package code and the isolated guard/configuration checks; no naming convention is claimed to be machine-enforced unless an existing rule says so.
