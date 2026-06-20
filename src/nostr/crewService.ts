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

import { nip19, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { authStore } from '../stores/authStore';
import { signEvent, publishEvent, fetchProfile } from './nostrService';
import { DEFAULT_RELAYS, RelayManager } from './relayManager';
import { extractEmojiTags } from './emojiService';
import { getCrewKey, setCrewKey, clearCrewKey } from './crewKeyCache';
import { getCrewSk, setCrewSk, clearCrewSk, listCrewSkIds } from './crewSkCache';
import { onDMReceived, sendDirectMessage } from './dmService';

// ── Constants ─────────────────────────────────────────────────────────────────

const NIP29_RELAYS     = ['wss://groups.0xchat.com', 'wss://relay.groups.nip29.com'];
const CREW_DEF_PREFIX  = 'nd-crew-';     // def d-tag — author is the crew's shared crewPk
const CREW_PTR_PREFIX  = 'nd-crew-ptr-'; // pointer d-tag — author is the founder's personal pubkey
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
  founderPubkey: string;  // from the pointer event — cryptographic founder identity
  crewPk: string;         // from the pointer — shared crew identity pubkey signing the def
  isOpen: boolean;
  createdAt: number;
  chatKey?: string;   // 32-byte hex — NIP-44 conversation key for crew chat + posts
  wrappedChatKey?: string; // closed crews: chatKey NIP-44-encrypted from crewSk → crewPk
  memberCount?: number;
  memberRoles?: Record<string, MemberRole>; // pubkey → role/title
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

// NOTE on crew chat encryption:
// - OPEN crews: the `chatKey` is published in plaintext in the public crew def.
//   That's intentional — open crews accept all joiners freely so encryption is
//   pure obfuscation against passive scrapers, not real privacy.
// - CLOSED crews: the chatKey is stored as `wrappedChatKey` (NIP-44 founder-
//   self-encrypted) in the crew def and distributed to approved members via
//   gift-wrapped DMs at accept time. The plaintext `chatKey` field is NOT
//   written for closed crews.
async function encryptContent(plaintext: string, chatKey: string): Promise<string> {
  await ensureNip44();
  return nip44.encrypt(plaintext, hexToBytes(chatKey));
}

/**
 * Returns the effective chatKey to use for encrypt/decrypt operations.
 * - Closed crews: check the cache (filled from gift-wrap DMs or admin self-unwrap)
 * - Open crews: fall back to the plaintext chatKey from the crew def
 */
async function getEffectiveChatKey(crewId: string): Promise<string | null> {
  const cached = await getCrewKey(crewId);
  if (cached) return cached;
  return crewCache.get(crewId)?.chatKey ?? null;
}

/**
 * If we hold the crewSk for this crew (founder or admin) and haven't cached
 * the chatKey yet, decrypt wrappedChatKey using crewSk → crewPk and cache it.
 * This is the path that gives any admin access to chat without a separate
 * gift-wrap DM at promotion time.
 */
async function hydrateAdminChatKey(crew: Crew): Promise<void> {
  if (!crew.wrappedChatKey || !crew.crewPk) return;
  const existing = await getCrewKey(crew.id);
  if (existing) return;
  const crewSk = await getCrewSk(crew.id);
  if (!crewSk) return;
  try {
    const chatKey = await unwrapChatKeyForCrew(crew.wrappedChatKey, crewSk, crew.crewPk);
    await setCrewKey(crew.id, chatKey);
  } catch (e) {
    console.warn('[Crews] Failed to unwrap chatKey for crew', crew.id, e);
  }
}

/**
 * Resolve the chatKey for a crew, hydrating it from the def + crewSk if not
 * already cached. Returns null only when neither path is available (open crew
 * with a plain chatKey will hit the cache fallback below).
 *
 * Use this whenever you need the chatKey synchronously for a user action
 * (e.g., sending it to a newly-accepted member). For background reads you
 * can keep calling getCrewKey() directly.
 */
export async function ensureChatKey(crewId: string): Promise<string | null> {
  const cached = await getCrewKey(crewId);
  if (cached) return cached;
  const crew = crewCache.get(crewId);
  if (!crew) return null;
  if (crew.isOpen && crew.chatKey) return crew.chatKey;
  await hydrateAdminChatKey(crew);
  return getCrewKey(crewId);
}

async function decryptContent(ciphertext: string, chatKey: string): Promise<string> {
  await ensureNip44();
  return nip44.decrypt(ciphertext, hexToBytes(chatKey));
}

// ── Crew identity keypair (v2 authority model) ───────────────────────────────
//
// Each crew has its own (crewSk, crewPk). The crew definition event is signed
// by `crewSk`, so any holder of the secret key (founder + admins) can publish
// authoritative updates. The founder's personal nsec signs a separate pointer
// event that names the current `crewPk` — only the founder can rotate it.

/** Generate a fresh crew identity keypair. */
function genCrewKeypair(): { crewSk: string; crewPk: string } {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { crewSk: bytesToHexLocal(sk), crewPk: pk };
}

function bytesToHexLocal(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Sign an event template with a raw secret key (deterministic, no signer prompt). */
function signWithKey(secretKeyHex: string, template: { kind: number; created_at: number; tags: string[][]; content: string }): any {
  return finalizeEvent({ ...template }, hexToBytes(secretKeyHex));
}

/** Wrap a chatKey to the crew identity using crewSk → crewPk NIP-44 self-encrypt. */
async function wrapChatKeyForCrew(chatKeyHex: string, crewSkHex: string, crewPkHex: string): Promise<string> {
  await ensureNip44();
  const convKey = nip44.getConversationKey(hexToBytes(crewSkHex), crewPkHex);
  return nip44.encrypt(chatKeyHex, convKey);
}

/** Unwrap a chatKey that was wrapped for the crew identity. */
async function unwrapChatKeyForCrew(wrapped: string, crewSkHex: string, crewPkHex: string): Promise<string> {
  await ensureNip44();
  const convKey = nip44.getConversationKey(hexToBytes(crewSkHex), crewPkHex);
  return nip44.decrypt(wrapped, convKey);
}

// ── Pointer event (founder-signed → names current crewPk) ────────────────────

export interface CrewPointer {
  crewPk: string;
  founderPubkey: string;
  createdAt: number;
}

const pointerCache = new Map<string, CrewPointer>();

function parsePointer(event: any): CrewPointer | null {
  try {
    const data = JSON.parse(event.content);
    if (!data || data.deleted) return null;
    if (typeof data.crewPk !== 'string' || !/^[0-9a-f]{64}$/.test(data.crewPk)) return null;
    return { crewPk: data.crewPk, founderPubkey: event.pubkey, createdAt: event.created_at ?? 0 };
  } catch { return null; }
}

/**
 * Publish the pointer event (founder-signed) naming the current crewPk for
 * this crew. Returns true only if at least one relay accepted the event —
 * callers MUST check, because a failed pointer publish silently breaks crew
 * discovery (createCrew) and revocation (rotateCrewKey).
 */
async function publishCrewPointer(crewId: string, crewPk: string): Promise<boolean> {
  const { pubkey } = authStore.getState();
  if (!pubkey) throw new Error('Must be logged in');
  const event = await signEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CREW_PTR_PREFIX + crewId], ['t', 'nostr-district']],
    content: JSON.stringify({ crewPk }),
    pubkey,
  });
  const ok = await publishEvent(event);
  if (ok) pointerCache.set(crewId, { crewPk, founderPubkey: pubkey, createdAt: event.created_at });
  return ok;
}

