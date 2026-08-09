import { WebSocketServer, WebSocket } from 'ws';
import { webcrypto } from 'crypto';
if (!globalThis.crypto) (globalThis as any).crypto = webcrypto;

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { promises as dns } from 'node:dns';
import { finalizeEvent, getPublicKey, generateSecretKey, getEventHash, verifyEvent, nip44 } from 'nostr-tools';
import { invoiceMatchesAmount } from './src/utils/bolt11';

const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));
const bytesToHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

// Broad set so items + tombstones land widely — any browser reaches several.
// MUST stay in sync with ITEM_QUERY_RELAYS in src/nostr/nostrService.ts
const PUBLISH_RELAYS = [
  'wss://nostr.thedistrict.online', // our own relay — canonical store for the item economy
  'wss://nos.lol',
  'wss://relay.primal.net',
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

// Losing ORACLE_PRIVATE_KEY in production used to silently drop the server into
// the keyless dev sandbox: a fresh generated key, an in-memory relay, and a
// scavenge path happy to mint anything. Production must fail loudly instead.
// Railway sets NODE_ENV=production; ND_ALLOW_SANDBOX is the deliberate override
// for anyone who really does want a keyless run there.
if (!process.env.ORACLE_PRIVATE_KEY && process.env.NODE_ENV === 'production' && !process.env.ND_ALLOW_SANDBOX) {
  console.error('[Oracle] FATAL: ORACLE_PRIVATE_KEY is not set in a production environment.');
  console.error('[Oracle] Refusing to start in keyless sandbox mode — the economy would run on a throwaway key.');
  console.error('[Oracle] Set ORACLE_PRIVATE_KEY, or set ND_ALLOW_SANDBOX=1 if a sandbox really is intended here.');
  process.exit(1);
}

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
    for (const ev of verifiedOracleEvents(events)) if (ev.created_at > newest) newest = ev.created_at;
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
// farm the loop. Token bucket: burst up to the MAX simultaneous spots, refill 1 per
// 5 min. Capacity 5 covers a holiday stack (3 base + 2 holiday) so a returning
// player can always clear a full stack in one go; the REFILL (1/5min ≈ 12/hr) is the
// real sustained ceiling and is unchanged, so the weekly faucet doesn't move — a
// cheater still can't beat ~12/hr sustained. Per-account, survives restarts + syncs.
const SCAVENGE_FILE = '.scavenge-buckets.json';
const SCAVENGE_CAPACITY = 5;
const SCAVENGE_REFILL_MS = 5 * 60 * 1000;
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
    const ev = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#d': [`ndfishrec_${pubkey}`] }), ORACLE_AUTHORS).get(`ndfishrec_${pubkey}`);
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
  await loadFishRecord(pubkey);
  // Build ACCURATE entries from the legendary fish the player still owns: the real
  // fish name + its mint timestamp (= when it was caught), not a generic placeholder.
  const owned = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': [pubkey], '#t': ['nditem'] }), ORACLE_AUTHORS);
  const caught: { name: string; kg: string; ts: number }[] = [];
  for (const ev of owned.values()) {
    if (isBurned(ev)) continue;
    const meta = LEGENDARY_FISH_META[tagVal(ev, 'item_id') ?? ''];
    if (tagVal(ev, 'source') === 'caught' && meta) {
      caught.push({ name: meta.name, kg: meta.kg, ts: ev.created_at ?? Math.floor(Date.now() / 1000) });
    }
  }
  // Overwrite only when this is at least as full as the stored record — upgrades
  // generic placeholders to real names/dates without ever shrinking a record that
  // holds catches already traded away (those aren't in `owned` anymore).
  const have = fishRecords[pubkey]?.length ?? 0;
  if (!caught.length || caught.length < have) return;
  caught.sort((a, b) => a.ts - b.ts);
  fishRecords[pubkey] = caught;
  try { writeFileSync(FISH_REC_FILE, JSON.stringify(fishRecords)); } catch {}
  publishFishRecord(pubkey);
  console.log(`[Fishing] Backfilled ${caught.length} legendary catch(es) for ${name} (${pubkey.slice(0, 8)}…)`);
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
// The oracle posts wants: burn N commons/junk → mint one rare. This is the
// economy's item SINK (commons leave circulation) and a reward channel — ONE claim
// per account per bounty. The price of a claim is real (your own items are
// destroyed), and the reward tier is capped at rare — rares already drop from
// scavenging, so this adds no new scarcity class to farm.
//
// The 3 regular bounties are PER-NPUB: deterministic from (period, pubkey), so each
// player gets their own board (no two residents race for the same Pizza Receipt),
// refreshing every 4 days. The festive holiday posters are ALSO per-npub (seeded by
// holiday+year+pubkey), hanging the whole window. Deterministic ⇒ the server needs no storage for the board itself;
// only CLAIMS persist: warm cache in memory/file + a durable oracle-signed relay
// marker per bounty (d-tag `ndbounty_<bountyId>`, the bountyId now carrying the
// pubkey so per-player claims never collide) — the same pattern as the weekly drop.

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
  // Expansion commons (sink for the +50 items)
  'fish_reed_perch','fish_glass_minnow',
  'hw_trackball','hw_vacuum_tube',
  'st_pawn_ticket','st_numbers_slip',
  'oc_salt_circle','oc_the_moon','oc_pendulum',
  'cr_fire_squirrel','cr_subway_possum','cr_alley_roach',
  'eats_vending_sandwich','eats_street_skewer','eats_cold_brew',
  'fl_glowcap','fl_fox_fern','fl_nettle_sprig','fl_pinecone',
  'rl_cassette','rl_arcade_token','rl_floppy','rl_polaroid',
  'ce_stardust','ce_moonstone','ce_meteor_shard','ce_solar_glass',
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
  // Expansion rares (incl. the 5 demoted from legendary) — gives the new sets the
  // same weekly bounty faucet the old sets have. Fish rares stay fishing-only.
  'hw_logic_analyzer','hw_asic_miner',
  'st_getaway_key','st_kingpin_cigar',
  'hw_mainframe_core',
  'oc_the_devil','oc_cursed_doubloon','oc_eldritch_idol',
  'cr_gutter_crab','cr_moth_swarm','cr_sewer_gator',
  'eats_greasy_taco','eats_fortune_cookie',
  'fl_wild_honeycomb','fl_moonpetal','fl_mandrake','fl_elderwood_seed',
  'rl_vinyl','rl_cartridge','rl_crt_remote',
  'ce_blackhole_marble','ce_constellation_map','ce_comet_fragment',
];
// Legendary weeks: ~1 in 6 weeks (seeded) the third poster offers a specific
// legendary — but wants RARES burned, not commons, so each copy costs 3 rares
// (a sink ladder: commons→rare, rares→legendary). No lottery on normal claims:
// rare-tier bounties always pay exactly what the poster shows.
const BOUNTY_LEGENDARY_POOL = [
  'hw_quantum_key','st_zk_proof','st_kingpin_ledger',
  'lo_manifesto','lo_satoshi_email','oc_hanged_man','cr_night_owl',
  'hw_zero_day','st_dons_ring','lo_genesis_seed',
  'ce_fallen_star',      // Falling Sky capstone
  'eats_chefs_special',  // eats capstone (moved here from hardware's Mainframe Core)
  'rl_rotary_phone',     // Analog Era capstone
];
// The board refreshes every 4 DAYS (not weekly): faucet + sink both run ~1.75× faster,
// which fixes casual common-overflow and speeds casual completion. Uses its own period
// constant — MS_7D still drives the weekly item drop.
const BOUNTY_PERIOD_MS = 4 * 24 * 60 * 60 * 1000;
// ~1 in 10.5 periods keeps the legendary bounty at its original ~42-day cadence
// (4 days × 10.5 = 42) even though the board itself now turns over every 4 days.
const BOUNTY_LEGENDARY_WEEK_CHANCE = 1 / 10.5; // seeded; deterministic per period
const BOUNTY_COUNT = 3;       // bounties per period

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

