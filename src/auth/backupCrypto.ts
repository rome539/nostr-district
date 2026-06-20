// Encrypts an nsec for cloud backup using a "master key + multiple wraps" model.
//
//   privkey ──AEAD(DEK)──▶ ciphertext              (stored once)
//   DEK     ──wrapped by PIN──▶ pinWrap            (any wrap recovers the DEK)
//   DEK     ──wrapped by passkey PRF──▶ passkeyWrap (added later, same DEK)
//
// Any single wrap unlocks the DEK, which decrypts the privkey. So a user can set
// a PIN *and* a passkey and unlock with either; adding a wrap never re-encrypts
// the privkey. The plaintext key and DEK never leave the browser.
//
// This is the blob we store in the user's Google Drive app-data folder. It
// contains no npub, name, or Google id — just ciphertext + wraps.
//
// ── FORMAT: two on-disk versions, dual-read ──────────────────────────────────
// We WRITE the v2 format (NIP "nostr-key-backup": NIP-44 v2 AEAD, `wraps` array,
// hex privkey) — this makes ND a conforming reference impl of that NIP, and the
// v2 PIN wrap is deterministic enough to publish as a test vector. We still READ
// the legacy v1 format (AES-GCM, `wraps` object, bech32 nsec) so every account
// created before the NIP-44 alignment keeps working untouched. Legacy blobs are
// never written again; a v1 account that changes its password stays v1 (no
// forced migration, no risk of dropping a wrap we can't reconstruct).

const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 floor for PBKDF2-HMAC-SHA256
const BACKUP_KIND = 'nostr-key-backup' as const; // v2 magic string
const BACKUP_V = 1 as const;                      // v2 format version

// ── v1 (legacy, AES-GCM) — READ ONLY ─────────────────────────────────────────
interface AesBlob { iv: string; ct: string }                       // base64url
interface LegacyPinWrap extends AesBlob { salt: string; iter: number }
interface LegacyPasskeyWrap extends AesBlob { credentialId: string; salt: string }
interface LegacyBackupV1 {
  v: 1;
  nsec: AesBlob;                                                    // nsec (bech32) encrypted with the DEK
  wraps: { pin?: LegacyPinWrap; passkey?: LegacyPasskeyWrap };
}

// ── v2 (NIP "nostr-key-backup", NIP-44 v2) — what we WRITE ───────────────────
interface Nip44PinWrap { type: 'pin'; kdf: 'pbkdf2-sha256'; iter: number; salt: string; ct: string }
// `salt` is the WebAuthn PRF eval salt — needed to re-run the PRF at recovery.
// (The NIP draft's passkey-wrap shape should document this field.)
export interface PasskeyWrap { type: 'passkey'; credentialId: string; salt: string; ct: string }
type Nip44Wrap = Nip44PinWrap | PasskeyWrap;
interface BackupV2 {
  kind: typeof BACKUP_KIND;
  v: typeof BACKUP_V;
  key: { alg: 'nip44-v2'; ct: string };                            // hex privkey encrypted with the DEK
  wraps: Nip44Wrap[];                                              // ≥1; any one recovers the DEK
}

export type EncryptedBackup = LegacyBackupV1 | BackupV2;

function isV2(b: EncryptedBackup): b is BackupV2 {
  return (b as any)?.kind === BACKUP_KIND;
}

// ── lazy nostr-tools (nip44 AEAD + nip19 nsec<->hex), matches codebase style ──
let _nt: typeof import('nostr-tools') | null = null;
async function nt(): Promise<typeof import('nostr-tools')> {
  return (_nt ??= await import('nostr-tools'));
}