/**
 * Fetch the canonical pointer for a crew. If multiple authors have published
 * pointers under the same crewId d-tag (squatting / collision), the oldest
 * wins — first-publisher is canonical. crewIds are random 8-byte values, so
 * collisions are practically nonexistent; this rule just makes behavior
 * deterministic across clients if it ever happens.
 */
async function fetchCrewPointer(crewId: string, forceRefresh = false): Promise<CrewPointer | null> {
  if (!forceRefresh && pointerCache.has(crewId)) return pointerCache.get(crewId)!;
  await ensurePool();
  try {
    const events: any[] = await pool.querySync(DISCOVERY_RELAYS, {
      kinds: [30078], '#d': [CREW_PTR_PREFIX + crewId],
    }, { maxWait: 4000 });
    if (!events.length) return null;
    // Pick the canonical pointer: earliest created_at wins; among ties, lowest pubkey.
    let canonical: any | null = null;
    for (const ev of events) {
      const p = parsePointer(ev);
      if (!p) continue;
      if (!canonical) { canonical = ev; continue; }
      if (ev.created_at < canonical.created_at ||
          (ev.created_at === canonical.created_at && ev.pubkey < canonical.pubkey)) {
        canonical = ev;
      }
    }
    if (!canonical) return null;
    // Among events with the SAME pubkey as the canonical author, take the latest
    // (replaceable event semantics — canonical author can rotate crewPk).
    let latestByAuthor: any = canonical;
    for (const ev of events) {
      if (ev.pubkey !== canonical.pubkey) continue;
      if (ev.created_at > latestByAuthor.created_at) latestByAuthor = ev;
    }
    const parsed = parsePointer(latestByAuthor);
    if (parsed) pointerCache.set(crewId, parsed);
    return parsed;
  } catch { return null; }
}

/** Cache a pointer entry locally without hitting relays (used when we just published it). */
function setPointerCache(crewId: string, ptr: CrewPointer): void {
  pointerCache.set(crewId, ptr);
}

/**
 * Parse a crew def event into a Crew object. The def is signed by crewSk, so
 * `event.pubkey === crewPk` and the canonical founder identity must come from
 * the pointer (passed in as `pointer`). If `pointer.crewPk !== event.pubkey`,
 * the def is stale (signed by a rotated-away key) and we return null.
 *
 * Defs that kick the founder named by the pointer are ignored — an admin
 * cannot oust the founder; the founder's recourse is a full crewSk rotation.
 */
