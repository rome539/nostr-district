import { WebSocketServer, WebSocket } from 'ws';
import { webcrypto } from 'crypto';
if (!globalThis.crypto) (globalThis as any).crypto = webcrypto;

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { finalizeEvent, getPublicKey, generateSecretKey, getEventHash, verifyEvent, nip44 } from 'nostr-tools';

const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));
const bytesToHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

// Broad set so items + tombstones land widely — any browser reaches several.
// MUST stay in sync with ITEM_QUERY_RELAYS in src/nostr/nostrService.ts
const PUBLISH_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://offchain.pub',
  'wss://nostr.mom',
  'wss://relay.snort.social',
];

// ── Dev sandbox: keyless mode never touches public relays ─────────────────────
// Without ORACLE_PRIVATE_KEY (local dev), oracle events used to publish to the
// SAME public relays as prod — leaving permanent dev litter (test items, dev
// listings, a dev oracle profile) that even showed up as ghost listings in prod.
// In dev, events now live in an in-memory store instead: publishToRelays writes
// here, queryRelays answers from here. Full e2e flows work (mint→gift→trade→
// bounty) with zero pollution and no relay-propagation waits. State is
// disposable by design — a dev restart wipes the sandbox.
const DEV_SANDBOX = !process.env.ORACLE_PRIVATE_KEY;
const devEvents: any[] = [];

function devMatch(e: any, filter: any): boolean {
  if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
  if (filter.authors && !filter.authors.includes(e.pubkey)) return false;
  if (filter.since && e.created_at < filter.since) return false;
  if (filter.until && e.created_at > filter.until) return false;
  for (const key of Object.keys(filter)) {
    if (!key.startsWith('#')) continue;
    const tagName = key.slice(1);
    const wanted: string[] = filter[key];
    const values = e.tags.filter((t: string[]) => t[0] === tagName).map((t: string[]) => t[1]);
    if (!values.some((v: string) => wanted.includes(v))) return false;
  }
  return true;
}

function publishToRelays(event: any): void {
  if (DEV_SANDBOX) { devEvents.push(event); return; }
  for (const url of PUBLISH_RELAYS) {
    try {
      const sock = new WebSocket(url);
      sock.on('open', () => sock.send(JSON.stringify(['EVENT', event])));
      sock.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m[0] === 'OK' && m[1] === event.id) {
            console.log(`[Oracle] ${url}: ${m[2] ? 'accepted' : 'REJECTED ' + (m[3] || '')}`);
            sock.close();
          }
        } catch {}
      });
      sock.on('error', () => {});
      setTimeout(() => { try { sock.close(); } catch {} }, 5000);
    } catch {}
  }
}

// Query all relays for events matching a filter (Node WS — reliable). Dedupes by id.
// In the dev sandbox, answers come from the in-memory store only (deterministic,
// instant, and dev events never existed on public relays to begin with).
function queryRelays(filter: any): Promise<any[]> {
  if (DEV_SANDBOX) return Promise.resolve(devEvents.filter(e => devMatch(e, filter)));
  const subId = 'q' + Math.random().toString(36).slice(2, 9);
  const queryOne = (url: string): Promise<any[]> => new Promise((resolve) => {
    const collected: any[] = [];
    let done = false;
    const finish = () => { if (done) return; done = true; try { sock.close(); } catch {} resolve(collected); };
    let sock: WebSocket;
    try { sock = new WebSocket(url); } catch { resolve(collected); return; }
    const timer = setTimeout(finish, 5000);
    sock.on('open', () => sock.send(JSON.stringify(['REQ', subId, filter])));
    sock.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m[0] === 'EVENT' && m[1] === subId) collected.push(m[2]);
        else if (m[0] === 'EOSE' && m[1] === subId) { clearTimeout(timer); finish(); }
      } catch {}
    });
    sock.on('error', () => { clearTimeout(timer); finish(); });
    sock.on('close', () => { clearTimeout(timer); finish(); });
  });
  return Promise.all(PUBLISH_RELAYS.map(queryOne)).then(lists => {
    const byId = new Map<string, any>();
    for (const l of lists) for (const e of l) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()];
  });
}

// ── Oracle keypair ────────────────────────────────────────────────────────────
// The private key lives ONLY in the ORACLE_PRIVATE_KEY environment variable.
// It never appears in code, never sent to clients.
// Only the derived public key is shared — clients use it to verify item signatures.
//
// To generate a keypair (run once, save the output):
//   node -e "const {generateSecretKey,getPublicKey}=require('nostr-tools');const {bytesToHex}=require('@noble/hashes/utils');const sk=generateSecretKey();console.log('PRIVATE:',bytesToHex(sk));console.log('PUBLIC:',getPublicKey(sk));"
//
// Set on Railway: Dashboard → your service → Variables → ORACLE_PRIVATE_KEY = <hex>
// Set locally:    ORACLE_PRIVATE_KEY=<hex> npx tsx server.ts
//
// If you move off Railway:
//   1. Copy the ORACLE_PRIVATE_KEY env var value to your new host
//   2. Set ORACLE_PUBKEY on the client (src/stores/tradeItemStore.ts) to the matching public key
//   3. All previously minted items remain valid — signatures don't expire
//   4. The key is portable: Fly.io, VPS, Render, etc — just set the env var

const DEV_KEY_FILE = '.oracle-key-dev'; // gitignored — local dev only

let ORACLE_SK: Uint8Array;
if (process.env.ORACLE_PRIVATE_KEY) {
  ORACLE_SK = hexToBytes(process.env.ORACLE_PRIVATE_KEY);
  console.log('[Oracle] Using key from ORACLE_PRIVATE_KEY env var.');
} else if (existsSync(DEV_KEY_FILE)) {
  // Reuse the persisted local dev key so items survive server restarts
  ORACLE_SK = hexToBytes(readFileSync(DEV_KEY_FILE, 'utf8').trim());
  console.log('[Oracle] Using persisted local dev key from .oracle-key-dev');
} else {
  // First local run: generate a key and persist it for future restarts
  ORACLE_SK = generateSecretKey();
  writeFileSync(DEV_KEY_FILE, bytesToHex(ORACLE_SK));
  console.log('[Oracle] Generated new local dev key → saved to .oracle-key-dev');
  console.log('[Oracle] This key persists across restarts. Set ORACLE_PRIVATE_KEY env var for production.');
}

export const ORACLE_PUBKEY = getPublicKey(ORACLE_SK);
console.log(`[Oracle] Public key: ${ORACLE_PUBKEY}`);

// ── Key rotation ───────────────────────────────────────────────────────────────
// ORACLE_PUBKEYS_OLD (comma-separated hex pubkeys) lists RETIRED oracle keys.
// Items/markers signed by them are still recognized (queries + ownership checks
// use the whole set), but everything NEW is signed with the current key — and
// since transfers work by burn-old + mint-fresh, every trade/sale/gift lazily
// re-signs an old item under the current key. To rotate:
//   1. Set ORACLE_PRIVATE_KEY to the new key, add the old pubkey to
//      ORACLE_PUBKEYS_OLD (Railway), and add it to VITE_ORACLE_PUBKEYS (client).
//   2. Months later, when old-key items have churned out, drop the old key.
const ORACLE_KEYS_OLD: string[] = (process.env.ORACLE_PUBKEYS_OLD ?? '')
  .split(',').map(s => s.trim().toLowerCase()).filter(s => /^[0-9a-f]{64}$/.test(s));
const ORACLE_AUTHORS: string[] = [ORACLE_PUBKEY, ...ORACLE_KEYS_OLD];
const isOracleKey = (pk: string): boolean => ORACLE_AUTHORS.includes((pk ?? '').toLowerCase());
if (ORACLE_KEYS_OLD.length) console.log(`[Oracle] Also honoring ${ORACLE_KEYS_OLD.length} retired key(s): ${ORACLE_KEYS_OLD.map(k => k.slice(0, 8)).join(', ')}…`);

publishOracleProfile();  // announce a name so oracle DMs aren't a raw npub

// ── Weekly drop tracking (account-wide, not per-browser) ──────────────────────
// Persisted to a file so it survives restarts and is shared across all the
// player's browsers/devices.
const WEEKLY_FILE = '.weekly-drops.json';
const MS_7D = 7 * 24 * 60 * 60 * 1000;
let weeklyDrops: Record<string, number> = {};
try { if (existsSync(WEEKLY_FILE)) weeklyDrops = JSON.parse(readFileSync(WEEKLY_FILE, 'utf8')); } catch {}

function canWeeklyDrop(pubkey: string): boolean {
  return Date.now() - (weeklyDrops[pubkey] ?? 0) >= MS_7D;
}
function recordWeeklyDrop(pubkey: string): void {
  weeklyDrops[pubkey] = Date.now();
  try { writeFileSync(WEEKLY_FILE, JSON.stringify(weeklyDrops)); } catch {}
}

// The file/memory above is only a warm cache — the hosting filesystem is EPHEMERAL
// and is wiped on every redeploy, which used to re-grant everyone a fresh weekly
// drop after each deploy. The durable source of truth is a tiny oracle-signed
// marker on the relays (kind 30078, d-tag `ndweekly_<pubkey>`, addressable so the
// newest replaces the old). Checked only when the cache has no fresh entry, i.e.
// right after a deploy — one relay query per player, then cached again.
async function fetchWeeklyMarkerMs(pubkey: string): Promise<number> {
  try {
    const events = await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#d': [`ndweekly_${pubkey}`] });
    let newest = 0;
    for (const ev of events) if (ev?.created_at > newest) newest = ev.created_at;
    return newest * 1000;
  } catch { return 0; } // relays unreachable → cache-only behavior (same as before this fix)
}
function publishWeeklyMarker(pubkey: string): void {
  if (!ORACLE_SK) return;
  const ev = finalizeEvent({
    kind: 30078,
    pubkey: ORACLE_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', `ndweekly_${pubkey}`], ['p', pubkey], ['t', 'ndweekly']],
    content: '',
  }, ORACLE_SK);
  publishToRelays(ev);
}

// ── Scavenge rate limit (server-authoritative, keyed by pubkey) ───────────────
// The client picks WHERE/WHEN spots appear (localStorage, random) — harmless. But
// the RATE of scavenge mints is enforced here so clearing/editing localStorage can't
// farm the loop. Token bucket: burst up to 3 (the spot count), refill 1 per 8 min.
// Refill is set above the LEGIT ceiling (3 spots × 20–60-min respawn averages
// ~4.5/hr, lucky fast-respawn streaks peak ~9/hr briefly) so a normal player is
// never falsely blocked, while a cheater can't beat ~7.5/hr sustained.
// Per-account, survives restarts + syncs across devices.
const SCAVENGE_FILE = '.scavenge-buckets.json';
const SCAVENGE_CAPACITY = 3;
const SCAVENGE_REFILL_MS = 8 * 60 * 1000;
let scavengeBuckets: Record<string, { tokens: number; lastRefill: number }> = {};
try { if (existsSync(SCAVENGE_FILE)) scavengeBuckets = JSON.parse(readFileSync(SCAVENGE_FILE, 'utf8')); } catch {}

function refillScavenge(pubkey: string): { tokens: number; lastRefill: number } {
  const now = Date.now();
  let b = scavengeBuckets[pubkey];
  if (!b) { b = { tokens: SCAVENGE_CAPACITY, lastRefill: now }; scavengeBuckets[pubkey] = b; return b; }
  const gained = Math.floor((now - b.lastRefill) / SCAVENGE_REFILL_MS);
  if (gained > 0) {
    b.tokens = Math.min(SCAVENGE_CAPACITY, b.tokens + gained);
    b.lastRefill += gained * SCAVENGE_REFILL_MS; // advance only by whole intervals consumed
  }
  return b;
}
function canScavenge(pubkey: string): boolean {
  return refillScavenge(pubkey).tokens >= 1;
}
function recordScavenge(pubkey: string): void {
  const b = refillScavenge(pubkey);
  b.tokens = Math.max(0, b.tokens - 1);
  try { writeFileSync(SCAVENGE_FILE, JSON.stringify(scavengeBuckets)); } catch {}
}

// ── Fishing: SERVER-AUTHORITATIVE catch rolls ─────────────────────────────────
// The fishing minigame (cast → wait → bite → reel) runs in the client, but the
// client has NO say in what was caught: it sends a bare `fish_catch_request` and
// the server rolls the tier odds, picks the fish, rolls the keep-chance, and mints.
// A cheater's script is therefore just a bot playing the real game — same odds,
// same pace (rate-limited below), no way to claim legendaries directly.
//
// Tier odds + keep-chances mirror the original client values (WoodsScene/tradeItemStore):
//   legendary 0.15% · junk 24.85% · rare 25% · common 50%
//   keep: legendary 100% · rare 10% · common 5% · junk 5%
const FISH_TIERS: Record<string, string[]> = {
  common: ['fish_tiny_carp','fish_silver_trout','fish_moonfish','fish_bluegill','fish_mud_catfish','fish_speckled_sunfish','fish_lake_minnow','fish_striped_dace','fish_green_sunperch','fish_whiskered_loach','fish_spotted_rudd','fish_common_bream','fish_river_roach','fish_flathead_chub','fish_golden_shiner','fish_pumpkinseed'],
  rare: ['fish_darkwater_bass','fish_luminous_eel','fish_crystal_perch','fish_ghost_pike','fish_midnight_sturgeon','fish_starscale_koi','fish_abyssal_anglerfish','fish_ancient_goldfish','fish_love_letter'],
  junk: ['fish_old_boot','fish_bottle_message','fish_rusty_tin_can','fish_waterlogged_hat','fish_tangled_line','fish_broken_lantern'],
  legendary: ['fish_ostrich','fish_golden_satoshi','fish_enchanted_trident','fish_coelacanth','fish_meteor'],
};
// rare keep was 0.10 at launch, which made kept rares exactly as common as kept
// commons (25%×10% = 50%×5%). Halved so rares are genuinely 2× scarcer in the bag.
// junk keep raised 5% → 15% (2026-06-12): junk fish are bounty wants, and at a
// 5% keep a specific junk fish took ~11h of fishing — absurd for an Old Boot.
// Junk is sink fodder, not a prize; keeping a quarter of it is still "junk-feeling".
const FISH_KEEP: Record<string, number> = { legendary: 1.0, rare: 0.05, common: 0.10, junk: 0.15 };

