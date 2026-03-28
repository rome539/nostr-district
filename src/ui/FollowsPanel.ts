/**
 * FollowsPanel.ts — Slide-in panel showing your follow list with online status
 *
 * - Keyboard shortcut: G (in HubScene + RoomScene)
 * - Online follows float to the top with a green dot
 * - Metadata batch-fetched (10 at a time) so large lists don't hammer relays
 * - Offline list paginated 20 at a time
 * - Click any row → ProfileModal
 * - ONLINE tab shows all players currently in the district
 */

import { P } from '../config/game.config';
import { fetchContactList, fetchProfile } from '../nostr/nostrService';
import { requestOnlinePlayers, setOnlinePlayersHandler } from '../nostr/presenceService';
import { authStore } from '../stores/authStore';
import { ProfileModal } from './ProfileModal';

interface FollowEntry {
  pubkey: string;
  displayName: string;
  picture: string;
  nip05: string;
  metaLoaded: boolean;
}

interface OnlinePlayer {
  pubkey: string;
  name: string;
  avatar?: string;
  status?: string;
  room?: string;
}

const PAGE_SIZE  = 20;
const META_BATCH = 10;

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export class FollowsPanel {
  private container:     HTMLDivElement | null = null;
  private isOpen        = false;
  private follows:       FollowEntry[]  = [];
  private onlinePubkeys = new Set<string>();
  private onlinePlayers: OnlinePlayer[] = [];
  private searchQuery   = '';
  private offlinePage   = 0;
  private loading       = true;
  private metaQueue:    string[] = [];
  private metaFetching  = false;
  private loaded        = false;
  private activeTab:    'follows' | 'online' = 'follows';

  constructor() { this.injectStyles(); }

  // ── Public API ────────────────────────────────────────────────────────────

  open(): void {
    if (!this.container) this.buildDOM();
    this.container!.classList.add('fp-open');
    this.isOpen = true;

    setOnlinePlayersHandler((players) => {
      this.onlinePubkeys = new Set(players.map(p => p.pubkey));
      this.onlinePlayers = players.map(p => ({
        pubkey: p.pubkey,
        name: (p as any).name || p.pubkey.slice(0, 8) + '...',
        avatar: (p as any).avatar,
        status: (p as any).status,
        room: (p as any).room,
      }));
      if (!this.loading) this.render();
    });

    if (!this.loaded) this.load();
    else requestOnlinePlayers();
  }

  close(): void {
    this.container?.classList.remove('fp-open');
    this.isOpen = false;
    setOnlinePlayersHandler(null);
  }

  toggle(): void { if (this.isOpen) this.close(); else this.open(); }
  isVisible(): boolean { return this.isOpen; }

  destroy(): void {
    setOnlinePlayersHandler(null);
    this.container?.remove();
    this.container = null;
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    this.loaded  = true;
    this.loading = true;
    this.render();

    const myPubkey = authStore.getState().pubkey;
    if (!myPubkey) { this.loading = false; this.render(); return; }

    const [contactList] = await Promise.all([
      fetchContactList(myPubkey),
      requestOnlinePlayers(),
    ]);

    this.follows = Array.from(contactList.follows).map(pk => ({
      pubkey: pk, displayName: pk.slice(0, 8) + '...', picture: '', nip05: '', metaLoaded: false,
    }));

    this.loading     = false;
    this.offlinePage = 0;
    this.metaQueue   = [...contactList.follows];
    this.render();
    this.fetchNextBatch();
  }

  private async fetchNextBatch(): Promise<void> {
    if (this.metaFetching || this.metaQueue.length === 0) return;
    this.metaFetching = true;

    const batch = this.metaQueue.splice(0, META_BATCH);
    await Promise.allSettled(batch.map(async (pubkey) => {
      try {
        const p = await fetchProfile(pubkey);
        const entry = this.follows.find(f => f.pubkey === pubkey);
        if (entry) {
          entry.displayName = p?.display_name || p?.name || pubkey.slice(0, 8) + '...';
          entry.picture     = p?.picture || '';
          entry.nip05       = p?.nip05   || '';
          entry.metaLoaded  = true;
        }
      } catch (_) {}
    }));

    this.metaFetching = false;
    if (this.isOpen) this.render();
    if (this.metaQueue.length > 0) setTimeout(() => this.fetchNextBatch(), 80);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private filtered(): { online: FollowEntry[]; offline: FollowEntry[] } {
    const q = this.searchQuery.toLowerCase();
    const all = q
      ? this.follows.filter(f =>
          f.displayName.toLowerCase().includes(q) || f.pubkey.includes(q))
      : this.follows;

    const online: FollowEntry[] = [];
    const offline: FollowEntry[] = [];
    for (const f of all) {
      (this.onlinePubkeys.has(f.pubkey) ? online : offline).push(f);
    }
    return { online, offline };
  }

  private render(): void {
    const body = this.container?.querySelector('.fp-body') as HTMLDivElement | null;
    if (!body) return;

    this.updateTabs();

    if (this.activeTab === 'online') {
      this.renderOnlineTab(body);
    } else {
      this.renderFollowsTab(body);
    }
  }

  private updateTabs(): void {
    const followsTab = this.container?.querySelector('.fp-tab-follows') as HTMLElement | null;
    const onlineTab  = this.container?.querySelector('.fp-tab-online')  as HTMLElement | null;
    if (!followsTab || !onlineTab) return;
    if (this.activeTab === 'follows') {
      followsTab.classList.add('fp-tab-active');
      onlineTab.classList.remove('fp-tab-active');
    } else {
      onlineTab.classList.add('fp-tab-active');
      followsTab.classList.remove('fp-tab-active');
    }
  }

  private renderOnlineTab(body: HTMLDivElement): void {
    if (this.onlinePlayers.length === 0) {
      body.innerHTML = `<div class="fp-empty">No players online</div>`;
      return;
    }

    const myPubkey = authStore.getState().pubkey;
    const q = this.searchQuery.toLowerCase();
    const players = q
      ? this.onlinePlayers.filter(p => p.name.toLowerCase().includes(q) || p.pubkey.includes(q))
      : this.onlinePlayers;

    let html = `<div class="fp-section-label" style="color:${P.teal};">ACTIVE (${players.length})</div>`;
    for (const p of players) {
      const isSelf = p.pubkey === myPubkey;
      html += `
        <div class="fp-row fp-row-online" data-pubkey="${p.pubkey}" data-name="${esc(p.name)}">
          <span class="fp-dot fp-dot-on"></span>
          <div class="fp-avatar fp-avatar-placeholder" style="font-size:11px;">👤</div>
          <div class="fp-info">
            <div class="fp-name" style="color:${isSelf ? P.teal : P.lcream};">${esc(p.name)}${isSelf ? ' <span style="color:' + P.teal + ';font-size:9px;opacity:0.6;">(you)</span>' : ''}</div>
            ${p.status ? `<div class="fp-nip05" style="color:${P.lpurp};font-style:italic;">${esc(p.status)}</div>` : ''}
          </div>
        </div>`;
    }

    body.innerHTML = html;

    body.querySelectorAll('.fp-row').forEach(el => {
      el.addEventListener('click', () => {
        const pk   = (el as HTMLElement).dataset.pubkey!;
        const name = (el as HTMLElement).dataset.name!;
        const player = this.onlinePlayers.find(p => p.pubkey === pk);
        ProfileModal.show(pk, name, player?.avatar, player?.status);
      });
    });
  }

  private renderFollowsTab(body: HTMLDivElement): void {
    const header = this.container?.querySelector('.fp-title') as HTMLElement | null;

    if (this.loading) {
      body.innerHTML = `<div class="fp-empty">Loading follows…</div>`;
      return;
    }

    const myPubkey = authStore.getState().pubkey;
    if (!myPubkey) {
      body.innerHTML = `<div class="fp-empty">Log in to see your follows</div>`;
      return;
    }

    const { online, offline } = this.filtered();
    const offlineVisible = offline.slice(0, (this.offlinePage + 1) * PAGE_SIZE);
    const hasMore = offline.length > offlineVisible.length;

    if (header) {
      const badge = online.length > 0
        ? ` <span style="color:#4cff91;font-size:11px;opacity:0.8;">(${online.length} online)</span>`
        : '';
      header.innerHTML = `FOLLOWS${badge}`;
    }

    const row = (f: FollowEntry, isOnline: boolean) => {
      const dot = isOnline
        ? `<span class="fp-dot fp-dot-on"></span>`
        : `<span class="fp-dot fp-dot-off"></span>`;
      const avatar = f.picture
        ? `<img src="${esc(f.picture)}" class="fp-avatar" onerror="this.style.display='none'">`
        : `<div class="fp-avatar fp-avatar-placeholder">👤</div>`;
      return `
        <div class="fp-row ${isOnline ? 'fp-row-online' : ''}"
             data-pubkey="${f.pubkey}"
             data-name="${esc(f.displayName)}">
          ${dot}${avatar}
          <div class="fp-info">
            <div class="fp-name" style="color:${isOnline ? P.lcream : P.lpurp};">${esc(f.displayName)}</div>
            ${f.nip05 ? `<div class="fp-nip05">✓ ${esc(f.nip05)}</div>` : ''}
          </div>
        </div>`;
    };

    let html = '';

    if (online.length > 0) {
      html += `<div class="fp-section-label" style="color:${P.teal};">ONLINE (${online.length})</div>`;
      html += online.map(f => row(f, true)).join('');
    }

    if (offlineVisible.length > 0 || online.length === 0) {
      const label = this.searchQuery
        ? `RESULTS (${offline.length})`
        : online.length > 0
          ? `OFFLINE (${offline.length})`
          : `ALL FOLLOWS (${offline.length})`;
      html += `<div class="fp-section-label">${label}</div>`;
      html += offlineVisible.map(f => row(f, false)).join('');
    }

    if (hasMore) {
      html += `<div id="fp-more" class="fp-load-more">Show more (${offline.length - offlineVisible.length} remaining)</div>`;
    }

    if (this.follows.length === 0) {
      html = `<div class="fp-empty">You're not following anyone yet</div>`;
    }

    body.innerHTML = html;

    body.querySelectorAll('.fp-row').forEach(el => {
      el.addEventListener('click', () => {
        const pk   = (el as HTMLElement).dataset.pubkey!;
        const name = (el as HTMLElement).dataset.name!;
        const op = this.onlinePlayers.find(p => p.pubkey === pk);
        ProfileModal.show(pk, name, op?.avatar, op?.status);
      });
    });

    document.getElementById('fp-more')?.addEventListener('click', () => {
      this.offlinePage++;
      this.render();
      this.fetchNextBatch();
    });
  }

  // ── DOM construction ──────────────────────────────────────────────────────

  private buildDOM(): void {
    this.container = document.createElement('div');
    this.container.className = 'fp-panel';
    this.container.innerHTML = `
      <div class="fp-header">
        <span class="fp-title">FOLLOWS</span>
        <button class="fp-close">✕</button>
      </div>
      <div class="fp-tabs">
        <button class="fp-tab fp-tab-follows fp-tab-active">Follows</button>
        <button class="fp-tab fp-tab-online">Online</button>
      </div>
      <div class="fp-search-wrap">
        <input class="fp-search" type="text" placeholder="search…" autocomplete="off">
      </div>
      <div class="fp-body"></div>
    `;

    this.container.querySelector('.fp-close')?.addEventListener('click', () => this.close());

    this.container.querySelector('.fp-tab-follows')?.addEventListener('click', () => {
      this.activeTab = 'follows';
      this.render();
    });
    this.container.querySelector('.fp-tab-online')?.addEventListener('click', () => {
      this.activeTab = 'online';
      requestOnlinePlayers();
      this.render();
    });

    const search = this.container.querySelector('.fp-search') as HTMLInputElement;
    search?.addEventListener('input', () => {
      this.searchQuery = search.value.trim();
      this.offlinePage = 0;
      this.render();
    });
    search?.addEventListener('keydown', e => e.stopPropagation());

    document.body.appendChild(this.container);
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById('fp-styles')) return;
    const s = document.createElement('style');
    s.id = 'fp-styles';
    s.textContent = `
      .fp-panel {
        position: fixed; top: 0; left: -360px; width: 320px; height: 100vh;
        background: linear-gradient(180deg, ${P.bg} 0%, #0e0828 100%);
        border-right: 1px solid ${P.dpurp}55;
        z-index: 2000; font-family: 'Courier New', monospace;
        display: flex; flex-direction: column;
        transition: left 0.25s ease;
        box-shadow: 4px 0 24px rgba(0,0,0,0.6);
      }
      .fp-panel.fp-open { left: 0; }

      .fp-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 14px 18px; border-bottom: 1px solid ${P.dpurp}44;
        background: rgba(10,0,20,0.5); flex-shrink: 0;
      }
      .fp-title { color: ${P.teal}; font-size: 14px; font-weight: bold; letter-spacing: 0.5px; }
      .fp-close {
        background: none; border: none; color: ${P.lpurp}; font-size: 18px;
        cursor: pointer; padding: 0; opacity: 0.7; line-height: 1;
      }
      .fp-close:hover { opacity: 1; color: ${P.teal}; }

      .fp-tabs {
        display: flex; border-bottom: 1px solid ${P.dpurp}33; flex-shrink: 0;
      }
      .fp-tab {
        flex: 1; padding: 8px 0; background: none; border: none;
        color: ${P.lpurp}; font-family: 'Courier New', monospace; font-size: 11px;
        cursor: pointer; letter-spacing: 0.4px; opacity: 0.6;
        transition: color 0.15s, opacity 0.15s;
        border-bottom: 2px solid transparent; margin-bottom: -1px;
      }
      .fp-tab:hover { opacity: 0.9; color: ${P.lcream}; }
      .fp-tab-active { color: ${P.teal}; opacity: 1; border-bottom-color: ${P.teal}; }

      .fp-search-wrap { padding: 10px 14px; border-bottom: 1px solid ${P.dpurp}33; flex-shrink: 0; }
      .fp-search {
        width: 100%; box-sizing: border-box;
        background: ${P.dpurp}22; border: 1px solid ${P.dpurp}44; border-radius: 4px;
        color: ${P.lcream}; font-family: 'Courier New', monospace; font-size: 12px;
        padding: 6px 10px; outline: none;
      }
      .fp-search::placeholder { color: ${P.lpurp}; opacity: 0.5; }
      .fp-search:focus { border-color: ${P.teal}55; }

      .fp-body { flex: 1; overflow-y: auto; }
      .fp-body::-webkit-scrollbar { width: 4px; }
      .fp-body::-webkit-scrollbar-thumb { background: ${P.dpurp}44; border-radius: 2px; }

      .fp-section-label {
        font-size: 10px; letter-spacing: 0.5px; padding: 8px 14px 4px;
        color: ${P.lpurp}; opacity: 0.55;
      }

      .fp-row {
        display: flex; align-items: center; gap: 9px;
        padding: 7px 14px; cursor: pointer;
        border-bottom: 1px solid ${P.dpurp}1a;
        transition: background 0.1s;
      }
      .fp-row:hover { background: ${P.dpurp}28; }
      .fp-row-online { background: rgba(76,255,145,0.025); }

      .fp-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      .fp-dot-on  { background: #4cff91; box-shadow: 0 0 5px #4cff9188; }
      .fp-dot-off { background: ${P.dpurp}; }

      .fp-avatar {
        width: 28px; height: 28px; border-radius: 5px; flex-shrink: 0;
        object-fit: cover; border: 1px solid ${P.dpurp}44;
      }
      .fp-avatar-placeholder {
        display: flex; align-items: center; justify-content: center;
        background: ${P.dpurp}33; font-size: 13px; color: ${P.lpurp};
      }

      .fp-info { flex: 1; min-width: 0; }
      .fp-name  { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .fp-nip05 { font-size: 10px; color: ${P.teal}; opacity: 0.55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }

      .fp-load-more {
        padding: 10px 14px; text-align: center;
        color: ${P.teal}; font-size: 11px; cursor: pointer; opacity: 0.6;
      }
      .fp-load-more:hover { opacity: 1; }

      .fp-empty { color: ${P.lpurp}; font-size: 12px; text-align: center; padding: 40px 16px; opacity: 0.5; }
    `;
    document.head.appendChild(s);
  }
}
