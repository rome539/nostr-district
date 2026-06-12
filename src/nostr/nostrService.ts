import { authStore } from '../stores/authStore';
import { setLocalKey, clearLocalKey, getLocalKey } from './dmService';
import { setChannelKey, clearChannelKey } from './channelService';
import { initNWC, clearNWCCache } from './nwcService';
import { initSparkWallet, ensureLightningAddress, disconnectSparkWallet } from './sparkService';
import { DEFAULT_RELAYS } from './relayManager';
import type { RoomConfig } from '../stores/roomStore';
import { applyRemoteRoomConfig } from '../stores/roomStore';
import type { AvatarConfig, OutfitPreset } from '../stores/avatarStore';
import { applyRemoteAvatar, applyRemoteOutfits } from '../stores/avatarStore';
import { applyRemoteInventory, mergeReceiptInventory } from '../stores/marketStore';
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
// Identity guard: everything signed through THIS wrapper must be authored by the
// logged-in session. NIP-07 extensions (and remote signers) sign with whatever
// profile is currently ACTIVE — they ignore the pubkey in the draft — so a user
// who switches extension profiles mid-session would otherwise publish events
// under the wrong identity. Those are silent corruption: e.g. a bid withdrawal
// signed by profile B can never replace a bid authored by profile A, leaving a
// ghost bid no one can cancel. Fail loudly instead.
// (DM gift-wraps and crew events sign with ephemeral/crew keys via finalizeEvent
// directly — they never pass through here, so they're unaffected.)
function assertSessionAuthor(signed: any): any {
  const session = (authStore.getState().pubkey ?? '').toLowerCase();
  const author  = (signed?.pubkey ?? '').toLowerCase();
  if (session && author && author !== session) {
    window.dispatchEvent(new CustomEvent('nd-toast', {
      detail: { msg: 'Your signer is on a different profile than this login — switch it back and retry.', color: '#ff9070' },
    }));
    throw new Error(`Signer identity mismatch: session ${session.slice(0, 8)}…, signer returned ${author.slice(0, 8)}…`);
  }
  return signed;
}

export async function signEvent(event: any): Promise<any> {
  if (!NostrTools) await loadNostrTools();
  const loginMethod = authStore.getState().loginMethod;

  if (loginMethod === 'nsec') {
    const key = getLocalKey();
    if (!key) throw new Error('No private key available');
    return assertSessionAuthor(NostrTools.finalizeEvent({ ...event }, key));
  }

  if (loginMethod === 'bunker') {
    if (!bunkerClient) throw new Error('Bunker signer not connected');
    return assertSessionAuthor(await bunkerClient.signEvent(event));
  }

  // extension or fallback
  if ((window as any).nostr?.signEvent) {
    const signed = await (window as any).nostr.signEvent(event);
    if (!signed?.id || !signed?.sig) throw new Error('Extension returned invalid event');
    return assertSessionAuthor(signed);
  }

  throw new Error('No signer available — login with a key or extension');
}

// ── In-game zap routing (NIP-78 app-data) ────────────────────────────────────
//
// We publish a kind:30078 event with d="nostr-district:spark-address" that maps
// the user's Nostr pubkey → their in-game (Spark) Lightning address. Other
// Nostr District clients query this event when zapping a player, so in-game
// zaps land in the recipient's in-game wallet — without touching kind:0.
// Outside clients (Damus, Amethyst, etc.) ignore this event.

const SPARK_ADDR_D_TAG = 'nostr-district:spark-address';
const _sparkAddrCache = new Map<string, { lud16: string | null; ts: number }>();
const SPARK_ADDR_CACHE_TTL_MS = 5 * 60 * 1000;

/** Publish kind:30078 with the user's Spark Lightning address. */
export async function publishSparkAddress(pubkey: string, lud16: string): Promise<void> {
  if (!pubkey || !lud16) return;
  // Avoid redundant relay writes: skip if the same address was already
  // published from this browser previously.
  const lastKey = `nd_spark_addr_published_${pubkey.slice(0, 16)}`;
  if (localStorage.getItem(lastKey) === lud16) return;
  try {
    const signed = await signEvent({
      kind: 30078,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', SPARK_ADDR_D_TAG], ['client', 'Nostr District']],
      content: JSON.stringify({ lud16 }),
    });
    const ok = await publishEvent(signed);
    if (ok) localStorage.setItem(lastKey, lud16);
  } catch (e) {
    console.warn('[Spark] Failed to publish spark-address event:', e);
  }
}

