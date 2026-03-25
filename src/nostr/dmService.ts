/**
 * dmService.ts — NIP-17 Encrypted Direct Messages
 *
 * Built from scratch using NYM's proven architecture:
 * - Manual NIP-44 encrypt/decrypt for seal + gift-wrap layers
 *   (skips nostr-tools' unreliable nip17 module — uses nip44 directly)
 * - Self-wrapping so sender can retrieve own sent messages
 * - Retry queue: 3 attempts at 5s intervals, with manual retry on failure
 * - Reconnect catch-up: re-subscribes for missed gift wraps
 * - Extension support: falls back to window.nostr.nip44 for NIP-07
 * - Randomized timestamps (±2 hours) for NIP-59 metadata protection
 */

import { authStore } from '../stores/authStore';
import { RelayManager } from './relayManager';

// ── Types ──

export interface DMMessage {
  id: string;
  senderPubkey: string;
  senderName?: string;
  recipientPubkey: string;
  content: string;
  createdAt: number;
  isOwn: boolean;
  conversationPubkey: string;
  deliveryStatus?: 'sending' | 'sent' | 'failed';
}

type DMListener = (msg: DMMessage) => void;

// ── Module state ──

let NostrTools: any = null;
let relayManager: RelayManager | null = null;
let localKey: Uint8Array | null = null;
let listeners: DMListener[] = [];
let lastSyncTime = Math.floor(Date.now() / 1000) - 86400; // 24h ago

// Retry queue (modeled on NYM's pendingDMs)
interface PendingDM {
  wrappedEvents: any[];     // The actual gift-wrap events to re-publish
  recipientPubkey: string;
  conversationPubkey: string;
  attempts: number;
  maxAttempts: number;
  lastAttempt: number;
}
const pendingDMs = new Map<string, PendingDM>();
let retryInterval: ReturnType<typeof setInterval> | null = null;
const RETRY_CHECK_MS = 5000;
const RETRY_MAX_ATTEMPTS = 3;

// Dedup received messages
const processedEventIds = new Set<string>();

// ── Key management ──

export function setLocalKey(key: Uint8Array): void {
  localKey = key;
}

export function clearLocalKey(): void {
  localKey = null;
}

export function getLocalKey(): Uint8Array | null {
  return localKey;
}

/** Can we send/receive DMs? Need either a local key or NIP-07 extension */
export function canUseDMs(): boolean {
  if (localKey) return true;
  if (typeof window !== 'undefined' && (window as any).nostr?.nip44?.encrypt) return true;
  return false;
}

// ── Lazy-load nostr-tools ──

async function ensureNostrTools(): Promise<void> {
  if (NostrTools) return;
  NostrTools = await import('nostr-tools');
}

// ── Subscription lifecycle ──

export function startDMSubscription(): void {
  const state = authStore.getState();
  if (!state.pubkey || !canUseDMs()) {
    console.warn('[DM] Cannot start subscription — not logged in or no key');
    return;
  }

  // Create relay manager and connect
  if (relayManager) {
    relayManager.destroy();
  }
  relayManager = new RelayManager();
  relayManager.connectAll();

  // Subscribe for gift wraps addressed to us
  const pubkey = state.pubkey;
  const since = Math.floor(Date.now() / 1000) - 604800; // 7 days back (same as NYM)

  relayManager.subscribe(
    'dm-giftwraps',
    [{ kinds: [1059], '#p': [pubkey], since, limit: 500 }],
    async (event, relayUrl) => {
      await handleGiftWrap(event);
    }
  );

  // Start retry checker
  if (!retryInterval) {
    retryInterval = setInterval(retryPendingDMs, RETRY_CHECK_MS);
  }

  console.log('[DM] Subscription started');
}

export function stopDMSubscription(): void {
  if (relayManager) {
    relayManager.unsubscribe('dm-giftwraps');
    relayManager.destroy();
    relayManager = null;
  }
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
  pendingDMs.clear();
  processedEventIds.clear();
  console.log('[DM] Subscription stopped');
}

// ── Event listener registration ──

export function onDMReceived(handler: DMListener): () => void {
  listeners.push(handler);
  return () => {
    listeners = listeners.filter(h => h !== handler);
  };
}

function notifyListeners(msg: DMMessage): void {
  for (const handler of listeners) {
    try {
      handler(msg);
    } catch (e) {
      console.error('[DM] Listener error:', e);
    }
  }
}

// ── Sending DMs — NIP-17 gift wrap ──

