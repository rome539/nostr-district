/**
 * MarketPanel.ts — In-game item shop
 *
 * Opens when the player presses [E] in the market room.
 * Paid items are unlocked by paying sats to roomyflag04@walletofsatoshi.com.
 * Purchases are persisted to Nostr kind:30078.
 */

import { authStore } from '../stores/authStore';
import { CATALOG, MarketItem, TIER_LABEL, TIER_COLOR, isOwned, addToInventory, getInventory } from '../stores/marketStore';
import { payLightningAddress } from '../nostr/zapService';
import { publishInventory, publishAvatar } from '../nostr/nostrService';
import { getAvatar, setAvatar } from '../stores/avatarStore';

const PANEL_ID   = 'market-panel';
const STORE_LUD16 = 'roomyflag04@walletofsatoshi.com';

type Category = 'all' | 'hair' | 'top' | 'bottom' | 'hat' | 'accessory' | 'nameColor' | 'chatColor' | 'rodSkin';

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all',       label: 'ALL'      },
  { key: 'hair',      label: 'HAIR'     },
  { key: 'top',       label: 'TOPS'     },
  { key: 'bottom',    label: 'BOTS'     },
  { key: 'hat',       label: 'HATS'     },
  { key: 'accessory', label: 'ACC'      },
  { key: 'nameColor', label: 'NAME TAG' },
  { key: 'chatColor', label: 'CHAT'     },
  { key: 'rodSkin',   label: 'ROD'      },
];

const COSMETIC_SLOTS = new Set<string>(['nameColor', 'chatColor', 'rodSkin']);

