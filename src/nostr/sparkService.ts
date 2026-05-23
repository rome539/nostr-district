/**
 * sparkService.ts — Breez SDK Spark wallet integration
 *
 * Wallet derivation & storage:
 *   First time anywhere: we sign a fixed Nostr event (kind 22242) with the
 *   user's signer to generate a one-shot 16-byte seed → 12-word BIP39
 *   mnemonic. BIP-340 Schnorr is NOT deterministic (it uses auxiliary
 *   randomness), so re-signing on a different device produces a *different*
 *   mnemonic. We solve this by treating Nostr as the single source of truth:
 *
 *   1. On every wallet init, fetch kind:30078 / d=nostr-district:spark-mnemonic
 *      authored by the user, NIP-44 self-encrypted to their own pubkey.
 *   2. If found: use it. Same nsec → same wallet across every browser.
 *   3. If absent (truly first time): derive from signer, publish to Nostr.
 *   4. If event exists but we can't decrypt it (extension NIP-44 quirk) or the
 *      fetch fails: throw. We do NOT derive a fresh mnemonic in that case —
 *      doing so would overwrite a canonical backup and create a divergent
 *      wallet. User is told to try a different extension or nsec login.
 *
 *   No localStorage caching: the mnemonic lives only in memory for the current
 *   session and on Nostr at rest. This keeps the wallet portable (any browser
 *   with the same nsec/extension converges on the same wallet) and avoids the
 *   "lightning address keeps changing across browsers" footgun.
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

// ── Spark reachability ────────────────────────────────────────────────────────
// Flips to false when an SDK call fails in a way that looks like a Spark
// network outage (CORS preflight 403 on Lightspark, auth-service errors,
// generic fetch "Load failed"). Flips back to true on the next successful
// SDK call. The wallet UI subscribes to this so it can show "Lightning
// network temporarily unavailable" instead of letting users hit Send and
// wait for a cryptic SDK error.

let _sparkReachable = true;
const _reachabilityListeners = new Set<(reachable: boolean) => void>();

export function isSparkReachable(): boolean { return _sparkReachable; }

export function onSparkReachabilityChange(cb: (reachable: boolean) => void): () => void {
  _reachabilityListeners.add(cb);
  return () => { _reachabilityListeners.delete(cb); };
}

function _setReachable(next: boolean): void {
  if (next === _sparkReachable) return;
  _sparkReachable = next;
  _reachabilityListeners.forEach(cb => { try { cb(next); } catch { /* ignore */ } });
}

/** Heuristic: does this thrown error look like a Spark-network outage? */
function _looksLikeOutage(e: any): boolean {
  const msg = String(e?.message ?? e ?? '').toLowerCase();
  return (
    msg.includes('service provider error') ||
    msg.includes('authentication error')   ||
    msg.includes('network error')          ||
    msg.includes('load failed')            ||
    msg.includes('access control')         ||
    msg.includes('cors')
  );
}

// ── Byte helpers ──────────────────────────────────────────────────────────────

function hexToBytes(h: string): Uint8Array {
  return new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));
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

/**
 * Publish the mnemonic encrypted to the user's own pubkey as kind:30078.
 * Returns true if the event was signed, encrypted, round-trip verified, and
 * sent to relays without throwing. Callers that need durable storage (first
 * wallet creation) MUST check this — failure here means the wallet would be
 * lost on next reload because Schnorr re-derivation is non-deterministic.
 */
