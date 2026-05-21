/**
 * i18n.ts — Tiny UI-string translation system.
 *
 * Wired to the same `nd-user-lang` localStorage key as `translator.ts`, so the
 * one language selector on the login screen controls both UI labels *and* the
 * target language for incoming chat/DM translation. No framework — vanilla
 * key-value lookup over JSON dictionaries.
 *
 * Usage:
 *   import { t, setLang, onLangChange } from '../i18n/i18n';
 *   button.textContent = t('login.connect_nostr');
 *
 * Adding a language: drop a JSON file at `src/i18n/translations/<code>.json`
 * with the same keys as `en.json`. Missing keys fall back to English, missing
 * languages fall back to English entirely.
 *
 * All language packs are bundled eagerly via `import.meta.glob`. Each file
 * is only ~1.5 kB, so even all 12 fit in <20 kB total — well worth avoiding
 * the runtime-import complexity (which previously triggered Vite full-reloads
 * on language switches in dev mode).
 */

type Dict = Record<string, string>;

const LANG_KEY = 'nd-user-lang';
const FALLBACK_LANG = 'en';
const LANG_CHANGE_EVENT = 'nd-lang-change';

// Vite resolves this glob at build time and inlines every matching file. The
// resulting `modules` map looks like { './translations/en.json': {...}, ... }.
const modules = import.meta.glob<Dict>('./translations/*.json', { eager: true, import: 'default' });

const dictionaries: Record<string, Dict> = {};
for (const path in modules) {
  const code = path.match(/\/([a-z-]+)\.json$/)?.[1];
  if (code) dictionaries[code] = modules[path];
}

let currentLang: string = FALLBACK_LANG;

function detectInitialLang(): string {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && dictionaries[stored]) return stored;
  } catch { /* private mode */ }
  const browser = (navigator.language || FALLBACK_LANG).slice(0, 2).toLowerCase();
  return dictionaries[browser] ? browser : FALLBACK_LANG;
}

/**
 * Translate a key in the current language. Variable substitution uses
 * `{name}` placeholders: `t('greeting', { name: 'Alice' })`.
 *
 * Resolution order: current lang → English → the key itself (so missing
 * translations show up as visible bug markers in dev).
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = dictionaries[currentLang];
  const fallback = dictionaries[FALLBACK_LANG];
  let s = (dict && dict[key]) ?? (fallback && fallback[key]) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

export function getCurrentLang(): string { return currentLang; }

/**
 * Switch the active UI language. Synchronous now that all dictionaries are
 * loaded eagerly. Persists the choice and dispatches `nd-lang-change` so
 * listeners can re-render. Unknown languages fall back to English silently.
 */
export function setLang(lang: string): void {
  const normalized = lang.slice(0, 2).toLowerCase();
  currentLang = dictionaries[normalized] ? normalized : FALLBACK_LANG;
  try { localStorage.setItem(LANG_KEY, currentLang); } catch { /* ignore */ }
  window.dispatchEvent(new Event(LANG_CHANGE_EVENT));
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLangChange(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(LANG_CHANGE_EVENT, handler);
  return () => window.removeEventListener(LANG_CHANGE_EVENT, handler);
}

// Resolve the initial language at module load. No async work needed; all
// dictionaries are already in memory.
currentLang = detectInitialLang();