// ── hex / base64url / utf8 helpers ───────────────────────────────────────────
function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function utf8(s: string): Uint8Array<ArrayBuffer> {
  const u = new TextEncoder().encode(s);
  const out = new Uint8Array(u.length);
  out.set(u);
  return out;
}
function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
function hexToBytes(h: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

// ── nsec (bech32) <-> hex privkey ────────────────────────────────────────────
async function skHexFromNsec(nsec: string): Promise<string> {
  const { nip19 } = await nt();
  const dec = nip19.decode(nsec);
  if (dec.type !== 'nsec') throw new Error('Not an nsec');
  return bytesToHex(dec.data as Uint8Array);
}
async function nsecFromSkHex(hex: string): Promise<string> {
  const { nip19 } = await nt();
  return nip19.nsecEncode(hexToBytes(hex));
}

// ── NIP-44 v2 as a generic AEAD: the "conversation key" slot holds a raw
//    32-byte symmetric key (DEK or KEK) instead of an ECDH output. Decrypt
//    throws on a wrong key (authenticated) — that's our wrong-PIN signal. ─────
async function aeadEnc(plaintext: string, convKey32: Uint8Array<ArrayBuffer>): Promise<string> {
  const { nip44 } = await nt();
  return nip44.v2.encrypt(plaintext, convKey32);
}
async function aeadDec(payload: string, convKey32: Uint8Array<ArrayBuffer>): Promise<string> {
  const { nip44 } = await nt();
  return nip44.v2.decrypt(payload, convKey32);
}

// ── KDFs → raw 32-byte keys (used as NIP-44 conversation keys) ───────────────
async function pbkdf2Raw(pin: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', utf8(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 256);
  return new Uint8Array(bits);
}
// The PRF output is already 32 bytes of high-entropy material; HKDF domain-
// separates it so the same PRF secret could be reused elsewhere without colliding.
async function prfToRaw(prfSecret: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', prfSecret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8('nostr-district-backup-v1') },
    base, 256,
  );
  return new Uint8Array(bits);
}

// ── v2 wrap builder ──────────────────────────────────────────────────────────
async function makePinWrapV2(dek: Uint8Array<ArrayBuffer>, pin: string): Promise<Nip44PinWrap> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await pbkdf2Raw(pin, salt, PBKDF2_ITERATIONS);
  const ct = await aeadEnc(bytesToHex(dek), kek);
  return { type: 'pin', kdf: 'pbkdf2-sha256', iter: PBKDF2_ITERATIONS, salt: b64(salt), ct };
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Create a fresh v2 backup and return the raw DEK alongside it, so the caller
 * can immediately add another wrap (e.g. a passkey) without re-deriving anything.
 */
export async function createBackup(
  nsec: string,
  pin: string,
): Promise<{ backup: BackupV2; dek: Uint8Array<ArrayBuffer> }> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const keyCt = await aeadEnc(await skHexFromNsec(nsec), dek);
  const pinWrap = await makePinWrapV2(dek, pin);
  return { backup: { kind: BACKUP_KIND, v: BACKUP_V, key: { alg: 'nip44-v2', ct: keyCt }, wraps: [pinWrap] }, dek };
}

/** Create a fresh v2 backup: random DEK encrypts the privkey, PIN wraps the DEK. */
export async function createBackupWithPin(nsec: string, pin: string): Promise<EncryptedBackup> {
  return (await createBackup(nsec, pin)).backup;
}

/** Unlock the nsec from a backup using the PIN. Throws on wrong PIN. */
export async function unlockWithPin(backup: EncryptedBackup, pin: string): Promise<string> {
  return decryptNsecFromDek(backup, await unlockDekWithPin(backup, pin));
}

/** Recover the raw DEK from the PIN wrap. Throws on wrong PIN. Reads v1 or v2. */
export async function unlockDekWithPin(backup: EncryptedBackup, pin: string): Promise<Uint8Array<ArrayBuffer>> {
  if (isV2(backup)) {
    const wrap = backup.wraps.find(w => w.type === 'pin') as Nip44PinWrap | undefined;
    if (!wrap) throw new Error('This account has no password set');
    try {
      const kek = await pbkdf2Raw(pin, unb64(wrap.salt), wrap.iter);
      return hexToBytes(await aeadDec(wrap.ct, kek));
    } catch {
      throw new Error('Incorrect password');
    }
  }
  // legacy v1 (AES-GCM)
  const wrap = backup.wraps.pin;
  if (!wrap) throw new Error('This account has no password set');
  try {
    const kek = await deriveAesKeyFromPin(pin, unb64(wrap.salt), wrap.iter);
    return await aesDecrypt(kek, wrap);
  } catch {
    throw new Error('Incorrect password');
  }
}

/** Recover the raw DEK from the passkey wrap, given its PRF secret. Reads v1 or v2. */
export async function unlockDekWithPasskey(
  backup: EncryptedBackup,
  prfSecret: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (isV2(backup)) {
    const wrap = backup.wraps.find(w => w.type === 'passkey') as PasskeyWrap | undefined;
    if (!wrap) throw new Error('This account has no passkey recovery set');
    const kek = await prfToRaw(prfSecret);
    return hexToBytes(await aeadDec(wrap.ct, kek));
  }
  // legacy v1 (AES-GCM)
  const wrap = backup.wraps.passkey;
  if (!wrap) throw new Error('This account has no passkey recovery set');
  const kek = await deriveAesKeyFromPrf(prfSecret);
  return await aesDecrypt(kek, wrap);
}

