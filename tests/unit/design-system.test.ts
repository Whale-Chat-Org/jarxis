import { ESLint } from 'eslint';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * Guards the guard (.agent/rules/design-system.md §8).
 *
 * `pnpm lint` proves the current source is clean; this suite proves the rules that make it
 * clean are still switched on and still catch what the design-system rules promise. Weakening
 * a restrict pattern in eslint.config.mjs fails here instead of silently passing lint.
 *
 * Each probe file puts one declaration per line, so a reported line maps back to the class
 * (or statement) that caused it.
 */

const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const eslint = new ESLint({ cwd: root });

const lint = async (code: string, filePath: string) => {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
};

const classSource = (classes: string[]) =>
  classes
    .map((name, index) => `export const C${index} = () => <div className="${name}" />;`)
    .join('\n');

const RULE = 'better-tailwindcss/no-restricted-classes';
const SYNTAX = 'no-restricted-syntax';
const IMPORTS = 'no-restricted-imports';

describe('ad-hoc Tailwind classes are rejected', () => {
  // Every entry is an example the rules document as forbidden (§2). `min-w-0` is included
  // because zero is the `none` token; `min-w-none` is the allowed reset.
  const forbidden: Array<[name: string, rule: string]> = [
    ['p-4', RULE],
    ['gap-2', RULE],
    ['w-64', RULE],
    ['size-4', RULE],
    ['mt-1.5', RULE],
    ['min-w-0', RULE],
    ['p-4!', RULE],
    ['!p-4', RULE],
    ['top-0', RULE],
    ['text-sm', RULE],
    ['text-xs', RULE],
    ['text-[15px]', RULE],
    ['max-w-sm', RULE],
    ['max-w-prose', RULE],
    ['max-w-screen-md', RULE],
    ['bg-zinc-800', RULE],
    ['text-white', RULE],
    ['blur-lg', RULE],
    ['ease-linear', RULE],
    ['aspect-video', RULE],
    ['animate-bounce', RULE],
  ];

  it.each(forbidden)('rejects %s with %s', async (name, rule) => {
    const messages = await lint(classSource([name]), 'src/__probe__.tsx');
    expect(messages.map((message) => message.ruleId)).toContain(rule);
  });

  it('rejects every forbidden example in one pass', async () => {
    const messages = await lint(classSource(forbidden.map(([name]) => name)), 'src/__probe__.tsx');
    const missing = forbidden.filter(
      ([, rule], index) =>
        !messages.some((message) => message.line === index + 1 && message.ruleId === rule),
    );
    expect(missing.map(([name]) => name)).toEqual([]);
  });
});

describe('token-based equivalents stay allowed', () => {
  const allowed = [
    // Fractions, keywords and the `none` zero token (§2).
    'w-full',
    'w-1/2',
    'w-fit',
    'h-svh',
    'p-none',
    'inset-none',
    'min-w-none',
    'min-h-none',
    'max-w-full',
    'max-w-none',
    // Namespaces Tailwind has no theme scale for (§2).
    'opacity-50',
    'z-50',
    'border-2',
    'ring-3',
    'grid-cols-3',
    'duration-200',
    'order-2',
    // Project tokens.
    'px-page',
    'text-body-sm',
    'text-caption',
    'rounded-chip',
    'gap-2xs',
    '-mx-md',
    'bg-overlay/50',
    // Runtime CSS-variable shorthand, never a design value (§2).
    'w-(--radix-select-trigger-width)',
    // Bounded effect allowlists (§3).
    'blur-none',
    'backdrop-blur-panel',
    'ease-standard',
    'aspect-square',
    'animate-spin',
    'animate-pulse',
    'animate-in',
    'animate-out',
  ];

  it('reports nothing for any allowed class', async () => {
    const messages = await lint(classSource(allowed), 'src/__probe__.tsx');
    const offenders = messages.map((message) => `${allowed[message.line - 1]}: ${message.ruleId}`);
    expect(offenders).toEqual([]);
  });
});

