/**
 * crewService.ts — Crews (guilds) for Nostr District
 *
 * Storage:
 *   kind:30078 on regular relays  — crew definitions (public discovery only)
 *   NIP-29 relay                  — membership, chat, posts (private to members)
 *
 * NIP-29 event kinds:
 *   kind:9007  — create-group request (sent by founder)
 *   kind:9006  — join request (sent by each member)
 *   kind:9022  — leave (sent by member leaving)
 *   kind:9     — chat messages and posts (tagged #h <group-id>)
 *   kind:39001 — group admins (maintained by relay)
 *   kind:39002 — group members (maintained by relay)
 *
 * All NIP-29 group IDs are prefixed "nd-<crewId>" to namespace nostr-district
 * groups and keep them invisible to other apps on the same relay.
 */

import { nip19 } from 'nostr-tools';
import { authStore } from '../stores/authStore';
import { signEvent, publishEvent, fetchProfile } from './nostrService';
import { DEFAULT_RELAYS, RelayManager } from './relayManager';
import { extractEmojiTags } from './emojiService';

// ── Constants ─────────────────────────────────────────────────────────────────

const NIP29_RELAYS     = ['wss://groups.0xchat.com', 'wss://relay.groups.nip29.com'];
const CREW_DEF_PREFIX  = 'nd-crew-';
const MEMBER_PREFIX    = 'nd-m-';   // d-tag prefix for per-member kind:30078 membership events
const DISCOVERY_RELAYS = DEFAULT_RELAYS.slice(0, 5);
// Chat/posts publish and query on all relays so messages always land somewhere
const CHAT_RELAYS      = [...new Set([...NIP29_RELAYS, ...DISCOVERY_RELAYS])];

const groupId    = (crewId: string) => `nd-${crewId}`;
const memberDTag = (crewId: string) => MEMBER_PREFIX + crewId;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemberRole {
  role: 'admin' | 'officer' | 'member';
  title?: string;
}

export interface Crew {
  id: string;
  name: string;
  about: string;
  emblem: string;
  emblemEmojis?: { code: string; url: string }[]; // resolved URLs for emblem shortcodes
  founderTitle?: string; // custom title replacing "Founder" label
  color: string;
  founderPubkey: string;
  isOpen: boolean;
  createdAt: number;
  chatKey?: string;   // 32-byte hex — NIP-44 conversation key for crew chat + posts
  memberCount?: number;
  memberRoles?: Record<string, MemberRole>; // pubkey → role/title (set by founder)
  kickedPubkeys?: string[];                 // pubkeys banned by founder/admin
  pendingReinvites?: Record<string, number>; // pubkey → unkick timestamp (invited back but not yet rejoined)
}

export interface CrewMember {
  pubkey: string;
  role: 'founder' | 'admin' | 'officer' | 'member';
  title?: string;
  joinedAt: number;
  name?: string;
}

export interface CrewAnnouncement {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  name?: string;
}

export interface CrewChatMessage {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  isSystem?: boolean;
  systemSubjectPubkey?: string; // pubkey of the person the system message is about (join/leave/kick)
  isJoinRequest?: boolean;
  requestToken?: string;
  emojis?: { code: string; url: string }[];
}

// ── In-memory admin-demote tracking ──────────────────────────────────────────
// When a user leaves or is kicked as admin, we update crewCache in-memory so
// isCrewAdmin returns false immediately. On next fetchCrew the relay-based
// role:"member" in the member's own kind:30078 takes over (see fetchCrewMembers).

function demoteInCache(crewId: string, pubkey: string): void {
  const crew = crewCache.get(crewId);
  if (!crew) return;
  const roles = { ...(crew.memberRoles ?? {}) };
  if (roles[pubkey]?.role === 'admin' || roles[pubkey]?.role === 'officer') {
    roles[pubkey] = { ...roles[pubkey], role: 'member' };
  }
  crewCache.set(crewId, { ...crew, memberRoles: roles });
}

// ── Nostr pool ────────────────────────────────────────────────────────────────

let pool: any = null;

async function ensurePool(): Promise<void> {
  if (pool) return;
  const { SimplePool } = await import('nostr-tools/pool');
  pool = new SimplePool();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function genChatKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

let nip44: any = null;
async function ensureNip44(): Promise<void> {
  if (nip44) return;
  const nt = await import('nostr-tools');
  nip44 = (nt as any).nip44;
}

async function encryptContent(plaintext: string, chatKey: string): Promise<string> {
  await ensureNip44();
  return nip44.encrypt(plaintext, hexToBytes(chatKey));
}

async function decryptContent(ciphertext: string, chatKey: string): Promise<string> {
  await ensureNip44();
  return nip44.decrypt(ciphertext, hexToBytes(chatKey));
}

function parseCrew(event: any): Crew | null {
  try {
    const data = JSON.parse(event.content);
    const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
    const id = dTag.replace(CREW_DEF_PREFIX, '');
    if (!id || !data.name || data.deleted) return null; // skip tombstones
    if (getDeletedCrews().has(id)) return null;         // skip locally deleted
    // Sync kicked/pending state with what the relay says
    const myPubkey = authStore.getState().pubkey;
    if (myPubkey) {
      if ((data.kickedPubkeys ?? []).includes(myPubkey)) {
        removeJoinedCrew(id);
        markKickedLocally(id);
      } else {
        clearKickedLocally(id);
      }
    }
    const emblemEmojis: { code: string; url: string }[] = (event.tags ?? [])
      .filter((t: string[]) => t[0] === 'emoji' && t[1] && t[2])
      .map((t: string[]) => ({ code: t[1], url: t[2] }));
    return {
      id,
      name: data.name,
      about: data.about ?? '',
      emblem: data.emblem ?? '⚡',
      emblemEmojis: emblemEmojis.length ? emblemEmojis : undefined,
      founderTitle: data.founderTitle || undefined,
      color: data.color ?? '#5dcaa5',
      founderPubkey: event.pubkey,
      isOpen: data.isOpen !== false,
      createdAt: event.created_at ?? 0,
      chatKey: data.chatKey,
      memberRoles: data.memberRoles ?? {},
      kickedPubkeys: data.kickedPubkeys ?? [],
      pendingReinvites: data.pendingReinvites ?? {},
    };
  } catch { return null; }
}

// ── Kicked-locally set — fast filter so Find tab hides kicked crews instantly ──

function kickedLocalKey(): string {
  const pk = authStore.getState().pubkey;
  return pk ? `nd_crews_kicked_local_${pk}` : 'nd_crews_kicked_local_guest';
}

function getKickedLocally(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(kickedLocalKey()) ?? '[]')); } catch { return new Set(); }
}