function parseCrew(event: any, pointer: CrewPointer): Crew | null {
  try {
    if (event.pubkey !== pointer.crewPk) return null; // stale or rogue def
    const data = JSON.parse(event.content);
    const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
    const id = dTag.replace(CREW_DEF_PREFIX, '');
    if (!id || !data.name || data.deleted) return null; // skip tombstones
    if (getDeletedCrews().has(id)) return null;         // skip locally deleted
    const kickedPubkeys: string[] = (data.kickedPubkeys ?? []).filter(
      (pk: string) => pk !== pointer.founderPubkey,
    );
    // Sync kicked/pending state with what the relay says (LOCAL ONLY).
    const myPubkey = authStore.getState().pubkey;
    if (myPubkey) {
      if (kickedPubkeys.includes(myPubkey)) {
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
      founderPubkey: pointer.founderPubkey,
      crewPk: pointer.crewPk,
      isOpen: data.isOpen !== false,
      createdAt: event.created_at ?? 0,
      chatKey: data.chatKey,
      wrappedChatKey: data.wrappedChatKey,
      memberRoles: data.memberRoles ?? {},
      kickedPubkeys,
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

  const check = (event: any) => {
    const ptr = pointerCache.get(crewId);
    if (ptr && event.pubkey !== ptr.crewPk) return; // stale def from rotated-away key
    try {
      const data = JSON.parse(event.content);
      // Founder can't be kicked even if a def claims otherwise
      if (ptr && pubkey === ptr.founderPubkey) return;
      if ((data.kickedPubkeys ?? []).includes(pubkey)) fire();
    } catch {}
  };

  const rm = new RelayManager(DISCOVERY_RELAYS);
  rm.connectAll();

  // Resolve the pointer once, then subscribe to defs authored by that crewPk.
  fetchCrewPointer(crewId).then(ptr => {
    if (!ptr || fired) return;
    rm.subscribe(
      `crew-kick-${crewId}-${pubkey.slice(0, 8)}`,
      [{ kinds: [30078], '#d': [CREW_DEF_PREFIX + crewId], authors: [ptr.crewPk] }],
      (ev: any) => check(ev)
    );
  }).catch(() => {});

  // Poll fallback — refresh pointer + def each tick in case of relay delivery gaps
  const poll = setInterval(() => {
    if (fired) { clearInterval(poll); return; }
    ensurePool().then(async () => {
      const ptr = await fetchCrewPointer(crewId, true);
      if (!ptr) return;
      const ev = await pool.get(DISCOVERY_RELAYS, {
        kinds: [30078], '#d': [CREW_DEF_PREFIX + crewId], authors: [ptr.crewPk],
      });
      if (ev) check(ev);
    }).catch(() => {});
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
      tags: [['d', `nd-invite-${token}`]],
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

/**
 * Publish a chat/post event to all relays (NIP-29 + regular). Returns the
 * number of relays that accepted the event. Callers that care about delivery
 * (e.g., chat send) can retry if this returns 0.
 */
async function publishToChat(event: any): Promise<number> {
  await ensurePool();
  const results = await Promise.allSettled(pool.publish(CHAT_RELAYS, event));
  return results.filter(r => r.status === 'fulfilled').length;
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

  // Generate the crew identity keypair — this is what signs the def event.
  // Founder retains a copy locally; admins receive theirs via gift-wrap DM on promotion.
  const { crewSk, crewPk } = genCrewKeypair();

  // 1. Publish crew definition signed by crewSk
  //    - Open crews:   plaintext chatKey in the def (obfuscation only)
  //    - Closed crews: wrappedChatKey (encrypted from crewSk → crewPk so any admin can decrypt)
  const chatKey = genChatKey();
  const defContent: Record<string, any> = { name, about, emblem, color, isOpen };
  if (isOpen) {
    defContent.chatKey = chatKey;
  } else {
    defContent.wrappedChatKey = await wrapChatKeyForCrew(chatKey, crewSk, crewPk);
  }
  await setCrewKey(id, chatKey); // cache plaintext chatKey for self
  await setCrewSk(id, crewSk);

  const emblemEmojiTags = extractEmojiTags(emblem).map(e => ['emoji', e.code, e.url]);
  const defEvent = signWithKey(crewSk, {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CREW_DEF_PREFIX + id], ['t', 'nostr-district'], ...emblemEmojiTags],
    content: JSON.stringify(defContent),
  });
  await publishEvent(defEvent);

  // 2. Publish the founder-signed pointer naming this crewPk. If this fails,
  //    the crew is invisible to other clients (and to ourselves on next session)
  //    because they discover crews via the pointer. Abort loudly so the user
  //    can retry rather than ending up with a phantom crew.
  const ptrOk = await publishCrewPointer(id, crewPk);
  if (!ptrOk) throw new Error('Failed to publish the crew pointer — please try again');

  // 3. Create the NIP-29 group on the relay (best-effort) — founder personal key
  try {
    const createEvent = await signEvent({
      kind: 9007,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(id)]],
      content: '',
      pubkey,
    });
    await publishToNip29(createEvent);
  } catch (e) {
    console.warn('[Crews] NIP-29 group create failed (relay may be unavailable):', e);
  }

  // 4. Founder joins automatically (best-effort)
  try {
    const joinEvent = await signEvent({
      kind: 9021,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(id)]],
      content: '',
      pubkey,
    });
    await publishToNip29(joinEvent);
  } catch (e) {
    console.warn('[Crews] NIP-29 join failed:', e);
  }

  addJoinedCrew(id);

  const crew: Crew = {
    id, name, about, emblem, color,
    founderPubkey: pubkey, crewPk, isOpen,
    createdAt: defEvent.created_at,
    ...(isOpen ? { chatKey } : { wrappedChatKey: defContent.wrappedChatKey as string }),
  };
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

  // Single query: all kind:30078 events authored by this pubkey.
  // Covers pointers (CREW_PTR_PREFIX — crews I founded) and membership cards
  // (MEMBER_PREFIX — crews I joined). Defs themselves are authored by crewPk,
  // so they don't show up here; we fetch them via fetchCrew below.
  let allUserEvents: any[] = [];
  try {
    allUserEvents = await pool.querySync(DISCOVERY_RELAYS, { kinds: [30078], authors: [pubkey], limit: 150 }, { maxWait: 6000 });
  } catch (e) {
    console.warn('[Crews] fetchMyCrews query failed:', e);
  }

  const dTag = (ev: any): string => ev.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '';

  // ── 1. Crews this user founded (via their pointer events) ────────────────
  const pointerEvents = allUserEvents.filter(ev => dTag(ev).startsWith(CREW_PTR_PREFIX));
  const byCrewId = new Map<string, any>();
  for (const ev of pointerEvents) {
    const id = dTag(ev).replace(CREW_PTR_PREFIX, '');
    if (!byCrewId.has(id) || ev.created_at > byCrewId.get(id).created_at) byCrewId.set(id, ev);
  }
  for (const [id, ptrEv] of byCrewId) {
    const ptr = parsePointer(ptrEv);
    if (!ptr) continue;
    pointerCache.set(id, ptr);
    addJoinedCrew(id);
    const crew = await fetchCrew(id, true);
    if (crew) resultMap.set(id, crew);
    await new Promise(r => setTimeout(r, 0));
  }

  // ── 2. Crews this user holds crewSk for (admin-promoted) ─────────────────
  // The crewSk cache is the source of truth for "where am I an admin?"
  for (const id of listCrewSkIds()) {
    if (resultMap.has(id)) continue;
    addJoinedCrew(id);
    const crew = await fetchCrew(id, true).catch(() => null);
    if (crew) resultMap.set(id, crew);
    await new Promise(r => setTimeout(r, 0));
  }

  // ── 3. Crews this user joined (membership cards) ─────────────────────────
  const membershipEvents = allUserEvents.filter(ev => dTag(ev).startsWith(MEMBER_PREFIX));
  const latestMembership = new Map<string, any>();
  for (const ev of membershipEvents) {
    const crewId = dTag(ev).replace(MEMBER_PREFIX, '');
    if (!latestMembership.has(crewId) || ev.created_at > latestMembership.get(crewId).created_at) {
      latestMembership.set(crewId, ev);
    }
  }
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
    } catch {}
    await new Promise(r => setTimeout(r, 0));
  }

  return [...resultMap.values()].sort((a, b) => b.createdAt - a.createdAt);
}

// ── fetchAllCrews TTL cache ───────────────────────────────────────────────────
let allCrewsCache: Crew[] = [];
let allCrewsCacheAt = 0;
const ALL_CREWS_TTL = 2 * 60 * 1000; // 2 minutes

/**
 * Fetch all public crews from regular relays. Two-stage query:
 *   1. Pull all pointers (one query, filtered by #t: nostr-district + d-tag prefix)
 *   2. Batch-fetch the defs they reference (one query, filtered by authors=[crewPks])
 * Results are cached for 2 minutes.
 */