// A bounty is satisfied EITHER by burning specific items (`wants`, used by the
// themed holiday poster) OR by burning any N items of a rarity the player picks
// (`burnAny`, used by the regular + legendary posters — far easier than hunting
// specific items, and the player chooses what to feed it).
type ItemTier = 'common' | 'rare';
interface Bounty { id: string; wants: { itemId: string; qty: number }[]; burnAny?: { count: number; rarities: ItemTier[] }; rewardItemId: string; tier: 'rare' | 'legendary'; endsAt: number; holiday?: boolean }
// A poster can demand BOTH: specific items (`wants`) AND N more of the listed
// rarities the player freely picks (`burnAny`). Regular = 2 specific commons +
// 3 your-choice commons = 5 burned. Legendary = 4 specific rares to find + 6
// your-choice (commons OR rares) = 10 burned.
const BOUNTY_CHOICE_COMMON = 3; // free-pick commons on a regular poster (+2 specific = 5)
const BOUNTY_LEG_SPECIFIC  = 4; // specific rares to find on a legendary poster…
const BOUNTY_LEG_CHOICE    = 6; // …+ 6 more commons-or-rares you pick = 10 burned

// FNV-1a hash of a pubkey → 32-bit seed component, so each npub gets its own board.
function pkHash(pk: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < pk.length; i++) { h ^= pk.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function getWeekBounties(pubkey: string): Bounty[] {
  const period = Math.floor(Date.now() / BOUNTY_PERIOD_MS);
  // Per-npub board: the seed mixes the period with a hash of the pubkey, so every
  // player gets their OWN deterministic set of bounties each period (the regular 3).
  // No storage needed — identical for a given (period, npub) on any server instance.
  // The festive holiday posters below are ALSO per-npub (seeded by holiday+year+pubkey),
  // but hang the WHOLE window with per-player claims.
  const rng = mulberry32(((period * 2654435761) ^ pkHash(pubkey)) >>> 0);
  const pick = <T>(arr: T[], taken: Set<T>): T => {
    let v: T;
    do { v = arr[Math.floor(rng() * arr.length)]; } while (taken.has(v));
    taken.add(v);
    return v;
  };
  const usedRewards = new Set<string>();
  const bounties: Bounty[] = [];
  for (let n = 0; n < BOUNTY_COUNT; n++) {
    // 2 specific commons + ANY 3 commons of the player's choosing = 5 burned → a rare.
    // Still a 5-item sink, but most of it is "feed whatever commons you're sitting on,"
    // so it fires far more often than hunting 5 exact items.
    const usedWants = new Set<string>();
    bounties.push({
      id: `bounty_${period}_${pubkey}_${n}`,
      wants: [
        { itemId: pick(BOUNTY_WANT_POOL, usedWants), qty: 1 },
        { itemId: pick(BOUNTY_WANT_POOL, usedWants), qty: 1 },
      ],
      burnAny: { count: BOUNTY_CHOICE_COMMON, rarities: ['common'] },
      rewardItemId: pick(BOUNTY_REWARD_POOL, usedRewards),
      tier: 'rare',
      endsAt: (period + 1) * BOUNTY_PERIOD_MS,
    });
  }
  // Legendary period (seeded): the last poster becomes a big rares→legendary trade —
  // find 4 specific rares + burn 6 more commons-or-rares of your choice = 10. Same
  // id → same claims.
  if (rng() < BOUNTY_LEGENDARY_WEEK_CHANCE) {
    const usedWants = new Set<string>();
    const last = bounties[BOUNTY_COUNT - 1];
    last.wants = Array.from({ length: BOUNTY_LEG_SPECIFIC }, () => ({ itemId: pick(BOUNTY_REWARD_POOL, usedWants), qty: 1 }));
    last.burnAny = { count: BOUNTY_LEG_CHOICE, rarities: ['common', 'rare'] };
    last.rewardItemId = BOUNTY_LEGENDARY_POOL[Math.floor(rng() * BOUNTY_LEGENDARY_POOL.length)];
    last.tier = 'legendary';
  }

  // Festive board: a PER-NPUB set of holiday posters that hang the WHOLE window
  // (per-player claims — pubkey is in the id). Mirrors the regular board (specific
  // `wants` + free-pick `burnAny`) but trades holiday items for holiday rewards,
  // and shows BOTH a rare and a legendary poster — so the seasonal legendaries are
  // a real grind, not a 3-common freebie. Seeded by (holiday, year, pubkey):
  // unique per player, stable all window.
  const hol = activeHolidayDrop();
  if (hol) {
    const year = new Date().getFullYear();
    const endsAt = Date.UTC(year, hol.endMD[0] - 1, hol.endMD[1], 23, 59, 59);
    const hrng = mulberry32(((year * 7919) ^ pkHash(hol.id + pubkey)) >>> 0);
    const hpick = (arr: string[], taken: Set<string>): string => {
      let v: string, guard = 0;
      do { v = arr[Math.floor(hrng() * arr.length)]; } while (taken.has(v) && ++guard < 8);
      taken.add(v);
      return v;
    };
    const ofTier = (t: string) => hol.pool.filter(id => ITEM_RARITY.get(id) === t);
    const hCommon = ofTier('common'), hRare = ofTier('rare'), hLeg = ofTier('legendary');

    // Holiday RARE poster — find 2 specific holiday commons + burn 3 more commons → a holiday rare.
    if (hRare.length && hCommon.length) {
      const taken = new Set<string>();
      const wants = [{ itemId: hpick(hCommon, taken), qty: 1 }];
      if (hCommon.length > 1) wants.push({ itemId: hpick(hCommon, taken), qty: 1 });
      bounties.push({
        id: `bounty_hol_${hol.id}_${year}_${pubkey}_r`,
        wants,
        burnAny: { count: 3, rarities: ['common'] },
        rewardItemId: hRare[Math.floor(hrng() * hRare.length)],
        tier: 'rare', endsAt, holiday: true,
      });
    }

    // Holiday LEGENDARY poster — find 2 specific holiday rares + burn 6 more (commons/rares) → a holiday legendary.
    // Pools with no rares (or no commons) fall back to whatever lower tier exists.
    if (hLeg.length) {
      const taken = new Set<string>();
      const hunt = hRare.length ? hRare : hCommon; // the specific tier to track down
      const wants: { itemId: string; qty: number }[] = [];
      if (hunt.length > 1) {
        wants.push({ itemId: hpick(hunt, taken), qty: 1 }, { itemId: hpick(hunt, taken), qty: 1 });
      } else if (hunt.length === 1) {
        wants.push({ itemId: hunt[0], qty: 2 });
      } else {
        wants.push({ itemId: hol.pool[0], qty: 3 }); // last-ditch (shouldn't hit)
      }
      const burnRar: ItemTier[] = hCommon.length ? ['common', 'rare'] : ['rare'];
      bounties.push({
        id: `bounty_hol_${hol.id}_${year}_${pubkey}_l`,
        wants,
        burnAny: { count: 6, rarities: burnRar },
        rewardItemId: hLeg[Math.floor(hrng() * hLeg.length)],
        tier: 'legendary', endsAt, holiday: true,
      });
    }
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
      for (const ev of verifiedOracleEvents(events)) if (!newest || ev.created_at > newest.created_at) newest = ev;
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

function recordBountyClaim(bountyId: string, pubkey: string, expiresAtMs: number): void {
  const list = bountyClaims[bountyId] ?? (bountyClaims[bountyId] = []);
  if (!list.includes(pubkey)) list.push(pubkey);
  try { writeFileSync(BOUNTY_FILE, JSON.stringify(bountyClaims)); } catch {}
  if (!ORACLE_SK) return;
  // The marker is only read while the bounty is still claimable (past-period ids are
  // rejected before loadBountyClaims runs), so tag it to expire at the bounty's end
  // (+1d skew buffer). NIP-40-aware relays then drop it automatically — this is what
  // actually bounds the DURABLE store, since per-npub markers would otherwise pile up
  // forever (the local .bounty-claims.json is wiped on each redeploy anyway).
  const expirationSec = Math.floor(expiresAtMs / 1000) + 86400;
  publishToRelays(finalizeEvent({
    kind: 30078,
    pubkey: ORACLE_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', `ndbounty_${bountyId}`], ['t', 'ndbounty'], ['expiration', String(expirationSec)]],
    content: JSON.stringify(list),
  }, ORACLE_SK));
}

// Drop claim records for bounties whose period has already ended — they can never be
// claimed again (a fresh (period, npub) board has replaced them), so the record is dead
// weight. Per-npub boards make these accumulate ~3 per player per period; pruning keeps
// .bounty-claims.json bounded. Regular id = `bounty_<period>_<pubkey>_<n>`; festive id =
// `bounty_hol_<holidayId>_<year>` (pruned once its year is in the past).
function pruneBountyClaims(): void {
  const curPeriod = Math.floor(Date.now() / BOUNTY_PERIOD_MS);
  const curYear = new Date().getFullYear();
  let removed = 0;
  for (const id of Object.keys(bountyClaims)) {
    let dead = false;
    if (id.startsWith('bounty_hol_')) {
      const year = parseInt(id.slice(id.lastIndexOf('_') + 1), 10);
      dead = Number.isFinite(year) && year < curYear;
    } else {
      const period = parseInt(id.split('_')[1] ?? '', 10);
      dead = Number.isFinite(period) && period < curPeriod;
    }
    if (dead) { delete bountyClaims[id]; bountyMarkerFetched.delete(id); removed++; }
  }
  if (removed) {
    try { writeFileSync(BOUNTY_FILE, JSON.stringify(bountyClaims)); } catch {}
    console.log(`[Bounty] pruned ${removed} expired claim record(s)`);
  }
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
  { tier: 'legendary', p: 0.04 },
  { tier: 'rare',      p: 0.20 },
  { tier: 'common',    p: 0.76 },
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
    legendary: ['fish_ostrich','fish_golden_satoshi','fish_enchanted_trident','fish_coelacanth','fish_meteor','hw_quantum_key','st_zk_proof','st_kingpin_ledger','lo_manifesto','lo_satoshi_email','oc_hanged_man','cr_night_owl','hol_phantom_key','hol_reaper_coin','hol_liberty_coin','hol_eagle_feather','hol_signed_paper','hol_double_spend','hol_genesis_coin','hol_pizza_coin','hol_running_btc','hol_frost_coin','hol_first_note','hol_diamond_heart','hol_full_moon','hw_zero_day','st_dons_ring','lo_genesis_seed','ce_fallen_star','eats_chefs_special','rl_rotary_phone'],
    rare: ['fish_darkwater_bass','fish_luminous_eel','fish_crystal_perch','fish_ghost_pike','fish_midnight_sturgeon','fish_starscale_koi','fish_abyssal_anglerfish','fish_ancient_goldfish','fish_love_letter','hw_signal_relay','hw_encrypted_drive','hw_burner_pager','hw_rogue_dish','st_forged_id','st_contraband_pkg','st_skeleton_key','st_blackmarket_map','lo_genesis_fragment','lo_whitepaper_page','lo_block_plaque','lo_pow_relic','oc_the_fool','oc_scrying_mirror','cr_raccoon','cr_roost_bat','hol_jack_o_lantern','hol_witch_hat','hol_cauldron','hol_sparkler','hol_bottle_rocket','hol_satoshi_quill','hol_hashcash_stamp','hol_block_zero','hol_chancellor','hol_btc_pizza','hol_pepperoni','hol_rpow_token','hol_gift_box','hol_relay_stone','hol_zap_bolt','hol_cupids_arrow','hol_osmanthus','hol_jade_rabbit','hw_gpu_card','hw_oscilloscope','st_stash_key','st_wiretap','lo_pizza_receipt','lo_node_map','oc_voodoo_doll','oc_grimoire','cr_white_crow','cr_pipe_snake','eats_lucky_cat','eats_neon_sushi','eats_midnight_special','eats_greasy_taco','eats_fortune_cookie','oc_the_devil','oc_cursed_doubloon','cr_gutter_crab','cr_moth_swarm','st_getaway_key','hw_logic_analyzer','fl_wild_honeycomb','fl_moonpetal','fl_mandrake','rl_vinyl','rl_cartridge','rl_crt_remote','ce_blackhole_marble','ce_constellation_map','ce_comet_fragment','fish_aurora_lungfish','oc_eldritch_idol','cr_sewer_gator','hw_asic_miner','fl_elderwood_seed','hw_mainframe_core','st_kingpin_cigar'],
    common: ['fish_tiny_carp','fish_silver_trout','fish_moonfish','fish_bluegill','fish_mud_catfish','fish_speckled_sunfish','fish_lake_minnow','fish_striped_dace','fish_green_sunperch','fish_whiskered_loach','fish_spotted_rudd','fish_common_bream','fish_river_roach','fish_flathead_chub','fish_golden_shiner','fish_pumpkinseed','hw_data_chip','hw_circuit_board','hw_cooling_fan','hw_solder_iron','st_burner_phone','st_ghost_token','st_counterfeit_bill','st_lockpick_set','lo_satoshi_coin','lo_relay_key','lo_lightning_bolt','lo_seed_phrase','lo_node_badge','oc_black_candle','oc_evil_eye','cr_sewer_rat','cr_alley_cat','hol_candy_corn','hol_skull_candle','hol_black_cat','hol_firecracker','hol_flag_pin','hol_snowflake','hol_pine_sprig','hol_warm_mittens','hol_ostrich_egg','hol_purple_pill','hol_red_rose','hol_chocolate_box','hol_candy_heart','hol_mooncake','hol_paper_lantern','hol_pomelo','hw_ram_stick','hw_capacitor','hw_ribbon_cable','st_brass_knuckles','st_switchblade','st_burner_sim','lo_paper_wallet','lo_mempool_vial','lo_hash_stone','oc_spirit_board','oc_bone_dice','oc_the_tower','cr_street_pigeon','cr_gutter_frog','cr_junkyard_dog','eats_instant_ramen','eats_dumpling','eats_energy_drink','eats_cart_hotdog','eats_vending_sandwich','eats_street_skewer','eats_cold_brew','oc_salt_circle','oc_the_moon','oc_pendulum','cr_fire_squirrel','cr_subway_possum','cr_alley_roach','st_pawn_ticket','st_numbers_slip','hw_trackball','hw_vacuum_tube','fl_glowcap','fl_fox_fern','fl_nettle_sprig','fl_pinecone','rl_cassette','rl_arcade_token','rl_floppy','rl_polaroid','ce_stardust','ce_moonstone','ce_meteor_shard','ce_solar_glass','fish_reed_perch','fish_glass_minnow'],
    junk: ['fish_old_boot','fish_bottle_message','fish_rusty_tin_can','fish_waterlogged_hat','fish_tangled_line','fish_broken_lantern','eats_day_old_bagel'],
  };
  for (const [rarity, ids] of Object.entries(tiers)) for (const id of ids) ITEM_RARITY.set(id, rarity);
}

// Per-scene pools (must match SCENE_POOLS in tradeItemStore.ts)
const SCAV_SCENE_POOLS: Record<string, string[]> = {
  hub: ['eats_chefs_special','st_dons_ring','st_kingpin_ledger','st_zk_proof','eats_fortune_cookie','eats_greasy_taco','eats_lucky_cat','eats_midnight_special','eats_neon_sushi','rl_cartridge','rl_crt_remote','rl_rotary_phone','rl_vinyl','st_blackmarket_map','st_contraband_pkg','st_forged_id','st_getaway_key','st_kingpin_cigar','st_skeleton_key','st_stash_key','st_wiretap','eats_cart_hotdog','eats_cold_brew','eats_day_old_bagel','eats_dumpling','eats_energy_drink','eats_instant_ramen','eats_street_skewer','eats_vending_sandwich','rl_arcade_token','rl_cassette','rl_floppy','rl_polaroid','st_brass_knuckles','st_burner_phone','st_burner_sim','st_counterfeit_bill','st_ghost_token','st_lockpick_set','st_numbers_slip','st_pawn_ticket','st_switchblade','cr_night_owl','cr_gutter_crab','cr_moth_swarm','cr_raccoon','cr_roost_bat','cr_white_crow','cr_alley_cat','cr_fire_squirrel','cr_junkyard_dog','cr_sewer_rat','cr_street_pigeon'],
  alley: ['eats_chefs_special','hw_quantum_key','hw_zero_day','oc_hanged_man','st_dons_ring','st_kingpin_ledger','st_zk_proof','eats_fortune_cookie','eats_greasy_taco','eats_lucky_cat','eats_midnight_special','eats_neon_sushi','hw_asic_miner','hw_burner_pager','hw_encrypted_drive','hw_gpu_card','hw_logic_analyzer','hw_oscilloscope','hw_rogue_dish','hw_signal_relay','oc_cursed_doubloon','oc_eldritch_idol','oc_grimoire','oc_scrying_mirror','oc_the_devil','oc_the_fool','oc_voodoo_doll','st_blackmarket_map','st_contraband_pkg','st_forged_id','st_getaway_key','st_kingpin_cigar','st_skeleton_key','st_stash_key','st_wiretap','eats_cart_hotdog','eats_cold_brew','eats_day_old_bagel','eats_dumpling','eats_energy_drink','eats_instant_ramen','eats_street_skewer','eats_vending_sandwich','hw_capacitor','hw_data_chip','hw_ram_stick','hw_ribbon_cable','hw_solder_iron','hw_trackball','hw_vacuum_tube','oc_black_candle','oc_bone_dice','oc_evil_eye','oc_pendulum','oc_salt_circle','oc_spirit_board','oc_the_moon','oc_the_tower','st_brass_knuckles','st_burner_phone','st_burner_sim','st_counterfeit_bill','st_ghost_token','st_lockpick_set','st_numbers_slip','st_pawn_ticket','st_switchblade','lo_manifesto','lo_relay_key'],
  woods: ['ce_fallen_star','hw_quantum_key','hw_zero_day','ce_comet_fragment','fl_elderwood_seed','fl_moonpetal','fl_wild_honeycomb','hw_asic_miner','hw_burner_pager','hw_encrypted_drive','hw_gpu_card','hw_logic_analyzer','hw_mainframe_core','hw_oscilloscope','hw_rogue_dish','hw_signal_relay','ce_moonstone','ce_stardust','fl_glowcap','fl_pinecone','hw_capacitor','hw_circuit_board','hw_cooling_fan','hw_data_chip','hw_ram_stick','hw_ribbon_cable','hw_solder_iron','hw_trackball','hw_vacuum_tube','lo_genesis_seed','lo_manifesto','lo_satoshi_email','lo_genesis_fragment','lo_node_map','lo_pizza_receipt','lo_pow_relic','lo_whitepaper_page','lo_hash_stone','lo_mempool_vial','lo_paper_wallet','lo_relay_key','lo_satoshi_coin','lo_seed_phrase','cr_gutter_crab','cr_pipe_snake','cr_raccoon','cr_sewer_gator','cr_white_crow','cr_alley_cat','cr_alley_roach','cr_fire_squirrel','cr_gutter_frog','cr_sewer_rat','cr_street_pigeon','cr_subway_possum'],
  rooftop: ['hw_signal_relay','hw_encrypted_drive','hw_burner_pager','hw_rogue_dish','hw_solder_iron','hw_data_chip','lo_genesis_fragment','lo_whitepaper_page','lo_block_plaque','hw_quantum_key','hw_mainframe_core','cr_roost_bat','cr_night_owl','hw_ram_stick','hw_capacitor','hw_gpu_card','hw_oscilloscope','hw_zero_day'],
  cabin: ['ce_fallen_star','oc_hanged_man','ce_blackhole_marble','ce_constellation_map','fl_mandrake','fl_wild_honeycomb','oc_cursed_doubloon','oc_eldritch_idol','oc_grimoire','oc_scrying_mirror','oc_the_devil','oc_the_fool','oc_voodoo_doll','rl_vinyl','ce_meteor_shard','ce_solar_glass','fl_fox_fern','fl_nettle_sprig','oc_black_candle','oc_bone_dice','oc_evil_eye','oc_pendulum','oc_salt_circle','oc_spirit_board','oc_the_moon','oc_the_tower','lo_genesis_seed','lo_manifesto','lo_satoshi_email','lo_block_plaque','lo_genesis_fragment','lo_node_map','lo_pizza_receipt','lo_pow_relic','lo_whitepaper_page','lo_hash_stone','lo_lightning_bolt','lo_mempool_vial','lo_node_badge','lo_paper_wallet','lo_relay_key','lo_satoshi_coin','lo_seed_phrase','cr_night_owl','cr_moth_swarm','cr_pipe_snake','cr_roost_bat','cr_sewer_gator','cr_alley_cat','cr_alley_roach','cr_gutter_frog','cr_junkyard_dog','cr_sewer_rat','cr_subway_possum'],
};

// Holiday drop windows (must match HOLIDAY_DROPS in tradeItemStore.ts)
// `dates` (year-specific) takes priority over startMD/endMD for lunar/drifting holidays.
const SCAV_HOLIDAY_DROPS: { id: string; startMD: [number, number]; endMD: [number, number]; pool: string[]; dates?: { year: number; startMD: [number, number]; endMD: [number, number] }[] }[] = [
  { id: 'genesis',    startMD: [1, 1],   endMD: [1, 6],   pool: ['hol_block_zero', 'hol_chancellor', 'hol_genesis_coin'] },
  { id: 'finney',     startMD: [1, 9],   endMD: [1, 15],  pool: ['hol_rpow_token', 'hol_running_btc'] },
  { id: 'valentine',  startMD: [2, 8],   endMD: [2, 14],  pool: ['hol_red_rose', 'hol_chocolate_box', 'hol_candy_heart', 'hol_cupids_arrow', 'hol_diamond_heart'] },
  { id: 'pizza_day',  startMD: [5, 18],  endMD: [5, 25],  pool: ['hol_btc_pizza', 'hol_pepperoni', 'hol_pizza_coin'] },
  { id: 'july4',      startMD: [7, 1],   endMD: [7, 7],   pool: ['hol_sparkler', 'hol_flag_pin', 'hol_firecracker', 'hol_bottle_rocket', 'hol_liberty_coin', 'hol_eagle_feather'] },
  { id: 'mid_autumn', startMD: [9, 23],  endMD: [9, 26],  pool: ['hol_mooncake', 'hol_paper_lantern', 'hol_pomelo', 'hol_osmanthus', 'hol_jade_rabbit', 'hol_full_moon'],
    dates: [
      { year: 2025, startMD: [10, 4],  endMD: [10, 7] },
      { year: 2026, startMD: [9, 23],  endMD: [9, 26] },
      { year: 2027, startMD: [9, 13],  endMD: [9, 16] },
      { year: 2028, startMD: [10, 1],  endMD: [10, 4] },
      { year: 2029, startMD: [9, 20],  endMD: [9, 23] },
      { year: 2030, startMD: [9, 10],  endMD: [9, 13] },
      { year: 2031, startMD: [9, 29],  endMD: [10, 2] },
      { year: 2032, startMD: [9, 17],  endMD: [9, 20] },
    ] },
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
    if (h.dates) {
      // Lunar/drifting holiday: only match a window listed for the current year, and
      // return that year's resolved start/end so downstream (bounty endsAt) is correct.
      const w = h.dates.find(d => d.year === now.getFullYear());
      if (w && t >= w.startMD[0] * 100 + w.startMD[1] && t <= w.endMD[0] * 100 + w.endMD[1]) {
        return { id: h.id, startMD: w.startMD, endMD: w.endMD, pool: h.pool };
      }
      continue;
    }
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

// Each roll is independent, so the same item legitimately lands back-to-back a few
// percent of the time — which reads as a bug to players. Suppress immediate repeats
// for a given player by re-rolling (whole tier+item, so aggregate odds are unchanged)
// when the result matches their previous drop. In-memory + per-pubkey; resetting on
// restart is fine for an immediate-repeat guard. Skipped if the pool is effectively
// one item (the retry cap bounds it).
const lastScavengeItem: Record<string, string> = {};
function rollScavengeNoRepeat(pool: string[], holiday: boolean, pubkey: string): string | null {
  let itemId = rollScavenge(pool, holiday);
  for (let i = 0; i < 5 && itemId && itemId === lastScavengeItem[pubkey]; i++) {
    itemId = rollScavenge(pool, holiday);
  }
  if (itemId) lastScavengeItem[pubkey] = itemId;
  return itemId;
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
// After the reservation lapses we keep checking the invoice at a slow cadence up
// to this long, so a payment that lands late still delivers instead of vanishing.
const LATE_SWEEP_MS = 30 * 60_000; // 30 min
// A buyer can hold this many items at once. Reserving is free and locks an item
// for 5 minutes, so without a cap one client could loop the market and keep
// every listing permanently unbuyable.
const MAX_RESERVATIONS_PER_BUYER = 3;
const reservations = new Map<string, { expires: number; buyer: string; attempts: number }>();

function reservationFor(id: string): { expires: number; buyer: string; attempts: number } | null {
  const r = reservations.get(id);
  if (!r) return null;
  if (Date.now() > r.expires) { reservations.delete(id); return null; }
  return r;
}
function isReserved(id: string): boolean { return reservationFor(id) !== null; }

/**
 * Atomically claim an item for a buyer. MUST be called before any `await` in the
 * purchase path: the check and the claim used to be separated by a relay query
 * and an LNURL round-trip, so two buyers could both pass the check, both be
 * handed an invoice for the same item, and both pay — with only one getting it.
 * Returns false if someone else holds it or the buyer is at their cap.
 *
 * `attempts` counts the buyer's own in-flight inits: a duplicate purchase_init
 * from the same buyer re-enters here, and its abort must NOT free the slot while
 * the first attempt's invoice is still live (that re-opened the two-invoice race).
 */
function tryReserve(id: string, buyer: string): boolean {
  const held = reservationFor(id);
  if (held) {
    if (held.buyer !== buyer) return false;
    held.attempts++;
    return true;
  }
  let active = 0;
  for (const key of [...reservations.keys()]) {
    const r = reservationFor(key);
    if (r?.buyer === buyer) active++;
  }
  if (active >= MAX_RESERVATIONS_PER_BUYER) return false;
  reservations.set(id, { expires: Date.now() + RESERVE_MS, buyer, attempts: 1 });
  return true;
}

/** Release one attempt of a claim, but only the holder's own — never someone else's. */
function releaseReservation(id: string, buyer: string): void {
  const r = reservations.get(id);
  if (r?.buyer !== buyer) return;
  r.attempts--;
  if (r.attempts <= 0) reservations.delete(id);
}

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
  'hol_mooncake','hol_paper_lantern','hol_pomelo','hol_osmanthus','hol_jade_rabbit','hol_full_moon',
  'hol_satoshi_quill','hol_hashcash_stamp','hol_signed_paper','hol_double_spend',
  'hol_block_zero','hol_chancellor','hol_genesis_coin',
  'hol_btc_pizza','hol_pepperoni','hol_pizza_coin',
  'hol_rpow_token','hol_running_btc',
  'hol_snowflake','hol_pine_sprig','hol_warm_mittens','hol_gift_box','hol_frost_coin',
  'hol_ostrich_egg','hol_purple_pill','hol_relay_stone','hol_zap_bolt','hol_first_note',
  'hol_red_rose','hol_chocolate_box','hol_candy_heart','hol_cupids_arrow','hol_diamond_heart',
  // Evergreen expansion II (+50 across 5 deepened categories + Flora/Relics/Celestial) and +3 fish
  'fish_reed_perch','fish_glass_minnow','fish_aurora_lungfish',
  'hw_trackball','hw_vacuum_tube','hw_logic_analyzer','hw_asic_miner',
  'st_pawn_ticket','st_numbers_slip','st_getaway_key','st_kingpin_cigar',
  'oc_salt_circle','oc_the_moon','oc_pendulum','oc_the_devil','oc_cursed_doubloon','oc_eldritch_idol',
  'cr_fire_squirrel','cr_subway_possum','cr_alley_roach','cr_gutter_crab','cr_moth_swarm','cr_sewer_gator',
  'eats_vending_sandwich','eats_street_skewer','eats_cold_brew','eats_greasy_taco','eats_fortune_cookie','eats_chefs_special',
  'fl_glowcap','fl_fox_fern','fl_nettle_sprig','fl_pinecone','fl_wild_honeycomb','fl_moonpetal','fl_mandrake','fl_elderwood_seed',
  'rl_cassette','rl_arcade_token','rl_floppy','rl_polaroid','rl_vinyl','rl_cartridge','rl_crt_remote','rl_rotary_phone',
  'ce_stardust','ce_moonstone','ce_meteor_shard','ce_solar_glass','ce_blackhole_marble','ce_constellation_map','ce_comet_fragment','ce_fallen_star',
]);

// Valid rooms each item category can be minted from
const ITEM_ROOM_WHITELIST: Record<string, string[]> = {
  fish:     ['woods'],
  hardware: ['woods', 'alley', 'lounge', 'relay'],
  street:   ['alley', 'hub'],
  lore:     ['woods', 'alley', 'lounge', 'relay', 'cabin'],
  occult:   ['alley', 'cabin'],
  critters: ['hub', 'alley', 'woods', 'cabin', 'lounge'],
  eats:     ['hub', 'alley', 'lounge'], // street food — downtown
  flora:    ['woods', 'cabin'],   // forage in the woods
  relics:   ['hub', 'cabin'],     // analog junk
  celestial:['woods', 'cabin'],   // fallen from the sky
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
  if (itemId.startsWith('fl_'))    return 'flora';
  if (itemId.startsWith('rl_'))    return 'relics';
  if (itemId.startsWith('ce_'))    return 'celestial';
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
  const owned = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': [ownerPubkey], '#t': ['nditem'] }), ORACLE_AUTHORS);
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
// ── SSRF guard for seller-supplied Lightning addresses ───────────────────────
// Blocks the obvious internal targets. This is a filter on names, not a full
// SSRF defence — a public hostname can still resolve to a private address — but
// it stops the cheap version: listing `x@localhost` or `x@169.254.169.254` and
// pointing the oracle's outbound fetches at the host it runs on.
const PRIVATE_HOST_RE = new RegExp([
  '^localhost$', '\\.localhost$', '^.*\\.local$',
  '^127\\.', '^10\\.', '^192\\.168\\.', '^169\\.254\\.',
  '^172\\.(1[6-9]|2[0-9]|3[01])\\.',
  '^0\\.', '^\\[?::1\\]?$', '^\\[?f[cd]', // ipv6 loopback + unique-local
].join('|'), 'i');

function isPublicLnurlHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h || h.length > 253) return false;
  if (h.includes('/') || h.includes('@') || h.includes(':')) return false; // no port/path/userinfo smuggling
  if (!/^[a-z0-9.-]+$/.test(h)) return false;
  if (!h.includes('.')) return false;                                      // bare names are internal
  if (PRIVATE_HOST_RE.test(h)) return false;
  return true;
}

function isPublicLnurlUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:') return false;
    return isPublicLnurlHost(u.hostname);
  } catch { return false; }
}