function markKickedLocally(id: string): void {
  const set = getKickedLocally();
  set.add(id);
  localStorage.setItem(kickedLocalKey(), JSON.stringify([...set]));
}

export function isKickedLocally(crewId: string): boolean {
  return getKickedLocally().has(crewId);
}

export function clearKickedLocally(crewId: string): void {
  const set = getKickedLocally();
  set.delete(crewId);
  localStorage.setItem(kickedLocalKey(), JSON.stringify([...set]));
}

/**
 * Subscribe to live crew def updates for kick detection.
 * Uses a dedicated RelayManager for the subscription + a poll fallback every 8s
 * so the kick is detected even if the WebSocket subscription misses the event.
 */
export function subscribeCrewUpdates(crewId: string, onKicked: () => void): () => void {
  const { pubkey } = authStore.getState();
  if (!pubkey) return () => {};

  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    removeJoinedCrew(crewId);
    markKickedLocally(crewId);
    onKicked();
  };

  const check = (content: string) => {
    try {
      const data = JSON.parse(content);
      if ((data.kickedPubkeys ?? []).includes(pubkey)) fire();
    } catch {}
  };

  // Live subscription via RelayManager
  const rm = new RelayManager(DISCOVERY_RELAYS);
  rm.connectAll();
  rm.subscribe(
    `crew-kick-${crewId}-${pubkey.slice(0, 8)}`,
    [{ kinds: [30078], '#d': [CREW_DEF_PREFIX + crewId] }],
    (ev: any) => check(ev.content)
  );

  // Poll fallback — in case the relay doesn't push the update in time
  const poll = setInterval(() => {
    if (fired) { clearInterval(poll); return; }
    ensurePool().then(() =>
      pool.get(DISCOVERY_RELAYS, { kinds: [30078], '#d': [CREW_DEF_PREFIX + crewId] })
        .then((ev: any) => { if (ev) check(ev.content); })
        .catch(() => {})
    );
  }, 8_000);

  return () => {
    clearInterval(poll);
    rm.destroy();
  };
}

// ── Consumed invite tokens (relay-based, cross-device) ───────────────────────
// Each consumed token is stored as a kind:30078 on regular relays with
// d-tag "nd-invite-{token}", authored by the accepting user.
// This means any browser/device with the same keypair will see the token as used.

const consumedTokenCache = new Set<string>(); // in-memory fast path
let consumedTokensSynced = false; // true once the relay check has completed this session

export function hasUsedInviteToken(token: string): boolean {
  return consumedTokenCache.has(token);
}

export function areConsumedTokensSynced(): boolean {
  return consumedTokensSynced;
}

export function markInviteTokenUsed(token: string): void {
  consumedTokenCache.add(token); // instant — UI re-renders immediately
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return;
  // Relay publish happens in background — doesn't block the UI
  ensurePool().then(() =>
    signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', `nd-invite-${token}`], ['client', 'Nostr District']],
      content: JSON.stringify({ consumed: true }),
    }).then(ev => publishEvent(ev))
      .catch(e => console.warn('[Crews] failed to publish token consumption:', e))
  );
}

/** Fetch all consumed invite tokens from the relay for the current user.
 *  Call once after login; results land in consumedTokenCache for sync checks. */
export async function syncConsumedInviteTokens(): Promise<void> {
  const { pubkey } = authStore.getState();
  if (!pubkey) return;
  await ensurePool();
  try {
    const events = await pool.querySync(DISCOVERY_RELAYS, {
      kinds: [30078],
      authors: [pubkey],
      limit: 100,
    });
    // filter client-side for the nd-invite- prefix
    for (const ev of events) {
      const d = ev.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
      if (d.startsWith('nd-invite-')) {
        try {
          const data = JSON.parse(ev.content);
          if (data.consumed) consumedTokenCache.add(d.replace('nd-invite-', ''));
        } catch {}
      }
    }
  } catch (e) {
    console.warn('[Crews] syncConsumedInviteTokens failed:', e);
  }
  consumedTokensSynced = true;
}

// ── Deleted crews set (localStorage, per keypair) ─────────────────────────────

function deletedKey(): string {
  const pk = authStore.getState().pubkey;
  return pk ? `nd_crews_deleted_${pk}` : 'nd_crews_deleted_guest';
}

function getDeletedCrews(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(deletedKey()) ?? '[]')); } catch { return new Set(); }
}

function markCrewDeleted(id: string): void {
  const set = getDeletedCrews();
  set.add(id);
  localStorage.setItem(deletedKey(), JSON.stringify([...set]));
}

/** Publish a membership/group management event to NIP-29 relays. */
async function publishToNip29(event: any): Promise<void> {
  await ensurePool();
  await Promise.allSettled(pool.publish(NIP29_RELAYS, event));
}

/** Publish a chat/post event to all relays (NIP-29 + regular) for reliability. */
async function publishToChat(event: any): Promise<void> {
  await ensurePool();
  await Promise.allSettled(pool.publish(CHAT_RELAYS, event));
}

// ── Local crew cache ──────────────────────────────────────────────────────────

const crewCache = new Map<string, Crew>();

// ── Crew discovery (kind:30078 on regular relays) ─────────────────────────────

/** Create a new crew. Publishes the definition to regular relays + creates NIP-29 group. */
export async function createCrew(
  name: string,
  about: string,
  emblem: string,
  color: string,
  isOpen: boolean
): Promise<string> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const id = genId();

  // 1. Publish crew definition to regular relays for discovery
  const emblemEmojiTags = extractEmojiTags(emblem).map(e => ['emoji', e.code, e.url]);
  const defEvent = await signEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CREW_DEF_PREFIX + id], ['t', 'nostr-district'], ...emblemEmojiTags, ['client', 'Nostr District']],
    content: JSON.stringify({ name, about, emblem, color, isOpen, chatKey: genChatKey() }),
    pubkey,
  });
  await publishEvent(defEvent);

  // 2. Create the NIP-29 group on the relay (best-effort)
  try {
    const createEvent = await signEvent({
      kind: 9007,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(id)], ['client', 'Nostr District']],
      content: '',
      pubkey,
    });
    await publishToNip29(createEvent);
  } catch (e) {
    console.warn('[Crews] NIP-29 group create failed (relay may be unavailable):', e);
  }

  // 3. Founder joins automatically (best-effort)
  try {
    const joinEvent = await signEvent({
      kind: 9021,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(id)], ['client', 'Nostr District']],
      content: '',
      pubkey,
    });
    await publishToNip29(joinEvent);
  } catch (e) {
    console.warn('[Crews] NIP-29 join failed:', e);
  }

  // Always add to local joined list regardless of relay outcome
  addJoinedCrew(id);

  const crew: Crew = { id, name, about, emblem, color, founderPubkey: pubkey, isOpen, createdAt: defEvent.created_at };
  crewCache.set(id, crew);
  return id;
}

