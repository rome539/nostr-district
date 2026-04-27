import { authStore } from '../stores/authStore';
import { setLocalKey, clearLocalKey, getLocalKey } from './dmService';
import { setChannelKey, clearChannelKey } from './channelService';
import { initNWC, clearNWCCache } from './nwcService';
import { DEFAULT_RELAYS } from './relayManager';
import type { RoomConfig } from '../stores/roomStore';
import { applyRemoteRoomConfig } from '../stores/roomStore';
import type { AvatarConfig, OutfitPreset } from '../stores/avatarStore';
import { applyRemoteAvatar, applyRemoteOutfits } from '../stores/avatarStore';
// @ts-ignore — JS module, no types
import { BunkerClient, renderQR } from '../../nip46-bunker.js';

let NostrTools: any = null;
let pool: any = null;
let bunkerClient: any = null;

const RELAYS = DEFAULT_RELAYS.slice(0, 6);

export async function loadNostrTools(): Promise<void> {
  if (NostrTools) return;
  NostrTools = await import('nostr-tools');
  const { SimplePool } = await import('nostr-tools/pool');
  pool = new SimplePool();
  const nip44 = await import('nostr-tools/nip44');
  (globalThis as any).__nip44mod = nip44;
}

export async function fetchProfile(pubkey: string): Promise<any> {
  if (!pool) await loadNostrTools();
  try {
    const event = await pool.get(RELAYS, { kinds: [0], authors: [pubkey] });
    if (event) return JSON.parse(event.content);
  } catch (e) {
    console.warn('[Nostr] Failed to fetch profile:', e);
  }
  return {};
}

/**
 * Fetch a user's kind:3 contact list.
 * Returns the full raw tags array (preserves relay hints) and the set of followed hex pubkeys.
 */
export async function fetchContactList(pubkey: string): Promise<{ tags: string[][]; follows: Set<string> }> {
  if (!pool) await loadNostrTools();
  try {
    const event = await pool.get(RELAYS, { kinds: [3], authors: [pubkey] });
    if (!event) return { tags: [], follows: new Set() };
    const follows = new Set<string>(
      event.tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1])
    );
    return { tags: event.tags, follows };
  } catch (_) {
    return { tags: [], follows: new Set() };
  }
}

/**
 * Publish a signed Nostr event via raw WebSocket — bypasses the pool so
 * nostr-tools' internal setTimeout bug (event ref nullified mid-flight)
 * can't cause "Cannot read properties of null (reading 'id')".
 * Returns true if at least one relay sends ["OK", id, true].
 */
/**
 * Sign an event using whichever signer is available for the current login method.
 * Returns the fully signed event (with id + sig), or throws on failure.
 */
export async function signEvent(event: any): Promise<any> {
  if (!NostrTools) await loadNostrTools();
  const loginMethod = authStore.getState().loginMethod;

  if (loginMethod === 'nsec') {
    const key = getLocalKey();
    if (!key) throw new Error('No private key available');
    return NostrTools.finalizeEvent({ ...event }, key);
  }

  if (loginMethod === 'bunker') {
    if (!bunkerClient) throw new Error('Bunker signer not connected');
    return bunkerClient.signEvent(event);
  }

  // extension or fallback
  if ((window as any).nostr?.signEvent) {
    const signed = await (window as any).nostr.signEvent(event);
    if (!signed?.id || !signed?.sig) throw new Error('Extension returned invalid event');
    return signed;
  }

  throw new Error('No signer available — login with a key or extension');
}

export async function publishEvent(event: any): Promise<boolean> {
  if (!event?.id) { console.warn('[Nostr] publishEvent called with invalid event'); return false; }
  const publishToRelay = (url: string): Promise<boolean> =>
    new Promise((resolve) => {
      try {
        const ws = new WebSocket(url);
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          try { ws.close(); } catch (_) {}
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), 6000);
        ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]));
        ws.onmessage = (msg) => {
          try {
            const d = JSON.parse(msg.data);
            if (Array.isArray(d) && d[0] === 'OK' && d[1] === event.id) {
              clearTimeout(timer);
              finish(d[2] === true);
            }
          } catch (_) {}
        };
        ws.onerror = () => finish(false);
        ws.onclose = () => finish(false);
      } catch (_) { resolve(false); }
    });

  const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'];
  const results = await Promise.allSettled(relays.map(publishToRelay));
  const accepted = results.filter(r => r.status === 'fulfilled' && (r as any).value === true).length;
  console.log(`[Nostr] Published kind:${event.kind} to ${accepted}/${relays.length} relays`);
  return accepted > 0;
}