function esc(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

export class MarketPanel {
  private static el:         HTMLElement | null = null;
  private static escHandler: ((e: KeyboardEvent) => void) | null = null;
  private static category:   Category = 'all';
  private static buying:     string | null = null; // item id being purchased

  static isOpen(): boolean { return !!document.getElementById(PANEL_ID); }

  static open(): void {
    MarketPanel.destroy();
    MarketPanel.category = 'all';
    MarketPanel.buying = null;
    MarketPanel._render();

    MarketPanel.escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') MarketPanel.destroy(); };
    window.addEventListener('keydown', MarketPanel.escHandler);
  }

  static destroy(): void {
    document.getElementById(PANEL_ID)?.remove();
    MarketPanel.el = null;
    if (MarketPanel.escHandler) {
      window.removeEventListener('keydown', MarketPanel.escHandler);
      MarketPanel.escHandler = null;
    }
  }

  private static _render(): void {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:4000;
      background:linear-gradient(180deg,var(--nd-bg) 0%,var(--nd-navy) 100%);
      border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 33%,transparent);
      border-radius:10px;padding:20px 22px 18px;
      font-family:'Courier New',monospace;
      box-shadow:0 8px 32px rgba(0,0,0,0.8);
      width:min(440px,96vw);max-height:90dvh;overflow-y:auto;
    `;

    const auth = authStore.getState();
    const canBuy = !!auth.pubkey && !auth.isGuest;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
        <span style="font-size:18px;">⚡</span>
        <div style="flex:1;color:var(--nd-text);font-size:15px;font-weight:bold;letter-spacing:0.06em;">MARKET</div>
        <button id="mp-close" style="background:none;border:none;color:var(--nd-subtext);cursor:pointer;font-size:20px;line-height:1;padding:0;opacity:0.6;">×</button>
      </div>

      <div id="mp-tabs" style="display:flex;gap:4px;margin-bottom:14px;flex-wrap:wrap;"></div>
      <div id="mp-items" style="display:flex;flex-direction:column;gap:8px;"></div>
      <div id="mp-status" style="margin-top:10px;font-size:11px;text-align:center;min-height:16px;color:var(--nd-subtext);"></div>
      ${!canBuy ? `<div style="margin-top:10px;font-size:10px;text-align:center;color:var(--nd-subtext);opacity:0.6;">Log in with a key to purchase items</div>` : ''}
    `;

    document.body.appendChild(panel);
    MarketPanel.el = panel;

    panel.querySelector('#mp-close')!.addEventListener('click', () => MarketPanel.destroy());

    MarketPanel._renderTabs();
    MarketPanel._renderItems(canBuy);
  }

  private static _renderTabs(): void {
    const container = MarketPanel.el?.querySelector('#mp-tabs');
    if (!container) return;
    container.innerHTML = CATEGORIES.map(c => `
      <button class="mp-tab" data-cat="${c.key}" style="
        padding:5px 10px;border-radius:4px;cursor:pointer;
        font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.06em;
        border:1px solid ${MarketPanel.category === c.key
          ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 60%,transparent)'
          : 'color-mix(in srgb,var(--nd-dpurp) 30%,transparent)'};
        background:${MarketPanel.category === c.key
          ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 15%,transparent)'
          : 'transparent'};
        color:${MarketPanel.category === c.key ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)'};
      ">${c.label}</button>
    `).join('');
    container.querySelectorAll('.mp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        MarketPanel.category = (btn as HTMLElement).dataset.cat as Category;
        MarketPanel._renderTabs();
        MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
      });
    });
  }

  private static _renderItems(canBuy: boolean): void {
    const container = MarketPanel.el?.querySelector('#mp-items');
    if (!container) return;

    const items = MarketPanel.category === 'all'
      ? CATALOG
      : CATALOG.filter(i => i.slot === MarketPanel.category);

    container.innerHTML = '';
    items.forEach(item => {
      const owned = isOwned(item.slot, item.value);
      const isCosmetic = COSMETIC_SLOTS.has(item.slot);
      const avatar = getAvatar();
      const isEquipped = isCosmetic && (avatar as any)[item.slot] === item.value;
      const colorSwatch = item.value.startsWith('#')
        ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${item.value};margin-right:4px;vertical-align:middle;border:1px solid rgba(255,255,255,0.2);"></span>`
        : item.value === 'rainbow' ? '<span style="margin-right:4px;">🌈</span>' : '';

      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;gap:10px;padding:10px 12px;
        border-radius:6px;
        background:${isEquipped ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 8%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 8%,transparent)'};
        border:1px solid ${isEquipped ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 30%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 18%,transparent)'};
      `;
      row.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div style="color:var(--nd-text);font-size:12px;font-weight:bold;">${colorSwatch}${esc(item.name)}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
            <span style="
              font-size:9px;padding:1px 5px;border-radius:3px;letter-spacing:0.06em;
              background:color-mix(in srgb,${TIER_COLOR[item.tier]} 18%,transparent);
              border:1px solid color-mix(in srgb,${TIER_COLOR[item.tier]} 40%,transparent);
              color:${TIER_COLOR[item.tier]};
            ">${TIER_LABEL[item.tier]}</span>
            <span style="color:var(--nd-subtext);font-size:10px;opacity:0.7;">${item.slot}</span>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          ${owned
            ? isCosmetic
              ? `<button class="mp-equip" data-id="${esc(item.id)}" style="
                   padding:5px 12px;border-radius:4px;cursor:pointer;
                   font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
                   background:${isEquipped ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 25%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 18%,transparent)'};
                   border:1px solid ${isEquipped ? 'color-mix(in srgb,var(--nd-amber,#f0b040) 50%,transparent)' : 'color-mix(in srgb,var(--nd-dpurp) 35%,transparent)'};
                   color:${isEquipped ? 'var(--nd-amber,#f0b040)' : 'var(--nd-subtext)'};
                 ">${isEquipped ? '✓ ON' : 'EQUIP'}</button>`
              : `<span style="color:#5dcaa5;font-size:11px;font-weight:bold;">✓ OWNED</span>`
            : `<div style="color:var(--nd-amber,#f0b040);font-size:11px;margin-bottom:5px;">⚡ ${item.price.toLocaleString()} sats</div>
               <button class="mp-buy" data-id="${esc(item.id)}" style="
                 padding:5px 12px;border-radius:4px;cursor:${canBuy ? 'pointer' : 'not-allowed'};
                 font-family:'Courier New',monospace;font-size:11px;font-weight:bold;
                 background:color-mix(in srgb,var(--nd-amber,#f0b040) 20%,transparent);
                 border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 50%,transparent);
                 color:var(--nd-amber,#f0b040);opacity:${canBuy ? '1' : '0.5'};
               " ${canBuy ? '' : 'disabled'}>BUY</button>`
          }
        </div>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('.mp-buy').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        const item = CATALOG.find(i => i.id === id);
        if (item) MarketPanel._purchase(item);
      });
    });

    container.querySelectorAll('.mp-equip').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        const item = CATALOG.find(i => i.id === id);
        if (!item) return;
        const avatar = getAvatar();
        const currentVal = (avatar as any)[item.slot];
        const newVal = currentVal === item.value ? '' : item.value; // toggle off if already equipped
        const updated = setAvatar({ [item.slot]: newVal });
        publishAvatar(updated);
        MarketPanel._renderItems(!!authStore.getState().pubkey && !authStore.getState().isGuest);
      });
    });
  }

  private static async _purchase(item: MarketItem): Promise<void> {
    if (MarketPanel.buying) return;
    MarketPanel.buying = item.id;

    const setStatus = (msg: string) => {
      const el = MarketPanel.el?.querySelector('#mp-status');
      if (el) el.textContent = msg;
    };

    // Disable all buy buttons while purchasing
    MarketPanel.el?.querySelectorAll('.mp-buy').forEach(b => ((b as HTMLButtonElement).disabled = true));

    setStatus(`Buying ${item.name}…`);

    const result = await payLightningAddress(STORE_LUD16, item.price, setStatus);

    if (result.status === 'paid') {
      addToInventory(item.slot, item.value);
      publishInventory(getInventory());
      setStatus(`✓ ${item.name} unlocked!`);
      // Re-render items to show OWNED state
      setTimeout(() => {
        MarketPanel._renderItems(true);
        const el = MarketPanel.el?.querySelector('#mp-status');
        if (el) el.textContent = '';
      }, 1200);
    } else if (result.status === 'invoice') {
      // QR fallback — show copy invoice button
      setStatus('');
      const statusEl = MarketPanel.el?.querySelector('#mp-status');
      if (statusEl) {
        statusEl.innerHTML = `
          <div style="font-size:10px;color:var(--nd-subtext);margin-bottom:6px;">No wallet detected — pay manually:</div>
          <button id="mp-copy-inv" style="
            padding:5px 14px;border-radius:4px;cursor:pointer;
            font-family:'Courier New',monospace;font-size:11px;
            background:color-mix(in srgb,var(--nd-amber,#f0b040) 15%,transparent);
            border:1px solid color-mix(in srgb,var(--nd-amber,#f0b040) 40%,transparent);
            color:var(--nd-amber,#f0b040);
          ">Copy Invoice</button>
          <div style="margin-top:6px;font-size:9px;color:var(--nd-subtext);opacity:0.6;">
            After paying, reopen the market to verify.
          </div>
        `;
        statusEl.querySelector('#mp-copy-inv')?.addEventListener('click', () => {
          navigator.clipboard.writeText(result.invoice!).catch(() => {});
          const btn = statusEl.querySelector('#mp-copy-inv') as HTMLButtonElement;
          if (btn) { btn.textContent = 'Copied!'; btn.disabled = true; }
        });
      }
    } else {
      setStatus(`✗ ${result.error || 'Payment failed'}`);
      setTimeout(() => {
        const el = MarketPanel.el?.querySelector('#mp-status');
        if (el) el.textContent = '';
      }, 3000);
    }

    MarketPanel.buying = null;
    MarketPanel.el?.querySelectorAll('.mp-buy').forEach(b => {
      const id = (b as HTMLElement).dataset.id!;
      const i = CATALOG.find(c => c.id === id);
      if (i && !isOwned(i.slot, i.value)) (b as HTMLButtonElement).disabled = false;
    });
  }
}
