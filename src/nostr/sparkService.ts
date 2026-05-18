/**
 * sparkService.ts — Breez SDK Spark wallet integration
 *
 * Wallet derivation:
 *   We sign a fixed deterministic Nostr event (kind 22242, fixed content +
 *   created_at=0) using whatever signer the user has — local nsec, browser
 *   extension (NIP-07), or bunker (NIP-46). BIP-340 Schnorr is deterministic,
 *   so the same Nostr identity always yields the same 64-byte signature, and
 *   therefore the same BIP39 mnemonic via HKDF.
 *
 *   This means every login method (nsec / passkey / extension / bunker) can
 *   provision a Spark wallet bound to the user's Nostr identity.
 *
 * Storage:
 *   The derived mnemonic is cached in localStorage per pubkey as plaintext
 *   under nd_spark_mnemonic_<pubkeyPrefix>. It avoids re-signing on every
 *   page reload. This is hot-wallet storage — anyone with access to the
 *   browser's localStorage can spend. See WalletInfo modal for guidance.
 */

import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { showZapToast, recentNostrZapMatches } from '../ui/ZapToast';
import { getLocalKey } from './dmService';

const BREEZ_API_KEY = import.meta.env.VITE_BREEZ_API_KEY as string;

// Fixed deterministic seed event. DO NOT change without bumping the suffix
// of `content` — any change here re-derives every user to a new wallet.
const SEED_EVENT = Object.freeze({
  kind:       22242,
  content:    'nostr-district-spark-wallet-v1',
  tags:       [] as string[][],
  created_at: 0,
});

let _sdk: any = null;
let _initPromise: Promise<void> | null = null;

// Tracks payment IDs we've already emitted toasts/events for. The SDK can
// fire paymentSucceeded multiple times per payment (settlement stages), so
// we dedupe by payment.id.
const _processedPaymentIds = new Set<string>();

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignerFn = (event: { kind: number; content: string; tags: string[][]; created_at: number }) => Promise<{ sig: string; id?: string }>;

// ── Payment event pub/sub ─────────────────────────────────────────────────────

export interface SparkPaymentEvent {
  direction: 'received' | 'sent';
  amountSats: number;
  feeSats:    number;
}

const _paymentListeners = new Set<(e: SparkPaymentEvent) => void>();

export function onSparkPayment(cb: (e: SparkPaymentEvent) => void): () => void {
  _paymentListeners.add(cb);
  return () => { _paymentListeners.delete(cb); };
}

function _emitPayment(e: SparkPaymentEvent): void {
  _paymentListeners.forEach(cb => { try { cb(e); } catch { /* ignore */ } });
}

// ── Byte helpers ──────────────────────────────────────────────────────────────

function hexToBytes(h: string): Uint8Array {
  return new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── At-rest encryption (nsec users only) ──────────────────────────────────────
//
// When the user logged in via nsec or passkey we have the raw private key in
// memory via `getLocalKey()`. We derive an AES-GCM key from it via HKDF and
// encrypt the cached mnemonic. Extension and bunker users have no raw key
// available — for those we fall back to plaintext storage (same threat model
// as before this change; documented in WalletInfo).

async function deriveMnemonicAesKey(privkey: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey('raw', privkey.buffer as ArrayBuffer, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('nostr-district-spark-mnemonic-v1'),
      info: new TextEncoder().encode('mnemonic-storage'),
    },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptMnemonic(mnemonic: string, aes: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aes,
    new TextEncoder().encode(mnemonic) as unknown as ArrayBuffer,
  );
  return JSON.stringify({ iv: bytesToHex(iv), ct: bytesToHex(new Uint8Array(ct)) });
}

async function decryptMnemonic(stored: string, aes: CryptoKey): Promise<string | null> {
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
  } catch {
    return null;
  }
}

