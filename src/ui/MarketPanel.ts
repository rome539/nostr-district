/**
 * MarketPanel.ts — In-game item shop
 *
 * Opens when the player presses [E] in the market room.
 * Paid items are unlocked by paying sats to roomyflag04@walletofsatoshi.com.
 * Purchases are persisted to Nostr kind:30078.
 *
 * Preview rendering → src/ui/market/MarketPreview.ts
 * Invoice modal     → src/ui/market/MarketInvoice.ts
 */

import { authStore } from '../stores/authStore';
import { CATALOG, MarketItem, isOwned, addToInventory, getInventory, getWeeklySaleItem, getSalePrice, getSaleDaysLeft } from '../stores/marketStore';
import { getAuraProgress } from '../stores/auraUnlockStore';
import { payLightningAddress } from '../nostr/zapService';
import { publishInventory, publishAvatar } from '../nostr/nostrService';
import { sendAvatarUpdate } from '../nostr/presenceService';
import { getAvatar, setAvatar, AvatarConfig } from '../stores/avatarStore';
import { usdToSats, getBtcUsdPrice } from '../stores/priceService';
import { MarketPreview } from './market/MarketPreview';
import { showInvoiceModal } from './market/MarketInvoice';

const PANEL_ID    = 'market-panel';
const STORE_LUD16 = 'roomyflag04@walletofsatoshi.com';

const SLOT_LABEL: Record<string, string> = {
  hair:      'HAIR', top:       'TOP',   bottom:    'BOT',
  hat:       'HAT',  accessory: 'ACC',   nameColor: 'COLOR',
  chatColor: 'COLOR', rodSkin:  'ROD',   nameAnim:  'ANIM',
  aura:      'AURA', eyes:      'EYES',  furniture: 'ROOM',
  wallTheme: 'WALL',
};
const SLOT_BADGE = `color:var(--nd-subtext);background:color-mix(in srgb,var(--nd-dpurp) 20%,transparent);border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);`;

type Group    = 'all' | 'clothes' | 'cosmetics' | 'room';
type Category = 'all' | 'hair' | 'top' | 'bottom' | 'hat' | 'accessory' | 'nameColor' | 'rodSkin' | 'nameAnim' | 'aura' | 'eyes' | 'furniture' | 'lounge' | 'decor' | 'tech' | 'wallTheme' | 'floorStyle';

const GROUP_SLOTS: Record<string, string[]> = {
  clothes:   ['hair', 'top', 'bottom', 'hat', 'accessory', 'eyes'],
  cosmetics: ['nameColor', 'rodSkin', 'nameAnim', 'aura'],
  room:      ['furniture', 'wallTheme', 'floorStyle'],
};

const SUB_CATEGORIES: Record<string, { key: Category; label: string }[]> = {
  clothes: [
    { key: 'hair',      label: 'HAIR'   },
    { key: 'top',       label: 'TOPS'   },
    { key: 'bottom',    label: 'BOTS'   },
    { key: 'hat',       label: 'HATS'   },
    { key: 'accessory', label: 'ACC'    },
    { key: 'eyes',      label: 'EYES'   },
  ],
  cosmetics: [
    { key: 'nameColor', label: 'COLORS' },
    { key: 'rodSkin',   label: 'ROD'    },
    { key: 'nameAnim',  label: 'ANIM'   },
    { key: 'aura',      label: 'AURA'   },
  ],
  room: [
    { key: 'lounge',    label: 'LOUNGE'  },
    { key: 'decor',     label: 'DECOR'   },
    { key: 'tech',      label: 'TECH'    },
    { key: 'wallTheme',  label: 'WALLS'  },
    { key: 'floorStyle', label: 'FLOORS' },
  ],
};

const COSMETIC_SLOTS = new Set<string>(['nameColor', 'chatColor', 'rodSkin', 'aura', 'nameAnim']);