/**
 * Fetch crews belonging to the current user.
 *
 * Source of truth is entirely on-relay — no localStorage dependency:
 *   1. kind:30078 events authored by this pubkey with CREW_DEF_PREFIX d-tag → crews they created
 *   2. kind:30078 events authored by this pubkey with MEMBER_PREFIX d-tag   → crews they joined
 *
 * localStorage is only used as a fast in-session cache; it is synced here from
 * the relay data so isCrewMember() stays fast without an async relay call.
 * This means the same keypair on any device will always see the correct crews.
 */
export async function fetchMyCrews(): Promise<Crew[]> {
  const { pubkey } = authStore.getState();
  if (!pubkey) return [];
  await ensurePool();

  const resultMap = new Map<string, Crew>();

  // Single query: all kind:30078 events authored by this pubkey
  // This covers both crew definitions (CREW_DEF_PREFIX) and membership cards (MEMBER_PREFIX)
  let allUserEvents: any[] = [];
  try {
    allUserEvents = await pool.querySync(DISCOVERY_RELAYS, { kinds: [30078], authors: [pubkey], limit: 150 }, { maxWait: 6000 });
  } catch (e) {
    console.warn('[Crews] fetchMyCrews query failed:', e);
  }

  const dTag = (ev: any): string => ev.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '';

  // ── 1. Crews this user created ────────────────────────────────────────────
  const crewDefEvents = allUserEvents.filter(ev => dTag(ev).startsWith(CREW_DEF_PREFIX));
  const byCrewId = new Map<string, any>();
  for (const ev of crewDefEvents) {
    const id = dTag(ev).replace(CREW_DEF_PREFIX, '');
    if (!byCrewId.has(id) || ev.created_at > byCrewId.get(id).created_at) byCrewId.set(id, ev);
  }
  for (const [id, ev] of byCrewId) {
    const crew = parseCrew(ev);
    if (crew) { crewCache.set(id, crew); addJoinedCrew(id); resultMap.set(id, crew); }
  }

  // ── 2. Crews this user joined (membership cards) ──────────────────────────
  // Each membership card is a replaceable event — latest per d-tag is the truth.
  const membershipEvents = allUserEvents.filter(ev => dTag(ev).startsWith(MEMBER_PREFIX));
  const latestMembership = new Map<string, any>();
  for (const ev of membershipEvents) {
    const crewId = dTag(ev).replace(MEMBER_PREFIX, '');
    if (!latestMembership.has(crewId) || ev.created_at > latestMembership.get(crewId).created_at) {
      latestMembership.set(crewId, ev);
    }
  }
  // Process membership events sequentially to avoid a burst of parallel relay queries
  // that would all resolve at once and stall the game loop
  for (const [crewId, ev] of latestMembership) {
    try {
      const data = JSON.parse(ev.content);
      if (!data.active) {
        removeJoinedCrew(crewId);
        continue;
      }
      addJoinedCrew(crewId);
      const crew = await fetchCrew(crewId, true);
      if (crew && !resultMap.has(crewId)) resultMap.set(crewId, crew);
      // Don't removeJoinedCrew on null — fetchCrew can return null on cold relay connections
    } catch {}
    // Yield to the browser between each crew fetch so the game loop isn't starved
    await new Promise(r => setTimeout(r, 0));
  }

  return [...resultMap.values()].sort((a, b) => b.createdAt - a.createdAt);
}

// ── fetchAllCrews TTL cache ───────────────────────────────────────────────────
let allCrewsCache: Crew[] = [];
let allCrewsCacheAt = 0;
const ALL_CREWS_TTL = 2 * 60 * 1000; // 2 minutes

/** Fetch all public crews from regular relays. Results are cached for 2 minutes. */
export async function fetchAllCrews(forceRefresh = false): Promise<Crew[]> {
  if (!forceRefresh && allCrewsCache.length > 0 && Date.now() - allCrewsCacheAt < ALL_CREWS_TTL) {
    return allCrewsCache;
  }
  await ensurePool();
  let events: any[] = [];
  try {
    // Must stay high — this fetches ALL users' kind:30078 and filters crew defs client-side.
    // Lower limits cause crew events to get crowded out by avatar/room/membership events.
    events = await pool.querySync(DISCOVERY_RELAYS, { kinds: [30078], '#t': ['nostr-district'], limit: 200 }, { maxWait: 6000 });
  } catch (e) {
    console.warn('[Crews] fetchAllCrews failed:', e);
    return allCrewsCache; // return stale cache on error rather than empty
  }

  const crewEvents = events.filter((ev: any) => {
    const dTag = ev.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
    return dTag.startsWith(CREW_DEF_PREFIX);
  });

  // Deduplicate — keep newest per id
  const byId = new Map<string, any>();
  for (const ev of crewEvents) {
    const dTag = ev.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
    const id = dTag.replace(CREW_DEF_PREFIX, '');
    if (!byId.has(id) || ev.created_at > byId.get(id).created_at) byId.set(id, ev);
  }

  // parseCrew already filters deleted:true tombstones — no need for a separate kind:5 query
  const crews = [...byId.values()].map(parseCrew).filter(Boolean) as Crew[];
  crews.forEach(c => crewCache.set(c.id, c));
  const sorted = crews.sort((a, b) => b.createdAt - a.createdAt);
  allCrewsCache = sorted;
  allCrewsCacheAt = Date.now();
  return sorted;
}

/** Fetch a single crew definition by id. */
export async function fetchCrew(id: string, forceRefresh = false): Promise<Crew | null> {
  // Only use cache if chatKey is already present and no force refresh requested
  const cached = crewCache.get(id);
  if (cached?.chatKey && !forceRefresh) return cached;
  await ensurePool();
  try {
    const ev = await pool.get(DISCOVERY_RELAYS, { kinds: [30078], '#d': [CREW_DEF_PREFIX + id] });
    if (!ev) return null;
    const crew = parseCrew(ev);
    if (crew) crewCache.set(id, crew);
    return crew;
  } catch { return null; }
}