function looksLikeMnemonic(s: string): boolean {
  return /^[a-z]+(?:\s[a-z]+){11,23}$/.test(s.trim());
}

// ── Mnemonic derivation via signer ────────────────────────────────────────────

async function deriveMnemonicFromSigner(signer: SignerFn): Promise<string> {
  const signed = await signer({ ...SEED_EVENT, tags: SEED_EVENT.tags.slice() });
  if (!signed?.sig || signed.sig.length !== 128) {
    throw new Error('Signer returned an invalid signature');
  }
  const sigBytes = hexToBytes(signed.sig);

  const raw = await crypto.subtle.importKey('raw', sigBytes.buffer as ArrayBuffer, 'HKDF', false, ['deriveBits']);
  // 16 bytes (128 bits) → 12-word BIP39 mnemonic
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('nostr-district-spark-wallet-v1'),
      info: new TextEncoder().encode('entropy'),
    },
    raw,
    128,
  );
  return entropyToMnemonic(new Uint8Array(bits), wordlist);
}

function mnemonicKey(pubkeyHex: string): string {
  return `nd_spark_mnemonic_${pubkeyHex.slice(0, 16)}`;
}

function storageDirFor(pubkeyHex: string): string {
  return `nd-spark-${pubkeyHex.slice(0, 16)}`;
}

// ── Cross-device mnemonic sync via Nostr ─────────────────────────────────────
// Schnorr signatures used in `deriveMnemonicFromSigner` aren't deterministic
// (BIP-340 uses auxiliary randomness), so two browsers with the same nsec
// would otherwise derive different mnemonics and end up with two different
// wallets. To converge: after the first wallet is created on any device, we
// publish the mnemonic as a kind:30078 event, NIP-44 self-encrypted to the
// user's own pubkey. Any other device with the same key can fetch + decrypt
// and adopt the same wallet.

const MNEMONIC_SYNC_D_TAG = 'nostr-district:spark-mnemonic';

/** NIP-44 self-encrypt: encrypt plaintext to the user's own pubkey. */
async function selfEncryptForUser(plaintext: string, pubkeyHex: string): Promise<string | null> {
  const localKey = getLocalKey();
  try {
    const nip44 = await import('nostr-tools/nip44');
    if (localKey) {
      const ck = nip44.getConversationKey(localKey, pubkeyHex);
      return nip44.encrypt(plaintext, ck);
    }
  } catch { /* fall through */ }
  const ext = (window as any).nostr?.nip44;
  if (ext?.encrypt) {
    try { return await ext.encrypt(pubkeyHex, plaintext); } catch { /* fall through */ }
  }
  try {
    const { getBunkerClient } = await import('./nostrService');
    const bunker = getBunkerClient?.();
    if (bunker?.nip44Encrypt) {
      return await bunker.nip44Encrypt(pubkeyHex, plaintext);
    }
  } catch { /* fall through */ }
  return null;
}

/** NIP-44 self-decrypt: decrypt ciphertext that was encrypted to this pubkey. */
async function selfDecryptForUser(ciphertext: string, pubkeyHex: string): Promise<string | null> {
  const localKey = getLocalKey();
  try {
    const nip44 = await import('nostr-tools/nip44');
    if (localKey) {
      const ck = nip44.getConversationKey(localKey, pubkeyHex);
      return nip44.decrypt(ciphertext, ck);
    }
  } catch { /* fall through */ }
  const ext = (window as any).nostr?.nip44;
  if (ext?.decrypt) {
    try { return await ext.decrypt(pubkeyHex, ciphertext); } catch { /* fall through */ }
  }
  try {
    const { getBunkerClient } = await import('./nostrService');
    const bunker = getBunkerClient?.();
    if (bunker?.nip44Decrypt) {
      return await bunker.nip44Decrypt(pubkeyHex, ciphertext);
    }
  } catch { /* fall through */ }
  return null;
}