// DNS-level SSRF check: the name filter above only looks at strings — a public
// hostname can still resolve to a private address. Resolve and reject those.
function isPrivateIp(ip: string): boolean {
  let a = ip.trim().toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);                    // v4-mapped v6
  if (PRIVATE_HOST_RE.test(a)) return true;                       // loopback/RFC1918/ULA/link-local v4
  if (a === '::' || a.startsWith('fe80:')) return true;           // v6 unspecified + link-local
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return true; // CGNAT 100.64.0.0/10
  return false;
}

async function resolvesToPublicIp(host: string): Promise<boolean> {
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    if (!addrs.length) return false;
    return addrs.every(a => !isPrivateIp(a.address));
  } catch { return false; }
}

// Fetch a seller-controlled URL with NO automatic redirects — every hop is
// re-validated (URL syntax + DNS) before being followed, so a public host that
// 302s to http://169.254.169.254 can't launder an internal request through us.
async function lnurlFetch(rawUrl: string): Promise<any | null> {
  let url = rawUrl;
  for (let hop = 0; hop <= 3; hop++) {
    if (!isPublicLnurlUrl(url)) return null;
    if (!await resolvesToPublicIp(new URL(url).hostname)) return null;
    const res = await fetch(url, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      url = new URL(loc, url).toString();
      continue;
    }
    try { return await res.json(); } catch { return null; }
  }
  return null;
}

