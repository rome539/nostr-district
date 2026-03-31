/**
 * nostrThemeService.ts — Kind 16767 custom theme support
 *
 * Fetches the logged-in user's kind 16767 event and applies it as scoped
 * CSS custom properties on panel elements only (.fp-panel, .dm-panel,
 * #profile-modal, #computer-panel). The game canvas / Phaser world is
 * unaffected because it uses hardcoded P.xxx colour constants.
 *
 * Kind 16767 tag format (Ditto):
 *   ["c", "#rrggbb", "role"]   — colour; roles: background | text | primary
 *   ["f", "Font Name", "url"]  — custom web font (woff2)
 */

const PANEL_SELECTORS  = '.fp-panel, .dm-panel, #profile-modal';
const STYLE_ID         = 'nd-nostr-theme';
const ENABLED_KEY      = 'nd_nostr_theme_enabled';
const CACHED_THEME_KEY = 'nd_nostr_theme_cache';

// Fallback relays used only if we can't determine the user's own relay list
export const FALLBACK_RELAYS = [
  'wss://relay.ditto.pub',    // Ditto's public relay — primary source for kind 16767/36767
  'wss://nos.lol',
  'wss://nostr.wine',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://purplepag.es',
  'wss://relay.mostr.pub',
];

export interface NostrFont {
  name: string;
  url: string;
}

