/**
 * channelService.ts — NIP-28 Room Chat (kind:20000)
 *
 * Uses NYM's channel message format for interoperability:
 * - kind: 20000 (ephemeral channel message)
 * - 'g' tag: channel identifier (e.g. 'nostr-district:relay')
 * - 'n' tag: sender nickname
 * - 'client' tag: 'nostr-district'
 *
 * Subscribes to a room channel on enter, unsubscribes on leave.
 * Uses the existing relay connections from the DM relay manager.
 */

import { authStore } from '../stores/authStore';
import { DM_RELAYS } from './relayManager';

// ── Types ──

export interface ChannelMessage {
  id: string;
  pubkey: string;
  name: string;
  content: string;
  createdAt: number;
  channel: string;
  isOwn: boolean;
}

type ChannelListener = (msg: ChannelMessage) => void;

// ── State ──

let NostrTools: any = null;
let pool: any = null;
let currentChannel: string | null = null;
let currentSub: { close: () => void } | null = null;
let listeners: ChannelListener[] = [];
let localKey: Uint8Array | null = null;
const processedIds = new Set<string>();

// Channel prefix so our rooms don't collide with other apps
const CHANNEL_PREFIX = 'nostr-district:';

// ── Setup ──

async function ensurePool(): Promise<void> {
  if (pool) return;
  if (!NostrTools) {
    NostrTools = await import('nostr-tools');
  }
  const { SimplePool } = await import('nostr-tools/pool');
  pool = new SimplePool();
}

/** Set the signing key (called from nostrService on login) */
export function setChannelKey(key: Uint8Array): void {
  localKey = key;
}

export function clearChannelKey(): void {
  localKey = null;
}

// ── Listener registration ──

export function onChannelMessage(handler: ChannelListener): () => void {
  listeners.push(handler);
  return () => {
    listeners = listeners.filter(h => h !== handler);
  };
}

function notifyListeners(msg: ChannelMessage): void {
  for (const handler of listeners) {
    try { handler(msg); } catch (_) {}
  }
}

// ── Subscribe / Unsubscribe ──

/** Join a room channel — subscribes to kind:20000 messages with matching g tag */
export async function joinChannel(roomId: string): Promise<void> {
  // Leave current channel first
  leaveChannel();

  await ensurePool();

  currentChannel = CHANNEL_PREFIX + roomId;
  const since = Math.floor(Date.now() / 1000) - 3600; // last hour of history

  currentSub = pool.subscribeMany(
    DM_RELAYS,
    [{ kinds: [20000], '#g': [currentChannel], since, limit: 100 }],
    {
      onevent: (event: any) => {
        handleChannelEvent(event);
      },
      oneose: () => {},
    }
  );

  console.log(`[Channel] Joined ${currentChannel}`);
}

/** Leave the current room channel */
export function leaveChannel(): void {
  if (currentSub) {
    try { currentSub.close(); } catch (_) {}
    currentSub = null;
  }
  if (currentChannel) {
    console.log(`[Channel] Left ${currentChannel}`);
  }
  currentChannel = null;
  processedIds.clear();
}

// ── Publish ──

/** Send a message to the current room channel */
export async function sendChannelMessage(content: string): Promise<void> {
  if (!currentChannel) throw new Error('Not in a channel');

  await ensurePool();

  const state = authStore.getState();
  if (!state.pubkey) throw new Error('Not logged in');

  const now = Math.floor(Date.now() / 1000);
  const name = state.displayName || 'anon';

  const eventUnsigned: any = {
    kind: 20000,
    created_at: now,
    tags: [
      ['g', currentChannel],
      ['n', name],
      ['client', 'Nostr District'],
    ],
    content,
    pubkey: state.pubkey,
  };

  let signedEvent: any;

  if (localKey) {
    // Sign with local key
    signedEvent = NostrTools.finalizeEvent(eventUnsigned, localKey);
  } else if ((window as any).nostr?.signEvent) {
    // Sign with extension
    signedEvent = await (window as any).nostr.signEvent(eventUnsigned);
  } else {
    throw new Error('No signing method available');
  }

  // Publish to relays
  try {
    const pubs = pool.publish(DM_RELAYS, signedEvent);
    await Promise.allSettled(pubs);
  } catch (_) {}

  // Show optimistically (don't wait for relay echo)
  notifyListeners({
    id: signedEvent.id,
    pubkey: state.pubkey,
    name,
    content,
    createdAt: now,
    channel: currentChannel,
    isOwn: true,
  });
}

// ── Event handling ──

function handleChannelEvent(event: any): void {
  // Dedup
  if (processedIds.has(event.id)) return;
  processedIds.add(event.id);
  if (processedIds.size > 2000) {
    const arr = Array.from(processedIds);
    processedIds.clear();
    for (const id of arr.slice(-1000)) processedIds.add(id);
  }

  // Extract tags
  const gTag = event.tags?.find((t: any[]) => t[0] === 'g');
  const nTag = event.tags?.find((t: any[]) => t[0] === 'n');
  const channel = gTag?.[1] || '';
  const name = nTag?.[1] || event.pubkey?.slice(0, 8) || 'anon';

  // Only process messages for our current channel
  if (channel !== currentChannel) return;

  // Skip empty
  if (!event.content?.trim()) return;

  const state = authStore.getState();
  const isOwn = event.pubkey === state.pubkey;

  // Skip own messages (already shown optimistically)
  if (isOwn) return;

  notifyListeners({
    id: event.id,
    pubkey: event.pubkey,
    name,
    content: event.content,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
    channel,
    isOwn: false,
  });
}

/** Get the current channel name (for UI display) */
export function getCurrentChannel(): string | null {
  return currentChannel;
}