/**
 * NostrThemeBrowser.ts — Browse and apply kind 16767 / 36767 Nostr themes
 *
 * Tabs: Mine | Global | Favorites
 */

import {
  NostrTheme, parseKind16767, applyThemeObject, previewThemeObject,
  getNostrTheme, isNostrThemeEnabled, FALLBACK_RELAYS,
} from '../nostr/nostrThemeService';
import { authStore } from '../stores/authStore';

const DITTO_RELAY = 'wss://relay.ditto.pub';

const ALL_RELAYS = [
  DITTO_RELAY,
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://relay.primal.net',
  'wss://nostr-pub.wellorder.net',
  'wss://purplepag.es',
  ...FALLBACK_RELAYS,
].filter((r, i, a) => a.indexOf(r) === i);

interface ThemeCard {
  theme:  NostrTheme;
  id:     string;
  pubkey: string;
  kind:   number;
}

interface FavEntry {
  theme:   NostrTheme;
  savedAt: number;
}

type Tab = 'mine' | 'global' | 'favorites';

const FAVORITES_KEY = 'nd_theme_favorites';

// ── Favorites storage ─────────────────────────────────────────────────────────

function favId(theme: NostrTheme): string {
  return `${theme.background}${theme.text}${theme.primary}`;
}

function getFavorites(): FavEntry[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? (JSON.parse(raw) as FavEntry[]) : [];
  } catch { return []; }
}

function saveFavorites(favs: FavEntry[]): void {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs)); } catch { /* ignore */ }
}

function isFavorite(theme: NostrTheme): boolean {
  const id = favId(theme);
  return getFavorites().some(f => favId(f.theme) === id);
}

function addFavorite(theme: NostrTheme): void {
  const favs = getFavorites();
  const id = favId(theme);
  if (!favs.some(f => favId(f.theme) === id)) {
    favs.unshift({ theme, savedAt: Date.now() });
    saveFavorites(favs);
  }
}

function removeFavorite(theme: NostrTheme): void {
  const id = favId(theme);
  saveFavorites(getFavorites().filter(f => favId(f.theme) !== id));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function shortPk(pk: string): string {
  return pk.length >= 12 ? pk.slice(0, 6) + '…' + pk.slice(-4) : pk;
}
function looksLikePubkey(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s) || s.startsWith('npub1');
}

// ── Raw WebSocket fetch ───────────────────────────────────────────────────────

function fetchEventsRaw(
  filter: object,
  relays: string[],
  timeoutMs: number,
  onCard: (card: ThemeCard) => void,
): Promise<void> {
  // Deduplicate by event ID (cross-relay) and by pubkey+colors (same theme republished)
  const seenIds    = new Set<string>();
  const seenThemes = new Set<string>();
  const sockets: WebSocket[] = [];

  return new Promise<void>((resolve) => {
    let finished = false;
    const counted = new Set<WebSocket>();

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      sockets.forEach(ws => { try { ws.close(); } catch { /* ignore */ } });
      resolve();
    };

    const markDone = (ws: WebSocket) => {
      if (counted.has(ws)) return;
      counted.add(ws);
      if (counted.size >= relays.length) finish();
    };

    const timer = setTimeout(() => finish(), timeoutMs);

    relays.forEach(url => {
      try {
        const ws  = new WebSocket(url);
        const sub = 'nd_' + Math.random().toString(36).slice(2, 8);
        sockets.push(ws);

        ws.onopen = () => ws.send(JSON.stringify(['REQ', sub, filter]));

        ws.onmessage = (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data as string);
            if (msg[0] === 'EVENT' && msg[2]) {
              const ev = msg[2];
              if (seenIds.has(ev.id)) return;
              seenIds.add(ev.id);
              const theme = parseKind16767(ev);
              if (!theme) return;
              const themeKey = `${ev.pubkey || ''}:${theme.background}:${theme.text}:${theme.primary}`;
              if (seenThemes.has(themeKey)) return;
              seenThemes.add(themeKey);
              const id = ev.tags?.find((t: string[]) => t[0] === 'd')?.[1]
                || `${ev.kind}-${ev.id.slice(0, 8)}`;
              onCard({ theme, id, pubkey: ev.pubkey || '', kind: ev.kind });
            } else if (msg[0] === 'EOSE') {
              markDone(ws);
            }
          } catch { /* ignore */ }
        };

        ws.onerror = () => markDone(ws);
        ws.onclose = () => markDone(ws);
      } catch {
        const dummy = {} as WebSocket;
        sockets.push(dummy);
        markDone(dummy);
      }
    });
  });
}

