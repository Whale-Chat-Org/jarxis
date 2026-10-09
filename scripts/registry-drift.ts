/**
 * Registry drift check for the copied shadcn / Better Auth UI components.
 *
 * Every file under `src/components/ui`, `src/components/auth` and `src/lib/auth` that came from a
 * registry is only allowed to differ from upstream by the design-token conversion documented in
 * `.agent/rules/design-system.md` §2. This script re-fetches each item through the shadcn CLI,
 * formats both sides with the project's Prettier config, applies that conversion, and prints any
 * residual difference — i.e. a change someone made by hand.
 *
 * Requires network access (the shadcn CLI resolves `@shadcn` and `@better-auth-ui`).
 *
 *   pnpm registry:drift          # report, exit 1 on real drift
 *   pnpm registry:drift --verbose
 */
import { execFileSync } from 'node:child_process';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prettier from 'prettier';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** Registry item addresses whose files are copied into this repo. */
const ITEMS = [
  '@shadcn/alert',
  '@shadcn/alert-dialog',
  '@shadcn/avatar',
  '@shadcn/badge',
  '@shadcn/breadcrumb',
  '@shadcn/button',
  '@shadcn/calendar',
  '@shadcn/card',
  '@shadcn/checkbox',
  '@shadcn/collapsible',
  '@shadcn/combobox',
  '@shadcn/dialog',
  '@shadcn/dropdown-menu',
  '@shadcn/field',
  '@shadcn/input',
  '@shadcn/input-group',
  '@shadcn/item',
  '@shadcn/label',
  '@shadcn/pagination',
  '@shadcn/popover',
  '@shadcn/radio-group',
  '@shadcn/select',
  '@shadcn/separator',
  '@shadcn/sheet',
  '@shadcn/sidebar',
  '@shadcn/skeleton',
  '@shadcn/slider',
  '@shadcn/sonner',
  '@shadcn/spinner',
  '@shadcn/switch',
  '@shadcn/table',
  '@shadcn/tabs',
  '@shadcn/textarea',
  '@shadcn/tooltip',
  '@better-auth-ui/auth',
  '@better-auth-ui/auth-provider',
  '@better-auth-ui/user-button',
  '@better-auth-ui/theme',
  '@better-auth-ui/settings',
  '@better-auth-ui/last-login-method',
  '@better-auth-ui/admin',
];

/**
 * Registry tokens whose local token depends on the component (both sides are equal values, the
 * project just names control-sized boxes `control-*`). Checked before `TOKEN_MAP`.
 */
const FILE_MAP: Record<string, Record<string, string>> = {
  'src/components/ui/button.tsx': {
    'h-6': 'h-control-xs',
    'size-6': 'size-control-xs',
    'size-8': 'size-control-sm',
  },
  'src/components/auth/additional-field.tsx': { 'w-32': 'w-select-sm' },
  'src/components/ui/input-group.tsx': {
    'h-6': 'h-control-xs',
    'size-6': 'size-control-xs',
    'size-8': 'size-control-sm',
  },
  'src/components/auth/theme/theme-toggle-item.tsx': {
    'h-6!': 'group-data-[orientation=horizontal]/tabs:h-xl',
  },
};

/**
 * The token conversion (§2): Tailwind's cleared default scale → project tokens, plus the
 * `@utility` composites in `tokens.css`. Longest key wins so `gap-2.5` never becomes `gap-sm.5`.
 */
