/**
 * liveStreamService.ts — NIP-53 live audio stream discovery for the Lounge.
 *
 * Queries relays for kind:30311 (NIP-53 Live Activity) events from a small
 * allowlist of approved streamer pubkeys. When one of them has an active
 * stream (`status: live`), the Lounge swaps from the default ambient track
 * to their HLS feed. Falls back to the default Lounge music when nobody on
 * the allowlist is live.
 *
 * Polling cadence: 30s while a Lounge subscriber is registered. Stops when
 * the last subscriber unregisters. The cached result is exposed
 * synchronously via {@link getCurrentLiveStream} so the audio + banner can
 * render immediately on Lounge entry without waiting for the next poll.
 */
import { DEFAULT_RELAYS } from './relayManager';

/**
 * Allowlisted streamers. Two forms:
 *   - bare hex pubkey: every 30311 from that pubkey counts (self-hosted
 *     artists who sign with their own key, e.g. Laan)
 *   - `{ pubkey, dTag }`: only the matching (pubkey, d-tag) counts. Use
 *     this for streams hosted on a shared signing platform like
 *     zap.stream, where one pubkey signs many artists' 30311s and we want
 *     just a specific channel rather than every guest broadcast.
 */
type AllowedStreamer = string | { pubkey: string; dTag: string };

const ALLOWED_STREAMERS: AllowedStreamer[] = [
  '1ec454734dcbf6fe54901ce25c0c7c6bca5edd89443416761fadc321d38df139', // Laan Tungir
  '5ca9371fa79503e2d162ef4a745ac61c557dcfbbc52780cce1871edb6e3bdbac', // additional streamer
  '05e60159f1e0a6cb64fa573fc1ebe35f985a975defe7d75603fdb9e8cfd38334', // additional streamer
  // Nogood — hosted on zap.stream's signing pubkey; filter to the specific
  // channel UUID so we don't pick up every other zap.stream broadcast.
  { pubkey: 'cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5',
    dTag:   '537a365c-f1ec-44ac-af10-22d14a7319fb' },
];

/** Unique list of pubkeys we'll query 30311 for. */
const ALLOWED_STREAMER_PUBKEYS = [...new Set(
  ALLOWED_STREAMERS.map(s => typeof s === 'string' ? s : s.pubkey)
)];

/**
 * Whether an incoming (pubkey, dTag) pair passes the allowlist. A bare
 * pubkey entry passes any d-tag; an entry with `dTag` only passes that
 * exact channel.
 */
function isAllowed(pubkey: string, dTag: string): boolean {
  for (const s of ALLOWED_STREAMERS) {
    if (typeof s === 'string') {
      if (s === pubkey) return true;
    } else {
      if (s.pubkey === pubkey && s.dTag === dTag) return true;
    }
  }
  return false;
}

const POLL_INTERVAL_MS = 30_000;
// Use the full DEFAULT_RELAYS list (not just the first 6) plus a handful of
// common live-stream relays. The slice was capping coverage and silently
// hiding streamers whose live event only landed on later relays.
const RELAYS = [
  ...DEFAULT_RELAYS,
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://nostr.land',
];
const EVENT_NAME = 'nd-live-stream-update';

export interface LiveStream {
  /** Hex pubkey of the streamer. */
  pubkey:     string;
  /** Channel identifier (`d` tag). One streamer may run multiple channels. */
  channel:    string;
  /** Stream title from the `title` tag. */
  title:      string;
  /** HLS .m3u8 URL from the `streaming` tag. */
  hlsUrl:     string;
  /** Optional thumbnail URL from the `image` tag. */
  image?:     string;
  /** Public web page (the `web` tag) — "open in browser" link. */
  webUrl?:    string;
  /** Unix-seconds timestamp from the `starts` tag (or event created_at). */
  startsAt:   number;
  /** When this entry was fetched, so subscribers can render staleness. */
  fetchedAt:  number;
}

let _current: LiveStream | null = null;
/** Every live stream from the allowlist, sorted newest-start first. */
let _all: LiveStream[] = [];
let _pool: any = null;
let _subscribers = 0;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _inFlight  = false;
let _outboxRelays: string[] = [];
let _outboxLoaded = false;

async function loadPool(): Promise<void> {
  if (_pool) return;
  const { SimplePool } = await import('nostr-tools/pool');
  _pool = new SimplePool();
}

function emitUpdate(): void {
  try { window.dispatchEvent(new Event(EVENT_NAME)); } catch { /* SSR / non-browser */ }
}

/**
 * Force an immediate live-stream poll. Callers can await this to make a
 * deterministic audio-source decision (e.g. on Lounge entry, before starting
 * any music). If a poll is already in flight, returns immediately — the
 * caller will get the result via the subscription callback when it resolves.
 */
export function refreshLiveStream(): Promise<void> {
  return refresh();
}

async function loadOutboxes(): Promise<void> {
  if (_outboxLoaded || !_pool) return;
  _outboxLoaded = true;
  const evs: any[] = await _pool
    .querySync(RELAYS, { kinds: [10002], authors: ALLOWED_STREAMER_PUBKEYS })
    .catch(() => []);
  const found = new Set<string>();
  for (const ev of evs) {
    for (const t of (ev.tags || [])) {
      if (t[0] !== 'r' || !t[1] || (t[2] && t[2] !== 'write')) continue;
      // Skip junk relay entries: localhost (streamers sometimes leave dev
      // relays in their kind:10002), and non-wss schemes.
      const url = String(t[1]);
      if (/^wss?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])/i.test(url)) continue;
      if (!/^wss?:\/\//i.test(url)) continue;
      found.add(url);
    }
  }
  _outboxRelays = [...found];
}