// ── Membership (NIP-29) ───────────────────────────────────────────────────────

/** Join a crew via NIP-29 kind:9021 + kind:30078 membership event on regular relays. */
export async function joinCrew(crewId: string, pubkey?: string): Promise<void> {
  const state = authStore.getState();
  const pk = pubkey ?? state.pubkey;
  if (!pk || state.loginMethod === 'guest') throw new Error('Must be logged in');

  // NIP-29 join request (best-effort for relay-maintained lists)
  try {
    const event = await signEvent({
      kind: 9021,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(crewId)], ['client', 'Nostr District']],
      content: '',
      pubkey: pk,
    });
    await publishToNip29(event);
  } catch (e) {
    console.warn('[Crews] NIP-29 join request failed:', e);
  }

  // Publish a kind:30078 membership event on regular relays — this is the
  // authoritative "I am in this crew" record, like a kind:3 contact list entry.
  // Each member owns exactly one per crew (parameterized replaceable).
  // Always embed role:"member" on join/rejoin. fetchCrewMembers respects this when the
  // member's event is newer than the crew def — the founder re-granting admin via
  // updateCrewMember publishes a newer crew def that then takes precedence.
  try {
    const memberEvent = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', memberDTag(crewId)], ['client', 'Nostr District']],
      content: JSON.stringify({ active: true, crewId, role: 'member' }),
      pubkey: pk,
    });
    await publishEvent(memberEvent);
  } catch (e) {
    console.warn('[Crews] membership event publish failed:', e);
  }

  addJoinedCrew(crewId);
  // Announce join — resolve name first then send
  fetchProfile(pk).then(p => {
    const name = p?.display_name || p?.name || pk.slice(0, 8) + '…';
    sendCrewSystemMessage(crewId, `${name} joined the crew`, pk).catch(() => {});
  }).catch(() => {
    sendCrewSystemMessage(crewId, `${pk.slice(0, 8)}… joined the crew`, pk).catch(() => {});
  });
}

/**
 * Delete a crew entirely (founder only).
 * Overwrites the kind:30078 with a tombstone (same d-tag, deleted:true) so relays
 * replace the old event. Also sends kind:9008 to the NIP-29 relay (best-effort).
 */
export async function deleteCrew(crewId: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  // Save name before clearing cache
  const crewName = crewCache.get(crewId)?.name ?? 'this crew';

  // 1. Local cleanup FIRST (synchronous, before any await) — UI sees clean state immediately
  markCrewDeleted(crewId);
  crewCache.delete(crewId);
  removeJoinedCrew(crewId);
  allCrewsCache = allCrewsCache.filter(c => c.id !== crewId); // remove from Find a Crew immediately

  // 2. Notify members via system message
  try {
    await sendCrewSystemMessage(crewId, `${crewName} has been dissolved by the founder.`);
  } catch (_) {}

  // 3. kind:5 deletion — primary method
  try {
    const kind5 = await signEvent({
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['a', `30078:${pubkey}:${CREW_DEF_PREFIX + crewId}`], ['client', 'Nostr District']],
      content: 'Crew deleted',
      pubkey,
    });
    await publishEvent(kind5);
  } catch (e) {
    console.warn('[Crews] kind:5 deletion failed:', e);
  }

  // 4. Tombstone overwrite as backup
  try {
    const tombstone = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', CREW_DEF_PREFIX + crewId], ['client', 'Nostr District']],
      content: JSON.stringify({ deleted: true }),
      pubkey,
    });
    await publishEvent(tombstone);
  } catch (e) {
    console.warn('[Crews] tombstone publish failed:', e);
  }

  // 5. NIP-29 group deletion — best effort
  try {
    const deleteGroupEvent = await signEvent({
      kind: 9008,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(crewId)], ['client', 'Nostr District']],
      content: '',
      pubkey,
    });
    await publishToNip29(deleteGroupEvent);
  } catch (e) {
    console.warn('[Crews] NIP-29 group delete rejected:', e);
  }
}

/** Leave a crew via NIP-29 kind:9022 + kind:30078 membership tombstone on regular relays. */
export async function leaveCrew(crewId: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return;

  // NIP-29 leave (best-effort)
  try {
    const event = await signEvent({
      kind: 9022,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(crewId)], ['client', 'Nostr District']],
      content: '',
      pubkey,
    });
    await publishToNip29(event);
  } catch (e) {
    console.warn('[Crews] NIP-29 leave failed:', e);
  }

  // Overwrite the kind:30078 membership event with active:false on regular relays
  try {
    const memberEvent = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', memberDTag(crewId)], ['client', 'Nostr District']],
      content: JSON.stringify({ active: false, crewId }),
      pubkey,
    });
    await publishEvent(memberEvent);
  } catch (e) {
    console.warn('[Crews] membership leave event publish failed:', e);
  }

  removeJoinedCrew(crewId);
  // Update in-memory cache so isCrewAdmin returns false immediately
  if (pubkey) demoteInCache(crewId, pubkey);
  // Announce leave — resolve name first
  fetchProfile(pubkey).then(p => {
    const name = p?.display_name || p?.name || pubkey.slice(0, 8) + '…';
    sendCrewSystemMessage(crewId, `${name} left the crew`).catch(() => {});
  }).catch(() => {
    sendCrewSystemMessage(crewId, `${pubkey.slice(0, 8)}… left the crew`).catch(() => {});
  });
}

/**
 * Silently mark the current user as inactive in a crew (used when kicked).
 * Publishes active:false to overwrite their membership event so fetchMyCrews
 * won't show the crew anymore — no chat system message sent.
 */
export async function clearMembership(crewId: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return;
  removeJoinedCrew(crewId);
  try {
    const memberEvent = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', memberDTag(crewId)], ['client', 'Nostr District']],
      content: JSON.stringify({ active: false, crewId }),
      pubkey,
    });
    await publishEvent(memberEvent);
  } catch (e) {
    console.warn('[Crews] clearMembership failed:', e);
  }
}

/** Check if the current user is a member (local cache only). */
export function isCrewMember(crewId: string): boolean {
  return getJoinedCrews().includes(crewId);
}