function rollFishCatch(): { itemId: string; tier: string; kept: boolean } {
  const roll = Math.random();
  const tier = roll < 0.0015 ? 'legendary' : roll < 0.25 ? 'junk' : roll < 0.50 ? 'rare' : 'common';
  const pool = FISH_TIERS[tier];
  const itemId = pool[Math.floor(Math.random() * pool.length)];
  const kept = Math.random() < (FISH_KEEP[tier] ?? 0);
  return { itemId, tier, kept };
}

// ── Legendary catch leaderboard (oracle-authored, trade-proof) ─────────────────
// The board records WHO CAUGHT a legendary at the moment it happens, signed by
// the ORACLE — not the player. This means (a) a buried extension popup can never
// cost a catch (no player signature in the path), and (b) trading/selling the
// fish later doesn't move the credit: the catch is a past event, logged once.
// Per-player record: kind:30078, oracle-authored, d-tag ndfishrec_<pubkey>,
// content { catches:[{name,kg,ts}], total }. File-backed so it survives restarts.
const LEGENDARY_FISH_META: Record<string, { name: string; kg: string }> = {
  fish_ostrich:           { name: 'Ostrich',               kg: '63.5' },
  fish_golden_satoshi:    { name: 'Golden Satoshi Coin',   kg: '0.01' },
  fish_enchanted_trident: { name: 'Enchanted Trident',     kg: '8.4'  },
  fish_coelacanth:        { name: 'Leviathan Coelacanth',  kg: '91.2' },
  fish_meteor:            { name: 'Meteor from Andromeda',  kg: '???'  },
};
const FISH_REC_FILE = '.fish-records.json';
let fishRecords: Record<string, { name: string; kg: string; ts: number }[]> = {};
try { if (existsSync(FISH_REC_FILE)) fishRecords = JSON.parse(readFileSync(FISH_REC_FILE, 'utf8')); } catch {}
const fishBackfilled = new Set<string>(); // pubkeys reconciled against owned legendaries this lifetime

function publishFishRecord(pubkey: string): void {
  if (!ORACLE_SK) return;
  const catches = fishRecords[pubkey] ?? [];
  publishToRelays(finalizeEvent({
    kind: 30078,
    pubkey: ORACLE_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', `ndfishrec_${pubkey}`], ['p', pubkey], ['t', 'ndfishrec']],
    content: JSON.stringify({ catches, total: catches.length }),
  }, ORACLE_SK));
}

// Reconcile the warm cache with the DURABLE relay record before mutating it.
// Railway has no volume, so .fish-records.json is wiped on every redeploy — and
// without this, the next append would publish total:1 and clobber a player's real
// record. The oracle-signed ndfishrec on relays is the source of truth; never
// shrink below it. Once per pubkey per lifetime (the relay copy can only grow via
// us, so the in-memory cache stays current after the first load).
const fishRecLoaded = new Set<string>();
async function loadFishRecord(pubkey: string): Promise<void> {
  if (fishRecLoaded.has(pubkey)) return;
  fishRecLoaded.add(pubkey);
  try {
    const ev = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#d': [`ndfishrec_${pubkey}`] })).get(`ndfishrec_${pubkey}`);
    if (ev?.content) {
      const relayCatches = JSON.parse(ev.content).catches;
      if (Array.isArray(relayCatches) && relayCatches.length > (fishRecords[pubkey]?.length ?? 0)) {
        fishRecords[pubkey] = relayCatches;
      }
    }
  } catch { /* relays unreachable — cache-only, same as before */ }
}

async function recordLegendaryCatch(pubkey: string, itemId: string): Promise<void> {
  const meta = LEGENDARY_FISH_META[itemId];
  if (!meta) return;
  await loadFishRecord(pubkey); // don't clobber the durable record after a cache wipe
  const list = fishRecords[pubkey] ?? (fishRecords[pubkey] = []);
  list.push({ name: meta.name, kg: meta.kg, ts: Math.floor(Date.now() / 1000) });
  try { writeFileSync(FISH_REC_FILE, JSON.stringify(fishRecords)); } catch {}
  publishFishRecord(pubkey);
}

// One-time per-lifetime backfill: catches that predate this log (e.g. the
// missed-popup era) are recovered from legendary fish the player STILL owns and
// caught (oracle-minted, source=caught). Can't recover ones already traded away
// before the log existed — that evidence is gone — but it puts current holders
// back on the board.
async function backfillFishRecord(pubkey: string, name: string): Promise<void> {
  if (fishBackfilled.has(pubkey)) return;
  fishBackfilled.add(pubkey);
  await loadFishRecord(pubkey); // start from the durable record so we only ever add
  const owned = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': [pubkey], '#t': ['nditem'] }));
  let caught = 0;
  for (const ev of owned.values()) {
    if (isBurned(ev)) continue;
    if (tagVal(ev, 'source') === 'caught' && LEGENDARY_FISH_META[tagVal(ev, 'item_id') ?? '']) caught++;
  }
  const have = (fishRecords[pubkey] ?? []).length;
  if (caught <= have) return;
  const list = fishRecords[pubkey] ?? (fishRecords[pubkey] = []);
  const ts = Math.floor(Date.now() / 1000);
  for (let i = have; i < caught; i++) list.push({ name: 'legendary catch', kg: '?', ts: ts - (i - have) });
  try { writeFileSync(FISH_REC_FILE, JSON.stringify(fishRecords)); } catch {}
  publishFishRecord(pubkey);
  console.log(`[Fishing] Backfilled ${caught - have} legendary catch(es) for ${name} (${pubkey.slice(0, 8)}…)`);
}

// Per-pubkey reel rate limit. Honest pace: bite takes 4-16s + reel + recast ≈ one
// reel per 6s at MAX luck, ~11s average — so burst 8 + refill 1 per 8s can never
// block a human, while capping a 24/7 script at no-better-than-human speed.
// Skipped in local dev (no ORACLE_PRIVATE_KEY) so /devset test-minting stays fast.
const FISHING_FILE = '.fishing-buckets.json';
const FISHING_CAPACITY = 8;
const FISHING_REFILL_MS = 8 * 1000;
const FISHING_LIMIT_ACTIVE = !!process.env.ORACLE_PRIVATE_KEY; // prod oracle ⇒ enforce
let fishingBuckets: Record<string, { tokens: number; lastRefill: number }> = {};
try { if (existsSync(FISHING_FILE)) fishingBuckets = JSON.parse(readFileSync(FISHING_FILE, 'utf8')); } catch {}

function refillFishing(pubkey: string): { tokens: number; lastRefill: number } {
  const now = Date.now();
  let b = fishingBuckets[pubkey];
  if (!b) { b = { tokens: FISHING_CAPACITY, lastRefill: now }; fishingBuckets[pubkey] = b; return b; }
  const gained = Math.floor((now - b.lastRefill) / FISHING_REFILL_MS);
  if (gained > 0) {
    b.tokens = Math.min(FISHING_CAPACITY, b.tokens + gained);
    b.lastRefill += gained * FISHING_REFILL_MS; // advance only by whole intervals consumed
  }
  return b;
}
function canFish(pubkey: string): boolean {
  if (!FISHING_LIMIT_ACTIVE) return true;
  return refillFishing(pubkey).tokens >= 1;
}
function recordFish(pubkey: string): void {
  if (!FISHING_LIMIT_ACTIVE) return;
  const b = refillFishing(pubkey);
  b.tokens = Math.max(0, b.tokens - 1);
  try { writeFileSync(FISHING_FILE, JSON.stringify(fishingBuckets)); } catch {}
}

// ── Bounty board ──────────────────────────────────────────────────────────────
// The oracle posts weekly wants: burn N commons/junk → mint one rare. This is the
// economy's item SINK (commons leave circulation) and a weekly reward channel —
// ONE claim per account per bounty, no global cap, so every resident can take
// part each week. The price of a claim is real (your own items are destroyed),
// and the reward tier is capped at rare — rares already drop from scavenging, so
// this adds no new scarcity class to farm.
//
// Bounties are DETERMINISTIC from the week number (seeded PRNG over curated
// pools), so the server needs no storage for the board itself — every deploy
// regenerates the identical week. Only CLAIMS need persistence: warm cache in
// memory/file + a durable oracle-signed relay marker per bounty
// (d-tag `ndbounty_<bountyId>`, content = JSON claimant array) checked when the
// cache is cold — the same pattern as the weekly drop.

// What the oracle asks for: commons + junk only (the sink tier). Junk fish are
// deliberately in — it's the only thing old boots are good for.
const BOUNTY_WANT_POOL = [
  'fish_old_boot','fish_rusty_tin_can','fish_waterlogged_hat','fish_tangled_line','fish_broken_lantern',
  'fish_tiny_carp','fish_silver_trout','fish_bluegill','fish_mud_catfish','fish_lake_minnow','fish_common_bream',
  'hw_data_chip','hw_circuit_board','hw_cooling_fan','hw_solder_iron','hw_ram_stick','hw_capacitor','hw_ribbon_cable',
  'st_burner_phone','st_ghost_token','st_counterfeit_bill','st_lockpick_set','st_brass_knuckles','st_switchblade','st_burner_sim',
  'lo_satoshi_coin','lo_relay_key','lo_lightning_bolt','lo_seed_phrase','lo_node_badge','lo_paper_wallet','lo_mempool_vial','lo_hash_stone',
  'oc_black_candle','oc_evil_eye','oc_spirit_board','oc_bone_dice','oc_the_tower',
  'cr_sewer_rat','cr_alley_cat','cr_street_pigeon','cr_gutter_frog','cr_junkyard_dog',
  'eats_instant_ramen','eats_dumpling','eats_energy_drink','eats_cart_hotdog','eats_day_old_bagel',
];
// What the oracle pays: non-fish rares (fish stay fishing-only; legendaries are
// never bounty rewards — rares only, per the "no free repeatable rare+" rule the
// cap already enforces globally).
const BOUNTY_REWARD_POOL = [
  'hw_signal_relay','hw_encrypted_drive','hw_burner_pager','hw_rogue_dish','hw_gpu_card','hw_oscilloscope',
  'st_forged_id','st_contraband_pkg','st_skeleton_key','st_blackmarket_map','st_stash_key','st_wiretap',
  'lo_genesis_fragment','lo_whitepaper_page','lo_block_plaque','lo_pow_relic','lo_pizza_receipt','lo_node_map',
  'oc_the_fool','oc_scrying_mirror','oc_voodoo_doll','oc_grimoire',
  'cr_raccoon','cr_roost_bat','cr_white_crow','cr_pipe_snake',
  'eats_lucky_cat','eats_neon_sushi',
];
// Legendary weeks: ~1 in 6 weeks (seeded) the third poster offers a specific
// legendary — but wants RARES burned, not commons, so each copy costs 3 rares
// (a sink ladder: commons→rare, rares→legendary). No lottery on normal claims:
// rare-tier bounties always pay exactly what the poster shows.
const BOUNTY_LEGENDARY_POOL = [
  'hw_quantum_key','hw_mainframe_core','st_zk_proof','st_kingpin_ledger',
  'lo_manifesto','lo_satoshi_email','oc_hanged_man','cr_night_owl',
  'hw_zero_day','st_dons_ring','lo_genesis_seed',
];
const BOUNTY_LEGENDARY_WEEK_CHANCE = 1 / 6; // seeded; deterministic per week
const BOUNTY_COUNT = 3;       // bounties per week

// Deterministic PRNG so every server instance derives the same weekly board.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Bounty { id: string; wants: { itemId: string; qty: number }[]; rewardItemId: string; tier: 'rare' | 'legendary'; endsAt: number; holiday?: boolean }