/**
 * Wrap a DEK with a passkey PRF secret (v2). `credentialId` + `prfSalt` are
 * stored so the WebAuthn layer can re-run the PRF and reproduce the secret.
 */
export async function wrapDekWithPasskey(
  dek: Uint8Array<ArrayBuffer>,
  prfSecret: Uint8Array<ArrayBuffer>,
  credentialId: string,
  prfSalt: Uint8Array<ArrayBuffer>,
): Promise<PasskeyWrap> {
  const kek = await prfToRaw(prfSecret);
  const ct = await aeadEnc(bytesToHex(dek), kek);
  return { type: 'passkey', credentialId, salt: b64(prfSalt), ct };
}

/** Return a copy of the (v2) backup with the passkey wrap added/replaced. */
export function withPasskeyWrap(backup: EncryptedBackup, wrap: PasskeyWrap): EncryptedBackup {
  if (!isV2(backup)) throw new Error('Cannot add a NIP-44 passkey wrap to a legacy backup');
  return { ...backup, wraps: [...backup.wraps.filter(w => w.type !== 'passkey'), wrap] };
}

/**
 * Return a copy of the backup with the PIN wrap re-derived from a new password.
 * Format-preserving: a v2 backup stays v2, a legacy backup stays legacy (so we
 * never drop a passkey wrap we can't reconstruct without its PRF secret).
 */
export async function rewrapPin(
  backup: EncryptedBackup,
  dek: Uint8Array<ArrayBuffer>,
  newPassword: string,
): Promise<EncryptedBackup> {
  if (isV2(backup)) {
    const pinWrap = await makePinWrapV2(dek, newPassword);
    return { ...backup, wraps: [pinWrap, ...backup.wraps.filter(w => w.type !== 'pin')] };
  }
  return { ...backup, wraps: { ...backup.wraps, pin: await wrapDekWithPinLegacy(dek, newPassword) } };
}

/** Decrypt the nsec given the raw DEK (recovered from any wrap). Reads v1 or v2. */
export async function decryptNsecFromDek(backup: EncryptedBackup, dek: Uint8Array<ArrayBuffer>): Promise<string> {
  if (isV2(backup)) {
    return nsecFromSkHex(await aeadDec(backup.key.ct, dek));
  }
  const dekKey = await aesKey(dek);
  const nsecBytes = await aesDecrypt(dekKey, backup.nsec);
  return new TextDecoder().decode(nsecBytes);
}

/** True if the backup carries a passkey recovery wrap (format-agnostic). */
export function hasPasskeyWrap(backup: EncryptedBackup): boolean {
  return isV2(backup) ? backup.wraps.some(w => w.type === 'passkey') : !!backup.wraps.passkey;
}

/** The passkey wrap's WebAuthn metadata needed to re-run the PRF, or null. */
export function getPasskeyWrapMeta(backup: EncryptedBackup): { credentialId: string; salt: string } | null {
  if (isV2(backup)) {
    const w = backup.wraps.find(x => x.type === 'passkey') as PasskeyWrap | undefined;
    return w ? { credentialId: w.credentialId, salt: w.salt } : null;
  }
  const w = backup.wraps.passkey;
  return w ? { credentialId: w.credentialId, salt: w.salt } : null;
}

// ── legacy v1 (AES-GCM) crypto — kept for reading pre-NIP-44 backups, plus
//    the format-preserving rewrap of a legacy PIN ─────────────────────────────
async function aesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function aesEncrypt(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<AesBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: b64(iv), ct: b64(ct) };
}
async function aesDecrypt(key: CryptoKey, blob: AesBlob): Promise<Uint8Array<ArrayBuffer>> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return new Uint8Array(pt);
}
async function deriveAesKeyFromPin(pin: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  return aesKey(await pbkdf2Raw(pin, salt, iter));
}
async function deriveAesKeyFromPrf(prfSecret: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return aesKey(await prfToRaw(prfSecret));
}
async function wrapDekWithPinLegacy(dek: Uint8Array<ArrayBuffer>, pin: string): Promise<LegacyPinWrap> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveAesKeyFromPin(pin, salt, PBKDF2_ITERATIONS);
  const blob = await aesEncrypt(kek, dek);
  return { ...blob, salt: b64(salt), iter: PBKDF2_ITERATIONS };
}
