/**
 * zapService.ts — NIP-57 Zap support
 *
 * Fetches LNURL/lud16 from target's kind:0,
 * builds a kind:9734 zap request, requests a Lightning invoice,
 * and pays via WebLN → NWC → QR fallback.
 */

import { authStore } from '../stores/authStore';
import { signEvent, fetchSparkAddress, publishEvent } from './nostrService';
import { nwcPayInvoice, weblnPayInvoice, hasNWC, hasWebLN } from './nwcService';
import { sendSparkPayment, sparkCanCover } from './sparkService';

// ── Local zap-message cache ──────────────────────────────────────────────────
// When the user sends a zap with an attached message, NIP-57 only includes the
// message inside the kind:9734 zap request (sent via LNURL) — the bolt11 itself
// uses a description_hash, so the Breez wallet sees no readable description on
// the resulting payment. Cache the message locally keyed by the Spark payment
// id so the sender can see what they wrote in their wallet history.
const ZAP_MSG_CACHE_KEY = 'nd_zap_messages_v1';
const ZAP_MSG_CACHE_MAX = 200;

function readZapMsgCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ZAP_MSG_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeZapMsgCache(map: Record<string, string>): void {
  // Trim oldest entries (by insertion order — last 200 wins) if oversized.
  const keys = Object.keys(map);
  if (keys.length > ZAP_MSG_CACHE_MAX) {
    const trimmed: Record<string, string> = {};
    keys.slice(-ZAP_MSG_CACHE_MAX).forEach(k => { trimmed[k] = map[k]; });
    map = trimmed;
  }
  try { localStorage.setItem(ZAP_MSG_CACHE_KEY, JSON.stringify(map)); } catch { /* quota */ }
}

/** Cache an outgoing payment's message so the sender's wallet history can show
 *  it. Exposed so the WalletPanel SEND tab can record manual-LNURL-pay comments
 *  alongside zaps initiated from ZapModal. */
export function cacheZapMessage(paymentId: string, comment: string): void {
  if (!paymentId || !comment.trim()) return;
  const map = readZapMsgCache();
  map[paymentId] = comment;
  writeZapMsgCache(map);
}

export function getCachedZapMessage(paymentId: string): string | null {
  if (!paymentId) return null;
  return readZapMsgCache()[paymentId] || null;
}

// ── Incoming-zap cache ───────────────────────────────────────────────────────
// For receives we don't know the local Spark payment id ahead of time, so we
// cache zaps by whatever correlator we can grab at receive time (bolt11 from
// the kind:9735, the zap-request event id) plus amount+timestamp as a fallback.
// WalletPanel queries this when rendering incoming rows.

interface IncomingZapInfo {
  comment:      string;
  senderPubkey: string;
  amountSats:   number;
  ts:           number;       // unix sec
  bolt11?:      string;
  zapReqId?:    string;
}

const ZAP_IN_CACHE_KEY = 'nd_zap_messages_in_v1';
const ZAP_IN_CACHE_MAX = 200;
const ZAP_IN_TS_WINDOW = 300; // seconds — amount+ts fallback match