async function lnurlGetInvoice(lud16: string, sats: number, comment?: string):
    Promise<{ bolt11: string; verify: string | null } | null> {
  try {
    const [user, domain] = String(lud16).split('@');
    if (!user || !domain) return null;
    // The lud16 comes from a seller's listing, so it chooses a host the server
    // will connect to. Reject private/loopback targets and anything that isn't a
    // plain public hostname, and re-check the callback URL the host hands back —
    // otherwise a listing could point the oracle at internal infrastructure.
    if (!isPublicLnurlHost(domain)) return null;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(user)) return null;
    const meta: any = await lnurlFetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`);
    if (!meta?.callback || !isPublicLnurlUrl(meta.callback)) return null;
    const msats = sats * 1000;
    if (meta.minSendable && msats < meta.minSendable) return null;
    if (meta.maxSendable && msats > meta.maxSendable) return null;
    const params = new URLSearchParams({ amount: String(msats) });
    // Attach the sale memo as an LNURL-pay comment (LUD-12) so it shows on the
    // seller's incoming payment — only if their wallet advertises comment support.
    const maxComment = Number(meta.commentAllowed ?? 0);
    if (comment && maxComment > 0) params.set('comment', comment.slice(0, maxComment));
    const sep = meta.callback.includes('?') ? '&' : '?';
    const inv: any = await lnurlFetch(`${meta.callback}${sep}${params.toString()}`);
    if (!inv?.pr) return null;
    // The seller's LNURL server chooses the invoice; the buyer is shown `sats`
    // and pays what we hand them. An invoice for a different amount — or one we
    // can't parse — is not something to forward.
    if (!invoiceMatchesAmount(inv.pr, msats)) {
      console.warn(`[Oracle] LNURL for ${lud16} returned an invoice that does not match ${sats} sats — rejected.`);
      return null;
    }
    return { bolt11: inv.pr, verify: inv.verify || null };
  } catch { return null; }
}

// Poll an LNURL verify URL — true once the invoice is settled.
async function lnurlIsSettled(verifyUrl: string): Promise<boolean> {
  try {
    // Also seller-controlled, and polled on a timer — same host rules as above.
    const d: any = await lnurlFetch(verifyUrl);
    return !!d?.settled;
  } catch { return false; }
}

// Reduce relay events to the newest event per d-tag (so a burn tombstone wins).
// `allowedAuthors` is not optional in spirit: relays are untrusted, and the
// `authors` field of a filter is a request, not a guarantee — a hostile or buggy
// relay can answer with anything. Every caller here feeds the result into an
// ownership or money decision, so we re-check the author and the signature on
// the way in rather than hoping each call site remembers to.
function newestPerD(events: any[], allowedAuthors: readonly string[]): Map<string, any> {
  const allowed = new Set(allowedAuthors.map(a => a.toLowerCase()));
  const byD = new Map<string, any>();
  for (const e of events) {
    const d = e?.tags?.find((t: string[]) => t[0] === 'd')?.[1];
    if (!d) continue;
    if (typeof e.pubkey !== 'string' || !allowed.has(e.pubkey.toLowerCase())) continue;
    if (byD.has(d) && e.created_at <= byD.get(d).created_at) continue;
    // Verify last — it's the expensive check, and the cheap ones above already
    // discarded most of what a hostile relay would send.
    try { if (!verifyEvent(e)) continue; } catch { continue; }
    byD.set(d, e);
  }
  return byD;
}
const isBurned = (e: any): boolean => !!e?.tags?.find((t: string[]) => t[0] === 'burned');
const tagVal = (e: any, name: string): string | undefined => e?.tags?.find((t: string[]) => t[0] === name)?.[1];

// Same distrust as newestPerD, for the marker reads (weekly drop, bounty claims)
// that pick a "newest" event by created_at: a hostile relay can answer any filter
// with forged, future-dated events — which would win that pick and re-block weekly
// drops or inject phantom bounty claimants. Author, signature, and the same
// future-drift cap the relay enforces are all re-checked here.
const MAX_FUTURE_DRIFT_S = 15 * 60;
function verifiedOracleEvents(events: any[]): any[] {
  const allowed = new Set(ORACLE_AUTHORS.map(a => a.toLowerCase()));
  const maxCreated = Math.floor(Date.now() / 1000) + MAX_FUTURE_DRIFT_S;
  const out: any[] = [];
  for (const e of events) {
    if (typeof e?.pubkey !== 'string' || !allowed.has(e.pubkey.toLowerCase())) continue;
    if (typeof e.created_at !== 'number' || e.created_at > maxCreated) continue;
    try { if (!verifyEvent(e)) continue; } catch { continue; }
    out.push(e);
  }
  return out;
}

// Poll an LNURL verify URL; once the invoice settles, release the escrowed item to
// the buyer (transfer oracle → buyer), mark it sold, and notify everyone. Used by
// both direct buys and accepted bids. `buyerWs` is where the buyer is connected.
function pollAndRelease(instanceId: string, buyer: string, buyerWs: WebSocket | undefined, verifyUrl: string, seller: string): void {
  const send = (m: object) => { if (buyerWs?.readyState === WebSocket.OPEN) buyerWs.send(JSON.stringify(m)); };
  const started = Date.now();
  let notifiedTimeout = false;

  // A settled payment we can't fulfil. Tell the buyer plainly, and DM both sides
  // so the seller knows a refund is owed — silence here reads to the buyer as
  // the game having stolen their sats.
  const reportUndeliverable = (reason: string, sellerPk = seller) => {
    console.error(`[Oracle] PAID BUT UNDELIVERED: ${instanceId} buyer=${buyer.slice(0, 8)}… reason=${reason}`);
    send({ type: 'item_purchase_error', instanceId, reason });
    dmFromOracle(buyer, `Your Nostr District payment went through, but the item couldn't be delivered (${reason}). The seller has been notified and owes you a refund — their Lightning address received the payment directly.`);
    if (sellerPk) {
      dmFromOracle(sellerPk, `Heads up: a buyer paid for your listing but the item could not be delivered (${reason}), so the payment landed in your wallet without the item changing hands. Please refund them.`);
    }
  };
  const poll = async () => {
    // Check settlement BEFORE the sold short-circuit: during the late-sweep
    // window another buyer can complete the same item, and if OUR invoice also
    // settled the buyer paid and got nothing — that used to exit silently here.
    const settled = await lnurlIsSettled(verifyUrl);
    if (soldInstances.has(instanceId)) {
      if (settled) reportUndeliverable('already_sold');
      return;
    }
    if (settled) {
      const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }), ORACLE_AUTHORS);
      const ev = held.get(instanceId);
      // Payment has settled by this point, so these two exits mean the buyer paid
      // and gets nothing. The oracle never holds the funds (they went straight to
      // the seller's wallet), so it can't refund — the most it can do is make sure
      // neither side finds out by accident.
      if (!ev || isBurned(ev)) { reportUndeliverable('item_gone'); return; }
      const newEvent = transferItem(ev, ORACLE_PUBKEY, buyer);
      if (!newEvent) { reportUndeliverable('transfer_failed', tagVal(ev, 'escrow_seller')); return; }
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
    const elapsed = Date.now() - started;
    if (elapsed > LATE_SWEEP_MS) return;
    if (elapsed > RESERVE_MS) {
      // The reservation has lapsed, so the UI is told the window closed — but we
      // keep checking at a slow cadence. Payment goes straight to the seller and
      // the oracle holds no funds, so abandoning the poll here meant a buyer who
      // paid a minute late simply lost their sats with nothing to show for it.
      if (!notifiedTimeout) { notifiedTimeout = true; send({ type: 'purchase_timeout', instanceId }); }
      setTimeout(poll, 30_000);
      return;
    }
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

