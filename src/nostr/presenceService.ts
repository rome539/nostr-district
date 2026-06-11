import { authStore } from '../stores/authStore';
import { getAvatar, serializeAvatar } from '../stores/avatarStore';
import { extractEmojiTags } from './emojiService';
import { getStatus } from '../stores/statusStore';

type PlayerData = {
  pubkey: string;
  name: string;
  x: number;
  y: number;
  avatar?: string;
  status?: string;
};

export type PresenceCallback = {
  onPlayerJoin: (player: PlayerData) => void;
  onPlayerMove: (pubkey: string, x: number, y: number, f?: number) => void;
  onPlayerLeave: (pubkey: string) => void;
  onCountUpdate: (count: number) => void;
  onChat: (pubkey: string, name: string, text: string, emojis?: { code: string; url: string }[]) => void;
  onAvatarUpdate?: (pubkey: string, avatar: string) => void;
  onRoomConfigUpdate?: (pubkey: string, roomConfig: string) => void;
  onNameUpdate?: (pubkey: string, name: string) => void;
  onStatusUpdate?: (pubkey: string, status: string) => void;
  onOnlinePlayers?: (players: { pubkey: string; name: string; room: string }[]) => void;
  onPlayersReady?: (count: number) => void;
  onDisconnect?: () => void;
};

// Global callbacks for room request system — persist across scene changes
type RoomRequestHandler = (requesterPubkey: string, requesterName: string) => void;
type RoomGrantedHandler = (ownerPubkey: string, ownerName: string, room: string, roomConfig?: string) => void;
type RoomDeniedHandler = (reason: string) => void;
type RoomKickHandler = (reason: string) => void;
type OnlinePlayersHandler = (players: { pubkey: string; name: string; room: string }[]) => void;

export interface ZoneCounts {
  counts: { hub: number; alley: number; woods: number; cabin: number };
  rooms: { owner: string; ownerName: string; count: number }[];
  total: number;
}
type ZoneCountsHandler = (data: ZoneCounts) => void;

type GameMsgHandler = (msg: Record<string, unknown>) => void;
let onGameMsg: GameMsgHandler | null = null;

export function setGameMsgHandler(handler: GameMsgHandler | null): void { onGameMsg = handler; }

export function sendGameMsg(payload: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'game_msg', ...payload }));
}

// Privacy-preserving in-game zap notifications. After a successful direct
// Lightning payment to another player (no kind:9734 published to relays),
// the sender pings the server which forwards a toast event to the recipient.
type IncomingZapHandler = (senderPk: string, senderName: string, amountSats: number, comment: string) => void;
let onIncomingZap: IncomingZapHandler | null = null;

export function setIncomingZapHandler(handler: IncomingZapHandler | null): void { onIncomingZap = handler; }

export function sendIncomingZapPing(recipientPk: string, amountSats: number, comment: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'incoming_zap', recipientPk, amountSats, comment }));
  }
}

// Returns true to consume the message (skip scene onChat), false to pass through
type ChatInterceptor = (pubkey: string, name: string, text: string) => boolean;
let chatInterceptor: ChatInterceptor | null = null;

export function setChatInterceptor(fn: ChatInterceptor | null): void { chatInterceptor = fn; }

// ── Item minting ──────────────────────────────────────────────────────────────
type ItemMintedHandler = (event: object) => void;
let onItemMinted: ItemMintedHandler | null = null;

export function setItemMintedHandler(handler: ItemMintedHandler | null): void { onItemMinted = handler; }

// ── Fishing (server-rolled) ───────────────────────────────────────────────────
// The client sends a bare "I reeled in"; the server rolls what was caught and
// whether it's kept, and answers with fish_caught. See server.ts rollFishCatch.
export interface FishCaughtMsg { itemId?: string; tier?: string; kept?: boolean; event?: object; escaped?: boolean }
type FishCaughtHandler = (res: FishCaughtMsg) => void;
let onFishCaught: FishCaughtHandler | null = null;

export function setFishCaughtHandler(handler: FishCaughtHandler | null): void { onFishCaught = handler; }

export function sendFishCatchRequest(): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'fish_catch_request' }));
  else onFishCaught?.({ escaped: true }); // offline → the fish gets away
}

