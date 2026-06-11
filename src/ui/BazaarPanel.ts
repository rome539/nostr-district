/**
 * BazaarPanel.ts — Open market + inventory for all tradeable items.
 * Open with /bazaar command. Tabs: Market (public listings) | Inventory (your items) | Sets.
 */
import {
  ITEM_CATALOG, ITEM_SETS, ItemDef, OwnedItem,
  getInventoryWithDefs, getCompletedSets, getSetProgress, isNewItem, clearNewItem, isListingInFlight,
  getLocalListings, listItem, delistItem, sendItemDirect,
  fetchMarketListings, getCachedRemoteListings, RemoteListing,
  MarketListing, purchaseListing, restoreLocalListing, discardItem, fetchInventoryFromRelays, subscribeMarket, fetchMyListings,
  TradeOffer, getPendingOffers, sendTradeOffer, acceptTradeOffer, rejectTradeOffer, cancelTradeOffer,
  getPendingOutgoingInstanceIds, streamOwnedItemsOf, normalizePubkey, reclaimOrphanedEscrows,
} from '../stores/tradeItemStore';
import { authStore } from '../stores/authStore';
import { t as ti18n } from '../i18n/i18n';
import { ToastManager } from './ToastManager';
import { boltIcon } from './icons';
import { getCachedName, resolveNames } from '../nostr/crewService';
import { getOnlinePlayers, requestOnlinePlayers, acceptBidRequest, declineWinRequest } from '../nostr/presenceService';
import {
  placeBid, withdrawBid, declineBid, fetchBidsForListings, subscribeBids, fetchMyWins, subscribeWins, payWonItem,
  fetchMyBids, fetchListedInstanceIdsOf, isItemSold, isItemReserved, type MarketBid, type WinNotice, type MyBid,
} from '../stores/tradeItemStore';

const PANEL_ID = 'bazaar-panel';
const RARITY_COLOR: Record<string, string> = {
  common:    '#a0c8a0',
  rare:      '#70b0ff',
  legendary: '#ffd700',
  junk:      '#888888',
};
const CATEGORY_LABEL: Record<string, string> = {
  fish: 'Fish', hardware: 'Hardware', street: 'Street', lore: 'Lore', occult: 'Occult', critters: 'Critters', holiday: 'Holiday',
};

export class BazaarPanel {
  private el: HTMLElement | null = null;
  private tab: 'market' | 'inventory' | 'sets' | 'offers' = 'inventory';
  private pendingTradePubkey: string | null = null;
  private pendingTradeName: string | null = null;
  private inventoryPage = 0;
  private readonly PAGE_SIZE = 9;
  private invSearch = '';
  private invCategory: 'all' | ItemDef['category'] = 'all';
  private unsub: (() => void) | null = null;
  private loadingInventory = false;
  private marketCategory: 'all' | ItemDef['category'] = 'all';
  private marketSearch = '';
  private marketView: 'browse' | 'mine' = 'browse';
  private lastRenderedTab: string | null = null; // for preserving scroll on same-tab re-renders
  private expandedSets = new Set<string>();      // which set cards are expanded in the SETS tab
  private bidsByInstance: Record<string, MarketBid[]> = {};
  private myWins: WinNotice[] = [];
  private resolvedWins = new Set<string>(); // wins paid/declined this session — hide immediately
  private myBidsOut: MyBid[] = [];

  // ── Overlay stack ──────────────────────────────────────────────────────────
  // Modals layered over the bazaar (trade partner picker, offer picker) register a
  // closer here so ESC (BaseScene.handleCommonEsc) closes the TOP overlay first
  // instead of tearing down the whole panel underneath it.
  private static _overlayClosers: (() => void)[] = [];
  static registerOverlay(close: () => void): () => void {
    BazaarPanel._overlayClosers.push(close);
    return () => { BazaarPanel._overlayClosers = BazaarPanel._overlayClosers.filter(f => f !== close); };
  }
  /** Close the topmost overlay if one is open. Returns true if it consumed the ESC. */
  static closeTopOverlay(): boolean {
    const f = BazaarPanel._overlayClosers.pop();
    if (f) { try { f(); } catch { /* already gone */ } return true; }
    return false;
  }
  private acceptedBid: Record<string, { name: string; amount: number }> = {};
  private acceptInFlight = new Set<string>();

  static isOpen(): boolean { return !!document.getElementById(PANEL_ID); }

  private subscribe(): void {
    const update = () => this.render();
    const { pubkey } = authStore.getState();
    window.addEventListener('nd-inventory-update', update);
    window.addEventListener('nd-market-update', update);
    window.addEventListener('nd-offers-update', update);
    // Live market feed — new listings/delists from other players appear instantly
    const unsubMarket = subscribeMarket(() => {
      if (this.tab === 'market' && BazaarPanel.isOpen()) this.render();
    });
    // Live bids on my listings + live "you won" markers for me
    const unsubBids = pubkey ? subscribeBids(pubkey, () => this.refreshBids()) : () => {};
    const unsubWins = pubkey ? subscribeWins(pubkey, () => this.refreshWins()) : () => {};
    this.unsub = () => {
      window.removeEventListener('nd-inventory-update', update);
      window.removeEventListener('nd-market-update', update);
      window.removeEventListener('nd-offers-update', update);
      unsubMarket(); unsubBids(); unsubWins();
    };
  }

  // Pull the latest bids for the player's own listings so My Listings can show them.
  private refreshBids(): void {
    const { pubkey } = authStore.getState();
    if (!pubkey) { this.bidsByInstance = {}; return; }
    fetchBidsForListings(pubkey).then((b) => {
      this.bidsByInstance = b;
      // Resolve bidder display names so they show as names, not npubs
      const pks = Object.values(b).flat().map(x => x.buyer).filter(pk => getCachedName(pk).startsWith('npub'));
      if (pks.length) resolveNames([...new Set(pks)]).then(() => { if (BazaarPanel.isOpen()) this.render(); });
      if (BazaarPanel.isOpen()) this.render();
    });
  }

  // Pull "you won — pay now" markers addressed to me.
  private refreshWins(): void {
    const { pubkey } = authStore.getState();
    if (!pubkey) { this.myWins = []; return; }
    fetchMyWins(pubkey).then((w) => {
      this.myWins = w;
      if (BazaarPanel.isOpen()) this.render();
    });
  }

  // Pull the bids I've placed on others' listings (so I can cancel them).
  private refreshMyBids(): void {
    const { pubkey } = authStore.getState();
    if (!pubkey) { this.myBidsOut = []; return; }
    fetchMyBids(pubkey).then((b) => {
      this.myBidsOut = b;
      if (BazaarPanel.isOpen()) this.render();
    });
  }

  open(): void {
    if (BazaarPanel.isOpen()) { this.close(); return; }
    this.subscribe();
    this.refreshInventory();
    this.render();
  }

  /** Open (or refocus) the bazaar on a specific tab — used by clickable toasts. */
  openAt(tab: 'market' | 'inventory' | 'sets' | 'offers'): void {
    this.tab = tab;
    if (BazaarPanel.isOpen()) { this.render(); return; }
    this.subscribe();
    this.refreshInventory();
    this.render();
  }

  // Fetch fresh inventory + your listings from relays each time the bazaar opens
  private refreshInventory(): void {
    const { pubkey, loginMethod } = authStore.getState();
    if (!pubkey || loginMethod === 'guest') return;
    this.loadingInventory = true;
    // Reconcile your listings from relays (cross-browser consistency)
    fetchMyListings().then(() => { this.refreshBids(); if (BazaarPanel.isOpen()) this.render(); });
    this.refreshWins();
    this.refreshMyBids();
    fetchInventoryFromRelays(pubkey)
      .finally(() => { this.loadingInventory = false; if (BazaarPanel.isOpen()) this.render(); });
    // Self-heal: return any items stuck in escrow from an aborted listing (e.g. the
    // signer popup was dismissed) back to inventory.
    reclaimOrphanedEscrows().then(n => {
      if (n > 0) {
        ToastManager.show(ti18n('bz.escrow_recovered', { n: String(n) }), '#7fffa0');
        fetchInventoryFromRelays(pubkey).finally(() => { if (BazaarPanel.isOpen()) this.render(); });
      }
    });
  }

  openTradeWith(toPubkey: string, toName: string): void {
    if (!BazaarPanel.isOpen()) this.subscribe();
    this.tab = 'inventory';
    this.pendingTradePubkey = toPubkey;
    this.pendingTradeName   = toName;
    this.refreshInventory();
    this.render();
    this.showTradeTargetBanner(toPubkey, toName);
  }

  close(): void {
    this.unsub?.(); this.unsub = null;
    document.getElementById(PANEL_ID)?.remove();
    this.el = null;
  }

