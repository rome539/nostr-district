/**
 * crewSkCache.ts — Per-crew "crew identity" secret-key cache.
 *
 * Each crew has its own keypair (crewSk, crewPk). The crew definition event
 * (kind:30078, d-tag `nostr-district:crew:<crewId>`) is signed by `crewSk`,
 * so any holder of `crewSk` (founder + admins) can publish authoritative
 * updates to the crew. This module caches the `crewSk` for each crew the
 * user has admin access to.
 *
 * Storage:
 *   - In-memory Map<crewId, crewSkHex> for fast access.
 *   - Encrypted at rest in localStorage with HKDF-from-nsec for nsec/passkey
 *     logins (mirrors the Spark wallet mnemonic + crew chatKey pattern).
 *   - Plaintext fallback for extension/bunker logins (no nsec available
 *     locally — same trade-off documented elsewhere).
 *
 * Cleared on logout via clearAllCrewSks().
 */

import { authStore } from '../stores/authStore';
import { getLocalKey } from './dmService';

const STORAGE_PREFIX = 'nd_crew_sks_';   // suffix is pubkey16
const MEM = new Map<string, string>();   // crewId → crewSk hex
let _loadedForPubkey: string | null = null;

// ── Byte helpers ──────────────────────────────────────────────────────────────

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(h: string): Uint8Array {
  return new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

// ── AES-GCM helpers ──────────────────────────────────────────────────────────

async function deriveAesKey(privkey: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey('raw', privkey.buffer as ArrayBuffer, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('nostr-district-crew-sks-v1'),
      info: new TextEncoder().encode('crew-sk-storage'),
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
    for (const [crewId, sk] of Object.entries(map)) {
      if (!MEM.has(crewId)) MEM.set(crewId, sk);
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

export async function getCrewSk(crewId: string): Promise<string | null> {
  if (MEM.has(crewId)) return MEM.get(crewId)!;
  const pubkey = authStore.getState().pubkey;
  if (!pubkey) return null;
  await loadFromStorage(pubkey);
  return MEM.get(crewId) ?? null;
}

export function getCrewSkSync(crewId: string): string | null {
  return MEM.get(crewId) ?? null;
}

export async function setCrewSk(crewId: string, crewSkHex: string): Promise<void> {
  MEM.set(crewId, crewSkHex);
  await persist();
}

export async function clearCrewSk(crewId: string): Promise<void> {
  MEM.delete(crewId);
  await persist();
}

export function clearAllCrewSks(): void {
  MEM.clear();
  _loadedForPubkey = null;
}

/** List crewIds for which we currently hold a crewSk. Used as an admin-discovery source. */
export function listCrewSkIds(): string[] {
  return Array.from(MEM.keys());
}

export async function preloadCrewSks(): Promise<void> {
  const pubkey = authStore.getState().pubkey;
  if (pubkey) await loadFromStorage(pubkey);
}