function readZapInCache(): IncomingZapInfo[] {
  try {
    const raw = localStorage.getItem(ZAP_IN_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeZapInCache(items: IncomingZapInfo[]): void {
  if (items.length > ZAP_IN_CACHE_MAX) items = items.slice(-ZAP_IN_CACHE_MAX);
  try { localStorage.setItem(ZAP_IN_CACHE_KEY, JSON.stringify(items)); } catch { /* quota */ }
}

function cacheIncomingZap(info: IncomingZapInfo): void {
  // Skip empty-comment entries unless this is the first time we're hearing
  // about this zap (we still want a placeholder so the bolt11 can match
  // a wallet payment, even if no comment ever arrives).
  const items = readZapInCache();

  // Merge with any existing entry for the same zapReqId or bolt11.
  for (let i = 0; i < items.length; i++) {
    const e = items[i];
    const sameReq    = info.zapReqId && e.zapReqId && e.zapReqId === info.zapReqId;
    const sameBolt11 = info.bolt11   && e.bolt11   && e.bolt11   === info.bolt11;
    if (sameReq || sameBolt11) {
      // Prefer the non-empty comment.
      items[i] = {
        ...e,
        ...info,
        comment: (e.comment && e.comment.trim()) ? e.comment : info.comment,
      };
      writeZapInCache(items);
      return;
    }
  }

  items.push(info);
  writeZapInCache(items);
}

/**
 * Find a cached incoming-zap entry for a Spark payment. Tries bolt11 first
 * (most reliable), then falls back to amount + timestamp window.
 */
export function findCachedIncomingZap(
  amountSats: number,
  paymentTs:  number,
  bolt11?:    string,
): IncomingZapInfo | null {
  const items = readZapInCache();
  if (bolt11) {
    const exact = items.find(i => i.bolt11 === bolt11);
    if (exact) return exact;
  }
  const candidates = items.filter(i =>
    i.amountSats === amountSats &&
    Math.abs((i.ts || 0) - paymentTs) <= ZAP_IN_TS_WINDOW &&
    (i.comment || '').trim().length > 0,
  );
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

// ── LNURL helpers ─────────────────────────────────────────────────────────────

function lud16ToUrl(lud16: string): string | null {
  // user@domain.com → https://domain.com/.well-known/lnurlp/user
  const [user, domain] = lud16.split('@');
  if (!user || !domain) return null;
  return `https://${domain}/.well-known/lnurlp/${user}`;
}

async function fetchLNURLPData(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('LNURL fetch failed');
  return r.json();
}

// ── Kind 0 fetch ──────────────────────────────────────────────────────────────

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.mostr.pub',
];

export async function fetchKind0(pubkey: string): Promise<Record<string, any> | null> {
  return new Promise((resolve) => {
    let found = false;
    let finished = 0;
    const sockets: WebSocket[] = [];
    const timer = setTimeout(() => { if (!found) resolve(null); sockets.forEach(s => { try { s.close(); } catch { /* */ } }); }, 5000);

    RELAYS.forEach(url => {
      try {
        const ws = new WebSocket(url);
        sockets.push(ws);
        const sub = 'zap_k0_' + Math.random().toString(36).slice(2, 6);
        ws.onopen = () => ws.send(JSON.stringify(['REQ', sub, { kinds: [0], authors: [pubkey], limit: 1 }]));
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data as string);
            if (msg[0] === 'EVENT' && msg[2]?.kind === 0 && !found) {
              found = true;
              clearTimeout(timer);
              sockets.forEach(s => { try { s.close(); } catch { /* */ } });
              resolve(JSON.parse(msg[2].content));
            }
          } catch { /* */ }
        };
        ws.onclose = ws.onerror = () => {
          finished++;
          if (finished >= RELAYS.length && !found) resolve(null);
        };
      } catch { finished++; }
    });
  });
}

// ── Zap request builder (kind:9734) ──────────────────────────────────────────

async function buildZapRequest(
  recipientPubkey: string,
  amountMsats: number,
  comment: string,
  lnurlCallbackUrl: string,
): Promise<any | null> {
  const auth = authStore.getState();
  if (!auth.pubkey || auth.isGuest) return null;

  const zapRequest = {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    content: comment,
    tags: [
      ['p', recipientPubkey],
      ['amount', String(amountMsats)],
      ['lnurl', lnurlCallbackUrl],
      ['relays', ...RELAYS],
      ['client', 'Nostr District'],
    ],
  };

  try { return await signEvent(zapRequest); }
  catch { return null; }
}

// ── Fetch Lightning invoice ───────────────────────────────────────────────────

async function fetchInvoice(
  callbackUrl: string,
  amountMsats: number,
  zapRequestJson: string | null, // null = plain payment, no nostr param
): Promise<{ pr: string; verify?: string } | null> {
  const params = new URLSearchParams({ amount: String(amountMsats) });
  if (zapRequestJson) params.set('nostr', zapRequestJson);
  try {
    const r = await fetch(`${callbackUrl}?${params}`);
    const data = await r.json();
    console.log('[market] LNURL callback response:', JSON.stringify(data));
    if (!data.pr) return null;
    return { pr: data.pr, verify: data.verify || undefined };
  } catch { return null; }
}

// ── Direct lightning address pay (no zap request) ────────────────────────────

/**
 * Pay a lightning address for a market purchase.
 * Uses NIP-57 zap request when the store supports it so we can detect
 * payment via kind:9735 zap receipts on Nostr relays.
 */