export function sendItemMintRequest(itemId: string, acquiredFrom: string, attempt = 0): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'item_mint_request', itemId, acquiredFrom }));
  } else if (attempt < 5) {
    // WS not ready yet — retry up to 5 times, 1s apart
    setTimeout(() => sendItemMintRequest(itemId, acquiredFrom, attempt + 1), 1000);
  }
}

// Scavenge: the server rolls WHAT was found (tier + item from the room's pool).
// The client only reports that a spot was collected, and whether it was a
// holiday spot. The result arrives via the normal item_minted message.
export function sendScavengeRequest(holiday: boolean): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'scavenge_request', holiday }));
  }
}

export function sendItemDiscardRequest(event: object): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'item_discard_request', event }));
  }
}

export function sendItemGiftRequest(event: object, toPubkey: string, itemName?: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'item_gift_request', event, toPubkey, itemName }));
  }
}

export function sendItemSwapRequest(myEvent: object, theirEvent: object, theirPubkey: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'item_swap_request', myEvent, theirEvent, theirPubkey }));
  }
}

// ── Bounty board ──────────────────────────────────────────────────────────────
// The server is the authority for the weekly board (deterministic) and claims.

export interface BountyInfo {
  id: string;
  wants: { itemId: string; qty: number }[];
  rewardItemId: string;
  tier: 'rare' | 'legendary'; // legendary weeks want rares and pay a legendary
  endsAt: number;
  claimed: number;      // how many residents have claimed (social proof, no cap)
  claimedByMe: boolean; // one claim per account per bounty
}

let pendingBountyList: ((bounties: BountyInfo[]) => void) | null = null;
export function fetchBounties(): Promise<BountyInfo[]> {
  return new Promise((resolve) => {
    if (ws?.readyState !== WebSocket.OPEN) { resolve([]); return; }
    const timer = setTimeout(() => { pendingBountyList = null; resolve([]); }, 10000);
    pendingBountyList = (b) => { clearTimeout(timer); resolve(b); };
    ws.send(JSON.stringify({ type: 'bounty_list_request' }));
  });
}

export interface BountyClaimResult { ok: boolean; reason?: string; event?: object; burned?: string[]; claimed?: number }
const pendingBountyClaims = new Map<string, (r: BountyClaimResult) => void>();
export function claimBountyRequest(bountyId: string, instanceIds: string[]): Promise<BountyClaimResult> {
  return new Promise((resolve) => {
    if (ws?.readyState !== WebSocket.OPEN) { resolve({ ok: false, reason: 'offline' }); return; }
    const timer = setTimeout(() => { pendingBountyClaims.delete(bountyId); resolve({ ok: false, reason: 'timeout' }); }, 20000);
    pendingBountyClaims.set(bountyId, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ type: 'bounty_claim_request', bountyId, instanceIds }));
  });
}

// ── Escrow market (list / delist / buy) ───────────────────────────────────────

// List: ask the oracle to escrow the item (hold it while listed). Resolves once
// the server confirms (item_escrowed) or fails with a reason.
const pendingEscrow = new Map<string, (r: { ok: boolean; reason?: string }) => void>();
export function escrowItemRequest(instanceId: string, price: number, lud16: string, itemName: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    if (ws?.readyState !== WebSocket.OPEN) { resolve({ ok: false, reason: 'offline' }); return; }
    const timer = setTimeout(() => { pendingEscrow.delete(instanceId); resolve({ ok: false, reason: 'timeout' }); }, 15000);
    pendingEscrow.set(instanceId, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ type: 'item_escrow_request', instanceId, price, lud16, itemName }));
  });
}

// Delist: return an escrowed item to the seller.
const pendingUnescrow = new Map<string, (r: { ok: boolean; reason?: string }) => void>();
export function unescrowItemRequest(instanceId: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    if (ws?.readyState !== WebSocket.OPEN) { resolve({ ok: false, reason: 'offline' }); return; }
    const timer = setTimeout(() => { pendingUnescrow.delete(instanceId); resolve({ ok: false, reason: 'timeout' }); }, 15000);
    pendingUnescrow.set(instanceId, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ type: 'item_unescrow_request', instanceId }));
  });
}

