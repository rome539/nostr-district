/**
 * MarketPanel.ts — In-game item shop
 *
 * Opens when the player presses [E] in the market room.
 * Paid items are unlocked by paying sats to roomyflag04@walletofsatoshi.com.
 * Purchases are persisted to Nostr kind:30078.
 */

import { authStore } from '../stores/authStore';
import { CATALOG, MarketItem, ROD_SKINS, isOwned, addToInventory, getInventory, isAnimatedColor, getAnimatedColor, getWeeklySaleItem, getSalePrice, getSaleDaysLeft } from '../stores/marketStore';
import { getAuraProgress } from '../stores/auraUnlockStore';

const SLOT_LABEL: Record<string, string> = {
  hair:      'HAIR', top:       'TOP',   bottom:   'BOT',
  hat:       'HAT',  accessory: 'ACC',   nameColor:'COLOR',
  chatColor: 'COLOR', rodSkin:  'ROD',   nameAnim: 'ANIM',
  aura:      'AURA', eyes:      'EYES',
};
const SLOT_BADGE = `color:var(--nd-subtext);background:color-mix(in srgb,var(--nd-dpurp) 20%,transparent);border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);`;
import { payLightningAddress, watchForPurchaseReceipt } from '../nostr/zapService';
import { publishInventory, publishAvatar } from '../nostr/nostrService';
import { sendAvatarUpdate } from '../nostr/presenceService';
import { getAvatar, setAvatar, AvatarConfig } from '../stores/avatarStore';
import { usdToSats, getBtcUsdPrice } from '../stores/priceService';
// @ts-ignore — JS module, no types
import { renderQR } from '../../nip46-bunker.js';
import { renderHubSprite } from '../entities/AvatarRenderer';

const PANEL_ID    = 'market-panel';
const STORE_LUD16 = 'roomyflag04@walletofsatoshi.com';

type Group    = 'all' | 'clothes' | 'cosmetics';
type Category = 'all' | 'hair' | 'top' | 'bottom' | 'hat' | 'accessory' | 'nameColor' | 'rodSkin' | 'nameAnim' | 'aura' | 'eyes';

const GROUP_SLOTS: Record<string, string[]> = {
  clothes:   ['hair', 'top', 'bottom', 'hat', 'accessory', 'eyes'],
  cosmetics: ['nameColor', 'rodSkin', 'nameAnim', 'aura'],
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
};

