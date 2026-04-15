/**
 * sanitize.ts — shared HTML sanitization utilities
 * Single source of truth — replaces the duplicated esc() in every UI file.
 */

/** Escape a string for safe insertion into HTML text content / attributes. */
export function esc(s: unknown): string {
  const str = String(s ?? '');
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/**
 * Sanitize a URL for use in an HTML attribute (e.g. img src).
 * Allows only http/https URLs — strips anything else (data:, javascript:, etc.).
 * Also escapes any remaining quotes/angle-brackets so it can't break out of an attribute.
 */
export function safeUrl(url: unknown): string {
  const str = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(str)) return '';
  return str.replace(/['"<>]/g, c => ({ "'": '%27', '"': '%22', '<': '%3C', '>': '%3E' }[c] ?? c));
}