function getWeekBounties(): Bounty[] {
  const week = Math.floor(Date.now() / MS_7D);
  const rng = mulberry32(week * 2654435761);
  const pick = <T>(arr: T[], taken: Set<T>): T => {
    let v: T;
    do { v = arr[Math.floor(rng() * arr.length)]; } while (taken.has(v));
    taken.add(v);
    return v;
  };
  const usedRewards = new Set<string>();
  const bounties: Bounty[] = [];
  for (let n = 0; n < BOUNTY_COUNT; n++) {
    const usedWants = new Set<string>();
    // 3+2 = 5 commons burned per claim (was 2+1). The faucet (~25-50 low-tier
    // items/wk for an active player) outran a 9/wk sink ~3-5×; 15/wk max burn
    // puts the board near parity for casual players. Legendary-week (rares) and
    // festive (holiday window) posters keep their own smaller quantities.
    const wants = [
      { itemId: pick(BOUNTY_WANT_POOL, usedWants), qty: 3 },
      { itemId: pick(BOUNTY_WANT_POOL, usedWants), qty: 2 },
    ];
    bounties.push({
      id: `bounty_${week}_${n}`,
      wants,
      rewardItemId: pick(BOUNTY_REWARD_POOL, usedRewards),
      tier: 'rare',
      endsAt: (week + 1) * MS_7D,
    });
  }
  // Legendary week (seeded, after the normal picks so the rng sequence is stable):
  // replace the last poster with a rares→legendary trade. Same id → same claims.
  if (rng() < BOUNTY_LEGENDARY_WEEK_CHANCE) {
    const usedWants = new Set<string>();
    const last = bounties[BOUNTY_COUNT - 1];
    last.wants = [
      { itemId: pick(BOUNTY_REWARD_POOL, usedWants), qty: 2 },
      { itemId: pick(BOUNTY_REWARD_POOL, usedWants), qty: 1 },
    ];
    last.rewardItemId = BOUNTY_LEGENDARY_POOL[Math.floor(rng() * BOUNTY_LEGENDARY_POOL.length)];
    last.tier = 'legendary';
  }

  // Festive poster: during a holiday window, a 4th bounty hangs for the WHOLE
  // window — burn the holiday's lower-tier items, get one of its legendaries.
  // Seeded by (holiday, year): identical all window, fresh claims every year
  // (the year is in the id, so the claims marker resets annually). It expires
  // with the window itself, not the weekly cycle.
  const hol = activeHolidayDrop();
  if (hol) {
    const year = new Date().getFullYear();
    let seed = year * 7919;
    for (const ch of hol.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const hrng = mulberry32(seed);
    const legends = hol.pool.filter(id => ITEM_RARITY.get(id) === 'legendary');
    const reward = legends.length
      ? legends[Math.floor(hrng() * legends.length)]
      : hol.pool[hol.pool.length - 1]; // no legendary in pool (shouldn't happen) — pay the last item
    // Wants come from the pool's lower tiers: commons when the holiday has them,
    // otherwise its rares (minus the reward). Tiny pools (Finney = 2 items) fall
    // back to 3× the single remaining item.
    const commons = hol.pool.filter(id => ITEM_RARITY.get(id) === 'common');
    const lower = commons.length
      ? commons
      : hol.pool.filter(id => id !== reward && ITEM_RARITY.get(id) !== 'legendary');
    const pickFrom = lower.length ? lower : hol.pool.filter(id => id !== reward);
    const a = pickFrom[Math.floor(hrng() * pickFrom.length)];
    const rest = pickFrom.filter(id => id !== a);
    const wants = rest.length
      ? [{ itemId: a, qty: 2 }, { itemId: rest[Math.floor(hrng() * rest.length)], qty: 1 }]
      : [{ itemId: a, qty: 3 }];
    bounties.push({
      id: `bounty_hol_${hol.id}_${year}`,
      wants,
      rewardItemId: reward,
      tier: 'legendary',
      endsAt: Date.UTC(year, hol.endMD[0] - 1, hol.endMD[1], 23, 59, 59),
      holiday: true,
    });
  }
  return bounties;
}

// Claims — warm cache (memory + file) with a durable relay marker per bounty.
const BOUNTY_FILE = '.bounty-claims.json';
let bountyClaims: Record<string, string[]> = {}; // bountyId → claimant pubkeys (ordered)
try { if (existsSync(BOUNTY_FILE)) bountyClaims = JSON.parse(readFileSync(BOUNTY_FILE, 'utf8')); } catch {}
const bountyMarkerFetched = new Set<string>(); // bountyIds already reconciled with relays this lifetime
const bountyClaimsInFlight = new Set<string>(); // `${bountyId}|${pubkey}` — blocks parallel double-claims

async function loadBountyClaims(bountyId: string): Promise<string[]> {
  if (!bountyMarkerFetched.has(bountyId)) {
    bountyMarkerFetched.add(bountyId);
    try {
      const events = await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#d': [`ndbounty_${bountyId}`] });
      let newest: any = null;
      for (const ev of events) if (!newest || ev.created_at > newest.created_at) newest = ev;
      if (newest) {
        const fromRelay: string[] = JSON.parse(newest.content || '[]');
        const merged = [...(bountyClaims[bountyId] ?? [])];
        for (const pk of fromRelay) if (!merged.includes(pk)) merged.push(pk);
        bountyClaims[bountyId] = merged;
      }
    } catch { /* relays unreachable → cache-only (same fallback as weekly drop) */ }
  }
  return bountyClaims[bountyId] ?? [];
}

function recordBountyClaim(bountyId: string, pubkey: string): void {
  const list = bountyClaims[bountyId] ?? (bountyClaims[bountyId] = []);
  if (!list.includes(pubkey)) list.push(pubkey);
  try { writeFileSync(BOUNTY_FILE, JSON.stringify(bountyClaims)); } catch {}
  if (!ORACLE_SK) return;
  publishToRelays(finalizeEvent({
    kind: 30078,
    pubkey: ORACLE_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', `ndbounty_${bountyId}`], ['t', 'ndbounty']],
    content: JSON.stringify(list),
  }, ORACLE_SK));
}


// ── Scavenge: SERVER-AUTHORITATIVE rolls ──────────────────────────────────────
// The client decides where/when spots appear (cosmetic, localStorage), but WHAT
// a spot contains is rolled HERE — the client sends a bare scavenge_request and
// the server rolls the tier + item from the room's pool. Direct 'found' mints
// are rejected in prod (a client-supplied "I found X" is the forgery this
// prevents — previously a script could request a legendary on every token).
// Pools/odds mirror tradeItemStore.ts; the boot drift guard catches divergence.
//
// Tier odds (rebalanced 2026-06-11): legendary was 6% (!) — a Gold-set legendary
// every ~3 active hours, undercutting fishing and bounty legendary weeks. Now 3%
// ≈ one per ~6-8 active hours; Gold aura ≈ a season of regular play solo.
const SCAVENGE_TIER_ODDS: { tier: string; p: number }[] = [
  { tier: 'legendary', p: 0.03 },
  { tier: 'rare',      p: 0.20 },
  { tier: 'common',    p: 0.77 },
];
// Holiday spots keep GENEROUS legendary odds on purpose: the window is only ~7
// days, and seasonal legendaries aren't part of the Gold set — the short window
// is the scarcity. Only the year-round (Gold-set) odds needed the rebalance.
const HOLIDAY_SCAV_TIER_ODDS: { tier: string; p: number }[] = [
  { tier: 'legendary', p: 0.08 },
  { tier: 'rare',      p: 0.22 },
  { tier: 'common',    p: 0.70 },
];
const SCAV_TIER_FALLBACK: Record<string, string[]> = {
  legendary: ['legendary', 'rare', 'common', 'junk'],
  rare:      ['rare', 'common', 'junk', 'legendary'],
  common:    ['common', 'junk', 'rare', 'legendary'],
  junk:      ['junk', 'common', 'rare', 'legendary'],
};

// Item rarities (must match ITEM_CATALOG in tradeItemStore.ts)
const ITEM_RARITY = new Map<string, string>();
{
  const tiers: Record<string, string[]> = {
    legendary: ['fish_ostrich','fish_golden_satoshi','fish_enchanted_trident','fish_coelacanth','fish_meteor','hw_quantum_key','hw_mainframe_core','st_zk_proof','st_kingpin_ledger','lo_manifesto','lo_satoshi_email','oc_hanged_man','cr_night_owl','hol_phantom_key','hol_reaper_coin','hol_liberty_coin','hol_eagle_feather','hol_signed_paper','hol_double_spend','hol_genesis_coin','hol_pizza_coin','hol_running_btc','hol_frost_coin','hol_first_note','hw_zero_day','st_dons_ring','lo_genesis_seed'],
    rare: ['fish_darkwater_bass','fish_luminous_eel','fish_crystal_perch','fish_ghost_pike','fish_midnight_sturgeon','fish_starscale_koi','fish_abyssal_anglerfish','fish_ancient_goldfish','fish_love_letter','hw_signal_relay','hw_encrypted_drive','hw_burner_pager','hw_rogue_dish','st_forged_id','st_contraband_pkg','st_skeleton_key','st_blackmarket_map','lo_genesis_fragment','lo_whitepaper_page','lo_block_plaque','lo_pow_relic','oc_the_fool','oc_scrying_mirror','cr_raccoon','cr_roost_bat','hol_jack_o_lantern','hol_witch_hat','hol_cauldron','hol_firecracker','hol_bottle_rocket','hol_satoshi_quill','hol_hashcash_stamp','hol_block_zero','hol_chancellor','hol_btc_pizza','hol_pepperoni','hol_rpow_token','hol_gift_box','hol_relay_stone','hol_zap_bolt','hw_gpu_card','hw_oscilloscope','st_stash_key','st_wiretap','lo_pizza_receipt','lo_node_map','oc_voodoo_doll','oc_grimoire','cr_white_crow','cr_pipe_snake','eats_lucky_cat','eats_neon_sushi','eats_midnight_special'],
    common: ['fish_tiny_carp','fish_silver_trout','fish_moonfish','fish_bluegill','fish_mud_catfish','fish_speckled_sunfish','fish_lake_minnow','fish_striped_dace','fish_green_sunperch','fish_whiskered_loach','fish_spotted_rudd','fish_common_bream','fish_river_roach','fish_flathead_chub','fish_golden_shiner','fish_pumpkinseed','hw_data_chip','hw_circuit_board','hw_cooling_fan','hw_solder_iron','st_burner_phone','st_ghost_token','st_counterfeit_bill','st_lockpick_set','lo_satoshi_coin','lo_relay_key','lo_lightning_bolt','lo_seed_phrase','lo_node_badge','oc_black_candle','oc_evil_eye','cr_sewer_rat','cr_alley_cat','hol_candy_corn','hol_skull_candle','hol_black_cat','hol_sparkler','hol_flag_pin','hol_snowflake','hol_pine_sprig','hol_warm_mittens','hol_ostrich_egg','hol_purple_pill','hw_ram_stick','hw_capacitor','hw_ribbon_cable','st_brass_knuckles','st_switchblade','st_burner_sim','lo_paper_wallet','lo_mempool_vial','lo_hash_stone','oc_spirit_board','oc_bone_dice','oc_the_tower','cr_street_pigeon','cr_gutter_frog','cr_junkyard_dog','eats_instant_ramen','eats_dumpling','eats_energy_drink','eats_cart_hotdog'],
    junk: ['fish_old_boot','fish_bottle_message','fish_rusty_tin_can','fish_waterlogged_hat','fish_tangled_line','fish_broken_lantern','eats_day_old_bagel'],
  };
  for (const [rarity, ids] of Object.entries(tiers)) for (const id of ids) ITEM_RARITY.set(id, rarity);
}

// Per-scene pools (must match SCENE_POOLS in tradeItemStore.ts)
const SCAV_SCENE_POOLS: Record<string, string[]> = {
  hub: ['st_burner_phone','st_ghost_token','st_counterfeit_bill','st_lockpick_set','st_forged_id','st_blackmarket_map','st_zk_proof','st_kingpin_ledger','cr_sewer_rat','cr_alley_cat','cr_raccoon','cr_night_owl','st_brass_knuckles','st_switchblade','st_burner_sim','st_stash_key','st_wiretap','st_dons_ring','cr_street_pigeon','cr_gutter_frog','cr_junkyard_dog','cr_white_crow','cr_pipe_snake','eats_instant_ramen','eats_dumpling','eats_energy_drink','eats_cart_hotdog','eats_day_old_bagel','eats_lucky_cat','eats_neon_sushi','eats_midnight_special'],
  alley: ['st_burner_phone','st_ghost_token','st_counterfeit_bill','st_lockpick_set','st_forged_id','st_contraband_pkg','st_skeleton_key','st_blackmarket_map','hw_data_chip','lo_relay_key','st_zk_proof','st_kingpin_ledger','hw_quantum_key','lo_manifesto','oc_black_candle','oc_evil_eye','oc_the_fool','oc_scrying_mirror','oc_hanged_man','cr_sewer_rat','cr_alley_cat','cr_roost_bat','st_brass_knuckles','st_switchblade','st_burner_sim','st_stash_key','st_wiretap','st_dons_ring','hw_ram_stick','hw_capacitor','hw_ribbon_cable','hw_gpu_card','oc_spirit_board','oc_bone_dice','oc_the_tower','oc_voodoo_doll','oc_grimoire','cr_street_pigeon','cr_gutter_frog','cr_junkyard_dog','eats_instant_ramen','eats_dumpling','eats_energy_drink','eats_cart_hotdog','eats_day_old_bagel','eats_lucky_cat','eats_neon_sushi','eats_midnight_special'],
  woods: ['lo_satoshi_coin','lo_relay_key','lo_lightning_bolt','lo_seed_phrase','lo_node_badge','lo_pow_relic','hw_circuit_board','hw_cooling_fan','hw_data_chip','hw_quantum_key','hw_mainframe_core','lo_manifesto','lo_satoshi_email','cr_sewer_rat','cr_raccoon','cr_roost_bat','cr_night_owl','hw_ram_stick','hw_capacitor','hw_ribbon_cable','hw_gpu_card','hw_oscilloscope','hw_zero_day','lo_paper_wallet','lo_mempool_vial','lo_hash_stone','lo_pizza_receipt','lo_node_map','lo_genesis_seed','cr_white_crow','cr_pipe_snake'],
  rooftop: ['hw_signal_relay','hw_encrypted_drive','hw_burner_pager','hw_rogue_dish','hw_solder_iron','hw_data_chip','lo_genesis_fragment','lo_whitepaper_page','lo_block_plaque','hw_quantum_key','hw_mainframe_core','cr_roost_bat','cr_night_owl','hw_ram_stick','hw_capacitor','hw_gpu_card','hw_oscilloscope','hw_zero_day'],
  cabin: ['lo_satoshi_coin','lo_genesis_fragment','lo_whitepaper_page','lo_seed_phrase','lo_block_plaque','lo_pow_relic','lo_relay_key','lo_manifesto','lo_satoshi_email','oc_black_candle','oc_evil_eye','oc_the_fool','oc_scrying_mirror','oc_hanged_man','cr_alley_cat','lo_paper_wallet','lo_mempool_vial','lo_hash_stone','lo_pizza_receipt','lo_node_map','lo_genesis_seed','oc_spirit_board','oc_bone_dice','oc_the_tower','oc_voodoo_doll','oc_grimoire'],
};

// Holiday drop windows (must match HOLIDAY_DROPS in tradeItemStore.ts)
const SCAV_HOLIDAY_DROPS: { id: string; startMD: [number, number]; endMD: [number, number]; pool: string[] }[] = [
  { id: 'genesis',    startMD: [1, 1],   endMD: [1, 6],   pool: ['hol_block_zero', 'hol_chancellor', 'hol_genesis_coin'] },
  { id: 'finney',     startMD: [1, 9],   endMD: [1, 15],  pool: ['hol_rpow_token', 'hol_running_btc'] },
  { id: 'pizza_day',  startMD: [5, 18],  endMD: [5, 25],  pool: ['hol_btc_pizza', 'hol_pepperoni', 'hol_pizza_coin'] },
  { id: 'july4',      startMD: [7, 1],   endMD: [7, 7],   pool: ['hol_sparkler', 'hol_flag_pin', 'hol_firecracker', 'hol_bottle_rocket', 'hol_liberty_coin', 'hol_eagle_feather'] },
  { id: 'halloween',  startMD: [10, 27], endMD: [10, 31], pool: ['hol_candy_corn', 'hol_skull_candle', 'hol_black_cat', 'hol_jack_o_lantern', 'hol_witch_hat', 'hol_cauldron', 'hol_phantom_key', 'hol_reaper_coin'] },
  { id: 'whitepaper', startMD: [11, 1],  endMD: [11, 6],  pool: ['hol_satoshi_quill', 'hol_hashcash_stamp', 'hol_signed_paper', 'hol_double_spend'] },
  { id: 'nostr_day',  startMD: [11, 7],  endMD: [11, 13], pool: ['hol_ostrich_egg', 'hol_purple_pill', 'hol_relay_stone', 'hol_zap_bolt', 'hol_first_note'] },
  { id: 'winter',     startMD: [12, 20], endMD: [12, 31], pool: ['hol_snowflake', 'hol_pine_sprig', 'hol_warm_mittens', 'hol_gift_box', 'hol_frost_coin'] },
];

// Dev-only holiday simulation. Set by the URL param on the CLIENT — in dev the
// client forwards ?holiday=<id> in its join message and the sandbox adopts it,
// so `http://localhost:5173/?holiday=halloween` is the ONLY step needed.
// (TEST_HOLIDAY env still works as a boot-time default.)
let devTestHoliday: string | null = process.env.TEST_HOLIDAY ?? null;

function activeHolidayDrop(): { id: string; startMD: [number, number]; endMD: [number, number]; pool: string[] } | null {
  if (DEV_SANDBOX && devTestHoliday) {
    return SCAV_HOLIDAY_DROPS.find(h => h.id === devTestHoliday) ?? null;
  }
  const now = new Date();
  const t = (now.getMonth() + 1) * 100 + now.getDate();
  for (const h of SCAV_HOLIDAY_DROPS) {
    if (t >= h.startMD[0] * 100 + h.startMD[1] && t <= h.endMD[0] * 100 + h.endMD[1]) return h;
  }
  return null;
}
function activeHolidayPool(): string[] | null { return activeHolidayDrop()?.pool ?? null; }

// Roll a tier by the fixed odds, then a uniform item from that tier (falling
// back through the chain when the pool has no items of the target tier).
function rollScavenge(pool: string[], holiday: boolean): string | null {
  if (!pool.length) return null;
  let roll = Math.random();
  let target = 'common';
  for (const { tier, p } of (holiday ? HOLIDAY_SCAV_TIER_ODDS : SCAVENGE_TIER_ODDS)) {
    if (roll < p) { target = tier; break; }
    roll -= p;
  }
  for (const tier of SCAV_TIER_FALLBACK[target] ?? ['common']) {
    // junk shares the common tier (junk-only odds would make it unobtainable —
    // and eats_day_old_bagel is a bounty want, so it MUST be droppable)
    const candidates = pool.filter(id => {
      const r = ITEM_RARITY.get(id);
      return r === tier || (tier === 'common' && r === 'junk');
    });
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// Sold instance ids — prevents the same listed item from being bought twice
const SOLD_FILE = '.sold-instances.json';
let soldInstances: Set<string> = new Set();
try { if (existsSync(SOLD_FILE)) soldInstances = new Set(JSON.parse(readFileSync(SOLD_FILE, 'utf8'))); } catch {}
function recordSold(instanceId: string): void {
  soldInstances.add(instanceId);
  reservations.delete(instanceId);
  reservedForWinner.delete(instanceId);
  try { writeFileSync(SOLD_FILE, JSON.stringify([...soldInstances].slice(-5000))); } catch {}
}

// Burned (discarded/transferred-away) instance ids. Relay burn tombstones don't
// always reach every client (flaky WS coverage), so we also track burns here and
// broadcast them + send on join — clients filter these out of inventory reliably.
const BURNED_FILE = '.burned-instances.json';
let burnedInstances: Set<string> = new Set();
try { if (existsSync(BURNED_FILE)) burnedInstances = new Set(JSON.parse(readFileSync(BURNED_FILE, 'utf8'))); } catch {}
function recordBurned(instanceId: string): void {
  if (!instanceId || burnedInstances.has(instanceId)) return;
  burnedInstances.add(instanceId);
  try { writeFileSync(BURNED_FILE, JSON.stringify([...burnedInstances].slice(-10000))); } catch {}
  broadcast({ type: 'item_burned', instanceId });
}

// Instances with an accepted bid awaiting payment — clients hide BUY/BID for these.
// In-memory (display hint); purchase_init still enforces the winner server-side.
const reservedForWinner = new Set<string>();
function broadcast(obj: object): void {
  const m = JSON.stringify(obj);
  for (const [, p] of players) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(m);
}
function setReservedForWinner(instanceId: string, on: boolean): void {
  if (on) reservedForWinner.add(instanceId); else reservedForWinner.delete(instanceId);
  broadcast({ type: on ? 'item_reserved' : 'item_unreserved', instanceId });
}

// Short-lived reservations — a buyer's preflight check locks the item so a second
// buyer can't pay for it in the gap before the first transfer completes. Long
// enough to cover a QR/Lightning payment done out-of-band on another device.
const RESERVE_MS = 300_000; // 5 min
const reservations = new Map<string, number>(); // instanceId → expiry timestamp
function isReserved(id: string): boolean {
  const exp = reservations.get(id);
  if (!exp) return false;
  if (Date.now() > exp) { reservations.delete(id); return false; }
  return true;
}
function reserve(id: string): void { reservations.set(id, Date.now() + RESERVE_MS); }

// Bids are RELAY-BACKED — published as signed Nostr events by the bidder (kind
// 30078, t=ndbid). The server doesn't store them; it reads the bidder's signed bid
// off the relays when a seller accepts, so the accepted amount is the one the
// bidder actually committed to. See the accept_bid handler.

// Valid item IDs (must match ITEM_CATALOG in tradeItemStore.ts)
const VALID_ITEM_IDS = new Set([
  'fish_tiny_carp','fish_silver_trout','fish_moonfish','fish_bluegill','fish_mud_catfish',
  'fish_speckled_sunfish','fish_lake_minnow','fish_striped_dace','fish_green_sunperch',
  'fish_whiskered_loach','fish_spotted_rudd','fish_common_bream','fish_river_roach',
  'fish_flathead_chub','fish_golden_shiner','fish_pumpkinseed',
  'fish_darkwater_bass','fish_luminous_eel','fish_crystal_perch','fish_ghost_pike',
  'fish_midnight_sturgeon','fish_starscale_koi','fish_abyssal_anglerfish',
  'fish_ancient_goldfish','fish_love_letter',
  'fish_old_boot','fish_bottle_message','fish_rusty_tin_can','fish_waterlogged_hat',
  'fish_tangled_line','fish_broken_lantern',
  'fish_ostrich','fish_golden_satoshi','fish_enchanted_trident','fish_coelacanth','fish_meteor',
  'hw_data_chip','hw_circuit_board','hw_cooling_fan','hw_solder_iron','hw_signal_relay','hw_encrypted_drive','hw_burner_pager','hw_rogue_dish','hw_quantum_key','hw_mainframe_core',
  'st_burner_phone','st_ghost_token','st_counterfeit_bill','st_lockpick_set','st_forged_id','st_contraband_pkg','st_skeleton_key','st_blackmarket_map','st_zk_proof','st_kingpin_ledger',
  'lo_satoshi_coin','lo_relay_key','lo_lightning_bolt','lo_seed_phrase','lo_node_badge','lo_genesis_fragment',
  'lo_whitepaper_page','lo_block_plaque','lo_pow_relic','lo_manifesto','lo_satoshi_email',
  // Occult
  'oc_black_candle','oc_evil_eye','oc_the_fool','oc_scrying_mirror','oc_hanged_man',
  // Critters
  'cr_sewer_rat','cr_alley_cat','cr_raccoon','cr_roost_bat','cr_night_owl',
  // Evergreen expansion (+36)
  'hw_ram_stick','hw_capacitor','hw_ribbon_cable','hw_gpu_card','hw_oscilloscope','hw_zero_day',
  'st_brass_knuckles','st_switchblade','st_burner_sim','st_stash_key','st_wiretap','st_dons_ring',
  'lo_paper_wallet','lo_mempool_vial','lo_hash_stone','lo_pizza_receipt','lo_node_map','lo_genesis_seed',
  'oc_spirit_board','oc_bone_dice','oc_the_tower','oc_voodoo_doll','oc_grimoire',
  'cr_street_pigeon','cr_gutter_frog','cr_junkyard_dog','cr_white_crow','cr_pipe_snake',
  'eats_instant_ramen','eats_dumpling','eats_energy_drink','eats_cart_hotdog','eats_day_old_bagel','eats_lucky_cat','eats_neon_sushi','eats_midnight_special',
  // Holiday items
  'hol_candy_corn','hol_skull_candle','hol_black_cat','hol_jack_o_lantern','hol_witch_hat','hol_cauldron','hol_phantom_key','hol_reaper_coin',
  'hol_sparkler','hol_flag_pin','hol_firecracker','hol_bottle_rocket','hol_liberty_coin','hol_eagle_feather',
  'hol_satoshi_quill','hol_hashcash_stamp','hol_signed_paper','hol_double_spend',
  'hol_block_zero','hol_chancellor','hol_genesis_coin',
  'hol_btc_pizza','hol_pepperoni','hol_pizza_coin',
  'hol_rpow_token','hol_running_btc',
  'hol_snowflake','hol_pine_sprig','hol_warm_mittens','hol_gift_box','hol_frost_coin',
  'hol_ostrich_egg','hol_purple_pill','hol_relay_stone','hol_zap_bolt','hol_first_note',
]);

// Valid rooms each item category can be minted from
const ITEM_ROOM_WHITELIST: Record<string, string[]> = {
  fish:     ['woods'],
  hardware: ['woods', 'alley', 'lounge', 'relay'],
  street:   ['alley', 'hub'],
  lore:     ['woods', 'alley', 'lounge', 'relay', 'cabin'],
  occult:   ['alley', 'cabin'],
  critters: ['hub', 'alley', 'woods', 'lounge'],
  eats:     ['hub', 'alley', 'lounge'], // street food — downtown
  holiday:  ['hub', 'alley', 'woods', 'cabin', 'lounge', 'relay'], // holiday drops spawn anywhere
};

function getCategoryFromId(itemId: string): string {
  if (itemId.startsWith('fish_'))  return 'fish';
  if (itemId.startsWith('hol_'))   return 'holiday';
  if (itemId.startsWith('hw_'))    return 'hardware';
  if (itemId.startsWith('st_'))    return 'street';
  if (itemId.startsWith('lo_'))    return 'lore';
  if (itemId.startsWith('oc_'))    return 'occult';
  if (itemId.startsWith('cr_'))    return 'critters';
  if (itemId.startsWith('eats_'))  return 'eats';
  return '';
}

function mintItem(ownerPubkey: string, itemId: string, acquiredFrom: string): object | null {
  if (!ORACLE_SK) return null;
  const instanceId = `${itemId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const unsigned = {
    kind: 30078,
    pubkey: ORACLE_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d',       instanceId],
      ['p',       ownerPubkey],   // standard indexed tag — relays can filter by this
      ['item_id', itemId],
      ['source',  acquiredFrom],
      ['t',       'nditem'],
      ['client',  'Nostr District'],
    ],
    content: '',
  };
  return finalizeEvent(unsigned, ORACLE_SK);
}

// Burn an item: publish a tombstone (same d-tag, keeps owner p-tag + burned marker,
// newer created_at) so the owner's query filters it out.
function burnItem(event: any): void {
  if (!ORACLE_SK) return;
  const dTag  = event?.tags?.find((t: string[]) => t[0] === 'd')?.[1];
  const owner = event?.tags?.find((t: string[]) => t[0] === 'p')?.[1];
  if (!dTag || !owner) return;
  const tombstone = finalizeEvent({
    kind: 30078,
    pubkey: ORACLE_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', dTag], ['p', owner], ['t', 'nditem'], ['burned', '1']],
    content: '',
  }, ORACLE_SK);
  publishToRelays(tombstone);
  recordBurned(dTag);
}

// Transfer: verify the event is oracle-signed and owned by `fromPubkey`, then
// burn it and mint a fresh copy to `toPubkey`. Returns the new event or null.
function transferItem(event: any, fromPubkey: string, toPubkey: string): object | null {
  if (!ORACLE_SK) return null;
  const owner  = event?.tags?.find((t: string[]) => t[0] === 'p')?.[1];
  const itemId = event?.tags?.find((t: string[]) => t[0] === 'item_id')?.[1];
  // Items signed by ANY trusted oracle key (current or retired) are valid — the
  // re-mint below puts the fresh copy under the CURRENT key (lazy migration).
  if (!isOracleKey(event?.pubkey)) return null;
  // Owner must match; when transferring out of escrow (from = the oracle), the
  // holding p-tag may be a retired oracle key, so accept any key in the set.
  const ownerOk = owner === fromPubkey || (isOracleKey(fromPubkey) && isOracleKey(owner));
  if (!ownerOk) return null;
  if (!itemId || !VALID_ITEM_IDS.has(itemId)) return null;
  // Cryptographically confirm the oracle actually signed this — never trust a
  // pubkey field alone (relays don't re-verify on read, callers may pass raw JSON).
  try { if (!verifyEvent(event)) return null; } catch { return null; }
  burnItem(event);
  return mintItem(toPubkey, itemId, 'received');
}

// Fetch the authoritative current ownership event for an instance from relays —
// the only trustworthy source of "who owns this right now". Used by gift/swap so
// they can't be fed a forged or stale (already-spent) event by the client.
async function fetchOwnedItem(instanceId: string, ownerPubkey: string): Promise<any | null> {
  if (!instanceId) return null;
  const owned = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': [ownerPubkey], '#t': ['nditem'] }));
  const ev = owned.get(instanceId);
  if (!ev || isBurned(ev)) return null;
  return ev;
}

// ── Escrow + Lightning payment verification ───────────────────────────────────
// A listed item is escrowed: republished under the same d-tag but OWNED BY THE
// ORACLE (p = oracle) with the seller, price and Lightning address recorded. This
// (a) stops the seller spending a listed item out from under a buyer, and (b) lets
// the oracle release it on verified payment even while the seller is offline.

// Re-own an item to the oracle with escrow metadata. Same d-tag → relays replace
// the seller's ownership event with this one (addressable, newer wins).
function escrowItem(event: any, sellerPubkey: string, priceSats: number, lud16: string, itemName: string): object | null {
  if (!ORACLE_SK) return null;
  const dTag   = event?.tags?.find((t: string[]) => t[0] === 'd')?.[1];
  const itemId = event?.tags?.find((t: string[]) => t[0] === 'item_id')?.[1];
  if (!dTag || !itemId) return null;
  return finalizeEvent({
    kind: 30078,
    pubkey: ORACLE_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', dTag],
      ['p', ORACLE_PUBKEY],            // held by the oracle while listed
      ['item_id', itemId],
      ['t', 'nditem'],
      ['source', 'escrow'],
      ['escrow_seller', sellerPubkey],
      ['escrow_price', String(priceSats)],
      ['escrow_lud16', lud16],
      ['escrow_name', (itemName || itemId).slice(0, 80)],
    ],
    content: '',
  }, ORACLE_SK);
}

// Re-publish an escrow event, optionally stamping it with the accepted bidder so
// only they can complete the purchase (at the bid price). Pass winner=null to clear.
function restampEscrow(event: any, winner: string | null, winningPrice: number): object | null {
  if (!ORACLE_SK) return null;
  const dTag   = tagVal(event, 'd');
  const itemId = tagVal(event, 'item_id');
  const seller = tagVal(event, 'escrow_seller');
  const price  = tagVal(event, 'escrow_price');
  const lud16  = tagVal(event, 'escrow_lud16');
  const name   = tagVal(event, 'escrow_name') ?? itemId;
  if (!dTag || !itemId || !seller || !price || !lud16) return null;
  const tags: string[][] = [
    ['d', dTag], ['p', ORACLE_PUBKEY], ['item_id', itemId], ['t', 'nditem'],
    ['source', 'escrow'], ['escrow_seller', seller], ['escrow_price', price], ['escrow_lud16', lud16],
    ['escrow_name', name],
  ];
  if (winner) { tags.push(['awaiting_winner', winner], ['winning_price', String(winningPrice)]); }
  return finalizeEvent({ kind: 30078, pubkey: ORACLE_PUBKEY, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, ORACLE_SK);
}

// Durable "you won — pay now" marker, addressed to the winner via #p so their
// client can find it on login + via subscription, even if offline at accept time.
function publishWinMarker(instanceId: string, itemId: string, winner: string, price: number): void {
  if (!ORACLE_SK) return;
  const ev = finalizeEvent({
    kind: 30078, pubkey: ORACLE_PUBKEY, created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `win_${instanceId}`], ['p', winner], ['t', 'ndwin'],
      ['instance_id', instanceId], ['item_id', itemId], ['winning_price', String(price)],
    ],
    content: '',
  }, ORACLE_SK);
  publishToRelays(ev);
}

// Tombstone a win marker (winner paid, seller cancelled, or item delisted).
function clearWinMarker(instanceId: string, winner: string): void {
  if (!ORACLE_SK || !winner) return;
  const ev = finalizeEvent({
    kind: 30078, pubkey: ORACLE_PUBKEY, created_at: Math.floor(Date.now() / 1000),
    tags: [['d', `win_${instanceId}`], ['p', winner], ['t', 'ndwin'], ['withdrawn', '1']],
    content: '',
  }, ORACLE_SK);
  publishToRelays(ev);
}

// Random timestamp within the last ~2 days — NIP-59 recommends fuzzing gift-wrap
// timestamps so they don't leak when the message was actually sent.
function randomTs(): number { return Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800); }

// Send a private DM (NIP-17 gift wrap) from the oracle to a player. Three layers:
// kind 14 rumor → kind 13 seal (NIP-44, oracle→recipient) → kind 1059 gift wrap
// (NIP-44, ephemeral→recipient). Matches the client dmService so it decrypts in
// Nostr District and any NIP-17 client (Damus etc.), and gives a real push.
function dmFromOracle(toPubkey: string, text: string): void {
  if (!ORACLE_SK || !toPubkey) return;
  try {
    // 1. Rumor — unsigned kind 14 chat message
    const rumor: any = {
      kind: 14, pubkey: ORACLE_PUBKEY, created_at: Math.floor(Date.now() / 1000),
      tags: [['p', toPubkey]], content: text,
    };
    rumor.id = getEventHash(rumor);
    // 2. Seal — kind 13, rumor encrypted oracle→recipient, signed by the oracle
    const ckSeal = nip44.getConversationKey(ORACLE_SK, toPubkey);
    const seal = finalizeEvent({
      kind: 13, content: nip44.encrypt(JSON.stringify(rumor), ckSeal),
      created_at: randomTs(), tags: [],
    }, ORACLE_SK);
    // 3. Gift wrap — kind 1059, seal encrypted ephemeral→recipient, signed ephemeral
    const ephSk = generateSecretKey();
    const ckWrap = nip44.getConversationKey(ephSk, toPubkey);
    const giftWrap = finalizeEvent({
      kind: 1059, content: nip44.encrypt(JSON.stringify(seal), ckWrap),
      created_at: randomTs(), tags: [['p', toPubkey]],
    }, ephSk);
    publishToRelays(giftWrap);
  } catch (e) { console.error('[Oracle] DM (NIP-17) failed:', e); }
}

// Publish the oracle's profile (kind 0) once on boot so DMs/notes show a name
// instead of a raw npub in clients.
function publishOracleProfile(): void {
  if (!ORACLE_SK) return;
  const ev = finalizeEvent({
    kind: 0, pubkey: ORACLE_PUBKEY, created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({ name: 'Nostr District oracle', about: 'Marketplace oracle for Nostr District — bid wins & item notices.' }),
  }, ORACLE_SK);
  publishToRelays(ev);
}

// LNURL-pay: resolve a lud16 to a bolt11 invoice + (LUD-21) verify URL. The
// invoice pays the SELLER directly — the oracle never custodies funds.
async function lnurlGetInvoice(lud16: string, sats: number, comment?: string):
    Promise<{ bolt11: string; verify: string | null } | null> {
  try {
    const [user, domain] = String(lud16).split('@');
    if (!user || !domain) return null;
    const metaRes = await fetch(`https://${domain}/.well-known/lnurlp/${user}`);
    const meta: any = await metaRes.json();
    if (!meta?.callback) return null;
    const msats = sats * 1000;
    if (meta.minSendable && msats < meta.minSendable) return null;
    if (meta.maxSendable && msats > meta.maxSendable) return null;
    const params = new URLSearchParams({ amount: String(msats) });
    // Attach the sale memo as an LNURL-pay comment (LUD-12) so it shows on the
    // seller's incoming payment — only if their wallet advertises comment support.
    const maxComment = Number(meta.commentAllowed ?? 0);
    if (comment && maxComment > 0) params.set('comment', comment.slice(0, maxComment));
    const sep = meta.callback.includes('?') ? '&' : '?';
    const invRes = await fetch(`${meta.callback}${sep}${params.toString()}`);
    const inv: any = await invRes.json();
    if (!inv?.pr) return null;
    return { bolt11: inv.pr, verify: inv.verify || null };
  } catch { return null; }
}

// Poll an LNURL verify URL — true once the invoice is settled.
async function lnurlIsSettled(verifyUrl: string): Promise<boolean> {
  try {
    const r = await fetch(verifyUrl);
    const d: any = await r.json();
    return !!d?.settled;
  } catch { return false; }
}

// Reduce relay events to the newest event per d-tag (so a burn tombstone wins).
function newestPerD(events: any[]): Map<string, any> {
  const byD = new Map<string, any>();
  for (const e of events) {
    const d = e.tags?.find((t: string[]) => t[0] === 'd')?.[1];
    if (!d) continue;
    if (!byD.has(d) || e.created_at > byD.get(d).created_at) byD.set(d, e);
  }
  return byD;
}
const isBurned = (e: any): boolean => !!e?.tags?.find((t: string[]) => t[0] === 'burned');
const tagVal = (e: any, name: string): string | undefined => e?.tags?.find((t: string[]) => t[0] === name)?.[1];

// Poll an LNURL verify URL; once the invoice settles, release the escrowed item to
// the buyer (transfer oracle → buyer), mark it sold, and notify everyone. Used by
// both direct buys and accepted bids. `buyerWs` is where the buyer is connected.
function pollAndRelease(instanceId: string, buyer: string, buyerWs: WebSocket | undefined, verifyUrl: string): void {
  const send = (m: object) => { if (buyerWs?.readyState === WebSocket.OPEN) buyerWs.send(JSON.stringify(m)); };
  const started = Date.now();
  const poll = async () => {
    if (soldInstances.has(instanceId)) return;
    if (await lnurlIsSettled(verifyUrl)) {
      const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }));
      const ev = held.get(instanceId);
      if (!ev || isBurned(ev)) { send({ type: 'item_purchase_error', instanceId, reason: 'item_gone' }); return; }
      const newEvent = transferItem(ev, ORACLE_PUBKEY, buyer);
      if (!newEvent) { send({ type: 'item_purchase_error', instanceId, reason: 'transfer_failed' }); return; }
      recordSold(instanceId);
      publishToRelays(newEvent);
      // Clear any "you won" marker so the winner isn't re-prompted to pay
      const winner = tagVal(ev, 'awaiting_winner');
      if (winner) clearWinMarker(instanceId, winner);
      console.log(`[Oracle] Released ${instanceId} → ${buyer.slice(0, 8)}… (payment verified)`);
      send({ type: 'item_minted', event: newEvent });
      const soldMsg = JSON.stringify({ type: 'item_sold', instanceId });
      for (const [, p] of players) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(soldMsg);

      // Notify the SELLER (if online) with a real zap notification carrying the
      // sale memo — same UI as any incoming zap, with the message attached. The
      // Lightning payment to their wallet also carries this as its LNURL comment.
      const seller   = tagVal(ev, 'escrow_seller');
      const itemName = tagVal(ev, 'escrow_name') ?? tagVal(ev, 'item_id') ?? 'item';
      const price    = Math.floor(Number(tagVal(ev, 'winning_price') ?? tagVal(ev, 'escrow_price') ?? '0'));
      if (seller) {
        const buyerName = players.get(buyer)?.name || buyer.slice(0, 8) + '…';
        const sellerWs = players.get(seller)?.ws;
        if (sellerWs?.readyState === WebSocket.OPEN) {
          sellerWs.send(JSON.stringify({
            type: 'incoming_zap', senderPk: buyer, senderName: buyerName,
            amountSats: price, comment: `Bought your ${itemName} on the market`,
          }));
        }
        // DM the seller too — gives a real push (Damus/iOS) even if they're offline
        // or out of the game, which the in-game toast can't.
        dmFromOracle(seller, `Your ${itemName} sold on Nostr District for ${price} sats! The payment was sent to your Lightning address.`);
      }
      return;
    }
    if (Date.now() - started > RESERVE_MS) { send({ type: 'purchase_timeout', instanceId }); return; }
    setTimeout(poll, 2500);
  };
  setTimeout(poll, 2500);
}

