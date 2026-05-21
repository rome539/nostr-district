/**
 * translator.ts — opportunistic chat/DM translation
 *
 * Two backends, picked at call time:
 *   1. Chrome's on-device `Translator` + `LanguageDetector` (free, private,
 *      Chrome 124+ only).
 *   2. `/api/translate` Cloudflare Pages Function — proxies Google Translate's
 *      free public endpoint server-side, so Firefox/Safari/mobile users also
 *      get translations. Same cost model (free for low volume), but goes over
 *      the network and Google sees the text.
 *
 * The rest of the app fires-and-forgets through `maybeTranslate(text)` — never
 * throws, always returns `null` on failure so callers just show the original.
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

/** Cloudflare Pages Function that proxies Google Translate for non-Chrome browsers. */
const REMOTE_TRANSLATE_ENDPOINT = '/api/translate';

/** Upper bound on text we'll send to the remote proxy. Anything longer is rare in chat. */
const REMOTE_MAX_TEXT_LENGTH = 1000;

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

/**
 * True if translation is available at all — either Chrome's on-device API,
 * or the remote proxy (which works in every modern browser).
 *
 * Kept as a single boolean because callers only use this to decide whether
 * to attach a "Show original" toggle: that's worth showing whenever
 * translation *might* fire.
 */
export function isTranslatorSupported(): boolean {
  return hasNativeTranslator() || hasFetch();
}

function hasNativeTranslator(): boolean {
  return typeof self !== 'undefined' && 'Translator' in self;
}

function hasFetch(): boolean {
  return typeof fetch === 'function';
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
  if (!hasNativeTranslator()) return null;
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

/**
 * Translate via the `/api/translate` Cloudflare Pages Function. The proxy
 * hits Google Translate's free public endpoint server-side (browsers can't
 * call it directly because of CORS) and returns the translation plus the
 * detected source language.
 *
 * Used as a fallback when Chrome's on-device API isn't available.
 */
async function remoteTranslate(text: string, targetLang: string): Promise<{ translated: string; sourceLang: string | null } | null> {
  if (!hasFetch()) return null;
  if (text.length > REMOTE_MAX_TEXT_LENGTH) return null;
  try {
    const res = await fetch(REMOTE_TRANSLATE_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, target: targetLang }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.translated !== 'string' || !data.translated) return null;
    return {
      translated: data.translated,
      sourceLang: typeof data.sourceLang === 'string' ? data.sourceLang.toLowerCase() : null,
    };
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
 *   - `null` when no translation should be applied: text too short, detection
 *     unsure, already in user's language, both backends unavailable, or the
 *     active backend failed.
 *
 * Tries Chrome's on-device API first (zero network, private). Falls back to
 * the `/api/translate` proxy so non-Chrome users still get translations.
 *
 * Always safe to call — never throws, never blocks the UI, idempotent via cache.
 */
export async function maybeTranslate(text: string): Promise<TranslationResult | null> {
  const trimmed = text?.trim() ?? '';
  if (trimmed.length < MIN_TEXT_LENGTH) return null;

  const userLang = getUserLang();
  const cacheKey = `${userLang}|${trimmed}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    cached.ts = Date.now();
    if (!cached.translated || !cached.sourceLang) return null;
    return { translated: cached.result, sourceLang: cached.sourceLang };
  }

  if (hasNativeTranslator()) {
    const native = await translateViaNative(trimmed, userLang);
    if (native !== undefined) {
      if (native) cache.set(cacheKey, { result: native.translated, sourceLang: native.sourceLang, translated: true, ts: Date.now() });
      else        cache.set(cacheKey, { result: trimmed,            sourceLang: userLang,           translated: false, ts: Date.now() });
      evictIfFull();
      return native;
    }
    // `undefined` ⇒ native backend was inconclusive (e.g. detector unsure).
    // Fall through to the remote proxy so the user still gets a translation.
  }

  const remote = await remoteTranslate(trimmed, userLang);
  if (!remote || !remote.translated || remote.translated === trimmed) return null;
  if (remote.sourceLang && remote.sourceLang === userLang) {
    cache.set(cacheKey, { result: trimmed, sourceLang: userLang, translated: false, ts: Date.now() });
    evictIfFull();
    return null;
  }
  const sourceLang = remote.sourceLang ?? 'auto';
  cache.set(cacheKey, { result: remote.translated, sourceLang, translated: true, ts: Date.now() });
  evictIfFull();
  return { translated: remote.translated, sourceLang };
}

/**
 * Translate via Chrome's on-device APIs.
 *
 * Tri-state return so the caller knows whether to fall back to the remote proxy:
 *   - `TranslationResult` → translated successfully, no fallback needed.
 *   - `null`              → text is already in user's language; no fallback needed.
 *   - `undefined`         → backend inconclusive (detector unavailable, low
 *                            confidence, or translator-create failed). Try remote.
 */
async function translateViaNative(text: string, userLang: string): Promise<TranslationResult | null | undefined> {
  const detector = await getDetector();
  if (!detector) return undefined;

  let detected: { detectedLanguage: string; confidence: number } | null = null;
  try {
    const results = await detector.detect(text);
    detected = Array.isArray(results) ? results[0] : null;
  } catch {
    return undefined;
  }
  if (!detected || detected.confidence < MIN_DETECT_CONFIDENCE) return undefined;

  const src = detected.detectedLanguage.toLowerCase();
  if (src === userLang) return null;

  const translator = await getTranslator(src, userLang);
  if (!translator) return undefined;

  try {
    const out = await translator.translate(text);
    if (!out || typeof out !== 'string' || out === text) return undefined;
    return { translated: out, sourceLang: src };
  } catch {
    return undefined;
  }
}