const AVATAR_D_TAG  = 'nostr-district-avatar';
const OUTFITS_D_TAG = 'nostr-district-outfits';

export async function publishAvatar(avatar: AvatarConfig): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;
  try {
    const event = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', AVATAR_D_TAG], ['client', 'Nostr District']],
      content: JSON.stringify(avatar),
    });
    return publishEvent(event);
  } catch (e) {
    console.warn('[Nostr] publishAvatar failed:', e);
    return false;
  }
}

export async function fetchAvatar(pubkey: string): Promise<AvatarConfig | null> {
  if (!pool) await loadNostrTools();
  try {
    const event = await pool.get(RELAYS, {
      kinds: [30078],
      authors: [pubkey],
      '#d': [AVATAR_D_TAG],
    });
    if (!event?.content) return null;
    return JSON.parse(event.content) as AvatarConfig;
  } catch (e) {
    console.warn('[Nostr] fetchAvatar failed:', e);
    return null;
  }
}



export async function publishOutfits(outfits: OutfitPreset[]): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;
  try {
    const event = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', OUTFITS_D_TAG], ['client', 'Nostr District']],
      content: JSON.stringify(outfits),
    });
    return publishEvent(event);
  } catch (e) {
    console.warn('[Nostr] publishOutfits failed:', e);
    return false;
  }
}

export async function fetchOutfits(pubkey: string): Promise<OutfitPreset[] | null> {
  if (!pool) await loadNostrTools();
  try {
    const event = await pool.get(RELAYS, {
      kinds: [30078],
      authors: [pubkey],
      '#d': [OUTFITS_D_TAG],
    });
    if (!event?.content) return null;
    return JSON.parse(event.content) as OutfitPreset[];
  } catch (e) {
    console.warn('[Nostr] fetchOutfits failed:', e);
    return null;
  }
}

let _onAvatarSynced: (() => void) | null = null;
let _avatarSynced = false;
let _onRoomSynced: (() => void) | null = null;
let _roomSynced = false;

/**
 * Register a callback to run once the avatar is synced from relays.
 * If the sync already completed, fires immediately.
 */
export function onNextAvatarSync(cb: () => void): void {
  if (_avatarSynced) { cb(); return; }
  _onAvatarSynced = cb;
}

export function onNextRoomSync(cb: () => void): void {
  if (_roomSynced) { cb(); return; }
  _onRoomSynced = cb;
}

/** After login: fetch keypair data from Nostr and apply */
function syncFromRelays(pubkey: string): void {
  fetchRoomConfig(pubkey).then(remote => {
    if (remote) applyRemoteRoomConfig(remote);
    _roomSynced = true;
    const roomCb = _onRoomSynced;
    _onRoomSynced = null;
    roomCb?.();
  }).catch(() => {
    _roomSynced = true;
    const roomCb = _onRoomSynced;
    _onRoomSynced = null;
    roomCb?.();
  });
  fetchOutfits(pubkey).then(remote => {
    if (remote) applyRemoteOutfits(remote);
  }).catch(() => {});

  fetchAvatar(pubkey).then(remote => {
    if (remote) {
      applyRemoteAvatar(remote);
      _avatarSynced = true;
      const cb = _onAvatarSynced;
      _onAvatarSynced = null;
      cb?.();
    }
  }).catch(() => {});
}

export async function loginWithExtension(): Promise<void> {
  if (typeof (window as any).nostr === 'undefined') {
    throw new Error('No Nostr extension found. Install Alby, nos2x, or similar.');
  }
  await loadNostrTools();

  const pubkey = await (window as any).nostr.getPublicKey();
  const npub = NostrTools.nip19.npubEncode(pubkey);

  // Login immediately — don't block on relay fetch
  authStore.getState().login({ pubkey, npub, profile: {}, loginMethod: 'extension' });

  initNWC().catch(() => {});

  // Fetch profile and room config in background
  fetchProfile(pubkey).then(profile => {
    if (profile && Object.keys(profile).length > 0) authStore.updateProfile(profile);
  });
  syncFromRelays(pubkey);
}

