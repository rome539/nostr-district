/**
 * translator.ts — opportunistic on-device translation via Chrome's Translator API
 *
 * Wraps two emerging browser APIs (`Translator`, `LanguageDetector`) so the
 * rest of the app can fire-and-forget translation without caring about feature
 * detection. Translation runs entirely on the user's device — no API key, no
 * server, no per-call cost, no data leaves the browser. On unsupported browsers
 * (Firefox/Safari, older Chrome) every call returns `null` and the app falls
 * back to showing the original text.
 *
 * See: https://developer.chrome.com/docs/ai/translator-api
 *      https://developer.chrome.com/docs/ai/language-detection
 */

const USER_LANG_KEY = 'nd-user-lang';

/** Min confidence from the LanguageDetector before we trust its guess. */
const MIN_DETECT_CONFIDENCE = 0.7;

/** Skip detection on very short strings — too noisy to classify reliably. */
const MIN_TEXT_LENGTH = 3;

/** Soft cap on the in-memory translation cache so chat history doesn't grow forever. */
const CACHE_MAX_ENTRIES = 500;

interface CachedEntry {
  /** Translated text, or the original if no translation was applied (so we don't re-detect). */
  result:     string;
  /** Detected language tag (e.g. "es"), or null if detection was inconclusive. */
  sourceLang: string | null;
  /** True if the result is a real translation (vs same-language pass-through). */
  translated: boolean;
  /** Unix ms of last access — for the LRU eviction. */
  ts:         number;
}

const cache = new Map<string, CachedEntry>();

let _detector: any = null;
const _translators = new Map<string, any>(); // key: "src->dst"

export interface TranslationResult {
  translated: string;
  sourceLang: string;
}

/** True if the browser exposes the Translator API at all. */
export function isTranslatorSupported(): boolean {
  return typeof self !== 'undefined' && 'Translator' in self;
}

/**
 * The user's preferred display language. Pulled from localStorage if they've
 * picked one via the (future) UI selector; otherwise inferred from the browser.
 * Trimmed to the primary subtag (so `en-US` → `en`) to match what `Translator`
 * expects.
 */
export function getUserLang(): string {
  try {
    const stored = localStorage.getItem(USER_LANG_KEY);
    if (stored) return stored;
  } catch { /* private mode, etc. */ }
  return (navigator.language || 'en').slice(0, 2).toLowerCase();
}

export function setUserLang(lang: string): void {
  try { localStorage.setItem(USER_LANG_KEY, lang); } catch { /* ignore */ }
}

/** Lazily create the singleton LanguageDetector instance. */
async function getDetector(): Promise<any> {
  if (_detector) return _detector;
  if (typeof self === 'undefined' || !('LanguageDetector' in self)) return null;
  try {
    _detector = await (self as any).LanguageDetector.create();
    return _detector;
  } catch {
    return null;
  }
}

/** Lazily create + cache a Translator for a specific language pair. */
async function getTranslator(srcLang: string, dstLang: string): Promise<any> {
  const key = `${srcLang}->${dstLang}`;
  const existing = _translators.get(key);
  if (existing) return existing;
  if (!isTranslatorSupported()) return null;
  try {
    const t = await (self as any).Translator.create({
      sourceLanguage: srcLang,
      targetLanguage: dstLang,
    });
    _translators.set(key, t);
    return t;
  } catch {
    return null;
  }
}

/** Drop the least-recently-used entry if we're over the cap. */
function evictIfFull(): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [k, v] of cache) {
    if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
  }
  if (oldestKey) cache.delete(oldestKey);
}

/**
 * Detect language and translate to the user's language if it's foreign.
 *
 * Returns:
 *   - `{ translated, sourceLang }` when the text was successfully translated.
 *   - `null` when no translation should be applied: API unsupported, text too
 *     short, detection unsure, already in user's language, or translation failed.
 *
 * Always safe to call — never throws, never blocks the UI, idempotent via cache.
 */
export async function maybeTranslate(text: string): Promise<TranslationResult | null> {
  const trimmed = text?.trim() ?? '';
  if (trimmed.length < MIN_TEXT_LENGTH) return null;
  if (!isTranslatorSupported()) return null;

  const userLang = getUserLang();
  const cacheKey = `${userLang}|${trimmed}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    cached.ts = Date.now();
    if (!cached.translated || !cached.sourceLang) return null;
    return { translated: cached.result, sourceLang: cached.sourceLang };
  }

  const detector = await getDetector();
  if (!detector) return null;

  let detected: { detectedLanguage: string; confidence: number } | null = null;
  try {
    const results = await detector.detect(trimmed);
    detected = Array.isArray(results) ? results[0] : null;
  } catch {
    return null;
  }
  if (!detected || detected.confidence < MIN_DETECT_CONFIDENCE) return null;

  const src = detected.detectedLanguage.toLowerCase();
  if (src === userLang) {
    cache.set(cacheKey, { result: trimmed, sourceLang: src, translated: false, ts: Date.now() });
    evictIfFull();
    return null;
  }

  const translator = await getTranslator(src, userLang);
  if (!translator) return null;

  try {
    const out = await translator.translate(trimmed);
    if (!out || typeof out !== 'string' || out === trimmed) {
      cache.set(cacheKey, { result: trimmed, sourceLang: src, translated: false, ts: Date.now() });
      evictIfFull();
      return null;
    }
    cache.set(cacheKey, { result: out, sourceLang: src, translated: true, ts: Date.now() });
    evictIfFull();
    return { translated: out, sourceLang: src };
  } catch {
    return null;
  }
}
