import { defineConfig, globalIgnores } from 'eslint/config';
import { fixupConfigRules } from '@eslint/compat';
import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import tailwind from 'eslint-plugin-better-tailwindcss';

/*
 * Hardcoded design values (`.agent/rules/design-system.md` §2). These are AST rules rather
 * than class-string rules: they also catch `style={{ padding: '13px' }}`, `fill="#fff"` and
 * template literals, which never reach a Tailwind class validator. `$` anchors matter —
 * without them `'#feedback'` would be read as a hex colour.
 */
const hardcodedValueRules = [
  {
    selector: 'Literal[value=/^(?:#[0-9a-fA-F]{3,8}|(?:rgb|hsl|oklch|color-mix)\\(.*)$/]',
    message:
      'Hardcoded colour. Use a semantic colour token (bg-primary, text-muted-foreground) or var(--token).',
  },
  {
    selector:
      'Literal[value=/^-?(?:\\d+|\\d*\\.\\d+)(?:px|rem|em|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ch)$/]',
    message: 'Hardcoded dimension. Use a spacing/size token, or add one to src/styles/tokens.css.',
  },
  {
    selector:
      'TemplateElement[value.raw=/^(?:#[0-9a-fA-F]{3,8}|(?:rgb|hsl|oklch|color-mix)\\(.*)$/]',
    message: 'Hardcoded colour in template literal. Use a semantic colour token or var(--token).',
  },
  {
    selector:
      'TemplateElement[value.raw=/^-?(?:\\d+|\\d*\\.\\d+)(?:px|rem|em|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ch)$/]',
    message: 'Hardcoded dimension in template literal. Use a spacing/size token.',
  },
];

/*
 * Feature code must compose primitives and must not inline design values. `src/components/ui`
 * is deliberately exempt: primitives legitimately bridge third-party runtime CSS variables
 * (see sonner.tsx mapping --normal-bg to var(--popover)).
 */
const featureCompositionRules = [
  {
    selector: "JSXAttribute[name.name='style']",
    message:
      'Inline style in feature code. Use design tokens/utilities, or move the primitive into src/components/ui.',
  },
  {
    selector:
      'JSXOpeningElement[name.name=/^(button|input|select|textarea|dialog|table|thead|tbody|tfoot|tr|th|td|label)$/]',
    message:
      'Hand-rolled primitive. Import it from src/components/ui instead (Button, Input, Table, Field, …).',
  },
];

