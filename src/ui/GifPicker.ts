/**
 * GifPicker.ts — Floating GIF & Meme picker (powered by Klipy)
 */

import { KLIPY_API_KEY, IMGUR_CLIENT_ID } from '../config/game.config';

interface GifResult { previewUrl: string; gifUrl: string; title: string; }

function klipyCustomerId(): string {
  const k = 'nd_gif_cid';
  let id = localStorage.getItem(k);
  if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem(k, id); }
  return id;
}

async function klipyFetch(endpoint: string, params: Record<string, string> = {}): Promise<GifResult[]> {
  if (!KLIPY_API_KEY) return [];
  const qs = new URLSearchParams({ customer_id: klipyCustomerId(), per_page: '24', ...params }).toString();
  const url = `https://api.klipy.com/api/v1/${KLIPY_API_KEY}${endpoint}?${qs}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 7000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
  } finally {
    clearTimeout(tid);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const results: GifResult[] = [];
  for (const item of (data.data?.data || [])) {
    const imgUrl = item.file?.hd?.gif?.url || item.file?.hd?.jpg?.url || item.file?.md?.gif?.url || item.file?.md?.jpg?.url;
    const previewUrl = item.file?.sm?.gif?.url || item.file?.sm?.jpg?.url || imgUrl;
    if (imgUrl) results.push({ previewUrl, gifUrl: imgUrl, title: item.title || '' });
    if (results.length >= 20) break;
  }
  return results;
}

async function searchKlipy(query: string): Promise<GifResult[]> {
  return klipyFetch(query ? '/gifs/search' : '/gifs/trending', query ? { q: query } : {});
}

async function searchRedditMemes(query: string): Promise<GifResult[]> {
  // meme-api.com proxies Reddit with CORS support, no key needed
  // blank = mixed feed from memes+dankmemes+me_irl; query = specific subreddit
  const sub = query.trim();
  const url = sub
    ? `https://meme-api.com/gimme/${encodeURIComponent(sub)}/20`
    : `https://meme-api.com/gimme/20`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 7000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items: any[] = data.memes || (data.url ? [data] : []);
  const results: GifResult[] = [];
  for (const meme of items) {
    if (meme.nsfw || meme.spoiler) continue;
    const imgUrl: string = meme.url || '';
    if (!/^https?:\/\//i.test(imgUrl)) continue;
    const previews: string[] = meme.preview || [];
    const preview = previews[previews.length - 2] || previews[0] || imgUrl;
    results.push({ previewUrl: preview, gifUrl: imgUrl, title: meme.title || '' });
    if (results.length >= 20) break;
  }
  return results;
}

async function searchImgur(query: string): Promise<GifResult[]> {
  if (!IMGUR_CLIENT_ID) return [];
  const url = `https://api.imgur.com/3/gallery/search/hot?q=${encodeURIComponent(query + ' gif')}`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` } });
  if (!res.ok) return [];
  const data = await res.json();
  const results: GifResult[] = [];
  for (const item of (data.data || [])) {
    const images: any[] = item.images || (item.type?.startsWith('image') ? [item] : []);
    for (const img of images) {
      if (img.animated && img.link) {
        results.push({ previewUrl: img.link, gifUrl: img.link, title: item.title || '' });
        break;
      }
    }
    if (results.length >= 20) break;
  }
  return results;
}

function escHtml(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export function isGifUrl(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  return /\.(gif|jpg|jpeg|png)(\?[^\s]*)?$/i.test(t) ||
    /^https?:\/\/i\.redd\.it\//i.test(t) ||
    /^https?:\/\/preview\.redd\.it\//i.test(t) ||
    /^https?:\/\/media\.tenor\.com\//i.test(t) ||
    /^https?:\/\/media\d*\.giphy\.com\//i.test(t) ||
    /^https?:\/\/i\.giphy\.com\//i.test(t) ||
    /^https?:\/\/i\.imgur\.com\//i.test(t) ||
    /^https?:\/\/[^/]*\.klipy\.(com|co)\//i.test(t);
}

export function gifSrcAttr(url: string): string {
  return url.trim().replace(/"/g, '%22').replace(/'/g, '%27');
}

export class GifPicker {
  private el: HTMLDivElement | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private memesTimer: ReturnType<typeof setTimeout> | null = null;
  private onSelect: (url: string) => void;

  constructor(onSelect: (url: string) => void) {
    this.onSelect = onSelect;
    this.injectStyles();
  }

  open(anchor: HTMLElement): void {
    this.close();
    const rect = anchor.getBoundingClientRect();
    const panelW = 300;
    const left = Math.min(rect.left, window.innerWidth - panelW - 8);
    const bottom = window.innerHeight - rect.top + 6;

    this.el = document.createElement('div');
    this.el.className = 'gp';
    this.el.style.cssText = `left:${left}px;bottom:${bottom}px;`;
    this.el.innerHTML = `
      <div class="gp-tabs">
        <button class="gp-tab gp-tab-search gp-tab-active">GIFs</button>
        <button class="gp-tab gp-tab-memes">Memes</button>
      </div>
      <div class="gp-search-panel">
        <div class="gp-row"><input class="gp-search-input" type="text" placeholder="Search GIFs…" autocomplete="off"></div>
        <div class="gp-grid" id="gp-grid"><div class="gp-status">Loading…</div></div>
        <div class="gp-foot">via Klipy</div>
      </div>
      <div class="gp-memes-panel" style="display:none;">
        <div class="gp-row"><input class="gp-memes-input" type="text" placeholder="Subreddit (e.g. dankmemes)…" autocomplete="off"></div>
        <div class="gp-grid" id="gp-memes-grid"><div class="gp-status">Loading…</div></div>
        <div class="gp-foot">via Reddit</div>
      </div>
    `;

    document.body.appendChild(this.el);
    this.wire();

    const outside = (e: MouseEvent) => {
      if (!this.el?.contains(e.target as Node) && e.target !== anchor) {
        this.close();
        document.removeEventListener('mousedown', outside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', outside), 150);
    this.doGifSearch('');
  }

  close(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.memesTimer) clearTimeout(this.memesTimer);
    this.el?.remove();
    this.el = null;
  }

  isOpen(): boolean { return !!this.el; }

  private wire(): void {
    if (!this.el) return;

    this.el.querySelector('.gp-tab-search')?.addEventListener('click', () => this.showTab('search'));
    this.el.querySelector('.gp-tab-memes')?.addEventListener('click', () => this.showTab('memes'));

    const si = this.el.querySelector('.gp-search-input') as HTMLInputElement;
    si.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') this.close(); });
    si.addEventListener('input', () => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.doGifSearch(si.value.trim()), 450);
    });
    setTimeout(() => si.focus(), 40);

    const mi = this.el.querySelector('.gp-memes-input') as HTMLInputElement;
    mi.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') this.close(); });
    mi.addEventListener('input', () => {
      if (this.memesTimer) clearTimeout(this.memesTimer);
      this.memesTimer = setTimeout(() => this.doMemesSearch(mi.value.trim()), 450);
    });
  }

  private showTab(tab: 'search' | 'memes'): void {
    if (!this.el) return;
    const sp = this.el.querySelector('.gp-search-panel') as HTMLElement;
    const mp = this.el.querySelector('.gp-memes-panel') as HTMLElement;
    sp.style.display = tab === 'search' ? 'flex' : 'none';
    mp.style.display = tab === 'memes' ? 'flex' : 'none';
    this.el.querySelector('.gp-tab-search')!.classList.toggle('gp-tab-active', tab === 'search');
    this.el.querySelector('.gp-tab-memes')!.classList.toggle('gp-tab-active', tab === 'memes');
    if (tab === 'memes') {
      setTimeout(() => (this.el?.querySelector('.gp-memes-input') as HTMLInputElement)?.focus(), 40);
      const grid = this.el.querySelector('#gp-memes-grid');
      if (grid?.querySelector('.gp-status')) this.doMemesSearch('');
    }
  }

  private renderGrid(grid: HTMLDivElement, results: GifResult[], query: string): void {
    if (!results.length) {
      grid.innerHTML = `<div class="gp-status">${query ? 'No results — try different keywords' : 'Nothing found'}</div>`;
      return;
    }
    grid.innerHTML = results.map(r =>
      `<div class="gp-thumb" data-url="${gifSrcAttr(r.gifUrl)}" title="${escHtml(r.title.slice(0, 60))}">
         <img src="${gifSrcAttr(r.previewUrl)}" loading="lazy" onerror="this.parentElement.style.display='none'">
       </div>`
    ).join('');
    grid.querySelectorAll('.gp-thumb').forEach(el => {
      el.addEventListener('click', () => {
        const url = (el as HTMLElement).dataset.url;
        if (url) { this.onSelect(url); this.close(); }
      });
    });
  }

  private async doGifSearch(query: string): Promise<void> {
    const grid = this.el?.querySelector('#gp-grid') as HTMLDivElement | null;
    if (!grid) return;
    grid.innerHTML = `<div class="gp-status">Loading…</div>`;
    try {
      let results = await searchKlipy(query);
      if (!results.length && IMGUR_CLIENT_ID) results = await searchImgur(query);
      if (!this.el) return;
      this.renderGrid(grid, results, query);
    } catch (_) {
      if (!this.el) return;
      const g = this.el.querySelector('#gp-grid') as HTMLDivElement | null;
      if (g) g.innerHTML = `<div class="gp-status" style="color:var(--nd-accent);opacity:0.7;">Klipy unavailable</div>`;
    }
  }

  private async doMemesSearch(query: string): Promise<void> {
    const grid = this.el?.querySelector('#gp-memes-grid') as HTMLDivElement | null;
    if (!grid) return;
    grid.innerHTML = `<div class="gp-status">Loading…</div>`;
    try {
      const results = await searchRedditMemes(query);
      if (!this.el) return;
      this.renderGrid(grid, results, query);
    } catch (_) {
      if (!this.el) return;
      const g = this.el.querySelector('#gp-memes-grid') as HTMLDivElement | null;
      if (g) g.innerHTML = `<div class="gp-status" style="color:var(--nd-accent);opacity:0.7;">Memes unavailable</div>`;
    }
  }

  private injectStyles(): void {
    document.getElementById('gp-styles')?.remove();
    const s = document.createElement('style');
    s.id = 'gp-styles';
    s.textContent = `
      .gp {
        position:fixed;z-index:5000;width:300px;
        background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border:1px solid color-mix(in srgb,var(--nd-text) 12%,transparent);border-radius:10px;
        box-shadow:0 -4px 24px rgba(0,0,0,0.8);
        display:flex;flex-direction:column;overflow:hidden;
        font-family:'Courier New',monospace;
      }
      .gp-tabs {
        display:flex;border-bottom:1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);flex-shrink:0;
        background:color-mix(in srgb, black 42%, var(--nd-bg));
      }
      .gp-tab {
        flex:1;padding:7px 0;background:none;border:none;
        color:var(--nd-subtext);font-family:'Courier New',monospace;font-size:11px;
        cursor:pointer;opacity:0.7;border-bottom:2px solid transparent;margin-bottom:-1px;
        transition:color 0.15s,opacity 0.15s;
      }
      .gp-tab:hover { opacity:1;color:var(--nd-text); }
      .gp-tab-active { color:var(--nd-accent);opacity:1;border-bottom-color:var(--nd-accent); }
      .gp-search-panel,.gp-memes-panel { display:flex;flex-direction:column;overflow:hidden; }
      .gp-row {
        padding:6px 8px;border-bottom:1px solid color-mix(in srgb,var(--nd-text) 8%,transparent);flex-shrink:0;
        background:color-mix(in srgb, black 35%, var(--nd-bg));
      }
      .gp-search-input,.gp-memes-input {
        width:100%;box-sizing:border-box;
        background:color-mix(in srgb, black 55%, var(--nd-bg));
        border:1px solid color-mix(in srgb,var(--nd-text) 20%,transparent);border-radius:5px;
        color:var(--nd-text);font-family:'Courier New',monospace;font-size:11px;
        padding:5px 8px;outline:none;
      }
      .gp-search-input:focus,.gp-memes-input:focus { border-color:color-mix(in srgb,var(--nd-accent) 65%,transparent); }
      .gp-search-input::placeholder,.gp-memes-input::placeholder { color:var(--nd-subtext);opacity:0.55; }
      .gp-grid {
        height:280px;overflow-y:auto;padding:5px;
        display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:88px;gap:4px;align-content:start;
        scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--nd-text) 18%,transparent) transparent;
      }
      .gp-status {
        grid-column:1/-1;color:var(--nd-subtext);font-size:11px;
        text-align:center;padding:16px 8px;line-height:1.5;
      }
      .gp-thumb {
        overflow:hidden;border-radius:4px;
        background:color-mix(in srgb, black 40%, var(--nd-bg));cursor:pointer;
        border:2px solid transparent;transition:border-color 0.1s;
      }
      .gp-thumb:hover { border-color:var(--nd-accent); }
      .gp-thumb img { width:100%;height:100%;object-fit:cover;display:block; }
      .gp-foot {
        padding:3px 8px;border-top:1px solid color-mix(in srgb,var(--nd-text) 8%,transparent);
        color:var(--nd-subtext);font-size:9px;text-align:right;flex-shrink:0;opacity:0.4;
      }
    `;
    document.head.appendChild(s);
  }
}