// ── Client authentication (NIP-42 style) ─────────────────────────────────────
// Every connection is handed a random challenge on open. To claim a real pubkey
// the client must return a kind:22242 event signed by that key over the exact
// challenge. Without this, `join` was a bare assertion — anyone could claim any
// pubkey and the oracle would gift/burn/sell that victim's items on request.
//
// Re-signing on every reconnect would mean a signer prompt each time (painful on
// bunker/extension, and a declined prompt can drop a bunker session), so a
// successful auth also mints a short-lived session token the client replays on
// reconnect. Tokens live in memory only: a server restart just forces one more
// signature.
const AUTH_KIND = 22242;
const AUTH_MAX_SKEW_S = 300;              // signed event must be this fresh
const SESSION_TTL_MS  = 12 * 60 * 60 * 1000;

const sessionTokens = new Map<string, { pubkey: string; expires: number }>();

function newNonce(): string {
  return bytesToHex(webcrypto.getRandomValues(new Uint8Array(32)));
}

function issueSessionToken(pubkey: string): string {
  const token = newNonce();
  sessionTokens.set(token, { pubkey, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function redeemSessionToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const entry = sessionTokens.get(token);
  if (!entry) return null;
  if (entry.expires < Date.now()) { sessionTokens.delete(token); return null; }
  return entry.pubkey;
}

// Drop expired tokens hourly so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessionTokens) if (entry.expires < now) sessionTokens.delete(token);
}, 60 * 60 * 1000).unref?.();