async function publishEncryptedMnemonic(mnemonic: string, pubkeyHex: string, signer: SignerFn): Promise<boolean> {
  const ciphertext = await selfEncryptForUser(mnemonic, pubkeyHex);
  if (!ciphertext) {
    console.warn('[Spark] No NIP-44 signer available — cannot publish mnemonic backup');
    return false;
  }
  // Defense against asymmetric NIP-44 brokenness: if encrypt works but decrypt
  // doesn't return the original plaintext, we'd be publishing garbage. Skip
  // publishing in that case so we don't overwrite a valid existing backup with
  // an unrecoverable one.
  const roundTrip = await selfDecryptForUser(ciphertext, pubkeyHex);
  if (roundTrip !== mnemonic) {
    console.warn('[Spark] NIP-44 round-trip mismatch — refusing to publish unrecoverable backup');
    return false;
  }
  try {
    const signed = await signer({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', MNEMONIC_SYNC_D_TAG], ['client', 'Nostr District']],
      content: ciphertext,
    });
    // Publish to every relay we'll later query, so the round-trip is
    // guaranteed symmetric. Require MIN_CONFIRMATIONS OKs to consider this
    // durable — a single accept isn't enough to survive a relay losing its
    // data or being unreachable on the next session.
    const accepted = await publishToRelays(signed, MNEMONIC_BACKUP_RELAYS);
    console.log(`[Spark] Published mnemonic backup to ${accepted}/${MNEMONIC_BACKUP_RELAYS.length} relays`);
    if (accepted < MIN_CONFIRMATIONS) {
      console.warn(`[Spark] Only ${accepted} relay(s) accepted — below MIN_CONFIRMATIONS (${MIN_CONFIRMATIONS}). Backup not durable.`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[Spark] Failed to publish mnemonic backup:', e);
    return false;
  }
}

/**
 * Publish a signed event to each relay via raw WebSocket and return the count
 * of relays that returned an OK true response. Mirrors the relay set used by
 * fetchEncryptedMnemonic for guaranteed symmetric publish/fetch.
 */
function publishToRelays(event: any, relays: string[]): Promise<number> {
  const sendOne = (url: string): Promise<boolean> => new Promise((resolve) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); }
    catch { resolve(false); return; }
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 8000);
    ws.onopen = () => { try { ws.send(JSON.stringify(['EVENT', event])); } catch { finish(false); } };
    ws.onmessage = (msg) => {
      try {
        const d = JSON.parse(msg.data);
        if (Array.isArray(d) && d[0] === 'OK' && d[1] === event.id) {
          clearTimeout(timer);
          finish(d[2] === true);
        }
      } catch {}
    };
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
  return Promise.all(relays.map(sendOne)).then(results => results.filter(Boolean).length);
}

/**
 * Try to fetch and decrypt the user's mnemonic backup from Nostr.
 *
 * Returns one of four outcomes — the caller MUST distinguish them, because
 * "we couldn't read a backup" is very different from "no backup exists":
 *
 *   - 'found'         — got it; use this mnemonic
 *   - 'undecryptable' — an event exists on Nostr but our NIP-44 can't read it
 *                       (extension quirk, wrong key, etc.). DO NOT overwrite.
 *   - 'no-event'      — at least MIN_CONFIRMATIONS relays sent EOSE confirming
 *                       no kind:30078 backup exists. Safe to create a new one.
 *   - 'error'         — too few relays responded to confirm absence. State
 *                       unknown; refuse to publish a fresh mnemonic.
 *
 * Uses raw WebSockets per-relay (same as publishEvent) for predictable
 * behavior. We MUST get positive EOSE-no-event confirmation from at least
 * MIN_CONFIRMATIONS relays before declaring no-event — otherwise a network
 * race / dropped connection could fool us into overwriting a valid backup
 * with a fresh divergent wallet.
 */
type FetchBackupResult =
  | { status: 'found'; mnemonic: string }
  | { status: 'undecryptable' }
  | { status: 'no-event' }
  | { status: 'error' };

const MNEMONIC_BACKUP_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://nostr.wine',
  'wss://relay.0xchat.com',
  'wss://nostr21.com',
];
const MIN_CONFIRMATIONS = 2;
const PER_RELAY_TIMEOUT_MS = 12000;

type RelayResponse =
  | { kind: 'event'; event: any }
  | { kind: 'eose-empty' }
  | { kind: 'error' };

