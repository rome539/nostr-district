/**
 * emojiService.ts — NIP-30 custom emoji support (kind:30030)
 *
 * Fetches the logged-in user's custom emoji packs and provides
 * a helper to render :shortcode: tokens as inline <img> tags.
 */

const emojiMap = new Map<string, string>(); // shortcode (lowercase) → image URL

const EMOJI_RELAYS = [
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://purplepag.es',
];

export async function initEmojiService(pubkey: string): Promise<void> {
  try {
    const { SimplePool } = await import('nostr-tools/pool');
    const pool = new SimplePool();
    const events: any[] = await (pool as any).querySync(
      EMOJI_RELAYS,
      { kinds: [30030], authors: [pubkey] },
      { maxWait: 6000 },
    );
    pool.close(EMOJI_RELAYS);
    emojiMap.clear();
    for (const e of events) {
      for (const tag of e.tags as string[][]) {
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          emojiMap.set(tag[1].toLowerCase(), tag[2]);
        }
      }
    }
    console.log(`[Emoji] Loaded ${emojiMap.size} custom emoji(s) from ${events.length} pack(s)`);
  } catch (err) {
    console.warn('[Emoji] init failed:', err);
  }
}

/**
 * Replace :shortcode: tokens in already-HTML-escaped text with inline images.
 * Call this AFTER escaping HTML so the <img> tags are not escaped.
 */
export function renderEmojis(html: string): string {
  if (emojiMap.size === 0) return html;
  return html.replace(/:([a-zA-Z0-9_]+):/g, (match, code) => {
    const url = emojiMap.get(code.toLowerCase());
    if (!url) return match;
    const safeUrl = url.replace(/"/g, '%22');
    return `<img src="${safeUrl}" alt=":${code}:" title=":${code}:" style="height:1.2em;width:auto;vertical-align:middle;display:inline-block;margin:0 1px;" loading="lazy" onerror="this.replaceWith(document.createTextNode(':${code}:'))">`;
  });
}
