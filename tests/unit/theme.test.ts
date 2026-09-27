import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../../.agent/rules/design-system.md', import.meta.url), 'utf8');
const tokens = (selector: string) =>
  Object.fromEntries(
    [
      ...css
        .slice(css.indexOf(`${selector} {`))
        .split('}')[0]
        .matchAll(/--([\w-]+):\s*(#[\da-f]{6});/g),
    ].map(([, name, value]) => [name, value]),
  );
const luminance = (hex: string) => {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const surfaces = [
  'card',
  'popover',
  'primary',
  'secondary',
  'muted',
  'accent',
  'destructive',
  'sidebar',
  'sidebar-primary',
  'sidebar-accent',
];
// Panels and interactive surfaces that supporting text, warnings and control borders may sit
// on. Wider than background/card/muted so panel and hover contexts are verified too.
const panelSurfaces = [
  'background',
  'card',
  'popover',
  'secondary',
  'muted',
  'accent',
  'sidebar',
  'sidebar-accent',
];
const required = [
  'background',
  'foreground',
  ...surfaces.flatMap((name) => [name, `${name}-foreground`]),
  'border',
  'input',
  'ring',
  ...[1, 2, 3, 4, 5].map((n) => `chart-${n}`),
  'sidebar-border',
  'sidebar-ring',
  'overlay',
  'thumb',
  'warning',
];

describe('semantic theme', () => {
  for (const mode of [':root', '.dark']) {
    const theme = tokens(mode);
    it(`${mode} provides every semantic token and Tailwind alias`, () => {
      expect(Object.keys(theme).sort()).toEqual([...required].sort());
      for (const name of required) expect(css).toContain(`--color-${name}: var(--${name});`);
    });
    it(`${mode} has AA normal-text contrast for semantic foreground pairs`, () => {
      for (const [bg, fg] of [
        ['background', 'foreground'],
        ...surfaces.map((name) => [name, `${name}-foreground`]),
      ]) {
        expect(contrast(theme[bg], theme[fg]), `${bg}/${fg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${mode} keeps supporting text readable on every panel and hover surface`, () => {
      for (const bg of panelSurfaces) {
        expect(
          contrast(theme[bg], theme['muted-foreground']),
          `muted text on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme[bg], theme.warning), `warning text on ${bg}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
    it(`${mode} has visible solid input borders and focus colors`, () => {
      for (const bg of panelSurfaces) {
        for (const token of ['input', 'ring'])
          expect(contrast(theme[bg], theme[token]), `${token} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

// Scale tokens: Tailwind defaults are cleared so only these names exist (see eslint.config.mjs).
const cleared = [
  'color',
  'spacing',
  'text',
  'font',
  'font-weight',
  'leading',
  'tracking',
  'container',
  'shadow',
];
const scaleTokens = [
  ...['none', 'hairline', '3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'].map(
    (n) => `spacing-${n}`,
  ),
  ...['page', 'page-lg', 'section', 'stack', 'stack-sm', 'inline', 'card'].map(
    (n) => `spacing-${n}`,
  ),
  ...['icon', 'avatar', 'control', 'header', 'sidebar'].map((n) => `spacing-${n}`),
  ...['narrow', 'form', 'dialog', 'content'].map((n) => `container-${n}`),
  ...['caption', 'body-sm', 'body', 'heading', 'title', 'headline', 'display'].map(
    (n) => `text-${n}`,
  ),
  ...['xs', 'sm', 'md', 'lg'].map((n) => `shadow-${n}`),
];

describe('design scale tokens', () => {
  it('clears Tailwind default namespaces', () => {
    for (const ns of cleared) expect(css).toContain(`--${ns}-*: initial;`);
  });
  it('defines the documented scale, layout, type, container and shadow tokens', () => {
    for (const name of scaleTokens) expect(css).toMatch(new RegExp(`--${name}:\\s*[^;]+;`));
  });
  it('gives every font-size token a line-height', () => {
    for (const [, name] of css.matchAll(/--text-([\w-]+):\s*[\d.]+rem;/g))
      expect(css).toContain(`--text-${name}--line-height:`);
  });
});

describe('class-merge token lists', () => {
  it('match tokens.css so cn() dedupes token classes', async () => {
    const { designTokens } = await import('../../src/lib/utils');
    const theme = css.slice(css.indexOf('@theme {'), css.indexOf('@theme inline'));
    const inline = css.slice(css.indexOf('@theme inline'));
    const names = (prefix: string, source: string) =>
      [...source.matchAll(new RegExp(`--${prefix}-([\\w-]+?):`, 'g'))]
        .map(([, name]) => name)
        .filter((name) => !name.includes('--'));
    expect([...designTokens.spacing]).toEqual(names('spacing', theme));
    expect([...designTokens.text]).toEqual(names('text', theme));
    expect([...designTokens.container]).toEqual(names('container', theme));
    expect([...designTokens.radius]).toEqual(names('radius', inline));
    expect([...designTokens.blur]).toEqual(names('blur', theme));
    expect([...designTokens.ease]).toEqual(names('ease', theme));
  });
  it('merges token classes', async () => {
    const { cn } = await import('../../src/lib/utils');
    expect(cn('text-body-sm text-primary-foreground')).toBe('text-body-sm text-primary-foreground');
    expect(cn('p-lg', 'p-sm')).toBe('p-sm');
    expect(cn('h-control', 'h-control-sm')).toBe('h-control-sm');
    expect(cn('max-w-narrow', 'max-w-dialog')).toBe('max-w-dialog');
    expect(cn('rounded-chip', 'rounded-md')).toBe('rounded-md');
    expect(cn('blur-sm', 'blur-panel')).toBe('blur-panel');
    expect(cn('backdrop-blur-sm', 'backdrop-blur-panel')).toBe('backdrop-blur-panel');
    expect(cn('ease-linear', 'ease-standard')).toBe('ease-standard');
    expect(cn('aspect-video', 'aspect-square')).toBe('aspect-square');
  });
});

// The rules document is normative: every token and composite utility must be catalogued there,
// otherwise the document silently drifts from tokens.css. This is a name-level alarm — values
// are pinned by the designTokens equality test above plus the contrast assertions.
describe('rules document stays in sync with tokens.css', () => {
  it('catalogues every composite @utility, and no others', () => {
    const section = rules.slice(
      rules.indexOf('### Composite utilities'),
      rules.indexOf('## 4. Colour'),
    );
    const documented = [...section.matchAll(/`([\w-]+)`/g)].map(([, name]) => name).sort();
    const declared = [...css.matchAll(/@utility ([\w-]+)/g)].map(([, name]) => name).sort();
    expect(documented).toEqual(declared);
  });

  it('names every theme token in the catalog', () => {
    const themeBlock = css.slice(css.indexOf('@theme {'), css.indexOf('@theme inline'));
    const inlineBlock = css.slice(css.indexOf('@theme inline'), css.indexOf('@utility'));
    const missing: string[] = [];
    for (const namespace of [
      'spacing',
      'text',
      'container',
      'shadow',
      'radius',
      'blur',
      'ease',
      'aspect',
    ]) {
      const source = `${themeBlock}${inlineBlock}`;
      const names = [...source.matchAll(new RegExp(`--${namespace}-([\\w-]+?):`, 'g'))]
        .map(([, name]) => name)
        .filter((name) => !name.includes('--'));
      for (const name of names) {
        // Accept the bare token (`lg`), or the utility form (`shadow-xs`, `text-body-sm`,
        // `blur-panel`, `aspect-square`).
        const mentioned =
          rules.includes(`\`${name}\``) || new RegExp('`[\\w-]*-' + name + '`').test(rules);
        if (!mentioned) missing.push(`${namespace}:${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
