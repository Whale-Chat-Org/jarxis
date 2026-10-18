# Redundant code findings

> **Remediation status (2026-10-18):** Implementation and item-by-item dispositions are recorded in [Findings remediation](findings-remediation.md). The original scan below is retained as historical evidence; its old paths, measurements and “not implemented” statements describe that snapshot. Compatibility aliases and intentional retention are documented in the resolution matrix.

|          |                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot | `chore/findings-rescan` @ `1afce0d` (same commit as `main`), 2026-10-17                                                            |
| Scope    | Tracked `src/`, `scripts/`, tests, route layouts and configuration; current source behind every finding below                      |
| Purpose  | Identify extra wrappers, repeated logic and multiple implementations of the same UI. Findings only; no code removed or refactored. |

**Required naming change:** The project owner requires **ML providers → Providers** across the feature, including UI copy, files, components/functions, routes and supporting references. [REQ-PROVIDERS-01](code-consistency-findings.md#required-rename-providers) contains the current-to-required mappings and completion criteria. Current paths and identifiers below describe the scanned code; the rename is documented, not implemented.

## Required admin table and form reuse

**REQ-ADMIN-TABLE-01 and REQ-ADMIN-FORM-01 — Required by the project owner, 2026-10-17.** Consolidate admin table parameters into a reusable table system, and share the existing record/detail panel and form behavior across **Users, Roles and Providers**, with **view, create and edit** modes. The owner confirmed that these requirements must be documented before implementation. The requirements below are not implemented by this audit.

### REQ-ADMIN-TABLE-01: shared table and page definitions

Provide one reusable `AdminDataTable` and a typed `adminTableDefinitions` catalog. Gather each page's columns, supported query parameters, defaults, row identity, row actions and display states into its registered definition. The pages compose the shared table and their definition instead of rebuilding the table controls, parameter conversion and loading/pagination UI. Definitions can live in separate feature modules and be exported through one catalog; they must share one contract.

The table system must cover all current admin tables. The inventory also identifies admin pages that currently use cards/lists, so they are not mistaken for existing tables or edit forms.

| Page / record list                                  | Current presentation and parameters to gather                                                                                                                                                                                                                                                                                 | Supported record actions / boundary                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Users `/admin/users`                                | Four columns: Name (with email/avatar), Role, Status, Created. `pageIndex`, configured `pageSize`, global search, `searchField: email/name`, `searchOperator: contains/starts_with/ends_with`, status `all/active/banned`, sort `name/createdAt` and direction, selected user ID, total/range, loading/fetching/error states. | View/create/edit according to grants; row role selection and inspector actions remain permission-aware. Uses Better Auth queries and mutations.                                                                                                                                      |
| Roles `/admin/roles`                                | Five columns: Role, Type, Permissions, Users, Actions. Stable row key `role.key`, supplied role list, selected/draft role, permission catalog and `canManage`; current list has no search or pagination controls.                                                                                                             | View, create, edit, duplicate and delete according to owner/system/editable rules. A duplicate starts create mode from a copy.                                                                                                                                                       |
| Permissions `/admin/permissions`                    | Two groups, Administration and Application, each with Permission and Scope columns. Rows have `key`, description and restricted/standard scope; stable identity is the permission key. No current paging or search.                                                                                                           | Read-only catalog. Shared table reuse must not introduce create/edit/delete capabilities.                                                                                                                                                                                            |
| Audit `/admin/audit`                                | Action, Actor, Target, When and Details columns. URL `page` is one-based, page size is 20, total/pages and Previous/Next links are calculated locally. Query order is `createdAt desc`, then `id desc`; row identity is audit ID. Details show the recorded changes.                                                          | View-only records. No mutation form or write API is part of this page.                                                                                                                                                                                                               |
| Providers `/admin/ml-providers` in the scanned code | Connection cards and a gateway-key list, not a current table. Gather connection/key row IDs, ready/discovery/enabled status, priority, management capability, model counts/expansion and load/error/reload state. The editor's model search matches display name, upstream ID and public ID.                                  | Connection create/view/edit and model/key actions belong to the reusable record workflow. Existing card/list renderers may consume the common definition/state contract; no undisclosed search, paging or bulk API is assumed. Apply the required Providers route rename separately. |
| Overview `/admin`                                   | Metrics cards and a recent-activity list, not a current table. Recent activity reads page 1 with 5 rows, newest first, gated by `audit:read`; metrics have their own read grants.                                                                                                                                             | Read-only summary and navigation. Record no artificial editing capability or table pagination for the metrics.                                                                                                                                                                       |

**Current evidence:** `src/components/auth/admin/admin-users.tsx:198-297,401-422`, `src/components/auth/server-table-state.ts:13-74`, `src/components/auth/admin/admin-table.ts:13-23`, `src/components/admin/roles-manager.tsx:81-119,195-218`, `src/app/admin/permissions/page.tsx:20-95`, `src/app/admin/audit/page.tsx:23-57,69-162`, `src/lib/admin-service.ts:15-25`, `src/app/admin/page.tsx:16-20,107-129`, and `src/components/admin/ml-providers-panel.tsx:270-341,531-536,739-824`.

**Shared table contract:**

| Area            | Parameters and behavior owned by the shared layer                                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition      | Stable table ID, typed row data, `getRowId`, column/accessor/cell definitions, labels, semantic width/alignment/responsive visibility and supported controls. Feature-specific cell renderers remain possible.                                                                                                                           |
| Query state     | Typed pagination, search value/field/operator, column filters and sorting, with per-table allowed values and defaults. Unsupported controls are disabled/omitted by the definition rather than faked.                                                                                                                                    |
| Request mapping | One state-to-request adapter per data source. Users maps to Better Auth's `limit`, `offset`, `searchField`, `searchOperator`, `searchValue`, `sortBy`, `sortDirection`, `filterField`, `filterOperator`, `filterValue`; Audit maps shared zero-based `pageIndex` to its existing one-based `page`. In-memory tables use a local adapter. |
| State ownership | Support each page's declared state owner: URL-backed Audit state and controlled/local Users state. Parsing, validation and serialization follow that declaration; filter/sort/page-size changes reset the page, and shrinking totals clamp it.                                                                                           |
| Results         | Rows, total count where applicable, pending versus background refresh, empty versus filtered-empty states, safe error/retry state, stable selection and refresh callbacks.                                                                                                                                                               |
| Actions         | Row-open/view, create/edit/duplicate/delete and other feature actions are declared with their labels and capability checks. The common layer renders them consistently; the feature adapter supplies the actual operation.                                                                                                               |
| Rendering       | Shared table frame, header/sort controls, toolbar, row actions, pagination/range, empty/error/loading states and accessibility. Reuse existing shadcn/TanStack primitives and current token/responsive conventions.                                                                                                                      |

Do not force every endpoint into one request shape or put authorization/data access into the generic renderer. Promote/reuse the existing `useAdminTable` and `useServerTableState` capabilities where they fit; their current location under auth is not a reason to build a competing table-state implementation.

### REQ-ADMIN-FORM-01: shared record panel and form lifecycle

Provide one reusable `AdminRecordPanel` and common form lifecycle for the existing admin detail/edit panels. It must use an explicit `mode: view | create | edit`; action labels, editable fields and footer controls follow the mode and the actor's capabilities. “Edit” is the mode; update is the submit operation, not a second form implementation.

| Area                 | Required common behavior                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel frame          | Reuse `AdminPanelHost`, the existing responsive dock/sheet behavior, header/title/description, scrolling content, footer and nested-panel Back/focus handling. Do not create another competing dialog shell.                                                                       |
| Inputs               | Record identity, mode, open state, title/description, initial values, validation, view/edit capabilities, field/section renderer, submit operation and success/refresh callbacks. Fields and domain-specific sections stay typed and composable.                                   |
| View mode            | Display details consistently without a submit operation. Show Close; offer Edit only when the feature and actor permit it. Read-only records and locked fields remain read-only even inside an otherwise editable record.                                                          |
| Create/edit modes    | Shared validation and field/server error presentation, Save/Create and Cancel actions, dirty tracking and mode-aware defaults. Domain adapters build the payload rather than the common shell assuming one endpoint or schema.                                                     |
| Initialization/reset | Initialize from the selected record; reset when switching records/modes or intentionally reopening. Permission/background-query rerenders must not overwrite a draft. Preserve JAR-25's rule that saving an unchanged role selection does not replace a user's other stored roles. |
| Submission           | One guarded submit lifecycle prevents duplicate writes, starts pending state before awaiting work, blocks accidental close/Escape/outside interaction while a write is pending, and shows consistent progress. Feature operations determine their transaction and mutation order.  |
| Completion/errors    | Close/refresh/invalidate through supplied callbacks on success. Keep the form and entered values open on failure, show safe field/form errors, and avoid duplicate toast/inline messages. Opening another record clears the old record's errors.                                   |
| Capabilities         | Client controls reflect the current actor/record capabilities; server guards remain authoritative. Feature adapters retain owner protection, locked/system roles, self-edit restrictions and session/impersonation rules.                                                          |
| Specialized content  | Allow custom sections for role permission groups, user sessions/security actions, provider discovery/model selection and one-time gateway-key display. Reuse the frame/lifecycle without converting every field into a giant type-switch component.                                |

**Feature fields and actions to account for:**

- **Users:** create name/email/password, roles, verification and configured additional fields; edit profile/email/verification/roles; view IDs/timestamps/status and sessions. Password, ban, impersonation, delete and revoke confirmations can use nested shared panels while retaining their separate grants and mutations.
- **Roles:** name, description and permission groups; show assigned-user counts/system status in details. Honor locked Owner/User roles, immutable system names and restricted grants. Duplicate copies allowed grants into create mode instead of maintaining another editor.
- **Providers:** connection name, provider kind, base URL, API-key replacement, priority and models; preserve discovery previews, manual models, model-state version/reload behavior, and management permissions. Never prefill a stored credential; an empty replacement key must retain the existing credential. Issuing a gateway key uses the same lifecycle with its specialized one-time result content.
- **Audit and Permissions:** remain read-only. If their details use the shared panel, only view mode is enabled; they do not gain mutation operations simply because a reusable form exists.

**Current evidence:** Users create/profile/security forms in `src/components/auth/admin/admin-users.tsx:622-1723,1725-1813`; Roles draft/save/read-only panel in `src/components/admin/roles-manager.tsx:61-173,290-398`; Providers editor/key flows in `src/components/admin/ml-providers-panel.tsx:270-341,447-529,765-824,827-1218`; shared panel primitives in `src/components/ui/admin-panel.tsx:49-58,313-366`.

**Completion criteria for both requirements:**

1. Every current admin table is registered through the shared contract; its columns, defaults, request mapping and supported actions are gathered in its definition. Cards/lists and read-only pages are represented accurately in the inventory.
2. Users, Roles and Providers use the same record-panel frame and form lifecycle for view/create/edit, with page-specific fields and capability/submit adapters. Existing reusable panel primitives are extended/composed, not wrapped in another behavior-free layer.
3. Preserve existing API/auth contracts, role preservation, provider model-state concurrency checks, credential handling and current read-only boundaries. Coordinate file/symbol names with REQ-PROVIDERS-01.
4. Before UI implementation, perform the repository's shadcn/Better Auth UI registry discovery and document any necessary local composition/deviation. This requirements task does not install or edit registry components.
5. Verify pagination/filter/sort parameter mapping, page resets/clamping, loading/error/empty states, view/edit capability transitions, record switching without lost drafts, validation, double-submit/pending-dismissal guards, success refresh and failed-save recovery. Cover feature-specific behavior rather than mirroring component internals.
6. Validate keyboard/focus/nested-panel behavior and all six required viewports: 375×667, 440×956, 768×1024, 960×1440, 1280×800 and 1440×900. Run the relevant lint/type/unit checks and isolated browser checks when implemented.

## 1. Method and interpretation

The rescan rebuilt the import/export graph with the installed TypeScript API, enumerated functions that only return another call/component, then read each relevant implementation and its callers. UI comparisons examine the JSX, state, permissions and save/error behavior. They are source comparisons, not screenshot comparisons or a claim that separate repositories were scanned.

**Confirmed duplication** means the same operation or presentation is implemented at multiple sites. It does not mean the implementations are interchangeable. **Extra wrapper** means a component only forwards identical props and adds no layout, behavior, configuration or boundary. **Partial overlap** means only part of the behavior is shared. Registry copies and framework entry files are assessed in context; repeated syntax alone is insufficient.

The inventory below contains **1 confirmed extra wrapper**, **5 UI/presentation duplication groups**, **7 shared-logic/policy duplication groups**, and **2 lower-priority overlap groups**. These groups overlap findings in [code-quality-findings.md](code-quality-findings.md) and [unused-code-findings.md](unused-code-findings.md); they are not additional independent bug counts. Line counts are not claimed as removable savings.

## 2. Extra wrappers

### W1. `UsersWorkspace` only forwards the same three props — Low, confirmed

- `src/components/admin/users-workspace.tsx:13-17` renders only `<AdminUsers currentUserId={currentUserId} canManageAccess={canManageAccess} roles={roles} />`.
- `src/app/admin/users/page.tsx:19` already computes/passes those props. `UsersWorkspaceProps` repeats the subset of the child's prop contract.
- It adds no markup, state, permission check, loading behavior or configuration. It is reachable and used; this is an extra layer, not a dead file.
- Tests refer to the wrapper in `tests/unit/admin-ui-shell.test.tsx` and mock it in `tests/unit/app-pages-admin.test.tsx`, so its surface is also represented in test code.

No other reviewed wrapper meets that strict no-added-responsibility definition. The exclusions in §6 matter before treating short files as redundant.

## 3. Same UI implemented in different places

### U1. Role selection has four implementations across three files — High, confirmed

| Site                                                  | UI                                       | Data and save rules                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/components/admin/user-role-cell.tsx:43-119`      | Table-row Select and confirmation dialog | DB `RoleView[]`; selecting one role replaces all assignments; own row is read-only                                     |
| `src/components/auth/admin/admin-users.tsx:767-811`   | Create-user checkbox/radio group         | Same DB roles; toggles a nonempty role array; submitted through create-user                                            |
| `src/components/auth/admin/admin-users.tsx:1343-1397` | Inspector checkbox/Select group          | Same DB roles and near-identical checkbox update logic; adds self/permission disables; JAR-25 sends only changed roles |
| `src/components/admin/change-role-dialog.tsx:52-267`  | Separate radio dialog                    | Static `roleOptions` from `access-display.ts`; no custom roles; no production importer                                 |

Three sites are live; the fourth is dead. The two checkbox branches repeat the same add/filter/nonempty logic. The single-role versions use different controls, confirmations and error policies. This is the strongest example of one user operation maintained in several feature implementations, with real behavior drift. It does not establish that create-user and update-user should share their mutation lifecycle.

### U2. Password visibility fields and validators repeat across auth forms — Medium, confirmed registry duplication

The show/hide password `InputGroup` appears **eight times in four files**:

- `src/components/auth/sign-in.tsx:168-208`
- `src/components/auth/sign-up.tsx:273-313, 362-397`
- `src/components/auth/reset-password.tsx:136-176, 225-262`
- `src/components/settings/security/change-password.tsx:216-251, 290-323, 375-405`

Each has local visibility state, an input, a toggle and localized accessible labels. Seven new-password/general length-validation blocks plus the current-password variant repeat similar checks. These are registry copies, so duplication is a maintenance cost within the project's registry-preservation policy, not evidence that the registry-first rule was broken.

The admin create-password field is another implementation with different behavior: `admin-users.tsx:744-759` has a required password input without these visibility/length validators. The missing minimum also exists in the pinned create-user server handler (X7 in the unused-code report). The shared auth UI maximum is **128**, supplied by the package normalizer; the earlier undefined-maximum claim was false.

### U3. Auth and setup layouts contain identical public-frame JSX — Medium, confirmed

`src/app/(public)/auth/layout.tsx:13-24` and `src/app/(public)/setup/layout.tsx:9-20` repeat the same outer div, `Header`, centered/tinted main classes, children and `Footer`. Their returned JSX matches after whitespace normalization.

Both layout files are Next.js entry points and have a legitimate route responsibility. The duplication is the frame body inside them. `src/app/(public)/settings/layout.tsx:23-31` and `landing/landing-page.tsx:5-13` have related header/footer shells but different content layout; settings additionally enforces access before rendering. Those are partial overlap, not identical replacements.

### U4. “Setup already completed” is built twice and differs visually — Medium, confirmed

- Server decision: `src/app/(public)/setup/page.tsx:35-58`.
- Client transition after a completed response: `src/components/setup/owner-setup.tsx:325-343`.

Both show the same title, description and sign-in destination in a narrow Card. The server version includes a success icon and a spaced `CardContent`; the client version omits the icon and makes the button full width. These are two presentations of the same completed state. Their server/client state decisions remain different responsibilities.

### U5. Pending-dialog dismissal rules are repeatedly reimplemented — Medium, confirmed

The full pending `onOpenChange` / Escape / outside-interaction pattern appears in:

- `admin-users.tsx:690-699, 1177-1190, 1770-1779`
- `roles-manager.tsx:291-295`
- `change-role-dialog.tsx:128-153` (dead)

`admin-users.tsx:1651-1663` has the close guard and Escape only. Five other sites repeat just the close guard: `roles-manager.tsx:401`, `user-role-cell.tsx:99`, `session-actions.tsx:69`, `ml-providers-panel.tsx:829, 1197`.

The inspector uses `profileInFlight.current` for Escape but only `isSavingProfile` for outside interaction. Its Root close guard still prevents dismissal mid-save; the difference is duplicated policy and maintenance friction, not a reproduced outside-click bug.

## 4. Repeated logic and policy

| ID  | Priority / confidence                   | Repeated operation                                | Bound evidence and material differences                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | High / confirmed                        | Role parsing and owner detection                  | `permissions.ts:168-173`, `rbac.ts:60-69`, `initial-owner-setup.ts:68-73`, `auth/admin-guards.ts:90-106`, `user-role-cell.tsx:43-50`, `admin-users.tsx:141-155`, `scripts/owner.ts:27-40`, and SQL in `roles.ts:95-98` / `role-service.ts:126-128`. Unknown/default/custom role handling and whitespace rules differ. These are not all equivalent parsers. The concrete owner-guard gap is X6 in the companion report. |
| L2  | Medium / confirmed                      | Owner-session management guards                   | `role-service.ts:30-44` and `ml/admin-auth.ts:7-29` repeat bearer rejection, identity lookup, non-impersonated session query, authorization, owner membership and 60/minute rate limiting. The ML query includes expiry; the role query relies on `identify`/`authorize` for expiry. Domain permission keys and rate-limit namespaces differ.                                                                           |
| L3  | Medium / confirmed                      | ML connection credential/endpoint reset and audit | `ml/service.ts:212-235` and `281-304` repeat encryption, ready status, cooldown reset, discovery reset and `connection:update` audit construction. One path is inside a combined model-state transaction and lacks the other's `include`; the transaction boundary is meaningful even though the update fragment repeats.                                                                                               |
| L4  | Medium / confirmed                      | Provider-kind list                                | `ml/types.ts:1` and `ml/validation.ts:68` contain the same four values under `providerKinds` and `apiKeyProviders`. `validation.ts:2,33` already imports/uses `providerKinds` for the create schema but uses the second list for discovery preview. One provider change can update one list and miss the other.                                                                                                         |
| L5  | Medium / confirmed                      | Disabled auth endpoint policy                     | `auth.ts:25-32`, `app/api/auth/[...all]/route.ts:10-24`, and `openapi.ts:10-21` repeat the social/account-linking/token deny policy. The wrapper also blocks callback/reference/schema routes. Enforcement and documentation have different jobs; the repeated endpoint list can drift even though both enforcement layers have value.                                                                                  |
| L6  | Medium / confirmed repeated fragments   | Protocol mapping fragments                        | `ml/protocol.ts:236-245,389-398` repeats tool-choice mapping; text-part filtering/joining recurs at `:209,581,645,656-659,664-667,1572`; `gateway.ts:341-345,363-367` repeats the client-result renderer choice. The surrounding wire formats and message roles differ, so only the repeated transforms overlap, not the complete adapters.                                                                             |
| L7  | Low / confirmed repeated setup patterns | Test harness setup                                | Seven of nine `tests/unit/auth-ui-*.test.tsx` files define `makeClient`, and six define `renderWithAuth`, with differing signatures. Seventeen test files redefine the DB module mock; twelve inline QueryClient constructions occur in eleven test files. This is repeated harness/configuration surface, not proof that independent test doubles or assertions are redundant.                                         |

## 5. Partial overlaps requiring care

### O1. Request/response helpers — Medium, partial overlap

Three bounded stream-reading loops exist in `src/lib/http.ts:21-34`, `src/app/api/profile/avatar/route.ts:17-31`, and `src/lib/ml/gateway.ts:45-64`. All count bytes, cancel on overflow and collect chunks. They deliberately differ in JSON versus binary decoding, 16 KiB/avatar/1 MiB limits, abort handling and public error contracts. Only the low-level mechanics overlap; they are not drop-in substitutes.

The local gateway `json` helper (`gateway.ts:36-37`) is identical to `http.ts:43-44`: both call `Response.json` with a status and `Cache-Control: no-store`. It is a confirmed tiny duplicate, not an extra component layer.

### O2. Session and loading UI — Low, partial overlap

| Presentation       | Implementations                                                                                | Why the overlap is limited                                                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session list rows  | `settings/security/active-session.tsx:57-110` and `auth/admin/admin-users.tsx:1586-1619`       | Settings parses browser/OS with Bowser, shows relative age/current-session state and signs the current user out. Admin shows raw user-agent text and created/expiry dates, optional IP and permission-gated remote revocation. They display the same entity but have distinct authority and actions. |
| User-table loading | `admin/access-skeleton.tsx:14-28`, `auth/admin/admin-users.tsx:585-620`, `skeletons.tsx:63-92` | Route loading uses a generic four-column table/mobile cards; the registry table uses avatar/text cells, five rows and responsive columns; the generic helper supports variable rows/columns. There are multiple loading presentations for the users screen, but no evidence all are redundant.       |

## 6. Thin layers that add a responsibility

| File or family                                                  | Responsibility that prevents an “extra wrapper” finding                                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/auth/auth-provider.tsx:38-45`                       | Injects `ErrorToaster`; the file also augments Link and additional-field types.                                                                                      |
| `lib/auth/admin-plugin.ts:9-15`                                 | Extends the core plugin with `StopImpersonating` menu content.                                                                                                       |
| `components/header/theme-toggle.tsx:21-33`                      | Supplies the standalone trigger/menu around the registry's menu item.                                                                                                |
| `components/auth/admin/admin-table.ts:13-23`                    | Establishes shared table feature/sort defaults rather than just forwarding a call.                                                                                   |
| `components/auth/auth-result.tsx:93-99`                         | `AuthCallback` and `AuthError` fix different fallback intents.                                                                                                       |
| `lib/auth/auth-plugin.ts`                                       | Unimported but required module augmentation; in-memory deletion creates 38 type errors.                                                                              |
| `app/**/page.tsx`, `layout.tsx`, `loading.tsx`, API route files | Framework entry points, often also permission or loading boundaries. Shortness does not make them removable.                                                         |
| `components/ui/*` registry adapters                             | Carry styling, variants, slots, accessibility or library bindings. `admin-panel.tsx` additionally changes dialog behavior for responsive docked/sheet presentations. |
| `lib/auth/admin-guards.ts:82-87` `findUser`                     | Owns the exact owner-check projection rather than forwarding arbitrary Prisma arguments.                                                                             |

## 7. Validation and limits

The import/export scan covers the 400-file tracked snapshot, including 210 source/script/style files. TypeScript 7 and TypeScript 6 unused-local/parameter checks pass; ESLint exits 0 with 20 warnings (4 current, 16 in worktrees). In-memory source probes and the package normalizer checks are shared with the companion rescans. No UI was changed, no browser equality claim is made, and no removable-line total is inferred from similar JSX. Upstream registry drift was not checked over the network.