interface Player {
  pubkey: string;
  name: string;
  x: number;
  y: number;
  room: string;
  avatar: string;
  status: string;
  ws: WebSocket;
}

const players = new Map<string, Player>();

// Drift guard: the bounty pools are hand-curated copies of catalog ids — catch a
// typo or a renamed item at boot instead of failing claims at runtime.
for (const id of [...BOUNTY_WANT_POOL, ...BOUNTY_REWARD_POOL, ...BOUNTY_LEGENDARY_POOL]) {
  if (!VALID_ITEM_IDS.has(id)) console.error(`[Bounty] POOL DRIFT: ${id} is not a valid item id`);
}
for (const id of [...Object.values(SCAV_SCENE_POOLS).flat(), ...SCAV_HOLIDAY_DROPS.flatMap(h => h.pool)]) {
  if (!VALID_ITEM_IDS.has(id)) console.error(`[Scavenge] POOL DRIFT: ${id} is not a valid item id`);
  if (!ITEM_RARITY.has(id))   console.error(`[Scavenge] RARITY DRIFT: ${id} has no rarity entry`);
}

const wss = new WebSocketServer({ port: 3100 });
console.log('[Presence] Server running on ws://localhost:3100');

// Track which connections have responded to the last ping.
// When a mobile client kills the app without sending a close frame the OS drops
// the TCP connection silently; the heartbeat detects that within 30 s and calls
// ws.terminate(), which triggers the existing ws.on('close') cleanup logic.
const aliveConns = new WeakSet<WebSocket>();

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!aliveConns.has(ws)) {
      // No pong since last ping — connection is dead
      ws.terminate(); // emits 'close', triggering the cleanup handler below
      return;
    }
    aliveConns.delete(ws); // mark as pending until next pong
    ws.ping();
  });
}, 30_000);

