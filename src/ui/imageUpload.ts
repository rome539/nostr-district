/**
 * imageUpload.ts — private image sending for DMs (NIP-17 kind:15 + Blossom).
 *
 * 100%-private pipeline: the image is encrypted CLIENT-SIDE with a one-off
 * AES-256-GCM key, only the ciphertext is uploaded to Blossom, and the key +
 * nonce travel as tags INSIDE the NIP-17 gift-wrapped rumor (so they're NIP-44
 * encrypted to the recipient). The media host stores opaque bytes; a leaked
 * URL is useless without the DM.
 *
 * Wire format matches Wisp/Amethyst's kind:15 encrypted file messages
 * (https://github.com/barrydeen/wisp, MIT) so images interop with those
 * clients: content = file URL; tags = file-type / encryption-algorithm /
 * decryption-key / decryption-nonce / x (ciphertext sha256) / ox (original
 * sha256) / size / dim.
 *
 * Uploads use Blossom BUD-02: PUT /upload with a signed kind:24242 auth event
 * scoped to the blob's sha256 — one signature works across all servers.
 */
import { signEvent } from '../nostr/nostrService';

const BLOSSOM_SERVERS = [
  'https://blossom.primal.net',
  'https://blossom.ditto.pub',
  'https://blossom.dreamith.to',
];

/** Matches a plain http(s) URL ending in a known image extension. */
export const IMAGE_URL_RE = /^https?:\/\/\S+\.(jpg|jpeg|png|gif|webp|avif|svg)(\?\S*)?$/i;

export interface EncryptedImageResult {
  /** Public URL of the CIPHERTEXT on Blossom. */
  url: string;
  /** kind:15 rumor tags carrying the decryption secrets + metadata. */
  tags: string[][];
}

const toHex = (buf: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(buf as ArrayBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{2}/g)?.map(h => parseInt(h, 16)) ?? []);

const sha256Hex = async (buf: ArrayBuffer | Uint8Array): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', buf as ArrayBuffer));

/** Read image dimensions from a blob ("WxH"), or null if it won't parse. */
function imageDimensions(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(`${img.naturalWidth}x${img.naturalHeight}`); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/**
 * Upload raw bytes to Blossom via BUD-02 (signed kind:24242 auth scoped to the
 * blob's sha256 — one signature works on every server). First server wins.
 * `contentType` is what the server serves the blob as: the real mime for plain
 * images, application/octet-stream for ciphertext.
 */
async function blossomPut(bytes: ArrayBuffer, contentType: string): Promise<{ url: string; sha256: string }> {
  const hash = await sha256Hex(bytes);
  const auth = await signEvent({
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    content: 'Upload image',
    tags: [
      ['t', 'upload'],
      ['x', hash],
      ['expiration', String(Math.floor(Date.now() / 1000) + 600)],
    ],
  });
  const authHeader = 'Nostr ' + btoa(JSON.stringify(auth));

  let lastErr = 'no servers reachable';
  for (const server of BLOSSOM_SERVERS) {
    try {
      const res = await fetch(`${server}/upload`, {
        method: 'PUT',
        headers: { Authorization: authHeader, 'Content-Type': contentType },
        body: bytes,
      });
      if (!res.ok) { lastErr = `${server} → HTTP ${res.status}`; continue; }
      const desc = await res.json();
      const url = desc?.url || (desc?.sha256 ? `${server}/${desc.sha256}` : '');
      if (url) return { url, sha256: hash };
      lastErr = `${server} → no url in descriptor`;
    } catch (e) { lastErr = `${server} → ${(e as Error).message}`; }
  }
  throw new Error(`Blossom upload failed (${lastErr})`);
}

/**
 * Upload a PLAINTEXT image to Blossom — for PUBLIC posts (crew announcements,
 * etc.) where the image is meant to be viewable. Returns the hosted URL.
 * (DMs use encryptAndUploadImage instead; never send private images this way.)
 */
export async function uploadPlainImage(blob: Blob): Promise<string> {
  return (await blossomPut(await blob.arrayBuffer(), blob.type || 'image/png')).url;
}

/**
 * Encrypt an image blob and upload the ciphertext to Blossom. Returns the URL +
 * the kind:15 tags for the DM rumor. The host only ever sees ciphertext.
 */
export async function encryptAndUploadImage(blob: Blob): Promise<EncryptedImageResult> {
  const plain = await blob.arrayBuffer();

  // One-off key + nonce (AES-256-GCM, 96-bit nonce, 128-bit tag — WebCrypto's
  // GCM default tag length is 128, matching the Wisp/Amethyst scheme).
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce    = crypto.getRandomValues(new Uint8Array(12));
  const key      = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const cipher   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain);

  const oxHash = await sha256Hex(plain);
  const { url, sha256: xHash } = await blossomPut(cipher, 'application/octet-stream');

  const dim = await imageDimensions(blob);
  const tags: string[][] = [
    ['file-type', blob.type || 'image/png'],
    ['encryption-algorithm', 'aes-gcm'],
    ['decryption-key', toHex(keyBytes)],
    ['decryption-nonce', toHex(nonce)],
    ['x', xHash],
    ['ox', oxHash],
    ['size', String(plain.byteLength)],
  ];
  if (dim) tags.push(['dim', dim]);

  return { url, tags };
}

