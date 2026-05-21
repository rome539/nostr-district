#!/usr/bin/env node
/**
 * scripts/i18n-fill.mjs — Auto-fill missing translation keys.
 *
 * Reads `src/i18n/translations/en.json` (canonical source) and, for every
 * other `<code>.json` file in that directory, fills any missing keys by
 * calling Google Translate's free public endpoint.
 *
 *   node scripts/i18n-fill.mjs            # fill missing keys (preserves existing)
 *   node scripts/i18n-fill.mjs --force    # overwrite EVERY key from English
 *
 * Notes:
 *  - Placeholders like `{name}` and HTML tags like `<br>` are protected from
 *    translation by swapping them for opaque sentinels before the request,
 *    then restored verbatim afterwards. Without this Google mangles them.
 *  - Tiny delay between requests so we don't get throttled.
 *  - Failures (network blips, throttling) leave the original alone and log
 *    a warning — re-running the script picks up where it left off.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const TRANSLATIONS_DIR = path.resolve(__dirname, '..', 'src', 'i18n', 'translations');

const FORCE = process.argv.includes('--force');
const SOURCE_LANG = 'en';
const REQUEST_DELAY_MS = 80; // gentle to Google's endpoint

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Protect `{name}` placeholders and HTML tags so Google doesn't translate
 * their contents. Returns the masked string + a restore() function.
 */
function maskPlaceholders(text) {
  const tokens = [];
  // Vite-style {name} placeholders
  let masked = text.replace(/\{[a-zA-Z0-9_]+\}/g, (m) => {
    const idx = tokens.length;
    tokens.push(m);
    return `␂PH${idx}␃`;
  });
  // HTML tags like <br>, <strong>, <code>, etc.
  masked = masked.replace(/<[^>]+>/g, (m) => {
    const idx = tokens.length;
    tokens.push(m);
    return `␂PH${idx}␃`;
  });

  return {
    masked,
    restore(s) {
      // Be liberal about how Google may have transformed the sentinel —
      // it sometimes drops the leading/trailing control chars or shifts spaces.
      return s.replace(/[␂␃]?PH(\d+)[␂␃]?/g, (_, i) => tokens[Number(i)] ?? '');
    },
  };
}

/**
 * Hit Google Translate's free single-call endpoint. No API key required
 * for low-volume use — it's the same endpoint the consumer translate UI
 * uses. Returns the translated string.
 */
async function googleTranslate(text, targetLang) {
  // `dt=t` returns just the translated text in a nested array shape:
  //   [[["Hola","Hello",null,null,1]],null,"en",...]
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=${SOURCE_LANG}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (i18n-fill script)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // The first array is the translated chunks; concat them in order.
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  return segments.map((s) => (Array.isArray(s) ? s[0] : '')).join('');
}

async function translateString(text, targetLang) {
  const { masked, restore } = maskPlaceholders(text);
  const raw = await googleTranslate(masked, targetLang);
  return restore(raw);
}

async function loadJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function writeJson(file, obj) {
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function main() {
  const enFile = path.join(TRANSLATIONS_DIR, `${SOURCE_LANG}.json`);
  const enDict = await loadJson(enFile);
  const keys = Object.keys(enDict);
  if (keys.length === 0) {
    console.error(`No keys in ${enFile} — fill English first.`);
    process.exit(1);
  }

  const allFiles = (await fs.readdir(TRANSLATIONS_DIR)).filter(f => f.endsWith('.json'));
  const targets  = allFiles
    .map(f => path.basename(f, '.json'))
    .filter(code => code !== SOURCE_LANG);

  console.log(`Source: ${keys.length} keys in ${SOURCE_LANG}.json`);
  console.log(`Targets: ${targets.join(', ')}`);
  console.log(FORCE ? 'Mode: --force (overwrite all)' : 'Mode: fill missing only');
  console.log('');

  for (const lang of targets) {
    const file = path.join(TRANSLATIONS_DIR, `${lang}.json`);
    const existing = await loadJson(file);
    let added = 0, kept = 0, failed = 0;

    for (const key of keys) {
      if (!FORCE && Object.prototype.hasOwnProperty.call(existing, key)) {
        kept++;
        continue;
      }
      const src = enDict[key];
      if (typeof src !== 'string' || src.trim() === '') {
        existing[key] = src;
        continue;
      }
      try {
        const translated = await translateString(src, lang);
        existing[key] = translated;
        added++;
        process.stdout.write(`  [${lang}] ${key.padEnd(38)} → ${translated.slice(0, 50)}${translated.length > 50 ? '…' : ''}\n`);
      } catch (e) {
        failed++;
        console.warn(`  [${lang}] ${key} FAILED:`, e.message);
        if (!FORCE) existing[key] = existing[key] ?? src; // fall back to English source rather than leaving undefined
      }
      await sleep(REQUEST_DELAY_MS);
    }

    // Preserve insertion order of keys as defined in en.json so the files
    // stay diff-friendly and easy to eyeball.
    const ordered = {};
    for (const k of keys) ordered[k] = existing[k];
    // Also keep any keys present in the target but absent from en.json
    // (rare, but don't accidentally delete them).
    for (const k of Object.keys(existing)) if (!(k in ordered)) ordered[k] = existing[k];

    await writeJson(file, ordered);
    console.log(`✓ ${lang}.json — added: ${added}, kept: ${kept}, failed: ${failed}`);
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