  private render(): void {
    // Preserve scroll position across same-tab re-renders (e.g. the live market
    // subscription updating) so the user isn't yanked back to the top of a long list.
    const prevBody = document.getElementById('bazaar-body');
    const prevScroll = (prevBody && this.lastRenderedTab === this.tab) ? prevBody.scrollTop : 0;
    document.getElementById(PANEL_ID)?.remove();
    this.ensureScrollStyle(); // themed scrollbar + mobile responsiveness

    // Backdrop captures clicks outside the panel (click-off to close)
    const backdrop = document.createElement('div');
    backdrop.id = PANEL_ID;
    backdrop.style.cssText = `
      position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,0.45);
      display:flex;align-items:center;justify-content:center;
    `;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.close(); });

    const panel = document.createElement('div');
    panel.style.cssText = `
      width:min(680px,96vw);max-height:80vh;
      background:#0a0a18;border:1px solid #2a2a4a;border-radius:12px;
      display:flex;flex-direction:column;
      font-family:'Courier New',monospace;box-shadow:0 0 40px rgba(80,60,180,0.3);
      overflow:hidden;
    `;
    backdrop.appendChild(panel);

    // ── Header ───────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:14px 18px 0;flex-shrink:0;`;
    header.innerHTML = `
      <span style="color:#c0a8ff;font-size:16px;font-weight:bold;letter-spacing:2px;">▸ BAZAAR</span>
      <button id="bazaar-close" style="background:none;border:none;color:#666;font-size:18px;cursor:pointer;padding:0 4px;">✕</button>
    `;
    panel.appendChild(header);

    // ── Tabs ─────────────────────────────────────────────────────────────────
    const tabs = document.createElement('div');
    tabs.style.cssText = `display:flex;gap:2px;padding:10px 18px 0;flex-shrink:0;`;
    const incomingOffers = getPendingOffers().filter(o => o.direction === 'incoming').length;
    // Listings of mine that have un-accepted bids also count as things needing action
    const bidsNeedingAction = getLocalListings().filter(l =>
      (this.bidsByInstance[l.item.instanceId]?.length ?? 0) > 0 && !this.acceptedBid[l.item.instanceId]).length;
    const pendingOffers = incomingOffers + bidsNeedingAction;
    (['inventory','market','offers','sets'] as const).forEach(t => {
      const btn = document.createElement('button');
      const label = t === 'inventory' ? ti18n('bz.tab.items') : t === 'market' ? ti18n('bz.tab.market') : t === 'offers' ? `${ti18n('bz.tab.offers')}${pendingOffers > 0 ? ` (${pendingOffers})` : ''}` : ti18n('bz.tab.sets');
      btn.textContent = label;
      btn.style.cssText = `
        background:${this.tab === t ? '#1e1e38' : 'none'};
        border:1px solid ${this.tab === t ? '#4a4a8a' : '#2a2a4a'};
        color:${this.tab === t ? '#c0a8ff' : '#666'};
        font-family:'Courier New',monospace;font-size:11px;cursor:pointer;
        padding:5px 12px;border-radius:4px 4px 0 0;letter-spacing:1px;
      `;
      btn.addEventListener('click', () => { this.tab = t; this.render(); });
      tabs.appendChild(btn);
    });
    panel.appendChild(tabs);

    // ── "You won" banners — bids of yours the seller accepted; pay to claim. ───
    // Hide a win the moment you actually OWN the item (it arrived) or you've
    // paid/declined it this session — don't wait for the win-marker tombstone to
    // propagate on relays (that lag left the banner lingering after paying).
    const ownedWinIds = new Set(getInventoryWithDefs().map(e => e.owned.instanceId));
    const wins = this.myWins.filter(w => !this.resolvedWins.has(w.instanceId) && !ownedWinIds.has(w.instanceId));
    // Wrapped in a bounded scroll area so multiple wins stay compact.
    const winsWrap = wins.length ? document.createElement('div') : null;
    if (winsWrap) {
      winsWrap.className = 'nd-want-list';
      winsWrap.style.cssText = `margin:8px 18px 0;display:flex;flex-direction:column;gap:6px;max-height:138px;overflow-y:auto;flex-shrink:0;scrollbar-width:thin;scrollbar-color:#6a3aaa55 transparent;`;
    }
    for (const win of wins) {
      const def = ITEM_CATALOG.find(d => d.id === win.itemId);
      const banner = document.createElement('div');
      banner.style.cssText = `background:#160e2a;border:1px solid #6a3aaa;border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;`;
      banner.innerHTML = `<span style="color:#d8b8ff;font-size:11px;">${ti18n('bz.win.banner', { item: def ? def.emoji + ' ' + def.name : ti18n('bz.an_item'), price: `<span style="color:#ffd700;">${win.price}</span>` })}</span>`;
      const payBtn = document.createElement('button');
      payBtn.textContent = `${ti18n('bz.pay')} ${win.price}`;
      payBtn.style.cssText = `flex-shrink:0;background:#0a1a0a;border:1px solid #1a6a1a;color:#70ff70;font-family:'Courier New',monospace;font-size:10px;font-weight:bold;cursor:pointer;padding:5px 12px;border-radius:4px;`;
      const declineBtn = document.createElement('button');
      payBtn.addEventListener('click', async () => {
        payBtn.disabled = true; declineBtn.disabled = true; // lock both while paying
        payBtn.textContent = ti18n('bz.paying');
        const r = await payWonItem(win.instanceId, (m) => { payBtn.textContent = m; });
        if (r.status === 'ok') {
          payBtn.textContent = ti18n('bz.paid_check');
          ToastManager.show(ti18n('bz.paid_toast', { item: def?.name ?? ti18n('bz.item') }), '#ffd700');
          this.resolvedWins.add(win.instanceId); // stays hidden even if a stale refresh re-adds it
          this.myWins = this.myWins.filter(w => w.instanceId !== win.instanceId);
          // The bid is fulfilled — clear it from YOUR BIDS and tombstone it.
          const paidBid = this.myBidsOut.find(b => b.instanceId === win.instanceId);
          if (paidBid) withdrawBid(win.instanceId, paidBid.sellerPubkey);
          this.myBidsOut = this.myBidsOut.filter(b => b.instanceId !== win.instanceId);
          setTimeout(() => this.render(), 1200);
        } else if (r.status === 'invoice' && r.invoice) {
          payBtn.disabled = false; declineBtn.disabled = false; payBtn.textContent = `${ti18n('bz.pay')} ${win.price}`;
          const { showInvoiceModal } = await import('./market/MarketInvoice');
          showInvoiceModal(
            r.invoice, def?.name ?? ti18n('bz.item'), win.price, undefined, undefined, undefined, null,
            // Server's item_sold for this win closed the modal — clean up the win UI.
            () => {
              ToastManager.show(ti18n('bz.paid_toast', { item: def?.name ?? ti18n('bz.item') }), '#ffd700');
              this.resolvedWins.add(win.instanceId);
              this.myWins = this.myWins.filter(w => w.instanceId !== win.instanceId);
              this.myBidsOut = this.myBidsOut.filter(b => b.instanceId !== win.instanceId);
              this.render();
            },
            win.instanceId,
          );
        } else if (r.status === 'unavailable') {
          payBtn.textContent = ti18n('bz.no_longer_available');
          this.resolvedWins.add(win.instanceId);
          this.myWins = this.myWins.filter(w => w.instanceId !== win.instanceId);
          setTimeout(() => this.render(), 1200);
        } else {
          payBtn.disabled = false; declineBtn.disabled = false; payBtn.textContent = `${ti18n('bz.pay')} ${win.price}`;
          ToastManager.show(ti18n('bz.payment_failed'), '#ff7070');
        }
      });

      // Decline — winner changed their mind; re-open the item to the market.
      declineBtn.textContent = ti18n('bz.decline');
      declineBtn.style.cssText = `flex-shrink:0;background:#1a0a0a;border:1px solid #5a2a2a;color:#c06060;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:5px 10px;border-radius:4px;`;
      declineBtn.addEventListener('click', async () => {
        const ok = await this.themedConfirm(ti18n('bz.decline_confirm', { item: def?.name ?? ti18n('bz.item') }), ti18n('bz.decline'));
        if (!ok) return;
        declineBtn.disabled = true; payBtn.disabled = true; declineBtn.textContent = '…'; // lock both
        const r = await declineWinRequest(win.instanceId);
        if (r.ok) {
          // Also withdraw our bid so the seller isn't re-offered our flaky bid
          const myBid = this.myBidsOut.find(b => b.instanceId === win.instanceId);
          if (myBid) withdrawBid(win.instanceId, myBid.sellerPubkey);
          this.resolvedWins.add(win.instanceId);
          this.myWins = this.myWins.filter(w => w.instanceId !== win.instanceId);
          this.myBidsOut = this.myBidsOut.filter(b => b.instanceId !== win.instanceId);
          ToastManager.show(ti18n('bz.declined_toast'), '#c06060');
          this.render();
        } else {
          declineBtn.disabled = false; payBtn.disabled = false; declineBtn.textContent = ti18n('bz.decline');
          ToastManager.show(ti18n('bz.decline_failed'), '#ff7070');
        }
      });

      const btnRow = document.createElement('div');
      btnRow.style.cssText = `display:flex;gap:6px;flex-shrink:0;`;
      btnRow.appendChild(declineBtn);
      btnRow.appendChild(payBtn);
      banner.appendChild(btnRow);
      winsWrap!.appendChild(banner);
    }
    if (winsWrap) { this.ensureScrollStyle(); panel.appendChild(winsWrap); }

    // ── Body ─────────────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.id = 'bazaar-body';
    body.style.cssText = `flex:1;overflow-y:auto;padding:14px 18px;scrollbar-width:thin;scrollbar-color:#2a2a4a #0a0a18;`;
    panel.appendChild(body);

    if (this.tab === 'inventory') this.renderInventory(body);
    else if (this.tab === 'market') this.renderMarket(body);
    else if (this.tab === 'offers') this.renderOffers(body);
    else this.renderSets(body);

    document.body.appendChild(backdrop);
    this.el = backdrop;
    body.scrollTop = prevScroll;       // restore scroll (0 when the tab changed)
    this.lastRenderedTab = this.tab;

    panel.querySelector('#bazaar-close')!.addEventListener('click', () => this.close());
  }

  // ── Inventory tab ─────────────────────────────────────────────────────────

  private renderInventory(body: HTMLElement): void {
    // Items currently listed on the market — or committed to a pending trade offer —
    // are held out of inventory so they can't be double-listed/sent. They return on
    // delist/sale, or when the trade offer is cancelled/declined.
    const listed = new Set(getLocalListings().map(l => l.item.instanceId));
    const offered = getPendingOutgoingInstanceIds();
    const allItems = getInventoryWithDefs()
      .filter(e => !listed.has(e.owned.instanceId) && !isListingInFlight(e.owned.instanceId) && !offered.has(e.owned.instanceId));
    if (this.loadingInventory && allItems.length === 0) {
      body.innerHTML = `<div style="color:#666;text-align:center;padding:48px 0;font-size:13px;">⟳ ${ti18n('bz.loading_items')}</div>`;
      return;
    }
    if (allItems.length === 0) {
      body.innerHTML = `<div style="color:#8a8aa8;text-align:center;padding:40px 0;font-size:13px;">${listed.size > 0 ? ti18n('bz.inv_all_listed') : ti18n('bz.inv_empty')}</div>`;
      return;
    }

    // Controls — category filter + name search, mirroring the Market tab
    const controls = document.createElement('div');
    controls.style.cssText = `display:flex;flex-direction:column;gap:8px;margin-bottom:12px;`;
    const cats: ['all' | ItemDef['category'], string][] = [
      ['all', ti18n('bz.cat_all')], ['fish', '🎣'], ['hardware', '💾'], ['street', '🌆'], ['lore', '📜'], ['occult', '🔮'], ['critters', '🐀'], ['eats', '🍜'], ['holiday', '🎉'],
    ];
    const catRow = document.createElement('div');
    catRow.style.cssText = `display:flex;gap:4px;flex-wrap:wrap;`;
    for (const [cat, label] of cats) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `background:${this.invCategory === cat ? '#1e1e38' : 'none'};border:1px solid ${this.invCategory === cat ? '#4a4a8a' : '#2a2a4a'};color:${this.invCategory === cat ? '#c0a8ff' : '#777'};font-family:'Courier New',monospace;font-size:11px;cursor:pointer;padding:4px 10px;border-radius:4px;`;
      b.addEventListener('click', () => { this.invCategory = cat; this.inventoryPage = 0; this.render(); });
      catRow.appendChild(b);
    }
    const search = document.createElement('input');
    search.placeholder = ti18n('bz.search_items');
    search.value = this.invSearch;
    search.style.cssText = `background:#0e0e22;border:1px solid #2a2a4a;color:#c0c0e0;font-family:'Courier New',monospace;font-size:11px;padding:6px 10px;border-radius:4px;outline:none;`;
    search.addEventListener('input', () => {
      this.invSearch = search.value;
      this.inventoryPage = 0;
      this.renderInvList(body.querySelector('#bazaar-inv-list') as HTMLElement); // keep input focused
    });
    controls.appendChild(catRow);
    controls.appendChild(search);
    body.appendChild(controls);

    const listEl = document.createElement('div');
    listEl.id = 'bazaar-inv-list';
    body.appendChild(listEl);
    this.renderInvList(listEl);
  }

  private renderInvList(container: HTMLElement | null): void {
    if (!container) return;
    container.innerHTML = '';
    const { pubkey } = authStore.getState();
    const listed = new Set(getLocalListings().map(l => l.item.instanceId));
    const offered = getPendingOutgoingInstanceIds();
    const filtered = getInventoryWithDefs()
      .filter(e => !listed.has(e.owned.instanceId) && !isListingInFlight(e.owned.instanceId) && !offered.has(e.owned.instanceId))
      .filter(e => (this.invCategory === 'all' || e.def.category === this.invCategory)
        && (!this.invSearch || e.def.name.toLowerCase().includes(this.invSearch.toLowerCase())));
    if (filtered.length === 0) {
      container.innerHTML = `<div style="color:#8a8aa8;text-align:center;padding:30px 0;font-size:12px;">${ti18n('bz.inv_no_match')}</div>`;
      return;
    }

    // STACK duplicates: one card per item id, oldest instance first (trade/list/
    // discard spend the oldest copy, keeping freshly-acquired ones "NEW").
    const groups = new Map<string, { def: ItemDef; instances: OwnedItem[] }>();
    for (const e of [...filtered].sort((a, b) => a.owned.acquiredAt - b.owned.acquiredAt)) {
      const g = groups.get(e.def.id) ?? { def: e.def, instances: [] };
      g.instances.push(e.owned);
      groups.set(e.def.id, g);
    }
    const stacks = [...groups.values()].sort((a, b) =>
      a.def.category.localeCompare(b.def.category) || a.def.name.localeCompare(b.def.name));

    const totalPages = Math.max(1, Math.ceil(stacks.length / this.PAGE_SIZE));
    this.inventoryPage = Math.min(this.inventoryPage, totalPages - 1);
    const pageStacks = stacks.slice(this.inventoryPage * this.PAGE_SIZE, (this.inventoryPage + 1) * this.PAGE_SIZE);

    const grid = document.createElement('div');
    grid.className = 'nd-inv-grid';
    grid.style.cssText = `display:grid;grid-template-columns:repeat(3,1fr);gap:8px;`;
    for (const { def, instances } of pageStacks) grid.appendChild(this.itemCard(def, instances, pubkey ?? ''));
    container.appendChild(grid);

    // Pagination controls
    if (totalPages > 1) {
      const nav = document.createElement('div');
      nav.style.cssText = `display:flex;align-items:center;justify-content:center;gap:12px;margin-top:12px;padding-top:10px;border-top:1px solid #1a1a2e;`;
      nav.innerHTML = `
        <button id="inv-prev" style="background:${this.inventoryPage === 0 ? '#0a0a18' : '#1e1e38'};border:1px solid #2a2a4a;color:${this.inventoryPage === 0 ? '#333' : '#c0a8ff'};font-family:'Courier New',monospace;font-size:11px;cursor:${this.inventoryPage === 0 ? 'default' : 'pointer'};padding:4px 12px;border-radius:4px;">◀</button>
        <span style="color:#666;font-size:11px;">${this.inventoryPage + 1} / ${totalPages}</span>
        <button id="inv-next" style="background:${this.inventoryPage >= totalPages - 1 ? '#0a0a18' : '#1e1e38'};border:1px solid #2a2a4a;color:${this.inventoryPage >= totalPages - 1 ? '#333' : '#c0a8ff'};font-family:'Courier New',monospace;font-size:11px;cursor:${this.inventoryPage >= totalPages - 1 ? 'default' : 'pointer'};padding:4px 12px;border-radius:4px;">▶</button>
      `;
      nav.querySelector('#inv-prev')!.addEventListener('click', () => { if (this.inventoryPage > 0) { this.inventoryPage--; this.renderInvList(container); } });
      nav.querySelector('#inv-next')!.addEventListener('click', () => { if (this.inventoryPage < totalPages - 1) { this.inventoryPage++; this.renderInvList(container); } });
      container.appendChild(nav);
    }
  }

  // One card per item TYPE — duplicates stack (instances[0] is the oldest copy,
  // which is what trade/list/discard spend).
  private itemCard(def: ItemDef, instances: OwnedItem[], pubkey: string): HTMLElement {
    const owned = instances[0];
    const card = document.createElement('div');
    card.style.cssText = `
      position:relative;
      background:#0e0e22;border:1px solid #1e1e3a;border-radius:8px;
      padding:10px 12px;display:flex;flex-direction:column;gap:6px;
      transition:border-color 0.15s;cursor:default;
    `;
    card.onmouseenter = () => card.style.borderColor = '#3a3a7a';
    card.onmouseleave = () => card.style.borderColor = '#1e1e3a';

    // "NEW" for items that arrived this session: a bright inline pill (not a corner
    // badge — the scroll container clips overflow) + a green glow. Fades a few
    // seconds after the player views it, then the flag clears so it won't show again.
    const isNew = instances.some(i => isNewItem(i.instanceId));
    if (isNew) {
      card.style.borderColor = '#2a8a2a';
      card.style.boxShadow = '0 0 14px rgba(40,180,40,0.35)';
    }
    const newPill = isNew
      ? `<span class="nd-new-pill" style="display:inline-block;background:#2a9a2a;color:#06140a;font-size:8px;font-weight:bold;letter-spacing:1px;padding:1px 5px;border-radius:3px;margin-right:6px;vertical-align:middle;transition:opacity 0.5s;">${ti18n('bz.new')}</span>`
      : '';

    const countPill = instances.length > 1
      ? `<span style="display:inline-block;background:#1e1e3a;color:#c0a8ff;font-size:9px;font-weight:bold;padding:1px 6px;border-radius:8px;margin-left:6px;vertical-align:middle;">×${instances.length}</span>`
      : '';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;color:#e6e6f5;">${def.emoji}</span>
        <div style="flex:1;min-width:0;">
          <div style="color:${RARITY_COLOR[def.rarity]};font-size:12px;font-weight:bold;">${newPill}${def.name}${countPill}</div>
          <div style="color:#555;font-size:9px;letter-spacing:1px;">${CATEGORY_LABEL[def.category] ?? def.category} · ${def.rarity.toUpperCase()}${def.kg ? ` · ${def.kg}kg` : ''}</div>
        </div>
        <button class="bazaar-discard-btn" title="${ti18n('bz.discard_item')}" style="background:none;border:1px solid #5a2a2a;color:#c06060;font-family:'Courier New',monospace;font-size:11px;font-weight:bold;cursor:pointer;padding:1px 6px;line-height:1.2;border-radius:3px;">✕</button>
      </div>
      <div style="color:#888;font-size:10px;line-height:1.4;">${def.description}</div>
      <div style="display:flex;gap:4px;margin-top:2px;">
        <button class="bazaar-trade-btn" style="flex:1;background:#1a1a0a;border:1px solid #4a4a1a;color:#d0d060;font-family:'Courier New',monospace;font-size:9px;cursor:pointer;padding:4px 0;border-radius:4px;">${ti18n('bz.trade')}</button>
        <button class="bazaar-list-btn" style="flex:1;background:#1a0a2a;border:1px solid #4a1a6a;color:#c070ff;font-family:'Courier New',monospace;font-size:9px;cursor:pointer;padding:4px 0;border-radius:4px;">${ti18n('bz.list')}</button>
      </div>
    `;

    card.querySelector('.bazaar-trade-btn')!.addEventListener('click', () => this.promptTradeOffer(owned, def));
    card.querySelector('.bazaar-list-btn')!.addEventListener('click', () => this.promptList(owned, def));
    card.querySelector('.bazaar-discard-btn')!.addEventListener('click', async () => {
      const ok = await this.themedConfirm(ti18n('bz.discard_confirm', { item: `${def.emoji} ${def.name}` }), ti18n('bz.discard'));
      if (ok) { await discardItem(owned.instanceId); this.render(); }
    });

    // Fade the NEW pill + glow ~5s after it's been on screen, and clear the flag
    // for every copy in the stack (the pill represents the whole stack).
    if (isNew) {
      const ids = instances.map(i => i.instanceId);
      setTimeout(() => {
        for (const id of ids) clearNewItem(id);
        const pill = card.querySelector('.nd-new-pill') as HTMLElement | null;
        if (pill) { pill.style.opacity = '0'; setTimeout(() => pill.remove(), 500); }
        card.style.boxShadow = 'none';
        card.style.borderColor = '#1e1e3a';
      }, 5000);
    }
    return card;
  }

  // ── Reusable themed modal ──────────────────────────────────────────────────

  private themedModal(opts: {
    title: string;
    fields: { key: string; label: string; placeholder?: string; type?: string }[];
    confirmLabel: string;
    confirmColor?: string;
  }): Promise<Record<string, string> | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace;`;
      const box = document.createElement('div');
      const accent = opts.confirmColor ?? '#c0a8ff';
      box.style.cssText = `background:#0a0a18;border:1px solid #2a2a4a;border-radius:10px;padding:20px;width:min(400px,92vw);display:flex;flex-direction:column;gap:12px;box-shadow:0 0 40px rgba(80,60,180,0.3);`;

      const fieldsHtml = opts.fields.map(f => `
        <div>
          <label style="display:block;color:#888;font-size:10px;letter-spacing:1px;margin-bottom:4px;">${f.label}</label>
          <input data-key="${f.key}" type="${f.type ?? 'text'}" placeholder="${f.placeholder ?? ''}"
            style="width:100%;box-sizing:border-box;background:#0e0e22;border:1px solid #2a2a4a;color:#c0c0e0;font-family:'Courier New',monospace;font-size:12px;padding:7px 10px;border-radius:5px;outline:none;color-scheme:dark;" />
        </div>
      `).join('');

      box.innerHTML = `
        <div style="color:${accent};font-size:14px;font-weight:bold;">${opts.title}</div>
        ${fieldsHtml}
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="tm-cancel" style="flex:1;background:#1a0a0a;border:1px solid #5a2a2a;color:#c06060;font-family:'Courier New',monospace;font-size:12px;cursor:pointer;padding:8px 0;border-radius:5px;">${ti18n('bz.cancel')}</button>
          <button class="tm-ok" style="flex:1;background:#0e0e22;border:1px solid ${accent};color:${accent};font-family:'Courier New',monospace;font-size:12px;font-weight:bold;cursor:pointer;padding:8px 0;border-radius:5px;">${opts.confirmLabel}</button>
        </div>
      `;

      let dereg = () => {};
      const cleanup = () => { dereg(); overlay.remove(); };
      const collect = () => {
        const out: Record<string, string> = {};
        box.querySelectorAll('input[data-key]').forEach(el => {
          out[(el as HTMLInputElement).dataset.key!] = (el as HTMLInputElement).value.trim();
        });
        return out;
      };
      box.querySelector('.tm-cancel')!.addEventListener('click', () => { cleanup(); resolve(null); });
      box.querySelector('.tm-ok')!.addEventListener('click', () => { const v = collect(); cleanup(); resolve(v); });
      overlay.addEventListener('click', e => { if (e.target === overlay) { cleanup(); resolve(null); } });
      box.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') { const v = collect(); cleanup(); resolve(v); } });

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      // ESC closes THIS modal (list/bid/etc.), not the whole bazaar.
      dereg = BazaarPanel.registerOverlay(() => { cleanup(); resolve(null); });
      (box.querySelector('input') as HTMLInputElement)?.focus();
    });
  }

  private themedConfirm(title: string, confirmLabel = ti18n('bz.confirm'), color = '#c06060'): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace;`;
      const box = document.createElement('div');
      box.style.cssText = `background:#0a0a18;border:1px solid #2a2a4a;border-radius:10px;padding:20px;width:min(360px,92vw);display:flex;flex-direction:column;gap:14px;box-shadow:0 0 40px rgba(80,60,180,0.3);`;
      box.innerHTML = `
        <div style="color:#c0c0e0;font-size:13px;line-height:1.5;">${title}</div>
        <div style="display:flex;gap:8px;">
          <button class="tc-cancel" style="flex:1;background:#0e0e22;border:1px solid #2a2a4a;color:#888;font-family:'Courier New',monospace;font-size:12px;cursor:pointer;padding:8px 0;border-radius:5px;">${ti18n('bz.cancel')}</button>
          <button class="tc-ok" style="flex:1;background:#1a0a0a;border:1px solid ${color};color:${color};font-family:'Courier New',monospace;font-size:12px;font-weight:bold;cursor:pointer;padding:8px 0;border-radius:5px;">${confirmLabel}</button>
        </div>
      `;
      let dereg = () => {};
      const close = (v: boolean) => { dereg(); overlay.remove(); resolve(v); };
      box.querySelector('.tc-cancel')!.addEventListener('click', () => close(false));
      box.querySelector('.tc-ok')!.addEventListener('click', () => close(true));
      overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      // ESC dismisses this confirm (= cancel), not the whole bazaar.
      dereg = BazaarPanel.registerOverlay(() => close(false));
    });
  }

  private async promptList(owned: OwnedItem, def: ItemDef): Promise<void> {
    const res = await this.themedModal({
      title: ti18n('bz.list_title', { item: `${def.emoji} ${def.name}` }),
      fields: [
        { key: 'price', label: ti18n('bz.price_in_sats'), placeholder: '100', type: 'number' },
        { key: 'note', label: ti18n('bz.note_optional'), placeholder: ti18n('bz.note_placeholder') },
      ],
      confirmLabel: ti18n('bz.list'),
      confirmColor: '#c070ff',
    });
    if (!res) return;
    const price = Math.max(1, parseInt(res.price) || 0);
    if (!res.price || price < 1) {
      ToastManager.show(ti18n('bz.price_min'), '#ff7070');
      return;
    }
    // Listing now escrows the item to the oracle first (server round-trip), so
    // wait for the result before updating the UI.
    ToastManager.show(ti18n('bz.listing_progress', { item: def.name }), '#c070ff');
    const result = await listItem(owned.instanceId, price, res.note || undefined);
    this.render();
    if (result.ok) {
      ToastManager.show(ti18n('bz.listed_ok', { item: `${def.emoji} ${def.name}`, price: String(price) }), '#c070ff');
    } else {
      const reasons: Record<string, string> = {
        no_lightning_address: ti18n('bz.list_err.no_lightning_address'),
        no_verify_support: ti18n('bz.list_err.no_verify_support'),
        lightning_unreachable: ti18n('bz.list_err.lightning_unreachable'),
        not_owned: ti18n('bz.list_err.not_owned'),
        duplicate: ti18n('bz.list_err.duplicate'),
        pending_offer: ti18n('bz.list_err.pending_offer'),
        no_signer: ti18n('bz.list_err.no_signer'),
        offline: ti18n('bz.err.offline'),
        timeout: ti18n('bz.list_err.timeout'),
      };
      ToastManager.show(reasons[result.reason ?? ''] ?? ti18n('bz.list_err.generic'), '#ff7070');
    }
  }

  // ── Market tab ───────────────────────────────────────────────────────────

  private renderMarket(body: HTMLElement): void {
    const { pubkey } = authStore.getState();

    // Show local (own) listings
    const localListings = getLocalListings();
    // Show cached remote while fetching
    const remoteListings = getCachedRemoteListings();
    const hasAny = localListings.length > 0 || remoteListings.length > 0;

    // Kick off background fetch — only re-render if new data arrived
    const countBefore = remoteListings.length;
    fetchMarketListings().then(fresh => {
      if (fresh.length !== countBefore && this.tab === 'market' && document.getElementById(PANEL_ID)) {
        this.render();
      }
    });

    if (!hasAny) {
      body.innerHTML = `<div style="color:#8a8aa8;text-align:center;padding:40px 0;font-size:13px;">${ti18n('bz.market_fetching')}</div>`;
      return;
    }

    // ── Browse / My Listings toggle ──
    const controls = document.createElement('div');
    controls.style.cssText = `display:flex;flex-direction:column;gap:8px;margin-bottom:12px;`;
    const viewRow = document.createElement('div');
    viewRow.style.cssText = `display:flex;gap:4px;`;
    const mineCount = getLocalListings().length;
    ([['browse', ti18n('bz.browse')], ['mine', `${ti18n('bz.my_listings')}${mineCount ? ` (${mineCount})` : ''}`]] as [typeof this.marketView, string][]).forEach(([v, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `flex:1;background:${this.marketView === v ? '#1e1e38' : 'none'};border:1px solid ${this.marketView === v ? '#4a4a8a' : '#2a2a4a'};color:${this.marketView === v ? '#c0a8ff' : '#777'};font-family:'Courier New',monospace;font-size:11px;cursor:pointer;padding:6px 0;border-radius:4px;letter-spacing:1px;`;
      b.addEventListener('click', () => { this.marketView = v; this.render(); });
      viewRow.appendChild(b);
    });
    controls.appendChild(viewRow);

    const cats: [typeof this.marketCategory, string][] = [
      ['all', ti18n('bz.cat_all')], ['fish', '🎣'], ['hardware', '💾'], ['street', '🌆'], ['lore', '📜'], ['occult', '🔮'], ['critters', '🐀'], ['eats', '🍜'], ['holiday', '🎉'],
    ];
    const catRow = document.createElement('div');
    catRow.style.cssText = `display:flex;gap:4px;flex-wrap:wrap;`;
    for (const [cat, label] of cats) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `background:${this.marketCategory === cat ? '#1e1e38' : 'none'};border:1px solid ${this.marketCategory === cat ? '#4a4a8a' : '#2a2a4a'};color:${this.marketCategory === cat ? '#c0a8ff' : '#777'};font-family:'Courier New',monospace;font-size:11px;cursor:pointer;padding:4px 10px;border-radius:4px;`;
      b.addEventListener('click', () => { this.marketCategory = cat; this.render(); });
      catRow.appendChild(b);
    }
    const search = document.createElement('input');
    search.placeholder = ti18n('bz.search_items');
    search.value = this.marketSearch;
    search.style.cssText = `background:#0e0e22;border:1px solid #2a2a4a;color:#c0c0e0;font-family:'Courier New',monospace;font-size:11px;padding:6px 10px;border-radius:4px;outline:none;`;
    search.addEventListener('input', () => {
      this.marketSearch = search.value;
      this.applyMarketFilter(body);
    });
    controls.appendChild(catRow);
    controls.appendChild(search);
    body.appendChild(controls);

    const listContainer = document.createElement('div');
    listContainer.id = 'bazaar-market-list';
    body.appendChild(listContainer);
    this.renderMarketList(listContainer, localListings, remoteListings, pubkey ?? '');
  }

  private matchesFilter(def: ItemDef): boolean {
    if (this.marketCategory !== 'all' && def.category !== this.marketCategory) return false;
    if (this.marketSearch && !def.name.toLowerCase().includes(this.marketSearch.toLowerCase())) return false;
    return true;
  }

  // Re-filter without rebuilding the whole panel (keeps search input focused)
  private applyMarketFilter(body: HTMLElement): void {
    const container = body.querySelector('#bazaar-market-list') as HTMLElement | null;
    if (!container) return;
    const { pubkey } = authStore.getState();
    this.renderMarketList(container, getLocalListings(), getCachedRemoteListings(), pubkey ?? '');
  }

  private renderMarketList(container: HTMLElement, local: MarketListing[], remote: RemoteListing[], _pubkey: string): void {
    container.innerHTML = '';

    if (this.marketView === 'mine') {
      const localF = local.filter(l => this.matchesFilter(l.def));
      if (localF.length === 0) {
        container.innerHTML = `<div style="color:#8a8aa8;text-align:center;padding:30px 0;font-size:12px;">${ti18n('bz.no_active_listings')}</div>`;
        return;
      }
      for (const listing of localF) container.appendChild(this.localListingCard(listing, _pubkey));
      return;
    }

    // Browse — only the network's listings
    const remoteF = remote.filter(l => l.itemDef && this.matchesFilter(l.itemDef));
    if (remoteF.length === 0) {
      container.innerHTML = `<div style="color:#8a8aa8;text-align:center;padding:30px 0;font-size:12px;">${ti18n('bz.no_market_listings')}</div>`;
      return;
    }
    for (const listing of remoteF) container.appendChild(this.remoteListingCard(listing));

    // Resolve seller display names (profile/npub) and re-render once they arrive
    const unresolved = remoteF.map(l => l.sellerPubkey).filter(pk => getCachedName(pk).startsWith('npub'));
    if (unresolved.length) {
      resolveNames(unresolved).then(() => {
        if (this.tab === 'market' && BazaarPanel.isOpen()) this.render();
      });
    }
  }

  // Shared card shell — rarity-accented left edge, emoji tile, info, right action
  private listingCardShell(def: ItemDef, priceHtml: string, actionHtml: string, opts: { note?: string; sellerLine?: string } = {}): HTMLElement {
    const card = document.createElement('div');
    const ac = RARITY_COLOR[def.rarity];
    card.style.cssText = `
      background:#0e0e22;border:1px solid #1e1e3a;border-left:3px solid ${ac};
      border-radius:8px;padding:10px 12px;margin-bottom:8px;
      display:flex;align-items:center;gap:12px;transition:border-color 0.15s;
    `;
    // Hover changes the other three borders only — re-apply the rarity left accent
    // after the shorthand reset so it isn't wiped on mouse-leave.
    card.onmouseenter = () => { card.style.borderColor = '#3a3a7a'; card.style.borderLeftColor = ac; };
    card.onmouseleave = () => { card.style.borderColor = '#1e1e3a'; card.style.borderLeftColor = ac; };
    card.style.borderLeftColor = ac;
    card.innerHTML = `
      <div style="width:38px;height:38px;flex-shrink:0;border-radius:7px;background:${ac}1a;display:flex;align-items:center;justify-content:center;font-size:20px;color:#e6e6f5;">${def.emoji}</div>
      <div style="flex:1;min-width:0;">
        <div style="color:${ac};font-size:13px;font-weight:bold;">${def.name}</div>
        <div style="color:#666;font-size:9px;letter-spacing:1px;margin-top:1px;">${def.rarity.toUpperCase()} · ${CATEGORY_LABEL[def.category] ?? def.category}</div>
        ${opts.note ? `<div style="color:#8888aa;font-size:10px;margin-top:3px;font-style:italic;">"${opts.note}"</div>` : ''}
        ${opts.sellerLine ? `<div style="color:#555;font-size:9px;margin-top:2px;">${opts.sellerLine}</div>` : ''}
      </div>
      <div class="nd-card-actions" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
        <div style="color:#ffd700;font-size:13px;font-weight:bold;display:flex;align-items:center;gap:3px;">${priceHtml}</div>
        ${actionHtml}
      </div>
    `;
    return card;
  }

  private localListingCard(listing: MarketListing, _pubkey: string): HTMLElement {
    const card = this.listingCardShell(
      listing.def,
      `${listing.price} ${boltIcon(11, '#ffd700')}`,
      `<button class="bazaar-delist-btn" style="background:#1a0a0a;border:1px solid #6a1a1a;color:#ff7070;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:4px 12px;border-radius:4px;">${ti18n('bz.delist')}</button>`,
      { note: listing.note },
    );
    card.querySelector('.bazaar-delist-btn')!.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true; btn.textContent = ti18n('bz.delisting');
      delistItem(listing.id).then((res) => {
        if (!res.ok) {
          btn.disabled = false; btn.textContent = ti18n('bz.delist');
          ToastManager.show(ti18n('bz.delist_failed'), '#ff7070');
          return;
        }
        ToastManager.show(ti18n('bz.delisted_ok', { item: `${listing.def.emoji} ${listing.def.name}` }), '#c070ff');
        this.render();
      });
    });

    // (Bids on this listing are shown in the OFFERS tab, not here.)
    return card;
  }

  // Inject the themed scrollbar + mobile-responsive styles once. Media queries use
  // !important to override the inline styles on cards/buttons/grids.
  private ensureScrollStyle(): void {
    if (document.getElementById('nd-want-scroll-style')) return;
    const st = document.createElement('style');
    st.id = 'nd-want-scroll-style';
    st.textContent = `
      .nd-want-list::-webkit-scrollbar { width:6px; }
      .nd-want-list::-webkit-scrollbar-track { background:transparent; }
      .nd-want-list::-webkit-scrollbar-thumb { background:#8a8a1a55; border-radius:3px; }
      .nd-want-list::-webkit-scrollbar-thumb:hover { background:#8a8a1a88; }

      /* ── Mobile / narrow viewports ── */
      @media (max-width: 560px) {
        #bazaar-panel .nd-inv-grid { grid-template-columns: repeat(2, 1fr) !important; }
        #bazaar-panel .nd-want-list[style*="grid"] { grid-template-columns: 1fr !important; }
        #bazaar-panel .bazaar-buy-btn,
        #bazaar-panel .bazaar-bid-btn,
        #bazaar-panel .bazaar-trade-btn,
        #bazaar-panel .bazaar-list-btn,
        #bazaar-panel .bazaar-delist-btn,
        #bazaar-panel .bazaar-accept-bid {
          padding: 9px 14px !important; font-size: 12px !important;
          min-height: 40px !important; box-sizing: border-box !important;
          display: flex !important; align-items: center !important; justify-content: center !important;
        }
        #bazaar-panel .bazaar-discard-btn {
          padding: 4px 10px !important; font-size: 14px !important; min-height: 32px !important;
        }
        /* Let listing-card actions sit inline and wrap rather than a tall column */
        #bazaar-panel .nd-card-actions { flex-direction: row !important; flex-wrap: wrap !important; align-items: center !important; }
      }
      @media (max-width: 400px) {
        #bazaar-panel .nd-inv-grid { grid-template-columns: 1fr !important; }
      }`;
    document.head.appendChild(st);
  }

  private remoteListingCard(listing: RemoteListing): HTMLElement {
    const def = listing.itemDef!;
    const sellerName = getCachedName(listing.sellerPubkey);
    // If a bid was accepted on this item, it's reserved for that winner — no buying
    // or bidding by others until they pay (or decline).
    const reserved = isItemReserved(listing.instanceId);
    const actions = reserved
      ? `<button class="bazaar-buy-btn" disabled style="background:#16101f;border:1px solid #4a3a5a;color:#8a7aaa;font-family:'Courier New',monospace;font-size:10px;cursor:not-allowed;padding:4px 12px;border-radius:4px;">${ti18n('bz.bid_pending')}</button>`
      : `<button class="bazaar-buy-btn" style="background:#0a1a0a;border:1px solid #1a6a1a;color:#70ff70;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:4px 12px;border-radius:4px;display:flex;align-items:center;gap:4px;">${ti18n('bz.buy')} · ${listing.price} ${boltIcon(10, '#70ff70')}</button>`
        + `<button class="bazaar-bid-btn" style="background:#1a0a2a;border:1px solid #4a1a6a;color:#c070ff;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:4px 12px;border-radius:4px;">${ti18n('bz.bid')}</button>`;
    const card = this.listingCardShell(
      def,
      `${listing.price} ${boltIcon(11, '#ffd700')}`,
      actions,
      { note: listing.note, sellerLine: ti18n('bz.by_seller', { name: sellerName }) },
    );
    if (reserved) return card; // no buy/bid handlers — it's spoken for
    card.querySelector('.bazaar-bid-btn')?.addEventListener('click', () => this.promptBid(listing));
    card.querySelector('.bazaar-buy-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true; btn.textContent = ti18n('bz.paying');
      const result = await purchaseListing(listing, (msg) => { btn.textContent = msg.slice(0, 20) + '…'; });
      if (result.status === 'ok') {
        btn.textContent = ti18n('bz.paid_check'); btn.style.color = '#ffd700';
        ToastManager.show(ti18n('bz.bought_ok', { price: String(listing.price), item: def.name }), '#ffd700');
        setTimeout(() => this.render(), 1500);
      } else if (result.status === 'invoice' && result.invoice) {
        // Wallet can't cover it → show a QR. The server is already polling for
        // payment and will release the item (item_minted) once it settles, so the
        // modal just needs to display the invoice — no client-side verify needed.
        btn.textContent = ti18n('bz.scan_to_pay'); btn.disabled = false;
        const { showInvoiceModal } = await import('./market/MarketInvoice');
        const name = listing.itemDef?.name ?? ti18n('bz.item');
        showInvoiceModal(
          result.invoice, name, listing.price || 1, undefined,
          undefined, undefined, null,
          // Fires when the server's item_sold for this listing arrives —
          // the modal closes itself; we just celebrate and refresh.
          () => {
            ToastManager.show(ti18n('bz.bought_ok', { price: String(listing.price), item: name }), '#ffd700');
            this.render();
          },
          listing.instanceId,
          // Dismissed without paying → put the listing back (it was only
          // soft-hidden while the QR was up). If they pay the saved invoice
          // later anyway, item_sold re-hides it for good.
          () => {
            restoreLocalListing(listing);
            this.render();
          },
        );
      } else if (result.status === 'no_signer') {
        btn.textContent = ti18n('bz.login_required'); btn.disabled = false;
      } else if (result.status === 'unavailable') {
        // Item isn't buyable by us — say why; no payment was made.
        const msgs: Record<string, { btn: string; toast: string }> = {
          reserved_for_winner: { btn: ti18n('bz.buy_btn.bid_won'),   toast: ti18n('bz.buy_err.reserved_for_winner') },
          own_listing:         { btn: ti18n('bz.buy_btn.your_listing'), toast: ti18n('bz.buy_err.own_listing') },
          already_sold:        { btn: ti18n('bz.buy_btn.sold'),       toast: ti18n('bz.buy_err.already_sold') },
          item_gone:           { btn: ti18n('bz.buy_btn.gone'),       toast: ti18n('bz.buy_err.item_gone') },
          not_listed:          { btn: ti18n('bz.buy_btn.unlisted'),   toast: ti18n('bz.buy_err.not_listed') },
        };
        const m = msgs[result.reason ?? ''] ?? { btn: ti18n('bz.buy_btn.unavailable'), toast: ti18n('bz.buy_err.generic') };
        btn.textContent = m.btn; btn.style.color = '#f0b040';
        window.dispatchEvent(new CustomEvent('nd-toast', { detail: { msg: m.toast, color: '#f0b040' } }));
        // Keep winner-reserved items visible (they may free up); drop truly-gone ones.
        if (result.reason !== 'reserved_for_winner' && result.reason !== 'own_listing') setTimeout(() => this.render(), 1500);
        else btn.disabled = false;
      } else if (result.status === 'payment_failed') {
        btn.textContent = ti18n('bz.try_again'); btn.style.color = '#ff7070'; btn.disabled = false;
        window.dispatchEvent(new CustomEvent('nd-toast', { detail: { msg: ti18n('bz.buy_err.start_failed'), color: '#ff7070' } }));
      }
    });
    return card;
  }

  private async promptBid(listing: RemoteListing): Promise<void> {
    const def = listing.itemDef!;
    const res = await this.themedModal({
      title: ti18n('bz.bid_title', { item: `${def.emoji} ${def.name}` }),
      fields: [{ key: 'amount', label: ti18n('bz.bid_field', { price: String(listing.price) }), placeholder: String(listing.price), type: 'number' }],
      confirmLabel: ti18n('bz.place_bid'),
      confirmColor: '#c070ff',
    });
    if (!res) return;
    const amount = Math.max(1, parseInt(res.amount) || 0);
    if (amount < 1) { ToastManager.show(ti18n('bz.bid_min'), '#ff7070'); return; }
    const r = await placeBid(listing, amount);
    if (r.ok) {
      ToastManager.show(ti18n('bz.bid_placed', { amount: String(amount), item: def.name }), '#c070ff');
    } else {
      const reasons: Record<string, string> = {
        already_sold: ti18n('bz.bid_err.already_sold'),
        reserved_for_winner: ti18n('bz.bid_err.reserved'),
        not_listed: ti18n('bz.bid_err.not_listed'),
        own_listing: ti18n('bz.bid_err.own_listing'),
        offline: ti18n('bz.err.offline'),
        timeout: ti18n('bz.bid_err.timeout'),
      };
      ToastManager.show(reasons[r.reason ?? ''] ?? ti18n('bz.bid_err.generic'), '#ff7070');
    }
  }

  // ── Trade offer composer ─────────────────────────────────────────────────

  private showTradeTargetBanner(pubkey: string, name: string): void {
    const panel = document.getElementById(PANEL_ID)?.firstElementChild as HTMLElement | null;
    if (!panel) return;
    let banner = panel.querySelector('#bazaar-trade-target') as HTMLElement | null;
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'bazaar-trade-target';
      banner.style.cssText = `background:#1a1a0a;border:1px solid #4a4a1a;color:#d0d060;font-family:'Courier New',monospace;font-size:11px;padding:6px 16px;text-align:center;flex-shrink:0;`;
      panel.insertBefore(banner, panel.querySelector('div[style*="flex:1"]') ?? panel.children[2]);
    }
    banner.textContent = `⇄ ${ti18n('bz.trading_with', { name })}`;
  }

  private async promptTradeOffer(owned: OwnedItem, def: ItemDef): Promise<void> {
    let toPubkey = this.pendingTradePubkey;
    let toName = this.pendingTradeName;
    if (!toPubkey) {
      const picked = await this.promptTradePartner(def);
      if (!picked) return;
      toPubkey = picked.pubkey;
      toName = picked.name;
    }
    this.showWantPicker(def, toPubkey, toName ?? getCachedName(toPubkey), owned.instanceId);
  }

  // Choose who to trade with: type an npub/hex, or pick from online players.
  private promptTradePartner(def: ItemDef): Promise<{ pubkey: string; name: string } | null> {
    return new Promise((resolve) => {
      requestOnlinePlayers(); // ask the server for a fresh list
      const myPk = authStore.getState().pubkey;

      const overlay = document.createElement('div');
      overlay.style.cssText = `position:fixed;inset:0;z-index:1400;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:'Courier New',monospace;`;
      const box = document.createElement('div');
      box.style.cssText = `background:#0a0a18;border:1px solid #4a4a1a;border-radius:10px;padding:20px;width:min(400px,92vw);max-height:72vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 0 40px rgba(80,60,180,0.3);`;
      box.innerHTML = `
        <div style="color:#d0d060;font-size:14px;font-weight:bold;">${ti18n('bz.offer_item', { item: `${def.emoji} ${def.name}` })}</div>
        <div>
          <label style="display:block;color:#888;font-size:10px;letter-spacing:1px;margin-bottom:4px;">${ti18n('bz.trade_with_label')}</label>
          <input id="tp-input" placeholder="npub1…" style="width:100%;box-sizing:border-box;background:#0e0e22;border:1px solid #2a2a4a;color:#c0c0e0;font-family:'Courier New',monospace;font-size:12px;padding:7px 10px;border-radius:5px;outline:none;" />
        </div>
        <div style="color:#666;font-size:10px;letter-spacing:1px;">${ti18n('bz.online_now')}</div>
        <div id="tp-online" class="nd-want-list" style="overflow-y:auto;flex:1;min-height:80px;display:flex;flex-direction:column;gap:4px;scrollbar-width:thin;scrollbar-color:#8a8a1a55 transparent;"></div>
        <div style="display:flex;gap:8px;">
          <button id="tp-cancel" style="flex:1;background:#1a0a0a;border:1px solid #5a2a2a;color:#c06060;font-family:'Courier New',monospace;font-size:12px;cursor:pointer;padding:8px 0;border-radius:5px;">${ti18n('bz.cancel')}</button>
          <button id="tp-next" style="flex:1;background:#0e0e22;border:1px solid #d0d060;color:#d0d060;font-family:'Courier New',monospace;font-size:12px;font-weight:bold;cursor:pointer;padding:8px 0;border-radius:5px;">${ti18n('bz.next')}</button>
        </div>
      `;

      const close = (result: { pubkey: string; name: string } | null) => {
        clearInterval(refreshTimer);
        dereg();
        overlay.remove();
        resolve(result);
      };
      const dereg = BazaarPanel.registerOverlay(() => close(null)); // ESC closes this, not the bazaar

      const renderOnline = () => {
        const wrap = box.querySelector('#tp-online')!;
        const players = getOnlinePlayers().filter(p => p.pubkey && p.pubkey !== myPk);
        if (!players.length) {
          wrap.innerHTML = `<div style="color:#555;font-size:11px;text-align:center;padding:16px 0;">${ti18n('bz.no_one_online')}</div>`;
          return;
        }
        wrap.innerHTML = '';
        for (const p of players) {
          const row = document.createElement('button');
          row.style.cssText = `background:#0e0e22;border:1px solid #1e1e3a;color:#c0c0e0;font-family:'Courier New',monospace;font-size:11px;cursor:pointer;padding:7px 10px;border-radius:5px;text-align:left;display:flex;justify-content:space-between;align-items:center;`;
          row.onmouseenter = () => row.style.borderColor = '#8a8a1a';
          row.onmouseleave = () => row.style.borderColor = '#1e1e3a';
          const display = p.name || getCachedName(p.pubkey);
          // A player in their own room reports room = "myroom:<pubkey>" — never show that
          // raw string (it overflows the row). Show a short label; truncate long names.
          const roomLabel = p.room ? (p.room.startsWith('myroom:') ? 'in a room' : p.room) : '';
          row.innerHTML = `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${display}</span><span style="color:#555;font-size:9px;flex-shrink:0;margin-left:8px;">${roomLabel}</span>`;
          row.addEventListener('click', () => close({ pubkey: p.pubkey, name: display }));
          wrap.appendChild(row);
        }
      };
      renderOnline();
      const refreshTimer = setInterval(renderOnline, 1500);

      // Normalize a typed npub/hex to a hex pubkey — relay #p filters are hex, so
      // an un-decoded npub would match no items (offline players showed nothing).
      const submitTyped = () => {
        const raw = (box.querySelector('#tp-input') as HTMLInputElement).value.trim();
        if (!raw) return;
        const hex = normalizePubkey(raw);
        if (!hex) { ToastManager.show('Enter a valid npub or hex pubkey.', '#ff7070'); return; }
        resolveNames([hex]).catch(() => {}); // fetch their profile name in the background
        close({ pubkey: hex, name: getCachedName(hex) }); // name if known, else short npub
      };
      box.querySelector('#tp-cancel')!.addEventListener('click', () => close(null));
      box.querySelector('#tp-next')!.addEventListener('click', submitTyped);
      box.addEventListener('keydown', e => {
        if ((e as KeyboardEvent).key === 'Enter') submitTyped();
      });
      overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      (box.querySelector('#tp-input') as HTMLInputElement)?.focus();
    });
  }

  private showWantPicker(offerDef: ItemDef, toPubkey: string, toName: string, instanceId: string): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;`;

    const box = document.createElement('div');
    box.style.cssText = `background:#0a0a18;border:1px solid #4a4a1a;border-radius:10px;padding:18px;width:min(440px,92vw);max-height:70vh;display:flex;flex-direction:column;font-family:'Courier New',monospace;`;

    box.innerHTML = `
      <div id="wp-title1" style="color:#d0d060;font-size:13px;font-weight:bold;margin-bottom:4px;">⇄ ${ti18n('bz.offer_to', { item: `${offerDef.emoji} ${offerDef.name}`, name: toName })}</div>
      <div id="wp-title2" style="color:#666;font-size:11px;margin-bottom:8px;">${ti18n('bz.pick_their_item', { name: `<span style="color:#d0d060;">${toName}</span>` })}</div>
      <button id="want-gift" style="align-self:flex-start;background:#0a1a2a;border:1px solid #1a4a6a;color:#70b0ff;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:5px 10px;border-radius:4px;margin-bottom:10px;">${ti18n('bz.or_gift')}</button>
      <input id="want-search" placeholder="${ti18n('bz.search_items')}" style="background:#0e0e22;border:1px solid #2a2a4a;color:#c0c0e0;font-family:'Courier New',monospace;font-size:11px;padding:6px 10px;border-radius:4px;margin-bottom:10px;outline:none;" />
      <div id="want-list" class="nd-want-list" style="overflow-y:auto;flex:1;display:grid;grid-template-columns:1fr 1fr;gap:6px;scrollbar-width:thin;scrollbar-color:#8a8a1a55 transparent;"></div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <input id="want-msg" placeholder="${ti18n('bz.optional_message')}" style="flex:1;min-width:0;background:#0e0e22;border:1px solid #2a2a4a;color:#c0c0e0;font-family:'Courier New',monospace;font-size:11px;padding:6px 10px;border-radius:4px;outline:none;" />
        <button id="want-send" disabled style="flex-shrink:0;background:#0a1a0a;border:1px solid #2a6a2a;color:#70ff70;font-family:'Courier New',monospace;font-size:11px;cursor:not-allowed;padding:6px 14px;border-radius:4px;opacity:0.4;">${ti18n('bz.send_offer')}</button>
        <button id="want-cancel" style="flex-shrink:0;background:#1a0a0a;border:1px solid #6a1a1a;color:#ff7070;font-family:'Courier New',monospace;font-size:11px;cursor:pointer;padding:6px 12px;border-radius:4px;">${ti18n('bz.cancel')}</button>
      </div>
    `;

    this.ensureScrollStyle(); // themed scrollbar for the item list

    let selectedId: string | null = null;
    const sendBtn = box.querySelector('#want-send') as HTMLButtonElement;
    // What THEY own — populated from their relay inventory below. We trade for one
    // of their actual items, not the whole game catalog.
    let theirItems: ItemDef[] = [];
    let loading = true;

    const msg = (html: string) =>
      `<div style="grid-column:1/-1;color:#666;font-size:11px;text-align:center;padding:24px 8px;">${html}</div>`;

    const renderList = (filter = '') => {
      const list = box.querySelector('#want-list')!;
      if (loading) { list.innerHTML = msg(ti18n('bz.loading_their_items')); return; }
      if (!theirItems.length) { list.innerHTML = msg(ti18n('bz.no_tradeable', { name: toName })); return; }
      list.innerHTML = '';
      const filtered = filter ? theirItems.filter(d => d.name.toLowerCase().includes(filter.toLowerCase())) : theirItems;
      if (!filtered.length) { list.innerHTML = msg(ti18n('bz.no_matching')); return; }
      for (const d of filtered) {
        const btn = document.createElement('button');
        btn.style.cssText = `background:${selectedId === d.id ? '#1a1a0a' : '#0e0e22'};border:1px solid ${selectedId === d.id ? '#8a8a1a' : '#1e1e3a'};color:${RARITY_COLOR[d.rarity]};font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:6px 8px;border-radius:4px;text-align:left;`;
        btn.innerHTML = `${d.emoji} ${d.name}<br><span style="color:#555;font-size:8px;">${d.rarity}</span>`;
        btn.addEventListener('click', () => {
          selectedId = d.id;
          renderList(filter);
          // Enable the single, persistent SEND OFFER button
          sendBtn.disabled = false;
          sendBtn.style.cursor = 'pointer';
          sendBtn.style.opacity = '1';
        });
        list.appendChild(btn);
      }
    };

    renderList();
    // Stream their items in as relays respond (don't block on the slowest one).
    // First grab the items they currently have LISTED so we exclude those — you
    // can't trade for someone's for-sale items (they're escrowed to the oracle).
    let stopStream = () => {};
    fetchListedInstanceIdsOf(toPubkey).then((listed) => {
      stopStream = streamOwnedItemsOf(toPubkey, (items) => {
        loading = false;
        theirItems = items.filter(d => d.id !== offerDef.id);
        renderList((box.querySelector('#want-search') as HTMLInputElement).value);
      }, 4000, 650, listed);
    });

    // Single close path — also registered as the ESC overlay closer so ESC closes
    // this picker instead of the bazaar behind it.
    const closePicker = () => {
      dereg();
      stopStream();
      overlay.remove();
      this.pendingTradePubkey = null; this.pendingTradeName = null;
    };
    const dereg = BazaarPanel.registerOverlay(closePicker);

    sendBtn.addEventListener('click', () => {
      if (!selectedId) return;
      sendBtn.disabled = true;
      const note = (box.querySelector('#want-msg') as HTMLInputElement).value.trim();
      sendTradeOffer(toPubkey, instanceId, selectedId, note || undefined).then(ok => {
        closePicker();
        if (ok) ToastManager.show(ti18n('bz.offer_sent', { name: toName }), '#d0d060');
      });
    });

    // Gift instead: transfer the item to this same partner with nothing in return
    box.querySelector('#want-gift')!.addEventListener('click', async () => {
      const giftBtn = box.querySelector('#want-gift') as HTMLButtonElement;
      giftBtn.disabled = true; giftBtn.textContent = ti18n('bz.gifting');
      const note = (box.querySelector('#want-msg') as HTMLInputElement).value.trim();
      const ok = await sendItemDirect(instanceId, toPubkey, note || undefined);
      closePicker();
      if (ok) ToastManager.show(ti18n('bz.gifted_ok', { item: `${offerDef.emoji} ${offerDef.name}`, name: toName }), '#70b0ff');
      else ToastManager.show(ti18n('bz.gift_failed'), '#ff7070');
      this.render();
    });

    (box.querySelector('#want-search') as HTMLInputElement).addEventListener('input', e => {
      renderList((e.target as HTMLInputElement).value);
    });
    box.querySelector('#want-cancel')!.addEventListener('click', closePicker);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // If we only have a short npub for the partner, resolve their profile name and
    // upgrade the title once it arrives.
    if (toName.startsWith('npub')) {
      resolveNames([toPubkey]).then(() => {
        const n = getCachedName(toPubkey);
        if (!n || n.startsWith('npub')) return; // still no real name
        const t1 = box.querySelector('#wp-title1'); const t2 = box.querySelector('#wp-title2');
        if (t1) t1.innerHTML = `⇄ ${ti18n('bz.offer_to', { item: `${offerDef.emoji} ${offerDef.name}`, name: n })}`;
        if (t2) t2.innerHTML = ti18n('bz.pick_their_item', { name: `<span style="color:#d0d060;">${n}</span>` });
      }).catch(() => {});
    }
  }

  // ── Offers tab ───────────────────────────────────────────────────────────

  // Bids on the player's own listings, rendered in the Offers tab.
  private renderBidsOnMyListings(body: HTMLElement, listingsWithBids: MarketListing[]): void {
    if (!listingsWithBids.length) return;
    this.ensureScrollStyle();
    const hdr = document.createElement('div');
    hdr.style.cssText = `color:#666;font-size:10px;letter-spacing:2px;margin-bottom:8px;border-bottom:1px solid #1a1a2e;padding-bottom:4px;`;
    hdr.textContent = ti18n('bz.bids_on_yours');
    body.appendChild(hdr);

    for (const listing of listingsWithBids) {
      const bids = this.bidsByInstance[listing.item.instanceId] ?? [];
      const accepted = this.acceptedBid[listing.item.instanceId];
      const card = document.createElement('div');
      card.style.cssText = `background:#0e0e22;border:1px solid #1e1e3a;border-left:3px solid ${RARITY_COLOR[listing.def.rarity]};border-radius:8px;padding:12px 14px;margin-bottom:8px;`;
      const countLine = accepted ? ti18n('bz.listed_at', { price: String(listing.price) })
        : `${ti18n('bz.listed_at', { price: String(listing.price) })} · ${ti18n(bids.length === 1 ? 'bz.bid_count_one' : 'bz.bid_count_many', { n: String(bids.length) })}`;
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:18px;color:#e6e6f5;">${listing.def.emoji}</span>
          <div style="flex:1;min-width:0;">
            <div style="color:${RARITY_COLOR[listing.def.rarity]};font-size:12px;font-weight:bold;">${listing.def.name}</div>
            <div style="color:#555;font-size:9px;letter-spacing:1px;">${countLine}</div>
          </div>
        </div>`;

      if (accepted) {
        const note = document.createElement('div');
        note.style.cssText = `color:#70ff70;font-size:10px;`;
        note.textContent = ti18n('bz.accepted_awaiting', { name: accepted.name, amount: String(accepted.amount) });
        card.appendChild(note);
        body.appendChild(card);
        continue;
      }

      const rowsWrap = document.createElement('div');
      rowsWrap.className = 'nd-want-list';
      rowsWrap.style.cssText = `display:flex;flex-direction:column;max-height:150px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#8a8a1a55 transparent;`;
      bids.forEach((bid, i) => {
        const bidderName = getCachedName(bid.buyer);
        const isTop = i === 0;
        const row = document.createElement('div');
        // Separator between bids + a subtle highlight on the highest one so the
        // stacked rows read as distinct, ranked offers rather than one blob.
        row.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:6px;padding:7px 8px;border-radius:6px;`
          + (i > 0 ? 'border-top:1px solid #1a1a2e;' : '')
          + (isTop ? 'background:color-mix(in srgb,#ffd700 7%,transparent);' : '');
        const tag = isTop
          ? `<span style="color:#06140a;background:#ffd700;font-size:7px;font-weight:bold;letter-spacing:0.5px;padding:1px 4px;border-radius:3px;margin-right:6px;">${ti18n('bz.high')}</span>`
          : `<span style="color:#555;font-size:10px;margin-right:6px;">#${i + 1}</span>`;
        row.innerHTML =
          `<span style="color:#c0c0e0;font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tag}${bidderName} · <span style="color:#ffd700;">${bid.amount}</span> sats</span>`
          + `<div style="display:flex;gap:4px;flex-shrink:0;">`
          + `<button class="bid-accept" style="background:#0a1a0a;border:1px solid #1a6a1a;color:#70ff70;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:4px 10px;border-radius:4px;">${ti18n('bz.accept')}</button>`
          + `<button class="bid-decline" title="${ti18n('bz.decline_bid')}" style="background:#1a0a0a;border:1px solid #5a2a2a;color:#c06060;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:4px 8px;border-radius:4px;">✕</button>`
          + `</div>`;
        row.querySelector('.bid-accept')!.addEventListener('click', async () => {
          const id = listing.item.instanceId;
          if (this.acceptInFlight.has(id) || this.acceptedBid[id]) return; // already accepting/accepted
          this.acceptInFlight.add(id);
          // Optimistically switch the card to the accepted state NOW so the other
          // ACCEPT buttons vanish immediately — no double-accept window.
          this.acceptedBid[id] = { name: bidderName, amount: bid.amount };
          this.render();
          const r = await acceptBidRequest(id, bid.buyer, listing.def.name);
          this.acceptInFlight.delete(id);
          if (r.ok) {
            ToastManager.show(ti18n('bz.accepted_toast', { name: bidderName, amount: String(bid.amount) }), '#c070ff');
          } else {
            delete this.acceptedBid[id]; // revert — accept failed
            const reasons: Record<string, string> = {
              already_accepted: ti18n('bz.accept_err.already_accepted'),
              already_sold: ti18n('bz.accept_err.already_sold'),
              reserved: ti18n('bz.accept_err.reserved'),
              no_such_bid: ti18n('bz.accept_err.no_such_bid'),
              invoice_failed: ti18n('bz.accept_err.invoice_failed'),
              not_your_listing: ti18n('bz.accept_err.not_your_listing'),
            };
            ToastManager.show(reasons[r.reason ?? ''] ?? ti18n('bz.accept_err.generic'), '#ff7070');
            this.render();
          }
        });
        row.querySelector('.bid-decline')!.addEventListener('click', () => {
          const id = listing.item.instanceId;
          if (this.acceptInFlight.has(id) || this.acceptedBid[id]) return; // mid-accept — don't race it
          // Optimistically drop the row; the relay marker makes it durable and
          // marks the bid declined on the bidder's side too.
          this.bidsByInstance[id] = (this.bidsByInstance[id] ?? []).filter(b => !(b.buyer === bid.buyer && b.at === bid.at));
          declineBid(id, bid.buyer, bid.at, listing.def.id, bid.amount);
          ToastManager.show(ti18n('bz.bid_declined_toast', { name: bidderName }), '#c06060');
          this.render();
        });
        rowsWrap.appendChild(row);
      });
      card.appendChild(rowsWrap);
      body.appendChild(card);
    }
  }

  // Bids the player has placed on others' listings — with a CANCEL option.
  private renderMyBids(body: HTMLElement, myBids: MyBid[]): void {
    if (!myBids.length) return;
    const hdr = document.createElement('div');
    hdr.style.cssText = `color:#666;font-size:10px;letter-spacing:2px;margin:4px 0 8px;border-bottom:1px solid #1a1a2e;padding-bottom:4px;`;
    hdr.textContent = ti18n('bz.your_bids');
    body.appendChild(hdr);

    for (const bid of myBids) {
      const def = ITEM_CATALOG.find(d => d.id === bid.itemId);
      const card = document.createElement('div');
      card.style.cssText = `background:#0e0e22;border:1px solid #1e1e3a;border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;`;
      const declinedPill = bid.declined
        ? ` · <span style="color:#ff8070;border:1px solid #5a2a2a;border-radius:3px;padding:0 4px;font-size:8px;">${ti18n('bz.bid_declined_label')}</span>`
        : '';
      card.innerHTML = `
        <span style="font-size:18px;color:#e6e6f5;${bid.declined ? 'opacity:0.6;' : ''}">${def?.emoji ?? '·'}</span>
        <div style="flex:1;min-width:0;">
          <div style="color:#c0c0e0;font-size:12px;${bid.declined ? 'opacity:0.7;' : ''}">${def?.name ?? ti18n('bz.item')}</div>
          <div style="color:#555;font-size:9px;letter-spacing:1px;">${ti18n('bz.your_bid_label')} · <span style="color:#ffd700;">${bid.amount}</span> SATS${declinedPill}</div>
        </div>`;
      const cancel = document.createElement('button');
      cancel.textContent = ti18n('bz.cancel_caps');
      cancel.style.cssText = `flex-shrink:0;background:#1a0a0a;border:1px solid #5a2a2a;color:#c06060;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:5px 12px;border-radius:4px;`;
      cancel.addEventListener('click', async () => {
        cancel.disabled = true; cancel.textContent = '…';
        await withdrawBid(bid.instanceId, bid.sellerPubkey);
        this.myBidsOut = this.myBidsOut.filter(b => b.instanceId !== bid.instanceId);
        ToastManager.show(ti18n('bz.bid_cancelled', { item: def?.name ?? ti18n('bz.item') }), '#c06060');
        this.render();
      });
      card.appendChild(cancel);
      body.appendChild(card);
    }
  }

  private renderOffers(body: HTMLElement): void {
    const offers = getPendingOffers();
    const incoming = offers.filter(o => o.direction === 'incoming');
    const outgoing = offers.filter(o => o.direction === 'outgoing');

    // Bids placed on YOUR listings show here too — a bid is an incoming sats offer.
    const myListings = getLocalListings();
    const listingsWithBids = myListings.filter(l =>
      (this.bidsByInstance[l.item.instanceId]?.length ?? 0) > 0 || this.acceptedBid[l.item.instanceId]);

    // Wins you've been accepted for but haven't paid are shown in the banner; here
    // we also show bids YOU placed that are still pending, so you can cancel them.
    const myActiveBids = this.myBidsOut.filter(b =>
      !this.myWins.some(w => w.instanceId === b.instanceId) && !isItemSold(b.instanceId));

    if (offers.length === 0 && listingsWithBids.length === 0 && myActiveBids.length === 0) {
      body.innerHTML = `<div style="color:#8a8aa8;text-align:center;padding:40px 0;font-size:13px;">${ti18n('bz.no_pending_offers')}</div>`;
      return;
    }

    this.renderBidsOnMyListings(body, listingsWithBids);
    this.renderMyBids(body, myActiveBids);

    const section = (title: string, list: TradeOffer[], isIncoming: boolean) => {
      if (list.length === 0) return;
      const hdr = document.createElement('div');
      hdr.style.cssText = `color:#666;font-size:10px;letter-spacing:2px;margin-bottom:8px;border-bottom:1px solid #1a1a2e;padding-bottom:4px;`;
      hdr.textContent = title;
      body.appendChild(hdr);

      for (const offer of list) {
        const offerDef = ITEM_CATALOG.find(d => d.id === offer.offerItemId);
        const wantDef  = ITEM_CATALOG.find(d => d.id === offer.wantItemId);
        if (!offerDef || !wantDef) continue;

        const card = document.createElement('div');
        card.style.cssText = `background:#0e0e22;border:1px solid #1e1e3a;border-radius:8px;padding:12px 14px;margin-bottom:8px;`;
        const peer = (isIncoming ? offer.fromPubkey : offer.toPubkey).slice(0,8) + '…';

        card.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
            <span style="font-size:18px;color:#e6e6f5;">${offerDef.emoji}</span>
            <span style="color:#666;font-size:14px;">⇄</span>
            <span style="font-size:18px;color:#e6e6f5;">${wantDef.emoji}</span>
            <div style="flex:1;">
              <div style="color:#c0a8ff;font-size:12px;">${ti18n(isIncoming ? 'bz.offer_incoming' : 'bz.offer_outgoing', { offer: offerDef.name, want: wantDef.name })}</div>
              <div style="color:#444;font-size:9px;">${isIncoming ? ti18n('bz.from') : ti18n('bz.to')}: ${peer}</div>
              ${offer.message ? `<div style="color:#666;font-size:10px;font-style:italic;">"${offer.message}"</div>` : ''}
            </div>
          </div>
          ${isIncoming ? `
            <div style="display:flex;gap:6px;">
              <button class="offer-accept-btn" style="flex:1;background:#0a1a0a;border:1px solid #1a6a1a;color:#70ff70;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:5px 0;border-radius:4px;">${ti18n('bz.accept')}</button>
              <button class="offer-reject-btn" style="flex:1;background:#1a0a0a;border:1px solid #6a1a1a;color:#ff7070;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:5px 0;border-radius:4px;">${ti18n('bz.decline')}</button>
            </div>
          ` : `
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="flex:1;color:#444;font-size:10px;">${ti18n('bz.waiting_response')}</span>
              <button class="offer-cancel-btn" style="background:#1a0a0a;border:1px solid #6a1a1a;color:#ff7070;font-family:'Courier New',monospace;font-size:10px;cursor:pointer;padding:5px 12px;border-radius:4px;">${ti18n('bz.cancel_caps')}</button>
            </div>
          `}
        `;

        if (isIncoming) {
          card.querySelector('.offer-accept-btn')!.addEventListener('click', () => {
            // Pick which of your items to send — skip ones already listed or committed
            // to another outgoing offer.
            const listedNow = new Set(getLocalListings().map(l => l.item.instanceId));
            const offeredNow = getPendingOutgoingInstanceIds();
            const myItems = getInventoryWithDefs().filter(e =>
              e.def.id === wantDef.id && !listedNow.has(e.owned.instanceId) && !offeredNow.has(e.owned.instanceId));
            if (myItems.length === 0) {
              ToastManager.show(ti18n('bz.no_free_item', { item: `${wantDef.emoji} ${wantDef.name}` }), '#ff7070');
              return;
            }
            // Use first matching instance
            acceptTradeOffer(offer, myItems[0].owned.instanceId).then(ok => {
              if (ok) { ToastManager.show(ti18n('bz.trade_complete'), '#70ff70'); this.render(); }
              else ToastManager.show(ti18n('bz.trade_failed'), '#ff7070');
            });
          });
          card.querySelector('.offer-reject-btn')!.addEventListener('click', () => {
            rejectTradeOffer(offer).then(() => this.render());
          });
        } else {
          card.querySelector('.offer-cancel-btn')!.addEventListener('click', () => {
            cancelTradeOffer(offer).then(() => {
              ToastManager.show(ti18n('bz.offer_cancelled'), '#ffd700');
              this.refreshInventory();
              this.render();
            });
          });
        }

        body.appendChild(card);
      }
    };

    section(ti18n('bz.incoming_offers'), incoming, true);
    section(ti18n('bz.outgoing_offers'), outgoing, false);
  }

  // ── Sets tab ─────────────────────────────────────────────────────────────

  private renderSets(body: HTMLElement): void {
    const completed = new Set(getCompletedSets().map(s => s.id));
    const ownedIds = new Set(getInventoryWithDefs().map(e => e.def.id));

    for (const set of ITEM_SETS) {
      const progress = getSetProgress(set);
      const done = completed.has(set.id);
      const pct = progress.total > 0 ? Math.round((progress.owned / progress.total) * 100) : 0;
      const expanded = this.expandedSets.has(set.id);

      const card = document.createElement('div');
      card.style.cssText = `
        background:${done ? '#0a1a0a' : '#0e0e22'};
        border:1px solid ${done ? '#2a6a2a' : '#1e1e3a'};
        border-radius:8px;padding:12px 14px;margin-bottom:8px;
      `;

      const header = document.createElement('div');
      header.style.cssText = 'cursor:pointer;';
      header.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div>
            <span class="set-caret" style="color:#666;font-size:10px;margin-right:5px;">${expanded ? '▾' : '▸'}</span>
            <span style="color:${done ? '#70ff70' : '#c0a8ff'};font-size:13px;font-weight:bold;">${done ? '✓ ' : ''}${set.name}</span>
            ${set.rewardLabel ? `<span style="margin-left:8px;color:#666;font-size:9px;letter-spacing:1px;">[${set.rewardLabel}]</span>` : ''}
          </div>
          <span style="color:${done ? '#70ff70' : '#888'};font-size:12px;">${progress.owned}/${progress.total}</span>
        </div>
        <div style="color:#666;font-size:10px;margin-bottom:${(set.rewardAura || set.rewardCosmetic) ? '4px' : '8px'};">${(() => { const k = 'bz.setdesc.' + set.id; const d = ti18n(k); return d === k ? set.description : d; })()}</div>
        ${set.rewardAura ? `<div style="color:${done ? '#9aff9a' : '#9a6eff'};font-size:9px;margin-bottom:8px;letter-spacing:0.5px;">✦ ${ti18n(done ? 'bz.aura_unlocked' : 'bz.aura_unlocks', { aura: set.rewardAura.charAt(0).toUpperCase() + set.rewardAura.slice(1) })}</div>` : ''}
        ${set.rewardCosmetic ? `<div style="color:${done ? '#9aff9a' : '#9a6eff'};font-size:9px;margin-bottom:8px;letter-spacing:0.5px;">✦ ${ti18n(done ? 'bz.reward_unlocked' : 'bz.reward_unlocks', { name: set.rewardCosmetic.label })}</div>` : ''}
        <div style="background:#0a0a18;border-radius:3px;height:4px;overflow:hidden;">
          <div style="background:${done ? '#2a8a2a' : '#4a4a8a'};height:100%;width:${pct}%;transition:width 0.3s;"></div>
        </div>
      `;
      card.appendChild(header);

      // Expandable item grid — owned items pop, missing ones are dimmed.
      const detail = document.createElement('div');
      detail.style.cssText = `display:${expanded ? 'grid' : 'none'};grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:6px;margin-top:10px;`;
      for (const itemId of set.itemIds) {
        const def = ITEM_CATALOG.find(d => d.id === itemId);
        if (!def) continue;
        const have = ownedIds.has(itemId);
        const chip = document.createElement('div');
        chip.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:5px;background:${have ? '#14142e' : '#0a0a14'};border:1px solid ${have ? '#2a2a4a' : '#15151f'};${have ? '' : 'opacity:0.45;'}`;
        chip.innerHTML = `
          <span style="font-size:15px;color:#e6e6f5;${have ? '' : 'filter:grayscale(1) brightness(0.7);'}">${def.emoji}</span>
          <span style="font-size:9px;line-height:1.15;color:${have ? RARITY_COLOR[def.rarity] : '#777'};">${def.name}${have ? '' : ` <span style="color:#555;">(${ti18n('bz.missing')})</span>`}</span>
        `;
        detail.appendChild(chip);
      }
      card.appendChild(detail);

      header.addEventListener('click', () => {
        const nowExpanded = !this.expandedSets.has(set.id);
        if (nowExpanded) this.expandedSets.add(set.id); else this.expandedSets.delete(set.id);
        detail.style.display = nowExpanded ? 'grid' : 'none';
        const caret = header.querySelector('.set-caret') as HTMLElement | null;
        if (caret) caret.textContent = nowExpanded ? '▾' : '▸';
      });

      body.appendChild(card);
    }
  }
}

export const bazaarPanel = new BazaarPanel();