const TOKEN_MAP: Record<string, string> = {
  'p-0!': 'p-none',
  'p-2!': 'p-sm',
  'size-8!': 'size-2xl',
  'my-0!': 'my-none',
  'gap-0!': 'gap-none',
  'w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]': 'sidebar-icon-width-plus',
  'w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]': 'sidebar-icon-width',
  'left-[calc(var(--sidebar-width)*-1)]': 'left-sidebar-offset',
  'right-[calc(var(--sidebar-width)*-1)]': 'right-sidebar-offset',
  'shadow-[0_0_0_1px_var(--sidebar-border)]': 'shadow-sidebar-outline',
  'shadow-[0_0_0_1px_var(--sidebar-accent)]': 'shadow-sidebar-accent-outline',
  'transition-[left,right,width]': 'transition-sidebar-shell',
  'transition-[margin,opacity]': 'transition-sidebar-label',
  'transition-[width,height,padding]': 'transition-sidebar-menu-button',
  'transition-[width]': 'transition-sidebar-rail',
  'transition-[color,box-shadow]': 'transition-control',
  'h-[calc(100%-1px)]': 'h-tabs-trigger',
  'p-[3px]': 'p-tabs-list',
  'bottom-[-5px]': '-bottom-tabs-indicator',
  'grid-rows-[auto_auto_1fr]': 'grid-rows-alert-dialog-media',
  'grid-rows-[auto_1fr]': 'grid-rows-alert-dialog',
  'max-w-[calc(100%-2rem)]': 'max-w-viewport-inset',
  'max-w-[48svw]': 'max-w-viewport-menu',
  'left-[50%]': 'left-1/2',
  'top-[50%]': 'top-1/2',
  'translate-x-[-50%]': '-translate-x-1/2',
  'translate-y-[-50%]': '-translate-y-1/2',
  'ring-[3px]': 'ring-3',
  'w-[2px]': 'w-nudge',
  'size-16': 'size-hero-icon',
  'size-12': 'size-4xl',
  'size-10': 'size-control-lg',
  'size-9': 'size-control',
  'size-8': 'size-2xl',
  'size-7': 'size-xl-plus',
  'size-6': 'size-xl',
  'size-5': 'size-icon-lg',
  'size-4': 'size-icon',
  'size-3.5': 'size-icon-sm',
  'size-3': 'size-icon-xs',
  'size-2.5': 'size-sm-plus',
  'size-2': 'size-sm',
  'h-12': 'h-4xl',
  'h-9': 'h-control',
  'h-8': 'h-control-sm',
  'h-7': 'h-xl-plus',
  'h-6': 'h-xl',
  'h-5': 'h-icon-lg',
  'h-4': 'h-icon',
  'h-3': 'h-md',
  'h-0.5': 'h-3xs',
  'w-5': 'w-icon-lg',
  'w-4': 'w-icon',
  'w-0.5': 'w-3xs',
  'w-32': 'w-bar-xl',
  'w-24': 'w-bar-md',
  'w-20': 'w-bar-sm',
  'min-w-5': 'min-w-icon-lg',
  'min-w-0': 'min-w-none',
  'min-h-0': 'min-h-none',
  'min-w-56': 'min-w-menu',
  'min-w-40': 'min-w-menu-sm',
  'p-6': 'p-xl',
  'p-4': 'p-lg',
  'p-2': 'p-sm',
  'p-0': 'p-none',
  'px-4': 'px-lg',
  'px-2.5': 'px-sm-plus',
  'px-2': 'px-sm',
  'px-1': 'px-2xs',
  'py-3': 'py-md',
  'py-2.5': 'py-sm-plus',
  'py-1': 'py-2xs',
  'py-0.5': 'py-3xs',
  'pl-2.5': 'pl-sm-plus',
  'pr-2.5': 'pr-sm-plus',
  'pr-8': 'pr-2xl',
  'mb-3': 'mb-md',
  'mb-2': 'mb-sm',
  'm-2': 'm-sm',
  'ml-2': 'ml-sm',
  'ml-0': 'ml-none',
  'mx-3.5': 'mx-md-plus',
  'mx-2': 'mx-sm',
  'mt-0.5': 'mt-3xs',
  'my-0.5': 'my-3xs',
  'my-0': 'my-none',
  'mt-8': 'mt-2xl',
  'gap-6': 'gap-xl',
  'gap-4': 'gap-lg',
  'gap-3': 'gap-md',
  'gap-2.5': 'gap-sm-plus',
  'gap-2': 'gap-sm',
  'gap-1.5': 'gap-xs',
  'gap-1': 'gap-2xs',
  'gap-0': 'gap-none',
  'gap-x-6': 'gap-x-xl',
  'space-x-2': 'space-x-sm',
  'inset-2': 'inset-sm',
  'inset-x-0': 'inset-x-none',
  'inset-y-0': 'inset-y-none',
  'inset-0': 'inset-none',
  'top-3.5': 'top-md-plus',
  'top-2.5': 'top-sm-plus',
  'top-1.5': 'top-xs',
  'top-1': 'top-2xs',
  'top-0': 'top-none',
  'right-4': 'right-lg',
  'right-3': 'right-md',
  'right-2': 'right-sm',
  'right-1': 'right-2xs',
  'right-0': 'right-none',
  'left-2': 'left-sm',
  'left-0': 'left-none',
  'bottom-0': 'bottom-none',
  'translate-y-0.5': 'translate-y-3xs',
  'translate-x-0': 'translate-x-none',
  'text-lg': 'text-heading',
  'text-sm': 'text-body-sm',
  'text-xs': 'text-caption',
  'max-w-xs': 'max-w-dialog-sm',
  'max-w-lg': 'max-w-dialog',
  'bg-black/50': 'bg-overlay/50',
  'ease-linear': 'ease-standard',
  'size-40': 'size-qr',
  'max-w-40': 'max-w-qr',
  'mx-4': 'mx-lg',
  'mx-3': 'mx-md',
  'm-0': 'm-none',
  'min-w-[8rem]': 'min-w-menu-min',
  'pl-3': 'pl-md',
  'pr-3': 'pr-md',
  'pl-4': 'pl-lg',
  'translate-y-1': 'translate-y-2xs',
  'translate-x-1': 'translate-x-2xs',
  '-translate-x-1': '-translate-x-2xs',
  'h-3.5': 'h-md-plus',
  'mt-0': 'mt-none',
  'ml-4': 'ml-lg',
  'mr-3': 'mr-md',
  'mb-1': 'mb-2xs',
  'bg-white': 'bg-thumb',
  'ease-in-out': 'ease-standard',
  'h-[var(--radix-select-trigger-height)]': 'h-(--radix-select-trigger-height)',
  'min-w-[var(--radix-select-trigger-width)]': 'min-w-(--radix-select-trigger-width)',
  '@md/field-group': '@form/field-group',
  '-my-2': '-my-sm',
  '-mb-2': '-mb-sm',
  '-mx-2': '-mx-sm',
  'grid-cols-[0_1fr]': 'grid-cols-alert',
  'grid-cols-[calc(var(--spacing)*4)_1fr]': 'grid-cols-alert-icon',
  'grid-rows-[auto_auto]': 'grid-rows-card-header',
  'grid-cols-[1fr_auto]': 'grid-cols-card-header',
  '[--cell-size:--spacing(8)]': 'cell-size-default',
  'min-h-4': 'min-h-lg',
  'min-h-9': 'min-h-2xl-plus',
  'min-w-16': 'min-w-chip-input-min',
  'max-w-sm': 'max-w-narrow',
  'mt-px': 'mt-hairline',
  'pt-2.5': 'pt-sm-plus',
  'pb-2.5': 'pb-sm-plus',
  'px-1.5': 'px-xs',
  'h-[calc(--spacing(5.5))]': 'h-chip',
  'text-white': 'text-destructive-foreground',
  'ml-[-0.45rem]': '-ml-addon-button',
  'mr-[-0.45rem]': '-mr-addon-button',
  'ml-[-0.35rem]': '-ml-addon-kbd',
  'mr-[-0.35rem]': '-mr-addon-kbd',
  '-mt-1.5': '-mt-xs',
  '-mt-1': '-mt-2xs',
  '-mx-1': '-mx-2xs',
  '-ml-1': '-ml-2xs',
  'h-10': 'h-control-lg',
  'pr-0': 'pr-none',
  'pl-0': 'pl-none',
  'pt-0': 'pt-none',
  'pb-0': 'pb-none',
  'mt-4': 'mt-lg',
  'mt-6': 'mt-xl',
  'mb-4': 'mb-lg',
  'mb-6': 'mb-xl',
  'mr-2': 'mr-sm',
  'text-base': 'text-body',
  'text-xl': 'text-title',
  'text-2xl': 'text-headline',
  'gap-y-0.5': 'gap-y-3xs',
  'gap-y-2': 'gap-y-sm',
  'gap-y-4': 'gap-y-lg',
  'gap-y-6': 'gap-y-xl',
  'p-8': 'p-2xl',
  'py-4': 'py-lg',
  'px-5': 'px-lg-plus',
  'px-8': 'px-2xl',
  'h-11': 'h-control-lg',
  'w-16': 'w-2xl',
  'min-h-64': 'min-h-empty-row',
  'max-h-64': 'max-h-list-max',
  'top-4': 'top-lg',
  'top-16': 'top-2xl',
  'top-1/2': 'top-1/2',
  'translate-x-4': 'translate-x-lg',
  'translate-y-4': 'translate-y-lg',
  'size-1.5': 'size-3xs',
  'size-1': 'size-2xs',
  'gap-7': 'gap-xl-plus',
  'gap-x-3': 'gap-x-md',
  'h-1': 'h-2xs',
  'h-px': 'h-hairline',
  'w-1': 'w-2xs',
  'w-px': 'w-hairline',
  'w-3': 'w-md',
  'w-6': 'w-xl',
  'w-8': 'w-2xl',
  'w-40': 'w-bar-lg',
  'w-72': 'w-popover',
  'w-48': 'w-menu',
  'w-64': 'w-sidebar',
  'left-1': 'left-2xs',
  'm-1': 'm-2xs',
  'mt-1': 'mt-2xs',
  'mt-2': 'mt-sm',
  'my-1': 'my-2xs',
  'p-1': 'p-2xs',
  'p-3': 'p-md',
  'p-5': 'p-lg-plus',
  'pb-2': 'pb-sm',
  'pb-3': 'pb-md',
  'pb-6': 'pb-xl',
  'pl-2': 'pl-sm',
  'pl-8': 'pl-2xl',
  'pr-1': 'pr-2xs',
  'pr-2': 'pr-sm',
  'pt-2': 'pt-sm',
  'pt-3': 'pt-md',
  'pt-6': 'pt-xl',
  'px-3': 'px-md',
  'px-6': 'px-xl',
  'py-1.5': 'py-xs',
  'py-2': 'py-sm',
  'py-6': 'py-xl',
  'scroll-py-1': 'scroll-py-2xs',
  'scroll-my-1': 'scroll-my-2xs',
  'ml-1': 'ml-2xs',
  'mr-1': 'mr-2xs',
  'min-h-44': 'min-h-slider-vertical',
  'min-h-16': 'min-h-textarea-min',
  'h-16': 'h-2xl',
  'max-h-96': 'max-h-dropdown-max',
  'rounded-[4px]': 'rounded-chip',
  'rounded-[calc(var(--radius)-5px)]': 'rounded-inner',
  'rounded-[2px]': 'rounded-xs',
  'h-[1.15rem]': 'h-switch',
  'translate-x-[calc(100%-2px)]': 'translate-x-switch-on',
  'translate-y-[calc(-50%_-_2px)]': 'tooltip-arrow-offset',
  'translate-y-[2px]': 'translate-y-nudge',
  'max-h-[min(calc(--spacing(96)---spacing(9)),calc(var(--available-height)---spacing(9)))]':
    'max-h-combobox-list',
  'min-w-[calc(var(--anchor-width)+--spacing(7))]': 'min-w-combobox',
  'size-11': 'size-3xl',
  'text-[0.8rem]': 'text-hint',
  '-space-x-2': '-space-x-sm',
  '-inset-2': '-inset-sm',
  '-right-4': '-right-lg',
  '-right-2': '-right-sm',
  '-left-2': '-left-sm',
  '-mt-8': '-mt-2xl',
  '-right-1': '-right-2xs',
};

