/**
 * roomQuoteService.ts
 * One quote per visitor per room, stored as kind:30078 (parameterized replaceable).
 * d-tag: nd-room-quote-{roomOwnerPubkey} — same for all visitors to one room,
 * so (visitor pubkey + kind + d-tag) gives exactly one record per person.
 */
import { signEvent, publishEvent, fetchProfile } from './nostrService';
import { authStore } from '../stores/authStore';
import { DEFAULT_RELAYS } from './relayManager';

const QUOTE_D_PREFIX = 'nd-room-quote-';
const RELAYS = DEFAULT_RELAYS.slice(0, 6);

let pool: any = null;

async function ensurePool(): Promise<void> {
  if (pool) return;
  const { SimplePool } = await import('nostr-tools/pool');
  pool = new SimplePool();
}

export interface RoomQuote {
  pubkey:    string;
  text:      string;
  createdAt: number;
  eventId:   string;
  name?:     string; // resolved async
}

const PAGE_SIZE = 50;

export async function fetchRoomQuotes(roomOwnerPubkey: string, limit = PAGE_SIZE): Promise<RoomQuote[]> {
  await ensurePool();
  try {
    const events: any[] = await pool.querySync(RELAYS, {
      kinds: [30078],
      '#d': [QUOTE_D_PREFIX + roomOwnerPubkey],
      limit,
    });
    // Deduplicate by pubkey — keep only the most recent event per author
    // (relays may return older replaceable versions alongside the latest)
    const byAuthor = new Map<string, any>();
    for (const ev of events) {
      const existing = byAuthor.get(ev.pubkey);
      if (!existing || ev.created_at > existing.created_at) byAuthor.set(ev.pubkey, ev);
    }
    return [...byAuthor.values()]
      .map((ev: any): RoomQuote | null => {
        if (!ev.content) return null;
        if (ev.tags?.some((t: string[]) => t[0] === 'deleted' && t[1] === 'true')) return null;
        let text = ev.content;
        try { const d = JSON.parse(ev.content); if (d?.text) text = d.text; } catch (_) {}
        if (!text.trim()) return null;
        return { pubkey: ev.pubkey, text, createdAt: ev.created_at, eventId: ev.id };
      })
      .filter((q): q is RoomQuote => q !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) {
    console.warn('[RoomQuotes] fetch failed:', e);
    return [];
  }
}

// Resolve names in batches to avoid hammering relays with 100+ parallel fetches
export async function resolveQuoteNames(quotes: RoomQuote[]): Promise<RoomQuote[]> {
  const BATCH = 8;
  const result = [...quotes];
  for (let i = 0; i < result.length; i += BATCH) {
    const slice = result.slice(i, i + BATCH);
    const resolved = await Promise.all(
      slice.map(async q => {
        try {
          const p = await fetchProfile(q.pubkey);
          const name = p?.display_name || p?.name;
          return name ? { ...q, name } : q;
        } catch { return q; }
      })
    );
    for (let j = 0; j < resolved.length; j++) result[i + j] = resolved[j];
  }
  return result;
}

export async function deleteRoomQuote(roomOwnerPubkey: string, eventId: string): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;
  try {
    // NIP-09 deletion + clear the replaceable slot with empty content
    const dTag = QUOTE_D_PREFIX + roomOwnerPubkey;
    const [delEvent, clearEvent] = await Promise.all([
      signEvent({
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', eventId],
          ['a', `30078:${pubkey}:${dTag}`],
          ['client', 'Nostr District'],
        ],
        content: 'deleted',
      }),
      signEvent({
        kind: 30078,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', dTag],
          ['p', roomOwnerPubkey],
          ['client', 'Nostr District'],
          ['deleted', 'true'],
        ],
        content: '',
      }),
    ]);
    await Promise.all([publishEvent(delEvent), publishEvent(clearEvent)]);
    return true;
  } catch (e) {
    console.warn('[RoomQuotes] delete failed:', e);
    return false;
  }
}

export async function publishRoomQuote(roomOwnerPubkey: string, text: string): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;
  try {
    const event = await signEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', QUOTE_D_PREFIX + roomOwnerPubkey],
        ['p', roomOwnerPubkey],
        ['client', 'Nostr District'],
      ],
      content: JSON.stringify({ text: text.trim() }),
    });
    return publishEvent(event);
  } catch (e) {
    console.warn('[RoomQuotes] publish failed:', e);
    return false;
  }
}
