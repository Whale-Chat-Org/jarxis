# Design system rules

Mandatory for every UI change. All design implementations must be responsive on mobile, tablet and desktop (see §9). `pnpm lint` enforces the token rules; the component and responsive rules are enforced by review and viewport validation.

## 1. Component rules

1. **Check the shadcn registry first.** Before writing any UI component, search the registries with the shadcn MCP (see [§6](#6-shadcn-mcp-setup)); for anything under `src/components/auth`, `settings` or a user control, start from the discovery order in [§7](#7-better-auth-ui-components-auth-changes):
   - `search_items_in_registries` / `list_items_in_registries` for `@shadcn` and `@better-auth-ui`;
   - `view_items_in_registries` / `get_item_examples_from_registries` to confirm it fits;
   - `get_add_command_for_items`, then run the returned `pnpm dlx shadcn@latest add …`.
2. **Compose from primitives.** Pages and feature components are built from `src/components/ui` (Button, Card, Table, Dialog, Sheet, DropdownMenu, Select, Combobox, Input/InputGroup, Field, Badge, Skeleton, Spinner, …). Never hand-roll a button, input, dialog, menu, table, card, badge, tooltip or skeleton with raw elements and classes. `pnpm lint` enforces this in `src/app` and `src/components/{admin,auth,landing,chat}`; `<form>`, `<a>` and `<img>` stay raw because no primitive exists for them.
3. **Custom components are the exception.** Only when the registry has nothing suitable. Then:
   - it must compose existing primitives rather than re-style raw HTML;
   - generic pieces go in `src/components/ui`, feature pieces in their feature folder (e.g. `src/components/admin`);
   - state in the PR/handoff which registry searches were run and why nothing fit.
4. **After `shadcn add`**, convert the generated classes to design tokens (§2). Registry output uses Tailwind's default scale, which this project removes, so `pnpm lint` fails until it is converted.
5. Preserve accessibility and keyboard behaviour of the primitives; don't remove focus rings, labels or ARIA attributes.

## 2. Token rules

`src/styles/tokens.css` clears Tailwind's default colour, spacing, font-size, font, weight, leading, tracking, container and shadow scales and defines only project tokens. Consequences:

- **Allowed:** the tokens in §3, semantic colours, radius tokens, and the `@utility` classes in `tokens.css`.
- **Forbidden** (lint errors):
  - numeric scale classes: `p-4`, `gap-2`, `w-64`, `size-4`, `mt-1.5`;
  - raw font sizes: `text-xs`, `text-sm`, `text-lg`;
  - t-shirt max widths: `max-w-sm`, `max-w-lg` (use container tokens);
  - arbitrary values and properties: `p-[13px]`, `text-[15px]`, `w-[calc(…)]`, `[--x:1px]`;
  - palette or absolute colours: `bg-zinc-800`, `text-white`, `bg-black/50`;
  - inline `style` for layout, spacing, colour or typography in feature code — lint-enforced, see below;
- **Still allowed**, because Tailwind has no theme scale for them:
  - bare numbers for opacity (`opacity-50`, `/50`), z-index (`z-50`), border/ring/outline widths (`border-2`, `ring-3`), `grid-cols-*`, `duration-*`, `order-*`;
  - fractions and keywords: `w-full`, `w-1/2`, `min-w-none`, `h-svh`, `w-fit` (zero is the `none` token: `inset-none`, `p-none`, `min-w-none` — `min-w-0`, `p-0`, `top-0` are errors);
  - breakpoints (`sm:`, `md:`), arbitrary **variants** (`data-[state=open]:`, `has-[>svg]:`);
  - CSS-variable shorthand for runtime values set by primitives, e.g. `w-(--radix-select-trigger-width)`, `origin-(--transform-origin)`, `size-(--cell-size)`. Never use this for design values.
- **Important markers are not an escape hatch.** `p-4!` and `!p-4` are both rejected; the position is normalised by `enforce-consistent-important-position`.
- **Bounded effect families.** Tailwind's `--blur-*`, `--ease-*`, `--aspect-*` and `--animate-*` scales are deliberately **not** cleared, because `tw-animate-css` declares `--animate-in`/`--animate-out` and reads `--value(--blur-*)`; clearing them would break dialog, sheet and popover animations. `eslint.config.mjs` restricts each family to an allowlist instead:

  | Family    | Allowed                                                                                                                             | Rejected examples                             |
  | --------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
  | blur      | `blur-none`, `blur-in`, `blur-out`, `backdrop-blur-panel`                                                                           | `blur-lg`, `backdrop-blur-sm`                 |
  | easing    | `ease-standard`                                                                                                                     | `ease-in-out`, `ease-linear`                  |
  | aspect    | `aspect-square`                                                                                                                     | `aspect-video`, `aspect-[4/3]`                |
  | animation | `animate-spin`, `animate-pulse`, `animate-in`, `animate-out`, `animate-accordion-*`, `animate-collapsible-*`, `animate-caret-blink` | `animate-bounce`                              |
  | max width | `max-w-full`, `max-w-none`, container tokens                                                                                        | `max-w-prose`, `max-w-fit`, `max-w-screen-md` |

- **Left unbounded on purpose:** `scale-*` and `rotate-*` (shadcn enter/exit primitives use `scale-0/100`, `rotate-0/45/90/180`), alongside the opacity, z-index, border/ring width, `grid-cols-*`, `duration-*` and `order-*` keywords above.
- **No hardcoded literals.** `no-restricted-syntax` rejects literal colours (`#fff`, `rgb(…)`, `oklch(…)`, `color-mix(…)`) and literal dimensions (`13px`, `0.5rem`, `100vh`…) anywhere in `src/**/*.{ts,tsx}`, including template literals and JSX attributes such as `fill="#fff"`.
- **No inline `style` in feature code.** `style` is rejected in `src/app`, `src/components/admin`, `src/components/auth` `src/components/landing` and `src/components/chat`. It stays permitted in `src/components/ui`, where primitives bridge third-party runtime CSS variables (`sonner.tsx` maps `--normal-bg` to `var(--popover)`).
- **Compose primitives, don't hand-roll them.** Raw `button`, `input`, `select`, `textarea`, `dialog`, `table`/`thead`/`tbody`/`tfoot`/`tr`/`th`/`td` and `label` are rejected in those same feature directories. `<form>`, `<a>` and `<img>` are exempt: no primitive exists for them.
- **Stylesheets other than `tokens.css` carry no raw values.** `tests/unit/design-system.test.ts` fails if any other `.css` file under `src/` contains a colour or dimension literal.
- **Need a value that doesn't exist?** Add a token (or an `@utility` for composite values) to `tokens.css`, add it to the lists in `src/lib/utils.ts` (`designTokens`), and extend `tests/unit/theme.test.ts`. Prefer reusing an existing token over adding a near-duplicate.
- **Class merging:** always use `cn` from `@/lib/utils`. It is configured with the token names so `text-body-sm` isn't mistaken for a colour and `p-lg p-sm` dedupes. Importing `clsx`, `tailwind-merge`, `cn` or `cn/config` directly is a lint error outside `src/lib/utils.ts`.

## 3. Token catalog

### Spacing (padding, margin, gap, offsets)

| Token      | Value    | Token         | Value      |
| ---------- | -------- | ------------- | ---------- |
| `none`     | 0        | `md-plus`     | 0.875rem   |
| `hairline` | 1px      | `lg`          | 1rem       |
| `3xs`      | 0.125rem | `lg-plus`     | 1.25rem    |
| `2xs`      | 0.25rem  | `xl`          | 1.5rem     |
| `xs`       | 0.375rem | `xl-plus`     | 1.75rem    |
| `sm`       | 0.5rem   | `2xl`         | 2rem       |
| `sm-plus`  | 0.625rem | `2xl-plus`    | 2.25rem    |
| `md`       | 0.75rem  | `3xl` / `4xl` | 2.5 / 3rem |

**Semantic layout tokens (use these first for page structure):**

| Token      | Value  | Use                                       |
| ---------- | ------ | ----------------------------------------- |
| `page`     | 1rem   | Page/shell padding (`p-page`, `px-page`)  |
| `page-lg`  | 1.5rem | Page padding from `md:`                   |
| `section`  | 1.5rem | Gap between page sections (`gap-section`) |
| `stack`    | 1rem   | Gap between blocks inside a section       |
| `stack-sm` | 0.5rem | Tight vertical stacks                     |
| `inline`   | 0.5rem | Gap between inline controls               |
| `card`     | 1.5rem | Card padding                              |

### Component sizes (`size-*`, `w-*`, `h-*`, `min-*`, `max-*`)

- Icons: `icon-xs` 0.75rem, `icon-sm` 0.875rem, `icon` 1rem, `icon-lg` 1.25rem, `icon-xl` 2rem, `hero-icon` 4rem.
- Controls: `control-xs` 1.5rem, `control-sm` 2rem, `control` 2.25rem, `control-lg` 2.5rem, `avatar` 1.75rem, `avatar-xl` 3.5rem, `chip` 1.375rem, `switch` 1.15rem, `cell` 2rem.
- Layout: `header` 3.5rem, `sidebar` 16rem, `sidebar-mobile` 18rem, `sidebar-icon` 3rem, `drawer` 24rem, `drawer-wide` 28rem, `search` 16rem, `select-sm` 8rem, `select-md` 9rem, `menu` 14rem, `menu-min` 8rem, `menu-sm` 10rem, `menu-xs` 12rem, `popover` 18rem.
- Tables and lists: `col-icon` 2.5rem, `col-actions` 4rem, `col-scope` 7rem, `empty-row` 6rem, `empty-row-lg` 10rem, `list-max` 16rem, `list-min` 10rem (minimum height of a list that fills the remaining space), `dropdown-max` 24rem, `name-max` 8rem.
- Chat: `attachment` 7.5rem for vertical attachment content.
- Misc: `qr` 10rem, `textarea-min` 4rem, `slider-vertical` 11rem, `chip-input-min` 4rem, `nudge` 2px, `addon-button` 0.45rem, `addon-kbd` 0.35rem, `combobox-offset` 1.75rem, `tabs-list` 3px, `tabs-bar` 2.75rem, `tabs-indicator` 5px, `inspector` 52rem.
- Skeleton placeholder widths: `bar-3xs` 3rem, `bar-2xs` 3.5rem, `bar-xs` 4rem, `bar-sm` 5rem, `bar-md` 6rem, `bar-lg` 7rem, `bar-xl` 8rem, `bar-2xl` 9rem, `bar-3xl` 10rem, `bar-4xl` 12rem, `bar-5xl` 14rem, `bar-6xl` 16rem.

### Max widths (`max-w-*`)

`narrow` 24rem (auth cards, short text), `form` 28rem, `dialog` 32rem, `dialog-sm` 20rem (compact alert dialogs), `content` 80rem (page container), `panel` 56rem (wide inspector dialogs). `bubble` 80% caps message bubbles. Container queries use the same names (`@form/field-group:`).

### Typography

| Class           | Size     | Use                             |
| --------------- | -------- | ------------------------------- |
| `text-caption`  | 0.75rem  | Helper text, table meta, badges |
| `text-hint`     | 0.8rem   | Calendar/field hints            |
| `text-body-sm`  | 0.875rem | Default dense UI text, controls |
| `text-body`     | 1rem     | Body copy                       |
| `text-heading`  | 1.125rem | Page headings (`h2`)            |
| `text-title`    | 1.25rem  | Card and dialog titles          |
| `text-headline` | 1.5rem   | Prominent headings              |
| `text-display`  | 1.875rem | Landing/hero headings           |

Each size carries its own line-height. Weights `font-normal|medium|semibold|bold`; leading `none|tight|snug|normal|relaxed`; tracking `tight|normal|widest`. `font-sans` / `font-mono` map to `--font-ui` / `--font-code`. Use `tabular-nums` for aligned numbers.

### Elevation and radius

- Shadows: `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg` (and `shadow-none`).
- Radius from `--radius` (0.625rem): `rounded-xs` 2px, `rounded-chip` 4px, `rounded-inner` 5px, `rounded-sm` 6px, `rounded-md` 8px, `rounded-lg` 10px, `rounded-xl` 14px, `2xl`–`4xl` in 4px steps. Medium corners for controls, large for panels.

### Effects (allowlisted families, see §2)

| Token           | Value                          | Use                                       |
| --------------- | ------------------------------ | ----------------------------------------- |
| `blur-panel`    | 8px (`backdrop-blur-panel`)    | Frosted sticky headers and overlay panels |
| `ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | All non-default transitions               |
| `aspect-square` | `1 / 1`                        | Square calendar/avatar cells              |

Both effect values match the Tailwind default they replaced, so migrating a class is value-preserving. `blur` and `ease` are also listed in `designTokens` (`src/lib/utils.ts`) because `tailwind-merge` would otherwise refuse to dedupe them.

### Composite utilities (`@utility` in `tokens.css`)

`transition-control`, `grid-cols-alert`, `grid-cols-alert-icon`, `grid-rows-card-header`, `grid-cols-card-header`, `cell-size-default`, `min-w-combobox`, `max-h-combobox-list`, `max-w-viewport-inset`, `max-w-viewport-menu`, `translate-x-switch-on`, `tooltip-arrow-offset`, `sidebar-icon-width`, `sidebar-icon-width-plus`, `left-sidebar-offset`, `right-sidebar-offset`, `shadow-sidebar-outline`, `shadow-sidebar-accent-outline`, `transition-sidebar-shell`, `transition-sidebar-label`, `transition-sidebar-menu-button`, `transition-sidebar-rail`, `transition-sidebar-header`, `grid-rows-alert-dialog`, `grid-rows-alert-dialog-media`, `h-tabs-trigger`, `admin-panel-motion`, `admin-dock-motion`, `h-inspector`, `grid-rows-inspector`, `grid-rows-inspector-form`, `grid-cols-admin-filters`, `chat-item-containment`, `chat-item-visibility`, `transition-chat-scroll`, `bg-bubble-secondary-hover`, `bg-bubble-muted-hover`, `bg-bubble-tinted`, `bg-bubble-tinted-dark`, `bg-bubble-tinted-hover`, `bg-bubble-tinted-dark-hover`.

## 4. Colour

Use the shadcn default Neutral light/dark palette for surfaces, actions, charts and navigation. Use semantic utilities only:

- Page: `bg-background text-foreground`.
- Panels and overlays: `bg-card text-card-foreground`, `bg-popover text-popover-foreground`.
- Main actions: `bg-primary text-primary-foreground`; secondary actions use the matching secondary pair.
- Supporting text: `text-muted-foreground`; subdued surfaces use `bg-muted`.
- Hover/selection: `bg-accent text-accent-foreground`.
- Destructive actions: `bg-destructive text-destructive-foreground`.
- Warnings: `text-warning`.
- Modal scrim: `bg-overlay/50`. Switch/slider thumbs: `bg-thumb`.
- Separators: `border-border`; control boundaries: `border-input`; focus: `border-ring` / `ring-ring`.
- Navigation: `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-primary-foreground`, `sidebar-accent`, `sidebar-accent-foreground`, `sidebar-border`, `sidebar-ring`.
- Charts: `chart-1` through `chart-5`. Include labels, patterns or markers; colour alone must not encode meaning.

Tokens hold complete CSS colours; use `var(--primary)`, not `hsl(var(--primary))`. `@theme inline` aliases support shadcn utilities and opacity modifiers. Apply `.dark` on the root through the existing theme provider; each mode sets native `color-scheme`.

## 5. Loading states

- Use the shadcn `Skeleton` (`src/components/ui/skeleton.tsx`, tinted `bg-foreground/10` so it stays visible on cards and the sidebar in both themes) through the shared blocks in `src/components/skeletons.tsx`: `PageHeaderSkeleton`, `TableSkeleton`, `TableRowsSkeleton`, `PaginationSkeleton`, `StatCardsSkeleton`, `RoleCardsSkeleton`, `ListCardSkeleton`, `AuthCardSkeleton`, `AdminShellSkeleton`, `LandingSkeleton`. Wrap them in `LoadingRegion` so screen readers hear one label while the shapes stay `aria-hidden`.
- Every route has a `loading.tsx` that mirrors its real layout. Add one with each new page.
- `loading.tsx` never wraps its own segment's layout, so layouts that await data (e.g. `src/app/admin/layout.tsx`) put that work behind their own `<Suspense>` with a shell skeleton.
- Same-route search-param changes don't re-trigger `loading.tsx`: use `useTransition` and render `TableRowsSkeleton` while pending (users table), or a `<Suspense key={…}>` around the data component (audit log).
- Keep `Spinner` for inline button actions only.

## 6. shadcn MCP setup

Project-scoped configuration launches `npx -y shadcn@latest mcp` (Node.js/npm must be on the client's PATH; `latest` follows upstream releases):

- Claude Code: `.mcp.json` (project server, requires approval).
- Codex: `.codex/config.toml` (stdio server, 60-second startup timeout; requires a trusted project).

Registries configured in `components.json`: `@shadcn` and `@better-auth-ui`.

Activate:

- **Claude Code:** restart the session from the project root (`claude`), approve the project `shadcn` server when prompted, then check `/mcp` shows it connected.
- **Codex desktop:** fully quit and reopen Codex, open this project, and check `/mcp`.
- **Codex CLI:** relaunch from the project root. If the project entry isn't discovered, use a session-only launch that changes no global config:

  ```sh
  codex \
    -c 'mcp_servers.shadcn.command="npx"' \
    -c 'mcp_servers.shadcn.args=["-y","shadcn@latest","mcp"]' \
    -c 'mcp_servers.shadcn.startup_timeout_sec=60'
  ```

References: [shadcn MCP](https://ui.shadcn.com/docs/mcp), [OpenAI MCP docs](https://developers.openai.com/codex/mcp), [Codex project configuration](https://developers.openai.com/codex/config-basic).

## 7. Better Auth UI components (auth changes)

Every auth view here is a **copied** Better Auth UI component — not a local invention, and not a package import. `@better-auth-ui/react` exports the data layer only (`AuthProvider`, `AuthPrompts`, `useAuth`, the mutation/query hooks); it has **no** `SignIn`, `SignUp` or `Auth` export. The UI ships as source files from the `@better-auth-ui` shadcn registry into `src/components/auth/`. Never hand-roll an auth card, field or provider button, and never import a view from the package.

Discover what exists in this order:

1. **Offline, always first.**
   - `src/components/auth/` holds the `auth`, `auth-provider`, `user-button`, `theme`, `settings` and `admin` items: `auth` (view router), `sign-in`, `sign-up`, `forgot-password`, `reset-password`, `reset-link-sent`, `verify-email`, `sign-out`, `auth-redirect`, `auth-result`, `reauthentication`, `provider-button(s)`, `additional-field`, `password-strength-meter`, `open-email-button`, `auth-form`, `error-toaster`, `user/` (avatar, view, button), `theme/` (appearance, theme-toggle-item), `settings/account/` (account-settings, user-profile, change-email, change-avatar), `settings/security/` (security-settings, change-password, active-sessions, active-session, session-actions, linked-accounts, linked-account) and `admin/` (admin-users, admin-table, stop-impersonating); plus `src/components/auth/server-table-state.ts` and `src/lib/auth/*`.
   - `src/components/ui/` holds the shadcn primitives. `pnpm dlx shadcn@latest info` prints that installed list — it does **not** track `@better-auth-ui` items, so it never shows `auth`/`auth-provider`.
   - **Not installed:** every other plugin item (`two-factor`, `magic-link`, `organization`, `passkey`, `email-otp`, `api-key`, `captcha`, …). `src/components/providers.tsx` registers two UI plugins — `themePlugin({ useTheme })` and `adminPlugin({ … })` — and `src/lib/auth-client.ts` registers `adminClient()`, so the admin UI is live and email + password is still the only credential method.
   - **Omitted on purpose:** `src/components/auth/admin/admin.tsx`, the item's own horizontal-tab administration shell. This repo keeps the shadcn `Sidebar` as the admin frame and renders `AdminUsers` inside it; `scripts/registry-drift.ts` records the omission so it is not read as drift.
   - `/settings` (`src/app/settings/`), `/admin` and the account menu (`UserButton`, in `SidebarFooter`) are wired. `themePlugin` needs **only** the UI-plugin switch, because the theme library is `next-themes`; `adminPlugin` additionally needs the `admin` server plugin in `src/lib/auth.ts` and `adminClient()` on the auth client.
   - **Deliberately local, not registry:** `src/components/theme-toggle.tsx` (a trigger the registry does not ship), `src/components/public-chrome.tsx` (site branding) and `src/components/skeletons.tsx` (the `LoadingRegion` block set in §5).
2. **Version-matched guidance shipped with the package.** `node_modules/@better-auth-ui/react/skills/better-auth-ui-react/SKILL.md` and its `references/shadcn.md`. Prefer these over the website, which tracks `@latest` while this repo pins `^1.7.26`.
3. **What can be installed.** Go through the CLI, because MCP is not guaranteed to be connected in every client ([§6](#6-shadcn-mcp-setup)):
   ```sh
   pnpm dlx shadcn@latest search @better-auth-ui        # every item + description
   pnpm dlx shadcn@latest view @better-auth-ui/<item>   # files, dependencies, registryDependencies
   pnpm dlx shadcn@latest docs @better-auth-ui/<item>
   ```
4. **The Storybook story index — visual map only.**
   `https://better-auth-ui.com/storybook/shadcn/index.json` is a real `application/json` manifest (Storybook 10, index `v: 5`): `entries[<storyId>]` gives `title`, `name`, `importPath`, `tags`, `exportName` — 72 stories across 10 `title` groups. Render one at `.../storybook/shadcn/iframe.html?id=<storyId>&viewMode=story`.
   - **It is not the registry.** `title`/`name` are Storybook story-file groupings (`Components/Authentication`, `Components/Account settings`, `Components/Component states`, `Plugins/Core plugins`, `Plugins/Feature coverage`, `Plugins/Complete coverage`, `Plugins/Advanced authentication`, `Plugins/Authentication helpers`, `Plugins/Integrations`, `Plugins/Organization`), **not** installable item names, and the manifest carries no dependency or file data. Never derive an `add` command from it — use source 3.
   - **Catch-all trap.** The host answers _any_ unknown path under that tree with `200` plus the marketing homepage HTML. `stories.json` and `manifest.json` do not exist there; an earlier revision of this file wrongly described `stories.json` as a v7-compat index. Only `index.json` and `project.json` (build metadata) return real JSON. Trust `Content-Type`, never the status code:
     ```sh
     curl -sIL https://better-auth-ui.com/storybook/shadcn/index.json | grep -i content-type
     ```
5. **Rendered preview.** `iframe.html` is a Vite shell, so `curl` yields no markup — it needs a real browser. Playwright and Chromium are devDependencies; screenshot the story and read the PNG. Import Playwright by absolute path, because ESM resolves from the script's directory rather than the cwd: `<repo>/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs`.

**Adding an item — two verified hazards.** Registry items are published against `@latest` and re-ship shared files, so `add` is not a safe drop-in:

- Items declare `@better-auth-ui/core@latest` and `@better-auth-ui/react@latest` in `dependencies`. Restore this repo's pinned `^1.7.26` ranges after `add`, before `pnpm install`.
- Items overwrite files this repo has already token-converted. `@better-auth-ui/two-factor` ships `components/auth/additional-field.tsx`, `auth-form.tsx`, `use-is-hydrated.ts`, `lib/auth/auth-plugin.ts`, `two-factor-methods.ts` and `use-sign-in-continuation.ts`, and pulls in `radix-nova/sign-in.json` + `radix-nova/username.json` on top. `add` replaces all of them with Tailwind's default scale, which `pnpm lint` then rejects. This workspace has no Git history, so copy the targets aside or diff against `view` output **before** adding, then re-apply §2 and run `pnpm lint`.

**Plugin views need three switches, not one.** A server-side plugin (two-factor, magic-link, …) renders only when it is enabled on the Better Auth server (`src/lib/auth.ts` `plugins`), on the client (`src/lib/auth-client.ts`), and as a UI plugin passed to `AuthProvider`. `themePlugin` is the exception: it wraps `next-themes`, needs no server or client plugin, and is registered alone in `src/components/providers.tsx`.

**Keeping the copies honest — `pnpm registry:drift`.** Registry files are never hand-edited: change them by re-`add`, re-applying §2, and re-running this check. It re-fetches every listed item through the shadcn CLI, formats both sides with this repo's Prettier config, applies the token conversion (`scripts/registry-drift.ts`), and exits non-zero for any difference it cannot explain. Differences that are deliberate are listed in that script's `REVIEWED` map with a reason; add an entry there rather than editing a registry file silently. `--verbose` prints the differing lines. It needs network access, so it is a script and not part of `pnpm test`.

## 8. Accessibility and validation

- `tests/unit/theme.test.ts` checks:
  - token completeness and aliases, the cleared default scales, the scale/type catalog, and that `designTokens` in `src/lib/utils.ts` matches `tokens.css`;
  - text contrast for the default Neutral semantic foreground pairs and actual supporting-text surfaces, with explicit upstream exceptions for muted fills;
  - OKLCH conversion and alpha compositing for default translucent dark borders; subtle input borders are checked against the upstream theme rather than the previous custom 3:1 border requirement, and rendered keyboard focus is verified in browser tests;
  - that the §3 catalog and the composite `@utility` list still describe `tokens.css` (a name-level drift alarm; values are pinned by the `designTokens` equality test and the contrast assertions).
- `tests/unit/design-system.test.ts` guards the guard: it runs ESLint in-process and asserts that every class the rules forbid is still rejected and every token-based equivalent still passes, that inline `style`/hand-rolled primitives/direct `clsx` imports fail in feature code but not in `src/components/ui`, and that no stylesheet other than `tokens.css` holds a raw colour or dimension. Weakening a rule in `eslint.config.mjs` fails here instead of silently passing lint.
- `enforce-canonical-classes` and `enforce-shorthand-classes` are deliberately **off**. They rewrite by numeric equivalence and propose collapsing `px-page py-lg` into `p-icon` (both 1rem), erasing the semantic distinction the token system exists to express. Don't enable them.
- This isn't a full component accessibility audit. Composited states need visual and keyboard checks: opacity on focus rings, destructive buttons and dark input backgrounds.
- Destructive red is an action fill, not a guaranteed accessible small-text colour. For validation messages, pair foreground text with an error icon or border and explicit wording.
- Decorative separators are intentionally lower contrast. Never rely only on red, violet or chart colours to convey state.
- Run `pnpm lint` (token rules) and `pnpm exec vitest run tests/unit/theme.test.ts tests/unit/design-system.test.ts`.

## 9. Responsive design (every UI implementation)

All pages, layouts, feature components and UI states must work on mobile, tablet and desktop, including auth, settings, administration, RBAC and ML provider screens. Implement mobile-first layouts using the existing design tokens and responsive breakpoint variants (§2); desktop-only implementations are incomplete.

### Required viewport coverage

Viewport dimensions below are width × height in CSS pixels.

| Device  | Required coverage                     | Minimum validation viewports |
| ------- | ------------------------------------- | ---------------------------- |
| Mobile  | 375 × 667 through 440 × 956           | 375 × 667 and 440 × 956      |
| Tablet  | 768 × 1024 through 960 × 1440         | 768 × 1024 and 960 × 1440    |
| Desktop | Fluid layouts from 1024px wide upward | 1280 × 800 and 1440 × 900    |

- Support intermediate widths and heights, including the gaps between these device ranges; these examples are validation targets, not fixed canvas sizes or new breakpoint definitions. Also check just below and above any breakpoint changed by the implementation.
- Let grids, columns, navigation and action groups reflow with available space. Use token-based container widths and responsive variants; do not introduce arbitrary dimensions or inline layout styles to match a viewport.
- Prevent page-level horizontal overflow, clipped text and overlapping controls. Long names, emails, model identifiers and validation messages must wrap or truncate accessibly without hiding essential information or actions.
- Adapt dense tables and comparison views with stacked rows/cards, responsive columns or a clearly bounded horizontal scroll region when necessary. Preserve access to essential data and row actions at every size.
- Keep menus, popovers, dialogs and sheets within the viewport. Long content must scroll, and primary actions must remain reachable on the shortest supported mobile height, including when the on-screen keyboard is open.
- Keep navigation, forms and actions usable by touch and keyboard. Preserve labels, focus visibility, focus management and the accessibility behaviour of the existing primitives.
- Apply the same responsive behaviour to loading, empty, error, success and populated states, including light and dark themes. Skeletons must follow the responsive layout they replace.

### Validation and handoff

- For every UI change, inspect the affected screens and interactions in a real browser at all six minimum validation viewports above. Check content reflow, navigation, forms, overlays, scrolling and action reachability; resizing a screenshot alone is insufficient.
- Record the viewports checked, results and any unresolved issues in the PR or handoff. If browser validation is unavailable, state which checks remain unverified; lint and unit tests do not establish responsive correctness.