/**
 * Files with reviewed, intentional deviations from upstream. Each entry is a decision this repo
 * made on purpose; anything not listed here is unexplained and fails the check.
 */
/**
 * Registry files this repo deliberately does not install, so a missing local file is not mistaken
 * for drift.
 */
const OMITTED: Record<string, string> = {
  'src/components/auth/admin/admin.tsx':
    "the plugin's own horizontal-tab administration shell; this repo keeps the shadcn Sidebar shell and renders AdminUsers inside it",
};

const REVIEWED: Record<string, string> = {
  'src/components/auth/sign-out.tsx':
    'a failed sign-out keeps the user on the current view and offers a retry; only a successful sign-out redirects, while Sonner owns failure feedback',
  'src/components/auth/additional-field.tsx':
    'raw <input> replaced by the Input primitive (raw inputs are lint-banned in src/components/auth), plus token spacing, and the copy-failure handler no longer logs the raw clipboard error',
  'src/components/auth/auth-result.tsx':
    'amber palette replaced by the semantic text-warning token, plus size-qr',
  'src/components/auth/auth-form.tsx':
    'server errors are surfaced through the safe allowlist in src/lib/action-errors (never the raw server message or field errors), and inline errors are suppressed when already handled by the toaster, compromised, or email-not-verified',
  'src/components/auth/error-toaster.tsx':
    'raw console logging of auth errors removed, and surfaced errors are marked handled via src/lib/action-errors so inline catch sites do not duplicate the toast',
  'src/components/auth/settings/account/change-avatar.tsx':
    'raw <input type="file"> replaced by the Input primitive, plus managed-blob cleanup after avatar replacement and failed profile updates; cleanup failures warn instead of logging, and update failures use the safe error helper and skip errors already handled by the toaster',
  'src/components/auth/settings/security/active-sessions.tsx':
    'the session list error renders safe localized copy with role="alert" and a retry button that refetches, instead of the raw error.message',
  'src/components/auth/settings/security/linked-account.tsx':
    'the unlink error handler no longer logs the raw error before toasting the localized message',
  'src/components/auth/settings/account/user-profile.tsx':
    'profile form initialization is guarded by user id so controlled-field changes are not reset during rerenders',
  'src/lib/auth/two-factor-methods.ts':
    'upstream doc comment dropped when the file was first token-converted',
  'src/components/auth/admin/admin-users.tsx':
    'token conversion of the registry user-management table (spacing, type and control sizes, and Button instead of a raw sort button), plus safe allowlisted mutation error copy, inline error presentation on inline-displaying mutations, a copy-user-id clipboard failure toast, and adaptation to the shared responsive admin panel (docked panel on desktop, right sheet on small screens) from @/components/ui/admin-panel: the inspector uses layout="inspector" with its toolbar/header/scrolling body, nested panels (set password, dangerous-action confirmation) get Back handling from the wrapper, the narrow inspector collapses the profile fields and account metadata to one column with a non-overflowing header and truncated-but-titled email, the plugin tab bar scrolls horizontally within bounds, and pending saves or confirmations block accidental dismissal',
  'src/components/ui/sidebar.tsx':
    'widths read design tokens instead of raw lengths, and the skeleton width is fixed so server and client markup match',
  'src/components/ui/skeleton.tsx':
    'tinted bg-foreground/10 so skeletons stay visible on cards and the sidebar in both themes',
  'src/components/ui/slider.tsx': 'thumb uses the bg-thumb token and the token-based track heights',
  'src/components/ui/switch.tsx':
    'token-based switch size and thumb travel (size-switch / translate-x-switch-on)',
  'src/components/ui/select.tsx':
    'CSS-variable shorthand for the trigger size (enforce-consistent-variable-syntax)',
  'src/components/ui/dropdown-menu.tsx': 'min-w-menu-min instead of an arbitrary 8rem',
  'src/components/ui/field.tsx':
    'container query renamed @md/field-group to the project @form/field-group, plus token spacing; validation uses foreground text and an error icon so meaning and contrast do not depend on destructive red',
  'src/components/ui/combobox.tsx': 'token spacing in the popup and list',
  'src/components/ui/alert-dialog.tsx': 'centred with top-1/2 left-1/2 and token max widths',
  'src/components/ui/dialog.tsx': 'centred with top-1/2 left-1/2 and token max widths',
  'src/components/ui/input-group.tsx': 'control-size tokens for the addon buttons',
  'src/components/ui/button.tsx': 'control-size tokens for the icon sizes',
  'src/components/ui/radio-group.tsx': 'centred indicator with top-1/2 left-1/2',
  'src/components/ui/sheet.tsx':
    'ease-standard and token edge widths; exports SheetPortal and SheetOverlay so the shared admin panel can reuse the registry sheet composition with a desktop dock target',
};