function queryRelayForMnemonic(url: string, pubkeyHex: string): Promise<RelayResponse> {
  return new Promise((resolve) => {
    const subId = 'sm' + Math.random().toString(36).slice(2, 12);
    let ws: WebSocket;
    try { ws = new WebSocket(url); }
    catch { resolve({ kind: 'error' }); return; }

    let done = false;
    let latest: any = null;
    const finish = (resp: RelayResponse) => {
      if (done) return;
      done = true;
      try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {}
      try { ws.close(); } catch {}
      resolve(resp);
    };
    const timer = setTimeout(() => finish({ kind: 'error' }), PER_RELAY_TIMEOUT_MS);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(['REQ', subId, {
          kinds: [30078], authors: [pubkeyHex], '#d': [MNEMONIC_SYNC_D_TAG],
        }]));
      } catch { finish({ kind: 'error' }); }
    };
    ws.onmessage = (msg) => {
      try {
        const d = JSON.parse(msg.data);
        if (!Array.isArray(d) || d[1] !== subId) return;
        if (d[0] === 'EVENT' && d[2]?.content) {
          // Keep the newest if multiple come in (replaceable event semantics).
          if (!latest || (d[2].created_at ?? 0) > (latest.created_at ?? 0)) latest = d[2];
        } else if (d[0] === 'EOSE') {
          clearTimeout(timer);
          finish(latest ? { kind: 'event', event: latest } : { kind: 'eose-empty' });
        }
      } catch { /* ignore malformed */ }
    };
    ws.onerror = () => finish({ kind: 'error' });
    ws.onclose = () => finish(latest ? { kind: 'event', event: latest } : { kind: 'error' });
  });
}

async function fetchEncryptedMnemonic(pubkeyHex: string): Promise<FetchBackupResult> {
  console.log(`[Spark] Querying ${MNEMONIC_BACKUP_RELAYS.length} relays for mnemonic backup (pk=${pubkeyHex.slice(0, 8)})`);
  const responses = await Promise.all(
    MNEMONIC_BACKUP_RELAYS.map(url => queryRelayForMnemonic(url, pubkeyHex))
  );

  const events       = responses.filter(r => r.kind === 'event').map(r => (r as any).event);
  const eoseEmpty    = responses.filter(r => r.kind === 'eose-empty').length;
  const errors       = responses.filter(r => r.kind === 'error').length;
  console.log(`[Spark] Relay responses: ${events.length} with event, ${eoseEmpty} confirmed empty, ${errors} errored`);

  // Any relay returning the event wins — we take the newest by created_at.
  if (events.length > 0) {
    const latest = events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
    const decrypted = await selfDecryptForUser(latest.content, pubkeyHex);
    if (decrypted && looksLikeMnemonic(decrypted)) return { status: 'found', mnemonic: decrypted };
    return { status: 'undecryptable' };
  }

  // Only declare 'no-event' if MIN_CONFIRMATIONS relays positively confirmed
  // (sent EOSE without ever sending the event). Anything less is a network
  // race and we MUST NOT publish a fresh mnemonic over a possibly-existing one.
  if (eoseEmpty >= MIN_CONFIRMATIONS) return { status: 'no-event' };
  return { status: 'error' };
}

async function getOrDeriveMnemonic(pubkeyHex: string, signer: SignerFn): Promise<string> {
  // Nostr is the single source of truth — no localStorage caching ever.
  const fromNostr = await fetchEncryptedMnemonic(pubkeyHex);

  if (fromNostr.status === 'found') return fromNostr.mnemonic;

  // A backup event exists on Nostr but our NIP-44 can't decrypt it (asymmetric
  // extension brokenness, different extension on this browser, etc.), OR the
  // fetch failed/timed out. We MUST NOT derive a fresh mnemonic in either case
  // — Schnorr signatures use auxiliary randomness, so the new mnemonic would
  // differ from the canonical one, and publishing it would overwrite a valid
  // backup with a divergent wallet ("lightning address keeps changing across
  // browsers" footgun).
  if (fromNostr.status === 'undecryptable') {
    throw new Error('A wallet backup exists on Nostr but this browser cannot decrypt it. Try logging in with your nsec directly, or with a different extension.');
  }
  if (fromNostr.status === 'error') {
    throw new Error('Could not reach Nostr relays to load wallet backup. Check your connection and try again.');
  }

  // status === 'no-event': truly first time anywhere. Derive from signer,
  // publish to Nostr. The publish MUST succeed; otherwise on next reload we'd
  // derive a different mnemonic (Schnorr non-determinism) and lose this wallet.
  const mnemonic = await deriveMnemonicFromSigner(signer);
  const published = await publishEncryptedMnemonic(mnemonic, pubkeyHex, signer);
  if (!published) {
    throw new Error('Could not save wallet backup to Nostr. The wallet was not created — try again with a working network connection and a NIP-44-capable signer.');
  }
  return mnemonic;
}