/** Auto-equip nameColor/chatColor/rodSkin on purchase so they apply immediately. */
function autoEquip(slot: string, value: string): void {
  if (!COSMETIC_SLOTS.has(slot)) return;
  const patch: Record<string, string> = { [slot]: value };
  if (slot === 'nameColor') patch.chatColor = value;
  const updated = setAvatar(patch as any);
  publishAvatar(updated);
  sendAvatarUpdate();
}

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export class MarketPanel {
  // ─── STATE ──────────────────────────────────────────────────
  private static el:           HTMLElement | null = null;
  private static escHandler:   ((e: KeyboardEvent) => void) | null = null;
  private static _group:       Group    = 'all';
  private static _category:    Category = 'all';
  private static buying:       string | null = null;
  private static _showSats:    boolean = localStorage.getItem('nd-market-unit') === 'sats';
  private static _hideOwned:   boolean = localStorage.getItem('nd-market-hide-owned') === '1';
  private static _btcPrice:    number | null = null;
  private static _page:        number = 0;

  private static _isMobile(): boolean { return window.innerWidth < 380; }

  // ─── LIFECYCLE — open / destroy ─────────────────────────────
  static isOpen(): boolean { return !!document.getElementById(PANEL_ID); }

  static open(): void {
    MarketPanel.destroy();
    MarketPanel._group    = 'all';
    MarketPanel._category = 'all';
    MarketPanel.buying    = null;
    MarketPanel._page     = 0;
    if (MarketPanel._showSats && MarketPanel._btcPrice === null) {
      getBtcUsdPrice().then(p => { MarketPanel._btcPrice = p; MarketPanel._render(); }).catch(() => {});
    }
    MarketPanel._render();
    MarketPanel.escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') MarketPanel.destroy(); };
    window.addEventListener('keydown', MarketPanel.escHandler);
    const backdrop = document.createElement('div');
    backdrop.id = 'mp-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:3999;';
    backdrop.addEventListener('click', () => MarketPanel.destroy());
    backdrop.addEventListener('touchend', () => MarketPanel.destroy(), { passive: true });
    document.body.appendChild(backdrop);
  }

  static destroy(): void {
    MarketPreview.destroy();
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById('mp-backdrop')?.remove();
    MarketPanel.el = null;
    if (MarketPanel.escHandler) {
      window.removeEventListener('keydown', MarketPanel.escHandler);
      MarketPanel.escHandler = null;
    }
  }

  // ─── STYLES ─────────────────────────────────────────────────
  private static _injectStyles(): void {
    if (document.getElementById('market-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'market-panel-styles';
    style.textContent = `
      #market-panel #mp-items::-webkit-scrollbar { width: 4px; }
      #market-panel #mp-items::-webkit-scrollbar-track { background: transparent; }
      #market-panel #mp-items::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--nd-amber, #f0b040) 35%, transparent);
        border-radius: 2px;
      }
      #market-panel #mp-items::-webkit-scrollbar-thumb:hover {
        background: color-mix(in srgb, var(--nd-amber, #f0b040) 55%, transparent);
      }
      .mp-row { transition: border-color 0.1s; }
      .mp-row:hover { border-color: color-mix(in srgb, var(--nd-dpurp) 40%, transparent) !important; }
    `;
    document.head.appendChild(style);
  }

  // ─── PANEL SHELL — header, tabs, layout ─────────────────────
  private static _render(): void {
    document.getElementById(PANEL_ID)?.remove();
    MarketPanel._injectStyles();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:4000;
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 33%,transparent);
      border-radius:10px;padding:14px 16px 12px;
      font-family:'Courier New',monospace;
      box-shadow:0 8px 32px rgba(0,0,0,0.8);
      width:min(600px,96vw);max-height:88dvh;
      display:flex;flex-direction:column;overflow:hidden;
    `;

    const auth   = authStore.getState();
    const canBuy = !!auth.pubkey && !auth.isGuest;

    panel.innerHTML = `
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-shrink:0;">
        <span style="font-size:15px;">⚡</span>
        <div style="flex:1;color:var(--nd-text);font-size:14px;font-weight:bold;letter-spacing:0.06em;">MARKET</div>
        <button id="mp-hide-owned" title="Hide already-purchased items" style="
          padding:3px 8px;border-radius:4px;cursor:pointer;
          font-family:'Courier New',monospace;font-size:9px;font-weight:bold;letter-spacing:0.05em;
          background:${MarketPanel._hideOwned ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 18%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 18%,transparent)'};
          border:1px solid ${MarketPanel._hideOwned ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 40%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 35%,transparent)'};
          color:${MarketPanel._hideOwned ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)'};
        ">${MarketPanel._hideOwned ? '✓ HIDE OWNED' : 'HIDE OWNED'}</button>
        <button id="mp-unit-toggle" style="
          padding:3px 8px;border-radius:4px;cursor:pointer;
          font-family:'Courier New',monospace;font-size:9px;font-weight:bold;letter-spacing:0.05em;
          background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
          color:var(--nd-subtext);
        ">${MarketPanel._showSats ? '⚡ SATS' : '$ USD'}</button>
        <button id="mp-close" style="background:none;border:none;color:var(--nd-subtext);cursor:pointer;font-size:20px;line-height:1;padding:0;opacity:0.6;">×</button>
      </div>

      <!-- Tabs -->
      <div id="mp-tabs" style="display:flex;flex-direction:column;gap:0;margin-bottom:8px;flex-shrink:0;"></div>

      <!-- Weekly sale banner -->
      <div id="mp-sale-banner" style="flex-shrink:0;margin-bottom:8px;"></div>

      <!-- Inline preview — mobile only, shown on tap -->
      <div id="mp-inline-prev" style="
        display:none;flex-direction:row;align-items:center;gap:10px;
        padding:8px 10px;margin-bottom:8px;flex-shrink:0;
        background:color-mix(in srgb,var(--nd-amber,#f0b040) 7%,transparent);
        border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 25%,transparent);
        border-radius:6px;
      ">
        <div id="mp-inline-canvas" style="width:37px;height:56px;image-rendering:pixelated;flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div id="mp-inline-name" style="color:var(--nd-text);font-size:12px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
          <div id="mp-inline-tier" style="margin-top:3px;"></div>
        </div>
        <button id="mp-inline-close" style="background:none;border:none;color:var(--nd-subtext);font-size:20px;line-height:1;cursor:pointer;opacity:0.6;padding:0;flex-shrink:0;">×</button>
      </div>

      <!-- Items -->
      <div id="mp-items" style="
        display:grid;grid-template-columns:1fr 1fr;gap:4px;
        align-content:start;flex:1;min-height:0;overflow-y:auto;
        scrollbar-color:color-mix(in srgb,var(--nd-amber,#f0b040) 35%,transparent) transparent;
        scrollbar-width:thin;-webkit-overflow-scrolling:touch;
      "></div>

      <!-- Pagination -->
      <div id="mp-pagination" style="
        display:flex;align-items:center;justify-content:flex-end;gap:4px;
        padding:2px 0 0;flex-shrink:0;
      "></div>

      <!-- Status -->
      <div id="mp-status" style="
        margin-top:6px;font-size:11px;text-align:center;
        min-height:16px;color:var(--nd-subtext);flex-shrink:0;
      "></div>
      ${!canBuy ? `<div style="font-size:9px;text-align:center;color:var(--nd-subtext);opacity:0.45;flex-shrink:0;">Log in with a key to purchase</div>` : ''}
      <div style="font-size:8px;text-align:center;color:var(--nd-subtext);opacity:0.3;flex-shrink:0;margin-top:4px;">All sales final. No refunds.</div>
    `;

    document.body.appendChild(panel);
    MarketPanel.el = panel;

    panel.querySelector('#mp-inline-close')!.addEventListener('click', () => {
      MarketPreview.previewedId = null;
      MarketPreview.update(null, true);
    });

    if (!MarketPanel._isMobile()) MarketPreview.init(panel);

    panel.querySelector('#mp-close')!.addEventListener('click', () => MarketPanel.destroy());

    panel.querySelector('#mp-hide-owned')!.addEventListener('click', () => {
      MarketPanel._hideOwned = !MarketPanel._hideOwned;
      localStorage.setItem('nd-market-hide-owned', MarketPanel._hideOwned ? '1' : '0');
      const btn = panel.querySelector('#mp-hide-owned') as HTMLButtonElement;
      btn.textContent = MarketPanel._hideOwned ? '✓ HIDE OWNED' : 'HIDE OWNED';
      btn.style.background  = MarketPanel._hideOwned ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 18%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 18%,transparent)';
      btn.style.borderColor = MarketPanel._hideOwned ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 40%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 35%,transparent)';
      btn.style.color       = MarketPanel._hideOwned ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)';
      MarketPanel._page = 0;
      MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
    });

    panel.querySelector('#mp-unit-toggle')!.addEventListener('click', async () => {
      MarketPanel._showSats = !MarketPanel._showSats;
      localStorage.setItem('nd-market-unit', MarketPanel._showSats ? 'sats' : 'usd');
      const btn = panel.querySelector('#mp-unit-toggle') as HTMLButtonElement;
      if (MarketPanel._showSats && MarketPanel._btcPrice === null) {
        btn.textContent = '…'; btn.style.opacity = '0.5';
        try { MarketPanel._btcPrice = await getBtcUsdPrice(); } catch { MarketPanel._showSats = false; }
        btn.style.opacity = '1';
      }
      btn.textContent   = MarketPanel._showSats ? '⚡ SATS' : '$ USD';
      btn.style.color   = MarketPanel._showSats ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)';
      btn.style.borderColor = MarketPanel._showSats
        ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 40%,transparent)'
        : 'color-mix(in srgb,var(--nd-dpurp) 35%,transparent)';
      MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
    });

    MarketPanel._renderTabs();
    MarketPanel._renderSaleBanner(canBuy);
    MarketPanel._renderItems(canBuy);
  }

  // ─── SALE BANNER — weekly discounted item ───────────────────
  private static _renderSaleBanner(canBuy: boolean): void {
    const banner = MarketPanel.el?.querySelector('#mp-sale-banner') as HTMLElement | null;
    if (!banner) return;

    const item  = getWeeklySaleItem();
    const sale  = getSalePrice(item);
    const days  = getSaleDaysLeft();
    const owned = isOwned(item.slot, item.value);

    if (owned) { banner.innerHTML = ''; return; }

    const priceLabel = (usd: number) =>
      MarketPanel._showSats && MarketPanel._btcPrice
        ? `${Math.round((usd / MarketPanel._btcPrice) * 1e8).toLocaleString()} <span style="font-size:8px;opacity:0.7;">sat</span>`
        : `$${usd.toFixed(2)}`;

    banner.innerHTML = `
      <div id="mp-sale-card" style="
        display:flex;align-items:center;gap:10px;padding:8px 12px;
        background:color-mix(in srgb,#5dcaa5 8%,transparent);
        border:1px solid color-mix(in srgb,#5dcaa5 35%,transparent);
        border-radius:6px;
      ">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            <span style="font-size:9px;font-weight:bold;letter-spacing:0.08em;color:#5dcaa5;">🏷 DEAL OF THE WEEK</span>
            <span style="font-size:8px;color:color-mix(in srgb,#5dcaa5 60%,transparent);">${days}d left</span>
          </div>
          <div style="color:var(--nd-text);font-size:12px;font-weight:bold;">${esc(item.name)}</div>
          <span style="font-size:9px;padding:1px 5px;border-radius:2px;letter-spacing:0.05em;display:inline-block;margin-top:2px;${SLOT_BADGE}">${SLOT_LABEL[item.slot] ?? item.slot}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="color:var(--nd-subtext);font-size:10px;text-decoration:line-through;opacity:0.55;">${priceLabel(item.price)}</span>
            <span style="color:#5dcaa5;font-size:13px;font-weight:bold;">${priceLabel(sale)}</span>
          </div>
          <button id="mp-sale-buy" style="
            padding:8px 16px;border-radius:4px;cursor:${canBuy ? 'pointer' : 'not-allowed'};
            font-family:'Courier New',monospace;font-size:10px;font-weight:bold;
            background:color-mix(in srgb,#5dcaa5 20%,transparent);
            border:1px solid color-mix(in srgb,#5dcaa5 50%,transparent);
            color:#5dcaa5;opacity:${canBuy ? '1' : '0.5'};
          " ${canBuy ? '' : 'disabled'}>BUY</button>
        </div>
      </div>
    `;

    banner.querySelector('#mp-sale-buy')?.addEventListener('click', () => {
      MarketPanel._purchase(item, sale);
    });

    const card = banner.querySelector('#mp-sale-card') as HTMLElement | null;
    card?.addEventListener('mouseenter', () => {
      if (MarketPanel._isMobile() || item.slot === 'aura') return;
      MarketPreview.update(item, false);
    });
    card?.addEventListener('mouseleave', () => {
      if (MarketPanel._isMobile()) return;
      MarketPreview.update(null, false);
    });
    card?.addEventListener('touchstart', () => {
      if (item.slot === 'aura') return;
      if (MarketPreview.previewedId === item.id) {
        MarketPreview.previewedId = null;
        MarketPreview.update(null, true);
      } else {
        MarketPreview.previewedId = item.id;
        MarketPreview.update(item, true);
      }
    }, { passive: true });
  }

  // ─── TABS — group + sub-category navigation ─────────────────
  private static _renderTabs(): void {
    const container = MarketPanel.el?.querySelector('#mp-tabs');
    if (!container) return;

    const canBuy = !!authStore.getState().pubkey && !authStore.getState().isGuest;

    const primaryStyle = (active: boolean) => `
      padding:5px 14px;border-radius:5px;cursor:pointer;
      font-family:'Courier New',monospace;font-size:10px;font-weight:bold;letter-spacing:0.07em;
      border:1px solid ${active
        ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 60%,transparent)'
        : 'color-mix(in srgb,var(--nd-dpurp) 30%,transparent)'};
      background:${active ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 15%,transparent)' : 'transparent'};
      color:${active ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)'};
    `;
    const subStyle = (active: boolean) => `
      padding:3px 8px;border-radius:4px;cursor:pointer;
      font-family:'Courier New',monospace;font-size:9px;letter-spacing:0.06em;
      border:1px solid ${active
        ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 50%,transparent)'
        : 'color-mix(in srgb,var(--nd-dpurp) 28%,transparent)'};
      background:${active ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 12%,transparent)' : 'transparent'};
      color:${active ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)'};
    `;

    const subs = MarketPanel._group !== 'all' ? SUB_CATEGORIES[MarketPanel._group] ?? [] : [];

    container.innerHTML = `
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:${subs.length ? '6px' : '0'};">
        <button class="mp-group" data-group="all"       style="${primaryStyle(MarketPanel._group === 'all')}">ALL</button>
        <button class="mp-group" data-group="clothes"   style="${primaryStyle(MarketPanel._group === 'clothes')}">CLOTHES</button>
        <button class="mp-group" data-group="cosmetics" style="${primaryStyle(MarketPanel._group === 'cosmetics')}">COSMETICS</button>
        <button class="mp-group" data-group="room"      style="${primaryStyle(MarketPanel._group === 'room')}">ROOM</button>
      </div>
      ${subs.length ? `
        <div style="display:flex;gap:3px;flex-wrap:wrap;">
          ${subs.map(s => `<button class="mp-sub" data-sub="${s.key}" style="${subStyle(MarketPanel._category === s.key)}">${s.label}</button>`).join('')}
        </div>` : ''}
    `;

    container.querySelectorAll('.mp-group').forEach(btn => {
      btn.addEventListener('click', () => {
        MarketPanel._group    = (btn as HTMLElement).dataset.group as Group;
        MarketPanel._category = 'all';
        MarketPanel._page     = 0;
        MarketPanel._renderTabs();
        MarketPanel._renderItems(canBuy);
        MarketPreview.update(null, MarketPanel._isMobile());
      });
    });
    container.querySelectorAll('.mp-sub').forEach(btn => {
      btn.addEventListener('click', () => {
        const clicked = (btn as HTMLElement).dataset.sub as Category;
        MarketPanel._category = MarketPanel._category === clicked ? 'all' : clicked;
        MarketPanel._page     = 0;
        MarketPanel._renderTabs();
        MarketPanel._renderItems(canBuy);
        MarketPreview.update(null, MarketPanel._isMobile());
      });
    });
  }

  // ─── ITEMS LIST — filter, sort, paginate, render rows ───────
  private static readonly ITEMS_PER_PAGE = 20;

  private static _renderItems(canBuy: boolean): void {
    const container  = MarketPanel.el?.querySelector('#mp-items') as HTMLElement | null;
    const pagination = MarketPanel.el?.querySelector('#mp-pagination') as HTMLElement | null;
    if (!container) return;
    const mobile = MarketPanel._isMobile();
    container.style.gridTemplateColumns = mobile ? '1fr' : '1fr 1fr';

    const SUBCAT_KEYS = new Set<Category>(['lounge', 'decor', 'tech']);
    const allItems = (() => {
      const visible = CATALOG.filter(i => !i.hidden);
      const grouped = MarketPanel._group === 'all' ? visible
        : MarketPanel._category === 'all' ? visible.filter(i => (GROUP_SLOTS[MarketPanel._group] ?? []).includes(i.slot))
        : SUBCAT_KEYS.has(MarketPanel._category) ? visible.filter(i => i.subcat === MarketPanel._category)
        : visible.filter(i => i.slot === MarketPanel._category);
      const filtered = MarketPanel._hideOwned ? grouped.filter(i => !isOwned(i.slot, i.value)) : grouped;
      const SLOT_ORDER = ['hair','top','bottom','hat','accessory','eyes','nameColor','chatColor','rodSkin','nameAnim','aura','furniture','wallTheme'];
      const slotIdx = (s: string) => { const i = SLOT_ORDER.indexOf(s); return i === -1 ? 999 : i; };
      return [...filtered].sort((a, b) => {
        const so = slotIdx(a.slot) - slotIdx(b.slot);
        return so !== 0 ? so : a.price - b.price;
      });
    })();

    const PER_PAGE   = MarketPanel.ITEMS_PER_PAGE;
    const totalPages = Math.max(1, Math.ceil(allItems.length / PER_PAGE));
    MarketPanel._page = Math.min(MarketPanel._page, totalPages - 1);
    const items = allItems.slice(MarketPanel._page * PER_PAGE, (MarketPanel._page + 1) * PER_PAGE);

    if (pagination) {
      if (totalPages <= 1) {
        pagination.innerHTML = '';
      } else {
        const btnStyle = (disabled: boolean) => `
          padding:4px 10px;border-radius:4px;cursor:${disabled ? 'default' : 'pointer'};
          font-family:'Courier New',monospace;font-size:10px;font-weight:bold;
          background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
          color:${disabled ? 'color-mix(in srgb,var(--nd-subtext) 30%,transparent)' : 'var(--nd-subtext)'};
        `;
        pagination.innerHTML = `
          <button id="mp-prev" style="${btnStyle(MarketPanel._page === 0)}" ${MarketPanel._page === 0 ? 'disabled' : ''}>◀</button>
          <span style="color:var(--nd-subtext);font-size:10px;letter-spacing:0.05em;">${MarketPanel._page + 1} / ${totalPages}</span>
          <button id="mp-next" style="${btnStyle(MarketPanel._page >= totalPages - 1)}" ${MarketPanel._page >= totalPages - 1 ? 'disabled' : ''}>▶</button>
        `;
        pagination.querySelector('#mp-prev')?.addEventListener('click', () => {
          MarketPanel._page--;
          MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
          MarketPreview.update(null, mobile);
        });
        pagination.querySelector('#mp-next')?.addEventListener('click', () => {
          MarketPanel._page++;
          MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
          MarketPreview.update(null, mobile);
        });
      }
    }

    container.innerHTML = '';
    const priceLabel = (usd: number): string => {
      if (MarketPanel._showSats && MarketPanel._btcPrice) {
        const sats = Math.round((usd / MarketPanel._btcPrice) * 1e8);
        return `<span style="font-size:8px;opacity:0.7;margin-right:1px;">sat</span>${sats.toLocaleString()}`;
      }
      return `$${usd.toFixed(2)}`;
    };

    const saleItem = getWeeklySaleItem();
    const rowPad   = mobile ? '8px 10px' : '6px 8px';

    items.forEach(item => {
      const owned      = isOwned(item.slot, item.value);
      const isCosmetic = COSMETIC_SLOTS.has(item.slot);
      const avatar     = getAvatar();
      const isEquipped = isCosmetic && (avatar as any)[item.slot] === item.value;
      const onSale     = !owned && item.id === saleItem.id;
      const finalPrice = onSale ? getSalePrice(item) : item.price;

      const colorSwatch = item.value.startsWith('#')
        ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${item.value};margin-right:5px;vertical-align:middle;border:1px solid rgba(255,255,255,0.15);flex-shrink:0;"></span>`
        : item.value === 'rainbow' ? '<span style="margin-right:4px;font-size:11px;">🌈</span>' : '';

      const row = document.createElement('div');
      row.className = 'mp-row';
      row.dataset.id = item.id;
      row.style.cssText = `
        display:flex;align-items:center;gap:6px;padding:${rowPad};
        border-radius:5px;cursor:default;
        background:${isEquipped ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 7%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 7%,transparent)'};
        border:1px solid ${isEquipped ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 28%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 15%,transparent)'};
      `;

      const earnRight = (() => {
        if (!item.earn || owned) return null;
        const prog = getAuraProgress(item.value as any);
        if (prog.unlocked) return null;
        const pct = Math.min(100, Math.round((prog.count / prog.required) * 100));
        return `
          <div style="text-align:right;max-width:110px;">
            <div style="font-size:10px;color:var(--nd-subtext);margin-bottom:3px;">${prog.count} / ${prog.required}</div>
            <div style="width:80px;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;margin-bottom:4px;margin-left:auto;">
              <div style="width:${pct}%;height:100%;background:#9a6eff;border-radius:2px;"></div>
            </div>
            <div style="font-size:9px;color:#9a6eff;opacity:0.8;line-height:1.3;">${esc(prog.hint)}</div>
          </div>`;
      })();

      const btnPad = mobile ? '8px 14px' : '6px 10px';
      row.innerHTML = `
        <div style="flex:1;min-width:0;overflow:hidden;">
          <div style="color:var(--nd-text);font-size:12px;font-weight:bold;display:flex;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${colorSwatch}${esc(item.name)}</div>
          <span style="font-size:10px;padding:1px 5px;border-radius:2px;letter-spacing:0.05em;display:inline-block;margin-top:3px;${SLOT_BADGE}">${SLOT_LABEL[item.slot] ?? item.slot}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:center;flex-shrink:0;gap:2px;">
          ${earnRight ??
            (owned
              ? isCosmetic
                ? `<button class="mp-equip" data-id="${esc(item.id)}" style="
                     padding:${btnPad};border-radius:4px;cursor:pointer;
                     font-family:'Courier New',monospace;font-size:10px;font-weight:bold;
                     background:${isEquipped ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 22%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 18%,transparent)'};
                     border:1px solid ${isEquipped ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 50%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 35%,transparent)'};
                     color:${isEquipped ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)'};
                   ">${isEquipped ? '✓ ON' : 'EQUIP'}</button>`
                : `<span style="color:#5dcaa5;font-size:10px;font-weight:bold;">✓ OWNED</span>`
              : `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px;">
                   ${onSale ? `<span style="color:var(--nd-subtext);font-size:9px;text-decoration:line-through;opacity:0.5;">${priceLabel(item.price)}</span>` : ''}
                   <div style="color:${onSale ? '#5dcaa5' : 'var(--nd-amber,#f0b040)'};font-size:11px;font-weight:bold;">${priceLabel(finalPrice)}</div>
                 </div>
                 <button class="mp-buy" data-id="${esc(item.id)}" data-price="${finalPrice}" style="
                   padding:${btnPad};border-radius:4px;cursor:${canBuy ? 'pointer' : 'not-allowed'};
                   font-family:'Courier New',monospace;font-size:10px;font-weight:bold;
                   background:color-mix(in srgb,var(--nd-amber,#f0b040) 18%,transparent);
                   border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 45%,transparent);
                   color:var(--nd-amber,#f0b040);opacity:${canBuy ? '1' : '0.5'};
                 " ${canBuy ? '' : 'disabled'}>BUY</button>`
            )
          }
        </div>
      `;

      row.addEventListener('mouseenter', () => {
        if (mobile) return;
        const it = CATALOG.find(i => i.id === row.dataset.id);
        if (it && it.slot !== 'aura') MarketPreview.update(it, false);
      });
      row.addEventListener('mouseleave', () => {
        if (mobile) return;
        MarketPreview.update(null, false);
      });
      row.addEventListener('touchstart', () => {
        const it = CATALOG.find(i => i.id === row.dataset.id);
        if (!it || it.slot === 'aura') return;
        if (MarketPreview.previewedId === it.id) {
          MarketPreview.previewedId = null;
          MarketPreview.update(null, true);
        } else {
          MarketPreview.previewedId = it.id;
          MarketPreview.update(it, true);
        }
      }, { passive: true });

      container.appendChild(row);
    });

    container.querySelectorAll('.mp-buy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el   = btn as HTMLElement;
        const item = CATALOG.find(i => i.id === el.dataset.id);
        if (!item) return;
        const overridePrice = el.dataset.price ? parseFloat(el.dataset.price) : undefined;
        MarketPanel._purchase(item, overridePrice);
      });
    });

    container.querySelectorAll('.mp-equip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = CATALOG.find(i => i.id === (btn as HTMLElement).dataset.id);
        if (!item) return;
        const avatar = getAvatar();
        const newVal = (avatar as any)[item.slot] === item.value ? '' : item.value;
        const patch: Partial<AvatarConfig> = { [item.slot]: newVal } as any;
        if (item.slot === 'nameColor') patch.chatColor = newVal;
        const updated = setAvatar(patch);
        publishAvatar(updated);
        sendAvatarUpdate();
        MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
        MarketPreview.update(null, mobile);
      });
    });
  }

  // ─── CHECKOUT — invoice modal + payment polling + grant ─────
  private static async _purchase(item: MarketItem, overridePrice?: number): Promise<void> {
    if (MarketPanel.buying) return;
    MarketPanel.buying = item.id;

    const setStatus = (msg: string) => {
      const el = MarketPanel.el?.querySelector('#mp-status');
      if (el) el.textContent = msg;
    };

    MarketPanel.el?.querySelectorAll('.mp-buy').forEach(b => ((b as HTMLButtonElement).disabled = true));
    setStatus('Getting price…');

    const chargeUsd = overridePrice ?? item.price;
    let sats: number;
    try {
      sats = await usdToSats(chargeUsd);
    } catch {
      setStatus('✗ Could not fetch BTC price');
      MarketPanel.buying = null;
      MarketPanel.el?.querySelectorAll('.mp-buy').forEach(b => ((b as HTMLButtonElement).disabled = false));
      return;
    }

    setStatus(`Buying ${item.name} for ${sats.toLocaleString()} sats…`);

    const result = await payLightningAddress(STORE_LUD16, sats, setStatus, { id: item.id, slot: item.slot, value: item.value, name: item.name });

    if (result.status === 'paid') {
      addToInventory(item.slot, item.value);
      publishInventory(getInventory());
      autoEquip(item.slot, item.value);
      setStatus(`✓ ${item.name} unlocked!`);
      setTimeout(() => {
        MarketPanel._renderSaleBanner(true);
        MarketPanel._renderItems(true);
        const el = MarketPanel.el?.querySelector('#mp-status');
        if (el) el.textContent = '';
      }, 1200);
    } else if (result.status === 'invoice') {
      setStatus('');
      console.log('[market] invoice — verifyUrl:', result.verifyUrl ?? '(none)', '| zapEventId:', result.zapEventId ?? '(none)');
      showInvoiceModal(
        result.invoice!, item.name, sats,
        result.verifyUrl, result.nostrPubkey, result.zapEventId,
        item,
        () => {
          addToInventory(item.slot, item.value);
          publishInventory(getInventory());
          autoEquip(item.slot, item.value);
          MarketPanel._renderSaleBanner(true);
          MarketPanel._renderItems(true);
          const statusEl = MarketPanel.el?.querySelector('#mp-status');
          if (statusEl) {
            statusEl.textContent = `✓ ${item.name} unlocked!`;
            setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
          }
        },
      );
    } else {
      setStatus(`✗ ${result.error || 'Payment failed'}`);
      setTimeout(() => {
        const el = MarketPanel.el?.querySelector('#mp-status');
        if (el) el.textContent = '';
      }, 3000);
    }

    MarketPanel.buying = null;
    MarketPanel.el?.querySelectorAll('.mp-buy').forEach(b => {
      const i = CATALOG.find(c => c.id === (b as HTMLElement).dataset.id);
      if (i && !isOwned(i.slot, i.value)) (b as HTMLButtonElement).disabled = false;
    });
  }
}
