import { authStore } from '../stores/authStore';
import { getAvatar, serializeAvatar } from '../stores/avatarStore';

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
  onPlayerMove: (pubkey: string, x: number, y: number) => void;
  onPlayerLeave: (pubkey: string) => void;
  onCountUpdate: (count: number) => void;
  onChat: (pubkey: string, name: string, text: string) => void;
  onAvatarUpdate?: (pubkey: string, avatar: string) => void;
  onNameUpdate?: (pubkey: string, name: string) => void;
  onStatusUpdate?: (pubkey: string, status: string) => void;
};

// Global callbacks for room request system — persist across scene changes
type RoomRequestHandler = (requesterPubkey: string, requesterName: string) => void;
type RoomGrantedHandler = (ownerPubkey: string, ownerName: string, room: string, roomConfig?: string) => void;
type RoomDeniedHandler = (reason: string) => void;
type RoomKickHandler = (reason: string) => void;
type OnlinePlayersHandler = (players: { pubkey: string; name: string }[]) => void;

let onRoomRequest: RoomRequestHandler | null = null;
let onRoomGranted: RoomGrantedHandler | null = null;
let onRoomDenied: RoomDeniedHandler | null = null;
let onRoomKick: RoomKickHandler | null = null;
let onOnlinePlayers: OnlinePlayersHandler | null = null;

let ws: WebSocket | null = null;
let callbacks: PresenceCallback | null = null;
let lastSentX = 0;
let lastSentY = 0;

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
    const state = authStore.getState();
    ws!.send(JSON.stringify({
      type: 'join',
      pubkey: state.pubkey || `guest_${Math.random().toString(36).slice(2, 8)}`,
      name: state.displayName || 'guest',
      x: 400,
      y: 348,
      room: 'hub',
      avatar: serializeAvatar(getAvatar()),
      status: localStorage.getItem('nd_status') || '',
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'players') {
        msg.players.forEach((p: PlayerData) => { callbacks?.onPlayerJoin(p); });
      }
      if (msg.type === 'join') callbacks?.onPlayerJoin(msg);
      if (msg.type === 'move') callbacks?.onPlayerMove(msg.pubkey, msg.x, msg.y);
      if (msg.type === 'leave') callbacks?.onPlayerLeave(msg.pubkey);
      if (msg.type === 'count') callbacks?.onCountUpdate(msg.count);
      if (msg.type === 'chat') callbacks?.onChat(msg.pubkey, msg.name, msg.text);
      if (msg.type === 'avatar_update') callbacks?.onAvatarUpdate?.(msg.pubkey, msg.avatar);
      if (msg.type === 'name_update') callbacks?.onNameUpdate?.(msg.pubkey, msg.name);
      if (msg.type === 'status_update') callbacks?.onStatusUpdate?.(msg.pubkey, msg.status);

      // Room request system — these use global handlers, not scene callbacks
      if (msg.type === 'room_request') onRoomRequest?.(msg.requesterPubkey, msg.requesterName);
      if (msg.type === 'room_granted') onRoomGranted?.(msg.ownerPubkey, msg.ownerName, msg.room, msg.roomConfig);
      if (msg.type === 'room_denied') onRoomDenied?.(msg.reason);
      if (msg.type === 'room_kick') onRoomKick?.(msg.reason);
      if (msg.type === 'online_players') onOnlinePlayers?.(msg.players);
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
export function setOnlinePlayersHandler(handler: OnlinePlayersHandler | null): void { onOnlinePlayers = handler; }

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

export function sendPosition(x: number, y: number): void {
  if (Math.abs(x - lastSentX) < 2 && Math.abs(y - lastSentY) < 2) return;
  lastSentX = x;
  lastSentY = y;
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'move', x, y }));
  }
}

export function sendChat(text: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat', text }));
  }
}

export function sendRoomChange(room: string, x?: number, y?: number): void {
  if (ws?.readyState === WebSocket.OPEN) {
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
  callbacks = null;
  onRoomRequest = null;
  onRoomGranted = null;
  onRoomDenied = null;
  onRoomKick = null;
  onOnlinePlayers = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}