// Buy step 1: ask the server for an invoice to pay (server fetches it from the
// seller's Lightning address). Resolves with the bolt11 to pay, or an error.
const pendingPurchaseInit = new Map<string, (r: { bolt11?: string; price?: number; error?: string }) => void>();
export function purchaseInitRequest(instanceId: string): Promise<{ bolt11?: string; price?: number; error?: string }> {
  return new Promise((resolve) => {
    if (ws?.readyState !== WebSocket.OPEN) { resolve({ error: 'offline' }); return; }
    const timer = setTimeout(() => { pendingPurchaseInit.delete(instanceId); resolve({ error: 'timeout' }); }, 20000);
    pendingPurchaseInit.set(instanceId, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ type: 'item_purchase_init', instanceId }));
  });
}

// ── Bidding ───────────────────────────────────────────────────────────────────
// Bids themselves are relay-backed (see tradeItemStore). The only server op is the
// seller accepting a bid: the oracle reads the signed bid off the relays, stamps the
// escrow with the winner, and publishes a durable "you won" marker for the bidder.
const pendingAcceptBid = new Map<string, (r: { ok: boolean; reason?: string }) => void>();
export function acceptBidRequest(instanceId: string, buyer: string, itemName?: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    if (ws?.readyState !== WebSocket.OPEN) { resolve({ ok: false, reason: 'offline' }); return; }
    const timer = setTimeout(() => { pendingAcceptBid.delete(instanceId); resolve({ ok: false, reason: 'timeout' }); }, 20000);
    pendingAcceptBid.set(instanceId, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ type: 'accept_bid', instanceId, buyer, itemName }));
  });
}

// Winner declines a bid they won (won't pay) → server re-opens the item.
const pendingDeclineWin = new Map<string, (r: { ok: boolean; reason?: string }) => void>();
export function declineWinRequest(instanceId: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    if (ws?.readyState !== WebSocket.OPEN) { resolve({ ok: false, reason: 'offline' }); return; }
    const timer = setTimeout(() => { pendingDeclineWin.delete(instanceId); resolve({ ok: false, reason: 'timeout' }); }, 15000);
    pendingDeclineWin.set(instanceId, (r) => { clearTimeout(timer); resolve(r); });
    ws.send(JSON.stringify({ type: 'decline_win', instanceId }));
  });
}

type ItemReceivedHandler = (fromName: string, event?: any) => void;
let onItemReceived: ItemReceivedHandler | null = null;
export function setItemReceivedHandler(h: ItemReceivedHandler | null): void { onItemReceived = h; }

let onRoomRequest: RoomRequestHandler | null = null;
let onRoomGranted: RoomGrantedHandler | null = null;
let onRoomDenied: RoomDeniedHandler | null = null;
let onRoomKick: RoomKickHandler | null = null;
let onOnlinePlayers: OnlinePlayersHandler | null = null;
let onZoneCounts: ZoneCountsHandler | null = null;

// Latest online-players snapshot, cached so panels can read it synchronously.
let _lastOnlinePlayers: { pubkey: string; name: string; room: string }[] = [];
export function getOnlinePlayers(): { pubkey: string; name: string; room: string }[] { return _lastOnlinePlayers; }

let ws: WebSocket | null = null;
let callbacks: PresenceCallback | null = null;
let lastSentX = 0;
let lastSentY = 0;
let currentRoom = 'hub';
let presenceReady = false; // true once the server's initial players list arrives
// Track consecutive failed connects so we can swap the loading overlay for a
// clear outage notice after the first failure or two — instead of leaving the
// user staring at "CONNECTING…" forever during a presence-server outage.
let consecutiveFailures = 0;
let connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer:      ReturnType<typeof setTimeout> | null = null;
const CONNECT_TIMEOUT_MS = 10000;     // give up on a connect attempt after this
const OUTAGE_AFTER_FAILURES = 2;       // show outage UI once we've failed this many times

