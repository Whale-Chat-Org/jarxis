import { cn } from '@/lib/utils';

/**
 * The Jarxis brand mark: a geometric `J` knocked out of a rounded square tile.
 *
 * Shared by the public header and the admin sidebar so both surfaces render the identical
 * glyph. The path is the same geometry the static assets are generated from
 * (`scripts/generate-brand.mjs`), inlined here rather than loaded as an `<img>` so it takes
 * its colour from the surrounding theme and needs no network request.
 *
 * Colour comes from `bg-primary` / `text-primary-foreground` on the tile, so the mark follows
 * the light and dark themes automatically. Size is fixed at the `2xl` token (2rem / 32px) and
 * the tile never shrinks, so it keeps its square proportions inside a flex row and inside the
 * collapsed sidebar rail, whose icon button is exactly that size.
 */

/** Glyph geometry on a 64×64 grid, centred by `scripts/generate-brand.mjs`. */
const J_PATH =
  'M27 14 H47 V35 C47 45 41 50 32 50 C23 50 17 45 17 36 H27 C27 40 29 41 32 41 C35 41 37 39 37 35 V24 H27 Z';

export function BrandMark({
  className,
  label,
}: {
  className?: string;
  /**
   * Accessible name for the mark. Omit it when the mark sits next to a visible text label or
   * inside an already-labelled link, so screen readers do not announce the name twice; the
   * SVG is then `aria-hidden` and purely decorative.
   */
  label?: string;
}) {
  return (
    <span
      className={cn(
        'flex size-2xl shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground',
        className,
      )}
    >
      <svg
        aria-hidden={label === undefined ? true : undefined}
        aria-label={label}
        className="size-full"
        data-slot="brand-mark"
        fill="currentColor"
        role={label === undefined ? undefined : 'img'}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d={J_PATH} />
      </svg>
    </span>
  );
}