/** Publish the mnemonic encrypted to the user's own pubkey as kind:30078. */
async function publishEncryptedMnemonic(mnemonic: string, pubkeyHex: string, signer: SignerFn): Promise<void> {
  const ciphertext = await selfEncryptForUser(mnemonic, pubkeyHex);
  if (!ciphertext) {
    console.warn('[Spark] No NIP-44 signer available — skipping mnemonic backup publish');
    return;
  }
  // Defense against asymmetric NIP-44 brokenness: if encrypt works but decrypt
  // doesn't return the original plaintext, we'd be publishing garbage. Skip
  // publishing in that case so we don't overwrite a valid existing backup with
  // an unrecoverable one.
  const roundTrip = await selfDecryptForUser(ciphertext, pubkeyHex);
  if (roundTrip !== mnemonic) {
    console.warn('[Spark] NIP-44 round-trip mismatch — skipping publish to preserve any existing backup');
    return;
  }
  try {
    const signed = await signer({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', MNEMONIC_SYNC_D_TAG], ['client', 'Nostr District']],
      content: ciphertext,
    });
    const { publishEvent } = await import('./nostrService');
    await publishEvent(signed);
    console.log('[Spark] Published encrypted mnemonic backup');
  } catch (e) {
    console.warn('[Spark] Failed to publish mnemonic backup:', e);
  }
}

/**
 * Try to fetch and decrypt the user's mnemonic backup from Nostr. Returns null
 * if not found / undecryptable / times out. Hard 4-second cap so a slow or
 * unresponsive relay can't block wallet init indefinitely.
 */
async function fetchEncryptedMnemonic(pubkeyHex: string): Promise<string | null> {
  try {
    const { DEFAULT_RELAYS } = await import('./relayManager');
    const { SimplePool } = await import('nostr-tools/pool');
    const pool = new SimplePool();
    const fetchPromise = pool.get(DEFAULT_RELAYS.slice(0, 6), {
      kinds: [30078], authors: [pubkeyHex], '#d': [MNEMONIC_SYNC_D_TAG],
    });
    const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 4000));
    const event = await Promise.race([fetchPromise, timeoutPromise]);
    if (!event?.content) return null;
    const decrypted = await selfDecryptForUser(event.content, pubkeyHex);
    if (decrypted && looksLikeMnemonic(decrypted)) return decrypted;
    return null;
  } catch (e) {
    console.warn('[Spark] Failed to fetch mnemonic backup:', e);
    return null;
  }
}

// Once per session we check Nostr for a canonical backup; subsequent calls in
// the same session use the warmed local cache without re-fetching.
const _nostrCheckedThisSession = new Set<string>();

async function getOrDeriveMnemonic(pubkeyHex: string, signer: SignerFn): Promise<string> {
  const key      = mnemonicKey(pubkeyHex);
  const cached   = localStorage.getItem(key);
  const localKey = getLocalKey();
  const aes      = localKey ? await deriveMnemonicAesKey(localKey) : null;

  const readCached = async (): Promise<string | null> => {
    if (!cached) return null;
    if (aes) {
      const decrypted = await decryptMnemonic(cached, aes);
      if (decrypted && looksLikeMnemonic(decrypted)) return decrypted;
    }
    if (looksLikeMnemonic(cached)) {
      // Legacy plaintext blob — migrate to encrypted form when possible
      if (aes) localStorage.setItem(key, await encryptMnemonic(cached, aes));
      return cached;
    }
    return null;
  };

  const writeCache = async (mnemonic: string): Promise<void> => {
    if (aes) localStorage.setItem(key, await encryptMnemonic(mnemonic, aes));
    else     localStorage.setItem(key, mnemonic);
  };

  const localMnemonic = await readCached();

  // First call this session: consult Nostr to converge across devices.
  // Nostr is the source of truth — if it has a mnemonic, we adopt it even if
  // it differs from local cache. (Same nsec = same wallet across browsers.)
  if (!_nostrCheckedThisSession.has(pubkeyHex)) {
    _nostrCheckedThisSession.add(pubkeyHex);
    const fromNostr = await fetchEncryptedMnemonic(pubkeyHex);
    if (fromNostr) {
      if (fromNostr !== localMnemonic) {
        console.log('[Spark] Adopting canonical mnemonic from Nostr backup');
        await writeCache(fromNostr);
      }
      return fromNostr;
    }
    // No backup on Nostr yet. If we have a local mnemonic, publish it now
    // so this becomes the canonical one for future devices.
    if (localMnemonic) {
      publishEncryptedMnemonic(localMnemonic, pubkeyHex, signer).catch(() => {});
      return localMnemonic;
    }
  } else if (localMnemonic) {
    // Subsequent same-session calls just use the local cache.
    return localMnemonic;
  }

  // Truly first time anywhere — derive from signer, cache, publish.
  const mnemonic = await deriveMnemonicFromSigner(signer);
  await writeCache(mnemonic);
  publishEncryptedMnemonic(mnemonic, pubkeyHex, signer).catch(() => {});
  return mnemonic;
}