export async function fetchAllCrews(forceRefresh = false): Promise<Crew[]> {
  if (!forceRefresh && allCrewsCache.length > 0 && Date.now() - allCrewsCacheAt < ALL_CREWS_TTL) {
    return allCrewsCache;
  }
  await ensurePool();

  // Stage 1: pointers
  let ptrEvents: any[] = [];
  try {
    ptrEvents = await pool.querySync(DISCOVERY_RELAYS, { kinds: [30078], '#t': ['nostr-district'], limit: 400 }, { maxWait: 6000 });
  } catch (e) {
    console.warn('[Crews] fetchAllCrews pointer query failed:', e);
    return allCrewsCache;
  }
  const pointers = new Map<string, CrewPointer>();
  // Group by crewId, pick canonical (earliest, tiebreak by lowest pubkey), then latest for that author
  type Bucket = { canonical: any; latestByAuthor: any };
  const buckets = new Map<string, Bucket>();
  for (const ev of ptrEvents) {
    const dt = ev.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
    if (!dt.startsWith(CREW_PTR_PREFIX)) continue;
    const id = dt.replace(CREW_PTR_PREFIX, '');
    const b = buckets.get(id);
    if (!b) { buckets.set(id, { canonical: ev, latestByAuthor: ev }); continue; }
    if (ev.created_at < b.canonical.created_at ||
        (ev.created_at === b.canonical.created_at && ev.pubkey < b.canonical.pubkey)) {
      b.canonical = ev;
      b.latestByAuthor = ev;
    } else if (ev.pubkey === b.canonical.pubkey && ev.created_at > b.latestByAuthor.created_at) {
      b.latestByAuthor = ev;
    }
  }
  for (const [id, b] of buckets) {
    const p = parsePointer(b.latestByAuthor);
    if (p) { pointers.set(id, p); pointerCache.set(id, p); }
  }
  if (pointers.size === 0) {
    allCrewsCache = [];
    allCrewsCacheAt = Date.now();
    return [];
  }

  // Stage 2: defs authored by any of these crewPks
  const authors = [...new Set([...pointers.values()].map(p => p.crewPk))];
  let defEvents: any[] = [];
  try {
    defEvents = await pool.querySync(DISCOVERY_RELAYS, { kinds: [30078], authors, limit: 400 }, { maxWait: 6000 });
  } catch (e) {
    console.warn('[Crews] fetchAllCrews def query failed:', e);
    return allCrewsCache;
  }

  const latestDefByCrewId = new Map<string, any>();
  for (const ev of defEvents) {
    const dt = ev.tags?.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
    if (!dt.startsWith(CREW_DEF_PREFIX)) continue;
    const id = dt.replace(CREW_DEF_PREFIX, '');
    const ptr = pointers.get(id);
    if (!ptr || ev.pubkey !== ptr.crewPk) continue; // ignore stale defs
    const cur = latestDefByCrewId.get(id);
    if (!cur || ev.created_at > cur.created_at) latestDefByCrewId.set(id, ev);
  }

  const crews: Crew[] = [];
  for (const [id, ev] of latestDefByCrewId) {
    const c = parseCrew(ev, pointers.get(id)!);
    if (c) crews.push(c);
  }
  crews.forEach(c => crewCache.set(c.id, c));
  Promise.all(crews.map(hydrateAdminChatKey)).catch(() => {});

  const sorted = crews.sort((a, b) => b.createdAt - a.createdAt);
  allCrewsCache = sorted;
  allCrewsCacheAt = Date.now();
  return sorted;
}

