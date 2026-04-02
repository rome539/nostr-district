/**
 * emojiService.ts — NIP-30 custom emoji support
 *
 * kind:10030 — user's emoji list (which packs they've selected)
 * kind:30030 — emoji pack definition (contains the actual shortcode → URL tags)
 *
 * Flow: fetch kind:10030 → read `a` tag references → fetch those kind:30030 packs
 * Also loads any inline `emoji` tags directly on the 10030 event.
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

    // Step 1: fetch the user's emoji list (kind:10030)
    const listEvents: any[] = await (pool as any).querySync(
      EMOJI_RELAYS,
      { kinds: [10030], authors: [pubkey] },
      { maxWait: 5000 },
    );

    emojiMap.clear();

    if (listEvents.length === 0) {
      pool.close(EMOJI_RELAYS);
      console.log('[Emoji] No kind:10030 emoji list found');
      return;
    }

    // Use the most recent 10030 event
    const listEvent = listEvents.sort((a, b) => b.created_at - a.created_at)[0];

    // Load any inline emoji tags directly on the list event
    for (const tag of listEvent.tags as string[][]) {
      if (tag[0] === 'emoji' && tag[1] && tag[2]) {
        emojiMap.set(tag[1].toLowerCase(), tag[2]);
      }
    }

    // Step 2: collect referenced kind:30030 pack identifiers from `a` tags
    const aTags = (listEvent.tags as string[][]).filter(t => t[0] === 'a' && t[1]?.startsWith('30030:'));
    if (aTags.length === 0) {
      pool.close(EMOJI_RELAYS);
      console.log(`[Emoji] Loaded ${emojiMap.size} inline emoji(s), no pack references`);
      return;
    }

    // Parse `30030:<pubkey>:<d-tag>` references
    const packFilters = aTags.map(t => {
      const parts = t[1].split(':');
      return { kinds: [30030], authors: [parts[1]], '#d': [parts[2]] };
    });

    // Step 3: fetch all referenced packs
    const packEvents: any[] = await (pool as any).querySync(
      EMOJI_RELAYS,
      packFilters,
      { maxWait: 6000 },
    );
    pool.close(EMOJI_RELAYS);

    for (const pack of packEvents) {
      for (const tag of pack.tags as string[][]) {
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          emojiMap.set(tag[1].toLowerCase(), tag[2]);
        }
      }
    }

    console.log(`[Emoji] Loaded ${emojiMap.size} custom emoji(s) from ${packEvents.length} pack(s)`);
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
