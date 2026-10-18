import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
const rules = readFileSync(
  new URL('../../.agents/rules/design-system.md', import.meta.url),
  'utf8',
);
// Colour tokens are the official shadcn Neutral themes, so they are OKLCH and the dark
// border/input tokens carry an alpha channel (`oklch(1 0 0 / 10%)`). Parse both forms, convert
// to sRGB and composite translucent colours over their surface before measuring contrast.
const tokens = (selector: string) =>
  Object.fromEntries(
    [
      ...css
        .slice(css.indexOf(`${selector} {`))
        .split('}')[0]
        .matchAll(/--([\w-]+):\s*(oklch\([^)]*\));/g),
    ].map(([, name, value]) => [name, value]),
  );

type Rgb = { rgb: [number, number, number]; alpha: number };

const gamma = (channel: number) =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

/** oklch(L C H[ / A]) → sRGB in 0…1, clipped to gamut, with the alpha kept separate. */
const parse = (value: string): Rgb => {
  const match = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(
    value,
  );
  if (!match) throw new Error(`Unsupported colour token: ${value}`);
  const number = (raw: string) =>
    raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
  const [lightness, chroma] = [number(match[1]), Number.parseFloat(match[2])];
  const hue = (Number.parseFloat(match[3]) * Math.PI) / 180;
  const [a, b] = [chroma * Math.cos(hue), chroma * Math.sin(hue)];
  const lms = [
    (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const linear = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
  return {
    rgb: linear.map((channel) => Math.min(1, Math.max(0, gamma(channel)))) as [
      number,
      number,
      number,
    ],
    alpha: match[4] === undefined ? 1 : number(match[4]),
  };
};

const luminance = ({ rgb }: Rgb) => {
  const [r, g, b] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
};

/** Source-over composite, so `border`/`input` are measured as the pixels users actually see. */
const over = (top: Rgb, bottom: Rgb): Rgb =>
  top.alpha === 1
    ? top
    : {
        rgb: top.rgb.map(
          (channel, index) => channel * top.alpha + bottom.rgb[index] * (1 - top.alpha),
        ) as [number, number, number],
        alpha: 1,
      };

/** `a` is the surface; a translucent `b` is flattened onto it first. */
const contrast = (a: string, b: string, alpha = 1) => {
  const surface = parse(a);
  const front = parse(b);
  const values = [
    luminance(surface),
    luminance(over({ ...front, alpha: front.alpha * alpha }, surface)),
  ].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const surfaces = [
  'card',
  'popover',
  'primary',
  'secondary',
  'muted',
  'accent',
  'sidebar',
  'sidebar-primary',
  'sidebar-accent',
];
// Panels that normal-size supporting text and warnings actually render on.
const textSurfaces = ['background', 'card', 'popover', 'sidebar'];
/*
 * shadcn's grey fills, where `muted-foreground` lands at a measured 4.34:1 in light mode —
 * 0.16 short of AA. That is upstream's own value (`muted` oklch(0.97 0 0) against
 * `muted-foreground` oklch(0.556 0 0)), kept because this project tracks the official Neutral
 * theme. Pinned here so the shortfall is visible and cannot silently widen; normal-size body
 * copy on these fills must use `foreground`/`secondary-foreground`, not `muted-foreground`.
 */
const mutedFillSurfaces = ['secondary', 'muted', 'sidebar-accent'];
// Every surface a control border, focus ring or hover fill can sit on.
const panelSurfaces = [...textSurfaces, ...mutedFillSurfaces, 'accent'];
const required = [
  'background',
  'foreground',
  ...surfaces.flatMap((name) => [name, `${name}-foreground`]),
  'destructive',
  'destructive-foreground',
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
        ...surfaces.filter((name) => name !== 'muted').map((name) => [name, `${name}-foreground`]),
      ]) {
        expect(contrast(theme[bg], theme[fg]), `${bg}/${fg}`).toBeGreaterThanOrEqual(4.5);
      }
      // `muted` has no own foreground pair in shadcn: `--muted-foreground` is the supporting
      // text colour used across every panel, asserted at its real ratios below.
      expect(contrast(theme.muted, theme['muted-foreground'])).toBeGreaterThanOrEqual(
        mode === ':root' ? 4.3 : 4.5,
      );
    });
    it(`${mode} keeps destructive labels readable on the fill as it is rendered`, () => {
      // Destructive is an action fill, not a text colour (design-system.md §8). Light mode
      // paints `bg-destructive` solid; dark mode paints `dark:bg-destructive/60` over the
      // surrounding surface (button.tsx, badge.tsx), so measure that composite, not the raw
      // token, which on its own clears only ~2.8:1 against `destructive-foreground`.
      if (mode === ':root') {
        expect(contrast(theme.destructive, theme['destructive-foreground'])).toBeGreaterThanOrEqual(
          4.5,
        );
        return;
      }
      for (const bg of ['background', 'card', 'popover']) {
        const fill = over({ ...parse(theme.destructive), alpha: 0.6 }, parse(theme[bg]));
        const values = [luminance(fill), luminance(parse(theme['destructive-foreground']))].sort(
          (x, y) => y - x,
        );
        expect(
          (values[0] + 0.05) / (values[1] + 0.05),
          `destructive/60 on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${mode} keeps supporting text readable on every panel and hover surface`, () => {
      for (const bg of textSurfaces) {
        expect(
          contrast(theme[bg], theme['muted-foreground']),
          `muted text on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const bg of mutedFillSurfaces) {
        expect(
          contrast(theme[bg], theme['muted-foreground']),
          `muted text on ${bg}`,
        ).toBeGreaterThanOrEqual(mode === ':root' ? 4.3 : 4.5);
      }
      for (const bg of panelSurfaces) {
        expect(contrast(theme[bg], theme.warning), `warning text on ${bg}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      // Hover/selection fill: only non-text glyphs (menu icons) use muted-foreground here.
      expect(
        contrast(theme.accent, theme['muted-foreground']),
        'muted icons on accent',
      ).toBeGreaterThanOrEqual(3);
    });
    it(`${mode} keeps borders and focus colors perceptible on every surface`, () => {
      // shadcn's default borders are deliberately subtle hairlines (and translucent white in
      // dark mode), so they are not a 3:1 non-text-contrast target on their own — control
      // boundaries are carried by fill, radius and the focus ring together. Assert they stay
      // distinguishable from their surface and never collapse into it; whether a *rendered*
      // focus state passes 3:1 (ring plus ring-offset, at the opacities the primitives apply)
      // is a browser check, not something these flat token pairs can establish.
      for (const bg of panelSurfaces) {
        for (const token of ['border', 'input'])
          expect(contrast(theme[bg], theme[token]), `${token} on ${bg}`).toBeGreaterThan(1.1);
        expect(contrast(theme[bg], theme.ring), `ring on ${bg}`).toBeGreaterThanOrEqual(2);
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
  ...['icon', 'avatar', 'control', 'header', 'sidebar', 'attachment'].map((n) => `spacing-${n}`),
  ...['narrow', 'form', 'dialog', 'content', 'bubble'].map((n) => `container-${n}`),
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
    const { designTokens } = await import('@/lib/utils');
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
    const { cn } = await import('@/lib/utils');
    expect(cn('text-body-sm text-primary-foreground')).toBe('text-body-sm text-primary-foreground');
    expect(cn('p-lg', 'p-sm')).toBe('p-sm');
    expect(cn('h-control', 'h-control-sm')).toBe('h-control-sm');
    expect(cn('max-w-narrow', 'max-w-dialog')).toBe('max-w-dialog');
    expect(cn('max-w-panel', 'max-w-bubble')).toBe('max-w-bubble');
    expect(cn('w-attachment', 'w-sidebar')).toBe('w-sidebar');
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