/** Fetch a single crew by id. Resolves pointer first, then the def authored by crewPk. */
export async function fetchCrew(id: string, forceRefresh = false): Promise<Crew | null> {
  const cached = crewCache.get(id);
  if (cached && (cached.chatKey || cached.wrappedChatKey) && !forceRefresh) return cached;
  await ensurePool();
  const ptr = await fetchCrewPointer(id, forceRefresh);
  if (!ptr) return null;
  try {
    const ev = await pool.get(DISCOVERY_RELAYS, {
      kinds: [30078], '#d': [CREW_DEF_PREFIX + id], authors: [ptr.crewPk],
    });
    if (!ev) return null;
    const crew = parseCrew(ev, ptr);
    if (crew) {
      crewCache.set(id, crew);
      hydrateAdminChatKey(crew).catch(() => {});
    }
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
      tags: [['h', groupId(crewId)]],
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
      tags: [['d', memberDTag(crewId)]],
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

  const crew = crewCache.get(crewId);
  const crewName = crew?.name ?? 'this crew';
  if (crew && crew.founderPubkey !== pubkey) throw new Error('Only the founder can delete the crew');

  // 1. Local cleanup FIRST — UI sees clean state immediately
  markCrewDeleted(crewId);
  crewCache.delete(crewId);
  pointerCache.delete(crewId);
  removeJoinedCrew(crewId);
  allCrewsCache = allCrewsCache.filter(c => c.id !== crewId);

  // 2. Notify members via system message
  try {
    await sendCrewSystemMessage(crewId, `${crewName} has been dissolved by the founder.`);
  } catch (_) {}

  // 3. Def tombstone — overwrite the crewSk-signed def with deleted:true
  const crewSk = await getCrewSk(crewId);
  if (crewSk) {
    try {
      const tombstone = signWithKey(crewSk, {
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', CREW_DEF_PREFIX + crewId], ['t', 'nostr-district']],
        content: JSON.stringify({ deleted: true }),
      });
      await publishEvent(tombstone);
    } catch (e) {
      console.warn('[Crews] def tombstone publish failed:', e);
    }
  }

  // 4. Pointer tombstone — overwrites the founder-signed pointer with deleted:true
  try {
    const ptrTombstone = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', CREW_PTR_PREFIX + crewId], ['t', 'nostr-district']],
      content: JSON.stringify({ deleted: true }),
      pubkey,
    });
    await publishEvent(ptrTombstone);
  } catch (e) {
    console.warn('[Crews] pointer tombstone publish failed:', e);
  }

  // 5. Clean up local secrets
  await clearCrewSk(crewId).catch(() => {});
  await clearCrewKey(crewId).catch(() => {});

  // 6. NIP-29 group deletion — best effort
  try {
    const deleteGroupEvent = await signEvent({
      kind: 9008,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(crewId)]],
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

  // Announce leave FIRST while we still have membership on the NIP-29 relay,
  // otherwise the leave message gets rejected by the relay once kind:9022
  // strips us from the group.
  try {
    const profile = await fetchProfile(pubkey).catch(() => null);
    const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + '…';
    await sendCrewSystemMessage(crewId, `${name} left the crew`, pubkey);
  } catch (e) {
    console.warn('[Crews] Leave announcement failed:', e);
  }

  // NIP-29 leave (best-effort)
  try {
    const event = await signEvent({
      kind: 9022,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(crewId)]],
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
      tags: [['d', memberDTag(crewId)]],
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
      tags: [['d', memberDTag(crewId)]],
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

    // Final fallback: anyone the founder explicitly granted an admin/officer
    // role to in the crew def, even if their membership card is missing or
    // corrupted (e.g. active:false from a prior bug). The founder considers
    // them part of the crew; they should appear.
    for (const [pubkey, role] of Object.entries(storedRoles)) {
      if (seen.has(pubkey)) continue;
      if (kickedSet.has(pubkey)) continue;
      seen.add(pubkey);
      members.push({
        pubkey,
        role: role.role,
        title: role.title,
        joinedAt: 0,
      });
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

  // Ensure the crew def AND the decryption chatKey are both ready before we
  // start processing history events. Without this, admins opening a closed
  // crew for the first time see an empty chat because every historical event
  // fails to decrypt (cache is empty when emit() is called) and gets silently
  // skipped — the late-arriving chatKey only helps future events, not the
  // already-processed history.
  const cachedDef = crewCache.get(crewId);
  if (!cachedDef?.chatKey && !cachedDef?.wrappedChatKey) {
    await fetchCrew(crewId).catch(() => {});
  }
  await ensureChatKey(crewId).catch(() => {});

  const emit = async (ev: any) => {
    if (seen.has(ev.id)) return;
    if (ev.tags?.some((t: string[]) => t[0] === 't' && t[1] === 'nd-post')) return;
    const isSystem = ev.tags?.some((t: string[]) => t[0] === 't' && t[1] === 'nd-system');
    const isJoinRequest = ev.tags?.some((t: string[]) => t[0] === 't' && t[1] === 'nd-joinreq');
    seen.add(ev.id);
    let content = ev.content;
    // Join requests are unencrypted — skip decryption attempt.
    // Note: look up the chatKey dynamically here (not captured in closure)
    // so that late-arriving keys (e.g. gift-wrap DM processed after the
    // subscription started) can decrypt messages that have already been buffered.
    if (!isJoinRequest) {
      const liveChatKey = await getEffectiveChatKey(crewId);
      if (liveChatKey) {
        try {
          content = await decryptContent(ev.content, liveChatKey);
        } catch (_) {
          // Decryption failed — most likely the founder rotated the chatKey
          // (kick rotation). Re-fetch the crew def to see if we got kicked.
          // If yes, trigger onKick so the UI closes; either way skip showing
          // the ciphertext.
          if (onKick && myPubkey) {
            fetchCrew(crewId, true).then(c => {
              if (c && (c.kickedPubkeys ?? []).includes(myPubkey)) {
                markKickedLocally(crewId);
                clearMembership(crewId).catch(() => {});
                clearCrewKey(crewId).catch(() => {});
                onKick();
              }
            }).catch(() => {});
          }
          return;
        }
      } else if (ev.content && /^[A-Za-z0-9+/=]{20,}$/.test(ev.content.trim())) {
        // No key at all but the content looks like NIP-44 ciphertext — skip
        // rather than show garbage. (Open crews with no chat key fall through.)
        return;
      }
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

  // Live subscription via RelayManager — same persistent WebSocket push as DMs, no polling delay.
  // Must include the NIP-29 relays explicitly: sendCrewChat publishes to CHAT_RELAYS
  // (NIP-29 + discovery), so a default RelayManager (DM + DEFAULT only) would miss messages
  // that land exclusively on the NIP-29 relays.
  const rm = new RelayManager(CHAT_RELAYS);
  rm.connectAll();
  rm.subscribe(
    `crew-chat-${gid}`,
    [{ kinds: [9], '#h': [gid], since: Math.floor(Date.now() / 1000) }],
    (ev: any) => { emit(ev).catch(() => {}); }
  );

  // Poll fallback: live WebSockets occasionally miss events (relay drop,
  // reconnect window, NIP-29 quirks). Every 5s, querySync recent events and
  // emit anything the live sub missed. seen-set dedupes against history +
  // live so users don't see duplicates.
  let pollSince = Math.floor(Date.now() / 1000) - 10;
  const pollInterval = setInterval(async () => {
    try {
      const recent = await pool.querySync(CHAT_RELAYS, { kinds: [9], '#h': [gid], since: pollSince, limit: 100 });
      const next = pollSince;
      let maxTs = next;
      const sorted = recent.sort((a: any, b: any) => a.created_at - b.created_at);
      for (const ev of sorted) {
        if (ev.created_at > maxTs) maxTs = ev.created_at;
        await emit(ev);
      }
      // Step the since cursor forward (minus 5s overlap so we never skip an
      // event that arrived in the gap between two polls).
      pollSince = Math.max(maxTs - 5, next);
    } catch (_) {}
  }, 5000);

  return () => { clearInterval(pollInterval); rm.destroy(); };
}

// Per-crew last-send timestamp so we can stagger publishes ≥500ms apart and
// stay under NIP-29 relay burst limits. Messages still appear instantly in the
// sender's UI (optimistic render in CrewPanel) — this just paces the relay calls.
const SEND_MIN_INTERVAL_MS = 500;
const SEND_RETRY_DELAY_MS = 1200;
const SEND_MAX_ATTEMPTS = 3;
const lastSendAt = new Map<string, number>();
const sendChain = new Map<string, Promise<unknown>>();

/** Send a chat message to the crew's NIP-29 group. */
export async function sendCrewChat(crewId: string, content: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  // Chain sends per crew so they run serially and we can enforce the min interval.
  const prev = sendChain.get(crewId) ?? Promise.resolve();
  const next = prev.then(() => doSendCrewChat(crewId, content, pubkey)).catch(() => {});
  sendChain.set(crewId, next);
  await next;
}

async function doSendCrewChat(crewId: string, content: string, pubkey: string): Promise<void> {
  const now = Date.now();
  const last = lastSendAt.get(crewId) ?? 0;
  const wait = Math.max(0, SEND_MIN_INTERVAL_MS - (now - last));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastSendAt.set(crewId, Date.now());

  const chatKey = await getEffectiveChatKey(crewId);
  const payload = chatKey ? await encryptContent(content, chatKey) : content;
  const emojiTags = extractEmojiTags(content).map(e => ['emoji', e.code, e.url]);

  const event = await signEvent({
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', groupId(crewId)], ...emojiTags],
    content: payload,
    pubkey,
  });

  // Retry if zero relays accepted (rate-limit, transient drop, etc.) so the
  // message isn't silently lost. Same event id on retry, so duplicate relays
  // will dedupe it as one event.
  for (let attempt = 1; attempt <= SEND_MAX_ATTEMPTS; attempt++) {
    const accepted = await publishToChat(event);
    if (accepted > 0) return;
    if (attempt < SEND_MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, SEND_RETRY_DELAY_MS * attempt));
    }
  }
  console.warn('[Crews] chat message dropped — no relays accepted after retries', { crewId });
}

/** Publish a system announcement to crew chat (join/leave/kick notices). */
export async function sendCrewSystemMessage(crewId: string, text: string, subjectPubkey?: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return;
  const chatKey = await getEffectiveChatKey(crewId);
  const payload = chatKey ? await encryptContent(text, chatKey) : text;
  try {
    const tags: string[][] = [['h', groupId(crewId)], ['t', 'nd-system']];
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
    tags: [['h', groupId(crewId)], ['t', 'nd-joinreq'], ['p', pubkey], ['token', token]],
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
  const chatKey = await getEffectiveChatKey(crewId);
  try {
    const events = await pool.querySync(CHAT_RELAYS, { kinds: [9], '#h': [gid], limit: 200 });
    const posts = events
      .filter((ev: any) => ev.tags?.some((t: string[]) => t[0] === 't' && t[1] === 'nd-post'))
      .sort((a: any, b: any) => b.created_at - a.created_at)
      .slice(0, limit);

    const decoded = await Promise.all(posts.map(async (ev: any) => {
      let content = ev.content;
      let ok = true;
      if (chatKey) {
        try { content = await decryptContent(ev.content, chatKey); }
        catch (_) { ok = false; }
      } else if (ev.content && /^[A-Za-z0-9+/=]{20,}$/.test(ev.content.trim())) {
        ok = false; // looks encrypted but we have no key
      }
      return ok ? { id: ev.id, pubkey: ev.pubkey, content, createdAt: ev.created_at } : null;
    }));
    return decoded.filter(Boolean) as CrewAnnouncement[];
  } catch (e) {
    console.warn('[Crews] fetchCrewAnnouncements failed:', e);
    return [];
  }
}

/** Post an announcement — encrypts content using the crew's chatKey. */
export async function postCrewAnnouncement(crewId: string, content: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const chatKey = await getEffectiveChatKey(crewId);
  const payload = chatKey ? await encryptContent(content, chatKey) : content;

  const event = await signEvent({
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['h', groupId(crewId)], ['t', 'nd-post']],
    content: payload,
    pubkey,
  });
  await publishToChat(event);
}

export interface KickProgress {
  step: 'starting' | 'rotating-key' | 'distributing' | 'publishing-def' | 'done';
  /** For 'distributing' steps: how many key DMs have been sent so far. */
  sent?: number;
  /** For 'distributing' steps: total members the new key is going to. */
  total?: number;
}

/**
 * Kick a member. Publishes NIP-29 kind:9001 AND republishes crew def with the
 * kicked pubkey so other clients detect the kick.
 *
 * For CLOSED crews: also rotates the chatKey, gift-wraps the new key to all
 * remaining members via DM, and replaces `wrappedChatKey` in the crew def.
 * The kicked member retains their old chatKey but can't decrypt any messages
 * encrypted under the new one.
 *
 * Pass `onProgress` to drive a UI indicator for the rotation steps.
 */
/**
 * Build + publish a crew def update. Signs with the crewSk for this crew —
 * caller must hold it in the crewSk cache, otherwise this throws. `mutate`
 * receives the current content and returns the new content.
 *
 * Founder is unkickable: even if a caller tries to add founderPubkey to
 * kickedPubkeys, we strip it back out before signing.
 */
async function publishCrewDef(
  crew: Crew,
  mutate: (content: Record<string, any>) => Record<string, any>,
): Promise<void> {
  const crewSk = await getCrewSk(crew.id);
  if (!crewSk) throw new Error('You do not have admin authority for this crew');

  const base: Record<string, any> = {
    name: crew.name, about: crew.about, emblem: crew.emblem,
    color: crew.color, isOpen: crew.isOpen,
    chatKey: crew.chatKey, wrappedChatKey: crew.wrappedChatKey,
    founderTitle: crew.founderTitle || undefined,
    memberRoles: crew.memberRoles, kickedPubkeys: crew.kickedPubkeys,
    pendingReinvites: crew.pendingReinvites,
  };
  const content = mutate({ ...base });

  // Founder is uncickable
  if (Array.isArray(content.kickedPubkeys)) {
    content.kickedPubkeys = content.kickedPubkeys.filter((pk: string) => pk !== crew.founderPubkey);
  }

  const emblemEmojiTags = extractEmojiTags(content.emblem ?? crew.emblem).map(e => ['emoji', e.code, e.url]);
  const defEvent = signWithKey(crewSk, {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CREW_DEF_PREFIX + crew.id], ['t', 'nostr-district'], ...emblemEmojiTags],
    content: JSON.stringify(content),
  });
  const ok = await publishEvent(defEvent);
  if (!ok) throw new Error('No relay accepted the crew def update — please try again');
}