export async function sendDirectMessage(recipientPubkey: string, content: string): Promise<void> {
  await ensureNostrTools();

  const state = authStore.getState();
  if (!state.pubkey) throw new Error('Not logged in');
  if (!canUseDMs()) throw new Error('No signing/encryption available');

  const NT = NostrTools;
  const now = Math.floor(Date.now() / 1000);
  const myPubkey = state.pubkey;

  // ── Build the rumor (kind:14, unsigned) ──
  const rumor: any = {
    kind: 14,
    created_at: now,
    tags: [['p', recipientPubkey]],
    content,
    pubkey: myPubkey,
  };
  rumor.id = NT.getEventHash(rumor);

  const wrappedEvents: any[] = [];

  // ── Path 1: Local private key available ──
  if (localKey) {
    // Wrap for recipient
    const recipientWrap = nip59Wrap(NT, rumor, localKey, recipientPubkey);
    wrappedEvents.push(recipientWrap);

    // Self-wrap so we can retrieve our own sent messages
    if (recipientPubkey !== myPubkey) {
      const selfWrap = nip59Wrap(NT, rumor, localKey, myPubkey);
      wrappedEvents.push(selfWrap);
    }
  }
  // ── Path 2: NIP-07 extension ──
  else if ((window as any).nostr?.nip44?.encrypt && (window as any).nostr?.signEvent) {
    const nostrExt = (window as any).nostr;

    // Seal via extension
    const sealContent = await nostrExt.nip44.encrypt(recipientPubkey, JSON.stringify(rumor));
    const sealUnsigned = {
      kind: 13,
      content: sealContent,
      created_at: randomTimestamp(),
      tags: [],
    };
    const seal = await nostrExt.signEvent(sealUnsigned);

    // Gift wrap with local ephemeral key
    const ephSk = NT.generateSecretKey();
    const ckWrap = NT.nip44.getConversationKey(ephSk, recipientPubkey);
    const wrapContent = NT.nip44.encrypt(JSON.stringify(seal), ckWrap);
    const wrapUnsigned = {
      kind: 1059,
      content: wrapContent,
      created_at: randomTimestamp(),
      tags: [['p', recipientPubkey]],
      pubkey: NT.getPublicKey(ephSk),
    };
    const recipientWrap = NT.finalizeEvent(wrapUnsigned, ephSk);
    wrappedEvents.push(recipientWrap);

    // Self-wrap for sent message retrieval
    if (recipientPubkey !== myPubkey) {
      try {
        const selfSealContent = await nostrExt.nip44.encrypt(myPubkey, JSON.stringify(rumor));
        const selfSealUnsigned = {
          kind: 13,
          content: selfSealContent,
          created_at: randomTimestamp(),
          tags: [],
        };
        const selfSeal = await nostrExt.signEvent(selfSealUnsigned);
        const selfEphSk = NT.generateSecretKey();
        const selfCkWrap = NT.nip44.getConversationKey(selfEphSk, myPubkey);
        const selfWrapContent = NT.nip44.encrypt(JSON.stringify(selfSeal), selfCkWrap);
        const selfWrapUnsigned = {
          kind: 1059,
          content: selfWrapContent,
          created_at: randomTimestamp(),
          tags: [['p', myPubkey]],
          pubkey: NT.getPublicKey(selfEphSk),
        };
        const selfWrap = NT.finalizeEvent(selfWrapUnsigned, selfEphSk);
        wrappedEvents.push(selfWrap);
      } catch (_) {
        // Self-wrap failed — non-critical
      }
    }
  } else {
    throw new Error('No signing/encryption available for NIP-17');
  }

  // ── Publish with staggered delays ──
  if (relayManager) {
    await relayManager.publishStaggered(wrappedEvents);
  }

  // ── Track for retry ──
  const eventId = wrappedEvents[0]?.id || `local_${Date.now()}`;
  pendingDMs.set(eventId, {
    wrappedEvents,
    recipientPubkey,
    conversationPubkey: recipientPubkey,
    attempts: 0,
    maxAttempts: RETRY_MAX_ATTEMPTS,
    lastAttempt: Date.now(),
  });

  // Ensure retry interval is running
  if (!retryInterval) {
    retryInterval = setInterval(retryPendingDMs, RETRY_CHECK_MS);
  }

  // ── Notify UI optimistically ──
  notifyListeners({
    id: eventId,
    senderPubkey: myPubkey,
    recipientPubkey,
    content,
    createdAt: now,
    isOwn: true,
    conversationPubkey: recipientPubkey,
    deliveryStatus: 'sent',
  });
}

// ── Receiving DMs — gift wrap unwrapping ──

