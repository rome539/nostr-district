/**
 * ActivityLogModal.ts — Settings → "Activity Log".
 *
 * Shows every Nostr event the local user has authored in the last 7 days,
 * fetched live from relays via `fetchUserActivity()`. This is the canonical
 * audit view — what's actually published with the user's key, not a local
 * cache — so it works across devices and reflects exactly what other Nostr
 * clients can see.
 *
 * No localStorage involved. Refresh button re-queries.
 */

import { authStore } from '../stores/authStore';
import { fetchUserActivity, UserActivityEntry } from '../nostr/nostrService';
import { labelForKind, categoryForKind, EventCategory } from '../stores/signingLog';
import { onLangChange } from '../i18n/i18n';

const FILTERS: { key: EventCategory; label: string }[] = [
  { key: 'all',     label: 'All'      },
  { key: 'profile', label: 'Profile'  },
  { key: 'social',  label: 'Social'   },
  { key: 'zap',     label: 'Zaps'     },
  { key: 'message', label: 'Messages' },
  { key: 'app',     label: 'App data' },
  { key: 'other',   label: 'Other'    },
];

const FETCH_DAYS = 7;
const PAGE_SIZE  = 25;

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function timeAgo(tsSec: number): string {
  const diff = Date.now() / 1000 - tsSec;
  if (diff < 60)     return `${Math.round(diff)}s ago`;
  if (diff < 3600)   return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  return new Date(tsSec * 1000).toLocaleDateString();
}

export class ActivityLogModal {
  private el: HTMLDivElement | null = null;
  private open = false;
  private filter: EventCategory = 'all';
  private page = 0;
  private entries: UserActivityEntry[] = [];
  private loading = false;
  private _unsubLang: (() => void) | null = null;

  toggle(): void { this.open ? this.close() : this.show(); }

  show(): void {
    if (!this.el) this.build();
    else this.rebuild();
    this.el!.style.display = 'flex';
    this.open = true;
    this.refresh();
    if (!this._unsubLang) {
      this._unsubLang = onLangChange(() => { if (this.open) this.rebuild(); });
    }
  }

  close(): void {
    if (this.el) this.el.style.display = 'none';
    this.open = false;
  }

  isOpen(): boolean { return this.open; }

  destroy(): void {
    this.el?.remove();
    this.el = null;
    this._unsubLang?.();
    this._unsubLang = null;
  }

  private rebuild(): void {
    this.el?.remove();
    this.el = null;
    this.build();
  }

  /** Re-query relays for the user's recent events. */
  private async refresh(): Promise<void> {
    const pubkey = authStore.getState().pubkey;
    if (!pubkey) { this.entries = []; this.loading = false; this.page = 0; this.rebuildPreservingFocus(); return; }
    this.loading = true;
    this.page = 0;
    this.rebuildPreservingFocus();
    const events = await fetchUserActivity(pubkey, FETCH_DAYS);
    this.entries = events;
    this.loading = false;
    if (this.open) this.rebuildPreservingFocus();
  }

  /** Re-render the panel without flickering display:none. */
  private rebuildPreservingFocus(): void {
    if (!this.open) return;
    this.rebuild();
    this.el!.style.display = 'flex';
  }