// ── SDK lifecycle ─────────────────────────────────────────────────────────────

export function getSparkSdk(): any {
  return _sdk;
}

export function initSparkWallet(pubkeyHex: string, signer: SignerFn): Promise<void> {
  console.log('[Spark] initSparkWallet called');
  if (_initPromise) { console.log('[Spark] already initializing'); return _initPromise; }
  _initPromise = _doInit(pubkeyHex, signer);
  return _initPromise;
}

async function _doInit(pubkeyHex: string, signer: SignerFn): Promise<void> {
  console.log('[Spark] API key present:', !!BREEZ_API_KEY, 'length:', BREEZ_API_KEY?.length ?? 0);
  if (!BREEZ_API_KEY) {
    console.warn('[Spark] VITE_BREEZ_API_KEY not set — skipping wallet init');
    return;
  }
  try {
    console.log('[Spark] Importing SDK...');
    const { default: init, connect, defaultConfig } = await import('@breeztech/breez-sdk-spark');
    console.log('[Spark] Initializing WASM...');
    await init();
    console.log('[Spark] WASM ready, getting/deriving mnemonic...');

    const mnemonic   = await getOrDeriveMnemonic(pubkeyHex, signer);
    const storageDir = storageDirFor(pubkeyHex);
    const config     = defaultConfig('mainnet');
    config.apiKey    = BREEZ_API_KEY;
    console.log('[Spark] Connecting with storageDir:', storageDir);

    _sdk = await connect({
      config,
      seed: { type: 'mnemonic', mnemonic },
      storageDir,
    });

    // Hook SDK payment events:
    //   - Incoming: fire "you got zapped" toast (deduped against Nostr zap receipts).
    //   - Either direction: emit to in-app listeners for live UI refresh.
    try {
      await _sdk.addEventListener({
        onEvent: (event: any) => {
          if (event?.type !== 'paymentSucceeded') return;
          const p = event.payment;
          if (!p) return;
          // Dedupe — SDK fires paymentSucceeded multiple times per payment
          // (e.g. across settlement stages).
          const pid = String(p.id ?? '');
          if (pid && _processedPaymentIds.has(pid)) return;
          if (pid) _processedPaymentIds.add(pid);

          const sats = Number(p.amount ?? 0n);
          const fees = Number(p.fees ?? 0n);
          if (!sats) return;

          if (p.paymentType === 'receive') {
            _emitPayment({ direction: 'received', amountSats: sats, feeSats: fees });
            setTimeout(() => {
              if (recentNostrZapMatches(sats)) return;
              showZapToast('Lightning', sats, '', 'incoming');
            }, 2500);
          } else if (p.paymentType === 'send') {
            _emitPayment({ direction: 'sent', amountSats: sats, feeSats: fees });
          }
        },
      });
    } catch (e) {
      console.warn('[Spark] Failed to attach event listener:', e);
    }

    console.log('[Spark] Wallet connected');
  } catch (e) {
    _initPromise = null; // allow retry on next login
    console.error('[Spark] Failed to init wallet:', e);
  }
}