export async function kickCrewMember(
  crewId: string,
  memberPubkey: string,
  onProgress?: (p: KickProgress) => void,
): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  onProgress?.({ step: 'starting' });

  const crew = crewCache.get(crewId);
  if (!crew) return;
  if (memberPubkey === crew.founderPubkey) throw new Error('The founder cannot be kicked');

  // NIP-29 remove-user (best effort)
  try {
    const event = await signEvent({
      kind: 9001,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId(crewId)], ['p', memberPubkey]],
      content: '',
      pubkey,
    });
    await publishToNip29(event);
  } catch (e) {
    console.warn('[Crews] NIP-29 kick failed:', e);
  }

  const kickedPubkeys = [...new Set([...(crew.kickedPubkeys ?? []), memberPubkey])];
  const pendingReinvites = { ...(crew.pendingReinvites ?? {}) };
  delete pendingReinvites[memberPubkey];
  const memberRoles = { ...(crew.memberRoles ?? {}) };
  delete memberRoles[memberPubkey];

  // For closed crews: rotate the chatKey so the kicked member can no longer
  // decrypt future messages. The new key is encrypted to crewPk so any admin
  // can recover it from the def.
  let newWrappedChatKey: string | undefined = crew.wrappedChatKey;
  let newChatKey: string | undefined;
  const rotationFailedFor: string[] = [];
  if (!crew.isOpen) {
    onProgress?.({ step: 'rotating-key' });
    const crewSk = await getCrewSk(crewId);
    if (!crewSk) throw new Error('You do not have admin authority for this crew');
    newChatKey = genChatKey();
    try {
      newWrappedChatKey = await wrapChatKeyForCrew(newChatKey, crewSk, crew.crewPk);
      await setCrewKey(crewId, newChatKey);
    } catch (e) {
      console.warn('[Crews] Failed to wrap rotated chatKey, keeping old key:', e);
      newWrappedChatKey = crew.wrappedChatKey;
      newChatKey = undefined;
    }

    if (newChatKey && newWrappedChatKey !== crew.wrappedChatKey) {
      try {
        const members = await fetchCrewMembers(crewId);
        const recipients = members
          .map(m => m.pubkey)
          .filter(pk => pk !== pubkey && !kickedPubkeys.includes(pk));

        onProgress?.({ step: 'distributing', sent: 0, total: recipients.length });
        for (let i = 0; i < recipients.length; i++) {
          try {
            await sendDirectMessage(recipients[i], `nd-key:${crewId}:${newChatKey}`);
          } catch (e) {
            console.warn('[Crews] Failed to send new chatKey to', recipients[i], e);
            rotationFailedFor.push(recipients[i]);
          }
          onProgress?.({ step: 'distributing', sent: i + 1, total: recipients.length });
        }
      } catch (e) {
        console.warn('[Crews] Failed to enumerate members for key rotation:', e);
      }
    }
  }

  onProgress?.({ step: 'publishing-def' });
  await publishCrewDef(crew, (c) => ({ ...c, memberRoles, kickedPubkeys, pendingReinvites, wrappedChatKey: newWrappedChatKey }));
  crewCache.set(crewId, { ...crew, memberRoles, kickedPubkeys, pendingReinvites, wrappedChatKey: newWrappedChatKey });

  fetchProfile(memberPubkey).then(p => {
    const name = p?.display_name || p?.name || memberPubkey.slice(0, 8) + '…';
    sendCrewSystemMessage(crewId, `${name} was removed from the crew`).catch(() => {});
  }).catch(() => {
    sendCrewSystemMessage(crewId, `${memberPubkey.slice(0, 8)}… was removed from the crew`).catch(() => {});
  });

  onProgress?.({ step: 'done' });

  if (rotationFailedFor.length > 0) {
    console.warn('[Crews] Key rotation completed with', rotationFailedFor.length, 'failed deliveries — those members will lose chat access until manually re-keyed.');
  }
}