function showLoadingOverlay(): void {
  hideOutageOverlay();
  let el = document.getElementById('ps-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ps-loading';
    el.innerHTML = `
      <div style="
        background:rgba(3,3,16,0.88);
        border:1px solid rgba(93,202,165,0.20);
        border-radius:8px;
        padding:18px 32px;
        font-family:'Courier New',monospace;
        color:#5dcaa5;
        font-size:11px;
        letter-spacing:3px;
        text-transform:uppercase;
        display:flex;
        align-items:center;
        gap:10px;
      ">
        <span id="ps-loading-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#5dcaa5;"></span>
        CONNECTING
      </div>`;
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:none;';
    document.body.appendChild(el);
    // Pulse the dot
    let bright = true;
    (el as any)._pulse = setInterval(() => {
      const dot = document.getElementById('ps-loading-dot');
      if (dot) { dot.style.opacity = bright ? '1' : '0.2'; bright = !bright; }
    }, 500);
  }
  el.style.display = 'flex';
}

function hideLoadingOverlay(): void {
  const el = document.getElementById('ps-loading') as any;
  if (!el) return;
  if (el._pulse) { clearInterval(el._pulse); el._pulse = null; }
  el.style.display = 'none';
}

function showOutageOverlay(): void {
  hideLoadingOverlay();
  let el = document.getElementById('ps-outage');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ps-outage';
    // Non-blocking: pointer-events:none on the wrapper so the user can still
    // access wallet/DM/settings panels underneath if they want. The card
    // itself re-enables pointer events so its (future) close button works.
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;pointer-events:none;';
    el.innerHTML = `
      <div style="
        background:linear-gradient(180deg,#0a0a14 0%,#0f1024 100%);
        border:1px solid color-mix(in srgb,#f0b040 35%,transparent);
        box-shadow:0 12px 40px rgba(0,0,0,0.7), 0 0 24px color-mix(in srgb,#f0b040 18%,transparent);
        border-radius:10px;
        padding:18px 22px 16px;
        font-family:'Courier New',monospace;
        color:#f0e8d4;
        font-size:11.5px;line-height:1.65;
        width:min(420px,94vw);
        pointer-events:auto;
      ">
        <div style="
          color:#f0b040;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;
          font-size:11px;margin-bottom:10px;display:flex;align-items:center;gap:8px;
        ">
          <span id="ps-outage-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f0b040;"></span>
          District Server Unreachable
        </div>
        <div style="margin-bottom:8px;">
          The game world can't be reached right now. This is an issue with the presence server — <strong>not your wallet, identity, or Nostr data</strong>, all of which are unaffected.
        </div>
        <div style="color:color-mix(in srgb,#f0e8d4 65%,transparent);font-size:10.5px;">
          Auto-retrying in the background. This page will load automatically when the server comes back. You can leave the tab open.
        </div>
      </div>`;
    document.body.appendChild(el);
    let bright = true;
    (el as any)._pulse = setInterval(() => {
      const dot = document.getElementById('ps-outage-dot');
      if (dot) { dot.style.opacity = bright ? '1' : '0.25'; bright = !bright; }
    }, 600);
  }
  el.style.display = 'flex';
}

function hideOutageOverlay(): void {
  const el = document.getElementById('ps-outage') as any;
  if (!el) return;
  if (el._pulse) { clearInterval(el._pulse); el._pulse = null; }
  el.style.display = 'none';
}

function backoffDelayMs(failures: number): number {
  // 3s, 6s, 12s, 24s, capped at 30s
  const base = 3000 * Math.pow(2, Math.max(0, failures - 1));
  return Math.min(base, 30000);
}

export function getCurrentRoom(): string { return currentRoom; }
export function isPresenceReady(): boolean { return presenceReady; }

