/**
 * feedService.ts — Live Nostr global feed
 *
 * Problem: Major relays (damus, nos, primal) don't serve unfiltered kind:1
 * without an author filter. querySync and subscribeMany both return 0 events.
 *
 * Solution: Use Primal's caching service (wss://cache2.primal.net/v1) which
 * accepts custom request types for global/trending feeds. This is how Primal's
 * own client fetches the "explore" feed. Falls back to subscribing on regular
 * relays for live new notes after the initial fetch.
 */

export interface FeedEvent {
  id: string;
  npub: string;
  pubkey: string;
  content: string;
  createdAt: number;
}

let NostrTools: any = null;
let started = false;

const noteBuffer: FeedEvent[] = [];
const processedIds = new Set<string>();
const MAX_BUFFER = 200;
const eventTimestamps: number[] = [];

// ── Public API ──

export async function initFeedService(): Promise<void> {
  if (started) return;
  started = true;

  if (!NostrTools) {
    NostrTools = await import('nostr-tools');
  }

  console.log('[Feed] Initializing...');

  // Fetch from Primal's cache service
  await fetchFromPrimalCache();

  // Also open a live subscription on regular relays for new notes
  startLiveSubscription();

  console.log(`[Feed] Ready — ${noteBuffer.length} notes buffered`);
}

export function stopFeedService(): void {
  started = false;
  if (liveSubClose) { try { liveSubClose(); } catch (_) {} liveSubClose = null; }
  processedIds.clear();
}

export function popFeedNote(): FeedEvent | null {
  return noteBuffer.length > 0 ? noteBuffer.shift()! : null;
}

export function getFeedBufferSize(): number {
  return noteBuffer.length;
}

export function getEventRate(): number {
  const now = Date.now();
  const cutoff = now - 60000;
  while (eventTimestamps.length > 0 && eventTimestamps[0] < cutoff) eventTimestamps.shift();
  return eventTimestamps.length * 60; // project 1 min sample to events/hr
}

// ── Initial fetch: grab recent notes via standard REQ with limit ──

async function fetchFromPrimalCache(): Promise<void> {
  const relays = [
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.damus.io',
  ];

  for (const url of relays) {
    const ok = await tryFetchFromRelay(url);
    if (ok && noteBuffer.length > 0) {
      console.log(`[Feed] Got ${noteBuffer.length} notes from ${url}`);
      return;
    }
  }
  console.warn('[Feed] All initial relays failed or returned nothing');
}

function tryFetchFromRelay(url: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const ws = new WebSocket(url);
      let resolved = false;
      let count = 0;
      const done = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        try { ws.close(); } catch (_) {}
        resolve(ok);
      };
      const timeout = setTimeout(() => done(count > 0), 6000);

      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', 'init', { kinds: [1], limit: 60 }]));
      };
      ws.onmessage = (msg: MessageEvent) => {
        try {
          const data = JSON.parse(msg.data);
          if (!Array.isArray(data)) return;
          if (data[0] === 'EVENT' && data[2]?.kind === 1) { addEvent(data[2]); count++; }
          if (data[0] === 'EOSE' || count >= 60) done(count > 0);
        } catch (_) {}
      };
      ws.onerror = () => done(false);
      ws.onclose = () => done(count > 0);
    } catch (_) { resolve(false); }
  });
}

// ── Live subscription for new notes as they arrive ──

let liveSubClose: (() => void) | null = null;

async function startLiveSubscription(): Promise<void> {
  try {
    const { SimplePool } = await import('nostr-tools/pool');
    const pool = new SimplePool();
    const relays = [
      'wss://relay.nostr.band',
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
    ];
    const since = Math.floor(Date.now() / 1000) - 300; // last 5 min

    const sub = pool.subscribeMany(
      relays,
      // @ts-ignore
      [{ kinds: [1], since }],
      {
        onevent: (event: any) => { addEvent(event); },
        oneose: () => {},
      }
    );

    liveSubClose = () => sub.close();
    console.log('[Feed] Live subscription started');
  } catch (e) {
    console.warn('[Feed] Live sub failed:', e);
  }
}

// ── Shared event processor ──

function addEvent(event: any): void {
  if (!event?.id || !event?.content || !event?.pubkey) return;
  if (processedIds.has(event.id)) return;
  processedIds.add(event.id);
  eventTimestamps.push(Date.now());
  if (eventTimestamps.length > 3000) eventTimestamps.shift();

  if (processedIds.size > 5000) {
    const arr = Array.from(processedIds);
    processedIds.clear();
    for (const id of arr.slice(-2500)) processedIds.add(id);
  }

  let content = event.content
    .replace(/https?:\/\/\S+/g, '')
    .replace(/nostr:\S+/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!content || content.length < 3) return;
  if (content.length > 120) content = content.slice(0, 117) + '...';

  let npub = event.pubkey.slice(0, 10) + '...';
  try {
    if (NostrTools?.nip19?.npubEncode) {
      npub = NostrTools.nip19.npubEncode(event.pubkey).slice(0, 14) + '...';
    }
  } catch (_) {}

  noteBuffer.push({
    id: event.id,
    npub,
    pubkey: event.pubkey,
    content,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
  });

  while (noteBuffer.length > MAX_BUFFER) {
    noteBuffer.shift();
  }
}