/** Look up a player's in-game Spark Lightning address from kind:30078. */
export async function fetchSparkAddress(pubkey: string): Promise<string | null> {
  const cached = _sparkAddrCache.get(pubkey);
  if (cached && (Date.now() - cached.ts) < SPARK_ADDR_CACHE_TTL_MS) return cached.lud16;
  if (!pool) await loadNostrTools();
  try {
    const event = await pool.get(RELAYS, {
      kinds:    [30078],
      authors:  [pubkey],
      '#d':     [SPARK_ADDR_D_TAG],
      limit:    1,
    });
    if (event) {
      const data = JSON.parse(event.content);
      const lud16 = (data?.lud16 || null) as string | null;
      _sparkAddrCache.set(pubkey, { lud16, ts: Date.now() });
      return lud16;
    }
  } catch { /* ignore */ }
  _sparkAddrCache.set(pubkey, { lud16: null, ts: Date.now() });
  return null;
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

/**
 * Query events from relays via raw WebSocket REQ — mirrors publishEvent's reliability.
 * Collects events from each relay until EOSE or timeout, then dedupes by id.
 */
const DEFAULT_QUERY_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'];

// ── Shared relay connection pool ──────────────────────────────────────────────
// One persistent WebSocket per relay, reused across every query/subscription and
// multiplexed by subscription id. Without this, each query opened a fresh socket
// per relay; the bazaar fires ~8 fetches on open × 6 relays = 50+ simultaneous
// connections, which Safari throttles and kills ("closed before connection
// established"). Pooling collapses that to one socket per relay.
interface PooledRelay {
  url: string;
  ws: WebSocket | null;
  ready: boolean;
  subs: Map<string, { handler: (d: any[]) => void; req: string }>;
}
const _relayPool = new Map<string, PooledRelay>();

function ensureRelay(r: PooledRelay): void {
  if (r.ws && (r.ws.readyState === WebSocket.OPEN || r.ws.readyState === WebSocket.CONNECTING)) return;
  let ws: WebSocket;
  try { ws = new WebSocket(r.url); } catch { r.ws = null; r.ready = false; return; }
  r.ws = ws; r.ready = false;
  ws.onopen = () => { r.ready = true; for (const s of r.subs.values()) { try { ws.send(s.req); } catch {} } };
  ws.onmessage = (ev) => {
    try { const d = JSON.parse((ev as MessageEvent).data); const s = r.subs.get(d[1]); if (s) s.handler(d); } catch {}
  };
  ws.onclose = () => { r.ready = false; r.ws = null; };
  ws.onerror = () => {};
}

function getRelay(url: string): PooledRelay {
  let r = _relayPool.get(url);
  if (!r) { r = { url, ws: null, ready: false, subs: new Map() }; _relayPool.set(url, r); }
  ensureRelay(r);
  return r;
}

function addSub(r: PooledRelay, subId: string, req: string, handler: (d: any[]) => void): void {
  r.subs.set(subId, { handler, req });
  if (r.ws && r.ready && r.ws.readyState === WebSocket.OPEN) { try { r.ws.send(req); } catch {} }
  else ensureRelay(r);
}

function removeSub(r: PooledRelay, subId: string): void {
  if (!r.subs.delete(subId)) return;
  if (r.ws && r.ready && r.ws.readyState === WebSocket.OPEN) { try { r.ws.send(JSON.stringify(['CLOSE', subId])); } catch {} }
}

export async function queryEvents(filter: any, relayUrls?: string[]): Promise<any[]> {
  const relays = relayUrls ?? DEFAULT_QUERY_RELAYS;
  const subId = 'q' + Math.random().toString(36).slice(2, 10);

  const queryRelay = (url: string): Promise<any[]> =>
    new Promise((resolve) => {
      const r = getRelay(url);
      const collected: any[] = [];
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); removeSub(r, subId); resolve(collected); };
      const timer = setTimeout(finish, 6000);
      addSub(r, subId, JSON.stringify(['REQ', subId, filter]), (d) => {
        if (d[0] === 'EVENT' && d[1] === subId) collected.push(d[2]);
        else if (d[0] === 'EOSE' && d[1] === subId) finish();
      });
    });

  const results = await Promise.all(relays.map(queryRelay));
  const byId = new Map<string, any>();
  for (const list of results) for (const ev of list) if (!byId.has(ev.id)) byId.set(ev.id, ev);
  return [...byId.values()];
}