export function connectPresence(cb: PresenceCallback): void {
  if (ws) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.onclose = null;
      ws.close();
    }
    ws = null;
  }
  if (reconnectTimer)      { clearTimeout(reconnectTimer);      reconnectTimer      = null; }
  if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }

  callbacks = cb;
  presenceReady = false;

  // Once we've already failed enough times to be confident this is an outage
  // (not a brief network blip), keep the outage card up across retries instead
  // of flickering back to the CONNECTING spinner.
  if (consecutiveFailures >= OUTAGE_AFTER_FAILURES) showOutageOverlay();
  else                                              showLoadingOverlay();

  // Mark this attempt as failed if we don't successfully open within the timeout.
  // Without this, a presence server that accepts but never responds (or a DNS
  // black hole) would leave the user staring at "CONNECTING" forever.
  let opened = false;
  const fail = () => {
    if (opened) return;
    consecutiveFailures++;
    console.warn(`[Presence] Connect attempt failed (${consecutiveFailures})`);
    if (consecutiveFailures >= OUTAGE_AFTER_FAILURES) showOutageOverlay();
    try { ws?.close(); } catch { /* */ }
    ws = null;
    const delay = backoffDelayMs(consecutiveFailures);
    reconnectTimer = setTimeout(() => {
      if (callbacks) connectPresence(callbacks);
    }, delay);
  };
  connectTimeoutTimer = setTimeout(fail, CONNECT_TIMEOUT_MS);

  try {
    ws = new WebSocket(
      import.meta.env.PROD
        ? 'wss://relay.thedistrict.online'
        : 'ws://localhost:3100'
    );
  } catch (e) {
    console.warn('[Presence] Could not construct WebSocket', e);
    fail();
    return;
  }

  ws.onopen = () => {
    opened = true;
    consecutiveFailures = 0;
    if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }
    hideOutageOverlay();
    console.log('[Presence] Connected');
    presenceReady = false;
    const state = authStore.getState();
    ws!.send(JSON.stringify({
      type: 'join',
      pubkey: state.pubkey || `guest_${Math.random().toString(36).slice(2, 8)}`,
      name: state.displayName || 'guest',
      x: lastSentX || 400,
      y: lastSentY || 348,
      room: currentRoom,
      avatar: serializeAvatar(getAvatar()),
      status: getStatus(),
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'players') {
        presenceReady = true; // server has synced — room navigation now allowed
        hideLoadingOverlay();
        // Drop stale player lists that arrived after a room change
        if (!msg.room || msg.room === currentRoom) {
          msg.players.forEach((p: PlayerData) => { callbacks?.onPlayerJoin(p); });
          callbacks?.onPlayersReady?.(msg.players.length);
        }
      }
      if (msg.type === 'join') {
        // Drop join broadcasts from other rooms (race: player left before server processed our room change)
        if (!msg.room || msg.room === currentRoom) callbacks?.onPlayerJoin(msg);
      }
      if (msg.type === 'move') callbacks?.onPlayerMove(msg.pubkey, msg.x, msg.y, msg.f);
      if (msg.type === 'leave') callbacks?.onPlayerLeave(msg.pubkey);
      if (msg.type === 'count') callbacks?.onCountUpdate(msg.count);
      if (msg.type === 'chat') {
        // Allow a pre-interceptor to consume game-protocol messages before the scene sees them
        if (!chatInterceptor?.(msg.pubkey, msg.name, msg.text)) {
          callbacks?.onChat(msg.pubkey, msg.name, msg.text, msg.emojis);
        }
      }
      if (msg.type === 'avatar_update') callbacks?.onAvatarUpdate?.(msg.pubkey, msg.avatar);
      if (msg.type === 'room_config_update') callbacks?.onRoomConfigUpdate?.(msg.pubkey, msg.roomConfig);
      if (msg.type === 'name_update') callbacks?.onNameUpdate?.(msg.pubkey, msg.name);
      if (msg.type === 'status_update') callbacks?.onStatusUpdate?.(msg.pubkey, msg.status);
      if (msg.type === 'lounge_listeners' && onLoungeListeners) {
        onLoungeListeners((msg as any).listeners || {});
      }

      // Room request system — these use global handlers, not scene callbacks
      if (msg.type === 'room_request') onRoomRequest?.(msg.requesterPubkey, msg.requesterName);
      if (msg.type === 'room_granted') onRoomGranted?.(msg.ownerPubkey, msg.ownerName, msg.room, msg.roomConfig);
      if (msg.type === 'room_denied') onRoomDenied?.(msg.reason);
      if (msg.type === 'room_kick') onRoomKick?.(msg.reason);
      if (msg.type === 'online_players') { _lastOnlinePlayers = msg.players || []; onOnlinePlayers?.(msg.players); callbacks?.onOnlinePlayers?.(msg.players); }
      if (msg.type === 'zone_counts') onZoneCounts?.(msg as ZoneCounts);
      if (msg.type === 'game_msg') onGameMsg?.(msg);
      if (msg.type === 'incoming_zap') onIncomingZap?.(msg.senderPk, msg.senderName || '', Number(msg.amountSats) || 0, msg.comment || '');
      if (msg.type === 'item_minted') onItemMinted?.(msg.event);
      if (msg.type === 'fish_caught') onFishCaught?.(msg as FishCaughtMsg);
      if (msg.type === 'bounty_list') {
        if (pendingBountyList) { const cb = pendingBountyList; pendingBountyList = null; cb(msg.bounties ?? []); }
      }
      if (msg.type === 'bounty_claimed') {
        const cb = pendingBountyClaims.get(msg.bountyId);
        if (cb) { pendingBountyClaims.delete(msg.bountyId); cb({ ok: true, event: msg.event, burned: msg.burned, claimed: msg.claimed }); }
        // The reward also lands through the normal mint plumbing (inventory add).
        onItemMinted?.(msg.event);
      }
      if (msg.type === 'bounty_claim_error') {
        const cb = pendingBountyClaims.get(msg.bountyId);
        if (cb) { pendingBountyClaims.delete(msg.bountyId); cb({ ok: false, reason: msg.reason }); }
      }
      if (msg.type === 'oracle_pubkey') {
        // Just store the key — inventory loads lazily when the bazaar opens
        import('../stores/tradeItemStore').then(({ setOraclePubkey }) => setOraclePubkey(msg.pubkey));
      }
      if (msg.type === 'item_received') onItemReceived?.(msg.fromName || '', msg.event);
      if (msg.type === 'item_escrowed') {
        const cb = pendingEscrow.get(msg.instanceId);
        if (cb) { pendingEscrow.delete(msg.instanceId); cb({ ok: true }); }
      }
      if (msg.type === 'item_escrow_error') {
        const cb = pendingEscrow.get(msg.instanceId);
        if (cb) { pendingEscrow.delete(msg.instanceId); cb({ ok: false, reason: msg.reason }); }
      }
      if (msg.type === 'item_unescrowed') {
        const cb = pendingUnescrow.get(msg.instanceId);
        if (cb) { pendingUnescrow.delete(msg.instanceId); cb({ ok: true }); }
      }
      if (msg.type === 'item_unescrow_error') {
        const cb = pendingUnescrow.get(msg.instanceId);
        if (cb) { pendingUnescrow.delete(msg.instanceId); cb({ ok: false, reason: msg.reason }); }
      }
      if (msg.type === 'purchase_invoice') {
        const cb = pendingPurchaseInit.get(msg.instanceId);
        if (cb) { pendingPurchaseInit.delete(msg.instanceId); cb({ bolt11: msg.bolt11, price: Number(msg.price) || 0 }); }
      }
      if (msg.type === 'purchase_timeout') {
        const cb = pendingPurchaseInit.get(msg.instanceId);
        if (cb) { pendingPurchaseInit.delete(msg.instanceId); cb({ error: 'timeout' }); }
        else window.dispatchEvent(new CustomEvent('nd-toast', { detail: { msg: 'Payment window expired — the item was released back to the market.', color: '#f0b040', open: 'market' } }));
      }
      // ── Bid acceptance responses (seller side) ──────────────────────────
      if (msg.type === 'bid_accept_ok') {
        const cb = pendingAcceptBid.get(msg.instanceId);
        if (cb) { pendingAcceptBid.delete(msg.instanceId); cb({ ok: true }); }
      }
      if (msg.type === 'accept_bid_error') {
        const cb = pendingAcceptBid.get(msg.instanceId);
        if (cb) { pendingAcceptBid.delete(msg.instanceId); cb({ ok: false, reason: msg.reason }); }
      }
      if (msg.type === 'win_declined') {
        const cb = pendingDeclineWin.get(msg.instanceId);
        if (cb) { pendingDeclineWin.delete(msg.instanceId); cb({ ok: true }); }
      }
      if (msg.type === 'decline_win_error') {
        const cb = pendingDeclineWin.get(msg.instanceId);
        if (cb) { pendingDeclineWin.delete(msg.instanceId); cb({ ok: false, reason: msg.reason }); }
      }
      if (msg.type === 'sold_list' && Array.isArray(msg.ids)) {
        import('../stores/tradeItemStore').then(({ markSoldInstances }) => markSoldInstances(msg.ids));
      }
      if (msg.type === 'item_sold' && typeof msg.instanceId === 'string') {
        import('../stores/tradeItemStore').then(({ markSoldInstances }) => markSoldInstances([msg.instanceId]));
        // Lets the invoice QR modal auto-close when ITS purchase settles
        window.dispatchEvent(new CustomEvent('nd-item-sold', { detail: { instanceId: msg.instanceId } }));
      }
      if (msg.type === 'reserved_list' && Array.isArray(msg.ids)) {
        import('../stores/tradeItemStore').then(({ markReserved }) => markReserved(msg.ids, true));
      }
      if (msg.type === 'burned_list' && Array.isArray(msg.ids)) {
        import('../stores/tradeItemStore').then(({ markBurnedInstances }) => markBurnedInstances(msg.ids, true));
      }
      if (msg.type === 'item_burned' && typeof msg.instanceId === 'string') {
        import('../stores/tradeItemStore').then(({ markBurnedInstances }) => markBurnedInstances([msg.instanceId]));
      }
      if (msg.type === 'item_reserved' && typeof msg.instanceId === 'string') {
        import('../stores/tradeItemStore').then(({ markReserved }) => markReserved([msg.instanceId]));
      }
      if (msg.type === 'item_unreserved' && typeof msg.instanceId === 'string') {
        import('../stores/tradeItemStore').then(({ markUnreserved }) => markUnreserved([msg.instanceId]));
      }
      if (msg.type === 'item_purchase_error') {
        // If a purchase-init is still pending, this is a PRE-payment failure —
        // route it to the caller quietly (no scary "you paid" toast).
        const pending = pendingPurchaseInit.get(msg.instanceId);
        if (pending) { pendingPurchaseInit.delete(msg.instanceId); pending({ error: msg.reason || 'error' }); }
        else {
          // No pending init → failure happened AFTER payment (during release).
          const reasons: Record<string, string> = {
            item_gone: 'The item could not be found to release.',
            transfer_failed: 'The transfer could not be completed.',
          };
          const why = reasons[msg.reason as string] ?? 'The transfer could not be completed.';
          window.dispatchEvent(new CustomEvent('nd-toast', {
            detail: { msg: `Purchase issue: ${why} Your payment went through — contact the seller if needed.`, color: '#f0b040' },
          }));
        }
      }
    } catch (e) {}
  };

  ws.onerror = () => {
    // onerror always precedes onclose; let onclose drive the recovery logic.
    console.warn('[Presence] WebSocket error');
  };

  ws.onclose = () => {
    console.log('[Presence] Disconnected');
    if (connectTimeoutTimer) { clearTimeout(connectTimeoutTimer); connectTimeoutTimer = null; }
    if (!opened) {
      // Closed before we ever opened — count as a failed connect and back off.
      fail();
      return;
    }
    // Was connected, then dropped. Treat as a fresh failure cycle for backoff,
    // but only show the outage UI after we miss multiple reconnects in a row.
    if (callbacks) {
      callbacks.onDisconnect?.();
      consecutiveFailures++;
      if (consecutiveFailures >= OUTAGE_AFTER_FAILURES) showOutageOverlay();
      const delay = backoffDelayMs(consecutiveFailures);
      reconnectTimer = setTimeout(() => {
        if (callbacks) connectPresence(callbacks);
      }, delay);
    }
  };
}