export async function payLightningAddress(
  lud16: string,
  amountSats: number,
  onStatus?: (msg: string) => void,
  item?: { id: string; slot: string; value: string; name: string },
): Promise<ZapResult> {
  const amountMsats = amountSats * 1000;
  const url = lud16ToUrl(lud16);
  if (!url) return { status: 'error', error: 'Invalid lightning address' };

  onStatus?.('Connecting…');
  let lnurlData: any;
  try { lnurlData = await fetchLNURLPData(url); }
  catch { return { status: 'error', error: 'Could not reach lightning server' }; }

  if (!lnurlData?.callback) return { status: 'error', error: 'Invalid LNURL response' };

  const minSendable = lnurlData.minSendable || 1000;
  const maxSendable = lnurlData.maxSendable || 100000000000;
  if (amountMsats < minSendable || amountMsats > maxSendable) {
    return { status: 'error', error: `Amount out of range (${Math.ceil(minSendable / 1000)}–${Math.floor(maxSendable / 1000)} sats)` };
  }

  // Build a NIP-57 zap request if the store supports it so we can verify
  // payment by listening for the kind:9735 zap receipt on relays.
  const storeNostrPubkey: string | undefined = lnurlData.allowsNostr ? lnurlData.nostrPubkey : undefined;
  let zapRequestJson: string | null = null;
  let zapEventId: string | undefined;

  if (storeNostrPubkey) {
    onStatus?.('Building payment request…');
    const auth = authStore.getState();
    if (auth.pubkey && !auth.isGuest) {
      const zapReq = {
        kind: 9734,
        created_at: Math.floor(Date.now() / 1000),
        content: item ? `market-purchase:${item.name}` : 'market-purchase',
        tags: [
          ['p', storeNostrPubkey],
          ['amount', String(amountMsats)],
          ['lnurl', lnurlData.callback],
          ['relays', ...RELAYS],
          ...(item ? [['item', item.id, item.slot, item.value]] : []),
        ],
      };
      try {
        const signed = await signEvent(zapReq);
        zapRequestJson = JSON.stringify(signed);
        zapEventId = (signed as any).id;
      } catch { /* fall through to plain pay */ }
    }
  }

  onStatus?.('Requesting invoice…');
  const inv = await fetchInvoice(lnurlData.callback, amountMsats, zapRequestJson);
  if (!inv) return { status: 'error', error: 'Failed to get invoice' };

  // Spark (in-game wallet) — preferred when it has the funds
  if (await sparkCanCover(amountSats)) {
    onStatus?.('Paying from in-game wallet…');
    const r = await sendSparkPayment(inv.pr);
    if (r.ok) return { status: 'paid' };
  }

  if (hasWebLN()) {
    onStatus?.('Paying via WebLN…');
    const result = await weblnPayInvoice(inv.pr);
    if (result.preimage) return { status: 'paid' };
  }

  if (hasNWC()) {
    onStatus?.('Paying via wallet…');
    const result = await nwcPayInvoice(inv.pr);
    if (result.preimage) return { status: 'paid' };
    if (result.error) return { status: 'error', error: result.error };
  }

  return {
    status:       'invoice',
    invoice:      inv.pr,
    verifyUrl:    inv.verify,
    nostrPubkey:  storeNostrPubkey,
    zapEventId,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ZapTarget {
  pubkey:      string;
  displayName: string;
}

export interface ZapResult {
  status:        'paid' | 'invoice' | 'error';
  invoice?:      string; // for QR fallback
  verifyUrl?:    string; // LNURL-pay verify endpoint for polling
  nostrPubkey?:  string; // store's nostr pubkey (for zap receipt polling)
  zapEventId?:   string; // signed zap request event ID (to match receipt)
  error?:        string;
}

/**
 * Full zap flow: fetch lud16 → build 9734 → get invoice → pay
 * Returns { status: 'paid' } on WebLN/NWC success,
 *         { status: 'invoice', invoice } for QR fallback,
 *         { status: 'error', error } on failure
 */
export async function zapUser(
  recipientPubkey: string,
  amountSats: number,
  comment: string,
  onStatus?: (msg: string) => void,
): Promise<ZapResult> {
  const amountMsats = amountSats * 1000;

  // In-game zaps prefer the recipient's in-game (Spark) wallet via a NIP-78
  // kind:30078 event. Falls back to whatever's in their kind:0 profile if
  // they don't have one (e.g., extension users who haven't logged in here yet).
  onStatus?.('Looking up recipient…');
  const sparkAddr = await fetchSparkAddress(recipientPubkey).catch(() => null);

  let lud16: string | undefined = sparkAddr || undefined;
  let lud06: string | undefined;

  if (!lud16) {
    onStatus?.('Fetching profile…');
    const profile = await fetchKind0(recipientPubkey);
    if (!profile) return { status: 'error', error: 'Could not fetch profile' };
    lud16 = profile.lud16;
    lud06 = profile.lud06;
  }

  let lnurlpUrl: string | null = null;
  if (lud16) {
    lnurlpUrl = lud16ToUrl(lud16);
  } else if (lud06) {
    // lud06 is a bech32 LNURL — decode it
    try {
      // Use TextDecoder to convert words to URL
      const upper = lud06.toUpperCase();
      const words: number[] = [];
      const CHARSET = 'QPZRY9X8GF2TVDW0S3JNLHSRUBMYPOAKCEG6';
      for (let i = upper.indexOf('1') + 1; i < upper.length - 6; i++) {
        words.push(CHARSET.indexOf(upper[i]));
      }
      // Convert 5-bit groups to bytes
      const bytes: number[] = [];
      let acc = 0, bits = 0;
      for (const w of words) { acc = (acc << 5) | w; bits += 5; if (bits >= 8) { bytes.push((acc >> (bits - 8)) & 0xff); bits -= 8; } }
      lnurlpUrl = new TextDecoder().decode(new Uint8Array(bytes));
    } catch { /* */ }
  }

  if (!lnurlpUrl) return { status: 'error', error: 'This user has no lightning address' };

  onStatus?.('Connecting to wallet…');
  let lnurlData: any;
  try { lnurlData = await fetchLNURLPData(lnurlpUrl); }
  catch { return { status: 'error', error: 'Could not reach lightning server' }; }

  if (!lnurlData.callback) return { status: 'error', error: 'Invalid LNURL response' };

  const minSendable = lnurlData.minSendable || 1000;
  const maxSendable = lnurlData.maxSendable || 100000000000;
  if (amountMsats < minSendable || amountMsats > maxSendable) {
    return { status: 'error', error: `Amount out of range (${Math.ceil(minSendable / 1000)}–${Math.floor(maxSendable / 1000)} sats)` };
  }

  const supportsZap = lnurlData.allowsNostr && lnurlData.nostrPubkey;

  onStatus?.('Building zap…');
  let signedZapRequest: any | null = null;
  if (supportsZap) {
    signedZapRequest = await buildZapRequest(recipientPubkey, amountMsats, comment, lnurlData.callback);
  }
  const zapRequestJson = signedZapRequest ? JSON.stringify(signedZapRequest) : null;

  onStatus?.('Requesting invoice…');
  const inv = await fetchInvoice(
    lnurlData.callback,
    amountMsats,
    zapRequestJson || '{}',
  );
  if (!inv) return { status: 'error', error: 'Failed to get invoice' };

  // Spark (in-game wallet) — preferred when it has the funds
  if (await sparkCanCover(amountSats)) {
    onStatus?.('Paying from in-game wallet…');
    const r = await sendSparkPayment(inv.pr);
    if (r.ok) {
      // Cache the comment locally so the sender can see it in wallet history
      // (NIP-57 puts the comment in the zap request, not the bolt11 itself).
      if (r.paymentId && comment.trim()) cacheZapMessage(r.paymentId, comment);
      // FUTURE: encrypt the zap comment before relay publish.
      // Currently the kind:9734 we publish to relays carries the comment in
      // plaintext, so anyone watching the sender's events can read it. This
      // matches every other Nostr zap client today, but we could do better:
      //   1. Keep the LNURL-POSTed 9734 plaintext (NIP-57 compliance — breez.tips
      //      uses its content for description_hash and may include it in 9735).
      //   2. Build a SECOND 9734 with content = NIP-44(comment, recipientPubkey)
      //      and tags += [['encrypted','nip44'], ['bolt11', inv.pr]]. Publish
      //      that one to relays instead of the plaintext copy.
      //   3. Receiver's handleZapRequest checks for the encrypted tag and
      //      decrypts via signer; falls back to plaintext for external senders.
      //   4. Switch dedupe primary key to bolt11 (the 9735 receipt has the
      //      same bolt11 tag, so cross-correlation still works even though the
      //      encrypted 9734's event id differs from the LNURL-POSTed one).
      // Partial privacy only — if breez.tips publishes the 9735 with the
      // plaintext 9734 embedded in `description`, the comment leaks via that
      // path regardless of what we do here. Worth shipping when we have data
      // on actual zap traffic / message sensitivity.
      //
      // Publish the signed zap request to relays so the recipient's client
      // can surface the comment even if the LNURL provider doesn't publish
      // a proper kind:9735 zap receipt.
      if (signedZapRequest) publishEvent(signedZapRequest).catch(() => {});
      return { status: 'paid' };
    }
  }

  // Try WebLN first
  if (hasWebLN()) {
    onStatus?.('Paying via WebLN…');
    const result = await weblnPayInvoice(inv.pr);
    if (result.preimage) {
      if (signedZapRequest) publishEvent(signedZapRequest).catch(() => {});
      return { status: 'paid' };
    }
    if (result.error && result.error !== 'No WebLN') {
      // User cancelled — fall through to QR
    }
  }

  // Try NWC
  if (hasNWC()) {
    onStatus?.('Paying via wallet…');
    const result = await nwcPayInvoice(inv.pr);
    if (result.preimage) {
      if (signedZapRequest) publishEvent(signedZapRequest).catch(() => {});
      return { status: 'paid' };
    }
    if (result.error) return { status: 'error', error: result.error };
  }

  // QR fallback
  return { status: 'invoice', invoice: inv.pr, verifyUrl: inv.verify };
}

// ── Market purchase receipt watcher ──────────────────────────────────────────

/**
 * Opens relay connections and calls onPaid() when a kind:9735 zap receipt
 * arrives that matches our zapEventId. Returns a cleanup function.
 */
export function watchForPurchaseReceipt(
  storeNostrPubkey: string,
  zapEventId: string,
  onPaid: () => void,
): () => void {
  const sockets: WebSocket[] = [];
  const seen = new Set<string>();
  const since = Math.floor(Date.now() / 1000) - 10;

  const check = (ev: any) => {
    if (seen.has(ev.id)) return;
    seen.add(ev.id);
    // Match by the description tag (contains original zap request JSON)
    const descTag = ev.tags?.find((t: string[]) => t[0] === 'description');
    if (!descTag?.[1]) return;
    try {
      const zapReq = JSON.parse(descTag[1]);
      if (zapReq.id === zapEventId) {
        const itemTag = zapReq.tags?.find((t: string[]) => t[0] === 'item');
        console.log('[Market] zap receipt received', {
          receiptId: ev.id,
          receiptPubkey: ev.pubkey,
          zapRequestId: zapReq.id,
          item: itemTag ? { id: itemTag[1], slot: itemTag[2], value: itemTag[3] } : null,
          fullReceipt: ev,
        });
        cleanup();
        onPaid();
      }
    } catch { /* */ }
  };

  const cleanup = () => {
    sockets.forEach(s => { try { s.close(); } catch { /* */ } });
    sockets.length = 0;
  };

  RELAYS.forEach(relayUrl => {
    try {
      const ws = new WebSocket(relayUrl);
      sockets.push(ws);
      const sub = 'mkt_' + Math.random().toString(36).slice(2, 8);
      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', sub, {
          kinds: [9735],
          '#p': [storeNostrPubkey],
          since,
        }]));
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg[0] === 'EVENT' && msg[2]?.kind === 9735) check(msg[2]);
        } catch { /* */ }
      };
    } catch { /* */ }
  });

  return cleanup;
}

