import { authStore } from '../stores/authStore';
import { setLocalKey, clearLocalKey, getLocalKey } from './dmService';
import { setChannelKey, clearChannelKey } from './channelService';
import { DEFAULT_RELAYS } from './relayManager';
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

export async function loginWithExtension(): Promise<void> {
  if (typeof (window as any).nostr === 'undefined') {
    throw new Error('No Nostr extension found. Install Alby, nos2x, or similar.');
  }
  await loadNostrTools();

  const pubkey = await (window as any).nostr.getPublicKey();
  const npub = NostrTools.nip19.npubEncode(pubkey);

  // Login immediately — don't block on relay fetch
  authStore.getState().login({ pubkey, npub, profile: {}, loginMethod: 'extension' });

  // Fetch profile in background and update store when ready
  fetchProfile(pubkey).then(profile => {
    if (profile && Object.keys(profile).length > 0) authStore.updateProfile(profile);
  });
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
  authStore.getState().login({ pubkey, npub, profile: {}, loginMethod: 'nsec' });

  // Fetch profile in background and update store when ready
  fetchProfile(pubkey).then(profile => {
    if (profile && Object.keys(profile).length > 0) authStore.updateProfile(profile);
  });
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
    perms: 'sign_event:1,sign_event:0,sign_event:14,sign_event:20000',
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
    perms: 'sign_event:1,sign_event:0,sign_event:14,sign_event:20000',
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
}

export async function loginAsGuest(): Promise<void> {
  await loadNostrTools();

  const secretKey = NostrTools.generateSecretKey();
  const pubkey = NostrTools.getPublicKey(secretKey);
  const npub = NostrTools.nip19.npubEncode(pubkey);

  setLocalKey(secretKey);
  setChannelKey(secretKey);

  const guestId = Math.random().toString(36).slice(2, 8);

  authStore.getState().login({
    pubkey,
    npub,
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

export function logout(): void {
  clearLocalKey();
  clearChannelKey();
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