export async function loginWithNsec(nsecString: string): Promise<void> {
  if (!nsecString.startsWith('nsec1')) {
    throw new Error('Invalid nsec. Must start with nsec1');
  }
  await loadNostrTools();

  const { data: secretKey } = NostrTools.nip19.decode(nsecString);
  const pubkey = NostrTools.getPublicKey(secretKey as Uint8Array);
  const npub = NostrTools.nip19.npubEncode(pubkey);

  setLocalKey(secretKey as Uint8Array);
  setChannelKey(secretKey as Uint8Array);

  // Login immediately — don't block on relay fetch
  authStore.getState().login({ pubkey, npub, nsec: nsecString, profile: {}, loginMethod: 'nsec' });

  // Load (and if needed migrate) NWC URI into memory now that key is available
  initNWC().catch(() => {});

  // Fetch profile and room config in background
  fetchProfile(pubkey).then(profile => {
    if (profile && Object.keys(profile).length > 0) authStore.updateProfile(profile);
  });
  syncFromRelays(pubkey);
}

/**
 * NIP-46 Client-initiated flow:
 * Generates a nostrconnect:// URI, renders QR, waits for signer approval.
 */
export async function startBunkerFlow(
  onStatus?: (status: string, msg: string) => void,
  qrContainer?: HTMLElement | null,
): Promise<{ connectUri: string; waitForConnect: Promise<string> }> {
  await loadNostrTools();

  if (bunkerClient) {
    bunkerClient.destroy();
    bunkerClient = null;
  }

  // Give bunker its own dedicated pool — don't share with app queries

  bunkerClient = new BunkerClient({
    NostrTools,
    pool: null,
    appName: 'Nostr District',
    relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'],
    perms: 'sign_event:1,sign_event:0,sign_event:13,sign_event:14,sign_event:20000,sign_event:30078,nip44_encrypt,nip44_decrypt',
    storageKey: 'nostr_district_bunker',
    onStatusChange: (status: string, msg: string) => {
      console.log(`[Bunker] ${status}: ${msg}`);
      onStatus?.(status, msg);
    },
    onDisconnect: () => {
      console.warn('[Bunker] Signer disconnected');
    },
  });

  // Try restoring a saved session first
  const restored = await bunkerClient.restoreSession();
  if (restored) {
    const pubkey = bunkerClient.userPubkey;
    const npub = NostrTools.nip19.npubEncode(pubkey);
    authStore.getState().login({ pubkey, npub, profile: {}, loginMethod: 'bunker' });
    fetchProfile(pubkey).then(profile => {
      if (profile && Object.keys(profile).length > 0) authStore.updateProfile(profile);
    });
    syncFromRelays(pubkey);
    return { connectUri: '', waitForConnect: Promise.resolve(pubkey) };
  }

  // Start client-initiated flow
  const { connectUri, waitForConnect } = await bunkerClient.startClientFlow();

  // Render QR if container provided
  if (qrContainer) {
    renderQR(qrContainer, connectUri, { size: 260 });
  }

  // Wrap to finish login on success
  const loginPromise = waitForConnect.then((userPubkey: string) => {
    const npub = NostrTools.nip19.npubEncode(userPubkey);
    authStore.getState().login({ pubkey: userPubkey, npub, profile: {}, loginMethod: 'bunker' });
    fetchProfile(userPubkey).then(profile => {
      if (profile && Object.keys(profile).length > 0) authStore.updateProfile(profile);
    });
    syncFromRelays(userPubkey);
    return userPubkey;
  });

  return { connectUri, waitForConnect: loginPromise };
}

/**
 * NIP-46 Signer-initiated flow:
 * User pastes a bunker:// URL, connects directly.
 */
export async function loginWithBunkerUrl(bunkerUrl: string): Promise<void> {
  await loadNostrTools();

  if (bunkerClient) {
    bunkerClient.destroy();
    bunkerClient = null;
  }


  bunkerClient = new BunkerClient({
    NostrTools,
    pool: null,
    appName: 'Nostr District',
    relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'],
    perms: 'sign_event:1,sign_event:0,sign_event:13,sign_event:14,sign_event:20000,sign_event:30078,nip44_encrypt,nip44_decrypt',
    storageKey: 'nostr_district_bunker',
    onDisconnect: () => {
      console.warn('[Bunker] Signer disconnected');
    },
  });

  const userPubkey = await bunkerClient.connectBunkerUrl(bunkerUrl);
  const npub = NostrTools.nip19.npubEncode(userPubkey);

  authStore.getState().login({ pubkey: userPubkey, npub, profile: {}, loginMethod: 'bunker' });
  fetchProfile(userPubkey).then(profile => {
    if (profile && Object.keys(profile).length > 0) authStore.updateProfile(profile);
  });
  syncFromRelays(userPubkey);
}

