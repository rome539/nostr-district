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
  console.log('[Zap] sendIncomingZapPing called', {
    recipientPk: recipientPk.slice(0, 16),
    amountSats,
    comment,
    wsOpen: ws?.readyState === WebSocket.OPEN,
  });
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'incoming_zap', recipientPk, amountSats, comment }));
  }
}

// Returns true to consume the message (skip scene onChat), false to pass through
type ChatInterceptor = (pubkey: string, name: string, text: string) => boolean;
let chatInterceptor: ChatInterceptor | null = null;

export function setChatInterceptor(fn: ChatInterceptor | null): void { chatInterceptor = fn; }

let onRoomRequest: RoomRequestHandler | null = null;
let onRoomGranted: RoomGrantedHandler | null = null;
let onRoomDenied: RoomDeniedHandler | null = null;
let onRoomKick: RoomKickHandler | null = null;
let onOnlinePlayers: OnlinePlayersHandler | null = null;
let onZoneCounts: ZoneCountsHandler | null = null;

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
      if (msg.type === 'online_players') { onOnlinePlayers?.(msg.players); callbacks?.onOnlinePlayers?.(msg.players); }
      if (msg.type === 'zone_counts') onZoneCounts?.(msg as ZoneCounts);
      if (msg.type === 'game_msg') onGameMsg?.(msg);
      if (msg.type === 'incoming_zap') onIncomingZap?.(msg.senderPk, msg.senderName || '', Number(msg.amountSats) || 0, msg.comment || '');
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