async function resolveHexPubkey(raw: string): Promise<string | null> {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return raw;
  if (raw.startsWith('npub1')) {
    try {
      const { nip19 } = await import('nostr-tools');
      const dec = nip19.decode(raw);
      if (dec.type === 'npub') return dec.data as string;
    } catch { /* ignore */ }
  }
  return null;
}

const PAGE_SIZE = 8;

// ── Browser class ─────────────────────────────────────────────────────────────

export class NostrThemeBrowser {
  private el:             HTMLDivElement | null = null;
  private activeTab:      Tab   = 'mine';
  private outsideHandler: ((e: MouseEvent) => void) | null = null;
  private mineePage     = 0;
  private globalPage    = 0;
  private favPage       = 0;
  private previewIdx:   number | null = null;

  open(): void {
    this.close();
    this.build();
    document.body.appendChild(this.el!);
    this.outsideHandler = (e: MouseEvent) => {
      if (!this.el?.contains(e.target as Node)) this.close();
    };
    setTimeout(() => document.addEventListener('pointerdown', this.outsideHandler!), 100);
    this.loadTab(this.activeTab);
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    if (this.outsideHandler) {
      document.removeEventListener('pointerdown', this.outsideHandler);
      this.outsideHandler = null;
    }
  }

  isOpen(): boolean { return !!this.el; }

  // ── Shell ──────────────────────────────────────────────────────────────────

  private build(): void {
    const el = document.createElement('div');
    el.id = 'ntb-panel';
    el.style.cssText = `
      position:fixed;top:52px;right:calc(min(280px,100vw - 28px) + 22px);z-index:2002;
      width:min(370px,calc(100vw - 28px));max-height:calc(100dvh - 66px);
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);
      border-radius:10px;box-shadow:0 4px 28px rgba(0,0,0,0.75);
      display:flex;flex-direction:column;overflow:hidden;
      font-family:'Courier New',monospace;
    `;
    el.addEventListener('mousedown', e => e.stopPropagation());

    el.innerHTML = `
      <div style="display:flex;align-items:center;padding:10px 14px 0;flex-shrink:0;
        border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);">
        <span style="color:var(--nd-text);font-size:12px;letter-spacing:0.08em;flex:1;">THEME BROWSER</span>
        <button id="ntb-close" style="background:none;border:none;color:var(--nd-subtext);
          cursor:pointer;font-size:18px;padding:0 0 6px;line-height:1;opacity:0.6;">×</button>
      </div>
      <div style="display:flex;flex-shrink:0;
        border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);">
        <button id="ntb-tab-mine" style="flex:1;padding:8px 0;background:none;border:none;
          font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
          border-bottom:2px solid transparent;margin-bottom:-1px;transition:color 0.15s,opacity 0.15s;">Mine</button>
        <button id="ntb-tab-global" style="flex:1;padding:8px 0;background:none;border:none;
          font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
          border-bottom:2px solid transparent;margin-bottom:-1px;transition:color 0.15s,opacity 0.15s;">Global</button>
        <button id="ntb-tab-favorites" style="flex:1;padding:8px 0;background:none;border:none;
          font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
          border-bottom:2px solid transparent;margin-bottom:-1px;transition:color 0.15s,opacity 0.15s;">Favorites</button>
      </div>
      <div id="ntb-content" style="flex:1;overflow-y:auto;padding:8px;
        scrollbar-width:thin;
        scrollbar-color:color-mix(in srgb,var(--nd-dpurp) 44%,transparent) transparent;">
      </div>
    `;

    this.el = el;
    el.querySelector('#ntb-close')!.addEventListener('click', () => this.close());
    el.querySelector('#ntb-tab-mine')!.addEventListener('click', () => this.switchTab('mine'));
    el.querySelector('#ntb-tab-global')!.addEventListener('click', () => this.switchTab('global'));
    el.querySelector('#ntb-tab-favorites')!.addEventListener('click', () => this.switchTab('favorites'));
    this.paintTabs();
  }

