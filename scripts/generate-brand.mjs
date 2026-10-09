#!/usr/bin/env node
/**
 * Reproducible Jarxis brand asset generator.
 *
 * Single source of truth: the `J` path and tile geometry below. Everything else — the SVG
 * masters under `public/brand/`, the PNG square-mark exports, `src/app/icon.svg`,
 * `src/app/favicon.ico` and `src/app/apple-icon.png` — is derived, so re-running the script
 * reproduces byte-identical output and no asset is ever hand-edited.
 *
 *   node scripts/generate-brand.mjs
 *
 * Rasterisation uses the `sharp` already present in the lockfile (a transitive dependency of
 * the toolchain). No dependency is installed. The multi-size favicon is assembled from PNG
 * frames directly: ICO is a 6-byte header plus one 16-byte directory entry per frame, and
 * every modern browser accepts PNG-compressed frames.
 */
import { createRequire } from 'node:module';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── Geometry ─────────────────────────────────────────────────────────────────────────── */

const TILE = 64;
/** Rounded-square tile corner radius; ~22% of the tile, matching the panel radius family. */
const TILE_RADIUS = 14;

/** Minimal geometric monochrome `J`, drawn on a 64×64 grid. */
const J_PATH =
  'M24 18 H44 V39 C44 49 38 54 29 54 C20 54 14 49 14 40 H24 C24 44 26 45 29 45 C32 45 34 43 34 39 V28 H24 Z';
/*
 * The glyph's own bounding box is x 14–44 (width 30) and y 18–54 (height 36), which is
 * off-centre inside the tile. Centring it leaves a symmetric 17px horizontal and 14px vertical
 * margin: dx = (64 - 30) / 2 - 14 = 3, dy = (64 - 36) / 2 - 18 = -4.
 */
const J_OFFSET = { x: (TILE - 30) / 2 - 14, y: (TILE - 36) / 2 - 18 };
const J_TRANSFORM = `translate(${J_OFFSET.x} ${J_OFFSET.y})`;

/**
 * The same path with the offset baked into its coordinates, for the knockout master where a
 * `transform` cannot be scoped to one subpath. `J_PATH` uses only absolute M/H/V/C/Z, so the
 * shift is a straight per-command coordinate translation.
 */
const shiftedJ = () =>
  J_PATH.replace(/([MHVC])\s*([-\d.\s]*)/g, (_, command, args) => {
    const numbers = args
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (command === 'H') return `H${numbers.map((n) => n + J_OFFSET.x).join(' ')} `;
    if (command === 'V') return `V${numbers.map((n) => n + J_OFFSET.y).join(' ')} `;
    const shifted = numbers.map((n, i) => (i % 2 === 0 ? n + J_OFFSET.x : n + J_OFFSET.y));
    return `${command}${shifted.join(' ')} `;
  }).trim();

/* ── Palette ──────────────────────────────────────────────────────────────────────────── */

/**
 * Taken from the theme tokens in `src/styles/tokens.css`: the light variant is the light
 * `--primary` / `--primary-foreground` pair, the dark variant the `.dark` pair. Static assets
 * cannot read CSS variables, so the sRGB equivalents are inlined here only.
 */
const THEMES = {
  light: { tile: '#171717', glyph: '#fafafa' },
  dark: { tile: '#e5e5e5', glyph: '#171717' },
};

const PNG_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512];
const FAVICON_SIZES = [16, 32, 48];
const APPLE_ICON_SIZE = 180;

/* ── SVG sources ──────────────────────────────────────────────────────────────────────── */

const header = (width, height, title, desc) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">\n` +
  `  <title id="t">${title}</title>\n  <desc id="d">${desc}</desc>\n`;

/**
 * Theme-agnostic master: the tile takes `currentColor` and the `J` is knocked out of it with
 * the even-odd fill rule, so one path works on any background and in any colour.
 */
const markMaster = () =>
  header(TILE, TILE, 'Jarxis', 'Jarxis monogram: a geometric J on a rounded square tile.') +
  `  <path fill="currentColor" fill-rule="evenodd" d="M0 ${TILE_RADIUS}` +
  `a${TILE_RADIUS} ${TILE_RADIUS} 0 0 1 ${TILE_RADIUS} -${TILE_RADIUS}` +
  `h${TILE - 2 * TILE_RADIUS}a${TILE_RADIUS} ${TILE_RADIUS} 0 0 1 ${TILE_RADIUS} ${TILE_RADIUS}` +
  `v${TILE - 2 * TILE_RADIUS}a${TILE_RADIUS} ${TILE_RADIUS} 0 0 1 -${TILE_RADIUS} ${TILE_RADIUS}` +
  `h-${TILE - 2 * TILE_RADIUS}a${TILE_RADIUS} ${TILE_RADIUS} 0 0 1 -${TILE_RADIUS} -${TILE_RADIUS}` +
  `Z ${shiftedJ()}"/>\n</svg>\n`;

