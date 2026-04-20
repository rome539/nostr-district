/**
 * EmojiPackBrowser.ts — Browse and add NIP-30 emoji packs (kind:30030)
 *
 * Tabs: Browse | Added
 */

import {
  StoredEmojiPack,
  getStoredEmojiPacks,
  isEmojiPackAdded,
  addEmojiPack,
  removeEmojiPack,
} from '../nostr/emojiService';

const PACK_RELAYS = [
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://purplepag.es',
  'wss://nostr.wine',
  'wss://relay.primal.net',
];

type Tab = 'browse' | 'added';

const PAGE_SIZE = 6;

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function shortPk(pk: string): string {
  return pk.length >= 12 ? pk.slice(0, 6) + '…' + pk.slice(-4) : pk;
}

// ── Raw WebSocket fetch ────────────────────────────────────────────────────────

function fetchPacks(
  filter: object,
  timeoutMs: number,
  onPack: (pack: StoredEmojiPack & { eventId: string }) => void,
): Promise<void> {
  const seenIds = new Set<string>();
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
      if (counted.size >= PACK_RELAYS.length) finish();
    };

    const timer = setTimeout(finish, timeoutMs);

    PACK_RELAYS.forEach(url => {
      try {
        const ws  = new WebSocket(url);
        const sub = 'ep_' + Math.random().toString(36).slice(2, 8);
        sockets.push(ws);

        ws.onopen = () => ws.send(JSON.stringify(['REQ', sub, filter]));

        ws.onmessage = (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data as string);
            if (msg[0] === 'EVENT' && msg[2]) {
              const ev = msg[2];
              if (seenIds.has(ev.id)) return;
              seenIds.add(ev.id);
              if (ev.kind !== 30030) return;

              const tags: string[][] = ev.tags || [];
              const dTag   = tags.find(t => t[0] === 'd')?.[1] || '';
              const nameTg = tags.find(t => t[0] === 'name')?.[1] || '';
              const name   = nameTg || dTag || `Pack by ${shortPk(ev.pubkey || '')}`;
              const emojis = tags
                .filter(t => t[0] === 'emoji' && t[1] && t[2])
                .map(t => ({ code: t[1], url: t[2] }));

              if (!emojis.length) return; // skip empty packs

              onPack({
                pubkey:  ev.pubkey || '',
                dTag,
                name,
                emojis,
                eventId: ev.id,
              });
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

// ── Browser class ──────────────────────────────────────────────────────────────

export class EmojiPackBrowser {
  private el:             HTMLDivElement | null = null;
  private activeTab:      Tab   = 'browse';
  private outsideHandler: ((e: MouseEvent) => void) | null = null;
  private browsePage      = 0;
  private addedPage       = 0;
  private searchGen       = 0;

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
    el.id = 'epb-panel';
    el.style.cssText = `
      position:fixed;top:52px;right:calc(min(280px,100vw - 28px) + 22px);z-index:2002;
      width:min(380px,calc(100vw - 28px));max-height:calc(100dvh - 66px);
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);
      border-radius:10px;box-shadow:0 4px 28px rgba(0,0,0,0.75);
      display:flex;flex-direction:column;overflow:hidden;
      font-family:'Courier New',monospace;
    `;
    el.addEventListener('pointerdown', e => e.stopPropagation());

    el.innerHTML = `
      <div style="display:flex;align-items:center;padding:10px 14px 0;flex-shrink:0;
        border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);">
        <span style="color:var(--nd-text);font-size:12px;letter-spacing:0.08em;flex:1;">EMOJI PACK BROWSER</span>
        <button id="epb-close" style="background:none;border:none;color:var(--nd-subtext);
          cursor:pointer;font-size:18px;padding:0 0 6px;line-height:1;opacity:0.6;">×</button>
      </div>
      <div style="display:flex;flex-shrink:0;
        border-bottom:1px solid color-mix(in srgb,var(--nd-dpurp) 22%,transparent);">
        <button id="epb-tab-browse" style="flex:1;padding:8px 0;background:none;border:none;
          font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
          border-bottom:2px solid transparent;margin-bottom:-1px;transition:color 0.15s;">Browse</button>
        <button id="epb-tab-added" style="flex:1;padding:8px 0;background:none;border:none;
          font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
          border-bottom:2px solid transparent;margin-bottom:-1px;transition:color 0.15s;">Added</button>
      </div>
      <div id="epb-content" style="flex:1;overflow-y:auto;padding:8px;
        scrollbar-width:thin;
        scrollbar-color:color-mix(in srgb,var(--nd-dpurp) 44%,transparent) transparent;">
      </div>
    `;

    this.el = el;
    el.querySelector('#epb-close')!.addEventListener('click', () => this.close());
    el.querySelector('#epb-tab-browse')!.addEventListener('click', () => this.switchTab('browse'));
    el.querySelector('#epb-tab-added')!.addEventListener('click', () => this.switchTab('added'));
    this.paintTabs();
  }

  private paintTabs(): void {
    if (!this.el) return;
    (['browse', 'added'] as Tab[]).forEach(t => {
      const btn = this.el!.querySelector(`#epb-tab-${t}`) as HTMLElement;
      const on  = t === this.activeTab;
      btn.style.color             = on ? 'var(--nd-accent)' : 'var(--nd-subtext)';
      btn.style.opacity           = on ? '1' : '0.6';
      btn.style.borderBottomColor = on ? 'var(--nd-accent)' : 'transparent';
    });
  }

  private switchTab(tab: Tab): void {
    this.activeTab   = tab;
    this.browsePage  = 0;
    this.addedPage   = 0;
    this.paintTabs();
    this.loadTab(tab);
  }

  // ── Tab loaders ────────────────────────────────────────────────────────────

  private loadTab(tab: Tab): void {
    const content = this.el?.querySelector('#epb-content') as HTMLElement | null;
    if (!content) return;
    if (tab === 'added') { this.buildAddedUI(content); return; }
    this.buildBrowseUI(content);
  }

  // ── Browse tab ─────────────────────────────────────────────────────────────

  private buildBrowseUI(container: HTMLElement): void {
    container.innerHTML = `
      <div style="display:flex;gap:5px;margin-bottom:8px;">
        <input id="epb-search" type="text"
          placeholder="Search packs by name…"
          style="flex:1;min-width:0;
            background:color-mix(in srgb,var(--nd-dpurp) 22%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-dpurp) 44%,transparent);
            border-radius:4px;color:var(--nd-text);
            font-family:'Courier New',monospace;font-size:10px;
            padding:5px 8px;outline:none;"
          autocomplete="off" spellcheck="false">
        <button id="epb-search-btn" style="
          padding:5px 10px;border-radius:4px;flex-shrink:0;
          font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
          background:color-mix(in srgb,var(--nd-accent) 13%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);
          color:var(--nd-accent);">Search</button>
      </div>
      <div id="epb-status" style="color:var(--nd-subtext);font-size:10px;padding:2px 2px 6px;opacity:0.5;"></div>
      <div id="epb-results"></div>
      <div id="epb-pages"></div>
    `;

    const inp    = container.querySelector('#epb-search')     as HTMLInputElement;
    const btn    = container.querySelector('#epb-search-btn') as HTMLButtonElement;
    const status = container.querySelector('#epb-status')     as HTMLElement;
    const res    = container.querySelector('#epb-results')    as HTMLElement;
    const pages  = container.querySelector('#epb-pages')      as HTMLElement;

    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') btn.click(); });
    inp.addEventListener('focus', () => inp.style.borderColor = 'color-mix(in srgb,var(--nd-accent) 55%,transparent)');
    inp.addEventListener('blur',  () => inp.style.borderColor = 'color-mix(in srgb,var(--nd-dpurp) 44%,transparent)');

    let liveRefresh: (() => void) | null = null;

    inp.addEventListener('input', () => {
      if (liveRefresh) {
        this.browsePage = 0;
        liveRefresh();
      }
    });

    const doSearch = async () => {
      const gen = ++this.searchGen;
      liveRefresh = null;

      btn.textContent    = 'Searching…';
      btn.disabled       = true;
      res.innerHTML      = '';
      pages.innerHTML    = '';
      status.textContent = 'Connecting to relays…';
      this.browsePage    = 0;

      const allPacks: (StoredEmojiPack & { eventId: string })[] = [];
      const filtered = () => {
        const q = inp.value.trim().toLowerCase();
        return q
          ? allPacks.filter(p => p.name.toLowerCase().includes(q) || p.dTag.toLowerCase().includes(q))
          : allPacks;
      };

      let refreshTimer: ReturnType<typeof setTimeout> | null = null;
      const refresh = () => {
        if (!this.el || gen !== this.searchGen) return;
        const packs = filtered();
        this.renderPacks(res, packs, this.browsePage);
        this.renderPager(pages, packs.length, this.browsePage, p => { this.browsePage = p; refresh(); });
        status.textContent = `${packs.length} pack(s) found`;
      };
      const debouncedRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
      };

      await fetchPacks({ kinds: [30030], limit: 200 }, 10000, (pack) => {
        if (gen !== this.searchGen) return;
        allPacks.push(pack);
        status.textContent = `${filtered().length} pack(s) found…`;
        debouncedRefresh();
      });

      if (!this.el || gen !== this.searchGen) return;
      btn.textContent    = 'Search';
      btn.disabled       = false;
      liveRefresh        = refresh;
      const total        = filtered().length;
      status.textContent = total ? `${total} pack(s) found` : 'No packs found';
      refresh();
    };

    btn.addEventListener('click', doSearch);
    doSearch();
  }

  // ── Added tab ──────────────────────────────────────────────────────────────

  private buildAddedUI(container: HTMLElement): void {
    const packs = getStoredEmojiPacks();

    if (!packs.length) {
      container.innerHTML = `
        <div style="color:var(--nd-subtext);font-size:11px;text-align:center;padding:28px;opacity:0.45;">
          No packs added yet — browse and add packs to use :shortcodes: in chat
        </div>`;
      return;
    }

    container.innerHTML = packs.map((pack, pi) => {
      const authorLine = pack.pubkey ? shortPk(pack.pubkey) : '';
      const grid = pack.emojis.map(e => {
        const safeUrl  = e.url.replace(/"/g, '%22');
        const safeCode = esc(e.code);
        return `
          <div class="epb-emoji-chip" data-code="${safeCode}" title="Click to copy :${safeCode}:" style="
            display:flex;flex-direction:column;align-items:center;gap:2px;
            padding:5px 4px;border-radius:5px;cursor:pointer;
            border:1px solid transparent;
            transition:background 0.1s,border-color 0.1s;
            min-width:48px;max-width:60px;
          ">
            <img src="${safeUrl}" alt=":${safeCode}:"
              style="width:28px;height:28px;object-fit:contain;border-radius:3px;"
              onerror="this.closest('.epb-emoji-chip').style.display='none'">
            <span style="color:var(--nd-subtext);font-size:8px;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
              max-width:56px;text-align:center;opacity:0.7;">:${safeCode}:</span>
          </div>`;
      }).join('');

      return `
        <div style="margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <div style="flex:1;min-width:0;">
              <span style="color:var(--nd-text);font-size:11px;font-weight:bold;">${esc(pack.name)}</span>
              <span style="color:var(--nd-subtext);font-size:9px;opacity:0.4;margin-left:5px;">
                ${pack.emojis.length} emoji${pack.emojis.length !== 1 ? 's' : ''}${authorLine ? ` · ${authorLine}` : ''}
              </span>
            </div>
            <button class="epb-remove-btn" data-pi="${pi}" style="
              padding:3px 8px;border-radius:4px;flex-shrink:0;
              font-family:'Courier New',monospace;font-size:9px;cursor:pointer;
              background:color-mix(in srgb,#f05050 10%,transparent);
              border:1px solid color-mix(in srgb,#f05050 28%,transparent);
              color:#f05050;">Remove</button>
          </div>
          <div style="
            display:flex;flex-wrap:wrap;gap:4px;
            padding:8px;border-radius:6px;
            background:color-mix(in srgb,var(--nd-dpurp) 10%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-dpurp) 18%,transparent);">
            <div style="color:var(--nd-subtext);font-size:9px;opacity:0.4;width:100%;margin-bottom:2px;">
              Click any emoji to copy its shortcode
            </div>
            ${grid}
          </div>
        </div>
      `;
    }).join('');

    // Copy shortcode on click
    container.querySelectorAll<HTMLElement>('.epb-emoji-chip').forEach(chip => {
      chip.addEventListener('mouseenter', () => {
        chip.style.background    = 'color-mix(in srgb,var(--nd-accent) 15%,transparent)';
        chip.style.borderColor   = 'color-mix(in srgb,var(--nd-accent) 35%,transparent)';
      });
      chip.addEventListener('mouseleave', () => {
        chip.style.background  = '';
        chip.style.borderColor = 'transparent';
      });
      chip.addEventListener('click', () => {
        const code = chip.dataset.code || '';
        navigator.clipboard.writeText(`:${code}:`).then(() => {
          const label = chip.querySelector('span') as HTMLElement | null;
          if (!label) return;
          const orig = label.textContent;
          label.textContent = 'copied!';
          label.style.color = 'var(--nd-accent)';
          label.style.opacity = '1';
          setTimeout(() => { label.textContent = orig; label.style.color = ''; label.style.opacity = '0.7'; }, 1200);
        }).catch(() => {});
      });
    });

    // Remove pack
    container.querySelectorAll<HTMLElement>('.epb-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const pi   = parseInt(btn.dataset.pi || '0', 10);
        const pack = packs[pi];
        if (!pack) return;
        removeEmojiPack(pack.pubkey, pack.dTag);
        this.buildAddedUI(container);
      });
    });
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  private renderPager(container: HTMLElement, total: number, page: number, onPage: (p: number) => void): void {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 0 2px;">
        <button id="epb-prev" style="
          padding:4px 10px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
          background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);
          color:var(--nd-subtext);cursor:pointer;
          opacity:${page === 0 ? '0.3' : '1'};" ${page === 0 ? 'disabled' : ''}>← Prev</button>
        <span style="color:var(--nd-subtext);font-size:10px;opacity:0.6;">${page + 1} / ${totalPages}</span>
        <button id="epb-next" style="
          padding:4px 10px;border-radius:4px;font-family:'Courier New',monospace;font-size:10px;
          background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-dpurp) 33%,transparent);
          color:var(--nd-subtext);cursor:pointer;
          opacity:${page >= totalPages - 1 ? '0.3' : '1'};" ${page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
      </div>
    `;
    container.querySelector('#epb-prev')?.addEventListener('click', () => onPage(page - 1));
    container.querySelector('#epb-next')?.addEventListener('click', () => onPage(page + 1));
  }

  private renderPacks(
    container: HTMLElement,
    packs: (StoredEmojiPack & { eventId?: string })[],
    page: number,
    isAddedTab = false,
  ): void {
    if (!packs.length) {
      container.innerHTML = `
        <div style="color:var(--nd-subtext);font-size:11px;text-align:center;padding:28px;opacity:0.45;">
          No packs found
        </div>`;
      return;
    }

    const pagePacks = packs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    container.innerHTML = pagePacks.map((pack, localIdx) => {
      const globalIdx   = page * PAGE_SIZE + localIdx;
      const added       = isEmojiPackAdded(pack.pubkey, pack.dTag);
      const previews = pack.emojis.slice(0, 8).map(e =>
        `<span title=":${esc(e.code)}:" style="display:inline-flex;flex-direction:column;align-items:center;gap:1px;">
          <img src="${e.url.replace(/"/g, '%22')}" alt=":${esc(e.code)}:"
            style="width:22px;height:22px;object-fit:contain;border-radius:3px;"
            onerror="this.parentElement.style.display='none'">
          <span style="color:var(--nd-subtext);font-size:7px;opacity:0.5;max-width:28px;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.code)}</span>
        </span>`
      ).join('');

      const moreCount  = pack.emojis.length > 8 ? pack.emojis.length - 8 : 0;
      const countLabel = `${pack.emojis.length} emoji${pack.emojis.length !== 1 ? 's' : ''}`;
      const authorLine = pack.pubkey ? shortPk(pack.pubkey) : '';

      const actionBtn = isAddedTab
        ? `<button class="epb-remove-btn" data-idx="${globalIdx}" style="
            padding:4px 10px;border-radius:4px;flex-shrink:0;
            font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
            background:color-mix(in srgb,#f05050 10%,transparent);
            border:1px solid color-mix(in srgb,#f05050 33%,transparent);
            color:#f05050;">Remove</button>`
        : added
          ? `<span style="color:var(--nd-accent);font-size:9px;flex-shrink:0;opacity:0.8;">added ✓</span>`
          : `<button class="epb-add-btn" data-idx="${globalIdx}" style="
              padding:4px 10px;border-radius:4px;flex-shrink:0;
              font-family:'Courier New',monospace;font-size:10px;cursor:pointer;
              background:color-mix(in srgb,var(--nd-accent) 13%,transparent);
              border:1px solid color-mix(in srgb,var(--nd-accent) 33%,transparent);
              color:var(--nd-accent);">Add</button>`;

      return `
        <div class="epb-card" style="
          padding:10px 10px;margin-bottom:6px;border-radius:6px;
          background:color-mix(in srgb,var(--nd-dpurp) 12%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-dpurp) 20%,transparent);
        ">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;">
            <div style="flex:1;min-width:0;">
              <div style="color:var(--nd-text);font-size:11px;
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:bold;">${esc(pack.name)}</div>
              <div style="color:var(--nd-subtext);font-size:9px;opacity:0.5;margin-top:1px;">
                ${esc(countLabel)}${authorLine ? ` · ${esc(authorLine)}` : ''}
              </div>
            </div>
            ${actionBtn}
          </div>
          <div style="display:flex;align-items:flex-end;gap:6px;flex-wrap:wrap;">
            ${previews}
            ${moreCount ? `<span style="color:var(--nd-subtext);font-size:9px;opacity:0.5;align-self:center;">+${moreCount} more</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Add button handlers
    container.querySelectorAll('.epb-add-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx  = parseInt((btn as HTMLElement).dataset.idx || '0', 10);
        const pack = packs[idx];
        if (!pack) return;
        addEmojiPack(pack);
        // Re-render just this card area
        this.renderPacks(container, packs, page, isAddedTab);
      });
    });

    // Remove button handlers
    container.querySelectorAll('.epb-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx  = parseInt((btn as HTMLElement).dataset.idx || '0', 10);
        const pack = packs[idx];
        if (!pack) return;
        removeEmojiPack(pack.pubkey, pack.dTag);
        // Rebuild the added tab from storage
        const content = this.el?.querySelector('#epb-content') as HTMLElement | null;
        if (content) this.buildAddedUI(content);
      });
    });
  }
}
