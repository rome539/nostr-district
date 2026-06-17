// Encrypts an nsec for cloud backup using a "master key + multiple wraps" model.
//
//   nsec ──AES-GCM(DEK)──▶ ciphertext            (stored once)
//   DEK  ──wrapped by PIN──▶ pinWrap              (any wrap recovers the DEK)
//   DEK  ──wrapped by passkey PRF──▶ passkeyWrap  (added later, same DEK)
//
// Any single wrap unlocks the DEK, which decrypts the nsec. So a user can set a
// PIN *and* a passkey and unlock with either; adding a wrap never re-encrypts
// the nsec. All crypto is WebCrypto (AES-GCM + PBKDF2-SHA256) — no dependencies,
// and the plaintext nsec/DEK never leave the browser.
//
// This is the blob we store in the user's Google Drive app-data folder. It
// contains no npub, name, or Google id — just ciphertext + wraps.

const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 floor for PBKDF2-HMAC-SHA256
const VERSION = 1 as const;

export interface EncryptedBackup {
  v: typeof VERSION;
  nsec: AesBlob;            // nsec encrypted with the DEK
  wraps: {
    pin?: PinWrap;
    passkey?: PasskeyWrap;
  };
}

interface AesBlob { iv: string; ct: string }                       // base64url
interface PinWrap extends AesBlob { salt: string; iter: number }    // DEK wrapped by PIN-derived key
// DEK wrapped by a passkey PRF secret. `salt` is the PRF eval salt — the
// WebAuthn layer re-runs the PRF with it at recovery to reproduce the secret.
export interface PasskeyWrap extends AesBlob { credentialId: string; salt: string }

// ── base64url helpers ───────────────────────────────────────────────────────
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

// ── AES-GCM with a raw 32-byte key ──────────────────────────────────────────
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

// ── PIN → key derivation ────────────────────────────────────────────────────
async function deriveKeyFromPin(pin: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 256);
  return aesKey(new Uint8Array(bits));
}

// ── passkey PRF secret → key derivation ─────────────────────────────────────
// The PRF output is already 32 bytes of high-entropy material; HKDF domain-
// separates it into an AES key so the same PRF secret could be reused elsewhere
// without colliding.
async function deriveKeyFromPrf(prfSecret: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prfSecret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8('nostr-district-backup-v1') },
    base, 256,
  );
  return aesKey(new Uint8Array(bits));
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Create a fresh backup and return the raw DEK alongside it, so the caller can
 * immediately add another wrap (e.g. a passkey) without re-deriving anything.
 */
export async function createBackup(
  nsec: string,
  pin: string,
): Promise<{ backup: EncryptedBackup; dek: Uint8Array<ArrayBuffer> }> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const dekKey = await aesKey(dek);
  const nsecBlob = await aesEncrypt(dekKey, utf8(nsec));
  const pinWrap = await wrapDekWithPin(dek, pin);
  return { backup: { v: VERSION, nsec: nsecBlob, wraps: { pin: pinWrap } }, dek };
}

/** Create a fresh backup: random DEK encrypts the nsec, PIN wraps the DEK. */
export async function createBackupWithPin(nsec: string, pin: string): Promise<EncryptedBackup> {
  return (await createBackup(nsec, pin)).backup;
}

/** Unlock the nsec from a backup using the PIN. Throws on wrong PIN. */
export async function unlockWithPin(backup: EncryptedBackup, pin: string): Promise<string> {
  return decryptNsecFromDek(backup, await unlockDekWithPin(backup, pin));
}

/** Recover the raw DEK from the PIN wrap. Throws on wrong PIN. */
export async function unlockDekWithPin(backup: EncryptedBackup, pin: string): Promise<Uint8Array<ArrayBuffer>> {
  const wrap = backup.wraps.pin;
  if (!wrap) throw new Error('This account has no password set');
  try {
    const kek = await deriveKeyFromPin(pin, unb64(wrap.salt), wrap.iter);
    return await aesDecrypt(kek, wrap);
  } catch {
    throw new Error('Incorrect password');
  }
}

/** Recover the raw DEK from the passkey wrap, given its PRF secret. */
export async function unlockDekWithPasskey(
  backup: EncryptedBackup,
  prfSecret: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const wrap = backup.wraps.passkey;
  if (!wrap) throw new Error('This account has no passkey recovery set');
  const kek = await deriveKeyFromPrf(prfSecret);
  return aesDecrypt(kek, wrap);
}

/** Wrap a DEK with a PIN (used at creation and when changing/adding a PIN). */
export async function wrapDekWithPin(dek: Uint8Array<ArrayBuffer>, pin: string): Promise<PinWrap> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKeyFromPin(pin, salt, PBKDF2_ITERATIONS);
  const blob = await aesEncrypt(kek, dek);
  return { ...blob, salt: b64(salt), iter: PBKDF2_ITERATIONS };
}

/**
 * Wrap a DEK with a passkey PRF secret. `credentialId` + `prfSalt` are stored so
 * the WebAuthn layer can re-run the PRF and reproduce the secret at recovery.
 */
export async function wrapDekWithPasskey(
  dek: Uint8Array<ArrayBuffer>,
  prfSecret: Uint8Array<ArrayBuffer>,
  credentialId: string,
  prfSalt: Uint8Array<ArrayBuffer>,
): Promise<PasskeyWrap> {
  const kek = await deriveKeyFromPrf(prfSecret);
  const blob = await aesEncrypt(kek, dek);
  return { ...blob, credentialId, salt: b64(prfSalt) };
}

/** Return a copy of the backup with the passkey wrap added/replaced. */
export function withPasskeyWrap(backup: EncryptedBackup, wrap: PasskeyWrap): EncryptedBackup {
  return { ...backup, wraps: { ...backup.wraps, passkey: wrap } };
}

/** Return a copy of the backup with the PIN wrap re-derived from a new password. */
export async function rewrapPin(
  backup: EncryptedBackup,
  dek: Uint8Array<ArrayBuffer>,
  newPassword: string,
): Promise<EncryptedBackup> {
  return { ...backup, wraps: { ...backup.wraps, pin: await wrapDekWithPin(dek, newPassword) } };
}

/** Decrypt the nsec given the raw DEK (recovered from any wrap). */
export async function decryptNsecFromDek(backup: EncryptedBackup, dek: Uint8Array<ArrayBuffer>): Promise<string> {
  const dekKey = await aesKey(dek);
  const nsecBytes = await aesDecrypt(dekKey, backup.nsec);
  return new TextDecoder().decode(nsecBytes);
}