export function setPresenceCallbacks(cb: PresenceCallback): void {
  callbacks = cb;
}

// ── Room request system ──

export function setRoomRequestHandler(handler: RoomRequestHandler | null): void { onRoomRequest = handler; }
export function setRoomGrantedHandler(handler: RoomGrantedHandler | null): RoomGrantedHandler | null { const prev = onRoomGranted; onRoomGranted = handler; return prev; }
export function setRoomDeniedHandler(handler: RoomDeniedHandler | null): RoomDeniedHandler | null { const prev = onRoomDenied; onRoomDenied = handler; return prev; }
export function setRoomKickHandler(handler: RoomKickHandler | null): void { onRoomKick = handler; }
export function setZoneCountsHandler(handler: ZoneCountsHandler | null): void { onZoneCounts = handler; }

export function requestZoneCounts(): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'zone_counts' }));
}
export function setOnlinePlayersHandler(handler: OnlinePlayersHandler | null): void { onOnlinePlayers = handler; }
export function clearRoomRequestHandler(handler: RoomRequestHandler | null): void {
  if (onRoomRequest === handler) onRoomRequest = null;
}
export function clearRoomGrantedHandler(handler: RoomGrantedHandler | null): void {
  if (onRoomGranted === handler) onRoomGranted = null;
}
export function clearRoomDeniedHandler(handler: RoomDeniedHandler | null): void {
  if (onRoomDenied === handler) onRoomDenied = null;
}
export function clearRoomKickHandler(handler: RoomKickHandler | null): void {
  if (onRoomKick === handler) onRoomKick = null;
}