/** Remove a pubkey from the kicked list and republish the crew def so they can rejoin. */
export async function unKickCrewMember(crewId: string, memberPubkey: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const crew = crewCache.get(crewId);
  if (!crew) return;

  const kickedPubkeys = (crew.kickedPubkeys ?? []).filter(p => p !== memberPubkey);
  const pendingReinvites: Record<string, number> = { ...(crew.pendingReinvites ?? {}) };
  pendingReinvites[memberPubkey] = Math.floor(Date.now() / 1000);

  await publishCrewDef(crew, (c) => ({ ...c, kickedPubkeys, pendingReinvites }));
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
 * Update a member's role and/or custom title. Any admin (crewSk holder) can do this.
 *
 * Promoting to admin also hands the crewSk to the new admin via a gift-wrapped DM
 * (`nd-crew-sk:<crewId>:<crewSkHex>`) so they can sign def updates themselves.
 * Demoting from admin is "soft" — the def removes their role, but they still hold
 * the cached crewSk. Only a founder rotation (rotateCrewKey) cryptographically
 * revokes admin authority.
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
  if (memberPubkey === crew.founderPubkey) throw new Error("Cannot change the founder's role");

  const memberRoles: Record<string, MemberRole> = { ...(crew.memberRoles ?? {}) };
  const trimmed = title?.trim();
  memberRoles[memberPubkey] = trimmed ? { role, title: trimmed } : { role };

  await publishCrewDef(crew, (c) => ({ ...c, memberRoles }));
  crewCache.set(crewId, { ...crew, memberRoles });

  // If promoting to admin, gift-wrap the crewSk so the new admin can sign updates.
  const oldRole = (crew.memberRoles ?? {})[memberPubkey]?.role ?? 'member';
  if (role === 'admin' && oldRole !== 'admin') {
    const crewSk = await getCrewSk(crewId);
    if (crewSk) {
      try {
        await sendDirectMessage(memberPubkey, `nd-crew-sk:${crewId}:${crewSk}`);
      } catch (e) {
        console.warn('[Crews] Failed to deliver crewSk to new admin — they will have no signing authority until re-promoted:', e);
      }
    }
  }

  const RANK = { admin: 2, officer: 1, member: 0 } as const;
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

export interface RotateProgress {
  step: 'starting' | 'wrapping' | 'publishing-def' | 'publishing-pointer' | 'distributing' | 'done';
  sent?: number;
  total?: number;
}

/**
 * Founder-only cryptographic rotation. Generates a new (crewSk2, crewPk2),
 * republishes the def under crewPk2 (preserving the existing chatKey), updates
 * the pointer to crewPk2, and gift-wraps crewSk2 to every remaining admin.
 *
 * Use to revoke a rogue admin: also pass their pubkey in `removeAdminPubkey`
 * and we'll strip them from memberRoles + kickedPubkeys/etc. before republishing.
 * The demoted admin retains their old crewSk, but well-behaved clients ignore
 * the old def because the pointer now names crewPk2.
 *
 * Requires: founder must hold both the current crewSk (to recover chatKey from
 * wrappedChatKey if needed) and their personal nsec (to sign the new pointer).
 */
export async function rotateCrewKey(
  crewId: string,
  options: { removeAdminPubkey?: string } = {},
  onProgress?: (p: RotateProgress) => void,
): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const crew = crewCache.get(crewId);
  if (!crew) throw new Error('Crew not found');
  if (crew.founderPubkey !== pubkey) throw new Error('Only the founder can rotate the crew key');

  onProgress?.({ step: 'starting' });

  // Recover the current chatKey so we can rewrap it under the new crewPk
  // without forcing a member-wide chatKey redistribution.
  const oldSk = await getCrewSk(crewId);
  let chatKey: string | null = await getCrewKey(crewId);
  if (!chatKey && !crew.isOpen && crew.wrappedChatKey && oldSk) {
    try {
      chatKey = await unwrapChatKeyForCrew(crew.wrappedChatKey, oldSk, crew.crewPk);
      await setCrewKey(crewId, chatKey);
    } catch {
      chatKey = null;
    }
  }
  if (crew.isOpen) chatKey = crew.chatKey ?? null;

  // 1. Generate new keypair
  onProgress?.({ step: 'wrapping' });
  const { crewSk: newSk, crewPk: newPk } = genCrewKeypair();

  // 2. Build new wrappedChatKey under the new crewPk (closed crews only)
  let newWrappedChatKey: string | undefined;
  if (!crew.isOpen) {
    if (!chatKey) {
      // No chatKey available — rotate to a fresh one. Existing members will lose
      // access until they're re-keyed via the next kick/unkick cycle or manual redistribution.
      chatKey = genChatKey();
      console.warn('[Crews] rotateCrewKey: chatKey unavailable, generating fresh — members may need re-keying');
    }
    newWrappedChatKey = await wrapChatKeyForCrew(chatKey, newSk, newPk);
    await setCrewKey(crewId, chatKey);
  }

  // 3. Build the new def's content, stripping the demoted admin if any
  const memberRoles = { ...(crew.memberRoles ?? {}) };
  if (options.removeAdminPubkey) delete memberRoles[options.removeAdminPubkey];

  const content: Record<string, any> = {
    name: crew.name, about: crew.about, emblem: crew.emblem,
    color: crew.color, isOpen: crew.isOpen,
    chatKey: crew.isOpen ? chatKey : undefined,
    wrappedChatKey: newWrappedChatKey,
    founderTitle: crew.founderTitle || undefined,
    memberRoles,
    kickedPubkeys: crew.kickedPubkeys,
    pendingReinvites: crew.pendingReinvites,
  };

  // 4. Sign + publish new def under crewPk2
  onProgress?.({ step: 'publishing-def' });
  const emblemEmojiTags = extractEmojiTags(crew.emblem).map(e => ['emoji', e.code, e.url]);
  const defEvent = signWithKey(newSk, {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', CREW_DEF_PREFIX + crewId], ['t', 'nostr-district'], ...emblemEmojiTags],
    content: JSON.stringify(content),
  });
  const okDef = await publishEvent(defEvent);
  if (!okDef) throw new Error('No relay accepted the new crew def — rotation aborted');

  // 5. Update the pointer to name the new crewPk. Critical: if this fails,
  //    well-behaved clients keep following the old pointer (old crewPk → old
  //    def → old admin set), so the revocation never actually takes effect
  //    even though the new def is on the relay. Fail loudly.
  onProgress?.({ step: 'publishing-pointer' });
  const ptrOk = await publishCrewPointer(crewId, newPk);
  if (!ptrOk) throw new Error('Failed to publish the new crew pointer — rotation incomplete. Try again.');
  setPointerCache(crewId, { crewPk: newPk, founderPubkey: pubkey, createdAt: defEvent.created_at });

  // 6. Cache the new crewSk locally and update the in-memory crew
  await setCrewSk(crewId, newSk);
  crewCache.set(crewId, {
    ...crew,
    crewPk: newPk,
    memberRoles,
    wrappedChatKey: newWrappedChatKey,
    chatKey: crew.isOpen ? chatKey ?? undefined : undefined,
  });

  // 7. Gift-wrap the new crewSk to remaining admins so they can keep editing.
  const remainingAdmins = Object.entries(memberRoles)
    .filter(([_, r]) => r.role === 'admin')
    .map(([pk]) => pk)
    .filter(pk => pk !== options.removeAdminPubkey);
  onProgress?.({ step: 'distributing', sent: 0, total: remainingAdmins.length });
  for (let i = 0; i < remainingAdmins.length; i++) {
    try {
      await sendDirectMessage(remainingAdmins[i], `nd-crew-sk:${crewId}:${newSk}`);
    } catch (e) {
      console.warn('[Crews] Failed to deliver rotated crewSk to', remainingAdmins[i], e);
    }
    onProgress?.({ step: 'distributing', sent: i + 1, total: remainingAdmins.length });
  }

  onProgress?.({ step: 'done' });

  // Audit-trail system message
  if (options.removeAdminPubkey) {
    fetchProfile(options.removeAdminPubkey).then(p => {
      const name = p?.display_name || p?.name || options.removeAdminPubkey!.slice(0, 8) + '…';
      sendCrewSystemMessage(crewId, `${name}'s admin authority was revoked by the founder`).catch(() => {});
    }).catch(() => {});
  }
}