// ── SDK lifecycle ─────────────────────────────────────────────────────────────

export function getSparkSdk(): any {
  return _sdk;
}

// Last init error message (user-facing). Cleared on successful init / disconnect.
let _initError: string | null = null;
export function getSparkInitError(): string | null { return _initError; }

// Returns the current in-flight init promise (if any) so the UI can re-render
// when it settles. Returns null if init hasn't been kicked off yet or is done.
export function getSparkInitPromise(): Promise<void> | null { return _initPromise; }

export function initSparkWallet(pubkeyHex: string, signer: SignerFn): Promise<void> {
  console.log('[Spark] initSparkWallet called');
  if (_initPromise) { console.log('[Spark] already initializing'); return _initPromise; }
  _initPromise = _doInit(pubkeyHex, signer);
  return _initPromise;
}

async function _doInit(pubkeyHex: string, signer: SignerFn): Promise<void> {
  _initError = null;
  console.log('[Spark] API key present:', !!BREEZ_API_KEY, 'length:', BREEZ_API_KEY?.length ?? 0);
  if (!BREEZ_API_KEY) {
    console.warn('[Spark] VITE_BREEZ_API_KEY not set — skipping wallet init');
    _initError = 'Wallet is unavailable in this build (no API key configured).';
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
    _initError = (e as Error)?.message || String(e) || 'Wallet failed to initialize.';
    console.error('[Spark] Failed to init wallet:', e);
  }
}

export async function disconnectSparkWallet(_pubkeyHex?: string): Promise<void> {
  _initPromise = null;
  _initError = null;
  if (_sdk) {
    try { await _sdk.disconnect(); } catch {}
    _sdk = null;
  }
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

    // Random hex suffix from Web Crypto — fresh per call, not derived from
    // pubkey or time. Avoids the pitfall where a regenerated wallet hits the
    // same deterministic fallbacks the previous wallet already burned through.
    const randHex = (bytes: number): string =>
      Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    const attempts = [
      candidate,                                          // preferred — display name as-is
      `${candidate}${randHex(2)}`,                        // + 4 random hex (16 bits)
      `${candidate}${randHex(3)}`,                        // + 6 random hex (24 bits)
      `${candidate}${randHex(4)}`,                        // + 8 random hex (32 bits)
      `nd${randHex(6)}`,                                  // last resort: drop display name, 12 random hex (48 bits)
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
    _setReachable(true);
    return info?.balanceSats ?? null;
  } catch (e) {
    if (_looksLikeOutage(e)) _setReachable(false);
    return null;
  }
}

export async function createSparkInvoice(amountSats: number, description: string): Promise<string | null> {
  if (!_sdk) return null;
  try {
    const paymentMethod: any = { type: 'bolt11Invoice', description };
    if (amountSats > 0) paymentMethod.amountSats = amountSats;
    const result = await _sdk.receivePayment({ paymentMethod });
    _setReachable(true);
    return result?.paymentRequest ?? null;
  } catch (e) {
    if (_looksLikeOutage(e)) _setReachable(false);
    console.error('[Spark] Failed to create invoice:', e);
    return null;
  }
}

export interface SparkPaymentResult {
  ok: boolean;
  paymentId?: string;
}

