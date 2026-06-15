/**
 * Inline icons that inherit `currentColor` so they pick up
 * whatever `color: var(--nd-accent)` (or any other) the parent uses.
 *
 * boltIcon is a real inline SVG, not a glyph. The old approach rendered the
 * `⚡︎` codepoint with `font-variant-emoji:text`, but that's unreliable across
 * WebViews/Safari — many systems ignore it and paint the COLORED emoji (which
 * also ignores the CSS color, so a "purple" bolt came out yellow). An SVG is
 * always monochrome and always honors `fill`, so it stays a clean icon
 * everywhere and matches whatever color it's given.
 */

export function boltIcon(size: number = 14, color: string = 'currentColor'): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="${color}" style="display:inline-block;vertical-align:middle;flex-shrink:0" aria-hidden="true"><path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/></svg>`;
}