async function refresh(): Promise<void> {
  if (_inFlight) return;
  _inFlight = true;
  try {
    await loadPool();
    await loadOutboxes();
    const relays = [...new Set([...RELAYS, ..._outboxRelays])];
    const events: any[] = await _pool.querySync(relays, {
      kinds:   [30311],
      authors: ALLOWED_STREAMER_PUBKEYS,
      limit:   500,
    });
    const liveAll = pickAllLiveStreams(events);
    const live    = liveAll[0] ?? null;
    const prevAllIds = _all.map(s => `${s.pubkey}:${s.channel}`).join(',');
    const nextAllIds = liveAll.map(s => `${s.pubkey}:${s.channel}`).join(',');
    _all     = liveAll;
    _current = live;
    if (prevAllIds !== nextAllIds) emitUpdate();
  } catch (_) {
    // Silent — leave _current as-is so we don't flicker the UI on transient
    // relay failures.
  } finally {
    _inFlight = false;
  }
}

/**
 * Reduces a batch of 30311 events to every (pubkey, channel) pair that's
 * currently live, sorted newest-start first. The first entry is what
 * {@link getCurrentLiveStream} returns as the auto-pick; the full list is
 * what the Lounge banner shows when the user opens the stream picker.
 */
function pickAllLiveStreams(events: any[]): LiveStream[] {
  // Among all returned 30311s, keep only the newest per (pubkey, d-tag)
  // — relays may return historical replaceable revisions.
  const newestByAddr = new Map<string, any>();
  for (const ev of events) {
    if (!Array.isArray(ev.tags)) continue;
    const dTag = ev.tags.find((t: any) => Array.isArray(t) && t[0] === 'd');
    const d = dTag?.[1];
    if (!d) continue;
    const key = `${ev.pubkey}:${d}`;
    const prev = newestByAddr.get(key);
    if (!prev || ev.created_at > prev.created_at) newestByAddr.set(key, ev);
  }

  // Of the newest revisions, keep only those flagged live AND that match
  // the allowlist. For bare-pubkey allowlist entries, every channel passes.
  // For (pubkey, dTag) entries, only the named channel passes — so
  // shared-host pubkeys (zap.stream et al) don't drag in every guest stream.
  const liveOnly: any[] = [];
  for (const ev of newestByAddr.values()) {
    const status = ev.tags.find((t: any[]) => t[0] === 'status')?.[1];
    if (status !== 'live') continue;
    if (!isAllowed(ev.pubkey, ev.tags.find((t: any[]) => t[0] === 'd')?.[1] ?? '')) continue;
    liveOnly.push(ev);
  }
  if (liveOnly.length === 0) return [];

  // Most recently started first — closest to "this is what they're playing
  // right now" for the auto-pick at index 0.
  liveOnly.sort((a, b) => {
    const aStart = parseInt(a.tags.find((t: any[]) => t[0] === 'starts')?.[1] || '0', 10) || a.created_at;
    const bStart = parseInt(b.tags.find((t: any[]) => t[0] === 'starts')?.[1] || '0', 10) || b.created_at;
    return bStart - aStart;
  });

  const out: LiveStream[] = [];
  for (const ev of liveOnly) {
    const tag = (k: string): string | undefined =>
      ev.tags.find((t: any[]) => t[0] === k)?.[1];
    const hlsUrl = tag('streaming');
    if (!hlsUrl) continue;
    const startsRaw = tag('starts');
    out.push({
      pubkey:    ev.pubkey,
      channel:   tag('d')!,
      title:     tag('title') || 'Live',
      hlsUrl,
      image:     tag('image'),
      webUrl:    tag('web'),
      startsAt:  startsRaw ? parseInt(startsRaw, 10) : ev.created_at,
      fetchedAt: Date.now(),
    });
  }
  return out;
}

/** Latest known live stream (or null if nobody on the allowlist is live). */
export function getCurrentLiveStream(): LiveStream | null {
  return _current;
}

/** Every live stream from the allowlist, sorted newest-start first. */
export function getAllLiveStreams(): LiveStream[] {
  return _all.slice();
}

/** Hex pubkeys the Lounge will accept as live broadcasters. */
export function getAllowedStreamerPubkeys(): string[] {
  return ALLOWED_STREAMER_PUBKEYS.slice();
}

/**
 * Subscribe to live-stream changes. Triggers an immediate refresh on the
 * first subscriber and starts a 30-second poll. Returns an unsubscribe
 * function that tears down the poll when the last subscriber leaves.
 */
export function subscribeToLiveStream(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT_NAME, handler);
  _subscribers++;
  if (_subscribers === 1) {
    refresh();
    _pollTimer = setInterval(refresh, POLL_INTERVAL_MS);
  }
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    _subscribers = Math.max(0, _subscribers - 1);
    if (_subscribers === 0 && _pollTimer !== null) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  };
}