/**
 * Fetch crew members from the NIP-29 relay.
 * kind:39002 = member list, kind:39001 = admin list.
 */
export async function fetchCrewMembers(crewId: string): Promise<CrewMember[]> {
  await ensurePool();
  // Force-refresh crew def to get latest kickedPubkeys / pendingReinvites
  await fetchCrew(crewId, true);
  try {
    // Primary: query each member's own kind:30078 membership event on regular relays.
    // This is the authoritative source — each member controls their own state, exactly
    // like a kind:3 contact list. active:true = joined, active:false = left.
    const membershipEvents: any[] = await pool.querySync(
      DISCOVERY_RELAYS,
      { kinds: [30078], '#d': [memberDTag(crewId)] }
    );

    // Fallback: NIP-29 relay-maintained list for members who joined before this system
    const nip29MemberEvents: any[] = await pool.querySync(
      NIP29_RELAYS,
      { kinds: [39002], '#d': [groupId(crewId)] }
    ).catch(() => []);

    const crew = crewCache.get(crewId);
    const storedRoles = crew?.memberRoles ?? {};
    const kickedSet = new Set(crew?.kickedPubkeys ?? []);
    const pendingReinvites = crew?.pendingReinvites ?? {};

    // Deduplicate membership events — keep newest per author (replaceable event semantics)
    const latestByAuthor = new Map<string, any>();
    for (const ev of membershipEvents) {
      const existing = latestByAuthor.get(ev.pubkey);
      if (!existing || ev.created_at > existing.created_at) {
        latestByAuthor.set(ev.pubkey, ev);
      }
    }

    // Returns true if a non-founder pubkey should be shown as an active member
    const isActivelyMember = (pubkey: string, joinedAt: number): boolean => {
      if (kickedSet.has(pubkey)) return false;
      // Pending reinvite: only show if they published a fresh membership event AFTER the unkick timestamp
      const unkickTime = pendingReinvites[pubkey];
      if (unkickTime !== undefined && joinedAt < unkickTime) return false;
      return true;
    };

    const seen = new Set<string>();
    const members: CrewMember[] = [];

    // Always include founder (never needs a membership event — they own the crew)
    if (crew && !kickedSet.has(crew.founderPubkey)) {
      seen.add(crew.founderPubkey);
      members.push({ pubkey: crew.founderPubkey, role: 'founder', joinedAt: crew.createdAt });
    }

    // Primary: kind:30078 membership events — each member's own authoritative state
    for (const [pubkey, ev] of latestByAuthor) {
      if (seen.has(pubkey)) continue;
      let data: any;
      try {
        data = JSON.parse(ev.content);
        if (!data.active) continue; // member published active:false — they left
      } catch { continue; }
      if (!isActivelyMember(pubkey, ev.created_at)) continue;
      seen.add(pubkey);
      const stored = storedRoles[pubkey];
      // If the member's own event is newer than the crew def AND claims role:"member",
      // respect that — it means they voluntarily left as admin and rejoined fresh.
      // The founder can re-grant admin by publishing a newer crew def (updateCrewMember).
      const memberClaimsMember = data.role === 'member' && ev.created_at > (crew?.createdAt ?? 0);
      members.push({
        pubkey,
        role: memberClaimsMember ? 'member' : (stored?.role ?? 'member'),
        title: memberClaimsMember ? undefined : stored?.title,
        joinedAt: ev.created_at,
      });
    }

    // Fallback: NIP-29 kind:39002 for members who haven't yet published a kind:30078 event
    for (const ev of nip29MemberEvents) {
      for (const t of (ev.tags as string[][]).filter((t: string[]) => t[0] === 'p')) {
        const pubkey = t[1];
        if (seen.has(pubkey)) continue;
        // Skip anyone already confirmed left via their own kind:30078
        const memberEv = latestByAuthor.get(pubkey);
        if (memberEv) continue; // they have a kind:30078 — already handled above (active:false = skipped)
        if (!isActivelyMember(pubkey, 0)) continue;
        seen.add(pubkey);
        const stored = storedRoles[pubkey];
        members.push({
          pubkey,
          role: stored?.role ?? 'member',
          title: stored?.title,
          joinedAt: ev.created_at ?? 0,
        });
      }
    }

    return members;
  } catch (e) {
    console.warn('[Crews] fetchCrewMembers failed:', e);
    return [];
  }
}

// ── Local joined list (scoped per keypair) ────────────────────────────────────

function joinedKey(): string {
  const pk = authStore.getState().pubkey;
  return pk ? `nd_crews_joined_${pk}` : 'nd_crews_joined_guest';
}

export function getJoinedCrews(): string[] {
  try { return JSON.parse(localStorage.getItem(joinedKey()) ?? '[]'); } catch { return []; }
}

function addJoinedCrew(id: string): void {
  const list = getJoinedCrews();
  if (!list.includes(id)) { list.push(id); localStorage.setItem(joinedKey(), JSON.stringify(list)); }
}

function removeJoinedCrew(id: string): void {
  localStorage.setItem(joinedKey(), JSON.stringify(getJoinedCrews().filter(x => x !== id)));
}

// ── Chat (NIP-29 kind:9 on NIP-29 relay) ─────────────────────────────────────

/**
 * Subscribe to crew chat.
 * Loads last 24h of history via querySync, then opens a live subscription.
 * Returns an unsubscribe function.
 */
