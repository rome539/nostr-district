/**
 * zapService.ts — NIP-57 Zap support
 *
 * Fetches LNURL/lud16 from target's kind:0,
 * builds a kind:9734 zap request, requests a Lightning invoice,
 * and pays via WebLN → NWC → QR fallback.
 */

import { authStore } from '../stores/authStore';
import { signEvent } from './nostrService';
import { nwcPayInvoice, weblnPayInvoice, hasNWC, hasWebLN } from './nwcService';

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
): Promise<string | null> {
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

  try {
    const signed = await signEvent(zapRequest);
    return JSON.stringify(signed);
  } catch { return null; }
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
        content: 'market-purchase',
        tags: [
          ['p', storeNostrPubkey],
          ['amount', String(amountMsats)],
          ['lnurl', lnurlData.callback],
          ['relays', ...RELAYS],
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

  onStatus?.('Fetching profile…');
  const profile = await fetchKind0(recipientPubkey);
  if (!profile) return { status: 'error', error: 'Could not fetch profile' };

  const lud16: string | undefined = profile.lud16;
  const lud06: string | undefined = profile.lud06;

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
  let zapRequestJson: string | null = null;
  if (supportsZap) {
    zapRequestJson = await buildZapRequest(recipientPubkey, amountMsats, comment, lnurlData.callback);
  }

  onStatus?.('Requesting invoice…');
  const inv = await fetchInvoice(
    lnurlData.callback,
    amountMsats,
    zapRequestJson || '{}',
  );
  if (!inv) return { status: 'error', error: 'Failed to get invoice' };

  // Try WebLN first
  if (hasWebLN()) {
    onStatus?.('Paying via WebLN…');
    const result = await weblnPayInvoice(inv.pr);
    if (result.preimage) return { status: 'paid' };
    if (result.error && result.error !== 'No WebLN') {
      // User cancelled — fall through to QR
    }
  }

  // Try NWC
  if (hasNWC()) {
    onStatus?.('Paying via wallet…');
    const result = await nwcPayInvoice(inv.pr);
    if (result.preimage) return { status: 'paid' };
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

const _seenZapIds = new Set<string>();

const _zapReceiptSockets: WebSocket[] = [];

export function subscribeToZapReceipts(
  pubkey: string,
  onZap: (senderPubkey: string, amountSats: number, comment: string) => void,
): () => void {
  // Close any existing subscriptions
  _zapReceiptSockets.forEach(s => { try { s.close(); } catch { /* */ } });
  _zapReceiptSockets.length = 0;

  const since = Math.floor(Date.now() / 1000) - 30;

  const handleEvent = (ev: any) => {
    if (_seenZapIds.has(ev.id)) return;
    _seenZapIds.add(ev.id);

    let amountMsats = 0;
    const amountTag = ev.tags?.find((t: string[]) => t[0] === 'amount');
    if (amountTag?.[1]) amountMsats = parseInt(amountTag[1], 10) || 0;

    let senderPubkey = ev.pubkey || '';
    let comment = '';
    const descTag = ev.tags?.find((t: string[]) => t[0] === 'description');
    if (descTag?.[1]) {
      try {
        const zapReq = JSON.parse(descTag[1]);
        if (zapReq.pubkey) senderPubkey = zapReq.pubkey;
        if (zapReq.content) comment = zapReq.content;
        if (!amountMsats) {
          const amt = zapReq.tags?.find((t: string[]) => t[0] === 'amount');
          if (amt?.[1]) amountMsats = parseInt(amt[1], 10) || 0;
        }
      } catch { /* */ }
    }

    if (amountMsats > 0) onZap(senderPubkey, Math.floor(amountMsats / 1000), comment);
  };

  // Subscribe on all relays so we catch wherever the receipt lands
  RELAYS.forEach(relayUrl => {
    try {
      const ws = new WebSocket(relayUrl);
      _zapReceiptSockets.push(ws);
      const sub = 'zap_recv_' + Math.random().toString(36).slice(2, 8);
      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', sub, { kinds: [9735], '#p': [pubkey], since }]));
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg[0] === 'EVENT' && msg[2]?.kind === 9735) handleEvent(msg[2]);
        } catch { /* */ }
      };
    } catch { /* */ }
  });

  return () => {
    _zapReceiptSockets.forEach(s => { try { s.close(); } catch { /* */ } });
    _zapReceiptSockets.length = 0;
  };
}
