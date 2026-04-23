const STORAGE_KEY = 'nostr_district_passkeys_v2';
const LEGACY_KEY  = 'nostr_district_passkey_v1';

export interface StoredPasskey {
  credentialId: string;  // base64
  encryptedNsec: string; // base64
  iv: string;            // base64
  salt: string;          // base64
  displayName: string;
}

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function deriveKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('nostr-district-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

const PRIMARY_KEY = 'nd_primary_passkey';

export function getPrimaryPasskeyId(): string | null {
  return localStorage.getItem(PRIMARY_KEY);
}

export function setPrimaryPasskeyId(credentialId: string): void {
  localStorage.setItem(PRIMARY_KEY, credentialId);
}

export function getStoredPasskeys(): StoredPasskey[] {
  try {
    // Migrate from legacy single-passkey storage
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const single: StoredPasskey = JSON.parse(legacy);
      const migrated = [single];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_KEY);
      return migrated;
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function clearStoredPasskey(credentialId: string): void {
  const remaining = getStoredPasskeys().filter(p => p.credentialId !== credentialId);
  if (remaining.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  }
}

export function clearAllPasskeys(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(PRIMARY_KEY);
}

export async function isPasskeySupported(): Promise<boolean> {
  // We deliberately do NOT gate on getClientCapabilities().prf — it can report
  // false negatives depending on which authenticator is active. Instead we
  // optimistically offer the option whenever a platform authenticator exists
  // and surface the actual PRF failure (with a clear error) if save fails.
  try {
    return !!(
      window.PublicKeyCredential &&
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    );
  } catch { return false; }
}

export async function saveWithPasskey(nsec: string, displayName: string): Promise<void> {
  // Cap to a sane length — prevents oversized buttons and storage bloat
  displayName = (displayName || 'Nostr User').slice(0, 40);
  const salt = crypto.getRandomValues(new Uint8Array(32));

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Nostr District', id: window.location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: displayName,
        displayName,
      },
      pubKeyCredParams: [
        { alg: -7,   type: 'public-key' },  // ES256
        { alg: -257, type: 'public-key' },  // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      extensions: { prf: { eval: { first: salt.buffer } } } as any,
    },
  }) as PublicKeyCredential;

  const prf = (cred.getClientExtensionResults() as any)?.prf?.results?.first as ArrayBuffer | undefined;
  if (!prf) throw new Error('PRF_NOT_SUPPORTED');

  const key = await deriveKey(prf);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(nsec));

  const entry: StoredPasskey = {
    credentialId:  b64(cred.rawId),
    encryptedNsec: b64(enc),
    iv:            b64(iv.buffer),
    salt:          b64(salt.buffer),
    displayName,
  };

  // Append; replace if same credential ID already stored
  const existing = getStoredPasskeys().filter(p => p.credentialId !== entry.credentialId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, entry]));
}

// Link an EXISTING passkey credential (already in the user's manager) to this device's
// localStorage. Unlike saveWithPasskey, this calls credentials.get without allowCredentials
// so the user picks from passkeys already saved in their manager, then re-encrypts the nsec
// with a fresh salt against that credential's PRF.
export async function linkExistingPasskey(nsec: string, displayName: string): Promise<StoredPasskey> {
  displayName = (displayName || 'Nostr User').slice(0, 40);
  const salt = crypto.getRandomValues(new Uint8Array(32));

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt.buffer as ArrayBuffer } } } as any,
    },
  }) as PublicKeyCredential;

  const prf = (assertion.getClientExtensionResults() as any)?.prf?.results?.first as ArrayBuffer | undefined;
  if (!prf) throw new Error('PRF_NOT_SUPPORTED');

  const key = await deriveKey(prf);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(nsec));

  const entry: StoredPasskey = {
    credentialId:  b64(assertion.rawId),
    encryptedNsec: b64(enc),
    iv:            b64(iv.buffer as ArrayBuffer),
    salt:          b64(salt.buffer as ArrayBuffer),
    displayName,
  };

  const existing = getStoredPasskeys().filter(p => p.credentialId !== entry.credentialId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, entry]));
  return entry;
}

export async function loginWithPasskey(credentialId: string): Promise<string> {
  const passkeys = getStoredPasskeys();
  const stored = passkeys.find(p => p.credentialId === credentialId);
  if (!stored) throw new Error('Passkey not found');

  let assertion: PublicKeyCredential | null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: unb64(stored.credentialId).buffer as ArrayBuffer }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: unb64(stored.salt).buffer as ArrayBuffer } } } as any,
      },
    }) as PublicKeyCredential | null;
  } catch (e: any) {
    console.error('[passkey] navigator.credentials.get failed:', e);
    throw new Error(`Passkey unlock failed: ${e?.message || e?.name || 'unknown error'}`);
  }
  if (!assertion) throw new Error('Passkey unlock cancelled');

  const extResults = assertion.getClientExtensionResults() as any;
  console.log('[passkey] extension results:', extResults);
  const prf = extResults?.prf?.results?.first as ArrayBuffer | undefined;
  if (!prf) {
    throw new Error(
      'This browser unlocked your passkey but didn\'t return the PRF value needed to decrypt your key. ' +
      'Chrome on macOS only supports PRF for some authenticators — try the same browser you created the passkey in, or create a new passkey here.'
    );
  }

  const ivBytes  = unb64(stored.iv);
  const encBytes = unb64(stored.encryptedNsec);
  console.log('[passkey] sizes:', {
    prfBytes: prf.byteLength,
    ivBytes: ivBytes.byteLength,
    encBytes: encBytes.byteLength,
    saltBytes: unb64(stored.salt).byteLength,
    storedEncB64Len: stored.encryptedNsec.length,
    storedIvB64Len:  stored.iv.length,
  });

  try {
    const key = await deriveKey(prf);
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
      key,
      encBytes.buffer as ArrayBuffer
    );
    return new TextDecoder().decode(dec);
  } catch (e: any) {
    console.error('[passkey] decrypt failed:', e, {
      ivByteLen: ivBytes.byteLength,
      encByteLen: encBytes.byteLength,
    });
    if (encBytes.byteLength < 16) {
      throw new Error(`Stored encrypted key is corrupt (only ${encBytes.byteLength} bytes — needs at least 16). Forget this passkey and create a new one.`);
    }
    throw new Error('Passkey unlocked but decryption failed — the PRF value didn\'t match what was used at save time.');
  }
}