const VERBOSE = process.argv.includes('--verbose');

function applyTokenMap(text: string, local?: string): string {
  let out = text;
  if (local) {
    for (const file of Object.keys(FILE_MAP)) {
      if (!local.endsWith(file)) continue;
      for (const key of Object.keys(FILE_MAP[file]).sort((a, b) => b.length - a.length)) {
        out = out.replaceAll(key, FILE_MAP[file][key]);
      }
    }
  }
  for (const key of Object.keys(TOKEN_MAP).sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(
      `(?<![\\w/-])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w./-])`,
      'g',
    );
    out = out.replace(pattern, TOKEN_MAP[key]);
  }
  return out
    .replace(/from "cn"/g, 'from "@/lib/utils"')
    .replace(/from 'cn'/g, "from '@/lib/utils'")
    .replace(/@\/registry\/new-york-v4\/ui\//g, '@/components/ui/')
    .replace(/@\/registry\/new-york-v4\/hooks\//g, '@/hooks/');
}

function view(item: string): { path: string; content: string }[] {
  // A large item's JSON exceeds one pipe buffer, so capture the CLI output through a file.
  const out = join(tmpdir(), `registry-drift-${item.replace(/[^\w-]/g, '_')}.json`);
  execFileSync('pnpm', ['dlx', 'shadcn@latest', 'view', item], {
    cwd: ROOT,
    stdio: ['ignore', openSync(out, 'w'), 'ignore'],
  });
  const parsed = JSON.parse(readFileSync(out, 'utf8')) as unknown;
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.flatMap((entry) =>
    ((entry as { files?: { path: string; target?: string; content: string }[] }).files ?? []).map(
      (file) => ({
        // `target` is the install destination for Better Auth UI items (`@components/…`);
        // shadcn items carry an empty target and use `path` instead.
        path: file.target || file.path,
        content: file.content,
      }),
    ),
  );
}

/** Map a registry file entry onto the local path shadcn would write. */
function localPath(item: string, path: string): string | undefined {
  if (item.startsWith('@shadcn/')) return join(ROOT, 'src/components/ui', path.split('/').pop()!);
  const target = path.replace(/^@components\//, 'src/components/').replace(/^@lib\//, 'src/lib/');
  return target.startsWith('src/') ? join(ROOT, target) : undefined;
}

async function format(local: string, code: string): Promise<string> {
  const config = (await prettier.resolveConfig(local)) ?? {};
  return prettier.format(code, { ...config, filepath: local });
}

let drifted = 0;
let reviewed = 0;
let omitted = 0;
let checked = 0;

for (const item of ITEMS) {
  let files: { path: string; content: string }[];
  try {
    files = view(item);
  } catch (error) {
    console.error(`! ${item}: could not be fetched (${(error as Error).message.split('\n')[0]})`);
    continue;
  }

  for (const file of files) {
    const local = localPath(item, file.path);
    if (local && OMITTED[local.replace(`${ROOT}/`, '')]) {
      omitted += 1;
      continue;
    }
    if (!local || !existsSync(local)) continue;
    checked += 1;

    const expected = await format(local, applyTokenMap(file.content, local));
    const actual = readFileSync(local, 'utf8');
    if (expected.trim() === actual.trim()) continue;

    const relative = local.replace(`${ROOT}/`, '');
    const reason = REVIEWED[relative];

    if (reason) {
      reviewed += 1;
      console.log(`~ ${relative}  reviewed: ${reason}`);
      continue;
    }

    drifted += 1;
    console.error(`\n✗ ${relative}  (${item} → ${file.path})`);
    if (VERBOSE) {
      const expectedLines = expected.split('\n');
      const actualLines = actual.split('\n');
      const max = Math.max(expectedLines.length, actualLines.length);
      for (let i = 0; i < max; i += 1) {
        if (expectedLines[i] !== actualLines[i]) {
          console.error(`  ${i + 1}  upstream: ${expectedLines[i] ?? ''}`);
          console.error(`  ${i + 1}  local:    ${actualLines[i] ?? ''}`);
        }
      }
    } else {
      console.error('  Re-run with --verbose to see the differing lines.');
    }
  }
}

console.log(
  `\nregistry drift: ${checked} file(s) checked — ${checked - drifted - reviewed} exact, ${reviewed} reviewed, ${omitted} omitted, ${drifted} unexplained`,
);
process.exit(drifted === 0 ? 0 : 1);