/** Request to enter someone's myroom */
export function sendRoomRequest(ownerPubkey: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'room_request', ownerPubkey }));
  }
}

/** Respond to a room request (owner accepts/denies) */
export function sendRoomResponse(requesterPubkey: string, accepted: boolean, roomConfig?: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'room_response', requesterPubkey, accepted, roomConfig }));
  }
}

/** Request list of online players */
export function requestOnlinePlayers(): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'online_players' }));
  }
}

// ── Existing sends ──

export function sendPosition(x: number, y: number, facingRight?: boolean): void {
  if (Math.abs(x - lastSentX) < 2 && Math.abs(y - lastSentY) < 2) return;
  lastSentX = x;
  lastSentY = y;
  if (ws?.readyState === WebSocket.OPEN) {
    const msg: Record<string, unknown> = { type: 'move', x, y };
    if (facingRight !== undefined) msg.f = facingRight ? 1 : 0;
    ws.send(JSON.stringify(msg));
  }
}

export function sendChat(text: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    const emojis = extractEmojiTags(text);
    ws.send(JSON.stringify({ type: 'chat', text, ...(emojis.length ? { emojis } : {}) }));
  }
}

export function sendRoomChange(room: string, x?: number, y?: number): void {
  if (!presenceReady) return; // block until server has confirmed initial player sync
  if (ws?.readyState === WebSocket.OPEN) {
    currentRoom = room;
    ws.send(JSON.stringify({ type: 'room', room, x: x || 400, y: y || 348, avatar: serializeAvatar(getAvatar()) }));
  }
}