export async function loginWithNewAccount(nsecString: string, displayName: string): Promise<void> {
  await loginWithNsec(nsecString);
  // Update auth state with nsec and display name so it's available in-session
  authStore.getState().nsec = nsecString;
  authStore.updateProfile({ name: displayName, display_name: displayName });
  // Publish kind:0 profile in background — non-blocking
  const pubkey = authStore.getState().pubkey;
  if (pubkey) {
    signEvent({
      kind: 0,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({ name: displayName, display_name: displayName }),
    }).then(ev => publishEvent(ev)).catch(() => {});
  }
}

export async function loginAsGuest(): Promise<void> {
  await loadNostrTools();

  const secretKey = NostrTools.generateSecretKey();
  const pubkey = NostrTools.getPublicKey(secretKey);
  const npub = NostrTools.nip19.npubEncode(pubkey);
  const nsec = NostrTools.nip19.nsecEncode(secretKey);

  setLocalKey(secretKey);
  setChannelKey(secretKey);

  const guestId = Math.random().toString(36).slice(2, 8);

  authStore.getState().login({
    pubkey,
    npub,
    nsec,
    profile: { name: `guest_${guestId}` },
    loginMethod: 'guest',
  });
}

export interface UserNote {
  id:        string;
  kind:      number;   // 1 = note, 6 = repost, 1 with 'q' tag = quote
  content:   string;
  createdAt: number;
  quotedId?: string;   // for quote reposts
  repostOf?: string;   // for kind 6 reposts
}

/**
 * Fetch a user's recent kind 1 notes, kind 6 reposts, and quote-reposts.
 * Returns up to `limit` events sorted newest-first.
 */
export async function fetchUserNotes(pubkey: string, limit = 20): Promise<UserNote[]> {
  if (!pool) await loadNostrTools();
  try {
    const events: any[] = await pool.querySync(RELAYS, {
      kinds: [1, 6],
      authors: [pubkey],
      limit,
    });
    return events
      .sort((a: any, b: any) => b.created_at - a.created_at)
      .map((ev: any): UserNote => {
        const qTag = ev.tags?.find((t: string[]) => t[0] === 'q');
        const eTag = ev.tags?.find((t: string[]) => t[0] === 'e');
        return {
          id:        ev.id,
          kind:      ev.kind,
          content:   ev.content || '',
          createdAt: ev.created_at,
          quotedId:  qTag?.[1],
          repostOf:  ev.kind === 6 ? (eTag?.[1] ?? undefined) : undefined,
        };
      });
  } catch (e) {
    console.warn('[Nostr] fetchUserNotes failed:', e);
    return [];
  }
}

const ROOM_D_TAG = 'nostr-district-room';

/**
 * Publish the user's room config as a NIP-78 (kind 30078) replaceable event.
 * Only runs when the user is logged in with a signing method.
 */
export async function publishRoomConfig(config: RoomConfig): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;
  try {
    const event = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', ROOM_D_TAG], ['client', 'Nostr District']],
      content: JSON.stringify(config),
    });
    return publishEvent(event);
  } catch (e) {
    console.warn('[Nostr] publishRoomConfig failed:', e);
    return false;
  }
}

/**
 * Fetch a user's room config from relays (kind 30078, d=nostr-district-room).
 * Returns null if not found or on error.
 */
export async function fetchRoomConfig(pubkey: string): Promise<RoomConfig | null> {
  if (!pool) await loadNostrTools();
  try {
    const event = await pool.get(RELAYS, {
      kinds: [30078],
      authors: [pubkey],
      '#d': [ROOM_D_TAG],
    });
    if (!event?.content) return null;
    return JSON.parse(event.content) as RoomConfig;
  } catch (e) {
    console.warn('[Nostr] fetchRoomConfig failed:', e);
    return null;
  }
}

export function logout(): void {
  _avatarSynced = false;
  _onAvatarSynced = null;
  _roomSynced = false;
  _onRoomSynced = null;
  clearLocalKey();
  clearChannelKey();
  clearNWCCache();
  if (bunkerClient) {
    bunkerClient.destroy();
    bunkerClient = null;
  }
  authStore.getState().logout();
}

/** Get the bunker client instance (for signEvent, etc.) */
export function getBunkerClient(): any {
  return bunkerClient;
}

/** Cancel an in-progress bunker connection flow */
export function cancelBunkerFlow(): void {
  if (bunkerClient) {
    bunkerClient.cancel();
    bunkerClient = null;
  }
}