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
  onNameUpdate?: (pubkey: string, name: string) => void;
  onStatusUpdate?: (pubkey: string, status: string) => void;
  onOnlinePlayers?: (players: { pubkey: string; name: string; room: string }[]) => void;
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

  callbacks = cb;

  try {
    ws = new WebSocket(
  import.meta.env.PROD
    ? 'wss://nostr-district-production.up.railway.app'
    : 'ws://localhost:3100'
);
  } catch (e) {
    console.warn('[Presence] Could not connect to server');
    return;
  }

  ws.onopen = () => {
    console.log('[Presence] Connected');
    presenceReady = false;
    const state = authStore.getState();
    ws!.send(JSON.stringify({
      type: 'join',
      pubkey: state.pubkey || `guest_${Math.random().toString(36).slice(2, 8)}`,
      name: state.displayName || 'guest',
      x: 400,
      y: 348,
      room: 'hub',
      avatar: serializeAvatar(getAvatar()),
      status: getStatus(),
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'players') {
        presenceReady = true; // server has synced — room navigation now allowed
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
      if (msg.type === 'chat') callbacks?.onChat(msg.pubkey, msg.name, msg.text, msg.emojis);
      if (msg.type === 'avatar_update') callbacks?.onAvatarUpdate?.(msg.pubkey, msg.avatar);
      if (msg.type === 'name_update') callbacks?.onNameUpdate?.(msg.pubkey, msg.name);
      if (msg.type === 'status_update') callbacks?.onStatusUpdate?.(msg.pubkey, msg.status);

      // Room request system — these use global handlers, not scene callbacks
      if (msg.type === 'room_request') onRoomRequest?.(msg.requesterPubkey, msg.requesterName);
      if (msg.type === 'room_granted') onRoomGranted?.(msg.ownerPubkey, msg.ownerName, msg.room, msg.roomConfig);
      if (msg.type === 'room_denied') onRoomDenied?.(msg.reason);
      if (msg.type === 'room_kick') onRoomKick?.(msg.reason);
      if (msg.type === 'online_players') { onOnlinePlayers?.(msg.players); callbacks?.onOnlinePlayers?.(msg.players); }
      if (msg.type === 'zone_counts') onZoneCounts?.(msg as ZoneCounts);
    } catch (e) {}
  };

  ws.onclose = () => {
    console.log('[Presence] Disconnected');
    if (callbacks) {
      setTimeout(() => {
        if (callbacks) connectPresence(callbacks);
      }, 3000);
    }
  };
}

export function setPresenceCallbacks(cb: PresenceCallback): void {
  callbacks = cb;
}

// ── Room request system ──

export function setRoomRequestHandler(handler: RoomRequestHandler | null): void { onRoomRequest = handler; }
export function setRoomGrantedHandler(handler: RoomGrantedHandler | null): void { onRoomGranted = handler; }
export function setRoomDeniedHandler(handler: RoomDeniedHandler | null): void { onRoomDenied = handler; }
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