/** Fixed-colour tile variant, for contexts that cannot supply `currentColor`. */
const markVariant = ({ tile, glyph }) =>
  header(TILE, TILE, 'Jarxis', 'Jarxis monogram: a geometric J on a rounded square tile.') +
  `  <rect width="${TILE}" height="${TILE}" rx="${TILE_RADIUS}" fill="${tile}"/>\n` +
  `  <path transform="${J_TRANSFORM}" d="${J_PATH}" fill="${glyph}"/>\n</svg>\n`;

/** Favicon: one file that follows the user's colour scheme. */
const markAdaptive = () =>
  header(TILE, TILE, 'Jarxis', 'Jarxis monogram: a geometric J on a rounded square tile.') +
  '  <style>\n' +
  `    .tile { fill: ${THEMES.light.tile}; }\n` +
  `    .glyph { fill: ${THEMES.light.glyph}; }\n` +
  '    @media (prefers-color-scheme: dark) {\n' +
  `      .tile { fill: ${THEMES.dark.tile}; }\n` +
  `      .glyph { fill: ${THEMES.dark.glyph}; }\n` +
  '    }\n  </style>\n' +
  `  <rect class="tile" width="${TILE}" height="${TILE}" rx="${TILE_RADIUS}"/>\n` +
  `  <path class="glyph" transform="${J_TRANSFORM}" d="${J_PATH}"/>\n</svg>\n`;

/**
 * Wordmark: the tile mark plus the Jarxis name. The name is set in the same UI font stack as
 * `--font-ui`, so it is an SVG-only asset — it is deliberately not rasterised, because a PNG
 * would bake in whichever font happened to be installed on the generating machine.
 */
const WORDMARK_WIDTH = 208;
const WORDMARK_HEIGHT = 64;
const FONT_STACK =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const wordmark = ({ tile, glyph }) =>
  header(WORDMARK_WIDTH, WORDMARK_HEIGHT, 'Jarxis', 'Jarxis wordmark: the J monogram and name.') +
  `  <rect width="${TILE}" height="${TILE}" rx="${TILE_RADIUS}" fill="${tile}"/>\n` +
  `  <path transform="${J_TRANSFORM}" d="${J_PATH}" fill="${glyph}"/>\n` +
  `  <text x="80" y="43" fill="${tile}" font-family="${FONT_STACK}" font-size="34" font-weight="600" letter-spacing="-0.5">Jarxis</text>\n` +
  '</svg>\n';

/* ── Rasterisation ────────────────────────────────────────────────────────────────────── */

/** `sharp` is a transitive dependency, so it may only exist inside the pnpm store. */
async function loadSharp() {
  try {
    return require('sharp');
  } catch {
    const store = path.join(repoRoot, 'node_modules/.pnpm');
    const entry = (await readdir(store)).find((name) => name.startsWith('sharp@'));
    if (!entry) throw new Error('sharp is not available; cannot rasterise brand assets.');
    return require(path.join(store, entry, 'node_modules/sharp'));
  }
}

const rasterise = (sharp, svg, size) =>
  sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

/** Assemble an ICO container from already-encoded PNG frames. */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette colours: 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map(({ data }) => data)]);
}

/* ── Main ─────────────────────────────────────────────────────────────────────────────── */

async function main() {
  const sharp = await loadSharp();
  const brandDir = path.join(repoRoot, 'public/brand');
  const pngDir = path.join(brandDir, 'png');
  const appDir = path.join(repoRoot, 'src/app');
  await mkdir(pngDir, { recursive: true });

  const written = [];
  const emit = async (target, data) => {
    await writeFile(target, data);
    written.push(path.relative(repoRoot, target));
  };

  await emit(path.join(brandDir, 'jarxis-mark.svg'), markMaster());
  await emit(path.join(brandDir, 'jarxis-mark-adaptive.svg'), markAdaptive());
  for (const [name, theme] of Object.entries(THEMES)) {
    await emit(path.join(brandDir, `jarxis-mark-${name}.svg`), markVariant(theme));
    await emit(path.join(brandDir, `jarxis-wordmark-${name}.svg`), wordmark(theme));
  }

  for (const [name, theme] of Object.entries(THEMES)) {
    const svg = markVariant(theme);
    for (const size of PNG_SIZES) {
      await emit(
        path.join(pngDir, `jarxis-mark-${name}-${size}.png`),
        await rasterise(sharp, svg, size),
      );
    }
  }

  // Next.js app-icon conventions (see node_modules/next/dist/docs → app-icons.md):
  // `icon.svg` and `favicon.ico` must sit in the root `app/` segment; `apple-icon.png` is the
  // touch icon. The light tile is used for the fixed-colour raster icons because both iOS and
  // the Windows taskbar composite them on light chrome.
  await emit(path.join(appDir, 'icon.svg'), markAdaptive());
  const lightSvg = markVariant(THEMES.light);
  const frames = [];
  for (const size of FAVICON_SIZES)
    frames.push({ size, data: await rasterise(sharp, lightSvg, size) });
  await emit(path.join(appDir, 'favicon.ico'), buildIco(frames));
  await emit(
    path.join(appDir, 'apple-icon.png'),
    await rasterise(sharp, lightSvg, APPLE_ICON_SIZE),
  );

  console.log(`Generated ${written.length} brand assets:`);
  for (const file of written) console.log(`  ${file}`);
}

await main();