describe('hardcoded values and unstandardised composition are rejected', () => {
  const cases: Array<[label: string, file: string, code: string, rule: string | null]> = [
    // Literals: also catches values that never reach a Tailwind class validator.
    [
      'hex colour literal',
      'src/components/admin/__probe__.tsx',
      `export const A = () => <div fill="#ff0000" />;`,
      SYNTAX,
    ],
    [
      'dimension literal',
      'src/components/admin/__probe__.tsx',
      `export const A = () => <div style={{ width: '13px' }} />;`,
      SYNTAX,
    ],
    [
      'colour in template literal',
      'src/components/admin/__probe__.tsx',
      'export const A = () => <div style={{ color: `#ff0000` }} />;',
      SYNTAX,
    ],
    // Inline styles are forbidden in feature code, permitted in primitives (§2).
    [
      'inline style in feature code',
      'src/components/admin/__probe__.tsx',
      `export const A = () => <div style={{ width: 300 }} />;`,
      SYNTAX,
    ],
    [
      'inline style in a primitive',
      'src/components/ui/__probe__.tsx',
      `export const A = () => <div style={{ '--normal-bg': 'var(--popover)' }} />;`,
      null,
    ],
    [
      'inline style in chat',
      'src/components/chat/__probe__.tsx',
      `export const A = () => <div style={{ width: 300 }} />;`,
      SYNTAX,
    ],
    [
      'hand-rolled chat control',
      'src/components/chat/__probe__.tsx',
      `export const A = () => <button />;`,
      SYNTAX,
    ],
    // Primitives are composed, not hand-rolled (§1).
    [
      'hand-rolled button',
      'src/components/admin/__probe__.tsx',
      `export const A = () => <button type="button" />;`,
      SYNTAX,
    ],
    [
      'hand-rolled table',
      'src/app/__probe__.tsx',
      `export const A = () => <table><tbody><tr><td>a</td></tr></tbody></table>;`,
      SYNTAX,
    ],
    [
      'hand-rolled button in a primitive',
      'src/components/ui/__probe__.tsx',
      `export const A = () => <button type="button" />;`,
      null,
    ],
    // Raw <form> is allowed: no Form primitive exists and TanStack Form needs the element.
    [
      'raw form element',
      'src/components/auth/__probe__.tsx',
      `export const A = () => <form onSubmit={() => {}} />;`,
      null,
    ],
    [
      'token reference in an attribute',
      'src/components/admin/__probe__.tsx',
      `export const A = () => <div fill="var(--primary)" />;`,
      null,
    ],
    // cn is configured in one place only (§2).
    [
      'direct clsx import',
      'src/components/admin/__probe__.tsx',
      `import clsx from 'clsx';\nexport const A = () => clsx('a');`,
      IMPORTS,
    ],
    [
      'direct tailwind-merge import',
      'src/components/admin/__probe__.tsx',
      `import { twMerge } from 'tailwind-merge';\nexport const A = () => twMerge('a');`,
      IMPORTS,
    ],
    [
      'cn configuration outside utils',
      'src/components/admin/__probe__.tsx',
      `import { createCn } from 'cn/config';\nexport const A = () => createCn({});`,
      IMPORTS,
    ],
    [
      'cn configuration in src/lib/utils.ts',
      'src/lib/utils.ts',
      `import { createCn } from 'cn/config';\nexport const cn = createCn({});`,
      null,
    ],
  ];

  it.each(cases)('%s', async (_label, file, code, rule) => {
    const messages = await lint(code, file);
    if (rule === null) {
      expect(messages.map((message) => `${message.ruleId}: ${message.message}`)).toEqual([]);
      return;
    }
    expect(messages.map((message) => message.ruleId)).toContain(rule);
  });
});

describe('stylesheets other than tokens.css hold no hardcoded values', () => {
  const cssFiles = (directory: string): string[] =>
    readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? cssFiles(path) : path.endsWith('.css') ? [path] : [];
    });

  const colour = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/;
  const dimension = /-?\d*\.?\d+(?:px|rem|em|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ch)\b/;
  const files = cssFiles('src');

  it('finds the token source', () => {
    expect(files).toContain('src/styles/tokens.css');
  });

  it('confines raw colour and dimension values to src/styles/tokens.css', () => {
    const offenders = files
      .filter((file) => file !== 'src/styles/tokens.css')
      .flatMap((file) => {
        const source = readFileSync(join(root, file), 'utf8');
        return [colour, dimension]
          .filter((pattern) => pattern.test(source))
          .map((pattern) => `${file} matches ${pattern}`);
      });
    expect(offenders).toEqual([]);
  });

  it('keeps globals.css to imports and variants', () => {
    const lines = readFileSync(join(root, 'src/app/globals.css'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('/*'));
    expect(
      lines.every((line) => line.startsWith('@import') || line.startsWith('@custom-variant')),
    ).toBe(true);
  });
});