export default defineConfig([
  // Next's React plugins still use rule-context APIs removed in ESLint 10.
  ...fixupConfigRules([...next, ...ts]),
  // Allow omitting props via rest destructuring, e.g. `{ children, ...props }`.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { ignoreRestSiblings: true }],
    },
  },
  // Upstream Better Auth UI registry components intentionally hydrate browser
  // storage in effects. Keep these two compiler advisories scoped to vendor UI.
  {
    files: ['src/components/auth/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  /*
   * Design tokens only (.agent/rules/design-system.md): tokens.css clears Tailwind's default
   * spacing/type/colour/container/shadow scales, so unknown classes are ad-hoc values.
   *
   * The restrict patterns are an allowlist-bounded denylist; `-*` families whose Tailwind
   * defaults are NOT cleared (blur, ease, aspect, animate) are bounded here rather than in
   * tokens.css because tw-animate-css declares --animate-in/out and consumes --value(--blur-*)
   * / --value(--rotate-*); clearing those namespaces would break dialog/sheet animations.
   *
   * Deliberately NOT enabled: `enforce-canonical-classes` and `enforce-shorthand-classes`
   * rewrite by numeric equivalence, so they propose collapsing `px-page py-lg` into `p-icon`
   * (both 1rem) — clobbering the semantic distinction the token system exists to express.
   * Prettier (prettier-plugin-tailwindcss) owns class order and line wrapping.
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'better-tailwindcss': tailwind },
    settings: { 'better-tailwindcss': { entryPoint: 'src/app/globals.css' } },
    rules: {
      // `toaster` is Sonner's styling hook, not a Tailwind class.
      'better-tailwindcss/no-unknown-classes': ['error', { ignore: ['^toaster$'] }],
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      // Blocks building class names by concatenation — an ad-hoc class smuggling vector.
      'better-tailwindcss/no-concatenated-classes': 'error',
      // Mandates the w-(--x) form documented in §2.
      'better-tailwindcss/enforce-consistent-variable-syntax': 'error',
      'better-tailwindcss/enforce-consistent-important-position': 'error',
      'better-tailwindcss/no-deprecated-classes': 'error',
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            {
              pattern: '-\\[[^\\]]*\\](\\/[^\\s:]+)?$',
              message: 'Arbitrary value in "$0". Add a design token in src/styles/tokens.css.',
            },
            {
              pattern: '(^|:)\\[[^\\]]*:[^\\]]*\\]$',
              message: 'Arbitrary property "$0". Add a design token or @utility in tokens.css.',
            },
            {
              // Zero is the `none` token (§2), so `p-0`/`top-0`/`min-w-0` all fail; the sizing
              // reset is `min-w-none`, which already resolves. The `!?` markers make
              // important-suffixed ad-hoc values fail this rule with a useful message instead
              // of only being caught incidentally as unknown classes.
              pattern:
                '(^|:)!?-?(p[trblxyse]?|m[trblxyse]?|gap(-[xy])?|space-[xy]|w|h|size|min-[wh]|max-[wh]|inset(-[xy])?|top|right|bottom|left|start|end|translate-[xy]|scroll-[mp][trblxy]?|basis|indent)-\\d+(\\.\\d+)?!?$',
              message: 'Numeric spacing/size "$0". Use a spacing or component token.',
            },
            {
              // Also catches the static utilities (max-w-prose, max-w-fit, max-w-screen-*)
              // that escape both the cleared --container-* scale and the old pattern.
              pattern:
                '(^|:)max-w-(?!full$|none$)(prose|3xs|2xs|xs|sm|md|lg|xl|\\dxl|fit|min|max|screen-\\S+)$',
              message:
                'Use a container token for max widths (max-w-narrow, -form, -dialog, -content).',
            },
            {
              pattern: '(^|:)text-(xs|sm|base|lg|\\d?xl)$',
              message: 'Raw font size "$0". Use a typography token (text-caption, text-body…).',
            },
            {
              pattern:
                '(^|:)-?(bg|text|border(-[trblxy])?|ring(-offset)?|fill|stroke|outline|from|via|to|divide|decoration|shadow|accent|caret|placeholder)-(white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\\d+)?(\\/\\S+)?$',
              message: 'Palette colour "$0". Use a semantic colour token.',
            },
            {
              // Only blur-panel is a project token; in/out are tw-animate-css utilities.
              pattern: '(^|:)(backdrop-)?blur-(?!none$|in$|out$|panel$)\\S+$',
              message: 'Unbounded blur "$0". Use backdrop-blur-panel or blur-none.',
            },
            {
              pattern: '(^|:)ease-(?!standard$)\\S+$',
              message: 'Unbounded easing "$0". Use ease-standard.',
            },
            {
              pattern: '(^|:)aspect-(?!square$)\\S+$',
              message: 'Unbounded aspect ratio "$0". Use aspect-square or add a token.',
            },
            {
              // spin/pulse are project animations; in/out/accordion/collapsible/caret-blink
              // come from tw-animate-css.
              pattern:
                '(^|:)animate-(?!spin$|pulse$|in$|out$|accordion-|collapsible-|caret-blink$)\\S+$',
              message: 'Unbounded animation "$0". Use animate-spin/animate-pulse or add a token.',
            },
          ],
        },
      ],
    },
  },
  // Hardcoded colour/dimension literals anywhere in application code.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...hardcodedValueRules] },
  },
  // Feature code additionally must not inline styles or hand-roll primitives.
  {
    files: [
      'src/app/**/*.{ts,tsx}',
      'src/components/admin/**/*.{ts,tsx}',
      'src/components/auth/**/*.{ts,tsx}',
      'src/components/landing/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...hardcodedValueRules, ...featureCompositionRules],
    },
  },
  // Class merging goes through cn from @/lib/utils, which knows the token names.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'clsx', message: 'Use cn from @/lib/utils.' },
            { name: 'tailwind-merge', message: 'Use cn from @/lib/utils.' },
            { name: 'cn', message: 'Use cn from @/lib/utils.' },
            { name: 'cn/config', message: 'Only src/lib/utils.ts may configure cn.' },
          ],
        },
      ],
    },
  },
  // The single legitimate consumer of cn/config.
  {
    files: ['src/lib/utils.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // Must stay last before ignores: turns off stylistic rules that conflict with Prettier.
  prettier,
  globalIgnores([
    '.next/**',
    'src/generated/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    'coverage/**',
    'out/**',
  ]),
]);