// ── Zap receipt subscription (kind 9735) ─────────────────────────────────────

// Tracks kind:9734 zap-request event ids we've already surfaced — used to
// dedupe across the two paths a single zap can arrive on (raw 9734 we
// republish ourselves, and the canonical 9735 receipt from the LNURL provider
// which embeds the same 9734 JSON in its `description` tag). When both arrive
// we always prefer the raw 9734, because some LNURL providers (e.g.,
// breez.tips) strip the comment from the embedded zap request — only the raw
// 9734 reliably carries the sender's message in its `content`.
const _seenZapRequestIds  = new Set<string>();
const _seenReceiptIds     = new Set<string>();
const _pendingReceiptToasts = new Map<string, ReturnType<typeof setTimeout>>();
const RECEIPT_DEFER_MS    = 1500;

const _zapReceiptSockets: WebSocket[] = [];

export function subscribeToZapReceipts(
  pubkey: string,
  onZap: (senderPubkey: string, amountSats: number, comment: string) => void,
): () => void {
  // Close any existing subscriptions
  _zapReceiptSockets.forEach(s => { try { s.close(); } catch { /* */ } });
  _zapReceiptSockets.length = 0;

  const since = Math.floor(Date.now() / 1000) - 30;

  const handleReceipt = (ev: any) => {
    if (_seenReceiptIds.has(ev.id)) return;
    _seenReceiptIds.add(ev.id);

    let amountMsats = 0;
    const amountTag = ev.tags?.find((t: string[]) => t[0] === 'amount');
    if (amountTag?.[1]) amountMsats = parseInt(amountTag[1], 10) || 0;

    let senderPubkey = ev.pubkey || '';
    let comment      = '';
    let zapReqId: string | null = null;

    const descTag   = ev.tags?.find((t: string[]) => t[0] === 'description');
    const bolt11Tag = ev.tags?.find((t: string[]) => t[0] === 'bolt11');
    const bolt11    = bolt11Tag?.[1] || undefined;

    if (descTag?.[1]) {
      try {
        const zapReq = JSON.parse(descTag[1]);
        zapReqId = zapReq.id || null;
        if (zapReq.pubkey) senderPubkey = zapReq.pubkey;
        if (zapReq.content) comment = zapReq.content;
        if (!amountMsats) {
          const amt = zapReq.tags?.find((t: string[]) => t[0] === 'amount');
          if (amt?.[1]) amountMsats = parseInt(amt[1], 10) || 0;
        }
      } catch { /* */ }
    }

    if (amountMsats <= 0) return;

    // Cache for the wallet history lookup. We do this BEFORE the dedupe check
    // so the comment + bolt11 land in the cache even when a sibling 9734
    // already fired the toast.
    cacheIncomingZap({
      comment,
      senderPubkey,
      amountSats: Math.floor(amountMsats / 1000),
      ts:         Number(ev.created_at) || Math.floor(Date.now() / 1000),
      bolt11,
      zapReqId:   zapReqId || undefined,
    });

    // If a raw 9734 with the same id already fired (and carried the real
    // sender comment), skip the receipt's toast.
    if (zapReqId && _seenZapRequestIds.has(zapReqId)) return;

    if (!zapReqId) {
      onZap(senderPubkey, Math.floor(amountMsats / 1000), comment);
      return;
    }

    // Defer the receipt-driven toast briefly. If the raw 9734 (which always
    // carries the sender's comment) lands during this window, handleZapRequest
    // will cancel the timer and fire its own toast instead.
    const captured = { senderPubkey, amountMsats, comment };
    const timer = setTimeout(() => {
      _pendingReceiptToasts.delete(zapReqId!);
      if (_seenZapRequestIds.has(zapReqId!)) return; // 9734 fired in the meantime
      _seenZapRequestIds.add(zapReqId!);
      onZap(captured.senderPubkey, Math.floor(captured.amountMsats / 1000), captured.comment);
    }, RECEIPT_DEFER_MS);
    _pendingReceiptToasts.set(zapReqId, timer);
  };

  const handleZapRequest = (ev: any) => {
    // Raw kind:9734 — Nostr District republishes these so the receiver sees
    // the message even when the LNURL provider strips it from the 9735.
    if (_seenZapRequestIds.has(ev.id)) return;
    _seenZapRequestIds.add(ev.id);

    // Cancel any deferred 9735 toast for this same zap request — we always
    // prefer the raw 9734 because it reliably carries the sender's comment.
    const pending = _pendingReceiptToasts.get(ev.id);
    if (pending) { clearTimeout(pending); _pendingReceiptToasts.delete(ev.id); }

    let amountMsats = 0;
    const amountTag = ev.tags?.find((t: string[]) => t[0] === 'amount');
    if (amountTag?.[1]) amountMsats = parseInt(amountTag[1], 10) || 0;

    const senderPubkey = ev.pubkey || '';
    const comment      = typeof ev.content === 'string' ? ev.content : '';

    // Cache for the wallet history lookup (no bolt11 on raw 9734 — the
    // amount+timestamp fallback covers this case).
    if (amountMsats > 0) {
      cacheIncomingZap({
        comment,
        senderPubkey,
        amountSats: Math.floor(amountMsats / 1000),
        ts:         Number(ev.created_at) || Math.floor(Date.now() / 1000),
        zapReqId:   ev.id,
      });
    }

    if (amountMsats > 0) onZap(senderPubkey, Math.floor(amountMsats / 1000), comment);
  };

  // Subscribe on all relays so we catch wherever the receipt lands
  RELAYS.forEach(relayUrl => {
    try {
      const ws = new WebSocket(relayUrl);
      _zapReceiptSockets.push(ws);
      const subR = 'zap_recv_' + Math.random().toString(36).slice(2, 8);
      const subQ = 'zap_req_'  + Math.random().toString(36).slice(2, 8);
      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', subR, { kinds: [9735], '#p': [pubkey], since }]));
        ws.send(JSON.stringify(['REQ', subQ, { kinds: [9734], '#p': [pubkey], since }]));
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg[0] !== 'EVENT') return;
          const ev = msg[2];
          if (ev?.kind === 9735) handleReceipt(ev);
          else if (ev?.kind === 9734) handleZapRequest(ev);
        } catch { /* */ }
      };
    } catch { /* */ }
  });

  return () => {
    _zapReceiptSockets.forEach(s => { try { s.close(); } catch { /* */ } });
    _zapReceiptSockets.length = 0;
  };
}