export async function subscribeCrewChat(
  crewId: string,
  onMessage: (msg: CrewChatMessage) => void,
  onKick?: () => void
): Promise<() => void> {
  await ensurePool();
  const gid = groupId(crewId);
  const seen = new Set<string>();
  const { pubkey: myPubkey } = authStore.getState();

  // Always ensure the crew def is loaded so chatKey is available before decrypting
  if (!crewCache.get(crewId)?.chatKey) {
    await fetchCrew(crewId).catch(() => {});
  }
  const chatKey = crewCache.get(crewId)?.chatKey;

  const emit = async (ev: any) => {
    if (seen.has(ev.id)) return;
    if (ev.tags?.some((t: string[]) => t[0] === 't' && t[1] === 'nd-post')) return;
    const isSystem = ev.tags?.some((t: string[]) => t[0] === 't' && t[1] === 'nd-system');
    const isJoinRequest = ev.tags?.some((t: string[]) => t[0] === 't' && t[1] === 'nd-joinreq');
    seen.add(ev.id);
    let content = ev.content;
    // Join requests are unencrypted — skip decryption attempt
    if (chatKey && !isJoinRequest) {
      try { content = await decryptContent(ev.content, chatKey); } catch (_) {}
    }
    // Detect kick system message for the current user in real-time.
    // The system message text is resolved from the member's profile name — we can't
    // match on name, but we can check the crew def directly when a removal notice arrives.
    if (onKick && isSystem && myPubkey && content.includes('was removed from the crew')) {
      fetchCrew(crewId, true).then(crew => {
        if (crew && (crew.kickedPubkeys ?? []).includes(myPubkey)) {
          markKickedLocally(crewId);
          // clearMembership handles removeJoinedCrew + publishes active:false relay event
          clearMembership(crewId).catch(() => {});
          onKick();
        }
      }).catch(() => {});
    }
    const emojis: { code: string; url: string }[] = (ev.tags ?? [])
      .filter((t: string[]) => t[0] === 'emoji' && t[1] && t[2])
      .map((t: string[]) => ({ code: t[1], url: t[2] }));
    const requestToken = isJoinRequest ? (ev.tags ?? []).find((t: string[]) => t[0] === 'token')?.[1] : undefined;
    const systemSubjectPubkey = isSystem ? (ev.tags ?? []).find((t: string[]) => t[0] === 'p')?.[1] : undefined;
    onMessage({ id: ev.id, pubkey: ev.pubkey, content, createdAt: ev.created_at, isSystem, ...(systemSubjectPubkey ? { systemSubjectPubkey } : {}), ...(isJoinRequest ? { isJoinRequest: true } : {}), ...(requestToken ? { requestToken } : {}), ...(emojis.length ? { emojis } : {}) });
  };

  const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24;

  // Load history from all chat relays — crew messages live on NIP-29 relays, but
  // join requests land on discovery relays (NIP-29 relays reject non-member posts).
  try {
    const history = await pool.querySync(CHAT_RELAYS, { kinds: [9], '#h': [gid], since, limit: 100 });
    // Dedupe by event id (same event may arrive from multiple relays)
    const seenIds = new Set<string>();
    const unique = history.filter((ev: any) => {
      if (seenIds.has(ev.id)) return false;
      seenIds.add(ev.id);
      return true;
    });
    for (const ev of unique.sort((a: any, b: any) => a.created_at - b.created_at)) {
      await emit(ev);
    }
  } catch (_) {}

  // Live subscription via RelayManager — same persistent WebSocket push as DMs, no polling delay
  const rm = new RelayManager();
  rm.connectAll();
  rm.subscribe(
    `crew-chat-${gid}`,
    [{ kinds: [9], '#h': [gid], since: Math.floor(Date.now() / 1000) }],
    (ev: any) => { emit(ev).catch(() => {}); }
  );

  return () => rm.destroy();
}

/** Send a chat message to the crew's NIP-29 group. */
export async function sendCrewChat(crewId: string, content: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const chatKey = crewCache.get(crewId)?.chatKey;
  const payload = chatKey ? await encryptContent(content, chatKey) : content;
  // Embed emoji tags so receivers can render custom emojis without having the pack
  const emojiTags = extractEmojiTags(content).map(e => ['emoji', e.code, e.url]);

  const event = await signEvent({
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', groupId(crewId)], ...emojiTags, ['client', 'Nostr District']],
    content: payload,
    pubkey,
  });
  await publishToChat(event);
}

/** Publish a system announcement to crew chat (join/leave/kick notices). */
async function sendCrewSystemMessage(crewId: string, text: string, subjectPubkey?: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return;
  const chatKey = crewCache.get(crewId)?.chatKey;
  const payload = chatKey ? await encryptContent(text, chatKey) : text;
  try {
    const tags: string[][] = [['h', groupId(crewId)], ['t', 'nd-system'], ['client', 'Nostr District']];
    if (subjectPubkey) tags.push(['p', subjectPubkey]);
    const event = await signEvent({
      kind: 9,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: payload,
      pubkey,
    });
    await publishToChat(event);
  } catch (e) {
    console.warn('[Crews] system message failed:', e);
  }
}

/**
 * Publish a join request to the crew's chat channel.
 * Non-members don't have the chatKey so this goes unencrypted — that's fine since
 * it's just a public request. Members with privileges see an Accept button in chat.
 */
export async function sendJoinRequest(crewId: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');
  const token = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('');
  const event = await signEvent({
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', groupId(crewId)], ['t', 'nd-joinreq'], ['p', pubkey], ['token', token], ['client', 'Nostr District']],
    content: '',
    pubkey,
  });
  await publishToChat(event);
}

/**
 * Publish a system message announcing a join request was declined.
 * Tagged with `p` = requester pubkey so other clients can match and remove the
 * corresponding join-request card, mirroring how "joined the crew" clears it on accept.
 */
export async function declineCrewJoinRequest(crewId: string, requesterPubkey: string): Promise<void> {
  const profile = await fetchProfile(requesterPubkey).catch(() => null);
  const name = profile?.display_name || profile?.name || requesterPubkey.slice(0, 8) + '…';
  await sendCrewSystemMessage(crewId, `${name}'s request to join was declined`, requesterPubkey);
}

// ── Background join-request notifications ────────────────────────────────────
// Lets users see new join requests on their crews even when the crew chat is closed.
// Subscribes to NIP-29 chat relays for every crew where the user is founder/admin/officer
// and emits a notification when a fresh request arrives.

export interface JoinReqNotification {
  crewId: string;
  crewName: string;
  requesterPubkey: string;
  createdAt: number;
}

const joinReqListeners: ((req: JoinReqNotification) => void)[] = [];
const joinReqDedupe = new Set<string>();
let joinReqRm: RelayManager | null = null;

export function onCrewJoinRequest(handler: (req: JoinReqNotification) => void): () => void {
  joinReqListeners.push(handler);
  return () => {
    const i = joinReqListeners.indexOf(handler);
    if (i >= 0) joinReqListeners.splice(i, 1);
  };
}