/** Fetch + decrypt an encrypted image; resolves with an object URL to render. */
export async function decryptImageToObjectUrl(
  url: string, keyHex: string, nonceHex: string, mime: string,
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const cipher = await res.arrayBuffer();
  const key    = await crypto.subtle.importKey('raw', fromHex(keyHex).buffer as ArrayBuffer, 'AES-GCM', false, ['decrypt']);
  const plain  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(nonceHex).buffer as ArrayBuffer }, key, cipher);
  return URL.createObjectURL(new Blob([plain], { type: mime || 'image/png' }));
}

interface PasteHandlers {
  /** Called with the encrypted-upload result, ready to send as a kind:15 DM. */
  onEncrypted: (result: EncryptedImageResult) => void;
  /** Called when the paste is a plain public image URL (sent as normal text). */
  onPublicUrl: (url: string) => void;
  /** Optional status line ('Encrypting…', 'Uploading…', '', or an error). */
  onStatus?: (msg: string) => void;
}

/**
 * Attach clipboard-image handling to an input. Handles, in order: binary image
 * files (screenshots), HTML-clipboard images (copied from a webpage — those are
 * already-public URLs, passed through as text), plain-text image URLs, and the
 * async Clipboard API fallback (iPhone/iPad). Non-image pastes fall through.
 */
export function attachImagePaste(el: HTMLElement, { onEncrypted, onPublicUrl, onStatus }: PasteHandlers): void {
  const status = (m: string) => onStatus?.(m);
  const upload = async (blob: Blob) => {
    status('Encrypting & uploading…');
    try { onEncrypted(await encryptAndUploadImage(blob)); status(''); }
    catch { status('Upload failed — try again or paste a URL.'); setTimeout(() => status(''), 3500); }
  };

  el.addEventListener('paste', async (e) => {
    const ev = e as ClipboardEvent;
    const items = Array.from(ev.clipboardData?.items ?? []);

    // 1. Binary image file (screenshot, direct paste) → encrypted pipeline
    const fileItem = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (fileItem) {
      ev.preventDefault();
      const file = fileItem.getAsFile();
      if (file) await upload(file);
      return;
    }

    // 2. HTML clipboard (image copied from a webpage — its URL is already public)
    const html = ev.clipboardData?.getData('text/html') ?? '';
    if (html) {
      const src = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
      if (src && src.startsWith('http') && !src.startsWith('data:')) { ev.preventDefault(); onPublicUrl(src); return; }
    }

    // 3. Plain text that is itself an image URL (already public)
    const text = ev.clipboardData?.getData('text/plain').trim() ?? '';
    if (IMAGE_URL_RE.test(text)) { ev.preventDefault(); onPublicUrl(text); return; }

    // 4. Async Clipboard API fallback (iPhone/iPad Universal Clipboard)
    if (!fileItem) {
      try {
        for (const clipItem of await navigator.clipboard.read()) {
          const imageType = clipItem.types.find(t => t.startsWith('image/'));
          if (imageType) { ev.preventDefault(); await upload(await clipItem.getType(imageType)); return; }
        }
      } catch { /* permission denied — let default paste run */ }
    }
  });
}

/** Open a file picker, encrypt + upload the chosen image. */
export function pickAndUploadImage({ onEncrypted, onStatus }: Pick<PasteHandlers, 'onEncrypted' | 'onStatus'>): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    onStatus?.('Encrypting & uploading…');
    try { onEncrypted(await encryptAndUploadImage(file)); onStatus?.(''); }
    catch { onStatus?.('Upload failed — try again.'); setTimeout(() => onStatus?.(''), 3500); }
  });
  document.body.appendChild(input);
  input.click();
}