export async function disconnectSparkWallet(pubkeyHex?: string): Promise<void> {
  _initPromise = null;
  if (_sdk) {
    try { await _sdk.disconnect(); } catch {}
    _sdk = null;
  }
  // Clear cached mnemonic on logout. User can re-sign on next login.
  if (pubkeyHex) localStorage.removeItem(mnemonicKey(pubkeyHex));
}

// ── Lightning address ─────────────────────────────────────────────────────────

export async function ensureLightningAddress(displayName: string, pubkeyHex: string): Promise<string | null> {
  if (_initPromise) await _initPromise;
  if (!_sdk) return null;
  try {
    const existing = await _sdk.getLightningAddress();
    if (existing?.lightningAddress) return existing.lightningAddress;

    const base     = (displayName || pubkeyHex.slice(0, 8)).toLowerCase().replace(/[^a-z0-9_]/g, '');
    const username = base.length >= 3 ? base : `nd${pubkeyHex.slice(0, 6)}`;
    const candidate = username.slice(0, 30);

    // Try preferred name first; if taken, try progressively-more-unique fallbacks.
    // This handles the case where the user's previous wallet (different mnemonic,
    // same nsec) already registered the preferred name — Breez sees us as a new
    // identity and rejects the duplicate with 409 "name already taken."
    const isNameTakenError = (e: any): boolean => {
      const msg = String(e?.message || e || '').toLowerCase();
      return msg.includes('name already taken') || msg.includes('409');
    };

    const attempts = [
      candidate,                                          // preferred
      `${candidate}${pubkeyHex.slice(0, 4)}`,             // + 4 hex
      `${candidate}${pubkeyHex.slice(0, 8)}`,             // + 8 hex
      `${candidate}${pubkeyHex.slice(0, 4)}${Date.now().toString(36).slice(-4)}`, // + time
      `nd${pubkeyHex.slice(0, 12)}${Date.now().toString(36).slice(-4)}`,          // last resort, drop display name
    ];

    for (const tryName of attempts) {
      const name = tryName.slice(0, 30);
      try {
        const info = await _sdk.registerLightningAddress({
          username: name,
          description: `Pay ${displayName || name} on Nostr District`,
        });
        if (info?.lightningAddress) return info.lightningAddress;
      } catch (e) {
        if (isNameTakenError(e)) continue; // try next variant
        throw e;                            // other error — bail
      }
    }
    console.warn('[Spark] All Lightning address candidates were taken — wallet still works, but lud16 unset');
    return null;
  } catch (e) {
    console.error('[Spark] Failed to ensure Lightning address:', e);
    return null;
  }
}

// ── Wallet operations (used by UI panels) ────────────────────────────────────

export async function getSparkBalance(): Promise<number | null> {
  if (!_sdk) return null;
  try {
    const info = await _sdk.getInfo({});
    return info?.balanceSats ?? null;
  } catch {
    return null;
  }
}

export async function createSparkInvoice(amountSats: number, description: string): Promise<string | null> {
  if (!_sdk) return null;
  try {
    const paymentMethod: any = { type: 'bolt11Invoice', description };
    if (amountSats > 0) paymentMethod.amountSats = amountSats;
    const result = await _sdk.receivePayment({ paymentMethod });
    return result?.paymentRequest ?? null;
  } catch (e) {
    console.error('[Spark] Failed to create invoice:', e);
    return null;
  }
}