export interface NostrTheme {
  background: string;
  text: string;
  primary: string;
  title?: string;
  bodyFont?: NostrFont;   // ["f", name, url, "body"] or legacy 3-element
  titleFont?: NostrFont;  // ["f", name, url, "title"]
  bgUrl?: string;         // ["bg", "url ...", ...]
  bgMode?: 'cover' | 'tile';
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function saveThemeCache(theme: NostrTheme): void {
  try { localStorage.setItem(CACHED_THEME_KEY, JSON.stringify(theme)); } catch { /* ignore */ }
}

function loadThemeCache(): NostrTheme | null {
  try {
    const raw = localStorage.getItem(CACHED_THEME_KEY);
    return raw ? (JSON.parse(raw) as NostrTheme) : null;
  } catch { return null; }
}

// ── Module state ──────────────────────────────────────────────────────────────

let _cached:  NostrTheme | null = loadThemeCache();
let _enabled: boolean = localStorage.getItem(ENABLED_KEY) === '1';
let _loading: boolean = false;
let _onChange: (() => void) | null = null;

export function getNostrTheme():        NostrTheme | null { return _cached; }
export function isNostrThemeEnabled():  boolean           { return _enabled; }
export function isNostrThemeLoading():  boolean           { return _loading; }

export function onNostrThemeChange(fn: () => void): () => void {
  _onChange = fn;
  return () => { if (_onChange === fn) _onChange = null; };
}


// ── Parse ─────────────────────────────────────────────────────────────────────

export function parseKind16767(event: { tags: string[][] }): NostrTheme | null {
  const colors: Record<string, string> = {};
  let bodyFont:  NostrFont | undefined;
  let titleFont: NostrFont | undefined;
  let bgUrl:     string | undefined;
  let bgMode:    'cover' | 'tile' | undefined;
  let themeTitle: string | undefined;

  for (const tag of event.tags) {
    // ── c tag: color roles ─────────────────────────────────────────────────
    if (tag[0] === 'c' && tag[1] && tag[2]) {
      const role  = tag[2].toLowerCase();
      const color = tag[1].trim();
      // Accept 3 or 6 digit hex, with or without #, case-insensitive
      const hex = color.startsWith('#') ? color : '#' + color;
      if (/^#[0-9a-fA-F]{6}$/.test(hex) || /^#[0-9a-fA-F]{3}$/.test(hex)) {
        colors[role] = hex.toLowerCase();
      }
    }

    // ── f tag: ["f", "family", "url", "role?"] ────────────────────────────
    // role: "body" (default/legacy), "title"
    if (tag[0] === 'f' && tag[1] && tag[2]) {
      const url  = tag[2].trim();
      const role = (tag[3] || 'body').toLowerCase();
      if (/^https:\/\//i.test(url)) {
        const name = tag[1].replace(/[^a-zA-Z0-9 \-_]/g, '').trim().slice(0, 64);
        if (name) {
          const font: NostrFont = { name, url };
          if (role === 'title') titleFont = font;
          else bodyFont = font; // "body" or legacy 3-element
        }
      }
    }

    // ── bg tag: ["bg", "url <url>", "mode <cover|tile>", "m <mime>", ...] ─
    // Also accept bare https:// URL or "tile"/"cover" as standalone parts
    if (tag[0] === 'bg') {
      let candidateUrl: string | undefined;
      let candidateMode: 'cover' | 'tile' | undefined;

      for (const part of tag.slice(1)) {
        const p = part.trim();
        if (p.startsWith('url ')) {
          const u = p.slice(4).trim();
          if (/^https?:\/\//i.test(u)) candidateUrl = u;
        } else if (/^https?:\/\//i.test(p)) {
          // bare URL without "url " prefix
          candidateUrl = p;
        }
        if (p.startsWith('mode ')) {
          const m = p.slice(5).trim();
          if (m === 'cover' || m === 'tile') candidateMode = m;
        } else if (p === 'cover' || p === 'tile') {
          // standalone mode value
          candidateMode = p as 'cover' | 'tile';
        }
      }

      if (candidateUrl) {
        bgUrl  = candidateUrl;
        bgMode = candidateMode ?? 'cover';
      }
    }

    // ── title tag ──────────────────────────────────────────────────────────
    if (tag[0] === 'title' && tag[1]) {
      themeTitle = tag[1].trim().slice(0, 80);
    }
  }

  if (!colors.background || !colors.text || !colors.primary) return null;

  return {
    background: colors.background,
    text:       colors.text,
    primary:    colors.primary,
    title:      themeTitle,
    bodyFont,
    titleFont,
    bgUrl,
    bgMode,
  };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

// Cache in-flight and recently resolved fetches by pubkey to avoid duplicate relay connections
const _fetchCache = new Map<string, { promise: Promise<NostrTheme | null>; ts: number }>();
const FETCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Fetch a user's kind 16767 using raw WebSockets in parallel (no SimplePool). */
export function fetchKind16767(pubkey: string): Promise<NostrTheme | null> {
  const cached = _fetchCache.get(pubkey);
  if (cached && Date.now() - cached.ts < FETCH_CACHE_TTL) return cached.promise;

  const relays = [
    'wss://relay.ditto.pub',
    ...FALLBACK_RELAYS,
    'wss://relay.damus.io',
    'wss://relay.snort.social',
    'wss://nostr-pub.wellorder.net',
  ].filter((r, i, a) => a.indexOf(r) === i);

  const filter = { kinds: [16767], authors: [pubkey], limit: 1 };

  const promise = new Promise<NostrTheme | null>((resolve) => {
    let done = false;
    const counted = new Set<WebSocket>();
    const sockets: WebSocket[] = [];

    const finish = (result: NostrTheme | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sockets.forEach(ws => { try { ws.close(); } catch { /* ignore */ } });
      resolve(result);
    };

    const markDone = (ws: WebSocket) => {
      if (counted.has(ws)) return;
      counted.add(ws);
      if (counted.size >= relays.length) finish(null);
    };

    const timer = setTimeout(() => finish(null), 8000);

    relays.forEach(url => {
      try {
        const ws  = new WebSocket(url);
        const sub = 'nd_' + Math.random().toString(36).slice(2, 8);
        sockets.push(ws);

        ws.onopen = () => { ws.send(JSON.stringify(['REQ', sub, filter])); };

        ws.onmessage = (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data as string);
            if (msg[0] === 'EVENT' && msg[2] && msg[2].kind === 16767) {
              const theme = parseKind16767(msg[2]);
              if (theme) finish(theme);
            } else if (msg[0] === 'EOSE') {
              markDone(ws);
            }
          } catch { /* ignore */ }
        };

        ws.onerror = () => markDone(ws);
        ws.onclose = () => markDone(ws);
      } catch {
        // Count failed connections via a dummy sentinel
        const dummy = {} as WebSocket;
        sockets.push(dummy);
        markDone(dummy);
      }
    });
  });

  _fetchCache.set(pubkey, { promise, ts: Date.now() });
  return promise;
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    : h.slice(0, 6).padEnd(6, '0');
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}

/** Linear interpolation between two hex colours (t=0→hex1, t=1→hex2) */
function mix(hex1: string, hex2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Perceived luminance (0 = black, 1 = white) */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1:1 – 21:1) */
function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const lighter = Math.max(la, lb), darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Nudge `color` toward white or black until it has at least `minRatio`
 * contrast against `bg`. Stops after 20 iterations to avoid infinite loops.
 */
function ensureContrast(color: string, bg: string, minRatio: number): string {
  const bgDark = luminance(bg) < 0.5;
  const target = bgDark ? '#ffffff' : '#000000';
  let c = color;
  for (let i = 0; i < 20 && contrastRatio(c, bg) < minRatio; i++) {
    c = mix(c, target, 0.25);
  }
  return c;
}

// ── Apply / Clear ─────────────────────────────────────────────────────────────

function buildThemeCss(theme: NostrTheme): string {
  let bg      = theme.background;
  let text    = theme.text;
  let primary = theme.primary;

  // Adapt light themes to our dark UI.
  // If the background is bright (lum > 0.18), preserve the hue but force it dark.
  // If the text is light-on-dark already, leave it alone.
  const bgLum   = luminance(bg);
  const textLum = luminance(text);

  if (bgLum > 0.18) {
    // Crush bg toward black while keeping its hue/tint
    bg = mix(bg, '#000000', 0.82);
  }
  if (bgLum > 0.18 && textLum > 0.5) {
    // Text was already light — fine as-is
  } else if (bgLum > 0.18 && textLum < 0.5) {
    // Text was dark (for a light bg) — flip it light
    text = mix(text, '#ffffff', 0.88);
  }

  const [br, bg2, bb] = hexToRgb(bg);

  // Enforce minimum contrast so no theme can make text unreadable.
  // Main text: WCAG AA requires 4.5:1; we use 4.5 as the floor.
  text    = ensureContrast(text,    bg, 4.5);
  // Accent/primary used for buttons and highlights: minimum 3:1.
  primary = ensureContrast(primary, bg, 3.0);

  // Derive the full --nd-* set from 3 source colours
  const navy    = mix(bg, primary, 0.08);
  const purp    = mix(bg, primary, 0.45);
  const dpurp   = mix(bg, primary, 0.2);
  // Subtext is a dimmed version of text — enforce at least 2.5:1 against bg.
  let subtext   = mix(text, bg, 0.45);
  subtext       = ensureContrast(subtext, bg, 2.5);

  // Apply to :root so the nostr theme fully replaces the active preset
  let css = `
    :root {
      --nd-bg:      ${bg};
      --nd-navy:    ${navy};
      --nd-accent:  ${primary};
      --nd-purp:    ${purp};
      --nd-dpurp:   ${dpurp};
      --nd-text:    ${text};
      --nd-subtext: ${subtext};
    }
  `;

  // Background image — layered over a semi-transparent colour overlay
  // so panel text stays legible regardless of image content
  if (theme.bgUrl) {
    const safeUrl = theme.bgUrl.replace(/['"\\]/g, '');
    const repeat  = theme.bgMode === 'tile' ? 'repeat' : 'no-repeat';
    const size    = theme.bgMode === 'tile' ? 'auto'   : 'cover';
    css += `
      ${PANEL_SELECTORS} {
        background:
          linear-gradient(rgba(${br},${bg2},${bb},0.90), rgba(${br},${bg2},${bb},0.86)),
          url('${safeUrl}') center/${size} ${repeat} !important;
      }
    `;
  }

  // Cap font sizes — set a hard 14px ceiling on html/body so relative units
  // (em/rem) used by theme fonts can't blow up the layout. Our panel inline
  // styles use explicit px values and are unaffected by this root cap.
  css += `
    html, body { font-size: 14px !important; }
  `;

  // Body font — applies to all UI text
  if (theme.bodyFont) {
    const { name, url } = theme.bodyFont;
    css += `
      @font-face { font-family:'${name}'; src:url('${url}') format('woff2'); font-display:swap; }
      body, body * { font-family:'${name}','Courier New',monospace !important; }
    `;
  }

  // Title font — applies to display names / headings
  if (theme.titleFont) {
    const { name, url } = theme.titleFont;
    css += `
      @font-face { font-family:'${name}'; src:url('${url}') format('woff2'); font-display:swap; }
      .nd-title, [data-role="title"] { font-family:'${name}',serif !important; }
    `;
  }

  return css;
}

function injectCss(css: string): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
  }
  el.textContent = css;
  // Always move to end of <head> so it overrides the preset theme stylesheet
  document.head.appendChild(el);
}

export function clearNostrThemeCss(): void {
  document.getElementById(STYLE_ID)?.remove();
}

// Apply cached theme on boot — deferred so themeStore (preset) initializes first,
// then nd-nostr-theme is appended last and wins the CSS cascade.
if (_enabled && _cached) {
  const _bootTheme = _cached;
  setTimeout(() => { if (_enabled) injectCss(buildThemeCss(_bootTheme)); }, 0);
}

/**
 * Preview a theme visually without persisting to localStorage.
 * Call applyThemeObject to commit it, or clearNostrThemeCss to revert.
 */
export function previewThemeObject(theme: NostrTheme): void {
  injectCss(buildThemeCss(theme));
}

/**
 * Apply any NostrTheme object directly (e.g. from the theme browser).
 * Sets it as the active cached theme, enables the nostr theme, and injects CSS.
 */
export function applyThemeObject(theme: NostrTheme): void {
  _cached  = theme;
  _enabled = true;
  localStorage.setItem(ENABLED_KEY, '1');
  saveThemeCache(theme);
  injectCss(buildThemeCss(theme));
  _onChange?.();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch and cache the user's kind 16767 event.
 * Automatically applies it if the nostr theme is currently enabled.
 * Safe to call for guests (pubkey='') — returns immediately.
 */
export async function loadNostrTheme(pubkey: string): Promise<void> {
  if (!pubkey || _loading) return;
  _loading = true;
  _onChange?.();

  const theme = await fetchKind16767(pubkey);
  _loading = false;

  if (theme) {
    // Fresh theme found — update cache and apply
    _cached = theme;
    saveThemeCache(theme);
    if (_enabled) injectCss(buildThemeCss(theme));
  } else if (_cached) {
    // Relay returned nothing but we have a cached theme — keep it showing
    if (_enabled) injectCss(buildThemeCss(_cached));
  } else {
    // No theme anywhere — clear
    clearNostrThemeCss();
  }

  _onChange?.();
}

/**
 * Load a kind 16767 theme from a raw hex pubkey or npub1... string.
 * Used by the manual "load by pubkey" input in SettingsPanel.
 */
export async function loadNostrThemeFromInput(input: string): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) return;

  let pubkey = trimmed;

  // Decode npub bech32 → hex
  if (trimmed.startsWith('npub1')) {
    try {
      const { nip19 } = await import('nostr-tools');
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') pubkey = decoded.data as string;
      else return;
    } catch {
      return;
    }
  }

  // Must be a 64-char hex pubkey at this point
  if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) return;

  // Allow re-fetch even if already loading (manual override)
  _loading = true;
  _onChange?.();

  const theme = await fetchKind16767(pubkey);
  _cached  = theme;
  _loading = false;

  if (theme) {
    _enabled = true;
    localStorage.setItem(ENABLED_KEY, '1');
    injectCss(buildThemeCss(theme));
  } else {
    clearNostrThemeCss();
  }

  _onChange?.();
}

/**
 * Toggle the nostr theme on / off.
 * Persists choice to localStorage.
 */
export function setNostrThemeEnabled(enabled: boolean): void {
  _enabled = enabled;
  localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  if (enabled && _cached) injectCss(buildThemeCss(_cached));
  else clearNostrThemeCss();
  _onChange?.();
}