const COSMETIC_SLOTS  = new Set<string>(['nameColor', 'chatColor', 'rodSkin', 'aura', 'nameAnim']);
const WEARABLE_SLOTS  = new Set<string>(['hair', 'top', 'bottom', 'hat', 'accessory', 'eyes']);

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
  private static el:              HTMLElement | null = null;
  private static escHandler:      ((e: KeyboardEvent) => void) | null = null;
  private static outsideHandler:  ((e: MouseEvent | TouchEvent) => void) | null = null;
  private static _group:       Group    = 'all';
  private static _category:    Category = 'all';
  private static buying:       string | null = null;
  private static _showSats:    boolean = localStorage.getItem('nd-market-unit') === 'sats';
  private static _hideOwned:   boolean = localStorage.getItem('nd-market-hide-owned') === '1';
  private static _btcPrice:    number | null = null;
  private static _previewedId: string | null = null;
  private static _previewAnimId: number | null = null;
  private static _page: number = 0;
  private static _pendingPollTimer:      number = 0;
  private static _pendingCleanupReceipt: (() => void) | null = null;

  // ─── HELPERS ────────────────────────────────────────────────
  private static _cancelPreviewAnim(): void {
    if (MarketPanel._previewAnimId !== null) {
      cancelAnimationFrame(MarketPanel._previewAnimId);
      MarketPanel._previewAnimId = null;
    }
  }

  private static _isMobile(): boolean { return window.innerWidth < 380; }

  // ─── LIFECYCLE — open / destroy ─────────────────────────────
  static isOpen(): boolean { return !!document.getElementById(PANEL_ID); }

  static open(): void {
    MarketPanel.destroy();
    MarketPanel._group    = 'all';
    MarketPanel._category = 'all';
    MarketPanel.buying = null;
    MarketPanel._page = 0;
    if (MarketPanel._showSats && MarketPanel._btcPrice === null) {
      getBtcUsdPrice().then(p => { MarketPanel._btcPrice = p; MarketPanel._render(); }).catch(() => {});
    }
    MarketPanel._render();
    MarketPanel.escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') MarketPanel.destroy(); };
    window.addEventListener('keydown', MarketPanel.escHandler);
    // Close on click/touch outside the panel — use setTimeout so this tick's open-click doesn't fire immediately
    setTimeout(() => {
      MarketPanel.outsideHandler = (e: MouseEvent | TouchEvent) => {
        const target = e.type === 'touchend' ? (e as TouchEvent).changedTouches[0]?.target : (e as MouseEvent).target;
        if (MarketPanel.el && target instanceof Node && !MarketPanel.el.contains(target)) {
          MarketPanel.destroy();
        }
      };
      document.addEventListener('mousedown', MarketPanel.outsideHandler as (e: MouseEvent) => void);
      document.addEventListener('touchend',  MarketPanel.outsideHandler as (e: TouchEvent) => void, { passive: true });
    }, 0);
  }

  static destroy(): void {
    MarketPanel._cancelPreviewAnim();
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById('mp-preview')?.remove();
    MarketPanel.el = null;
    if (MarketPanel.escHandler) {
      window.removeEventListener('keydown', MarketPanel.escHandler);
      MarketPanel.escHandler = null;
    }
    if (MarketPanel.outsideHandler) {
      document.removeEventListener('mousedown', MarketPanel.outsideHandler as (e: MouseEvent) => void);
      document.removeEventListener('touchend',  MarketPanel.outsideHandler as (e: TouchEvent) => void);
      MarketPanel.outsideHandler = null;
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

  // ─── PANEL SHELL — header, tabs container, layout ───────────
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

      <!-- Items — full width -->
      <div id="mp-items" style="
        display:grid;grid-template-columns:1fr 1fr;gap:4px;
        align-content:start;flex:1;min-height:0;overflow-y:auto;
        scrollbar-color:color-mix(in srgb,var(--nd-amber,#f0b040) 35%,transparent) transparent;
        scrollbar-width:thin;-webkit-overflow-scrolling:touch;
      "></div>

      <!-- Pagination -->
      <div id="mp-pagination" style="
        display:flex;align-items:center;justify-content:center;gap:6px;
        padding:5px 0 2px;flex-shrink:0;min-height:24px;
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
      MarketPanel._previewedId = null;
      MarketPanel._updatePreview(null);
    });

    // Floating preview — desktop only, lives outside panel so it never blocks items
    if (!MarketPanel._isMobile()) {
      const preview = document.createElement('div');
      preview.id = 'mp-preview';
      preview.style.cssText = `
        position:fixed;z-index:3999;
        background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
        border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 35%,transparent);
        border-radius:10px;padding:10px;
        display:flex;flex-direction:column;align-items:center;gap:6px;
        pointer-events:none;
        opacity:0;transition:opacity 0.15s;
        backdrop-filter:blur(6px);
        box-shadow:0 6px 24px rgba(0,0,0,0.8);
        width:140px;
      `;
      preview.innerHTML = `
        <div id="mp-canvas-wrap" style="width:111px;height:168px;image-rendering:pixelated;"></div>
        <div id="mp-preview-name" style="color:var(--nd-text);font-size:9px;font-weight:bold;text-align:center;line-height:1.3;word-break:break-word;"></div>
        <div id="mp-preview-tier"></div>
        <div id="mp-preview-extra"></div>
      `;
      document.body.appendChild(preview);

      const positionPreview = () => {
        const rect = panel.getBoundingClientRect();
        preview.style.left      = `${rect.left - 140 - 10}px`;
        preview.style.top       = `${rect.top + rect.height / 2}px`;
        preview.style.transform = `translateY(-50%)`;
      };
      positionPreview();
      window.addEventListener('resize', positionPreview);
    }

    panel.querySelector('#mp-close')!.addEventListener('click', () => MarketPanel.destroy());

    panel.querySelector('#mp-hide-owned')!.addEventListener('click', () => {
      MarketPanel._hideOwned = !MarketPanel._hideOwned;
      localStorage.setItem('nd-market-hide-owned', MarketPanel._hideOwned ? '1' : '0');
      const btn = panel.querySelector('#mp-hide-owned') as HTMLButtonElement;
      btn.textContent = MarketPanel._hideOwned ? '✓ HIDE OWNED' : 'HIDE OWNED';
      btn.style.background = MarketPanel._hideOwned
        ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 18%,transparent)'
        : 'color-mix(in srgb,var(--nd-dpurp) 18%,transparent)';
      btn.style.borderColor = MarketPanel._hideOwned
        ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 40%,transparent)'
        : 'color-mix(in srgb,var(--nd-dpurp) 35%,transparent)';
      btn.style.color = MarketPanel._hideOwned ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)';
      MarketPanel._page = 0;
      MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
    });

    panel.querySelector('#mp-unit-toggle')!.addEventListener('click', async () => {
      MarketPanel._showSats = !MarketPanel._showSats;
      localStorage.setItem('nd-market-unit', MarketPanel._showSats ? 'sats' : 'usd');
      const btn = panel.querySelector('#mp-unit-toggle') as HTMLButtonElement;
      if (MarketPanel._showSats && MarketPanel._btcPrice === null) {
        btn.textContent = '…';
        btn.style.opacity = '0.5';
        try { MarketPanel._btcPrice = await getBtcUsdPrice(); } catch { MarketPanel._showSats = false; }
        btn.style.opacity = '1';
      }
      btn.textContent = MarketPanel._showSats ? '⚡ SATS' : '$ USD';
      btn.style.color = MarketPanel._showSats ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)';
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

    const item     = getWeeklySaleItem();
    const sale     = getSalePrice(item);
    const days     = getSaleDaysLeft();
    const owned    = isOwned(item.slot, item.value);

    if (owned) { banner.innerHTML = ''; return; }

    const priceLabel = (usd: number) =>
      MarketPanel._showSats && MarketPanel._btcPrice
        ? `${Math.round((usd / MarketPanel._btcPrice) * 1e8).toLocaleString()} <span style="font-size:8px;opacity:0.7;">sat</span>`
        : `$${usd.toFixed(2)}`;

    banner.innerHTML = `
      <div style="
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
  }

  // ─── PREVIEW — desktop floating + mobile inline ─────────────
  private static _drawPreviewCanvas(config: AvatarConfig): void {
    const wrap = document.getElementById('mp-canvas-wrap');
    if (!wrap) return;
    const canvas = renderHubSprite(config);
    canvas.style.cssText = `width:111px;height:168px;image-rendering:pixelated;display:block;`;
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
  }

  private static _updatePreview(item: MarketItem | null): void {
    if (MarketPanel._isMobile()) {
      MarketPanel._updateInlinePreview(item);
      return;
    }
    const overlay = document.getElementById('mp-preview') as HTMLElement | null;
    const nameEl  = overlay?.querySelector('#mp-preview-name') as HTMLElement | null;
    const tierEl  = overlay?.querySelector('#mp-preview-tier') as HTMLElement | null;
    const extraEl = overlay?.querySelector('#mp-preview-extra') as HTMLElement | null;
    if (!nameEl || !tierEl || !extraEl) return;

    if (!item) { MarketPanel._cancelPreviewAnim(); if (overlay) overlay.style.opacity = '0'; return; }
    if (overlay) overlay.style.opacity = '1';

    nameEl.style.cssText = 'color:var(--nd-text);font-size:12px;font-weight:bold;';
    nameEl.textContent   = item.name;
    tierEl.innerHTML     = `<span style="font-size:8px;padding:1px 5px;border-radius:3px;letter-spacing:0.05em;${SLOT_BADGE}">${SLOT_LABEL[item.slot] ?? item.slot}</span>`;
    extraEl.innerHTML    = '';

    MarketPanel._cancelPreviewAnim();
    if (item.slot === 'nameColor' || item.slot === 'chatColor') {
      const makeCanvas = (col: string) => MarketPanel._makeColorPreviewCanvas(getAvatar(), col);
      if (isAnimatedColor(item.value)) {
        const loop = () => {
          MarketPanel._setPreviewCanvas(makeCanvas(getAnimatedColor(item.value, Date.now())));
          MarketPanel._previewAnimId = requestAnimationFrame(loop);
        };
        loop();
      } else {
        MarketPanel._setPreviewCanvas(makeCanvas(item.value));
      }
    } else if (item.slot === 'nameAnim') {
      const avatar = getAvatar();
      const color  = avatar.nameColor || '#ffffff';
      const loop = () => {
        const t = Date.now();
        let tagTransform: { tx?: number; ty?: number; scale?: number; angle?: number; alpha?: number; shadowColor?: string; shadowBlur?: number; charOffsets?: number[] } = {};
        const name = (authStore.getState().displayName ?? 'Player').slice(0, 14);
        switch (item.value) {
          case 'bob':    tagTransform = { ty: Math.sin(t / 400) * 4 }; break;
          case 'pulse':  tagTransform = { scale: 1 + Math.sin(t / 350) * 0.08 }; break;
          case 'jitter': tagTransform = { tx: (Math.random() - 0.5) * 2, ty: (Math.random() - 0.5) * 1.5 }; break;
          case 'zoom': {
            const p = (t % 900) / 900;
            const b1 = p < 0.22 ? Math.sin((p / 0.22) * Math.PI) : 0;
            const b2 = p >= 0.28 && p < 0.46 ? Math.sin(((p - 0.28) / 0.18) * Math.PI) : 0;
            tagTransform = { scale: 1 + b1 * 0.2 + b2 * 0.12 };
            break;
          }
          case 'swing':
            tagTransform = { angle: Math.sin(t / 550) * (10 * Math.PI / 180) };
            break;
          case 'wave': {
            const offsets = Array.from({ length: name.length }, (_, i) => Math.sin(t / 280 + i * 0.7) * 4);
            tagTransform = { charOffsets: offsets };
            break;
          }
          case 'glow': {
            const flicker = Math.random() < 0.015 ? 0.25 : Math.random() < 0.04 ? 0.75 : 1;
            tagTransform = { alpha: flicker, shadowColor: color, shadowBlur: 10 + Math.sin(t / 600) * 4 };
            break;
          }
        }
        MarketPanel._setPreviewCanvas(MarketPanel._makeNameTagCanvas(avatar, color, tagTransform));
        MarketPanel._previewAnimId = requestAnimationFrame(loop);
      };
      loop();
    } else if (item.slot === 'eyes' && ['blaze','frost','cosmic','cry'].includes(item.value)) {
      const src = renderHubSprite({ ...getAvatar(), eyes: item.value } as AvatarConfig);
      const W = 111, H = 168;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d')!;
      // Eye pixel centres in preview coords (hub canvas 37×56 at 3×)
      const lx  = 46.5;
      const rx  = item.value === 'blaze' ? 58.5 : 61.5;
      const eyY = 73.5;

      if (item.value === 'cry') {
        // cry keeps particle animation (tears falling down)
        const SPX = (v: number) => v * 0.33 / 60 * 3;
        const toRad = (deg: number) => deg * Math.PI / 180;
        const rand  = (a: number, b: number) => a + Math.random() * (b - a);
        const pick  = (a: string[]) => a[Math.floor(Math.random() * a.length)];
        interface Ptcl { x:number; y:number; vx:number; vy:number; gy:number; life:number; decay:number; r:number; col:string; }
        const pts: Ptcl[] = [];
        const spawn = (ex: number): Ptcl => {
          const a = toRad(rand(88,92)), sp = SPX(rand(1,4));
          return { x:ex+rand(-0.5,0.5), y:eyY, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, gy:SPX(10)/60,
                   life:1, decay:1/rand(36,66), r:rand(1.5,3.0), col:pick(['#4488ff','#88aaff','#2266dd','#66aaff']) };
        };
        let lastSpawn = 0;
        const loop = () => {
          const now = Date.now();
          ctx.clearRect(0, 0, W, H);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(src, 0, 0, W, H);
          if (now - lastSpawn > 650) { pts.push(spawn(lx), spawn(rx)); lastSpawn = now; }
          ctx.globalCompositeOperation = 'lighter';
          for (let i = pts.length - 1; i >= 0; i--) {
            const p = pts[i];
            p.x += p.vx; p.y += p.vy; p.vy += p.gy; p.life -= p.decay;
            if (p.life <= 0) { pts.splice(i, 1); continue; }
            ctx.globalAlpha = p.life * 0.9;
            ctx.fillStyle = p.col;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          MarketPanel._previewAnimId = requestAnimationFrame(loop);
        };
        MarketPanel._setPreviewCanvas(c);
        loop();
      } else {
        // blaze/frost/cosmic — re-render avatar with cycling eyeColor, matching in-game behavior
        const PALETTES: Record<string, string[]> = {
          blaze:  ['#ff6600','#ff3300','#ffaa00','#ffdd00','#ff4400'],
          frost:  ['#aaddff','#ffffff','#88ccff','#cceeff','#44aaff'],
          cosmic: ['#ffffff','#aa88ff','#ff88ff','#88ffff','#ffff88'],
        };
        const SPEED_MS: Record<string, number> = { blaze: 100, frost: 280, cosmic: 360 };
        const pal = PALETTES[item.value];
        const spd = SPEED_MS[item.value];
        let lastStep = -1;
        const loop = () => {
          const step = Math.floor(Date.now() / spd) % pal.length;
          if (step !== lastStep) {
            lastStep = step;
            const frame = renderHubSprite({ ...getAvatar(), eyes: item.value, eyeColor: pal[step] } as AvatarConfig);
            ctx.clearRect(0, 0, W, H);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(frame, 0, 0, W, H);
          }
          MarketPanel._previewAnimId = requestAnimationFrame(loop);
        };
        MarketPanel._setPreviewCanvas(c);
        loop();
      }
    } else if (item.slot === 'rodSkin') {
      if (item.value === 'legendary') {
        const loop = () => {
          MarketPanel._setPreviewCanvas(MarketPanel._makeRodCanvas(item.value));
          MarketPanel._previewAnimId = requestAnimationFrame(loop);
        };
        loop();
      } else {
        MarketPanel._setPreviewCanvas(MarketPanel._makeRodCanvas(item.value));
      }
    } else if (WEARABLE_SLOTS.has(item.slot)) {
      MarketPanel._drawPreviewCanvas({ ...getAvatar(), [item.slot]: item.value } as AvatarConfig);
    } else {
      MarketPanel._drawPreviewCanvas(getAvatar());
    }
  }

  private static _updateInlinePreview(item: MarketItem | null): void {
    const el = document.getElementById('mp-inline-prev') as HTMLElement | null;
    if (!el) return;
    if (!item) { el.style.display = 'none'; return; }

    el.style.display = 'flex';
    const nameEl    = el.querySelector('#mp-inline-name')   as HTMLElement;
    const tierEl    = el.querySelector('#mp-inline-tier')   as HTMLElement;
    const canvasWrap = el.querySelector('#mp-inline-canvas') as HTMLElement;

    nameEl.textContent = item.name;
    tierEl.innerHTML   = `<span style="font-size:8px;padding:1px 5px;border-radius:3px;letter-spacing:0.05em;${SLOT_BADGE}">${SLOT_LABEL[item.slot] ?? item.slot}</span>`;

    let canvas: HTMLCanvasElement;
    if (item.slot === 'nameColor')       canvas = MarketPanel._makeNameTagCanvas(getAvatar(), item.value);
    else if (item.slot === 'chatColor')  canvas = MarketPanel._makeChatCanvas(getAvatar(), item.value);
    else if (item.slot === 'rodSkin')    canvas = MarketPanel._makeRodCanvas(item.value);
    else if (WEARABLE_SLOTS.has(item.slot)) canvas = renderHubSprite({ ...getAvatar(), [item.slot]: item.value } as AvatarConfig);
    else                                 canvas = renderHubSprite(getAvatar());

    canvas.style.cssText = 'width:37px;height:56px;image-rendering:pixelated;display:block;';
    canvasWrap.innerHTML = '';
    canvasWrap.appendChild(canvas);
  }

  private static _setPreviewCanvas(canvas: HTMLCanvasElement): void {
    const wrap = document.getElementById('mp-canvas-wrap');
    if (!wrap) return;
    // These canvases are already at 111×168 native — no pixelated upscaling needed
    canvas.style.cssText = `width:111px;height:168px;display:block;`;
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
  }

  /** Builds a 111×168 canvas with avatar + chat bubble above head + name tag below feet. */
  private static _makeColorPreviewCanvas(avatar: AvatarConfig, color: string): HTMLCanvasElement {
    const src = renderHubSprite(avatar);
    const S   = 3;
    const W   = src.width  * S; // 111
    const H   = src.height * S; // 168

    const c   = document.createElement('canvas');
    c.width   = W; c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    const isRainbow = color === 'rainbow';
    const rawName   = authStore.getState().displayName ?? 'Player';
    const name      = rawName.length > 12 ? rawName.slice(0, 11) + '…' : rawName;

    const maxW  = W - 8;
    let fSize   = 13;
    ctx.font    = `bold ${fSize}px monospace`;
    let tw      = ctx.measureText(name).width;
    if (tw > maxW - 10) { fSize = 11; ctx.font = `bold ${fSize}px monospace`; tw = ctx.measureText(name).width; }
    if (tw > maxW - 10) { fSize = 9;  ctx.font = `bold ${fSize}px monospace`; tw = ctx.measureText(name).width; }

    const ph  = fSize + 7;
    const pad = 6;
    const pw  = Math.min(tw + pad * 2, maxW);
    const nx  = Math.round((W - pw) / 2);
    const ny  = H - ph - 6;

    // Avatar — feet just above name tag
    ctx.drawImage(src, 0, ny - 4 - H, W, H);

    const rainbowGrad = (x0: number, x1: number) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      ['0','60','120','180','240','300','360'].forEach((h, i, a) =>
        g.addColorStop(i / (a.length - 1), `hsl(${h},90%,68%)`));
      return g;
    };

    const fill = isRainbow ? rainbowGrad(nx, nx + pw) : color;

    // ── Name tag ──────────────────────────────────────────────────────
    ctx.fillStyle = '#0a0014ee';
    ctx.beginPath(); ctx.roundRect(nx, ny, pw, ph, 4); ctx.fill();
    ctx.fillStyle = fill; ctx.font = `bold ${fSize}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, W / 2, ny + ph / 2 + 0.5, pw - pad);

    // ── Chat bubble ───────────────────────────────────────────────────
    const msg    = 'Hello!';
    const cfSize = 12;
    ctx.font = `${cfSize}px monospace`;
    const ctw = ctx.measureText(msg).width;
    const cph = cfSize + 7;
    const cpw = ctw + pad * 2;
    const bx  = Math.round((W - cpw) / 2);
    const by  = 4;

    const bfill = isRainbow ? rainbowGrad(bx, bx + cpw) : color;

    ctx.fillStyle = '#0a0014ee';
    ctx.beginPath(); ctx.roundRect(bx, by, cpw, cph, 4); ctx.fill();
    ctx.fillStyle = bfill;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(msg, W / 2, by + cph / 2 + 0.5);

    // Bubble tail
    const mid = W / 2;
    ctx.fillStyle = isRainbow ? rainbowGrad(mid - 4, mid + 4) : color + 'cc';
    ctx.beginPath();
    ctx.moveTo(mid - 4, by + cph); ctx.lineTo(mid + 4, by + cph); ctx.lineTo(mid, by + cph + 6);
    ctx.closePath(); ctx.fill();

    return c;
  }

  /** Builds a 111×168 canvas: avatar upscaled 3× (pixelated) + name tag pill drawn at native res.
   *  tagTransform optionally offsets/scales only the name tag, leaving the avatar static. */
  private static _makeNameTagCanvas(
    avatar: AvatarConfig,
    color: string,
    tagTransform?: { tx?: number; ty?: number; scale?: number; angle?: number; alpha?: number; shadowColor?: string; shadowBlur?: number; charOffsets?: number[] },
  ): HTMLCanvasElement {
    const src  = renderHubSprite(avatar); // 37×56 pixels
    const S    = 3;
    const W    = src.width  * S; // 111
    const H    = src.height * S; // 168

    const c   = document.createElement('canvas');
    c.width   = W;
    c.height  = H;
    const ctx = c.getContext('2d')!;

    ctx.imageSmoothingEnabled = false;

    const isRainbow = color === 'rainbow';
    const rawName   = authStore.getState().displayName ?? 'Player';

    // Pick a font size that fits within the canvas width
    const maxW   = W - 8;
    let   fSize  = 13;
    const name   = rawName.length > 12 ? rawName.slice(0, 11) + '…' : rawName;
    ctx.font     = `bold ${fSize}px monospace`;
    let   tw     = ctx.measureText(name).width;
    if (tw > maxW - 10) { fSize = 11; ctx.font = `bold ${fSize}px monospace`; tw = ctx.measureText(name).width; }
    if (tw > maxW - 10) { fSize = 9;  ctx.font = `bold ${fSize}px monospace`; tw = ctx.measureText(name).width; }

    const ph  = fSize + 7;
    const pad = 6;
    const pw  = Math.min(tw + pad * 2, maxW);
    const nx  = Math.round((W - pw) / 2);
    const ny  = H - ph - 6; // below the player feet

    // Draw avatar — never transformed
    const avatarY = ny - 4 - H;
    ctx.drawImage(src, 0, avatarY, W, H);

    const rainbowGrad = (x0: number, x1: number) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0,    'hsl(0,90%,68%)');
      g.addColorStop(0.17, 'hsl(60,90%,68%)');
      g.addColorStop(0.33, 'hsl(120,90%,68%)');
      g.addColorStop(0.50, 'hsl(180,90%,68%)');
      g.addColorStop(0.67, 'hsl(240,90%,68%)');
      g.addColorStop(0.83, 'hsl(300,90%,68%)');
      g.addColorStop(1,    'hsl(360,90%,68%)');
      return g;
    };

    // Apply tag-only transform
    const tx           = tagTransform?.tx          ?? 0;
    const ty           = tagTransform?.ty          ?? 0;
    const scale        = tagTransform?.scale       ?? 1;
    const angle        = tagTransform?.angle       ?? 0;
    const alpha        = tagTransform?.alpha       ?? 1;
    const shadowColor  = tagTransform?.shadowColor ?? null;
    const shadowBlur   = tagTransform?.shadowBlur  ?? 0;
    const charOffsets  = tagTransform?.charOffsets ?? null;
    const cx           = nx + pw / 2; // pivot = tag centre
    const cy           = ny + ph / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx + tx, cy + ty);
    ctx.scale(scale, scale);
    ctx.rotate(angle);
    ctx.translate(-cx, -cy);

    ctx.fillStyle = '#0a0014ee';
    ctx.beginPath();
    ctx.roundRect(nx, ny, pw, ph, 4);
    ctx.fill();

    ctx.font         = `bold ${fSize}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    if (shadowColor) { ctx.shadowColor = shadowColor; ctx.shadowBlur = shadowBlur; }

    if (charOffsets && charOffsets.length > 0) {
      // Per-character wave rendering
      const charW = ctx.measureText('W').width;
      const startX = W / 2 - (name.length * charW) / 2 + charW / 2;
      ctx.fillStyle = isRainbow ? rainbowGrad(nx, nx + pw) : color;
      ctx.textAlign = 'left';
      for (let i = 0; i < name.length; i++) {
        ctx.fillText(name[i], startX + i * charW - charW / 2, ny + ph / 2 + 0.5 + (charOffsets[i] ?? 0));
      }
    } else {
      ctx.fillStyle = isRainbow ? rainbowGrad(nx, nx + pw) : color;
      ctx.fillText(name, W / 2, ny + ph / 2 + 0.5, pw - pad);
    }

    ctx.restore();

    return c;
  }

  /** Builds a 111×168 canvas: avatar upscaled 3× + chat bubble drawn at native res */
  private static _makeChatCanvas(avatar: AvatarConfig, color: string): HTMLCanvasElement {
    const src = renderHubSprite(avatar);
    const S   = 3;
    const W   = src.width  * S;
    const H   = src.height * S;

    const c   = document.createElement('canvas');
    c.width   = W;
    c.height  = H;
    const ctx = c.getContext('2d')!;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, W, H);

    const isRainbow = color === 'rainbow';
    const msg   = 'Hello!';
    const fSize = 12;

    ctx.font  = `${fSize}px monospace`;
    const tw  = ctx.measureText(msg).width;
    const ph  = fSize + 7;
    const pad = 6;
    const pw  = tw + pad * 2;
    const bx  = Math.round((W - pw) / 2);
    const by  = 6;

    const rainbowGrad = (x0: number, x1: number) => {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0,    'hsl(0,90%,68%)');
      g.addColorStop(0.17, 'hsl(60,90%,68%)');
      g.addColorStop(0.33, 'hsl(120,90%,68%)');
      g.addColorStop(0.50, 'hsl(180,90%,68%)');
      g.addColorStop(0.67, 'hsl(240,90%,68%)');
      g.addColorStop(0.83, 'hsl(300,90%,68%)');
      g.addColorStop(1,    'hsl(360,90%,68%)');
      return g;
    };

    ctx.fillStyle = '#0a0014ee';
    ctx.beginPath();
    ctx.roundRect(bx, by, pw, ph, 4);
    ctx.fill();

    ctx.fillStyle    = isRainbow ? rainbowGrad(bx, bx + pw) : color;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, W / 2, by + ph / 2 + 0.5);

    // Bubble tail
    const mid = W / 2;
    ctx.fillStyle = isRainbow ? rainbowGrad(mid - 4, mid + 4) : color + 'cc';
    ctx.beginPath();
    ctx.moveTo(mid - 4, by + ph);
    ctx.lineTo(mid + 4, by + ph);
    ctx.lineTo(mid, by + ph + 7);
    ctx.closePath();
    ctx.fill();

    return c;
  }

  /** Builds a 111×168 canvas: dark bg + rod illustration at full size */
  private static _makeRodCanvas(rodSkin: string): HTMLCanvasElement {
    const c   = document.createElement('canvas');
    c.width   = 111;
    c.height  = 168;
    const ctx = c.getContext('2d')!;

    ctx.fillStyle = '#0d0820';
    ctx.fillRect(0, 0, c.width, c.height);

    const skin        = ROD_SKINS[rodSkin] ?? ROD_SKINS[''];
    const isLegendary = rodSkin === 'legendary';
    const hue         = (Date.now() / 20) % 360;
    const col = (offset: number, hex: number) =>
      isLegendary ? `hsl(${(hue + offset) % 360},80%,62%)` : '#' + hex.toString(16).padStart(6, '0');

    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';

    // Scale up rod to fill the 111×168 canvas (original was 37×56, so 3×)
    const S = 3;

    // Rod grip — bottom-right to mid
    ctx.strokeStyle = col(0,   skin.grip);
    ctx.lineWidth   = 6;
    ctx.beginPath(); ctx.moveTo(34*S, 52*S); ctx.lineTo(24*S, 32*S); ctx.stroke();

    // Rod tip
    ctx.strokeStyle = col(40,  skin.tip);
    ctx.lineWidth   = 3;
    ctx.beginPath(); ctx.moveTo(24*S, 32*S); ctx.lineTo(12*S, 8*S); ctx.stroke();

    // Fishing line
    ctx.strokeStyle = col(80,  skin.line);
    ctx.lineWidth   = 2;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(12*S, 8*S); ctx.lineTo(3*S, 46*S); ctx.stroke();
    ctx.globalAlpha = 1;

    // Bobber top half
    ctx.fillStyle = col(120, skin.bobber);
    ctx.fillRect(2*S, 43*S, 4*S, 4*S);
    // Bobber bottom white half
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(2*S, 47*S, 4*S, 4*S);

    // Water ring
    ctx.strokeStyle = '#5dcaa550';
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(4*S, 51*S, 15, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Skin label
    const label = rodSkin === '' ? 'Classic' : rodSkin.charAt(0).toUpperCase() + rodSkin.slice(1);
    ctx.font      = 'bold 11px monospace';
    ctx.fillStyle = '#ffffff55';
    ctx.textAlign = 'center';
    ctx.fillText(label, c.width / 2, 14);

    return c;
  }

  // ─── TABS — group + sub-category navigation ─────────────────
  private static _renderTabs(): void {
    const container = MarketPanel.el?.querySelector('#mp-tabs');
    if (!container) return;

    const canBuy = !!authStore.getState().pubkey && !authStore.getState().isGuest;

    const primaryStyle = (active: boolean, disabled = false) => `
      padding:5px 14px;border-radius:5px;cursor:${disabled ? 'default' : 'pointer'};
      font-family:'Courier New',monospace;font-size:10px;font-weight:bold;letter-spacing:0.07em;
      border:1px solid ${active
        ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 60%,transparent)'
        : 'color-mix(in srgb,var(--nd-dpurp) 30%,transparent)'};
      background:${active
        ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 15%,transparent)'
        : 'transparent'};
      color:${active ? 'var(--nd-amber,#f0b040)' : disabled ? 'color-mix(in srgb,var(--nd-subtext) 35%,transparent)' : 'var(--nd-subtext)'};
      opacity:${disabled ? '0.5' : '1'};
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
        <button class="mp-group" data-group="all" style="${primaryStyle(MarketPanel._group === 'all')}">ALL</button>
        <button class="mp-group" data-group="clothes" style="${primaryStyle(MarketPanel._group === 'clothes')}">CLOTHES</button>
        <button class="mp-group" data-group="cosmetics" style="${primaryStyle(MarketPanel._group === 'cosmetics')}">COSMETICS</button>
        <button style="${primaryStyle(false, true)}" disabled>ROOM</button>
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
        MarketPanel._updatePreview(null);
      });
    });
    container.querySelectorAll('.mp-sub').forEach(btn => {
      btn.addEventListener('click', () => {
        const clicked = (btn as HTMLElement).dataset.sub as Category;
        MarketPanel._category = MarketPanel._category === clicked ? 'all' : clicked;
        MarketPanel._page     = 0;
        MarketPanel._renderTabs();
        MarketPanel._renderItems(canBuy);
        MarketPanel._updatePreview(null);
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

    const allItems = (() => {
      const visible = CATALOG.filter(i => !i.hidden);
      const grouped = MarketPanel._group === 'all' ? visible
        : MarketPanel._category === 'all' ? visible.filter(i => (GROUP_SLOTS[MarketPanel._group] ?? []).includes(i.slot))
        : visible.filter(i => i.slot === MarketPanel._category);
      const filtered = MarketPanel._hideOwned
        ? grouped.filter(i => !isOwned(i.slot, i.value))
        : grouped;
      // Group by slot (clothes first, then cosmetics — auras last); within each slot, cheapest → most expensive
      const SLOT_ORDER = ['hair','top','bottom','hat','accessory','eyes','nameColor','chatColor','rodSkin','nameAnim','aura'];
      const slotIdx = (s: string) => { const i = SLOT_ORDER.indexOf(s); return i === -1 ? 999 : i; };
      return [...filtered].sort((a, b) => {
        const so = slotIdx(a.slot) - slotIdx(b.slot);
        if (so !== 0) return so;
        return a.price - b.price;
      });
    })();

    const PER_PAGE   = MarketPanel.ITEMS_PER_PAGE;
    const totalPages = Math.max(1, Math.ceil(allItems.length / PER_PAGE));
    MarketPanel._page = Math.min(MarketPanel._page, totalPages - 1);
    const items = allItems.slice(MarketPanel._page * PER_PAGE, (MarketPanel._page + 1) * PER_PAGE);

    // Pagination controls
    if (pagination) {
      if (totalPages <= 1) {
        pagination.innerHTML = '';
      } else {
        const btnStyle = (disabled: boolean) => `
          padding:6px 14px;border-radius:4px;cursor:${disabled ? 'default' : 'pointer'};
          font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
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
          MarketPanel._updatePreview(null);
        });
        pagination.querySelector('#mp-next')?.addEventListener('click', () => {
          MarketPanel._page++;
          MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
          MarketPanel._updatePreview(null);
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

    const rowPad = mobile ? '8px 10px' : '6px 8px';
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
        if (MarketPanel._isMobile()) return;
        const it = CATALOG.find(i => i.id === row.dataset.id);
        if (it && it.slot !== 'aura') MarketPanel._updatePreview(it);
      });
      row.addEventListener('mouseleave', () => {
        if (MarketPanel._isMobile()) return;
        MarketPanel._updatePreview(null);
      });
      row.addEventListener('touchstart', () => {
        const it = CATALOG.find(i => i.id === row.dataset.id);
        if (!it || it.slot === 'aura') return;
        if (MarketPanel._previewedId === it.id) {
          MarketPanel._previewedId = null;
          MarketPanel._updatePreview(null);
        } else {
          MarketPanel._previewedId = it.id;
          MarketPanel._updatePreview(it);
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
        const avatar  = getAvatar();
        const newVal  = (avatar as any)[item.slot] === item.value ? '' : item.value;
        const patch: Partial<AvatarConfig> = { [item.slot]: newVal } as any;
        if (item.slot === 'nameColor') patch.chatColor = newVal;
        const updated = setAvatar(patch);
        publishAvatar(updated);
        sendAvatarUpdate();
        MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
        MarketPanel._updatePreview(null);
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

    const result = await payLightningAddress(STORE_LUD16, sats, setStatus);

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
      MarketPanel._showInvoiceModal(result.invoice!, item.name, sats, result.verifyUrl, result.nostrPubkey, result.zapEventId, item);
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

  private static _showInvoiceModal(
    invoice: string,
    itemName: string,
    sats: number,
    verifyUrl: string | undefined,
    nostrPubkey: string | undefined,
    zapEventId: string | undefined,
    item: MarketItem,
  ): void {
    document.getElementById('mp-invoice-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mp-invoice-modal';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:5000;
      background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 33%,transparent);
      border-radius:12px;padding:20px;
      font-family:'Courier New',monospace;
      box-shadow:0 8px 40px rgba(0,0,0,0.9);
      width:min(340px,92vw);display:flex;flex-direction:column;align-items:center;gap:14px;
    `;

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
        <div style="color:var(--nd-text);font-size:13px;font-weight:bold;letter-spacing:0.06em;">PAY INVOICE</div>
        <button id="mp-inv-close" style="background:none;border:none;color:var(--nd-subtext);cursor:pointer;font-size:20px;line-height:1;padding:0;opacity:0.6;">×</button>
      </div>
      <div style="color:var(--nd-subtext);font-size:10px;text-align:center;line-height:1.5;">
        ${esc(itemName)} &mdash; ${sats.toLocaleString()} sats
      </div>
      <div id="mp-inv-qr" style="
        background:#fff;border-radius:10px;padding:10px;
        display:flex;align-items:center;justify-content:center;
        min-width:200px;min-height:200px;
      ">
        <span style="color:#888;font-size:12px;">Generating…</span>
      </div>
      <div style="display:flex;gap:8px;width:100%;">
        <button id="mp-inv-copy" style="
          flex:1;padding:8px;border-radius:6px;cursor:pointer;
          font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
          background:color-mix(in srgb,var(--nd-amber,#f0b040) 15%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 40%,transparent);
          color:var(--nd-amber,#f0b040);
        ">Copy Invoice</button>
        <button id="mp-inv-open" style="
          flex:1;padding:8px;border-radius:6px;cursor:pointer;
          font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
          background:color-mix(in srgb,var(--nd-dpurp) 18%,transparent);
          border:1px solid color-mix(in srgb,var(--nd-dpurp) 35%,transparent);
          color:var(--nd-subtext);
        ">Open Wallet</button>
      </div>
      <div id="mp-inv-status" style="font-size:9px;color:var(--nd-subtext);opacity:0.5;text-align:center;min-height:14px;">
        ${(verifyUrl || zapEventId) ? 'Waiting for payment confirmation…' : 'Scan QR or copy invoice to pay'}
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Generate QR
    const qrWrap    = modal.querySelector('#mp-inv-qr')     as HTMLElement;
    const statusDiv = modal.querySelector('#mp-inv-status') as HTMLElement;

    try {
      renderQR(qrWrap, invoice, { size: 220 });
    } catch {
      qrWrap.innerHTML = `<span style="color:#888;font-size:11px;word-break:break-all;padding:8px;">${invoice.slice(0, 40)}…</span>`;
    }

    modal.querySelector('#mp-inv-copy')!.addEventListener('click', () => {
      navigator.clipboard.writeText(invoice).catch(() => {});
      const btn = modal.querySelector('#mp-inv-copy') as HTMLButtonElement;
      btn.textContent = 'Copied!'; btn.disabled = true;
    });

    modal.querySelector('#mp-inv-open')!.addEventListener('click', () => {
      window.open(`lightning:${invoice}`, '_blank');
    });

    // Cancel any prior pending watchers before starting new ones
    clearInterval(MarketPanel._pendingPollTimer);
    MarketPanel._pendingCleanupReceipt?.();
    MarketPanel._pendingPollTimer      = 0;
    MarketPanel._pendingCleanupReceipt = null;

    const grantItem = () => {
      clearInterval(MarketPanel._pendingPollTimer);
      MarketPanel._pendingCleanupReceipt?.();
      MarketPanel._pendingPollTimer      = 0;
      MarketPanel._pendingCleanupReceipt = null;
      addToInventory(item.slot, item.value);
      publishInventory(getInventory());
      autoEquip(item.slot, item.value);
      overlay.remove();
      MarketPanel._renderSaleBanner(true);
      MarketPanel._renderItems(true);
      const statusEl = MarketPanel.el?.querySelector('#mp-status');
      if (statusEl) {
        statusEl.textContent = `✓ ${item.name} unlocked!`;
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
      }
    };

    const invoiceEscHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
    };
    window.addEventListener('keydown', invoiceEscHandler, true);

    // Closing the modal only dismisses the UI — watchers keep running in the background
    // so payment can still settle after the modal is gone.
    const close = () => {
      window.removeEventListener('keydown', invoiceEscHandler, true);
      overlay.remove();
    };

    modal.querySelector('#mp-inv-close')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Method 1: LNURL verify URL polling
    if (verifyUrl) {
      const poll = async () => {
        try {
          const r    = await fetch(verifyUrl);
          const data = await r.json() as { settled: boolean };
          if (data.settled) grantItem();
        } catch { /* keep polling */ }
      };
      poll();
      MarketPanel._pendingPollTimer = window.setInterval(poll, 3000);
    }

    // Method 2: Nostr zap receipt watcher (works with WoS + any NIP-57 wallet)
    if (nostrPubkey && zapEventId) {
      MarketPanel._pendingCleanupReceipt = watchForPurchaseReceipt(nostrPubkey, zapEventId, () => grantItem());
    }
  }
}