wss.on('close', () => clearInterval(heartbeatInterval));

wss.on('connection', (ws) => {
  aliveConns.add(ws);          // treat as alive on first connect
  ws.on('pong', () => aliveConns.add(ws)); // re-mark alive on each pong

  let myPubkey: string | null = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'join') {
        myPubkey = msg.pubkey || `guest_${Math.random().toString(36).slice(2, 8)}`;
        // Dev sandbox: adopt the joining client's ?holiday= override (null clears it).
        if (DEV_SANDBOX && 'testHoliday' in msg) {
          devTestHoliday = typeof msg.testHoliday === 'string' && msg.testHoliday ? msg.testHoliday : null;
          if (devTestHoliday) console.log(`[Dev] Simulating holiday: ${devTestHoliday}`);
        }
        // Send oracle pubkey so client can verify items without env var config
        ws.send(JSON.stringify({ type: 'oracle_pubkey', pubkey: ORACLE_PUBKEY }));
        // Send sold-item ids so clients can hide already-sold listings from the market
        ws.send(JSON.stringify({ type: 'sold_list', ids: [...soldInstances] }));
        ws.send(JSON.stringify({ type: 'reserved_list', ids: [...reservedForWinner] }));
        ws.send(JSON.stringify({ type: 'burned_list', ids: [...burnedInstances] }));
        const room = msg.room || 'hub';
        players.set(myPubkey!, {
          pubkey: myPubkey!,
          name: msg.name || 'anon',
          x: msg.x || 400,
          y: msg.y || 348,
          room,
          avatar: msg.avatar || '',
          status: (msg.status || '').slice(0, 60),
          ws,
        });
        console.log(`[Presence] ${msg.name} joined ${room} (${players.size} online)`);
        // Recover legendary catches that predate the oracle catch-log (missed-popup
        // era) from fish the player still owns. Once per lifetime, best-effort.
        backfillFishRecord(myPubkey!, msg.name || 'anon').catch(() => {});

        const others: any[] = [];
        players.forEach((p, key) => {
          if (key !== myPubkey && p.room === room) {
            others.push({ pubkey: p.pubkey, name: p.name, x: p.x, y: p.y, avatar: p.avatar, status: p.status });
          }
        });
        ws.send(JSON.stringify({ type: 'players', room, players: others }));
        broadcastToRoom(room, { type: 'join', pubkey: myPubkey, name: msg.name, x: msg.x, y: msg.y, avatar: msg.avatar || '', status: (msg.status || '').slice(0, 60), room }, myPubkey);
        broadcastCount();
      }

      if (msg.type === 'room' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;

        const oldRoom = player.room;
        const newRoom = msg.room || 'hub';
        if (oldRoom === newRoom) {
          // Client re-sent same room (e.g. returning scene re-syncing) — resend players list
          const others: any[] = [];
          players.forEach((p, key) => {
            if (key !== myPubkey && p.room === newRoom) {
              others.push({ pubkey: p.pubkey, name: p.name, x: p.x, y: p.y, avatar: p.avatar, status: p.status });
            }
          });
          ws.send(JSON.stringify({ type: 'players', room: newRoom, players: others }));
          return;
        }

        console.log(`[Presence] ${player.name} moved ${oldRoom} → ${newRoom}`);

        // If leaving a myroom they own, kick everyone else out
        if (oldRoom.startsWith('myroom:') && oldRoom === `myroom:${myPubkey}`) {
          players.forEach((p, key) => {
            if (key !== myPubkey && p.room === oldRoom && p.ws.readyState === WebSocket.OPEN) {
              p.ws.send(JSON.stringify({ type: 'room_kick', reason: 'Owner left the room' }));
            }
          });
        }

        broadcastToRoom(oldRoom, { type: 'leave', pubkey: myPubkey }, myPubkey);

        // Clear lounge listening when leaving the lounge so visitors no
        // longer see the departed player counted toward stream listeners.
        const wasInLounge = oldRoom === 'lounge';
        if (wasInLounge) (player as any).loungeListening = null;

        player.room = newRoom;
        player.x = msg.x || 400;
        player.y = msg.y || 348;
        if (msg.avatar) player.avatar = msg.avatar;

        const others: any[] = [];
        players.forEach((p, key) => {
          if (key !== myPubkey && p.room === newRoom) {
            others.push({ pubkey: p.pubkey, name: p.name, x: p.x, y: p.y, avatar: p.avatar, status: p.status });
          }
        });
        ws.send(JSON.stringify({ type: 'players', room: newRoom, players: others }));
        broadcastToRoom(newRoom, { type: 'join', pubkey: myPubkey, name: player.name, x: player.x, y: player.y, avatar: player.avatar, status: player.status, room: newRoom }, myPubkey);
        broadcastCount();
        // If they left the lounge OR just entered it, push fresh listener
        // counts to the lounge crowd.
        if (wasInLounge || newRoom === 'lounge') broadcastLoungeListeners();
      }

      // Request to enter someone's myroom
      if (msg.type === 'room_request' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;
        const ownerPubkey = msg.ownerPubkey;
        const owner = players.get(ownerPubkey);

        if (!owner) {
          ws.send(JSON.stringify({ type: 'room_denied', reason: 'Player is offline' }));
          return;
        }

        console.log(`[Presence] ${player.name} requested to enter ${owner.name}'s room`);

        if (owner.ws.readyState === WebSocket.OPEN) {
          owner.ws.send(JSON.stringify({
            type: 'room_request',
            requesterPubkey: myPubkey,
            requesterName: player.name,
          }));
        }
      }

      // Owner responds to a room request
      if (msg.type === 'room_response' && myPubkey) {
        const requester = players.get(msg.requesterPubkey);
        if (!requester) return;

        const player = players.get(myPubkey);
        if (!player) return;

        if (msg.accepted) {
          console.log(`[Presence] ${player.name} accepted ${requester.name} into their room`);
          if (requester.ws.readyState === WebSocket.OPEN) {
            requester.ws.send(JSON.stringify({
              type: 'room_granted',
              ownerPubkey: myPubkey,
              ownerName: player.name,
              room: `myroom:${myPubkey}`,
              roomConfig: msg.roomConfig,
            }));
          }
        } else {
          console.log(`[Presence] ${player.name} denied ${requester.name}`);
          if (requester.ws.readyState === WebSocket.OPEN) {
            requester.ws.send(JSON.stringify({
              type: 'room_denied',
              reason: `${player.name} denied your request`,
            }));
          }
        }
      }

      // Request list of online players (for myroom door picker)
      if (msg.type === 'online_players' && myPubkey) {
        const list: any[] = [];
        players.forEach((p, key) => {
          if (key !== myPubkey) list.push({ pubkey: p.pubkey, name: p.name, status: p.status, avatar: p.avatar, room: p.room });
        });
        ws.send(JSON.stringify({ type: 'online_players', players: list }));
      }

      // Request aggregated zone counts for the world map (small payload — no per-player data)
      if (msg.type === 'zone_counts' && myPubkey) {
        const counts: Record<string, number> = { hub: 0, alley: 0, woods: 0, cabin: 0 };
        const roomMap = new Map<string, { ownerName: string; count: number }>();

        players.forEach((p) => {
          if (p.room in counts) {
            counts[p.room]++;
          } else if (p.room.startsWith('myroom:')) {
            const ownerPubkey = p.room.slice(7);
            if (!roomMap.has(ownerPubkey)) {
              const owner = players.get(ownerPubkey);
              roomMap.set(ownerPubkey, { ownerName: owner?.name ?? ownerPubkey.slice(0, 8), count: 0 });
            }
            roomMap.get(ownerPubkey)!.count++;
          }
        });

        const rooms = [...roomMap.entries()].map(([owner, data]) => ({
          owner,
          ownerName: data.ownerName,
          count: data.count,
        }));

        ws.send(JSON.stringify({ type: 'zone_counts', counts, rooms, total: players.size }));
      }

      if (msg.type === 'chat' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;
        const text = (msg.text || '').slice(0, 200);
        if (text.length > 0) {
          const emojis = Array.isArray(msg.emojis)
            ? msg.emojis.slice(0, 50).map((e: any) => ({ code: String(e.code || '').slice(0, 60), url: String(e.url || '').slice(0, 500) }))
            : undefined;
          broadcastToRoom(player.room, { type: 'chat', pubkey: myPubkey, name: player.name, text, ...(emojis?.length ? { emojis } : {}) }, null);
        }
      }

      if (msg.type === 'move' && myPubkey) {
        const player = players.get(myPubkey);
        if (player) {
          player.x = msg.x;
          player.y = msg.y;
          broadcastToRoom(player.room, { type: 'move', pubkey: myPubkey, x: msg.x, y: msg.y }, myPubkey);
        }
      }

      if (msg.type === 'avatar_update' && myPubkey) {
        const player = players.get(myPubkey);
        if (player) {
          player.avatar = msg.avatar || '';
          broadcastToRoom(player.room, { type: 'avatar_update', pubkey: myPubkey, avatar: player.avatar }, myPubkey);
        }
      }

      // Room-owner pushes a new room config (furniture moved, walls swapped,
      // posters changed, etc). Mirror the avatar_update flow: forward to every
      // other player currently in the same room so they can re-render live.
      // We trust the sender's own room state for routing — only myroom:<owner>
      // events go to people in that room, so visitors only see updates from
      // the actual owner.
      if (msg.type === 'room_config_update' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;
        const roomConfig = String(msg.roomConfig || '').slice(0, 50000);
        if (!roomConfig) return;
        broadcastToRoom(player.room, { type: 'room_config_update', pubkey: myPubkey, roomConfig }, myPubkey);
      }

      if (msg.type === 'status_update' && myPubkey) {
        const player = players.get(myPubkey);
        if (player) {
          player.status = (msg.status || '').slice(0, 60);
          broadcastAll({ type: 'status_update', pubkey: myPubkey, status: player.status }, myPubkey);
        }
      }

      // A Lounge visitor changed (or cleared) which live stream they're listening
      // to. We track per-player and broadcast the full listener map to other
      // Lounge visitors so they can render "N listeners" next to each stream.
      // streamKey format: "<broadcasterPubkey>:<channel>" — null clears.
      if (msg.type === 'lounge_listening_update' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;
        const k = typeof msg.streamKey === 'string' ? msg.streamKey.slice(0, 200) : null;
        (player as any).loungeListening = k || null;
        broadcastLoungeListeners();
      }

      if (msg.type === 'name_update' && myPubkey && msg.name) {
        const player = players.get(myPubkey);
        if (player) {
          player.name = msg.name;
          // Name is global — broadcast to all rooms so every player sees it
          broadcastAll({ type: 'name_update', pubkey: myPubkey, name: player.name }, myPubkey);
        }
      }

      // Privacy-preserving player-to-player zap notification. The sender's
      // wallet pays the recipient via direct Lightning (no kind:9734 published
      // to relays — zero metadata leakage on the public network). The sender
      // then notifies the server, which forwards a toast event to the
      // recipient's socket. The server enriches with the sender's display name
      // (from the players map) so the recipient can render "X zapped you N
      // sats" without needing a kind:0 lookup.
      if (msg.type === 'incoming_zap' && myPubkey) {
        const recipientPk = typeof msg.recipientPk === 'string' ? msg.recipientPk : null;
        const amountSats  = Math.floor(Number(msg.amountSats) || 0);
        const comment     = typeof msg.comment === 'string' ? msg.comment.slice(0, 280) : '';
        if (!recipientPk || recipientPk === myPubkey || amountSats <= 0) return;
        const sender    = players.get(myPubkey);
        const recipient = players.get(recipientPk);
        if (!recipient || recipient.ws.readyState !== WebSocket.OPEN) return;
        recipient.ws.send(JSON.stringify({
          type:       'incoming_zap',
          senderPk:   myPubkey,
          senderName: sender?.name || '',
          amountSats,
          comment,
        }));
      }

      // ── Item minting ──────────────────────────────────────────────────────
      if (msg.type === 'item_mint_request' && myPubkey) {
        const player  = players.get(myPubkey);
        if (!player) return;
        (async () => {

        const itemId      = typeof msg.itemId === 'string' ? msg.itemId : '';
        const acquiredFrom = typeof msg.acquiredFrom === 'string' ? msg.acquiredFrom : 'found';

        if (!VALID_ITEM_IDS.has(itemId)) {
          ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'unknown_item', itemId }));
          return;
        }

        if (acquiredFrom === 'weekly_drop') {
          // Seasonal items come from holiday events only — never the generic weekly drop.
          if (getCategoryFromId(itemId) === 'holiday') {
            ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'seasonal_not_in_weekly', itemId }));
            return;
          }
          // Account-wide gate (not per-browser) — only one weekly drop per 7 days.
          // Fast path: in-memory/file cache for the current server lifetime.
          if (!canWeeklyDrop(myPubkey)) {
            ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'weekly_already_claimed' }));
            return;
          }
          // Durable path: the cache is wiped on every redeploy, so consult the
          // relay marker before granting — this is what stops the "everyone gets
          // a fresh weekly drop after each deploy" bug.
          const lastMs = await fetchWeeklyMarkerMs(myPubkey);
          if (Date.now() - lastMs < MS_7D) {
            weeklyDrops[myPubkey] = lastMs; // re-warm the cache so the next check is instant
            ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'weekly_already_claimed' }));
            return;
          }
          recordWeeklyDrop(myPubkey);
          publishWeeklyMarker(myPubkey);
        } else {
          // Scene drops must come from the right room
          const category = getCategoryFromId(itemId);
          const allowedRooms = ITEM_ROOM_WHITELIST[category] ?? [];
          const playerRoom = player.room.startsWith('myroom:') ? 'myroom' : player.room;
          if (!allowedRooms.includes(playerRoom)) {
            ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'wrong_room', itemId, room: player.room }));
            return;
          }
          // Scavenges can ONLY come from the server-rolled scavenge_request in
          // prod — a client-supplied "I found X" let scripts pick legendaries.
          // Allowed in local dev (no prod oracle key) for test-minting.
          if (acquiredFrom === 'found') {
            if (FISHING_LIMIT_ACTIVE) {
              ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'server_rolls_scavenge', itemId }));
              return;
            }
            if (!canScavenge(myPubkey)) {
              ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'scavenge_cooldown', itemId }));
              return;
            }
            recordScavenge(myPubkey);
          }
          // Fish can ONLY come from the server-rolled fish_catch_request in prod —
          // a client-supplied "I caught X" is exactly the forgery we're preventing.
          // Allowed in local dev (no prod oracle key) so /devset test-minting works.
          if (acquiredFrom === 'caught' && FISHING_LIMIT_ACTIVE) {
            ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'server_rolls_fish', itemId }));
            return;
          }
        }

        const event = mintItem(myPubkey, itemId, acquiredFrom);
        if (!event) {
          ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'oracle_unavailable' }));
          return;
        }

        console.log(`[Oracle] Minted ${itemId} for ${player.name} (${myPubkey.slice(0,8)}…)`);
        publishToRelays(event);  // server publishes directly — no client relay dependency
        ws.send(JSON.stringify({ type: 'item_minted', event }));

        })().catch(() => {}); // async for the weekly relay-marker check
        return;
      }

      // ── Scavenge: server-rolled find ──────────────────────────────────────
      // Client says only "I collected a spot" (+ whether it was a holiday spot);
      // the server rolls the tier + item from the room's pool and mints it.
      if (msg.type === 'scavenge_request' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;
        const holiday = !!msg.holiday;
        const pool = holiday
          ? activeHolidayPool()                                 // only during a live holiday window
          : (SCAV_SCENE_POOLS[player.room] ?? null);            // room must have a scavenge pool
        if (!pool) {
          ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'wrong_room', room: player.room }));
          return;
        }
        if (!canScavenge(myPubkey)) {
          ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'scavenge_cooldown' }));
          return;
        }
        recordScavenge(myPubkey);
        const itemId = rollScavenge(pool, holiday);
        const event = itemId ? mintItem(myPubkey, itemId, 'found') : null;
        if (!event) {
          ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'oracle_unavailable' }));
          return;
        }
        console.log(`[Oracle] Scavenged ${itemId} (${ITEM_RARITY.get(itemId!) ?? '?'}) for ${player.name} (${myPubkey.slice(0,8)}…)`);
        publishToRelays(event);
        ws.send(JSON.stringify({ type: 'item_minted', event }));
        return;
      }

      // ── Fishing: server-rolled catch ──────────────────────────────────────
      // Client says only "I reeled in" — the server decides what (if anything)
      // was caught and mints it. See FISH_TIERS / rollFishCatch above.
      if (msg.type === 'fish_catch_request' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;
        if (player.room !== 'woods') {
          ws.send(JSON.stringify({ type: 'fish_caught', escaped: true }));
          return;
        }
        if (!canFish(myPubkey)) {
          // Over the reel rate (only scripts can get here) — the fish "gets away".
          ws.send(JSON.stringify({ type: 'fish_caught', escaped: true }));
          return;
        }
        recordFish(myPubkey);
        const { itemId, tier, kept } = rollFishCatch();
        let event: any = null;
        if (kept) {
          event = mintItem(myPubkey, itemId, 'caught');
          if (event) publishToRelays(event);
          if (event) console.log(`[Oracle] Fish kept: ${itemId} (${tier}) for ${player.name} (${myPubkey.slice(0,8)}…)`);
        }
        if (tier === 'legendary') {
          console.log(`[Fishing] LEGENDARY ${itemId} caught by ${player.name}`);
          recordLegendaryCatch(myPubkey, itemId).catch(() => {}); // oracle logs the catch — no player signature needed
        }
        ws.send(JSON.stringify({ type: 'fish_caught', itemId, tier, kept: !!(kept && event), event }));
        return;
      }

      // ── Bounty board: list this week's bounties ────────────────────────────
      if (msg.type === 'bounty_list_request' && myPubkey) {
        const me = myPubkey;
        (async () => {
          const bounties = getWeekBounties();
          const out = [];
          for (const b of bounties) {
            const claims = await loadBountyClaims(b.id);
            out.push({
              id: b.id, wants: b.wants, rewardItemId: b.rewardItemId, tier: b.tier, endsAt: b.endsAt,
              holiday: !!b.holiday,
              claimed: claims.length,
              claimedByMe: claims.includes(me),
            });
          }
          ws.send(JSON.stringify({ type: 'bounty_list', bounties: out }));
        })().catch(() => ws.send(JSON.stringify({ type: 'bounty_list', bounties: [] })));
        return;
      }

      // ── Bounty board: turn in items, burn them, mint the reward ───────────
      if (msg.type === 'bounty_claim_request' && myPubkey) {
        const me = myPubkey;
        const bountyId = typeof msg.bountyId === 'string' ? msg.bountyId : '';
        const instanceIds: string[] = Array.isArray(msg.instanceIds)
          ? [...new Set(msg.instanceIds.filter((x: unknown) => typeof x === 'string'))] : [];
        const fail = (reason: string) => ws.send(JSON.stringify({ type: 'bounty_claim_error', bountyId, reason }));
        const bounty = getWeekBounties().find(b => b.id === bountyId);
        if (!bounty) { fail('expired'); return; } // last week's board, or forged id
        // In-flight lock: the already_claimed check below involves a relay fetch,
        // so two PARALLEL claims from one account could both pass it and double-mint.
        // The UI can't do this (button disables) — this stops scripted clients.
        const flightKey = `${bountyId}|${me}`;
        if (bountyClaimsInFlight.has(flightKey)) { fail('already_claimed'); return; }
        bountyClaimsInFlight.add(flightKey);
        (async () => {
          const claims = await loadBountyClaims(bountyId);
          if (claims.includes(me)) { fail('already_claimed'); return; }

          // Verify the submitted instances cover the wants multiset, each one
          // authoritative from relays (oracle-signed, owned by claimant, unburned).
          const needed: Record<string, number> = {};
          for (const w of bounty.wants) needed[w.itemId] = w.qty;
          const totalNeeded = bounty.wants.reduce((s, w) => s + w.qty, 0);
          if (instanceIds.length !== totalNeeded) { fail('wrong_items'); return; }
          const verified: any[] = [];
          for (const instanceId of instanceIds) {
            const ev = await fetchOwnedItem(instanceId, me);
            const itemId = ev?.tags?.find((t: string[]) => t[0] === 'item_id')?.[1];
            if (!ev || !itemId || !(needed[itemId] > 0)) { fail('wrong_items'); return; }
            needed[itemId]--;
            verified.push(ev);
          }

          // All inputs check out → burn them, mint the posted reward, record.
          for (const ev of verified) burnItem(ev);
          const reward = mintItem(me, bounty.rewardItemId, 'bounty');
          if (!reward) { fail('mint_failed'); return; }
          publishToRelays(reward);
          recordBountyClaim(bountyId, me);
          const claimedNow = (bountyClaims[bountyId] ?? []).length;
          console.log(`[Bounty] ${bountyId} claimed by ${me.slice(0,8)}… (${claimedNow} total) — burned ${instanceIds.length}, minted ${bounty.rewardItemId}`);
          ws.send(JSON.stringify({
            type: 'bounty_claimed', bountyId, event: reward,
            burned: instanceIds, claimed: claimedNow,
          }));
        })().catch(() => fail('claim_failed')).finally(() => bountyClaimsInFlight.delete(flightKey));
        return;
      }

      // ── Item discard (replaceable-event tombstone) ────────────────────────
      // kind:30078 is addressable (keyed by kind:pubkey:d-tag). We re-publish the
      // same d-tag WITHOUT the owner's p tag, so the relay replaces the old event
      // and the owner's filtered query (#p) no longer matches it. Reliable even on
      // relays that ignore NIP-09 deletions.
      if (msg.type === 'item_discard_request' && myPubkey) {
        if (!ORACLE_SK) return;
        const ev = msg.event;
        const ownerTag = ev?.tags?.find((t: string[]) => t[0] === 'p')?.[1];
        const dTag     = ev?.tags?.find((t: string[]) => t[0] === 'd')?.[1];
        if (!dTag || !isOracleKey(ev.pubkey) || ownerTag !== myPubkey) {
          ws.send(JSON.stringify({ type: 'item_discard_error', reason: 'not_owner' }));
          return;
        }
        // Tombstone: same d-tag, KEEPS p + t so the owner's query still returns it,
        // adds a 'burned' marker + newer created_at. The client dedupes by d-tag
        // (newest wins) and filters burned — so only ONE relay needs this event.
        const tombstone = finalizeEvent({
          kind: 30078,
          pubkey: ORACLE_PUBKEY,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['d', dTag], ['p', myPubkey], ['t', 'nditem'], ['burned', '1']],
          content: '',
        }, ORACLE_SK);
        publishToRelays(tombstone);
        recordBurned(dTag);
        console.log(`[Oracle] Burned item ${dTag} for ${myPubkey.slice(0,8)}…`);
        ws.send(JSON.stringify({ type: 'item_discarded', eventId: ev.id }));
        return;
      }

      // ── Item gift (oracle transfer to another player) ─────────────────────
      if (msg.type === 'item_gift_request' && myPubkey) {
        const giver = myPubkey;
        const instanceId = msg.event?.tags?.find((t: string[]) => t[0] === 'd')?.[1];
        (async () => {
          // Authoritative: fetch the current event from relays — never trust the
          // client-supplied event (forgeable) — then transfer that.
          const real = await fetchOwnedItem(instanceId, giver);
          const newEvent = real ? transferItem(real, giver, msg.toPubkey) : null;
          if (!newEvent) {
            ws.send(JSON.stringify({ type: 'item_transfer_error', reason: 'invalid' }));
            return;
          }
          publishToRelays(newEvent);
          console.log(`[Oracle] Gift ${giver.slice(0,8)}… → ${String(msg.toPubkey).slice(0,8)}…`);
          ws.send(JSON.stringify({ type: 'item_transferred', oldEventId: real.id }));
          const giverName = players.get(giver)?.name || 'Someone';
          const giftName  = (typeof msg.itemName === 'string' && msg.itemName) ? msg.itemName.slice(0, 80) : 'an item';
          // Live notify recipient if online — include the event so it lands in their
          // inventory immediately instead of waiting for a relay refetch.
          const recip = players.get(msg.toPubkey);
          if (recip?.ws.readyState === WebSocket.OPEN) {
            recip.ws.send(JSON.stringify({ type: 'item_received', fromName: giverName, event: newEvent }));
          }
          // DM the recipient too — gives a push (Damus/iOS) even if they're offline.
          dmFromOracle(msg.toPubkey, `🎁 ${giverName} sent you ${giftName} as a gift in Nostr District! Open the app to find it in your bazaar.`);
        })().catch(() => ws.send(JSON.stringify({ type: 'item_transfer_error', reason: 'invalid' })));
        return;
      }

      // ── Item swap (atomic two-way trade via oracle) ───────────────────────
      if (msg.type === 'item_swap_request' && myPubkey) {
        const me = myPubkey;
        const theirPubkey = msg.theirPubkey;
        const myInst    = msg.myEvent?.tags?.find((t: string[]) => t[0] === 'd')?.[1];
        const theirInst = msg.theirEvent?.tags?.find((t: string[]) => t[0] === 'd')?.[1];
        (async () => {
          // Authoritative ownership for BOTH sides — fetched from relays, not the
          // client. Confirms each party really owns their item right now.
          const [mineReal, theirsReal] = await Promise.all([
            fetchOwnedItem(myInst, me),
            fetchOwnedItem(theirInst, theirPubkey),
          ]);
          const toThem = mineReal   ? transferItem(mineReal, me, theirPubkey) : null;
          const toMe   = theirsReal ? transferItem(theirsReal, theirPubkey, me) : null;
          if (!toThem || !toMe) {
            ws.send(JSON.stringify({ type: 'item_transfer_error', reason: 'swap_failed' }));
            return;
          }
          publishToRelays(toThem);
          publishToRelays(toMe);
          console.log(`[Oracle] Swap ${me.slice(0,8)}… ⇄ ${String(theirPubkey).slice(0,8)}…`);
          // Requester (acceptor) gets the item they received added instantly
          ws.send(JSON.stringify({ type: 'item_swapped', oldEventId: mineReal.id }));
          ws.send(JSON.stringify({ type: 'item_minted', event: toMe }));
          // Offerer gets their swapped-in item added instantly too
          const other = players.get(theirPubkey);
          if (other?.ws.readyState === WebSocket.OPEN) {
            other.ws.send(JSON.stringify({ type: 'item_received', fromName: players.get(me)?.name || '', oldEventId: theirsReal.id, event: toThem }));
          }
        })().catch(() => ws.send(JSON.stringify({ type: 'item_transfer_error', reason: 'swap_failed' })));
        return;
      }

      // ── List: escrow the item to the oracle ───────────────────────────────
      // The seller's item is re-owned by the oracle (held safely) so it can't be
      // spent while listed and can be released to a buyer even if the seller is
      // offline. Requires the seller's Lightning address to support LNURL verify.
      if (msg.type === 'item_escrow_request' && myPubkey) {
        const seller     = myPubkey;
        const instanceId = typeof msg.instanceId === 'string' ? msg.instanceId : '';
        const price      = Math.floor(Number(msg.price));
        const lud16      = typeof msg.lud16 === 'string' ? msg.lud16 : '';
        const itemName   = typeof msg.itemName === 'string' ? msg.itemName : '';
        const fail = (reason: string) => ws.send(JSON.stringify({ type: 'item_escrow_error', instanceId, reason }));
        if (!instanceId || !(price >= 1)) { fail('bad_request'); return; }
        if (!lud16) { fail('no_lightning_address'); return; }
        (async () => {
          // 1. The seller must actually own the item right now
          const owned = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': [seller], '#t': ['nditem'] }));
          const ev = owned.get(instanceId);
          if (!ev || isBurned(ev)) { fail('not_owned'); return; }
          // 2. Their wallet must support LNURL verify (needed to confirm offline sales)
          const probe = await lnurlGetInvoice(lud16, price);
          if (!probe) { fail('lightning_unreachable'); return; }
          if (!probe.verify) { fail('no_verify_support'); return; }
          // 3. Escrow it to the oracle
          const escrow = escrowItem(ev, seller, price, lud16, itemName);
          if (!escrow) { fail('escrow_failed'); return; }
          publishToRelays(escrow);
          console.log(`[Oracle] Escrowed ${instanceId} from ${seller.slice(0,8)}… @ ${price} sats`);
          ws.send(JSON.stringify({ type: 'item_escrowed', instanceId }));
        })().catch(() => fail('escrow_failed'));
        return;
      }

      // ── Delist: return an escrowed item to its seller ─────────────────────
      if (msg.type === 'item_unescrow_request' && myPubkey) {
        const seller     = myPubkey;
        const instanceId = typeof msg.instanceId === 'string' ? msg.instanceId : '';
        const fail = (reason: string) => ws.send(JSON.stringify({ type: 'item_unescrow_error', instanceId, reason }));
        if (!instanceId) { fail('bad_request'); return; }
        if (soldInstances.has(instanceId)) { fail('already_sold'); return; }
        (async () => {
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }));
          const ev = held.get(instanceId);
          if (!ev || isBurned(ev)) { fail('not_escrowed'); return; }
          if (tagVal(ev, 'escrow_seller') !== seller) { fail('not_your_listing'); return; }
          const returned = transferItem(ev, ORACLE_PUBKEY, seller);
          if (!returned) { fail('return_failed'); return; }
          publishToRelays(returned);
          // If a winner had been accepted but not yet paid, clear their win marker
          const pendingWinner = tagVal(ev, 'awaiting_winner');
          if (pendingWinner) { clearWinMarker(instanceId, pendingWinner); setReservedForWinner(instanceId, false); }
          console.log(`[Oracle] Returned ${instanceId} to ${seller.slice(0,8)}…`);
          ws.send(JSON.stringify({ type: 'item_unescrowed', instanceId }));
          // Add the returned item back to the seller's inventory immediately
          ws.send(JSON.stringify({ type: 'item_minted', event: returned }));
        })().catch(() => fail('return_failed'));
        return;
      }

      // ── Buy: request an invoice, verify payment, then release the escrow ───
      // The oracle fetches an invoice from the SELLER's Lightning address (funds go
      // straight to the seller — no custody), hands the bolt11 to the buyer, then
      // polls LNURL verify. Only once the invoice is settled does it release the
      // escrowed item to the buyer. Spoof-proof: no item without confirmed payment.
      if (msg.type === 'item_purchase_init' && myPubkey) {
        const buyer      = myPubkey;
        const instanceId = typeof msg.instanceId === 'string' ? msg.instanceId : '';
        const fail = (reason: string) => ws.send(JSON.stringify({ type: 'item_purchase_error', instanceId, reason }));
        if (!instanceId) { fail('bad_request'); return; }
        if (soldInstances.has(instanceId)) { fail('already_sold'); return; }
        if (isReserved(instanceId)) { fail('reserved'); return; }
        (async () => {
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }));
          const ev = held.get(instanceId);
          if (!ev || isBurned(ev)) { fail('item_gone'); return; }
          const seller  = tagVal(ev, 'escrow_seller');
          const lud16   = tagVal(ev, 'escrow_lud16');
          const winner  = tagVal(ev, 'awaiting_winner');
          if (!seller || !lud16) { fail('not_listed'); return; }
          if (seller === buyer) { fail('own_listing'); return; }
          // If a bid was accepted, only that winner may buy — at the bid price.
          let price: number;
          if (winner) {
            if (winner !== buyer) { fail('reserved_for_winner'); return; }
            price = Math.floor(Number(tagVal(ev, 'winning_price') ?? '0'));
          } else {
            price = Math.floor(Number(tagVal(ev, 'escrow_price') ?? '0'));
          }
          if (!(price >= 1)) { fail('not_listed'); return; }
          // Sale memo rides on the payment (LNURL comment) so the seller sees what
          // sold + to whom on the incoming zap — no separate DM needed.
          const itemName = tagVal(ev, 'escrow_name') ?? tagVal(ev, 'item_id') ?? 'item';
          // Neutral memo so it reads sensibly in BOTH wallets (buyer's outgoing +
          // seller's incoming payment record).
          const memo = `Nostr District market: ${itemName} (${price} sats)`;
          const inv = await lnurlGetInvoice(lud16, price, memo);
          if (!inv || !inv.verify) { fail('invoice_failed'); return; }
          reserve(instanceId);
          ws.send(JSON.stringify({ type: 'purchase_invoice', instanceId, bolt11: inv.bolt11, price }));
          pollAndRelease(instanceId, buyer, ws, inv.verify);
        })().catch(() => fail('init_failed'));
        return;
      }

      // ── Accept a (relay-published) bid ────────────────────────────────────
      // Bids are signed Nostr events by the bidder. On accept, the oracle reads the
      // bidder's signed bid (so the amount is theirs, not the seller's claim), stamps
      // the escrow so only that bidder can buy (at the bid price), and publishes a
      // durable "you won" marker addressed to them. The bidder does NOT need to be
      // online — they get prompted to pay whenever they next come online.
      if (msg.type === 'accept_bid' && myPubkey) {
        const seller     = myPubkey;
        const instanceId = typeof msg.instanceId === 'string' ? msg.instanceId : '';
        const winner     = typeof msg.buyer === 'string' ? msg.buyer : '';
        const fail = (reason: string) => ws.send(JSON.stringify({ type: 'accept_bid_error', instanceId, reason }));
        if (!instanceId || !winner) { fail('bad_request'); return; }
        if (soldInstances.has(instanceId)) { fail('already_sold'); return; }
        if (isReserved(instanceId)) { fail('reserved'); return; }
        (async () => {
          // Verify the seller owns the escrowed listing
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }));
          const ev = held.get(instanceId);
          if (!ev || isBurned(ev)) { fail('item_gone'); return; }
          if (tagVal(ev, 'escrow_seller') !== seller) { fail('not_your_listing'); return; }
          // Already accepted a bid on this item — don't accept a second one.
          if (tagVal(ev, 'awaiting_winner')) { fail('already_accepted'); return; }
          // Read the winner's signed bid off the relays → trustworthy amount
          const bidsByAuthor = newestPerD(await queryRelays({ kinds: [30078], authors: [winner], '#t': ['ndbid'] }));
          const bidEv = bidsByAuthor.get(instanceId);
          if (!bidEv || tagVal(bidEv, 'withdrawn')) { fail('no_such_bid'); return; }
          const amount = Math.floor(Number(tagVal(bidEv, 'amount') ?? '0'));
          if (!(amount >= 1)) { fail('no_such_bid'); return; }
          const itemId = tagVal(ev, 'item_id') ?? '';
          // Stamp the escrow so only this winner can buy (at the bid price)
          const stamped = restampEscrow(ev, winner, amount);
          if (!stamped) { fail('accept_failed'); return; }
          publishToRelays(stamped);
          publishWinMarker(instanceId, itemId, winner, amount);
          setReservedForWinner(instanceId, true); // hide BUY/BID for everyone else
          // DM the winner so they get a push notification in their Nostr client
          const itemName = typeof msg.itemName === 'string' && msg.itemName ? msg.itemName.slice(0, 60) : 'an item';
          dmFromOracle(winner, `🏆 You won the auction for ${itemName} on Nostr District for ${amount} sats! Open the app to pay and claim it.`);
          console.log(`[Bids] ${seller.slice(0,8)}… accepted ${winner.slice(0,8)}…'s ${amount}-sat bid on ${instanceId}`);
          ws.send(JSON.stringify({ type: 'bid_accept_ok', instanceId, buyer: winner, amount }));
        })().catch(() => fail('accept_failed'));
        return;
      }

      // ── Winner declines a won bid ─────────────────────────────────────────
      // The accepted bidder decided not to pay. Clear the winner stamp + their win
      // marker so the item returns to the open market for everyone else.
      if (msg.type === 'decline_win' && myPubkey) {
        const caller     = myPubkey;
        const instanceId = typeof msg.instanceId === 'string' ? msg.instanceId : '';
        const fail = (reason: string) => ws.send(JSON.stringify({ type: 'decline_win_error', instanceId, reason }));
        if (!instanceId) { fail('bad_request'); return; }
        (async () => {
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }));
          const ev = held.get(instanceId);
          if (!ev || isBurned(ev)) { fail('item_gone'); return; }
          if (tagVal(ev, 'awaiting_winner') !== caller) { fail('not_winner'); return; }
          const cleared = restampEscrow(ev, null, 0); // drop the winner stamp
          if (!cleared) { fail('decline_failed'); return; }
          publishToRelays(cleared);
          clearWinMarker(instanceId, caller);
          setReservedForWinner(instanceId, false); // re-open BUY/BID to everyone
          console.log(`[Bids] ${caller.slice(0,8)}… declined win on ${instanceId} — item re-opened`);
          ws.send(JSON.stringify({ type: 'win_declined', instanceId }));
        })().catch(() => fail('decline_failed'));
        return;
      }

      if (msg.type === 'game_msg' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;
        const out = JSON.stringify({ ...msg, pubkey: myPubkey });
        for (const [, p] of players) {
          if (p.room === player.room && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(out);
          }
        }
      }

    } catch (e) {}
  });

  ws.on('close', () => {
    if (myPubkey) {
      const player = players.get(myPubkey);

      // If a newer connection already took over this pubkey, don't touch their entry
      if (player && player.ws !== ws) return;

      console.log(`[Presence] ${player?.name} left (${players.size - 1} online)`);

      if (player && player.room === `myroom:${myPubkey}`) {
        players.forEach((p, key) => {
          if (key !== myPubkey && p.room === player.room && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({ type: 'room_kick', reason: 'Owner disconnected' }));
          }
        });
      }

      if (player) {
        const wasInLounge = player.room === 'lounge';
        broadcastToRoom(player.room, { type: 'leave', pubkey: myPubkey }, null);
        if (wasInLounge) {
          (player as any).loungeListening = null;
          broadcastLoungeListeners();
        }
      }
      players.delete(myPubkey);
      broadcastCount();
    }
  });
});

function broadcastToRoom(room: string, msg: any, excludePubkey: string | null) {
  const data = JSON.stringify(msg);
  players.forEach((p, key) => {
    if (key !== excludePubkey && p.room === room && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

function broadcastAll(msg: any, excludePubkey: string | null) {
  const data = JSON.stringify(msg);
  players.forEach((p, key) => {
    if (key !== excludePubkey && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

function broadcastCount() {
  const count = players.size;
  const data = JSON.stringify({ type: 'count', count });
  players.forEach((p) => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

/**
 * Push the current map of (pubkey → streamKey) for everyone in the Lounge
 * to every Lounge visitor, so each client can render listener counts next
 * to streams in its picker. Sent on lounge_listening_update and whenever a
 * Lounge visitor leaves the room or disconnects.
 */
function broadcastLoungeListeners() {
  const listeners: Record<string, string> = {};
  players.forEach((p) => {
    if (p.room === 'lounge' && (p as any).loungeListening) {
      listeners[p.pubkey] = (p as any).loungeListening;
    }
  });
  const data = JSON.stringify({ type: 'lounge_listeners', listeners });
  players.forEach((p) => {
    if (p.room === 'lounge' && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}