  private paintTabs(): void {
    if (!this.el) return;
    (['mine', 'global', 'favorites'] as Tab[]).forEach(t => {
      const btn = this.el!.querySelector(`#ntb-tab-${t}`) as HTMLElement;
      const on  = t === this.activeTab;
      btn.style.color             = on ? 'var(--nd-accent)' : 'var(--nd-subtext)';
      btn.style.opacity           = on ? '1' : '0.6';
      btn.style.borderBottomColor = on ? 'var(--nd-accent)' : 'transparent';
    });
  }

  private switchTab(tab: Tab): void {
    this.previewIdx = null;
    this.activeTab = tab;
    this.mineePage = 0;
    this.globalPage = 0;
    this.favPage = 0;
    this.paintTabs();
    this.loadTab(tab);
  }

  // ── Tab loaders ────────────────────────────────────────────────────────────

  private loadTab(tab: Tab): void {
    const content = this.el?.querySelector('#ntb-content') as HTMLElement | null;
    if (!content) return;
    if (tab === 'global')    { this.buildGlobalUI(content);    return; }
    if (tab === 'favorites') { this.buildFavoritesUI(content); return; }
    this.buildMineUI(content);
  }

  // ── Mine tab ───────────────────────────────────────────────────────────────

  private buildMineUI(container: HTMLElement): void {
    const auth = authStore.getState();
    if (!auth.pubkey) {
      container.innerHTML = `<div style="color:var(--nd-subtext);font-size:11px;text-align:center;padding:28px;opacity:0.45;">Not logged in</div>`;
      return;
    }

    const cards: ThemeCard[] = [];

    container.innerHTML = `
      <div id="ntb-mine-status" style="color:var(--nd-subtext);font-size:10px;padding:4px 2px 6px;opacity:0.5;">
        Searching relays for your themes…
      </div>
      <div id="ntb-mine-cards"></div>
      <div id="ntb-mine-pages"></div>
    `;

    const cardsEl = container.querySelector('#ntb-mine-cards') as HTMLElement;
    const pagesEl = container.querySelector('#ntb-mine-pages') as HTMLElement;
    const status  = container.querySelector('#ntb-mine-status') as HTMLElement;

    const refresh = () => {
      if (!this.el) return;
      this.renderCards(cardsEl, cards, true, this.mineePage);
      this.renderPager(pagesEl, cards.length, this.mineePage, p => { this.mineePage = p; refresh(); });
    };

    fetchEventsRaw(
      { kinds: [16767, 36767], authors: [auth.pubkey], limit: 50 },
      ALL_RELAYS,
      8000,
      (card) => {
        cards.push(card);
        refresh();
      },
    ).then(() => {
      if (!this.el) return;
      status.textContent = cards.length
        ? `${cards.length} theme(s) found`
        : 'No themes found on these relays';
    });
  }

  // ── Global tab ─────────────────────────────────────────────────────────────

  private buildGlobalUI(container: HTMLElement): void {
    container.innerHTML = `
      <div style="display:flex;gap:5px;margin-bottom:8px;">
        <input id="ntb-gsearch" type="text"
          placeholder="Search or paste npub1…"
          style="flex:1;min-width:0;
            background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);
            border-radius:4px;color:var(--nd-text);
            font-family:'Courier New',monospace;font-size:10px;
            padding:5px 8px;outline:none;"
          autocomplete="off" spellcheck="false">
        <button id="ntb-gsearch-btn" style="
          padding:5px 10px;border-radius:4px;flex-shrink:0;
          font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
          background:color-mix(in srgb,var(--nd-accent) 13%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);
          color:var(--nd-accent);">Search</button>
      </div>
      <div id="ntb-gstatus" style="color:var(--nd-subtext);font-size:10px;padding:2px 2px 6px;opacity:0.5;"></div>
      <div id="ntb-gresults"></div>
      <div id="ntb-gpages"></div>
    `;

    const inp    = container.querySelector('#ntb-gsearch')     as HTMLInputElement;
    const btn    = container.querySelector('#ntb-gsearch-btn') as HTMLButtonElement;
    const status = container.querySelector('#ntb-gstatus')     as HTMLElement;
    const res    = container.querySelector('#ntb-gresults')    as HTMLElement;
    const pages  = container.querySelector('#ntb-gpages')      as HTMLElement;

    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') btn.click(); });
    inp.addEventListener('focus', () => inp.style.borderColor = 'color-mix(in srgb,var(--nd-accent) 55%,transparent)');
    inp.addEventListener('blur',  () => inp.style.borderColor = 'color-mix(in srgb,var(--nd-dpurp) 44%,transparent)');

    const doSearch = async () => {
      const q = inp.value.trim();
      btn.textContent = 'Searching…';
      btn.disabled    = true;
      res.innerHTML   = '';
      pages.innerHTML = '';
      status.textContent = 'Connecting to relays…';
      this.globalPage = 0;

      const cards: ThemeCard[] = [];

      let filter: object;

      if (looksLikePubkey(q)) {
        const pubkey = await resolveHexPubkey(q);
        if (!pubkey) {
          status.textContent = 'Invalid pubkey';
          btn.textContent = 'Search';
          btn.disabled = false;
          return;
        }
        // Search by pubkey: include both kinds so you can browse someone's active theme too
        filter = { kinds: [16767, 36767], authors: [pubkey], limit: 50 };
      } else {
        // General browse: only kind 36767 (published/shared themes, not everyone's active profile theme)
        filter = { kinds: [36767], limit: 100 };
      }

      const refresh = () => {
        if (!this.el) return;
        this.renderCards(res, cards, true, this.globalPage);
        this.renderPager(pages, cards.length, this.globalPage, p => { this.globalPage = p; refresh(); });
      };

      await fetchEventsRaw(filter, ALL_RELAYS, 10000, (card) => {
        cards.push(card);
        refresh();
      });

      if (!this.el) return;
      btn.textContent    = 'Search';
      btn.disabled       = false;
      status.textContent = cards.length ? `${cards.length} theme(s) found` : 'No themes found';
      refresh();
    };

    btn.addEventListener('click', doSearch);
    doSearch();
  }

