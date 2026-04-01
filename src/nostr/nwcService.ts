/**
 * nwcService.ts — NIP-47 Nostr Wallet Connect
 *
 * Sends pay_invoice requests to a connected wallet over Nostr relays.
 * Encryption: NIP-44 v2 primary, NIP-04 fallback (negotiated via kind:13194 info event).
 */

const STORAGE_KEY = 'nd_nwc_uri';

interface NWCParsed {
  walletPubkey: string;
  relays:       string[];
  secret:       string; // hex privkey for this connection
}

export interface NWCPayResult {
  preimage?: string;
  error?:    string;
}

// ── Parse nostr+walletconnect:// (or legacy nostrwalletconnect://) URI ─────────

function parseNWCUri(uri: string): NWCParsed | null {
  try {
    // Support both nostr+walletconnect:// and nostrwalletconnect://
    const normalized = uri
      .replace('nostr+walletconnect://', 'https://')
      .replace('nostrwalletconnect://', 'https://');
    const u = new URL(normalized);
    const walletPubkey = u.hostname;
    const secret = u.searchParams.get('secret');
    // Multiple relays may be provided
    const relays = u.searchParams.getAll('relay').filter(Boolean);
    if (!walletPubkey || !secret || relays.length === 0) return null;
    return { walletPubkey, relays, secret };
  } catch { return null; }
}

// ── NIP-04 helpers ────────────────────────────────────────────────────────────

async function nip04Encrypt(privkeyHex: string, pubkeyHex: string, plaintext: string): Promise<string> {
  const { nip04 } = await import('nostr-tools');
  return nip04.encrypt(privkeyHex, pubkeyHex, plaintext);
}

async function nip04Decrypt(privkeyHex: string, pubkeyHex: string, ciphertext: string): Promise<string> {
  const { nip04 } = await import('nostr-tools');
  return nip04.decrypt(privkeyHex, pubkeyHex, ciphertext);
}

// ── NIP-44 helpers ────────────────────────────────────────────────────────────

async function nip44Encrypt(privkeyHex: string, pubkeyHex: string, plaintext: string): Promise<string> {
  const { nip44 } = await import('nostr-tools');
  // getConversationKey: privkey as Uint8Array, pubkey as hex string
  const key = nip44.v2.utils.getConversationKey(hexToBytes(privkeyHex), pubkeyHex);
  return nip44.v2.encrypt(plaintext, key);
}

async function nip44Decrypt(privkeyHex: string, pubkeyHex: string, ciphertext: string): Promise<string> {
  const { nip44 } = await import('nostr-tools');
  const key = nip44.v2.utils.getConversationKey(hexToBytes(privkeyHex), pubkeyHex);
  return nip44.v2.decrypt(ciphertext, key);
}

// ── Key helpers ───────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

async function privkeyToPubkey(privkeyHex: string): Promise<string> {
  const { getPublicKey } = await import('nostr-tools');
  return getPublicKey(hexToBytes(privkeyHex));
}

// ── Storage ───────────────────────────────────────────────────────────────────

export function getNWCUri(): string {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function setNWCUri(uri: string): boolean {
  if (!uri) { localStorage.removeItem(STORAGE_KEY); return true; }
  const parsed = parseNWCUri(uri);
  if (!parsed) return false;
  localStorage.setItem(STORAGE_KEY, uri);
  return true;
}

export function hasNWC(): boolean {
  const uri = getNWCUri();
  return !!uri && !!parseNWCUri(uri);
}

export function hasWebLN(): boolean {
  return typeof (window as any).webln !== 'undefined';
}

// ── Fetch info event (kind:13194) to determine supported encryption ────────────

type EncryptionScheme = 'nip44' | 'nip04';

async function fetchEncryptionScheme(
  walletPubkey: string,
  relayUrl: string,
  timeoutMs = 5000,
): Promise<EncryptionScheme> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (scheme: EncryptionScheme) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* */ }
      resolve(scheme);
    };
    const timer = setTimeout(() => finish('nip04'), timeoutMs);

    let ws: WebSocket;
    try { ws = new WebSocket(relayUrl); } catch { finish('nip04'); return; }

    const subId = 'nwc_info_' + Math.random().toString(36).slice(2, 8);
    ws.onopen = () => {
      ws.send(JSON.stringify(['REQ', subId, {
        kinds: [13194],
        authors: [walletPubkey],
        limit: 1,
      }]));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg[0] === 'EOSE') { finish('nip04'); return; }
        if (msg[0] !== 'EVENT' || msg[2]?.kind !== 13194) return;
        const content: string = msg[2].content || '';
        // content is space-separated list of supported methods/capabilities
        // encryption tags appear like: nip44 or encryption=nip44_v2
        const supportsNip44 = content.includes('nip44');
        finish(supportsNip44 ? 'nip44' : 'nip04');
      } catch { /* */ }
    };
    ws.onerror = () => finish('nip04');
    ws.onclose = () => finish('nip04');
  });
}