/**
 * Live subscription via the pooled relay sockets — stays open and fires onEvent for
 * each event (including new ones after EOSE). Returns an unsubscribe function.
 */
export function subscribeEvents(filter: any, onEvent: (ev: any) => void, relayUrls?: string[]): () => void {
  const relays = relayUrls ?? DEFAULT_QUERY_RELAYS;
  const subId = 's' + Math.random().toString(36).slice(2, 10);
  const seen = new Set<string>();

  for (const url of relays) {
    const r = getRelay(url);
    addSub(r, subId, JSON.stringify(['REQ', subId, filter]), (d) => {
      if (d[0] === 'EVENT' && d[1] === subId && !seen.has(d[2].id)) { seen.add(d[2].id); onEvent(d[2]); }
    });
  }

  return () => {
    for (const url of relays) { const r = _relayPool.get(url); if (r) removeSub(r, subId); }
  };
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

const INVENTORY_D_TAG = 'nostr-district-inventory';

export async function publishInventory(items: string[]): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;
  try {
    const event = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', INVENTORY_D_TAG], ['client', 'Nostr District']],
      content: JSON.stringify(items),
    });
    return publishEvent(event);
  } catch (e) {
    console.warn('[Nostr] publishInventory failed:', e);
    return false;
  }
}

export async function fetchInventory(pubkey: string): Promise<string[] | null> {
  if (!pool) await loadNostrTools();
  try {
    const event = await pool.get(RELAYS, {
      kinds: [30078],
      authors: [pubkey],
      '#d': [INVENTORY_D_TAG],
    });
    if (!event?.content) return null;
    return JSON.parse(event.content) as string[];
  } catch (e) {
    console.warn('[Nostr] fetchInventory failed:', e);
    return null;
  }
}

const UNLOCKS_D_TAG = 'nostr-district-unlocks';

export async function publishUnlocks(state: unknown): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;
  try {
    const event = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', UNLOCKS_D_TAG], ['client', 'Nostr District']],
      content: JSON.stringify(state),
    });
    return publishEvent(event);
  } catch (e) {
    console.warn('[Nostr] publishUnlocks failed:', e);
    return false;
  }
}

export async function fetchUnlocks(pubkey: string): Promise<any | null> {
  if (!pool) await loadNostrTools();
  try {
    const event = await pool.get(RELAYS, {
      kinds: [30078],
      authors: [pubkey],
      '#d': [UNLOCKS_D_TAG],
    });
    if (!event?.content) return null;
    return JSON.parse(event.content);
  } catch (e) {
    console.warn('[Nostr] fetchUnlocks failed:', e);
    return null;
  }
}

const OFFERS_D_TAG = 'nostr-district-offers';

export async function publishTradeOffers(state: unknown): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;
  try {
    const event = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', OFFERS_D_TAG], ['client', 'Nostr District']],
      content: JSON.stringify(state),
    });
    return publishEvent(event);
  } catch (e) {
    console.warn('[Nostr] publishTradeOffers failed:', e);
    return false;
  }
}

export async function fetchTradeOffers(pubkey: string): Promise<any | null> {
  if (!pool) await loadNostrTools();
  try {
    const event = await pool.get(RELAYS, {
      kinds: [30078],
      authors: [pubkey],
      '#d': [OFFERS_D_TAG],
    });
    if (!event?.content) return null;
    return JSON.parse(event.content);
  } catch (e) {
    console.warn('[Nostr] fetchTradeOffers failed:', e);
    return null;
  }
}

const STORE_LUD16 = 'Myrtieraven16@blitzwalletapp.com';

// All store nostr pubkeys ever used — add the old one here before switching
// lightning providers so receipts signed by previous ones are still honoured.
// Note: Wallet of Satoshi uses a SINGLE shared nostrPubkey across every
// user account on the service (roomyflag04, falsepancake303, etc. all
// return the same be1d8979... pubkey), so one entry covers every WoS
// address we've ever used as the store.
const KNOWN_STORE_PUBKEYS = new Set<string>([
  'c6e230a25ead3c497013637bf377bced81c7cdb60d881a63edb138b08aa68083', // Blitz Wallet (current)
  'be1d89794bf92de5dd64c1e60f6a2c70c140abac9932418fee30c5c637fe9479', // Wallet of Satoshi (covers roomyflag04, falsepancake303, all WoS users)
]);