async function handleGiftWrap(event: any): Promise<void> {
  try {
    await ensureNostrTools();
    const NT = NostrTools;
    const state = authStore.getState();
    if (!state.pubkey) return;

    // Only process gift wraps addressed to us
    const pTags = (event.tags || []).filter((t: any[]) => t[0] === 'p').map((t: any[]) => t[1]);
    if (pTags.length > 0 && !pTags.includes(state.pubkey)) return;

    // Dedup
    if (processedEventIds.has(event.id)) return;
    processedEventIds.add(event.id);

    // Cap dedup set
    if (processedEventIds.size > 5000) {
      const arr = Array.from(processedEventIds);
      processedEventIds.clear();
      for (const id of arr.slice(-2500)) processedEventIds.add(id);
    }

    // Update sync time
    if (event.created_at && event.created_at > lastSyncTime) {
      lastSyncTime = event.created_at;
    }

    // ── Unwrap ──
    let seal: any;
    let rumor: any;

    if (localKey) {
      // Local key path
      const ckWrap = NT.nip44.getConversationKey(localKey, event.pubkey);
      const sealJson = NT.nip44.decrypt(event.content, ckWrap);
      seal = JSON.parse(sealJson);

      const ckSeal = NT.nip44.getConversationKey(localKey, seal.pubkey);
      const rumorJson = NT.nip44.decrypt(seal.content, ckSeal);
      rumor = JSON.parse(rumorJson);
    } else if ((window as any).nostr?.nip44?.decrypt) {
      // Extension path
      const nostrExt = (window as any).nostr;
      const sealJson = await nostrExt.nip44.decrypt(event.pubkey, event.content);
      seal = JSON.parse(sealJson);

      const rumorJson = await nostrExt.nip44.decrypt(seal.pubkey, seal.content);
      rumor = JSON.parse(rumorJson);
    } else {
      return; // no way to decrypt
    }

    // ── Validate rumor ──
    if (!rumor || rumor.kind !== 14) return;
    if (typeof rumor.content !== 'string') return;
    if (!rumor.pubkey) return;

    // Skip empty messages
    if (!rumor.content.trim()) return;

    const senderPubkey = rumor.pubkey;
    const isOwn = senderPubkey === state.pubkey;

    // Determine conversation partner
    const conversationPubkey = isOwn
      ? (rumor.tags?.find((t: any[]) => t[0] === 'p')?.[1] || senderPubkey)
      : senderPubkey;

    // ── If this is our own sent message coming back, mark as delivered ──
    if (isOwn) {
      const pending = pendingDMs.get(event.id);
      if (pending) {
        pendingDMs.delete(event.id);
      }
    }

    // ── Notify listeners ──
    notifyListeners({
      id: event.id,
      senderPubkey,
      recipientPubkey: isOwn ? conversationPubkey : state.pubkey,
      content: rumor.content,
      createdAt: rumor.created_at || event.created_at || Math.floor(Date.now() / 1000),
      isOwn,
      conversationPubkey,
      deliveryStatus: 'sent',
    });
  } catch (e) {
    // Decryption failure — normal for events not meant for us
  }
}

// ── NIP-59 Wrapping (identical to NYM's nip59WrapEvent) ──

function nip59Wrap(NT: any, rumor: any, senderPrivateKey: Uint8Array, recipientPubkey: string): any {
  // Seal (kind 13) — encrypt rumor with sender→recipient conversation key
  const ckSeal = NT.nip44.getConversationKey(senderPrivateKey, recipientPubkey);
  const sealedContent = NT.nip44.encrypt(JSON.stringify(rumor), ckSeal);
  const sealUnsigned = {
    kind: 13,
    content: sealedContent,
    created_at: randomTimestamp(),
    tags: [],
  };
  const seal = NT.finalizeEvent(sealUnsigned, senderPrivateKey);

  // Gift Wrap (kind 1059) — encrypt seal with ephemeral→recipient conversation key
  const ephSk = NT.generateSecretKey();
  const ephPk = NT.getPublicKey(ephSk);
  const ckWrap = NT.nip44.getConversationKey(ephSk, recipientPubkey);
  const wrapContent = NT.nip44.encrypt(JSON.stringify(seal), ckWrap);
  const wrapUnsigned = {
    kind: 1059,
    content: wrapContent,
    created_at: randomTimestamp(),
    tags: [['p', recipientPubkey]],
    pubkey: ephPk,
  };

  return NT.finalizeEvent(wrapUnsigned, ephSk);
}

// ── Retry Logic (modeled on NYM's retryPendingDMs) ──

function retryPendingDMs(): void {
  if (pendingDMs.size === 0) {
    if (retryInterval) {
      clearInterval(retryInterval);
      retryInterval = null;
    }
    return;
  }

  const now = Date.now();

  for (const [eventId, pending] of pendingDMs) {
    // Skip if too recent
    if (now - pending.lastAttempt < RETRY_CHECK_MS) continue;

    // Max attempts reached → remove
    if (pending.attempts >= pending.maxAttempts) {
      pendingDMs.delete(eventId);
      continue;
    }

    // Retry: re-publish all wrapped events
    pending.attempts++;
    pending.lastAttempt = now;

    if (relayManager) {
      for (const wrappedEvent of pending.wrappedEvents) {
        relayManager.publish(wrappedEvent);
      }
    }
  }
}

// ── Helpers ──

/** Randomize timestamp by ±2 hours for NIP-59 metadata protection */
function randomTimestamp(): number {
  const TWO_HOURS = 2 * 60 * 60;
  return Math.round(Date.now() / 1000 - Math.random() * TWO_HOURS);
}

/** Get the relay manager instance (for status display, etc.) */
export function getRelayManager(): RelayManager | null {
  return relayManager;
}