// ── Pay invoice via NWC ───────────────────────────────────────────────────────

export async function nwcPayInvoice(invoice: string): Promise<NWCPayResult> {
  const uri = getNWCUri();
  const parsed = parseNWCUri(uri);
  if (!parsed) return { error: 'No wallet connected' };

  const { walletPubkey, relays, secret } = parsed;
  const relayUrl = relays[0]; // primary relay

  try {
    const clientPubkey = await privkeyToPubkey(secret);
    const secretBytes  = hexToBytes(secret);

    // Negotiate encryption scheme via info event
    const scheme = await fetchEncryptionScheme(walletPubkey, relayUrl);

    const requestPayload = JSON.stringify({
      method: 'pay_invoice',
      params: { invoice },
    });

    let encrypted: string;
    const encryptionTag: string[] = [];

    if (scheme === 'nip44') {
      encrypted = await nip44Encrypt(secret, walletPubkey, requestPayload);
      encryptionTag.push('encryption', 'nip44_v2');
    } else {
      encrypted = await nip04Encrypt(secret, walletPubkey, requestPayload);
    }

    const reqEvent: any = {
      kind: 23194,
      pubkey: clientPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', walletPubkey],
        ...(encryptionTag.length ? [encryptionTag] : []),
      ],
      content: encrypted,
    };

    const { finalizeEvent } = await import('nostr-tools');
    const signed = finalizeEvent(reqEvent, secretBytes);

    return await new Promise<NWCPayResult>((resolve) => {
      const ws = new WebSocket(relayUrl);
      let done = false;
      const finish = (result: NWCPayResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws.close(); } catch { /* */ }
        resolve(result);
      };
      const timer = setTimeout(() => finish({ error: 'Wallet timeout' }), 30000);

      ws.onopen = () => {
        ws.send(JSON.stringify(['EVENT', signed]));
        const subId = 'nwc_' + Math.random().toString(36).slice(2, 8);
        ws.send(JSON.stringify(['REQ', subId, {
          kinds: [23195],
          authors: [walletPubkey],
          '#p': [clientPubkey],
          since: Math.floor(Date.now() / 1000) - 5,
        }]));
      };

      ws.onmessage = async (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg[0] !== 'EVENT' || msg[2]?.kind !== 23195) return;
          const ev = msg[2];

          // Detect encryption scheme from response tags
          const encTag = ev.tags?.find((t: string[]) => t[0] === 'encryption');
          const useNip44 = encTag?.[1]?.startsWith('nip44') || scheme === 'nip44';

          let decrypted: string;
          try {
            decrypted = useNip44
              ? await nip44Decrypt(secret, walletPubkey, ev.content)
              : await nip04Decrypt(secret, walletPubkey, ev.content);
          } catch {
            // Try the other scheme as fallback
            decrypted = useNip44
              ? await nip04Decrypt(secret, walletPubkey, ev.content)
              : await nip44Decrypt(secret, walletPubkey, ev.content);
          }

          const response = JSON.parse(decrypted);
          if (response.error) {
            finish({ error: response.error.message || 'Payment failed' });
          } else {
            finish({ preimage: response.result?.preimage });
          }
        } catch { /* ignore parse errors, wait for next message */ }
      };

      ws.onerror = () => finish({ error: 'Relay connection failed' });
    });
  } catch (err: any) {
    return { error: err?.message || 'Unknown error' };
  }
}

// ── Pay invoice via WebLN ─────────────────────────────────────────────────────

export async function weblnPayInvoice(invoice: string): Promise<NWCPayResult> {
  try {
    const webln = (window as any).webln;
    if (!webln) return { error: 'No WebLN' };
    await webln.enable();
    const result = await webln.sendPayment(invoice);
    return { preimage: result.preimage };
  } catch (err: any) {
    return { error: err?.message || 'Payment cancelled' };
  }
}