export async function startCrewJoinReqSubscription(): Promise<void> {
  const { pubkey } = authStore.getState();
  if (!pubkey) return;
  joinReqRm?.destroy();
  joinReqRm = null;

  // Find crews where the user has authority to handle requests
  const crews = await fetchMyCrews().catch(() => [] as Crew[]);
  const watchable = crews.filter(c =>
    c.founderPubkey === pubkey || isCrewAdmin(c.id, pubkey) || isCrewOfficer(c.id, pubkey)
  );
  if (watchable.length === 0) return;

  const crewByGid = new Map<string, Crew>(watchable.map(c => [groupId(c.id), c]));
  const gids = [...crewByGid.keys()];

  joinReqRm = new RelayManager(NIP29_RELAYS);
  joinReqRm.connectAll();
  joinReqRm.subscribe(
    `crew-joinreqs-${pubkey.slice(0, 8)}`,
    [{ kinds: [9], '#h': gids, '#t': ['nd-joinreq'], since: Math.floor(Date.now() / 1000) }],
    (ev: any) => {
      if (joinReqDedupe.has(ev.id)) return;
      joinReqDedupe.add(ev.id);
      const requester = ev.tags?.find((t: string[]) => t[0] === 'p')?.[1];
      const gid = ev.tags?.find((t: string[]) => t[0] === 'h')?.[1];
      const crew = crewByGid.get(gid ?? '');
      if (!requester || !crew || requester === pubkey) return;
      joinReqListeners.forEach(fn => fn({
        crewId: crew.id, crewName: crew.name, requesterPubkey: requester, createdAt: ev.created_at,
      }));
    }
  );
}

export function stopCrewJoinReqSubscription(): void {
  joinReqRm?.destroy();
  joinReqRm = null;
}

// ── Posts (kind:9 with #t nd-post, on all relays) ─────────────────────────────

/** Fetch crew posts — decrypts content using the crew's chatKey. */
export async function fetchCrewAnnouncements(crewId: string, _founderPubkey?: string, limit = 20): Promise<CrewAnnouncement[]> {
  await ensurePool();
  const gid = groupId(crewId);
  const chatKey = crewCache.get(crewId)?.chatKey;
  try {
    const events = await pool.querySync(CHAT_RELAYS, { kinds: [9], '#h': [gid], limit: 200 });
    const posts = events
      .filter((ev: any) => ev.tags?.some((t: string[]) => t[0] === 't' && t[1] === 'nd-post'))
      .sort((a: any, b: any) => b.created_at - a.created_at)
      .slice(0, limit);

    return Promise.all(posts.map(async (ev: any) => {
      let content = ev.content;
      if (chatKey) {
        try { content = await decryptContent(ev.content, chatKey); } catch (_) {}
      }
      return { id: ev.id, pubkey: ev.pubkey, content, createdAt: ev.created_at };
    }));
  } catch (e) {
    console.warn('[Crews] fetchCrewAnnouncements failed:', e);
    return [];
  }
}

/** Post an announcement — encrypts content using the crew's chatKey. */
export async function postCrewAnnouncement(crewId: string, content: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const chatKey = crewCache.get(crewId)?.chatKey;
  const payload = chatKey ? await encryptContent(content, chatKey) : content;

  const event = await signEvent({
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', groupId(crewId)], ['t', 'nd-post'], ['client', 'Nostr District']],
    content: payload,
    pubkey,
  });
  await publishToChat(event);
}

/** Kick a member. Publishes NIP-29 kind:9001 AND republishes crew def with kicked pubkey so client picks it up. */
export async function kickCrewMember(crewId: string, memberPubkey: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  // NIP-29 remove-user (best effort)
  try {
    const event = await signEvent({
      kind: 9001,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(crewId)], ['p', memberPubkey], ['client', 'Nostr District']],
      content: '',
      pubkey,
    });
    await publishToNip29(event);
  } catch (e) {
    console.warn('[Crews] NIP-29 kick failed:', e);
  }

  // Republish crew def with kicked pubkey so other clients detect the kick
  const crew = crewCache.get(crewId);
  if (crew) {
    const kickedPubkeys = [...new Set([...(crew.kickedPubkeys ?? []), memberPubkey])];
    // Clear pending reinvite state and strip any admin role — kicked members lose their rank
    const pendingReinvites = { ...(crew.pendingReinvites ?? {}) };
    delete pendingReinvites[memberPubkey];
    const memberRoles = { ...(crew.memberRoles ?? {}) };
    delete memberRoles[memberPubkey];
    const kickEmblemEmojiTags = extractEmojiTags(crew.emblem).map(e => ['emoji', e.code, e.url]);
    const defEvent = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', CREW_DEF_PREFIX + crewId], ['t', 'nostr-district'], ...kickEmblemEmojiTags, ['client', 'Nostr District']],
      content: JSON.stringify({
        name: crew.name, about: crew.about, emblem: crew.emblem,
        color: crew.color, isOpen: crew.isOpen, chatKey: crew.chatKey,
        founderTitle: crew.founderTitle || undefined,
        memberRoles, kickedPubkeys, pendingReinvites,
      }),
      pubkey,
    });
    await publishEvent(defEvent);
    crewCache.set(crewId, { ...crew, memberRoles, kickedPubkeys, pendingReinvites });
    // Announce kick — resolve name first
    fetchProfile(memberPubkey).then(p => {
      const name = p?.display_name || p?.name || memberPubkey.slice(0, 8) + '…';
      sendCrewSystemMessage(crewId, `${name} was removed from the crew`).catch(() => {});
    }).catch(() => {
      sendCrewSystemMessage(crewId, `${memberPubkey.slice(0, 8)}… was removed from the crew`).catch(() => {});
    });
  }
}

/** Remove a pubkey from the kicked list and republish the crew def so they can rejoin. */
export async function unKickCrewMember(crewId: string, memberPubkey: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const crew = crewCache.get(crewId);
  if (!crew) return;

  const kickedPubkeys = (crew.kickedPubkeys ?? []).filter(p => p !== memberPubkey);
  // Record the unkick timestamp — fetchCrewMembers uses this to require a fresh
  // kind:9021 join event (after this timestamp) before showing the member again
  const pendingReinvites: Record<string, number> = { ...(crew.pendingReinvites ?? {}) };
  pendingReinvites[memberPubkey] = Math.floor(Date.now() / 1000);
  const unkickEmblemEmojiTags = extractEmojiTags(crew.emblem).map(e => ['emoji', e.code, e.url]);
  const defEvent = await signEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CREW_DEF_PREFIX + crewId], ['t', 'nostr-district'], ...unkickEmblemEmojiTags, ['client', 'Nostr District']],
    content: JSON.stringify({
      name: crew.name, about: crew.about, emblem: crew.emblem,
      color: crew.color, isOpen: crew.isOpen, chatKey: crew.chatKey,
      founderTitle: crew.founderTitle || undefined,
      memberRoles: crew.memberRoles, kickedPubkeys, pendingReinvites,
    }),
    pubkey,
  });
  await publishEvent(defEvent);
  crewCache.set(crewId, { ...crew, kickedPubkeys, pendingReinvites });
}