  // ── Favorites tab ──────────────────────────────────────────────────────────

  private buildFavoritesUI(container: HTMLElement): void {
    const favs = getFavorites();
    if (!favs.length) {
      container.innerHTML = `
        <div style="color:var(--nd-subtext);font-size:11px;text-align:center;padding:28px;opacity:0.45;">
          No favorites yet — heart a theme from Mine or Global
        </div>`;
      return;
    }

    const cards: ThemeCard[] = favs.map((f, i) => ({
      theme:  f.theme,
      id:     `fav-${i}`,
      pubkey: '',
      kind:   16767,
    }));

    container.innerHTML = `<div id="ntb-fav-cards"></div><div id="ntb-fav-pages"></div>`;
    const cardsEl = container.querySelector('#ntb-fav-cards') as HTMLElement;
    const pagesEl = container.querySelector('#ntb-fav-pages') as HTMLElement;

    const refresh = () => {
      if (!this.el) return;
      this.renderCards(cardsEl, cards, false, this.favPage);
      this.renderPager(pagesEl, cards.length, this.favPage, p => { this.favPage = p; refresh(); });
    };
    refresh();
  }

  // ── Card renderer ──────────────────────────────────────────────────────────

  private renderPager(container: HTMLElement, total: number, page: number, onPage: (p: number) => void): void {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 0 2px;">
        <button id="ntb-prev" style="
          padding:4px 10px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
          background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);
          color:var(--nd-subtext);cursor:pointer;
          opacity:${page === 0 ? '0.3' : '1'};"
          ${page === 0 ? 'disabled' : ''}>← Prev</button>
        <span style="color:var(--nd-subtext);font-size:10px;opacity:0.6;">${page + 1} / ${totalPages}</span>
        <button id="ntb-next" style="
          padding:4px 10px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
          background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);
          color:var(--nd-subtext);cursor:pointer;
          opacity:${page >= totalPages - 1 ? '0.3' : '1'};"
          ${page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
      </div>
    `;
    container.querySelector('#ntb-prev')?.addEventListener('click', () => onPage(page - 1));
    container.querySelector('#ntb-next')?.addEventListener('click', () => onPage(page + 1));
  }

  private renderCards(container: HTMLElement, cards: ThemeCard[], showFavBtn: boolean, page = 0): void {
    const pageCards  = cards.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const pageOffset = page * PAGE_SIZE;

    if (!cards.length) {
      container.innerHTML = `
        <div style="color:var(--nd-subtext);font-size:11px;text-align:center;padding:28px;opacity:0.45;">
          No themes found
        </div>`;
      return;
    }

    const curTheme   = getNostrTheme();
    const curEnabled = isNostrThemeEnabled();

    container.innerHTML = pageCards.map((card, localIdx) => {
      const i = pageOffset + localIdx;
      const { theme } = card;
      const dots = [theme.background, theme.text, theme.primary].map(c =>
        `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;
          background:${esc(c)};border:1px solid rgba(255,255,255,0.15);flex-shrink:0;"></span>`
      ).join('');

      const isApplied = curEnabled && !!curTheme
        && curTheme.background === theme.background
        && curTheme.primary    === theme.primary
        && curTheme.text       === theme.text;

      const isPreviewing = this.previewIdx === i;
      const isFav = isFavorite(theme);

      const title = theme.title || (card.pubkey ? `Theme by ${shortPk(card.pubkey)}` : 'Untitled');
      const meta  = [
        card.pubkey ? shortPk(card.pubkey) : '',
        theme.bodyFont?.name || '',
        theme.bgUrl ? 'bg' : '',
      ].filter(Boolean).join(' · ');

      const favBtn = showFavBtn ? `
        <button class="ntb-fav-btn" data-idx="${i}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}" style="
          background:none;border:none;cursor:pointer;font-size:14px;flex-shrink:0;
          color:${isFav ? 'var(--nd-accent)' : 'var(--nd-subtext)'};
          opacity:${isFav ? '1' : '0.4'};padding:2px 4px;
          transition:opacity 0.15s,color 0.15s;">${isFav ? '♥' : '♡'}</button>
      ` : `
        <button class="ntb-fav-btn" data-idx="${i}" title="Remove from favorites" style="
          background:none;border:none;cursor:pointer;font-size:14px;flex-shrink:0;
          color:var(--nd-accent);padding:2px 4px;">♥</button>
      `;

      const actionBtn = isApplied
        ? `<span style="color:var(--nd-accent);font-size:9px;flex-shrink:0;opacity:0.8;">applied</span>`
        : isPreviewing
          ? `<button class="ntb-apply-btn" data-idx="${i}" style="
              padding:4px 10px;border-radius:4px;flex-shrink:0;
              font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
              background:color-mix(in srgb,var(--nd-accent) 22%,transparent);
              border:1px solid color-mix(in srgb,var(--nd-accent) 55%,transparent);
              color:var(--nd-accent);font-weight:bold;">Apply</button>`
          : `<button class="ntb-preview-btn" data-idx="${i}" style="
              padding:4px 10px;border-radius:4px;flex-shrink:0;
              font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
              background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
              border:1px solid color-mix(in srgb,var(--nd-dpurp) 40%,transparent);
              color:var(--nd-subtext);">Preview</button>`;

      return `
        <div class="ntb-card" style="
          display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:4px;
          border-radius:6px;
          background:${isApplied || isPreviewing
            ? 'color-mix(in srgb,var(--nd-accent) 10%,transparent)'
            : 'color-mix(in srgb,var(--nd-dpurp) 12%,transparent)'};
          border:1px solid ${isApplied || isPreviewing
            ? 'color-mix(in srgb,var(--nd-accent) 33%,transparent)'
            : 'color-mix(in srgb,var(--nd-dpurp) 20%,transparent)'};
        ">
          <div style="display:flex;gap:3px;flex-shrink:0;">${dots}</div>
          <div style="flex:1;min-width:0;">
            <div style="color:var(--nd-text);font-size:11px;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(title)}</div>
            <div style="color:var(--nd-subtext);font-size:9px;opacity:0.5;margin-top:1px;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(meta)}</div>
          </div>
          ${favBtn}
          ${actionBtn}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.ntb-preview-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.idx || '0', 10);
        this.previewIdx = idx;
        previewThemeObject(cards[idx].theme);
        this.renderCards(container, cards, showFavBtn, page);
      });
    });

    container.querySelectorAll('.ntb-apply-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.idx || '0', 10);
        this.previewIdx = null;
        applyThemeObject(cards[idx].theme);
        this.close();
      });
    });

    container.querySelectorAll('.ntb-fav-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.idx || '0', 10);
        const theme = cards[idx].theme;
        if (this.activeTab === 'favorites') {
          // In favorites tab — remove button always removes
          removeFavorite(theme);
          this.buildFavoritesUI(container);
        } else if (isFavorite(theme)) {
          removeFavorite(theme);
          this.renderCards(container, cards, showFavBtn, page);
        } else {
          addFavorite(theme);
          this.renderCards(container, cards, showFavBtn, page);
        }
      });
    });
  }
}