// ── Global zap-toast subscription ────────────────────────────────────────────
// The zap-receipt subscription used to be wired up inside HubScene, which
// meant players inside a Room (RoomScene) never saw incoming-zap toasts. Lift
// it to module scope so it runs for the whole logged-in session regardless of
// which scene is active.

let _globalZapUnsub: (() => void) | null = null;
let _globalZapPubkey: string | null     = null;

// Scenes that already know players' display names (from the presence server)
// register them here so a zap toast can show "Alice" instead of "5069ea44…".
// Cleared on logout.
const _senderNameHints = new Map<string, string>();

export function registerSenderNameHint(pubkey: string, name: string): void {
  if (!pubkey || !name) return;
  _senderNameHints.set(pubkey, name);
}

async function resolveSenderName(pubkey: string): Promise<string> {
  const hint = _senderNameHints.get(pubkey);
  if (hint) return hint;
  try {
    const profile = await fetchKind0(pubkey);
    const name = profile?.display_name || profile?.name;
    if (typeof name === 'string' && name.trim()) {
      const trimmed = name.trim().slice(0, 30);
      _senderNameHints.set(pubkey, trimmed); // cache for subsequent zaps
      return trimmed;
    }
  } catch { /* fall through */ }
  return pubkey.slice(0, 8) + '…';
}

