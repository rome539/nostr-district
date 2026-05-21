/**
 * /api/translate — Proxy to Google Translate's free single-call endpoint.
 *
 * Exists so non-Chrome browsers (which don't have the on-device `Translator`
 * API) can still get chat/DM messages translated. The browser POSTs the
 * source text + target language, this function hits Google's public endpoint
 * server-side (avoiding the CORS block), and returns the translated text plus
 * the detected source language.
 *
 * Cost: free. Cloudflare Pages Functions allow 100k invocations/day on the
 * free plan, and the upstream Google endpoint requires no API key.
 *
 * Same endpoint the `scripts/i18n-fill.mjs` build-time translator uses; just
 * lifted into a Worker so it's callable from the browser at runtime.
 */

const MAX_TEXT_LENGTH = 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid JSON' }, 400); }

  const text   = typeof body?.text === 'string' ? body.text.trim() : '';
  const target = typeof body?.target === 'string' ? body.target.slice(0, 5).toLowerCase() : '';
  if (!text || !target) return json({ error: 'missing text or target' }, 400);
  if (text.length > MAX_TEXT_LENGTH) return json({ error: 'text too long' }, 413);

  // `sl=auto` asks Google to detect the source language. `dt=t` returns the
  // translated chunks; we concat them. The response shape is:
  //   [[["Hola","Hello",null,null,1], ...], null, "en", ...]
  // where index 2 of the outer array is the detected source language tag.
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;

  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch (e) {
    return json({ error: 'upstream fetch failed' }, 502);
  }
  if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);

  let data;
  try { data = await res.json(); }
  catch { return json({ error: 'upstream parse failed' }, 502); }

  const segments   = Array.isArray(data?.[0]) ? data[0] : [];
  const translated = segments.map((s) => (Array.isArray(s) ? s[0] : '')).join('');
  const sourceLang = typeof data?.[2] === 'string' ? data[2].toLowerCase() : null;

  if (!translated) return json({ error: 'empty translation' }, 502);

  return json({ translated, sourceLang });
}
