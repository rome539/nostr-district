/**
 * crewKeyCache.ts — Per-crew chat-key cache for closed crews.
 *
 * Closed crews no longer publish their chatKey in plaintext. Instead, the
 * founder wraps it to themselves in the crew def, and the founder/admins/
 * officers gift-wrap it to each member via NIP-17 DMs at approval time.
 * This module caches those received chatKeys so members can decrypt chat
 * across sessions without re-receiving the gift wrap.
 *
 * Storage:
 *   - In-memory Map<crewId, chatKeyHex> for fast access.
 *   - Encrypted-at-rest in localStorage with HKDF-from-nsec for nsec/passkey
 *     users (same pattern as the Spark wallet mnemonic).
 *   - Plaintext fallback for extension/bunker logins (we don't have a raw key
 *     to derive an AES key with — same trade-off documented in WalletInfo).
 */

import { authStore } from '../stores/authStore';
import { getLocalKey } from './dmService';

const STORAGE_PREFIX = 'nd_crew_keys_';   // suffix is pubkey16
const MEM = new Map<string, string>();    // crewId → chatKey hex
let _loadedForPubkey: string | null = null;

// ── Byte helpers ──────────────────────────────────────────────────────────────

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(h: string): Uint8Array {
  return new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

// ── AES-GCM helpers (mirror sparkService at-rest pattern) ────────────────────

async function deriveAesKey(privkey: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey('raw', privkey.buffer as ArrayBuffer, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('nostr-district-crew-keys-v1'),
      info: new TextEncoder().encode('crew-key-storage'),
    },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptBlob(plain: string, aes: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aes,
    new TextEncoder().encode(plain) as unknown as ArrayBuffer,
  );
  return JSON.stringify({ iv: bytesToHex(iv), ct: bytesToHex(new Uint8Array(ct)) });
}

async function decryptBlob(stored: string, aes: CryptoKey): Promise<string | null> {
  try {
    const { iv: ivHex, ct: ctHex } = JSON.parse(stored);
    if (typeof ivHex !== 'string' || typeof ctHex !== 'string') return null;
    const iv = hexToBytes(ivHex);
    const ct = hexToBytes(ctHex);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.slice() },
      aes,
      ct.slice().buffer,
    );
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

// ── Storage I/O ───────────────────────────────────────────────────────────────

function storageKeyFor(pubkey: string): string {
  return `${STORAGE_PREFIX}${pubkey.slice(0, 16)}`;
}

async function loadFromStorage(pubkey: string): Promise<void> {
  if (_loadedForPubkey === pubkey) return;
  _loadedForPubkey = pubkey;

  const raw = localStorage.getItem(storageKeyFor(pubkey));
  if (!raw) return;

  const localKey = getLocalKey();
  let json: string | null = null;
  if (localKey) {
    const aes = await deriveAesKey(localKey);
    json = await decryptBlob(raw, aes);
  } else {
    // Plaintext fallback (extension/bunker)
    json = raw;
  }
  if (!json) return;

  try {
    const map = JSON.parse(json) as Record<string, string>;
    for (const [crewId, key] of Object.entries(map)) {
      if (!MEM.has(crewId)) MEM.set(crewId, key);
    }
  } catch { /* corrupted, ignore */ }
}

async function persist(): Promise<void> {
  const pubkey = authStore.getState().pubkey;
  if (!pubkey) return;

  const obj: Record<string, string> = {};
  for (const [k, v] of MEM) obj[k] = v;
  const json = JSON.stringify(obj);

  const localKey = getLocalKey();
  if (localKey) {
    const aes = await deriveAesKey(localKey);
    localStorage.setItem(storageKeyFor(pubkey), await encryptBlob(json, aes));
  } else {
    localStorage.setItem(storageKeyFor(pubkey), json);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Get the cached chatKey for a crew, loading from storage if needed. */
export async function getCrewKey(crewId: string): Promise<string | null> {
  if (MEM.has(crewId)) return MEM.get(crewId)!;
  const pubkey = authStore.getState().pubkey;
  if (!pubkey) return null;
  await loadFromStorage(pubkey);
  return MEM.get(crewId) ?? null;
}

/** Synchronous lookup — returns null if not loaded yet. Useful where async is awkward. */
export function getCrewKeySync(crewId: string): string | null {
  return MEM.get(crewId) ?? null;
}

/** Cache a chatKey for a crew and persist to storage. */
export async function setCrewKey(crewId: string, chatKeyHex: string): Promise<void> {
  MEM.set(crewId, chatKeyHex);
  await persist();
}

/** Remove a crew's chatKey from cache (e.g., after kick or leave). */
export async function clearCrewKey(crewId: string): Promise<void> {
  MEM.delete(crewId);
  await persist();
}

/** Clear all cached keys (logout). */
export function clearAllCrewKeys(): void {
  MEM.clear();
  _loadedForPubkey = null;
}

/** Eagerly load from storage for the current user. Call at login. */
export async function preloadCrewKeys(): Promise<void> {
  const pubkey = authStore.getState().pubkey;
  if (pubkey) await loadFromStorage(pubkey);
}