/** Update crew definition fields (name, about, emblem, color, isOpen). Any admin. */
export async function updateCrewDefinition(
  crewId: string,
  fields: { name?: string; about?: string; emblem?: string; color?: string; isOpen?: boolean; founderTitle?: string }
): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');
  const crew = crewCache.get(crewId);
  if (!crew) throw new Error('Crew not found');
  // founderTitle is reserved for the founder
  if (fields.founderTitle !== undefined && crew.founderPubkey !== pubkey) {
    throw new Error('Only the founder can change the founder title');
  }
  const updated = { ...crew, ...fields };
  await publishCrewDef(crew, (c) => ({
    ...c,
    name: updated.name, about: updated.about, emblem: updated.emblem,
    color: updated.color, isOpen: updated.isOpen,
    founderTitle: updated.founderTitle || undefined,
  }));
  crewCache.set(crewId, updated);
}

/** Delete a crew post (kind:5 targeting the post event). */
export async function deleteCrewAnnouncement(eventId: string): Promise<void> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') throw new Error('Must be logged in');

  const kind5 = await signEvent({
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', eventId]],
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

// ── Closed-crew chat key delivery via DM ──────────────────────────────────────
//
// When a founder/admin/officer accepts a join request for a closed crew, they
// also gift-wrap the chatKey as a DM with content `nd-key:<crewId>:<chatKeyHex>`.
// Here we listen for those DMs and cache the chatKey so the recipient can
// decrypt crew chat on next read.
onDMReceived((msg) => {
  const content = msg.content || '';
  if (!content.startsWith('nd-key:')) return;
  const idx1 = content.indexOf(':');
  const idx2 = content.indexOf(':', idx1 + 1);
  if (idx1 < 0 || idx2 < 0) return;
  const crewId  = content.slice(idx1 + 1, idx2);
  const chatKey = content.slice(idx2 + 1).trim();
  if (!crewId || !/^[0-9a-f]{64}$/.test(chatKey)) return;
  setCrewKey(crewId, chatKey).catch(() => {});
});

// ── Admin promotion: crewSk delivery via DM ──────────────────────────────────
//
// When a founder/admin promotes a member to admin, they gift-wrap the crewSk
// to them as `nd-crew-sk:<crewId>:<crewSkHex>`. Here we cache the received
// crewSk so the new admin can sign def updates immediately.
onDMReceived((msg) => {
  const content = msg.content || '';
  if (!content.startsWith('nd-crew-sk:')) return;
  const idx1 = content.indexOf(':');
  const idx2 = content.indexOf(':', idx1 + 1);
  if (idx1 < 0 || idx2 < 0) return;
  const crewId = content.slice(idx1 + 1, idx2);
  const crewSk = content.slice(idx2 + 1).trim();
  if (!crewId || !/^[0-9a-f]{64}$/.test(crewSk)) return;
  setCrewSk(crewId, crewSk).catch(() => {});
});