export async function sendSparkPayment(bolt11: string): Promise<SparkPaymentResult> {
  if (!_sdk) return { ok: false };
  try {
    const prepared = await _sdk.prepareSendPayment({ paymentRequest: bolt11 });
    const resp     = await _sdk.sendPayment({ prepareResponse: prepared });
    _setReachable(true);
    const id       = resp?.payment?.id ?? resp?.id;
    return { ok: true, paymentId: id ? String(id) : undefined };
  } catch (e) {
    if (_looksLikeOutage(e)) _setReachable(false);
    console.error('[Spark] Failed to send payment:', e);
    return { ok: false };
  }
}

export interface SparkPayment {
  id:          string;
  type:        'send' | 'receive';
  status:      'completed' | 'pending' | 'failed';
  amount:      number;        // sats
  fees:        number;        // sats
  timestamp:   number;        // unix seconds
  description: string;        // payee/payer note (LNURL comment, bolt11 memo, etc.)
  bolt11?:     string;        // BOLT11 invoice, when available — used to correlate zap-receipt cache
}

/** Pull the most descriptive text we can find from a Breez payment object. */
function extractPaymentDescription(p: any): string {
  const candidates: any[] = [
    p?.description,
    p?.details?.description,
    p?.details?.bolt11?.description,
    p?.details?.invoice?.description,
    p?.details?.lnurlPay?.comment,
    p?.details?.lnurlPay?.metadata,
    p?.metadata?.description,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return '';
}

/** Find the bolt11 invoice string on a Breez payment object across known shapes. */
function extractPaymentBolt11(p: any): string | undefined {
  const candidates: any[] = [
    p?.details?.bolt11?.bolt11,
    p?.details?.bolt11?.invoice,
    p?.details?.invoice?.bolt11,
    p?.details?.invoice?.invoice,
    p?.details?.invoice,
    p?.bolt11,
    p?.invoice,
    p?.paymentRequest,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.toLowerCase().startsWith('ln')) return c;
  }
  return undefined;
}

export async function getSparkHistory(limit: number = 30): Promise<SparkPayment[] | null> {
  if (!_sdk) return null;
  try {
    const resp = await _sdk.listPayments({ offset: 0, limit, sortAscending: false });
    _setReachable(true);
    return (resp?.payments ?? []).map((p: any): SparkPayment => ({
      id:          String(p.id ?? ''),
      type:        p.paymentType,
      status:      p.status,
      amount:      Number(p.amount ?? 0n),
      fees:        Number(p.fees ?? 0n),
      timestamp:   Number(p.timestamp ?? 0),
      description: extractPaymentDescription(p),
      bolt11:      extractPaymentBolt11(p),
    }));
  } catch (e) {
    if (_looksLikeOutage(e)) _setReachable(false);
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
  error?:     string;
  feeSats?:   number;
  paymentId?: string;
}

export async function sendSparkToLightningAddress(
  lud16: string,
  amountSats: number,
  comment: string = '',
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

  // Pass the comment via LUD-12 (`?comment=` param) when the recipient's LNURL
  // service advertises support. `commentAllowed` is the max character count;
  // we trim the comment to that length to avoid the server rejecting it.
  const trimmedComment = comment.trim();
  const commentMax     = Number(lnurlData.commentAllowed ?? 0);
  const sendComment    = trimmedComment && commentMax > 0
    ? trimmedComment.slice(0, commentMax)
    : '';

  let bolt11: string;
  try {
    const params = new URLSearchParams({ amount: String(amountMsats) });
    if (sendComment) params.set('comment', sendComment);
    const r = await fetch(`${lnurlData.callback}?${params.toString()}`);
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
    const resp = await _sdk.sendPayment({ prepareResponse: prepared });
    _setReachable(true);
    const id   = resp?.payment?.id ?? resp?.id;
    return { ok: true, feeSats, paymentId: id ? String(id) : undefined };
  } catch (e: any) {
    if (_looksLikeOutage(e)) _setReachable(false);
    console.error('[Spark] sendPayment failed:', e);
    return { ok: false, error: e?.message || 'Payment failed' };
  }
}