  private build(): void {
    this.injectStyles();
    this.el = document.createElement('div');
    this.el.id = 'al-overlay';

    const filtered = this.filter === 'all'
      ? this.entries
      : this.entries.filter(e => categoryForKind(e.kind) === this.filter);

    // Clamp page index in case the filter shrank the list below the current page.
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (this.page >= pageCount) this.page = pageCount - 1;
    if (this.page < 0) this.page = 0;
    const pageStart = this.page * PAGE_SIZE;
    const pageEntries = filtered.slice(pageStart, pageStart + PAGE_SIZE);

    const filterChips = FILTERS.map(f => `
      <button class="al-chip" data-filter="${f.key}" style="
        ${this.filter === f.key
          ? 'background:color-mix(in srgb,var(--nd-accent) 18%,transparent);border:1px solid color-mix(in srgb,var(--nd-accent) 50%,transparent);color:var(--nd-accent);'
          : 'background:transparent;border:1px solid color-mix(in srgb,var(--nd-dpurp) 25%,transparent);color:var(--nd-subtext);'}
      ">${esc(f.label)}</button>
    `).join('');

    let bodyHtml: string;
    if (this.loading && this.entries.length === 0) {
      bodyHtml = `<div class="al-empty">Fetching from relays…</div>`;
    } else if (filtered.length === 0) {
      bodyHtml = `<div class="al-empty">${esc(this.entries.length === 0
        ? `No events found in the last ${FETCH_DAYS} days.`
        : 'No events match this filter.')}</div>`;
    } else {
      // idx passed to renderRow is the index within the current page slice —
      // matched on the .al-copy click handler against `pageEntries` below.
      bodyHtml = pageEntries.map((e, i) => this.renderRow(e, i)).join('');
    }

    const paginationHtml = pageCount > 1 ? `
      <div class="al-pagination">
        <button id="al-prev" class="al-pagebtn" ${this.page === 0 ? 'disabled' : ''}>← Prev</button>
        <span class="al-pageinfo">${this.page + 1} / ${pageCount}</span>
        <button id="al-next" class="al-pagebtn" ${this.page >= pageCount - 1 ? 'disabled' : ''}>Next →</button>
      </div>
    ` : '';

    this.el.innerHTML = `
      <div class="al-panel">
        <div class="al-header">
          <div class="al-title">✦ Activity Log</div>
          <div class="al-header-side">
            <button id="al-refresh" class="al-refresh" title="Refetch from relays" ${this.loading ? 'disabled' : ''}>${this.loading ? '…' : '↻'}</button>
            <button id="al-close" class="al-close" aria-label="Close">✕</button>
          </div>
        </div>
        <div class="al-sub">Every Nostr event your account has published in the last ${FETCH_DAYS} days, fetched live from relays. Same view any other Nostr client can see.</div>
        <div class="al-filters">${filterChips}</div>
        <div class="al-body">${bodyHtml}</div>
        ${paginationHtml}
        <div class="al-footer">
          <span class="al-count">${this.entries.length} event${this.entries.length === 1 ? '' : 's'}${this.filter === 'all' ? '' : ` · ${filtered.length} shown`}</span>
          <span class="al-window">last ${FETCH_DAYS} days</span>
        </div>
      </div>
    `;

    this.el.addEventListener('mousedown', e => { if (e.target === this.el) this.close(); });
    this.el.querySelector('#al-close')?.addEventListener('click', () => this.close());
    this.el.querySelector('#al-refresh')?.addEventListener('click', () => this.refresh());
    document.addEventListener('keydown', this._escHandler);

    this.el.querySelectorAll('.al-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        this.filter = (btn as HTMLElement).dataset.filter as EventCategory;
        this.page = 0;
        this.rebuildPreservingFocus();
      });
    });

    this.el.querySelector('#al-prev')?.addEventListener('click', () => {
      if (this.page > 0) { this.page -= 1; this.rebuildPreservingFocus(); }
    });
    this.el.querySelector('#al-next')?.addEventListener('click', () => {
      if (this.page < pageCount - 1) { this.page += 1; this.rebuildPreservingFocus(); }
    });

    this.el.querySelectorAll('.al-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.idx ?? '-1', 10);
        if (idx < 0) return;
        const entry = pageEntries[idx];
        if (!entry) return;
        const json = JSON.stringify({
          id: entry.id, kind: entry.kind, content: entry.content, tags: entry.tags, created_at: entry.createdAt,
        }, null, 2);
        navigator.clipboard?.writeText(json).then(() => {
          const orig = (btn as HTMLElement).textContent;
          (btn as HTMLElement).textContent = '✓';
          setTimeout(() => { (btn as HTMLElement).textContent = orig || '⧉'; }, 1000);
        }).catch(() => {});
      });
    });

    document.body.appendChild(this.el);
  }

  private _escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.close(); }
  };

  private renderRow(entry: UserActivityEntry, idx: number): string {
    const dTag = entry.tags.find(t => t[0] === 'd')?.[1];
    const previewRaw = entry.content.replace(/\s+/g, ' ').slice(0, 140);
    const preview = dTag
      ? `d=${esc(dTag)}${previewRaw ? ` · ${esc(previewRaw)}` : ''}`
      : esc(previewRaw);
    return `
      <div class="al-row">
        <div class="al-row-main">
          <div class="al-row-head">
            <span class="al-kind">${esc(labelForKind(entry.kind))}</span>
            <span class="al-kindnum">·</span>
            <span class="al-kindnum">${entry.kind}</span>
          </div>
          ${preview ? `<div class="al-preview">${preview}</div>` : ''}
        </div>
        <div class="al-row-side">
          <span class="al-time">${esc(timeAgo(entry.createdAt))}</span>
          <button class="al-copy" data-idx="${idx}" title="Copy JSON to clipboard">⧉</button>
        </div>
      </div>
    `;
  }

  private injectStyles(): void {
    if (document.getElementById('al-styles')) return;
    const s = document.createElement('style');
    s.id = 'al-styles';
    s.textContent = `
      #al-overlay {
        display:none;position:fixed;inset:0;z-index:4000;
        align-items:center;justify-content:center;
        background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);
      }
      .al-panel {
        background:linear-gradient(160deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border:1px solid color-mix(in srgb,var(--nd-text) 12%,transparent);
        border-radius:10px;width:560px;max-width:95vw;
        box-shadow:0 12px 48px rgba(0,0,0,0.8);
        font-family:'Courier New',monospace;
        overflow:hidden;display:flex;flex-direction:column;max-height:85dvh;
      }
      .al-header {
        display:flex;align-items:center;justify-content:space-between;
        padding:14px 20px;
        background:color-mix(in srgb,black 50%,var(--nd-bg));
        border-bottom:1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
      }
      .al-title { color:var(--nd-accent);font-size:14px;font-weight:bold;letter-spacing:1px; }
      .al-header-side { display:flex;align-items:center;gap:6px; }
      .al-refresh, .al-close {
        background:none;border:none;color:var(--nd-subtext);font-size:14px;
        cursor:pointer;padding:2px 8px;border-radius:4px;
      }
      .al-refresh:hover:not([disabled]), .al-close:hover { color:var(--nd-text); }
      .al-refresh[disabled] { opacity:0.5;cursor:not-allowed; }
      .al-sub { padding:10px 20px 4px;color:var(--nd-subtext);font-size:10px;opacity:0.7; }
      .al-filters {
        display:flex;flex-wrap:wrap;gap:4px;
        padding:8px 18px 6px;
      }
      .al-chip {
        font-family:'Courier New',monospace;font-size:10px;
        padding:4px 9px;border-radius:4px;cursor:pointer;letter-spacing:0.5px;
      }
      .al-body {
        padding:6px 14px 12px;
        overflow-y:auto;flex:1;min-height:60px;
        scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--nd-text) 15%,transparent) transparent;
      }
      .al-empty {
        text-align:center;color:var(--nd-subtext);font-size:11px;
        padding:30px 0;opacity:0.6;
      }
      .al-row {
        display:flex;align-items:flex-start;gap:10px;padding:8px 10px;
        border-radius:5px;
        background:color-mix(in srgb,black 25%,var(--nd-bg));
        border:1px solid color-mix(in srgb,var(--nd-dpurp) 10%,transparent);
        margin-bottom:4px;
      }
      .al-row-main { flex:1;min-width:0; }
      .al-row-head { display:flex;align-items:center;gap:5px;margin-bottom:2px; }
      .al-kind {
        color:var(--nd-accent);font-size:11px;font-weight:bold;letter-spacing:0.5px;
      }
      .al-kindnum { color:var(--nd-subtext);font-size:10px;opacity:0.55; }
      .al-preview {
        color:var(--nd-subtext);font-size:10px;line-height:1.4;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.75;
      }
      .al-row-side {
        display:flex;flex-direction:column;align-items:flex-end;
        gap:4px;flex-shrink:0;
      }
      .al-time { color:var(--nd-subtext);font-size:9px;opacity:0.65;white-space:nowrap; }
      .al-copy {
        background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
        border-radius:4px;color:var(--nd-subtext);
        font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
        padding:2px 7px;
      }
      .al-copy:hover { color:var(--nd-accent);border-color:color-mix(in srgb,var(--nd-accent) 45%,transparent); }
      .al-pagination {
        display:flex;align-items:center;justify-content:center;gap:14px;
        padding:8px 18px;
        background:color-mix(in srgb,black 40%,var(--nd-bg));
        border-top:1px solid color-mix(in srgb,var(--nd-text) 6%,transparent);
      }
      .al-pagebtn {
        background:color-mix(in srgb,var(--nd-dpurp) 15%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
        border-radius:4px;color:var(--nd-subtext);
        font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.5px;
        cursor:pointer;padding:4px 10px;
      }
      .al-pagebtn:hover:not([disabled]) {
        color:var(--nd-accent);
        border-color:color-mix(in srgb,var(--nd-accent) 45%,transparent);
      }
      .al-pagebtn[disabled] { opacity:0.35;cursor:not-allowed; }
      .al-pageinfo {
        color:var(--nd-subtext);font-size:10px;letter-spacing:0.5px;
        font-family:'Courier New',monospace;min-width:50px;text-align:center;
      }
      .al-footer {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 18px;
        background:color-mix(in srgb,black 50%,var(--nd-bg));
        border-top:1px solid color-mix(in srgb,var(--nd-text) 10%,transparent);
      }
      .al-count { color:var(--nd-subtext);font-size:10px;opacity:0.7; }
      .al-window { color:var(--nd-subtext);font-size:9px;opacity:0.5;letter-spacing:0.5px; }

      /* Touch-device tweaks: bump button hit-areas to meet ~44pt guidelines
         without blowing up the desktop look. \`pointer:coarse\` catches touch
         screens regardless of screen width — more accurate than min-width. */
      @media (pointer: coarse), (max-width: 480px) {
        .al-close, .al-refresh {
          padding:8px 12px;font-size:18px;min-width:36px;min-height:36px;
        }
        .al-copy {
          padding:8px 12px;font-size:14px;min-width:36px;min-height:32px;
        }
        .al-pagebtn {
          padding:10px 16px;font-size:12px;min-height:36px;
        }
        .al-chip {
          padding:7px 12px;font-size:11px;min-height:30px;
        }
        .al-row { gap:14px;padding:10px 12px; }
      }
    `;
    document.head.appendChild(s);
  }
}
