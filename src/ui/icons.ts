/**
 * Inline icons that inherit `currentColor` so they pick up
 * whatever `color: var(--nd-accent)` (or any other) the parent uses.
 *
 * boltIcon renders the lightning as a text-style glyph (the monochrome,
 * outlined ⚡ you see with Nostr themes that bundle a symbol font) instead of
 * an SVG. The font stack forces a font that ships text-style emoji glyphs by
 * default so the rendering stays consistent across themes — themes set body
 * font-family with !important, so we match that with inline !important.
 */

const TEXT_BOLT_FONT_STACK = `'Apple Symbols','Segoe UI Symbol','Symbola','Noto Sans Symbols 2',monospace`;

export function boltIcon(size: number = 14, color: string = 'currentColor'): string {
  return `<span style="font-family:${TEXT_BOLT_FONT_STACK} !important;font-variant-emoji:text;font-size:${size}px;line-height:1;color:${color};display:inline-block;vertical-align:middle">⚡︎</span>`;
}