export function sendAvatarUpdate(): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'avatar_update', avatar: serializeAvatar(getAvatar()) }));
  }
}

/**
 * Push the room owner's new RoomConfig JSON to every other player currently
 * inside the owner's myroom. Server forwards via `room_config_update` and
 * subscribers re-render furniture / walls / floors / pet without a scene
 * restart. Fires from RoomTab Save and arrange-mode exit.
 */
export function sendRoomConfigUpdate(roomConfig: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'room_config_update', roomConfig }));
  }
}

export function sendNameUpdate(name: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'name_update', name }));
  }
}

export function sendStatusUpdate(status: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'status_update', status }));
  }
}

/**
 * Lounge-only: tell the server which live stream we're listening to (or
 * null to clear). The server tracks this per-player and broadcasts a
 * `lounge_listeners` message to every lounge visitor so each client can
 * show listener counts in the stream picker.
 */
export function sendLoungeListening(streamKey: string | null): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'lounge_listening_update', streamKey }));
  }
}

type LoungeListenersHandler = (listeners: Record<string, string>) => void;
let onLoungeListeners: LoungeListenersHandler | null = null;
export function setLoungeListenersHandler(fn: LoungeListenersHandler | null): void {
  onLoungeListeners = fn;
}

export function disconnectPresence(): void {
  presenceReady = false;
  callbacks = null;
  onRoomRequest = null;
  onRoomGranted = null;
  onRoomDenied = null;
  onRoomKick = null;
  onOnlinePlayers = null;
  onZoneCounts = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}