/**
 * Start the global incoming-zap toast subscription for the currently
 * logged-in user. Idempotent — safe to call from any scene's create() and
 * any number of times. The subscription persists across scene changes;
 * it's only torn down on logout via `stopGlobalZapToasts`.
 */
export function startGlobalZapToasts(): void {
  const auth = authStore.getState();
  const pubkey = auth.pubkey;
  if (!pubkey || auth.isGuest) return;
  if (_globalZapUnsub && _globalZapPubkey === pubkey) return; // already running for this pubkey

  // Different pubkey (or restart) — tear down the previous one first.
  if (_globalZapUnsub) { _globalZapUnsub(); _globalZapUnsub = null; }
  _globalZapPubkey = pubkey;

  _globalZapUnsub = subscribeToZapReceipts(pubkey, async (senderPubkey, amountSats, comment) => {
    const name = await resolveSenderName(senderPubkey);
    // Late import to avoid a circular dependency through the UI layer.
    const { showZapToast } = await import('../ui/ZapToast');
    showZapToast(name, amountSats, comment || undefined, 'incoming');
  });
}

export function stopGlobalZapToasts(): void {
  if (_globalZapUnsub) { _globalZapUnsub(); _globalZapUnsub = null; }
  _globalZapPubkey = null;
  _senderNameHints.clear();
}