async function loadCurrentStoreNostrPubkey(): Promise<void> {
  try {
    const [user, domain] = STORE_LUD16.split('@');
    const res = await fetch(`https://${domain}/.well-known/lnurlp/${user}`);
    const data = await res.json();
    if (data.allowsNostr && data.nostrPubkey) KNOWN_STORE_PUBKEYS.add(data.nostrPubkey);
  } catch { /* */ }
}

export async function fetchReceiptInventory(userPubkey: string): Promise<string[]> {
  await loadCurrentStoreNostrPubkey();
  if (KNOWN_STORE_PUBKEYS.size === 0) return [];
  if (!pool) await loadNostrTools();
  try {
    const allEvents: any[] = [];
    for (const pubkey of KNOWN_STORE_PUBKEYS) {
      const events: any[] = await pool.querySync(RELAYS, {
        kinds: [9735],
        '#p': [pubkey],
        limit: 500,
      });
      allEvents.push(...events);
    }
    const items: string[] = [];
    const seen = new Set<string>();
    for (const ev of allEvents) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      const descTag = ev.tags?.find((t: string[]) => t[0] === 'description');
      if (!descTag?.[1]) continue;
      try {
        const zapReq = JSON.parse(descTag[1]);
        if (zapReq.pubkey !== userPubkey) continue;
        const itemTag = zapReq.tags?.find((t: string[]) => t[0] === 'item');
        if (itemTag?.[2] && itemTag?.[3]) items.push(`${itemTag[2]}:${itemTag[3]}`);
      } catch { /* */ }
    }
    console.log(`[Market] receipt-verified items for ${userPubkey.slice(0, 8)}:`, items);
    return items;
  } catch (e) {
    console.warn('[Nostr] fetchReceiptInventory failed:', e);
    return [];
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
  fetchInventory(pubkey).then(remote => {
    if (remote) applyRemoteInventory(remote);
  }).catch(() => {});
  fetchReceiptInventory(pubkey).then(verified => {
    if (verified.length > 0) mergeReceiptInventory(verified);
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

// Ensures the user has a Spark Lightning address registered with Breez, then
// publishes a kind:30078 event mapping their pubkey → that address so other
// players' clients can route in-game zaps to it.
function ensureAndPublishSparkAddress(dn: string, pubkey: string): void {
  ensureLightningAddress(dn, pubkey).then((lud16) => {
    if (lud16) publishSparkAddress(pubkey, lud16);
  }).catch(() => {});
}

// Shared helper: kick off Spark wallet init + Lightning-address registration
// for bunker-logged-in users. Bunker requires the user to approve a remote
// sign request; the cached mnemonic skips that on subsequent reloads.
function initBunkerSparkWallet(pubkey: string): void {
  initSparkWallet(pubkey, signEvent).then(async () => {
    try {
      const profile = await fetchProfile(pubkey);
      const dn = profile?.display_name || profile?.name || '';
      ensureAndPublishSparkAddress(dn, pubkey);
    } catch {
      ensureAndPublishSparkAddress('', pubkey);
    }
  }).catch(() => {});
}

/**
 * Verify the extension actually implements NIP-44 by doing a self-encrypt →
 * self-decrypt round-trip with a known plaintext. Some extensions (e.g.,
 * Nostore on Safari) expose `nip44.encrypt`/`decrypt` but the implementation
 * is broken or partial — they'll silently fail every DM / crew chatKey /
 * gift-wrap operation. Returns true only if the round-trip succeeds.
 */
async function extensionSupportsNip44(pubkey: string): Promise<boolean> {
  const ext = (window as any).nostr?.nip44;
  if (!ext?.encrypt || !ext?.decrypt) return false;
  try {
    const sample = `nd-nip44-test-${Date.now()}`;
    const ct = await ext.encrypt(pubkey, sample);
    if (typeof ct !== 'string' || !ct) return false;
    const pt = await ext.decrypt(pubkey, ct);
    return pt === sample;
  } catch {
    return false;
  }
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

  // Capability check: if the extension's NIP-44 is broken, surface a one-time
  // warning so the user understands why DMs/crew chat will appear empty.
  extensionSupportsNip44(pubkey).then(ok => {
    if (!ok) {
      import('../ui/ExtensionWarning').then(({ ExtensionWarning }) => {
        ExtensionWarning.maybeShow();
      }).catch(() => {});
    }
  }).catch(() => {});

  initNWC().catch(() => {});

  // Spark wallet via signed-event derivation. First sign prompts the
  // extension popup; subsequent reloads use the cached mnemonic.
  initSparkWallet(pubkey, signEvent).then(async () => {
    try {
      const profile = await fetchProfile(pubkey);
      const dn = profile?.display_name || profile?.name || '';
      ensureAndPublishSparkAddress(dn, pubkey);
    } catch {
      ensureAndPublishSparkAddress('', pubkey);
    }
  }).catch(() => {});

  // Fetch profile and room config in background
  fetchProfile(pubkey).then(profile => {
    if (profile && Object.keys(profile).length > 0) authStore.updateProfile(profile);
  });
  syncFromRelays(pubkey);
}

export async function loginWithNsec(nsecString: string, knownDisplayName?: string, isNewAccount = false): Promise<void> {
  if (!nsecString.startsWith('nsec1')) {
    throw new Error('Invalid nsec. Must start with nsec1');
  }
  await loadNostrTools();

  const { data: secretKey } = NostrTools.nip19.decode(nsecString);
  const pubkey = NostrTools.getPublicKey(secretKey as Uint8Array);
  const npub = NostrTools.nip19.npubEncode(pubkey);

  setLocalKey(secretKey as Uint8Array);
  setChannelKey(secretKey as Uint8Array);

  // Warm the crew chat-key cache from localStorage so subscribeCrewChat can
  // decrypt messages immediately instead of waiting for gift-wrap DMs.
  import('./crewKeyCache').then(({ preloadCrewKeys }) => preloadCrewKeys()).catch(() => {});
  import('./crewSkCache').then(({ preloadCrewSks }) => preloadCrewSks()).catch(() => {});

  // Login immediately — don't block on relay fetch
  authStore.getState().login({ pubkey, npub, nsec: nsecString, profile: {}, loginMethod: 'nsec' });

  // Init Spark wallet in background — derives the BIP39 mnemonic from a
  // deterministic signed Nostr event so any login method (nsec, passkey,
  // extension, bunker) can provision the same wallet for the same identity.
  // Pass isNewAccount through so freshly-generated accounts skip the strict
  // relay backup-check (which would otherwise deadlock on slow relays).
  initSparkWallet(pubkey, signEvent, isNewAccount).then(async () => {
    if (knownDisplayName) {
      ensureAndPublishSparkAddress(knownDisplayName, pubkey);
      return;
    }
    try {
      const profile = await fetchProfile(pubkey);
      const dn = profile?.display_name || profile?.name || '';
      ensureAndPublishSparkAddress(dn, pubkey);
    } catch {
      ensureAndPublishSparkAddress('', pubkey);
    }
  }).catch(() => {});

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
    perms: 'sign_event:1,sign_event:0,sign_event:13,sign_event:14,sign_event:20000,sign_event:30078,sign_event:9734,nip44_encrypt,nip44_decrypt',
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
    initBunkerSparkWallet(pubkey);
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
    initBunkerSparkWallet(userPubkey);
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
 *
 * Persists a per-signer clientSk in localStorage under
 * `nostr_district_bunker_clients` so re-pasting the same bunker URL
 * reuses the same client identity. Without this, Amber/other signers
 * reject the second connect with "already connected" because they see
 * a NEW client trying to consume the same secret.
 */
export async function loginWithBunkerUrl(bunkerUrl: string): Promise<void> {
  await loadNostrTools();

  // Parse signerPk early so we can look up a saved clientSk for this signer.
  let signerPkFromUrl: string | null = null;
  try {
    const u = new URL(bunkerUrl);
    if (u.protocol === 'bunker:') {
      const pk = u.hostname || u.pathname.replace(/^\/\//, '');
      if (pk && pk.length === 64) signerPkFromUrl = pk;
    }
  } catch {}

  const CLIENTS_KEY = 'nostr_district_bunker_clients';

  // Load saved session for this signer (sk + relays + userPk saved after last login)
  type SavedSession = { sk: string; relays: string[]; user: string };
  let savedSession: SavedSession | null = null;
  if (signerPkFromUrl) {
    try {
      const raw = localStorage.getItem(CLIENTS_KEY);
      if (raw) {
        const map = JSON.parse(raw);
        const entry = map?.[signerPkFromUrl];
        // Support both new format { sk, relays, user } and legacy format (string sk only)
        if (entry && typeof entry === 'object' && entry.sk && entry.relays?.length && entry.user) {
          savedSession = entry as SavedSession;
        } else if (typeof entry === 'string') {
          savedSession = { sk: entry, relays: [], user: '' };
        }
      }
    } catch {}
    // Fallback: legacy nostr_district_bunker key
    if (!savedSession?.sk) {
      try {
        const raw = localStorage.getItem('nostr_district_bunker');
        if (raw) {
          const legacy = JSON.parse(raw);
          if (legacy?.signer === signerPkFromUrl && typeof legacy?.sk === 'string') {
            savedSession = { sk: legacy.sk, relays: legacy.relays || [], user: legacy.user || '' };
          }
        }
      } catch {}
    }
  }

  if (bunkerClient) { bunkerClient.destroy(); bunkerClient = null; }

  bunkerClient = new BunkerClient({
    NostrTools, pool: null, appName: 'Nostr District',
    relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'],
    // sign_event:9734 is REQUIRED for shop purchases — the LNURL zap request
    // is signed by the bunker, embedded in the LNURL callback, and used by
    // the store's LNURL provider to publish the kind:9735 receipt that
    // grants paid items on re-login. Without this perm, signEvent throws,
    // payLightningAddress's catch silently sends a plain payment, no
    // receipt is published, and purchases vanish across sessions.
    perms: 'sign_event:1,sign_event:0,sign_event:13,sign_event:14,sign_event:20000,sign_event:30078,sign_event:9734,nip44_encrypt,nip44_decrypt',
    storageKey: 'nostr_district_bunker',
    clientSkHex: savedSession?.sk ?? null,
    // Disable heartbeat: Amber's ping handler is unreliable, especially when
    // a session is reused via saved clientSk. A failed ping triggers
    // _handleDisconnect which destructively wipes _signerPk and breaks every
    // in-flight signing request (including Spark wallet provisioning).
    // Real signing failures will surface naturally via _request timeouts.
    heartbeatMs: 0,
    onDisconnect: () => { console.warn('[Bunker] Signer disconnected'); },
  });

  // If we have a full saved session (sk + relays + userPk), try a silent
  // reconnect first — just ping to verify Amber still recognises our clientPk.
  // This avoids re-sending the connect RPC with the one-time secret from the
  // bunker URL, which Amber invalidates after first use.
  let userPubkey = '';
  const BUNKER_URL_TIMEOUT_MS = 30_000;
  let silentOk = false;
  if (savedSession?.sk && savedSession.relays?.length && savedSession.user) {
    try {
      console.log('[Bunker] Trying silent reconnect for signer', signerPkFromUrl);
      userPubkey = await Promise.race([
        bunkerClient.reconnectSilent(signerPkFromUrl!, savedSession.sk, savedSession.relays, savedSession.user),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('silent reconnect timeout')), 12000)),
      ]);
      silentOk = true;
      console.log('[Bunker] Silent reconnect succeeded');
    } catch (e) {
      console.log('[Bunker] Silent reconnect failed, falling back to full connect:', (e as Error).message);
      // Reset client so it's clean for the full connect path
      bunkerClient.destroy();
      bunkerClient = new BunkerClient({
        NostrTools, pool: null, appName: 'Nostr District',
        relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://offchain.pub'],
        perms: 'sign_event:1,sign_event:0,sign_event:13,sign_event:14,sign_event:20000,sign_event:30078,sign_event:9734,nip44_encrypt,nip44_decrypt',
        storageKey: 'nostr_district_bunker',
        clientSkHex: savedSession?.sk ?? null,
        heartbeatMs: 0,
        onDisconnect: () => { console.warn('[Bunker] Signer disconnected'); },
      });
    }
  }
  if (!silentOk) {
    userPubkey = await Promise.race([
      bunkerClient.connectBunkerUrl(bunkerUrl),
      new Promise<never>((_, reject) => setTimeout(() => {
        reject(new Error('No response from signer. Open your signer app and try again.'));
        if (bunkerClient) bunkerClient.cancel();
      }, BUNKER_URL_TIMEOUT_MS)),
    ]);
  }

  // Persist the full session (sk + relays from the bunker URL + userPk) so
  // the next login can attempt a silent reconnect without the one-time secret.
  if (signerPkFromUrl && bunkerClient?._clientSk) {
    try {
      const raw = localStorage.getItem(CLIENTS_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const skBytes: Uint8Array = bunkerClient._clientSk;
      const skHex = Array.from(skBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');
      // Parse relays from the bunker URL so we reconnect on the right relays
      let bunkerRelays: string[] = savedSession?.relays || [];
      try { bunkerRelays = new URL(bunkerUrl).searchParams.getAll('relay'); } catch {}
      map[signerPkFromUrl] = { sk: skHex, relays: bunkerRelays, user: userPubkey! };
      localStorage.setItem(CLIENTS_KEY, JSON.stringify(map));
    } catch (e) {
      console.warn('[Bunker] Failed to save session:', e);
    }
  }

  const npub = NostrTools.nip19.npubEncode(userPubkey);
  authStore.getState().login({ pubkey: userPubkey, npub, profile: {}, loginMethod: 'bunker' });
  // Kick off Spark wallet provisioning + lightning-address registration —
  // same as the QR flow. Without this, bunker URL users never get an
  // in-game wallet even though the encrypted mnemonic backup exists on
  // relays.
  initBunkerSparkWallet(userPubkey);
  fetchProfile(userPubkey).then(profile => {
    if (profile && Object.keys(profile).length > 0) authStore.updateProfile(profile);
  });
  syncFromRelays(userPubkey);
}

export async function loginWithNewAccount(nsecString: string, displayName: string): Promise<void> {
  // Pass the chosen name through so the in-game wallet's Lightning address
  // is registered as `<displayName>@breez.tips` instead of a pubkey fallback.
  // isNewAccount=true skips the wallet's relay backup-check so a slow first
  // connection doesn't abort wallet provisioning for brand-new signups.
  await loginWithNsec(nsecString, displayName, true);
  authStore.getState().nsec = nsecString;
  authStore.updateProfile({ name: displayName, display_name: displayName });

  const pubkey = authStore.getState().pubkey;
  if (!pubkey) return;

  // Publish a minimal kind:0 (no lud16) so other Nostr clients see the name.
  signEvent({
    kind: 0,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({ name: displayName, display_name: displayName }),
  }).then(ev => publishEvent(ev)).catch(() => {
  });
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
  // Intentionally no Spark wallet provisioning for guests — they're
  // ephemeral by design. If they want a wallet, they upgrade to a real
  // login (nsec, extension, bunker) and the wallet gets created then.
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
/**
 * Returned by `fetchUserActivity` — one entry per event the user has signed
 * (or had signed on their behalf) in the recent window. Includes only public
 * relay-stored data; encrypted DMs show up as their kind but content is opaque.
 */
export interface UserActivityEntry {
  id:        string;
  kind:      number;
  content:   string;
  tags:      string[][];
  createdAt: number;
}

/**
 * Fetch every event authored by `pubkey` within the last `days` days that
 * was signed via Nostr District (i.e. has `['client', 'Nostr District']` in
 * its tags). Used by Settings → Activity Log to show only this app's
 * activity, not the user's entire Nostr footprint.
 *
 * Relays may not return everything (rate limits, individual relays missing
 * specific kinds), but across our default relay set this is usually within
 * a few of complete for normal usage.
 */
const ND_CLIENT_NAME = 'Nostr District';

export async function fetchUserActivity(pubkey: string, days = 7): Promise<UserActivityEntry[]> {
  if (!pool) await loadNostrTools();
  const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  try {
    const events: any[] = await pool.querySync(RELAYS, {
      authors: [pubkey],
      since,
    });
    // Deduplicate by event id (relays may return the same event multiple times)
    const byId = new Map<string, any>();
    for (const ev of events) {
      if (ev?.id && !byId.has(ev.id)) byId.set(ev.id, ev);
    }
    return [...byId.values()]
      .filter((ev): boolean => {
        // Always include kind:0 profile events — ND doesn't tag those with a
        // client name (it'd leak the app to every external profile reader),
        // but they're still ND-originated activity worth showing.
        if (ev.kind === 0) return true;
        if (!Array.isArray(ev.tags)) return false;
        return ev.tags.some((t: any) =>
          Array.isArray(t) && t[0] === 'client' && t[1] === ND_CLIENT_NAME
        );
      })
      .sort((a, b) => b.created_at - a.created_at)
      .map((ev): UserActivityEntry => ({
        id:        ev.id,
        kind:      ev.kind,
        content:   typeof ev.content === 'string' ? ev.content : '',
        tags:      Array.isArray(ev.tags) ? ev.tags : [],
        createdAt: ev.created_at,
      }));
  } catch (e) {
    console.warn('[Nostr] fetchUserActivity failed:', e);
    return [];
  }
}

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
  const pkBeforeLogout = authStore.getState().pubkey || undefined;
  clearLocalKey();
  clearChannelKey();
  // Clear crew chat-key cache (in-memory) — localStorage is per-pubkey so other accounts on the same browser keep theirs
  import('./crewKeyCache').then(({ clearAllCrewKeys }) => clearAllCrewKeys()).catch(() => {});
  import('./crewSkCache').then(({ clearAllCrewSks }) => clearAllCrewSks()).catch(() => {});
  // Tear down the global zap-toast subscription so a different user logging in
  // on the same tab doesn't see toasts addressed to the previous account.
  import('./zapService').then(({ stopGlobalZapToasts }) => stopGlobalZapToasts()).catch(() => {});
  clearNWCCache();
  disconnectSparkWallet(pkBeforeLogout).catch(() => {});
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

export interface FishCatch { name: string; kg: string; ts: number; }
export interface FishingRecord { pubkey: string; catches: FishCatch[]; total: number; }

/**
 * Fetch the legendary catch records for a set of players. These are now ORACLE-
 * authored (kind:30078, #t=ndfishrec, #p=<player>) — the oracle logs each catch
 * at the moment it happens, so the board is trade-proof and needs no player
 * signature. `oracleKeys` is the trusted oracle set; records from any other
 * author are ignored so a record can't be forged.
 */
export async function fetchFishingRecords(pubkeys: string[], oracleKeys: string[]): Promise<Map<string, FishingRecord>> {
  if (!pubkeys.length || !oracleKeys.length) return new Map();
  if (!pool) await loadNostrTools();
  const trusted = new Set(oracleKeys.map(k => k.toLowerCase()));
  const result = new Map<string, FishingRecord>();
  const newest = new Map<string, number>(); // player pubkey → created_at of kept record
  const BATCH = 50;
  for (let i = 0; i < pubkeys.length; i += BATCH) {
    const batch = pubkeys.slice(i, i + BATCH);
    const events: any[] = await pool.querySync(
      RELAYS,
      { kinds: [30078], '#t': ['ndfishrec'], '#p': batch, authors: oracleKeys },
      { maxWait: 5000 },
    );
    for (const ev of events) {
      if (!trusted.has((ev.pubkey || '').toLowerCase())) continue; // oracle-signed only
      const pk = ev.tags?.find((t: string[]) => t[0] === 'p')?.[1];
      if (!pk) continue;
      if ((newest.get(pk) ?? -1) >= (ev.created_at ?? 0)) continue; // keep newest per player
      try {
        const data = JSON.parse(ev.content);
        result.set(pk, { pubkey: pk, catches: data.catches || [], total: data.total || 0 });
        newest.set(pk, ev.created_at ?? 0);
      } catch {}
    }
  }
  return result;
}

/** Append a legendary catch to this player's fishing record and republish. */
export async function publishFishingRecord(newCatch: FishCatch): Promise<void> {
  if (!pool) await loadNostrTools();
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return;

  let existing: FishCatch[] = [];
  try {
    const ev = await pool.get(RELAYS, { kinds: [30078], '#d': ['nd-fishing-record'], authors: [pubkey] });
    if (ev) {
      const data = JSON.parse(ev.content);
      existing = data.catches || [];
    }
  } catch {}

  const catches = [...existing, newCatch];
  const event = await signEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'nd-fishing-record'], ['t', 'ndfish']],
    content: JSON.stringify({ catches, total: catches.length }),
  });
  await publishEvent(event);
}