export async function sendSparkPayment(bolt11: string): Promise<boolean> {
  if (!_sdk) return false;
  try {
    const prepared = await _sdk.prepareSendPayment({ paymentRequest: bolt11 });
    await _sdk.sendPayment({ prepareResponse: prepared });
    return true;
  } catch (e) {
    console.error('[Spark] Failed to send payment:', e);
    return false;
  }
}

export interface SparkPayment {
  id:        string;
  type:      'send' | 'receive';
  status:    'completed' | 'pending' | 'failed';
  amount:    number;        // sats
  fees:      number;        // sats
  timestamp: number;        // unix seconds
}

export async function getSparkHistory(limit: number = 30): Promise<SparkPayment[] | null> {
  if (!_sdk) return null;
  try {
    const resp = await _sdk.listPayments({ offset: 0, limit, sortAscending: false });
    return (resp?.payments ?? []).map((p: any): SparkPayment => ({
      id:        String(p.id ?? ''),
      type:      p.paymentType,
      status:    p.status,
      amount:    Number(p.amount ?? 0n),
      fees:      Number(p.fees ?? 0n),
      timestamp: Number(p.timestamp ?? 0),
    }));
  } catch (e) {
    console.error('[Spark] Failed to fetch history:', e);
    return null;
  }
}

export async function sparkCanCover(amountSats: number): Promise<boolean> {
  if (!_sdk) return false;
  const bal = await getSparkBalance();
  return bal !== null && bal >= amountSats;
}

export interface SparkSendResult {
  ok: boolean;
  error?: string;
  feeSats?: number;
}

export async function sendSparkToLightningAddress(
  lud16: string,
  amountSats: number,
): Promise<SparkSendResult> {
  if (!_sdk) return { ok: false, error: 'Wallet not ready' };
  if (amountSats < 1) return { ok: false, error: 'Amount must be at least 1 sat' };

  const [user, domain] = lud16.split('@');
  if (!user || !domain) return { ok: false, error: 'Invalid Lightning address' };

  const amountMsats = amountSats * 1000;
  let lnurlData: any;
  try {
    const r = await fetch(`https://${domain}/.well-known/lnurlp/${user}`);
    if (!r.ok) return { ok: false, error: 'Lightning address not found' };
    lnurlData = await r.json();
  } catch {
    return { ok: false, error: 'Could not reach the recipient server' };
  }

  if (!lnurlData?.callback) return { ok: false, error: 'Invalid Lightning address response' };

  const min = lnurlData.minSendable || 1000;
  const max = lnurlData.maxSendable || 100000000000;
  if (amountMsats < min || amountMsats > max) {
    return { ok: false, error: `Amount must be between ${Math.ceil(min / 1000)} and ${Math.floor(max / 1000)} sats` };
  }

  let bolt11: string;
  try {
    const r = await fetch(`${lnurlData.callback}?amount=${amountMsats}`);
    const data = await r.json();
    if (!data?.pr) return { ok: false, error: 'Recipient did not return an invoice' };
    bolt11 = data.pr;
  } catch {
    return { ok: false, error: 'Could not fetch invoice from recipient' };
  }

  let prepared: any;
  try {
    prepared = await _sdk.prepareSendPayment({ paymentRequest: bolt11 });
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not prepare payment' };
  }

  const pm = prepared?.paymentMethod;
  const feeSats = (pm?.lightningFeeSats ?? 0) + (pm?.sparkTransferFeeSats ?? 0);

  const balance = await getSparkBalance();
  if (balance !== null && balance < amountSats + feeSats) {
    return {
      ok: false,
      error: `Need ${(amountSats + feeSats).toLocaleString()} sats (${amountSats.toLocaleString()} + ${feeSats.toLocaleString()} fee), have ${balance.toLocaleString()}`,
    };
  }

  try {
    await _sdk.sendPayment({ prepareResponse: prepared });
    return { ok: true, feeSats };
  } catch (e: any) {
    console.error('[Spark] sendPayment failed:', e);
    return { ok: false, error: e?.message || 'Payment failed' };
  }
}