/** Returns true if pubkey is the founder or has been granted admin role. */
export function isCrewAdmin(crewId: string, pubkey: string): boolean {
  const crew = crewCache.get(crewId);
  if (!crew) return false;
  if (crew.founderPubkey === pubkey) return true;
  return crew.memberRoles?.[pubkey]?.role === 'admin';
}

export function isCrewOfficer(crewId: string, pubkey: string): boolean {
  const crew = crewCache.get(crewId);
  if (!crew) return false;
  return crew.memberRoles?.[pubkey]?.role === 'officer';
}

/**
 * Update a member's role and/or custom title.
 * Founders can set any role (admin/officer/member).
 * Admins can only set officer or member (cannot grant admin).
 * Republishes the kind:30078 crew definition with updated memberRoles.
 */
export async function updateCrewMember(
  crewId: string,
  memberPubkey: string,
  role: 'admin' | 'officer' | 'member',
  title?: string
): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const crew = crewCache.get(crewId);
  if (!crew) throw new Error('Crew not found');

  const callerIsFounder = crew.founderPubkey === pubkey;
  const callerIsAdmin = !callerIsFounder && (crew.memberRoles?.[pubkey]?.role === 'admin');
  if (!callerIsFounder && !callerIsAdmin) throw new Error('Only founders and admins can manage members');
  if (callerIsAdmin && role === 'admin') throw new Error('Admins cannot grant admin rank');

  const memberRoles: Record<string, MemberRole> = { ...(crew.memberRoles ?? {}) };
  if (title !== undefined && title.trim()) {
    memberRoles[memberPubkey] = { role, title: title.trim() };
  } else {
    memberRoles[memberPubkey] = { role };
    if (memberRoles[memberPubkey].title) delete memberRoles[memberPubkey].title;
  }
  const roleEmblemEmojiTags = extractEmojiTags(crew.emblem).map(e => ['emoji', e.code, e.url]);
  const defEvent = await signEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CREW_DEF_PREFIX + crewId], ['t', 'nostr-district'], ...roleEmblemEmojiTags, ['client', 'Nostr District']],
    content: JSON.stringify({
      name: crew.name, about: crew.about, emblem: crew.emblem,
      color: crew.color, isOpen: crew.isOpen, chatKey: crew.chatKey, memberRoles,
      founderTitle: crew.founderTitle || undefined,
      kickedPubkeys: crew.kickedPubkeys, pendingReinvites: crew.pendingReinvites,
    }),
    pubkey,
  });
  await publishEvent(defEvent);
  crewCache.set(crewId, { ...crew, memberRoles });

  // Announce role change in chat
  const RANK = { admin: 2, officer: 1, member: 0 } as const;
  const oldRole = (crew.memberRoles ?? {})[memberPubkey]?.role ?? 'member';
  if (oldRole !== role) {
    const roleLabel = role === 'admin' ? 'Admin' : role === 'officer' ? 'Officer' : 'Member';
    const verb = RANK[role] > RANK[oldRole as keyof typeof RANK] ? 'promoted to' : 'demoted to';
    fetchProfile(memberPubkey).then(p => {
      const name = p?.display_name || p?.name || memberPubkey.slice(0, 8) + '…';
      sendCrewSystemMessage(crewId, `${name} has been ${verb} ${roleLabel}`).catch(() => {});
    }).catch(() => {
      sendCrewSystemMessage(crewId, `${memberPubkey.slice(0, 8)}… has been ${verb} ${roleLabel}`).catch(() => {});
    });
  }
}

/** Update crew definition fields (name, about, emblem, color, isOpen). Founder only. */
export async function updateCrewDefinition(
  crewId: string,
  fields: { name?: string; about?: string; emblem?: string; color?: string; isOpen?: boolean; founderTitle?: string }
): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');
  const crew = crewCache.get(crewId);
  if (!crew) throw new Error('Crew not found');
  if (crew.founderPubkey !== pubkey) throw new Error('Only the founder can edit the crew');
  const updated = { ...crew, ...fields };
  const updatedEmblemEmojiTags = extractEmojiTags(updated.emblem).map(e => ['emoji', e.code, e.url]);
  const defEvent = await signEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CREW_DEF_PREFIX + crewId], ['t', 'nostr-district'], ...updatedEmblemEmojiTags, ['client', 'Nostr District']],
    content: JSON.stringify({
      name: updated.name, about: updated.about, emblem: updated.emblem,
      color: updated.color, isOpen: updated.isOpen, chatKey: crew.chatKey,
      founderTitle: updated.founderTitle || undefined,
      memberRoles: crew.memberRoles, kickedPubkeys: crew.kickedPubkeys,
      pendingReinvites: crew.pendingReinvites,
    }),
    pubkey,
  });
  await publishEvent(defEvent);
  crewCache.set(crewId, updated);
}

/** Delete a crew post (kind:5 targeting the post event). */
export async function deleteCrewAnnouncement(eventId: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const kind5 = await signEvent({
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', eventId], ['client', 'Nostr District']],
    content: 'Post deleted',
    pubkey,
  });
  await publishToChat(kind5);
}

// ── Name resolution ───────────────────────────────────────────────────────────

const nameCache = new Map<string, string>();

export async function resolveNames(pubkeys: string[]): Promise<Map<string, string>> {
  const missing = pubkeys.filter(pk => !nameCache.has(pk));
  await Promise.allSettled(missing.map(pk =>
    fetchProfile(pk).then(p => {
      const name = p?.display_name || p?.name;
      if (name) nameCache.set(pk, name); // only cache if we got a real name; failed lookups retry next time
    })
  ));
  return nameCache;
}

export function getCachedName(pubkey: string): string {
  if (nameCache.has(pubkey)) return nameCache.get(pubkey)!;
  try { const npub = nip19.npubEncode(pubkey); return npub.slice(0, 12) + '…'; } catch { return pubkey.slice(0, 8) + '…'; }
}

export function shortNpub(pubkey: string): string {
  try { const npub = nip19.npubEncode(pubkey); return npub.slice(0, 12) + '…'; } catch { return pubkey.slice(0, 8) + '…'; }
}