const isRealPubkey = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/**
 * Verify a client's auth event against the challenge we issued this connection.
 * Returns the authenticated pubkey, or null with the reason logged by caller.
 */
function verifyAuthEvent(ev: any, challenge: string): string | null {
  if (!ev || typeof ev !== 'object') return null;
  if (ev.kind !== AUTH_KIND) return null;
  if (!isRealPubkey(ev.pubkey)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof ev.created_at !== 'number' || Math.abs(now - ev.created_at) > AUTH_MAX_SKEW_S) return null;
  const sent = ev.tags?.find((t: string[]) => t[0] === 'challenge')?.[1];
  // Constant-time-ish: challenges are random 32-byte nonces, so a plain compare
  // leaks nothing useful, but the value must match exactly.
  if (typeof sent !== 'string' || sent !== challenge) return null;
  try { if (!verifyEvent(ev)) return null; } catch { return null; }
  return ev.pubkey.toLowerCase();
}

const wss = new WebSocketServer({
  port: 3100,
  // Default is 100 MiB per frame — far more than any legitimate message here,
  // and a cheap way for one connection to balloon server memory.
  maxPayload: 256 * 1024,
});
console.log('[Presence] Server running on ws://localhost:3100');

// Bounty claim ledger cleanup — on boot (covers restart-heavy deploys) + every 8 days.
pruneBountyClaims();
setInterval(pruneBountyClaims, 8 * 24 * 60 * 60 * 1000);

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

  // Per-connection challenge. The client must echo it back inside a signed
  // kind:22242 event (or present a token from an earlier signature) before it
  // can join as a real pubkey.
  const challenge = newNonce();
  ws.send(JSON.stringify({ type: 'auth_challenge', challenge }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'join') {
        // A socket that joins twice re-seats under a new identity below — capture
        // the old one so its players entry doesn't linger as a ghost pointing at
        // this ws (the close handler only ever deletes the LATEST identity).
        const previousPubkey = myPubkey;
        // Resolve the caller's identity BEFORE trusting anything else in the
        // message. Three outcomes: a valid session token, a fresh signature, or
        // a guest — and guest ids are minted here, never accepted from the wire
        // (a client-chosen "guest_x" could otherwise collide with a live one).
        let authedPubkey: string | null = redeemSessionToken(msg.token);
        let freshToken: string | null = null;

        if (!authedPubkey && msg.auth) {
          authedPubkey = verifyAuthEvent(msg.auth, challenge);
          if (authedPubkey) freshToken = issueSessionToken(authedPubkey);
        }

        // If the client named an identity, the proof has to be for THAT identity.
        // Seating a validly-signed but different key would leave client and
        // server disagreeing about who this connection is.
        if (authedPubkey && isRealPubkey(msg.pubkey) && msg.pubkey.toLowerCase() !== authedPubkey) {
          ws.send(JSON.stringify({ type: 'auth_required', challenge }));
          return;
        }

        if (authedPubkey) {
          myPubkey = authedPubkey;
        } else if (isRealPubkey(msg.pubkey)) {
          // Claimed a real identity but couldn't prove it. Refuse rather than
          // silently downgrading to a guest, so the client can re-sign.
          ws.send(JSON.stringify({ type: 'auth_required', challenge }));
          return;
        } else {
          myPubkey = `guest_${bytesToHex(webcrypto.getRandomValues(new Uint8Array(6)))}`;
        }

        ws.send(JSON.stringify({ type: 'auth_ok', pubkey: myPubkey, token: freshToken }));
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
        if (previousPubkey && previousPubkey !== myPubkey) {
          const old = players.get(previousPubkey);
          if (old && old.ws === ws) {
            broadcastToRoom(old.room, { type: 'leave', pubkey: previousPubkey }, null);
            players.delete(previousPubkey);
          }
        }
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

      // ── Economy gate ──────────────────────────────────────────────────────
      // Everything below moves or creates value, keyed to the caller's identity.
      // Guest connections are free and unlimited, so they must not reach any of
      // it: a fresh guest id passes the weekly-drop gate every time (farm into a
      // throwaway id, then gift to a real account), and guest-held purchase
      // reservations bypass the per-buyer cap that keeps the market unbuyable.
      // Guests can still walk, chat, and emote — anything item/money needs a
      // signed identity. auth_required makes the client re-sign (or prompts login).
      const ECONOMY_TYPES = new Set([
        'item_mint_request', 'scavenge_request', 'fish_catch_request',
        'bounty_claim_request', 'item_discard_request', 'item_gift_request',
        'item_swap_request', 'item_escrow_request', 'item_unescrow_request',
        'item_purchase_init', 'accept_bid', 'decline_win', 'revoke_acceptance',
      ]);
      if (ECONOMY_TYPES.has(msg.type) && !isRealPubkey(myPubkey)) {
        ws.send(JSON.stringify({ type: 'auth_required', challenge }));
        return;
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
          ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'wrong_room', room: player.room, scavenge: true }));
          return;
        }
        if (!canScavenge(myPubkey)) {
          ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'scavenge_cooldown', scavenge: true }));
          return;
        }
        recordScavenge(myPubkey);
        const itemId = rollScavengeNoRepeat(pool, holiday, myPubkey);
        const event = itemId ? mintItem(myPubkey, itemId, 'found') : null;
        if (!event) {
          ws.send(JSON.stringify({ type: 'item_mint_error', reason: 'oracle_unavailable', scavenge: true }));
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
          const bounties = getWeekBounties(me);
          const out = [];
          for (const b of bounties) {
            const claims = await loadBountyClaims(b.id);
            out.push({
              id: b.id, wants: b.wants, burnAny: b.burnAny, rewardItemId: b.rewardItemId, tier: b.tier, endsAt: b.endsAt,
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
        const bounty = getWeekBounties(me).find(b => b.id === bountyId);
        if (!bounty) { fail('expired'); return; } // last period's board, another npub's, or forged id
        // In-flight lock: the already_claimed check below involves a relay fetch,
        // so two PARALLEL claims from one account could both pass it and double-mint.
        // The UI can't do this (button disables) — this stops scripted clients.
        const flightKey = `${bountyId}|${me}`;
        if (bountyClaimsInFlight.has(flightKey)) { fail('already_claimed'); return; }
        bountyClaimsInFlight.add(flightKey);
        (async () => {
          const claims = await loadBountyClaims(bountyId);
          if (claims.includes(me)) { fail('already_claimed'); return; }

          // Verify the submitted instances, each one authoritative from relays
          // (oracle-signed, owned by claimant, unburned). A poster needs the
          // specific `wants` items AND `burnAny.count` more of the right rarity —
          // the submission must cover the wants multiset, with the leftover being
          // exactly the free-choice items at the required rarity.
          const wantsTotal = bounty.wants.reduce((s, w) => s + w.qty, 0);
          const anyCount = bounty.burnAny?.count ?? 0;
          if (instanceIds.length !== wantsTotal + anyCount) { fail('wrong_items'); return; }
          const fetched: { ev: any; itemId: string }[] = [];
          for (const instanceId of instanceIds) {
            const ev = await fetchOwnedItem(instanceId, me);
            const itemId = ev?.tags?.find((t: string[]) => t[0] === 'item_id')?.[1];
            if (!ev || !itemId) { fail('wrong_items'); return; }
            fetched.push({ ev, itemId });
          }
          // Consume the specific wants first; whatever's left is the free-choice set.
          const needed: Record<string, number> = {};
          for (const w of bounty.wants) needed[w.itemId] = (needed[w.itemId] ?? 0) + w.qty;
          const leftover: { ev: any; itemId: string }[] = [];
          for (const it of fetched) {
            if (needed[it.itemId] > 0) needed[it.itemId]--;
            else leftover.push(it);
          }
          if (Object.values(needed).some(n => n > 0)) { fail('wrong_items'); return; } // a required item is missing
          if (bounty.burnAny) {
            if (leftover.length !== anyCount) { fail('wrong_items'); return; }
            const allowed = bounty.burnAny.rarities as string[];
            for (const it of leftover) if (!allowed.includes(ITEM_RARITY.get(it.itemId) ?? '')) { fail('wrong_items'); return; }
          } else if (leftover.length !== 0) { fail('wrong_items'); return; }
          const verified: any[] = fetched.map(f => f.ev);

          // All inputs check out → burn them, mint the posted reward, record.
          for (const ev of verified) burnItem(ev);
          const reward = mintItem(me, bounty.rewardItemId, 'bounty');
          if (!reward) { fail('mint_failed'); return; }
          publishToRelays(reward);
          recordBountyClaim(bountyId, me, bounty.endsAt);
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
        const burner     = myPubkey;
        const instanceId = msg.event?.tags?.find((t: string[]) => t[0] === 'd')?.[1];
        const fail = () => ws.send(JSON.stringify({ type: 'item_discard_error', reason: 'not_owner' }));
        if (typeof instanceId !== 'string' || !instanceId) { fail(); return; }
        (async () => {
          // Authoritative ownership from relays — same rule as gift/swap. The
          // client-supplied event is only a pointer to WHICH instance to burn;
          // its pubkey/p-tag are attacker-controlled and prove nothing. Trusting
          // them let anyone tombstone any instance id they could read off the
          // public market.
          const real = await fetchOwnedItem(instanceId, burner);
          if (!real) { fail(); return; }
          // Tombstone: same d-tag, KEEPS p + t so the owner's query still returns it,
          // adds a 'burned' marker + newer created_at. The client dedupes by d-tag
          // (newest wins) and filters burned — so only ONE relay needs this event.
          const tombstone = finalizeEvent({
            kind: 30078,
            pubkey: ORACLE_PUBKEY,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['d', instanceId], ['p', burner], ['t', 'nditem'], ['burned', '1']],
            content: '',
          }, ORACLE_SK);
          publishToRelays(tombstone);
          recordBurned(instanceId);
          console.log(`[Oracle] Burned item ${instanceId} for ${burner.slice(0,8)}…`);
          ws.send(JSON.stringify({ type: 'item_discarded', eventId: real.id }));
        })().catch(() => fail());
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
          const owned = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': [seller], '#t': ['nditem'] }), ORACLE_AUTHORS);
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
        // A live reservation means a buyer is holding an invoice for this item
        // right now. Pulling it back mid-payment leaves them paid and empty —
        // the seller can delist once the 5-minute window lapses unpaid.
        if (isReserved(instanceId)) { fail('purchase_in_progress'); return; }
        (async () => {
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }), ORACLE_AUTHORS);
          const ev = held.get(instanceId);
          if (!ev || isBurned(ev)) { fail('not_escrowed'); return; }
          if (tagVal(ev, 'escrow_seller') !== seller) { fail('not_your_listing'); return; }
          // Re-check: the query above is async, and a buyer may have started
          // paying while it was in flight.
          if (isReserved(instanceId)) { fail('purchase_in_progress'); return; }
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
        // Claim the item BEFORE the first await. Everything below is async, and
        // an unclaimed window here is a window where a second buyer gets an
        // invoice for the same item and pays for nothing.
        if (!tryReserve(instanceId, buyer)) { fail('reserved'); return; }
        (async () => {
          // Any exit that isn't "invoice handed to the buyer" must give the item
          // back, or a failed init would lock it for the full 5 minutes.
          const abort = (reason: string) => { releaseReservation(instanceId, buyer); fail(reason); };
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }), ORACLE_AUTHORS);
          const ev = held.get(instanceId);
          if (!ev || isBurned(ev)) { abort('item_gone'); return; }
          const seller  = tagVal(ev, 'escrow_seller');
          const lud16   = tagVal(ev, 'escrow_lud16');
          const winner  = tagVal(ev, 'awaiting_winner');
          if (!seller || !lud16) { abort('not_listed'); return; }
          if (seller === buyer) { abort('own_listing'); return; }
          // If a bid was accepted, only that winner may buy — at the bid price.
          let price: number;
          if (winner) {
            if (winner !== buyer) { abort('reserved_for_winner'); return; }
            price = Math.floor(Number(tagVal(ev, 'winning_price') ?? '0'));
          } else {
            price = Math.floor(Number(tagVal(ev, 'escrow_price') ?? '0'));
          }
          if (!(price >= 1)) { abort('not_listed'); return; }
          // Sale memo rides on the payment (LNURL comment) so the seller sees what
          // sold + to whom on the incoming zap — no separate DM needed.
          const itemName = tagVal(ev, 'escrow_name') ?? tagVal(ev, 'item_id') ?? 'item';
          // Neutral memo so it reads sensibly in BOTH wallets (buyer's outgoing +
          // seller's incoming payment record).
          const memo = `Nostr District market: ${itemName} (${price} sats)`;
          const inv = await lnurlGetInvoice(lud16, price, memo);
          if (!inv || !inv.verify) { abort('invoice_failed'); return; }
          ws.send(JSON.stringify({ type: 'purchase_invoice', instanceId, bolt11: inv.bolt11, price }));
          pollAndRelease(instanceId, buyer, ws, inv.verify, seller);
        })().catch(() => { releaseReservation(instanceId, buyer); fail('init_failed'); });
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
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }), ORACLE_AUTHORS);
          const ev = held.get(instanceId);
          if (!ev || isBurned(ev)) { fail('item_gone'); return; }
          if (tagVal(ev, 'escrow_seller') !== seller) { fail('not_your_listing'); return; }
          // Already accepted a bid on this item — don't accept a second one.
          if (tagVal(ev, 'awaiting_winner')) { fail('already_accepted'); return; }
          // Read the winner's signed bid off the relays → trustworthy amount
          const bidsByAuthor = newestPerD(await queryRelays({ kinds: [30078], authors: [winner], '#t': ['ndbid'] }), [winner]);
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
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }), ORACLE_AUTHORS);
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

      // ── Seller revokes a bid acceptance ───────────────────────────────────
      // The seller declined a bidder AFTER accepting them (or on a stale UI where
      // the accept state was lost). A relay decline marker alone never reaches the
      // oracle, so the escrow stayed stamped and the winner could still pay. This
      // clears the winner stamp + win marker so the seller's decline actually sticks
      // and the item re-opens to the market. No-op (still ok) if the named bidder
      // isn't the current winner, so declining a non-winning bid is harmless.
      if (msg.type === 'revoke_acceptance' && myPubkey) {
        const seller     = myPubkey;
        const instanceId = typeof msg.instanceId === 'string' ? msg.instanceId : '';
        const bidder     = typeof msg.bidder === 'string' ? msg.bidder : '';
        const fail = (reason: string) => ws.send(JSON.stringify({ type: 'revoke_acceptance_error', instanceId, reason }));
        if (!instanceId) { fail('bad_request'); return; }
        (async () => {
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }), ORACLE_AUTHORS);
          const ev = held.get(instanceId);
          if (!ev || isBurned(ev)) { fail('item_gone'); return; }
          if (tagVal(ev, 'escrow_seller') !== seller) { fail('not_your_listing'); return; }
          const winner = tagVal(ev, 'awaiting_winner');
          // Nothing reserved, or a different bidder is the winner → nothing to undo.
          if (!winner || (bidder && winner !== bidder)) {
            ws.send(JSON.stringify({ type: 'acceptance_revoked', instanceId, changed: false }));
            return;
          }
          const cleared = restampEscrow(ev, null, 0); // drop the winner stamp
          if (!cleared) { fail('revoke_failed'); return; }
          publishToRelays(cleared);
          clearWinMarker(instanceId, winner);
          setReservedForWinner(instanceId, false); // re-open BUY/BID to everyone
          console.log(`[Bids] ${seller.slice(0,8)}… revoked acceptance of ${winner.slice(0,8)}… on ${instanceId} — item re-opened`);
          ws.send(JSON.stringify({ type: 'acceptance_revoked', instanceId, changed: true }));
        })().catch(() => fail('revoke_failed'));
        return;
      }

      // ── Notify a seller of a new bid (oracle-sent) ────────────────────────
      // Bids are public relay events; the bidder asks the oracle to DM the seller
      // so the push comes from the trusted oracle key — consistent with the win/
      // sold/gift notices — instead of a player-to-player DM, and the bidder's
      // signer isn't prompted to encrypt one. Verified against the bidder's signed
      // bid on the relays so it can't be used to DM-spam a seller.
      if (msg.type === 'notify_bid' && myPubkey) {
        const bidder     = myPubkey;
        const instanceId = typeof msg.instanceId === 'string' ? msg.instanceId : '';
        if (!instanceId) return;
        (async () => {
          const held = newestPerD(await queryRelays({ kinds: [30078], authors: ORACLE_AUTHORS, '#p': ORACLE_AUTHORS, '#t': ['nditem'] }), ORACLE_AUTHORS);
          const ev = held.get(instanceId);
          if (!ev || isBurned(ev)) return;
          const seller = tagVal(ev, 'escrow_seller');
          if (!seller || seller === bidder) return;
          // Confirm the bidder really has a live bid on this item before DMing.
          const bids = newestPerD(await queryRelays({ kinds: [30078], authors: [bidder], '#t': ['ndbid'] }), [bidder]);
          const bidEv = bids.get(instanceId);
          if (!bidEv || tagVal(bidEv, 'withdrawn')) return;
          const amount = Math.floor(Number(tagVal(bidEv, 'amount') ?? '0'));
          if (!(amount >= 1)) return;
          const itemName = tagVal(ev, 'escrow_name') ?? tagVal(ev, 'item_id') ?? 'an item';
          dmFromOracle(seller, `New bid: ${amount} sats on your ${itemName} in Nostr District. Open the app → Bazaar → Offers to accept or decline.`);
        })().catch(() => {});
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
