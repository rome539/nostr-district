/**
 * tradeItemStore.ts — Inventory and market for all tradeable items (fish + world items).
 * Fish are added by WoodsScene on catch. World items will be added by scenes/events.
 * Market listings published as Nostr kind:30402 with tag `t:ndmarket`.
 */
import { nip19 } from 'nostr-tools';
import { authStore } from './authStore';
import { publishEvent, signEvent } from '../nostr/nostrService';
import { DEFAULT_RELAYS } from '../nostr/relayManager';

// ── Item definitions ──────────────────────────────────────────────────────────

export type ItemRarity = 'common' | 'rare' | 'legendary' | 'junk';
export type ItemCategory = 'fish' | 'hardware' | 'street' | 'lore' | 'occult' | 'critters' | 'holiday';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  rarity: ItemRarity;
  description: string;
  emoji: string;
  kg?: string;
}

export const ITEM_CATALOG: ItemDef[] = [
  // ── Fish: Common ────────────────────────────────────────────────────────────
  { id: 'fish_tiny_carp',         name: 'Tiny Carp',          category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.2', description: 'Small but spirited.' },
  { id: 'fish_silver_trout',      name: 'Silver Trout',       category: 'fish', rarity: 'common',    emoji: '🐟', kg: '1.4', description: 'A classic catch.' },
  { id: 'fish_moonfish',          name: 'Moonfish',           category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.8', description: 'Pale and quiet.' },
  { id: 'fish_bluegill',         name: 'Bluegill',           category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.4', description: 'Fights above its weight.' },
  { id: 'fish_mud_catfish',       name: 'Mud Catfish',        category: 'fish', rarity: 'common',    emoji: '🐟', kg: '1.8', description: 'Bottom dweller.' },
  { id: 'fish_speckled_sunfish',  name: 'Speckled Sunfish',   category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.3', description: 'Pretty, common.' },
  { id: 'fish_lake_minnow',       name: 'Lake Minnow',        category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.1', description: 'Blink and you\'ll miss it.' },
  { id: 'fish_striped_dace',      name: 'Striped Dace',       category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.6', description: 'Fast swimmer.' },
  { id: 'fish_green_sunperch',    name: 'Green Sunperch',     category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.5', description: 'Sun-warmed shallows.' },
  { id: 'fish_whiskered_loach',   name: 'Whiskered Loach',    category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.3', description: 'Likes the mud.' },
  { id: 'fish_spotted_rudd',      name: 'Spotted Rudd',       category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.7', description: 'Reddish fins.' },
  { id: 'fish_common_bream',      name: 'Common Bream',       category: 'fish', rarity: 'common',    emoji: '🐟', kg: '1.2', description: 'Flat and wide.' },
  { id: 'fish_river_roach',       name: 'River Roach',        category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.4', description: 'Wiry and quick.' },
  { id: 'fish_flathead_chub',     name: 'Flathead Chub',      category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.8', description: 'Stubborn on the line.' },
  { id: 'fish_golden_shiner',     name: 'Golden Shiner',      category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.3', description: 'Flashes gold in sunlight.' },
  { id: 'fish_pumpkinseed',       name: 'Pumpkinseed',        category: 'fish', rarity: 'common',    emoji: '🐟', kg: '0.5', description: 'Orange-spotted flanks.' },
  // ── Fish: Rare ──────────────────────────────────────────────────────────────
  { id: 'fish_darkwater_bass',    name: 'Darkwater Bass',     category: 'fish', rarity: 'rare',      emoji: '🐠', kg: '2.3', description: 'It only surfaces when the moon is hidden.' },
  { id: 'fish_luminous_eel',      name: 'Luminous Eel',       category: 'fish', rarity: 'rare',      emoji: '🐠', kg: '0.5', description: 'Locals once used them as lanterns.' },
  { id: 'fish_crystal_perch',     name: 'Crystal Perch',      category: 'fish', rarity: 'rare',      emoji: '🐠', kg: '3.1', description: 'Almost completely transparent.' },
  { id: 'fish_ghost_pike',        name: 'Ghost Pike',         category: 'fish', rarity: 'rare',      emoji: '🐠', kg: '4.2', description: 'Other fish scatter when it passes.' },
  { id: 'fish_midnight_sturgeon', name: 'Midnight Sturgeon',  category: 'fish', rarity: 'rare',      emoji: '🐠', kg: '6.8', description: 'Ancient and patient.' },
  { id: 'fish_starscale_koi',     name: 'Starscale Koi',      category: 'fish', rarity: 'rare',      emoji: '🐠', kg: '1.1', description: 'Its scales map the night sky.' },
  { id: 'fish_abyssal_anglerfish',name: 'Abyssal Anglerfish', category: 'fish', rarity: 'rare',      emoji: '🐠', kg: '2.7', description: 'The lake is not deep enough for this.' },
  { id: 'fish_ancient_goldfish',  name: 'Ancient Goldfish',   category: 'fish', rarity: 'rare',      emoji: '🐠', kg: '0.9', description: 'Thirty-seven rings.' },
  { id: 'fish_love_letter',       name: 'Love Letter',        category: 'fish', rarity: 'rare',      emoji: '💌', kg: '0.0', description: 'Sealed in a glass vial, perfectly dry. No signature.' },
  // ── Fish: Junk ──────────────────────────────────────────────────────────────
  { id: 'fish_old_boot',          name: 'Old Boot',           category: 'fish', rarity: 'junk',      emoji: '🥾', description: 'Someone\'s loss.' },
  { id: 'fish_bottle_message',    name: 'Message in a Bottle',category: 'fish', rarity: 'junk',      emoji: '🍾', description: 'Soggy. Unreadable.' },
  { id: 'fish_rusty_tin_can',     name: 'Rusty Tin Can',      category: 'fish', rarity: 'junk',      emoji: '🥫', description: 'Label long gone.' },
  { id: 'fish_waterlogged_hat',   name: 'Waterlogged Hat',    category: 'fish', rarity: 'junk',      emoji: '🎩', description: 'Belonged to someone.' },
  { id: 'fish_tangled_line',      name: 'Tangled Fishing Line',category:'fish', rarity: 'junk',      emoji: '🧵', description: 'A fisher\'s nightmare.' },
  { id: 'fish_broken_lantern',    name: 'Broken Lantern',     category: 'fish', rarity: 'junk',      emoji: '🏮', description: 'Still smells of oil.' },
  // ── Fish: Legendary ─────────────────────────────────────────────────────────
  { id: 'fish_ostrich',           name: 'Ostrich',            category: 'fish', rarity: 'legendary', emoji: '🪶', kg: '63.5', description: 'It wasn\'t a fish.' },
  { id: 'fish_golden_satoshi',    name: 'Golden Satoshi Coin',category: 'fish', rarity: 'legendary', emoji: '🪙', kg: '0.01', description: 'Cold to the touch and humming faintly.' },
  { id: 'fish_enchanted_trident', name: 'Enchanted Trident',  category: 'fish', rarity: 'legendary', emoji: '🔱', kg: '8.4',  description: 'The prongs glow under moonlight.' },
  { id: 'fish_coelacanth',        name: 'Leviathan Coelacanth',category:'fish', rarity: 'legendary', emoji: '🐟', kg: '91.2', description: 'A living fossil, 65 million years old.' },
  { id: 'fish_meteor',            name: 'Meteor from Andromeda',category:'fish',rarity: 'legendary', emoji: '☄️', kg: '???',  description: '2.5 million light years of it.' },
  // ── Hardware ────────────────────────────────────────────────────────────────
  { id: 'hw_data_chip',       name: 'Data Chip',          category: 'hardware', rarity: 'common',    emoji: '💾', description: 'Encrypted. Contents unknown.' },
  { id: 'hw_circuit_board',   name: 'Circuit Board',      category: 'hardware', rarity: 'common',    emoji: '🔌', description: 'Salvaged from a relay node.' },
  { id: 'hw_cooling_fan',     name: 'Cooling Fan',        category: 'hardware', rarity: 'common',    emoji: '🌀', description: 'Spins down slow, like it\'s thinking.' },
  { id: 'hw_solder_iron',     name: 'Soldering Iron',     category: 'hardware', rarity: 'common',    emoji: '🔧', description: 'Still warm. Someone left in a hurry.' },
  { id: 'hw_signal_relay',    name: 'Signal Relay',       category: 'hardware', rarity: 'rare',      emoji: '📡', description: 'Broadcasts on frequencies that shouldn\'t exist.' },
  { id: 'hw_encrypted_drive', name: 'Encrypted Drive',    category: 'hardware', rarity: 'rare',      emoji: '💿', description: '256-bit. Nobody\'s cracked one yet.' },
  { id: 'hw_burner_pager',    name: 'Burner Pager',       category: 'hardware', rarity: 'rare',      emoji: '📟', description: 'Buzzes with numbers that don\'t exist.' },
  { id: 'hw_rogue_dish',      name: 'Rogue Dish',         category: 'hardware', rarity: 'rare',      emoji: '🛰️', description: 'Pointed at no satellite anyone admits to.' },
  { id: 'hw_quantum_key',     name: 'Quantum Key',        category: 'hardware', rarity: 'legendary', emoji: '🔑', description: 'Opens things that have no lock.' },
  { id: 'hw_mainframe_core',  name: 'Mainframe Core',     category: 'hardware', rarity: 'legendary', emoji: '🖥️', description: 'The district\'s first node, still humming under the street.' },
  // ── Street ──────────────────────────────────────────────────────────────────
  { id: 'st_burner_phone',    name: 'Burner Phone',       category: 'street',   rarity: 'common',    emoji: '📱', description: 'Prepaid. Untraceable. Already warm.' },
  { id: 'st_ghost_token',     name: 'Ghost Token',        category: 'street',   rarity: 'common',    emoji: '👻', description: 'Proof of nothing. That\'s the point.' },
  { id: 'st_counterfeit_bill',name: 'Counterfeit Bill',   category: 'street',   rarity: 'common',    emoji: '💵', description: 'The watermark\'s almost right.' },
  { id: 'st_lockpick_set',    name: 'Lockpick Set',       category: 'street',   rarity: 'common',    emoji: '🔓', description: 'Six pins. No questions.' },
  { id: 'st_forged_id',       name: 'Forged ID',          category: 'street',   rarity: 'rare',      emoji: '🪪', description: 'Convincing enough.' },
  { id: 'st_contraband_pkg',  name: 'Contraband Package', category: 'street',   rarity: 'rare',      emoji: '📦', description: 'Don\'t open it. Don\'t ask.' },
  { id: 'st_skeleton_key',    name: 'Skeleton Key',       category: 'street',   rarity: 'rare',      emoji: '🔐', description: 'Fits locks it was never cut for.' },
  { id: 'st_blackmarket_map', name: 'Black Market Map',   category: 'street',   rarity: 'rare',      emoji: '🗺️', description: 'X marks a place that isn\'t there anymore.' },
  { id: 'st_zk_proof',        name: 'Zero-Knowledge Proof',category:'street',   rarity: 'legendary', emoji: '🧮', description: 'Proves everything by revealing nothing.' },
  { id: 'st_kingpin_ledger',  name: 'Kingpin\'s Ledger',  category: 'street',   rarity: 'legendary', emoji: '📕', description: 'Every debt in the district, in one hand.' },
  // ── Lore ────────────────────────────────────────────────────────────────────
  { id: 'lo_satoshi_coin',    name: 'Satoshi Coin',       category: 'lore',     rarity: 'common',    emoji: '₿',  description: 'Minted on block zero.' },
  { id: 'lo_relay_key',       name: 'Relay Key',          category: 'lore',     rarity: 'common',    emoji: '🗝️', description: 'Opens a node somewhere on the network.' },
  { id: 'lo_lightning_bolt',  name: 'Lightning Bolt',     category: 'lore',     rarity: 'common',    emoji: '⚡', description: 'Instant. Final. Irreversible.' },
  { id: 'lo_seed_phrase',     name: 'Seed Phrase',        category: 'lore',     rarity: 'common',    emoji: '🌱', description: 'Twelve words. Don\'t lose them.' },
  { id: 'lo_node_badge',      name: 'Node Runner Badge',  category: 'lore',     rarity: 'common',    emoji: '🏃', description: 'Worn by those who keep the network honest.' },
  { id: 'lo_genesis_fragment',name: 'Genesis Fragment',   category: 'lore',     rarity: 'rare',      emoji: '🧬', description: 'A shard of the first block. Still warm.' },
  { id: 'lo_whitepaper_page', name: 'Whitepaper Page',    category: 'lore',     rarity: 'rare',      emoji: '📄', description: 'Page 3. "The network is robust in its unstructured simplicity."' },
  { id: 'lo_block_plaque',    name: 'Block Height Plaque',category: 'lore',     rarity: 'rare',      emoji: '🧱', description: 'Commemorates a height that mattered.' },
  { id: 'lo_pow_relic',       name: 'Proof-of-Work Relic',category: 'lore',     rarity: 'rare',      emoji: '⛏️', description: 'Mined when difficulty was a rounding error.' },
  { id: 'lo_manifesto',       name: 'Cypherpunk Manifesto',category:'lore',     rarity: 'legendary', emoji: '📜', description: 'Privacy is necessary for an open society. We write code.' },
  { id: 'lo_satoshi_email',   name: 'Satoshi\'s Last Email',category:'lore',    rarity: 'legendary', emoji: '✉️', description: '"I\'ve moved on to other things."' },
  // ── Occult ──────────────────────────────────────────────────────────────────
  { id: 'oc_black_candle',    name: 'Black Candle',       category: 'occult',   rarity: 'common',    emoji: '🕯️', description: 'Burns cold.' },
  { id: 'oc_evil_eye',        name: 'Evil Eye',           category: 'occult',   rarity: 'common',    emoji: '🧿', description: 'Watches back.' },
  { id: 'oc_the_fool',        name: 'The Fool',           category: 'occult',   rarity: 'rare',      emoji: '🃏', description: 'Card 0. Every journey starts here.' },
  { id: 'oc_scrying_mirror',  name: 'Scrying Mirror',     category: 'occult',   rarity: 'rare',      emoji: '🪞', description: 'Shows a district that isn\'t quite this one.' },
  { id: 'oc_hanged_man',      name: 'The Hanged Man',     category: 'occult',   rarity: 'legendary', emoji: '☠️', description: 'Drawn once. Never returned.' },
  // ── Critters ────────────────────────────────────────────────────────────────
  { id: 'cr_sewer_rat',       name: 'Sewer Rat',          category: 'critters', rarity: 'common',    emoji: '🐀', description: 'Knows the tunnels better than you.' },
  { id: 'cr_alley_cat',       name: 'Alley Cat',          category: 'critters', rarity: 'common',    emoji: '🐈', description: 'Owns this block.' },
  { id: 'cr_raccoon',         name: 'Dumpster Raccoon',   category: 'critters', rarity: 'rare',      emoji: '🦝', description: 'Found your stash first.' },
  { id: 'cr_roost_bat',       name: 'Roost Bat',          category: 'critters', rarity: 'rare',      emoji: '🦇', description: 'Hangs near the neon.' },
  { id: 'cr_night_owl',       name: 'Night Watcher',      category: 'critters', rarity: 'legendary', emoji: '🦉', description: 'Sees every deal go down.' },

  // ── Holiday items (only drop during their holiday window) ──────────────────
  // Halloween 🎃
  { id: 'hol_candy_corn',     name: 'Candy Corn',         category: 'holiday', rarity: 'common',    emoji: '🍬', description: 'Nobody\'s favorite, everybody\'s tradition.' },
  { id: 'hol_skull_candle',   name: 'Skull Candle',       category: 'holiday', rarity: 'common',    emoji: '💀', description: 'Drips wax like it\'s thinking.' },
  { id: 'hol_black_cat',      name: 'Black Cat Charm',    category: 'holiday', rarity: 'common',    emoji: '🐈‍⬛', description: 'Bad luck, or the best luck. Depends who you ask.' },
  { id: 'hol_jack_o_lantern', name: 'Jack-o\'-Lantern',   category: 'holiday', rarity: 'rare',      emoji: '🎃', description: 'Carved by candlelight. It grins back.' },
  { id: 'hol_witch_hat',      name: 'Witch Hat',          category: 'holiday', rarity: 'rare',      emoji: '🧙', description: 'Still smells faintly of woodsmoke and spells.' },
  { id: 'hol_cauldron',       name: 'Bubbling Cauldron',  category: 'holiday', rarity: 'rare',      emoji: '🪄', description: 'Double, double, toil and trouble.' },
  { id: 'hol_phantom_key',    name: 'Phantom Key',        category: 'holiday', rarity: 'legendary', emoji: '🔮', description: 'Opens doors that aren\'t there. Halloween only.' },
  { id: 'hol_reaper_coin',    name: 'Reaper\'s Toll',     category: 'holiday', rarity: 'legendary', emoji: '⚰️', description: 'Payment for the ferryman. Keep it close.' },
  // July 4th 🎆
  { id: 'hol_sparkler',       name: 'Sparkler',           category: 'holiday', rarity: 'common',    emoji: '🎇', description: 'Burns bright and brief.' },
  { id: 'hol_flag_pin',       name: 'Flag Pin',           category: 'holiday', rarity: 'common',    emoji: '🇺🇸', description: 'Worn with quiet pride.' },
  { id: 'hol_firecracker',    name: 'Firecracker',        category: 'holiday', rarity: 'rare',      emoji: '🧨', description: 'Handle with care.' },
  { id: 'hol_bottle_rocket',  name: 'Bottle Rocket',      category: 'holiday', rarity: 'rare',      emoji: '🚀', description: 'Aim away from face. Allegedly.' },
  { id: 'hol_liberty_coin',   name: 'Liberty Coin',       category: 'holiday', rarity: 'legendary', emoji: '🎆', description: 'Minted for the free and the sovereign.' },
  { id: 'hol_eagle_feather',  name: 'Eagle Feather',      category: 'holiday', rarity: 'legendary', emoji: '🦅', description: 'Fell from the highest flight on the freest day.' },
  // Bitcoin Whitepaper Day 📄
  { id: 'hol_satoshi_quill',  name: 'Satoshi\'s Quill',   category: 'holiday', rarity: 'rare',      emoji: '🪶', description: 'The pen is mightier than the central bank.' },
  { id: 'hol_hashcash_stamp', name: 'Hashcash Stamp',     category: 'holiday', rarity: 'rare',      emoji: '📬', description: 'Proof-of-work, before it had a name.' },
  { id: 'hol_signed_paper',   name: 'Signed Whitepaper',  category: 'holiday', rarity: 'legendary', emoji: '📄', description: 'Nine pages that changed money forever.' },
  { id: 'hol_double_spend',   name: 'Double-Spend Ghost', category: 'holiday', rarity: 'legendary', emoji: '👻', description: 'The problem Satoshi finally laid to rest.' },
  // Genesis Block ⛓️
  { id: 'hol_block_zero',     name: 'Block Zero Shard',   category: 'holiday', rarity: 'rare',      emoji: '🧊', description: 'A fragment of where it all began.' },
  { id: 'hol_chancellor',     name: 'The Times Headline', category: 'holiday', rarity: 'rare',      emoji: '📰', description: '"Chancellor on brink of second bailout for banks."' },
  { id: 'hol_genesis_coin',   name: 'Genesis Coin',       category: 'holiday', rarity: 'legendary', emoji: '⛓️', description: 'From block zero. The 50 BTC that can never move.' },
  // Pizza Day 🍕
  { id: 'hol_btc_pizza',      name: 'Bitcoin Pizza',      category: 'holiday', rarity: 'rare',      emoji: '🍕', description: '10,000 BTC. Worth every bite at the time.' },
  { id: 'hol_pepperoni',      name: 'Pepperoni Relic',    category: 'holiday', rarity: 'rare',      emoji: '🍕', description: 'Preserved from the famous order. Do not eat.' },
  { id: 'hol_pizza_coin',     name: 'Pizza Coin',         category: 'holiday', rarity: 'legendary', emoji: '🪙', description: 'Commemorating the most expensive lunch in history.' },
  // Running Bitcoin Day (Finney) 🖖
  { id: 'hol_rpow_token',     name: 'RPOW Token',         category: 'holiday', rarity: 'rare',      emoji: '🔁', description: 'Reusable proof-of-work. Hal was early to everything.' },
  { id: 'hol_running_btc',    name: 'Running Bitcoin',    category: 'holiday', rarity: 'legendary', emoji: '🖖', description: '"Running bitcoin." — Hal Finney, 2009.' },
  // Winter Holiday (Dec 20–31)
  { id: 'hol_snowflake',      name: 'Snowflake',          category: 'holiday', rarity: 'common',    emoji: '❄️', description: 'No two alike. Like seed phrases.' },
  { id: 'hol_pine_sprig',     name: 'Pine Sprig',         category: 'holiday', rarity: 'common',    emoji: '🎄', description: 'Smells like the woods, in December.' },
  { id: 'hol_warm_mittens',   name: 'Warm Mittens',       category: 'holiday', rarity: 'common',    emoji: '🧤', description: 'For cold-storage hands.' },
  { id: 'hol_gift_box',       name: 'Gift Box',           category: 'holiday', rarity: 'rare',      emoji: '🎁', description: 'Don\'t shake it. Verify it.' },
  { id: 'hol_frost_coin',     name: 'Frostbit Coin',      category: 'holiday', rarity: 'legendary', emoji: '☃️', description: 'Minted in the deep cold. Never melts.' },
  // Nostr Day
  { id: 'hol_ostrich_egg',    name: 'Ostrich Egg',        category: 'holiday', rarity: 'common',    emoji: '🥚', description: 'Laid by the network\'s mascot.' },
  { id: 'hol_purple_pill',    name: 'Purple Pill',        category: 'holiday', rarity: 'common',    emoji: '💊', description: 'You can\'t go back to the old timeline.' },
  { id: 'hol_relay_stone',    name: 'Relay Stone',        category: 'holiday', rarity: 'rare',      emoji: '🪨', description: 'Carries your words to every shore.' },
  { id: 'hol_zap_bolt',       name: 'Zap Bolt',           category: 'holiday', rarity: 'rare',      emoji: '💜', description: 'A tip with no middleman.' },
  { id: 'hol_first_note',     name: 'First Note',         category: 'holiday', rarity: 'legendary', emoji: '📝', description: 'kind:1 — the first words ever spoken on the network.' },
];

export const ITEM_BY_FISH_NAME: Record<string, ItemDef> = {
  'tiny carp':              ITEM_CATALOG.find(i => i.id === 'fish_tiny_carp')!,
  'silver trout':           ITEM_CATALOG.find(i => i.id === 'fish_silver_trout')!,
  'moonfish':               ITEM_CATALOG.find(i => i.id === 'fish_moonfish')!,
  'bluegill':               ITEM_CATALOG.find(i => i.id === 'fish_bluegill')!,
  'mud catfish':            ITEM_CATALOG.find(i => i.id === 'fish_mud_catfish')!,
  'speckled sunfish':       ITEM_CATALOG.find(i => i.id === 'fish_speckled_sunfish')!,
  'lake minnow':            ITEM_CATALOG.find(i => i.id === 'fish_lake_minnow')!,
  'striped dace':           ITEM_CATALOG.find(i => i.id === 'fish_striped_dace')!,
  'green sunperch':         ITEM_CATALOG.find(i => i.id === 'fish_green_sunperch')!,
  'whiskered loach':        ITEM_CATALOG.find(i => i.id === 'fish_whiskered_loach')!,
  'spotted rudd':           ITEM_CATALOG.find(i => i.id === 'fish_spotted_rudd')!,
  'common bream':           ITEM_CATALOG.find(i => i.id === 'fish_common_bream')!,
  'river roach':            ITEM_CATALOG.find(i => i.id === 'fish_river_roach')!,
  'flathead chub':          ITEM_CATALOG.find(i => i.id === 'fish_flathead_chub')!,
  'golden shiner':          ITEM_CATALOG.find(i => i.id === 'fish_golden_shiner')!,
  'pumpkinseed':            ITEM_CATALOG.find(i => i.id === 'fish_pumpkinseed')!,
  'darkwater bass':         ITEM_CATALOG.find(i => i.id === 'fish_darkwater_bass')!,
  'luminous eel':           ITEM_CATALOG.find(i => i.id === 'fish_luminous_eel')!,
  'crystal perch':          ITEM_CATALOG.find(i => i.id === 'fish_crystal_perch')!,
  'ghost pike':             ITEM_CATALOG.find(i => i.id === 'fish_ghost_pike')!,
  'midnight sturgeon':      ITEM_CATALOG.find(i => i.id === 'fish_midnight_sturgeon')!,
  'starscale koi':          ITEM_CATALOG.find(i => i.id === 'fish_starscale_koi')!,
  'abyssal anglerfish':     ITEM_CATALOG.find(i => i.id === 'fish_abyssal_anglerfish')!,
  'ancient goldfish':       ITEM_CATALOG.find(i => i.id === 'fish_ancient_goldfish')!,
  'love letter':            ITEM_CATALOG.find(i => i.id === 'fish_love_letter')!,
  'old boot':               ITEM_CATALOG.find(i => i.id === 'fish_old_boot')!,
  'soggy message in a bottle': ITEM_CATALOG.find(i => i.id === 'fish_bottle_message')!,
  'rusty tin can':          ITEM_CATALOG.find(i => i.id === 'fish_rusty_tin_can')!,
  'waterlogged hat':        ITEM_CATALOG.find(i => i.id === 'fish_waterlogged_hat')!,
  'tangled fishing line':   ITEM_CATALOG.find(i => i.id === 'fish_tangled_line')!,
  'broken lantern':         ITEM_CATALOG.find(i => i.id === 'fish_broken_lantern')!,
  'ostrich':                ITEM_CATALOG.find(i => i.id === 'fish_ostrich')!,
  'golden satoshi coin':    ITEM_CATALOG.find(i => i.id === 'fish_golden_satoshi')!,
  'enchanted trident':      ITEM_CATALOG.find(i => i.id === 'fish_enchanted_trident')!,
  'leviathan coelacanth':   ITEM_CATALOG.find(i => i.id === 'fish_coelacanth')!,
  'meteor from Andromeda':  ITEM_CATALOG.find(i => i.id === 'fish_meteor')!,
};

// ── Sets ──────────────────────────────────────────────────────────────────────

export interface ItemSet {
  id: string;
  name: string;
  description: string;
  itemIds: string[];
  rewardLabel?: string;
  rewardAura?: string; // completing this set unlocks this aura (see collectionUnlocks.ts)
}

export const ITEM_SETS: ItemSet[] = [
  {
    id: 'set_hatchery',
    name: 'The Hatchery',
    description: 'Collect every common fish.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'fish' && i.rarity === 'common').map(i => i.id),
    rewardLabel: 'Fisherman',
  },
  {
    id: 'set_rare_waters',
    name: 'Rare Waters',
    description: 'Collect every rare fish.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'fish' && i.rarity === 'rare').map(i => i.id),
    rewardLabel: 'Deep Fisher',
  },
  {
    id: 'set_legends',
    name: 'The Legends',
    description: 'Collect all legendary catches.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'fish' && i.rarity === 'legendary').map(i => i.id),
    rewardLabel: 'Lake Legend',
  },
  {
    id: 'set_bottom_feeder',
    name: 'Bottom Feeder',
    description: 'Collect all junk from the lake.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'fish' && i.rarity === 'junk').map(i => i.id),
    rewardLabel: 'Scavenger',
  },
  {
    id: 'set_night_shift',
    name: 'Night Shift',
    description: 'Fish that only emerge in the dark.',
    itemIds: ['fish_moonfish','fish_darkwater_bass','fish_starscale_koi','fish_midnight_sturgeon'],
    rewardLabel: 'Night Fisher',
  },
  {
    id: 'set_cryptid_club',
    name: 'Cryptid Club',
    description: 'Creatures that shouldn\'t exist.',
    itemIds: ['fish_ghost_pike','fish_abyssal_anglerfish','fish_coelacanth'],
    rewardLabel: 'Cryptid Hunter',
  },
  {
    id: 'set_satoshi_vault',
    name: 'Satoshi\'s Vault',
    description: 'Artifacts touched by the legend.',
    itemIds: ['fish_golden_satoshi','fish_love_letter','fish_enchanted_trident'],
    rewardLabel: 'Vault Keeper',
  },
  {
    id: 'set_deep_time',
    name: 'Deep Time',
    description: 'Ancient and cosmic things.',
    itemIds: ['fish_ancient_goldfish','fish_coelacanth','fish_meteor'],
    rewardLabel: 'Archivist',
    rewardAura: 'sparkle',
  },
  {
    id: 'set_full_catch',
    name: 'Full Catch',
    description: 'One of every fish in the lake.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'fish').map(i => i.id),
    rewardLabel: 'Master Fisher',
  },
  {
    id: 'set_legendary_artifacts',
    name: 'Legendary Artifacts',
    description: 'Own every non-seasonal legendary item (no fish, no holidays).',
    itemIds: ITEM_CATALOG.filter(i => i.rarity === 'legendary' && i.category !== 'fish' && i.category !== 'holiday').map(i => i.id),
    rewardLabel: 'Artifact Hunter',
    rewardAura: 'gold',
  },
  {
    id: 'set_hardware',
    name: 'Dead Hardware',
    description: 'Salvaged tech from the district.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'hardware').map(i => i.id),
    rewardLabel: 'Scrap Runner',
    rewardAura: 'electric',
  },
  {
    id: 'set_street',
    name: 'Off the Books',
    description: 'Things that don\'t officially exist.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'street').map(i => i.id),
    rewardLabel: 'Ghost',
    rewardAura: 'smoke',
  },
  {
    id: 'set_lore',
    name: 'The Canon',
    description: 'Artifacts from Bitcoin and Nostr history.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'lore').map(i => i.id),
    rewardLabel: 'Lore Keeper',
    rewardAura: 'fire',
  },
  {
    id: 'set_occult',
    name: 'The Arcane',
    description: 'Every charm, card, and cursed thing.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'occult').map(i => i.id),
    rewardLabel: 'Occultist',
  },
  {
    id: 'set_critters',
    name: 'Strays',
    description: 'Every creature that calls the district home.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'critters').map(i => i.id),
    rewardLabel: 'Beast Friend',
  },
  {
    id: 'set_spooky',
    name: 'All Hallows',
    description: 'Collect every Halloween item.',
    itemIds: ['hol_candy_corn', 'hol_skull_candle', 'hol_black_cat', 'hol_jack_o_lantern', 'hol_witch_hat', 'hol_cauldron', 'hol_phantom_key', 'hol_reaper_coin'],
    rewardLabel: 'Trick-or-Treater',
  },
  {
    id: 'set_fireworks',
    name: 'Independence',
    description: 'Collect every July 4th item.',
    itemIds: ['hol_sparkler', 'hol_flag_pin', 'hol_firecracker', 'hol_bottle_rocket', 'hol_liberty_coin', 'hol_eagle_feather'],
    rewardLabel: 'Patriot',
  },
  {
    id: 'set_genesis',
    name: 'Genesis Block',
    description: 'Collect every Genesis Day item.',
    itemIds: ['hol_block_zero', 'hol_chancellor', 'hol_genesis_coin'],
    rewardLabel: 'Block Zero',
  },
  {
    id: 'set_finney',
    name: 'Running Bitcoin',
    description: 'Collect every Hal Finney tribute item.',
    itemIds: ['hol_rpow_token', 'hol_running_btc'],
    rewardLabel: "Hal's Heir",
  },
  {
    id: 'set_pizza',
    name: 'Pizza Day',
    description: 'Collect every Bitcoin Pizza Day item.',
    itemIds: ['hol_btc_pizza', 'hol_pepperoni', 'hol_pizza_coin'],
    rewardLabel: '10,000 Coiner',
  },
  {
    id: 'set_whitepaper',
    name: 'The Whitepaper',
    description: 'Collect every Whitepaper Day item.',
    itemIds: ['hol_satoshi_quill', 'hol_hashcash_stamp', 'hol_signed_paper', 'hol_double_spend'],
    rewardLabel: 'Cypherpunk',
  },
  {
    id: 'set_winter',
    name: 'Cold Storage',
    description: 'Collect every Winter Holiday item.',
    itemIds: ['hol_snowflake', 'hol_pine_sprig', 'hol_warm_mittens', 'hol_gift_box', 'hol_frost_coin'],
    rewardLabel: 'Frostkeeper',
  },
  {
    id: 'set_nostr',
    name: 'Nostr Day',
    description: 'Collect every Nostr Day item.',
    itemIds: ['hol_ostrich_egg', 'hol_purple_pill', 'hol_relay_stone', 'hol_zap_bolt', 'hol_first_note'],
    rewardLabel: 'Nostrich',
  },
  {
    id: 'set_holiday_vault',
    name: 'Seasonal Vault',
    description: 'Collect one of every holiday item.',
    itemIds: ITEM_CATALOG.filter(i => i.category === 'holiday').map(i => i.id),
    rewardLabel: 'Collector of Seasons',
  },
];

// ── Inventory ─────────────────────────────────────────────────────────────────

export interface OwnedItem {
  instanceId: string;
  itemId: string;
  acquiredAt: number;
  acquiredFrom: 'caught' | 'found' | 'weekly_drop' | 'bought' | 'received';
  fromPubkey?: string;
}

export interface MarketListing {
  id: string;           // event id
  dTag: string;         // the 30402 d-tag (stable across re-publish) — used to delist
  sellerPubkey: string;
  sellerName?: string;
  item: OwnedItem;
  def: ItemDef;
  price: number;        // sats, 0 = free/trade
  listedAt: number;
  note?: string;
}

// ── Oracle trust set (the trust anchor) ───────────────────────────────────────
// Items are trusted if signed by ANY key in this set. This is READ-SIDE ONLY — it
// decides which signatures the client validates. Minting stays single-signer: only
// the one running server holds a private key and signs, so there's never duplicate
// minting. The set exists purely so that if you ever rotate the oracle key (or one
// goes down and you bring up a new one), items signed by the OLD key still count
// forever — just keep the old pubkey in the set.
//
// In production the set is baked in via VITE_ORACLE_PUBKEYS (comma-separated), with
// VITE_ORACLE_PUBKEY honored for backwards compatibility. Baked keys are final —
// the presence server can NOT add to the set (so a spoofed server can't make the
// client trust forged items). The server-provided key is accepted ONLY in local
// dev, when no key is baked in, as a convenience.
const _bakedOracleSet: string[] = [
  ...(import.meta.env.VITE_ORACLE_PUBKEYS ?? '').split(','),
  import.meta.env.VITE_ORACLE_PUBKEY ?? '',
].map(s => s.trim().toLowerCase()).filter(Boolean);

let _oracleSet: string[] = [..._bakedOracleSet];

export function setOraclePubkey(pk: string): void {
  if (_bakedOracleSet.length) return;       // production: baked set is final, ignore server
  const k = pk?.trim().toLowerCase();
  if (k && !_oracleSet.includes(k)) _oracleSet.push(k);  // dev only: trust local server's key
}
export function getOraclePubkeys(): string[] { return _oracleSet; }
export function getOraclePubkey(): string { return _oracleSet[0] ?? ''; }
export function isTrustedOracle(pubkey: string): boolean {
  return _oracleSet.includes(pubkey?.toLowerCase());
}

// ── In-memory inventory ───────────────────────────────────────────────────────
// Items live on Nostr relays, published by the server oracle on mint.
// Loaded into memory on login via fetchInventoryFromRelays.

let _inventory: OwnedItem[] = [];
let _mintedEvents: Map<string, object> = new Map(); // instanceId → raw signed event
// Persistent accumulation of every item event seen this session, keyed by d-tag
// (newest wins). Lets partial relay coverage converge across fetches/browsers.
const _itemEventsByDTag: Map<string, any> = new Map();

export function getInventory(): OwnedItem[] { return _inventory; }

export function getInventoryWithDefs(): Array<{ owned: OwnedItem; def: ItemDef }> {
  return _inventory
    .map(owned => ({ owned, def: ITEM_CATALOG.find(d => d.id === owned.itemId)! }))
    .filter(e => e.def);
}

export function getMintedEvent(instanceId: string): object | undefined {
  return _mintedEvents.get(instanceId);
}

// Called by presenceService when server returns a signed mint event
// Server-authoritative burned (discarded/transferred-away) instance ids. Relay
// burn tombstones don't always reach every device, so the server also tracks burns
// and tells us — we filter these out of inventory regardless of relay coverage.
// This fixes discarded items reappearing on a different browser (e.g. Safari).
const _burnedInstances = new Set<string>();
export function markBurnedInstances(ids: string[], replace = false): void {
  if (replace) _burnedInstances.clear();
  let changed = false;
  for (const id of ids) if (id && !_burnedInstances.has(id)) { _burnedInstances.add(id); changed = true; }
  if (!changed) return;
  // Drop any now-burned items from the live inventory + accumulation map
  for (const id of _burnedInstances) {
    if (_inventory.find(i => i.instanceId === id)) removeItem(id);
    else _itemEventsByDTag.delete(id);
  }
  window.dispatchEvent(new CustomEvent('nd-inventory-update'));
}

// Instance ids that arrived live THIS session (caught/won/gifted/traded/bought) —
// used to show a "NEW" badge in the bag. In-memory only; items loaded from relays
// on login are NOT flagged. Cleared once the player has seen them.
const _newInstances = new Set<string>();
export function isNewItem(instanceId: string): boolean { return _newInstances.has(instanceId); }
export function clearNewItem(instanceId: string): void { _newInstances.delete(instanceId); }

export function receiveMintedEvent(event: any, isNew = false): OwnedItem | null {
  // Trust gate (every mint path funnels through here): only count items signed by
  // a key in the oracle trust set. In dev before the set is populated we allow it.
  if (_oracleSet.length && !isTrustedOracle(event.pubkey)) {
    console.warn('[Items] Rejected item from untrusted signer', String(event.pubkey).slice(0, 8));
    return null;
  }

  const instanceId   = event.tags?.find((t: string[]) => t[0] === 'd')?.[1];
  const itemId       = event.tags?.find((t: string[]) => t[0] === 'item_id')?.[1];
  const acquiredFrom = (event.tags?.find((t: string[]) => t[0] === 'source')?.[1] ?? 'found') as OwnedItem['acquiredFrom'];

  if (instanceId && _burnedInstances.has(instanceId)) return null; // discarded/transferred away

  if (!instanceId || !itemId) return null;
  if (!ITEM_CATALOG.find(d => d.id === itemId)) return null;
  if (_inventory.find(i => i.instanceId === instanceId)) return null; // dedup

  const entry: OwnedItem = {
    instanceId,
    itemId,
    acquiredAt: (event.created_at ?? Math.floor(Date.now() / 1000)) * 1000,
    acquiredFrom,
  };
  _inventory.push(entry);
  _mintedEvents.set(instanceId, event);
  if (isNew) _newInstances.add(instanceId); // flag for the "NEW" badge
  // Track in the accumulation map so a later relay fetch rebuild won't drop a
  // freshly-minted item before relays have indexed it.
  const prev = _itemEventsByDTag.get(instanceId);
  if (!prev || (event.created_at ?? 0) >= (prev.created_at ?? 0)) _itemEventsByDTag.set(instanceId, event);
  // Server already published to relays — no client action needed
  window.dispatchEvent(new CustomEvent('nd-inventory-update'));
  return entry;
}

export function removeItem(instanceId: string): boolean {
  const idx = _inventory.findIndex(i => i.instanceId === instanceId);
  if (idx === -1) return false;
  _inventory.splice(idx, 1);
  _mintedEvents.delete(instanceId);
  _newInstances.delete(instanceId);
  _itemEventsByDTag.delete(instanceId); // drop locally so a rebuild won't re-add
  window.dispatchEvent(new CustomEvent('nd-inventory-update'));
  return true;
}

export function hasItemType(itemId: string): boolean {
  return _inventory.some(i => i.itemId === itemId);
}

// Permanently discard an item — asks the oracle to publish a NIP-09 deletion
// so it won't reload on next login, and removes it from memory now.
export async function discardItem(instanceId: string): Promise<boolean> {
  const event = _mintedEvents.get(instanceId);
  if (event) {
    const { sendItemDiscardRequest } = await import('../nostr/presenceService');
    sendItemDiscardRequest(event);
  }
  removeItem(instanceId);
  return true;
}

export function getCompletedSets(): ItemSet[] {
  const inv = new Set(_inventory.map(i => i.itemId));
  return ITEM_SETS.filter(s => s.itemIds.every(id => inv.has(id)));
}

export function getSetProgress(set: ItemSet): { owned: number; total: number } {
  const inv = new Set(_inventory.map(i => i.itemId));
  return { owned: set.itemIds.filter(id => inv.has(id)).length, total: set.itemIds.length };
}

// Fetch inventory from relays on login (cross-device persistence)
export async function fetchInventoryFromRelays(ownerPubkey: string): Promise<void> {
  if (!_oracleSet.length) {
    console.warn('[Items] fetchInventory skipped — no trusted oracle key yet');
    return;
  }
  try {
    const { queryEvents } = await import('../nostr/nostrService');
    console.log(`[Items] Fetching inventory for ${ownerPubkey.slice(0,8)}… trusting ${_oracleSet.length} oracle key(s)`);

    // Must match PUBLISH_RELAYS in server.ts so we reach whichever relays hold
    // the items + burn tombstones, regardless of browser relay reachability.
    const ITEM_RELAYS = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
      'wss://offchain.pub',
      'wss://nostr.mom',
      'wss://relay.snort.social',
    ];
    const rawEvents = await queryEvents({
      kinds:   [30078],
      authors: _oracleSet,            // OR-match: trust items signed by any oracle in the set
      '#p':    [ownerPubkey],
      '#t':    ['nditem'],
    }, ITEM_RELAYS);
    console.log(`[Items] Relay returned ${rawEvents.length} item events`);

    // MERGE into a persistent per-d-tag map (newest wins) rather than replacing.
    // Different browsers/relays return different subsets; merging means coverage
    // converges over successive fetches, and a burn tombstone (newer) still wins.
    for (const e of rawEvents) {
      // Defense in depth: relays should honor the authors filter, but verify the
      // signer is actually in our trust set so a rogue relay can't inject fakes.
      if (!isTrustedOracle(e.pubkey)) continue;
      const d = e.tags?.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) continue;
      const prev = _itemEventsByDTag.get(d);
      if (!prev || e.created_at > prev.created_at) _itemEventsByDTag.set(d, e);
    }

    // Rebuild inventory from the merged map, filtering burned tombstones AND the
    // server's authoritative burned set (covers burns whose relay tombstone didn't
    // reach this device — e.g. discarded items reappearing on Safari).
    _inventory = [];
    _mintedEvents = new Map();
    let burned = 0;
    for (const [dTag, event] of _itemEventsByDTag) {
      if (event.tags?.find((t: string[]) => t[0] === 'burned') || _burnedInstances.has(dTag)) { burned++; continue; }
      receiveMintedEvent(event);
    }
    console.log(`[Items] Inventory: ${_inventory.length} items (${burned} burned) from ${_itemEventsByDTag.size} known events`);
    window.dispatchEvent(new CustomEvent('nd-inventory-update'));
  } catch (e) {
    console.warn('[Items] fetchInventory failed:', e);
  }
}

// Read-only: fetch ANOTHER player's owned items (for trade offers). Returns one
// entry per item TYPE they currently own (deduped, burned filtered). Does NOT
// touch our own inventory state.
export async function fetchOwnedItemsOf(ownerPubkey: string): Promise<ItemDef[]> {
  if (!_oracleSet.length || !ownerPubkey) return [];
  try {
    const { queryEvents } = await import('../nostr/nostrService');
    const raw = await queryEvents({
      kinds:   [30078],
      authors: _oracleSet,
      '#p':    [ownerPubkey],
      '#t':    ['nditem'],
    }, MARKET_RELAYS);

    // Newest-per-d-tag so burn tombstones win
    const byD = new Map<string, any>();
    for (const e of raw) {
      if (!isTrustedOracle(e.pubkey)) continue;
      const d = e.tags?.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) continue;
      if (!byD.has(d) || e.created_at > byD.get(d).created_at) byD.set(d, e);
    }

    const seen = new Set<string>();
    const defs: ItemDef[] = [];
    for (const e of byD.values()) {
      if (e.tags?.find((t: string[]) => t[0] === 'burned')) continue;
      const itemId = e.tags?.find((t: string[]) => t[0] === 'item_id')?.[1];
      if (!itemId || seen.has(itemId)) continue;
      const def = ITEM_CATALOG.find(d => d.id === itemId);
      if (!def) continue;
      seen.add(itemId);
      defs.push(def);
    }
    return defs;
  } catch { return []; }
}

// Streaming variant of fetchOwnedItemsOf — calls onUpdate with the deduped item
// list as events arrive from each relay (instead of blocking until the slowest
// relay responds), so the trade picker fills in within a few hundred ms. Returns
// a stop() function; it also auto-stops after durationMs.
//
// To avoid a flicker where an item briefly appears then vanishes (its mint event
// arrives before its burn tombstone from a slower relay), we do NOT render on every
// event. Instead we collect events and only emit the reconciled list once activity
// goes quiet for settleMs — so mints+burns are merged before anything is shown.
export function streamOwnedItemsOf(
  ownerPubkey: string,
  onUpdate: (defs: ItemDef[]) => void,
  durationMs = 4000,
  settleMs = 650,
  excludeInstanceIds?: Set<string>,
): () => void {
  if (!_oracleSet.length || !ownerPubkey) { onUpdate([]); return () => {}; }
  const byD = new Map<string, any>();
  let unsub = () => {};
  let hardTimer: ReturnType<typeof setTimeout>;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = () => {
    const seen = new Set<string>();
    const defs: ItemDef[] = [];
    for (const [instanceId, e] of byD) {
      if (e.tags?.find((t: string[]) => t[0] === 'burned')) continue;
      // Exclude items that aren't actually tradeable: listed (escrowed), sold, or
      // reserved for a bid winner. Instance-level so unlisted copies still show.
      if (excludeInstanceIds?.has(instanceId) || _soldInstances.has(instanceId) || _reservedInstances.has(instanceId)) continue;
      const itemId = e.tags?.find((t: string[]) => t[0] === 'item_id')?.[1];
      if (!itemId || seen.has(itemId)) continue;
      const def = ITEM_CATALOG.find(d => d.id === itemId);
      if (!def) continue;
      seen.add(itemId);
      defs.push(def);
    }
    onUpdate(defs);
  };

  import('../nostr/nostrService').then(({ subscribeEvents }) => {
    unsub = subscribeEvents({
      kinds:   [30078],
      authors: _oracleSet,
      '#p':    [ownerPubkey],
      '#t':    ['nditem'],
    }, (e) => {
      if (!isTrustedOracle(e.pubkey)) return;
      const d = e.tags?.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) return;
      const prev = byD.get(d);
      if (!prev || e.created_at > prev.created_at) byD.set(d, e);
      // (re)arm the settle timer — emit only once the burst quiets down
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(emit, settleMs);
    }, MARKET_RELAYS);
    // Safety cap: always emit by durationMs (also covers the empty-inventory case)
    hardTimer = setTimeout(() => { if (settleTimer) clearTimeout(settleTimer); emit(); unsub(); }, durationMs);
  });

  return () => { if (settleTimer) clearTimeout(settleTimer); clearTimeout(hardTimer); unsub(); };
}

// ── Market listings (local + Nostr) ──────────────────────────────────────────

// Your own listings — RELAY-BACKED, in-memory only (no localStorage). Populated
// from relays via fetchMyListings() on bazaar open, so they're identical on every
// browser/device. listItem/delistItem update this in-memory + publish to relays.
let _myListings: MarketListing[] = [];

function saveListings(listings: MarketListing[]): void { _myListings = listings; }
function loadListings(): MarketListing[] { return _myListings; }

export function getLocalListings(): MarketListing[] { return _myListings; }

// Reconcile your listings with what's actually published on the relays.
export async function fetchMyListings(): Promise<void> {
  const { pubkey } = authStore.getState();
  if (!pubkey) return;
  try {
    const { queryEvents } = await import('../nostr/nostrService');
    const events = await queryEvents({ kinds: [30402], authors: [pubkey], '#t': ['ndmarket'], limit: 100 }, MARKET_RELAYS);

    // Dedupe by d-tag keeping newest (a delisted tombstone, newer, wins)
    const byD = new Map<string, any>();
    for (const e of events) {
      const d = e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) continue;
      if (!byD.has(d) || e.created_at > byD.get(d).created_at) byD.set(d, e);
    }

    const live: MarketListing[] = [];
    for (const e of byD.values()) {
      if (e.tags.find((t: string[]) => t[0] === 'delisted')) continue;
      const itemId = e.tags.find((t: string[]) => t[0] === 'item_id')?.[1] ?? '';
      const instanceId = e.tags.find((t: string[]) => t[0] === 'instance_id')?.[1] ?? '';
      const def = ITEM_CATALOG.find(d => d.id === itemId);
      const dTag = e.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
      if (!def || !instanceId) continue;
      // If this item already sold, drop it from My Listings AND auto-publish a
      // delist tombstone (using the dTag we already have here) so the stale
      // listing disappears from everyone's market.
      if (_soldInstances.has(instanceId) && dTag) { publishDelistTombstone(dTag); continue; }
      let note: string | undefined; let price = 0;
      const priceTag = e.tags.find((t: string[]) => t[0] === 'price')?.[1];
      try { const c = JSON.parse(e.content); note = c.note; price = Number(priceTag ?? c.price ?? 0); }
      catch { price = Number(priceTag ?? 0); }
      const item = _inventory.find(i => i.instanceId === instanceId)
        ?? { instanceId, itemId, acquiredAt: e.created_at * 1000, acquiredFrom: 'caught' as const };
      live.push({ id: e.id, dTag, sellerPubkey: pubkey, item, def, price, note, listedAt: e.created_at * 1000 });
    }
    saveListings(live);
    window.dispatchEvent(new CustomEvent('nd-market-update'));
  } catch { /* offline — keep cached listings */ }
}

export interface ListResult { ok: boolean; reason?: string }

// Items mid-listing. The _myListings guard alone can't stop a double-click race
// because _myListings is only populated AFTER the escrow round-trip; this lock is
// held for the whole listItem call so a second click is rejected immediately.
const _listingInFlight = new Set<string>();
export function isListingInFlight(instanceId: string): boolean { return _listingInFlight.has(instanceId); }

export async function listItem(instanceId: string, price: number, note?: string): Promise<ListResult> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return { ok: false, reason: 'no_signer' };

  const item = _inventory.find(i => i.instanceId === instanceId);
  if (!item) return { ok: false, reason: 'no_item' };
  const def = ITEM_CATALOG.find(d => d.id === item.itemId);
  if (!def) return { ok: false, reason: 'no_item' };

  // Guard against double-listing: already listed, or a list is already in flight.
  if (_listingInFlight.has(instanceId)) return { ok: false, reason: 'duplicate' };
  if (loadListings().some(l => l.item.instanceId === instanceId)) return { ok: false, reason: 'duplicate' };
  // Can't list something you've already offered in a trade — cancel that first.
  if (hasPendingOutgoingOffer(instanceId)) return { ok: false, reason: 'pending_offer' };
  _listingInFlight.add(instanceId);
  // Hide the item from inventory immediately so the card (and its LIST button)
  // can't be clicked again while we escrow.
  window.dispatchEvent(new CustomEvent('nd-inventory-update'));

  try {
    // We need our own Lightning address: it's where buyers pay, and the oracle
    // probes it for LNURL-verify support before escrowing.
    const { fetchSparkAddress } = await import('../nostr/nostrService');
    const lud16 = await fetchSparkAddress(pubkey).catch(() => null);
    if (!lud16) return { ok: false, reason: 'no_lightning_address' };

    // Escrow the item to the oracle (held safely while listed). Only if this
    // succeeds do we publish the public listing.
    const { escrowItemRequest } = await import('../nostr/presenceService');
    const esc = await escrowItemRequest(instanceId, price, lud16, def.name);
    if (!esc.ok) return { ok: false, reason: esc.reason };

    // Escrowed → it's now owned by the oracle, so drop it from our inventory.
    removeItem(instanceId);

    const listingId = `ndlisting_${instanceId}_${Date.now()}`;
    const listing: MarketListing = {
      id: listingId, dTag: listingId, sellerPubkey: pubkey, item, def, price, listedAt: Date.now(), note,
    };
    saveListings([...loadListings(), listing]);

    // Publish to Nostr as kind:30402
    try {
      const unsigned = {
        kind: 30402,
        pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', listingId],
          ['t', 'ndmarket'],
          ['t', `ndcat:${def.category}`],
          ['t', `ndrarity:${def.rarity}`],
          ['price', String(price), 'SATS'],
          ['item_id', def.id],
          ['instance_id', instanceId],
          ['client', 'Nostr District'],
        ],
        content: JSON.stringify({ name: def.name, emoji: def.emoji, description: def.description, note, price }),
      };
      const signed = await signEvent(unsigned);
      await publishEvent(signed);
      listing.id = signed.id; // real event id for delisting
      saveListings(loadListings().map(l => l.id === listingId ? { ...l, id: signed.id } : l));
    } catch {
      // offline or no signing — listing stays local
    }

    window.dispatchEvent(new CustomEvent('nd-market-update'));
    window.dispatchEvent(new CustomEvent('nd-inventory-update'));
    return { ok: true };
  } finally {
    _listingInFlight.delete(instanceId);
  }
}

// Replace a listing event (same d-tag) with a delisted tombstone. Keeps the
// ndmarket t-tag + adds 'delisted' marker so a buyer's query returns it and
// filters it out (newest-wins) — reliable even on relays that ignore kind:5.
async function publishDelistTombstone(dTag: string): Promise<void> {
  try {
    const { pubkey } = authStore.getState();
    if (!pubkey) return;
    const tombstone = {
      kind: 30402,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', dTag], ['t', 'ndmarket'], ['delisted', '1']],
      content: '',
    };
    const signed = await signEvent(tombstone);
    await publishEvent(signed);
  } catch { /* offline — local delist still applied */ }
}

export async function delistItem(listingId: string): Promise<{ ok: boolean; reason?: string }> {
  const listing = loadListings().find(l => l.id === listingId);
  if (!listing) return { ok: true };

  // Return the escrowed item to us before tearing down the listing. 'not_escrowed'
  // (legacy/already returned) and 'already_sold' (buyer took it) are fine to clean
  // up; any other failure means we couldn't get the item back, so abort.
  const { unescrowItemRequest } = await import('../nostr/presenceService');
  const res = await unescrowItemRequest(listing.item.instanceId);
  if (!res.ok && res.reason !== 'not_escrowed' && res.reason !== 'already_sold') {
    return { ok: false, reason: res.reason };
  }

  saveListings(loadListings().filter(l => l.id !== listingId));
  window.dispatchEvent(new CustomEvent('nd-market-update'));
  await publishDelistTombstone(listing.dTag);
  return { ok: true };
}

// ── Fetch market listings from relays ─────────────────────────────────────────

export interface RemoteListing {
  eventId: string;
  dTag: string;
  sellerPubkey: string;
  itemId: string;
  itemDef: ItemDef | null;
  price: number;
  note?: string;
  listedAt: number;
  instanceId: string;
}

let _remoteListings: RemoteListing[] = [];
let _fetchedAt = 0;
let _fetchInProgress = false;

// Server-authoritative set of sold instance ids. Sold items are hidden from the
// market everywhere (so a stale seller listing can't keep showing a sold item).
// Populated from the server's sold_list on join + item_sold broadcasts on sale.
const _soldInstances = new Set<string>();
export function markSoldInstances(ids: string[]): void {
  let changed = false;
  for (const id of ids) if (id && !_soldInstances.has(id)) { _soldInstances.add(id); changed = true; }
  if (!changed) return;
  // Hide from the public browse list
  _remoteListings = _remoteListings.filter(l => !_soldInstances.has(l.instanceId));
  // If any of MY listings just sold, drop them from My Listings and tombstone the
  // 30402 so it disappears for everyone (the seller is the only one who can sign it).
  const keep: MarketListing[] = [];
  for (const l of _myListings) {
    if (_soldInstances.has(l.item.instanceId)) publishDelistTombstone(l.dTag);
    else keep.push(l);
  }
  _myListings = keep;
  window.dispatchEvent(new CustomEvent('nd-market-update'));
}

export function getCachedRemoteListings(): RemoteListing[] {
  return _remoteListings.filter(l => !_soldInstances.has(l.instanceId));
}

export function isItemSold(instanceId: string): boolean { return _soldInstances.has(instanceId); }

// Instances with an accepted bid awaiting payment — buyers can't buy or bid on
// these until the winner pays (or declines, which re-opens them).
const _reservedInstances = new Set<string>();
export function isItemReserved(instanceId: string): boolean { return _reservedInstances.has(instanceId); }
export function markReserved(ids: string[], replace = false): void {
  if (replace) _reservedInstances.clear();
  for (const id of ids) if (id) _reservedInstances.add(id);
  window.dispatchEvent(new CustomEvent('nd-market-update'));
}
export function markUnreserved(ids: string[]): void {
  let changed = false;
  for (const id of ids) if (_reservedInstances.delete(id)) changed = true;
  if (changed) window.dispatchEvent(new CustomEvent('nd-market-update'));
}

export async function fetchMarketListings(): Promise<RemoteListing[]> {
  if (Date.now() - _fetchedAt < 60_000) return _remoteListings; // cache hit — no re-render trigger
  if (_fetchInProgress) return _remoteListings;                  // already fetching — don't stack
  _fetchInProgress = true;

  try {
    const { queryEvents } = await import('../nostr/nostrService');
    const { pubkey: myPubkey } = authStore.getState();
    const events = await queryEvents({ kinds: [30402], '#t': ['ndmarket'], limit: 200 }, MARKET_RELAYS);

    // Dedupe by d-tag keeping newest (a delisted tombstone, newer, wins)
    const byD = new Map<string, any>();
    for (const e of events) {
      const d = e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) continue;
      if (!byD.has(d) || e.created_at > byD.get(d).created_at) byD.set(d, e);
    }

    _remoteListings = [...byD.values()]
      .filter(e => e.pubkey !== myPubkey)
      .filter(e => !e.tags.find((t: string[]) => t[0] === 'delisted')) // drop delisted
      .map(eventToRemoteListing)
      .filter((l): l is RemoteListing => !!l)
      .filter(l => !_soldInstances.has(l.instanceId)); // hide already-sold items

    _fetchedAt = Date.now();
  } catch { /* network unavailable */ } finally {
    _fetchInProgress = false;
  }

  return _remoteListings;
}

const MARKET_RELAYS = [
  'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net',
  'wss://offchain.pub', 'wss://nostr.mom', 'wss://relay.snort.social',
];

function eventToRemoteListing(e: any): RemoteListing | null {
  const itemId   = e.tags.find((t: string[]) => t[0] === 'item_id')?.[1] ?? '';
  const itemDef  = ITEM_CATALOG.find(d => d.id === itemId) ?? null;
  if (!itemDef) return null;
  const dTag     = e.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
  const instId   = e.tags.find((t: string[]) => t[0] === 'instance_id')?.[1] ?? '';
  const priceTag = e.tags.find((t: string[]) => t[0] === 'price')?.[1];
  let note: string | undefined; let price = 0;
  try { const c = JSON.parse(e.content); note = c.note; price = Number(priceTag ?? c.price ?? 0); }
  catch { price = Number(priceTag ?? 0); }
  return { eventId: e.id, dTag, sellerPubkey: e.pubkey, itemId, itemDef, price, note, listedAt: e.created_at * 1000, instanceId: instId };
}

// The instanceIds a given player currently has listed (escrowed for sale) — so the
// trade picker can exclude them (you can't trade for someone's for-sale items).
export async function fetchListedInstanceIdsOf(sellerPubkey: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (!sellerPubkey) return out;
  try {
    const { queryEvents } = await import('../nostr/nostrService');
    const events = await queryEvents({ kinds: [30402], authors: [sellerPubkey], '#t': ['ndmarket'], limit: 200 }, MARKET_RELAYS);
    const byD = new Map<string, any>();
    for (const e of events) {
      const d = e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) continue;
      if (!byD.has(d) || e.created_at > byD.get(d).created_at) byD.set(d, e);
    }
    for (const e of byD.values()) {
      if (e.tags.find((t: string[]) => t[0] === 'delisted')) continue;
      const inst = e.tags.find((t: string[]) => t[0] === 'instance_id')?.[1];
      if (inst) out.add(inst);
    }
    return out;
  } catch { return out; }
}

// Live market subscription — fires onUpdate whenever a new listing or delist arrives.
export function subscribeMarket(onUpdate: () => void): () => void {
  let unsub = () => {};
  const dTagSeen = new Map<string, number>(); // d-tag → newest created_at seen
  import('../nostr/nostrService').then(({ subscribeEvents }) => {
    unsub = subscribeEvents({ kinds: [30402], '#t': ['ndmarket'] }, (e) => {
      const { pubkey: myPubkey } = authStore.getState();
      const d = e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) return;
      if ((dTagSeen.get(d) ?? 0) >= e.created_at) return; // older than what we have
      dTagSeen.set(d, e.created_at);

      // Drop any existing entry for this d-tag, then re-add unless delisted/own
      _remoteListings = _remoteListings.filter(l => l.dTag !== d);
      const delisted = e.tags.find((t: string[]) => t[0] === 'delisted');
      if (!delisted && e.pubkey !== myPubkey) {
        const rl = eventToRemoteListing(e);
        if (rl && !_soldInstances.has(rl.instanceId)) _remoteListings = [rl, ..._remoteListings];
      }
      onUpdate();
    }, MARKET_RELAYS);
  });
  return () => unsub();
}

// ── Bidding (relay-backed best-offer) ─────────────────────────────────────────
// A bid is a signed Nostr event by the bidder (kind 30078, t=ndbid, d=instanceId,
// p=seller). One bid per bidder per item (replaceable). Withdraw = tombstone.

export interface MarketBid { buyer: string; amount: number; at: number }

export async function placeBid(listing: RemoteListing, amount: number): Promise<{ ok: boolean; reason?: string }> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return { ok: false, reason: 'no_signer' };
  if (listing.sellerPubkey === pubkey) return { ok: false, reason: 'own_listing' };
  if (_soldInstances.has(listing.instanceId)) return { ok: false, reason: 'already_sold' };
  if (_reservedInstances.has(listing.instanceId)) return { ok: false, reason: 'reserved_for_winner' };
  try {
    const signed = await signEvent({
      kind: 30078, pubkey, created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', listing.instanceId], ['t', 'ndbid'], ['p', listing.sellerPubkey],
        ['amount', String(amount)], ['item_id', listing.itemId], ['instance_id', listing.instanceId],
        ['client', 'Nostr District'],
      ],
      content: '',
    });
    await publishEvent(signed);
    // DM the seller so they get a push (Damus/iOS) with the bid amount, even when
    // offline. Bids are public events anyway, so nothing private is leaked.
    try {
      const { sendDirectMessage } = await import('../nostr/dmService');
      const name = listing.itemDef?.name ?? listing.itemId;
      sendDirectMessage(listing.sellerPubkey,
        `New bid: ${amount} sats on your ${name} in Nostr District. Open /bazaar → Offers to accept or decline.`).catch(() => {});
    } catch { /* DM is best-effort */ }
    return { ok: true };
  } catch { return { ok: false, reason: 'publish_failed' }; }
}

export async function withdrawBid(instanceId: string, sellerPubkey: string): Promise<void> {
  const { pubkey } = authStore.getState();
  if (!pubkey) return;
  try {
    const signed = await signEvent({
      kind: 30078, pubkey, created_at: Math.floor(Date.now() / 1000),
      tags: [['d', instanceId], ['t', 'ndbid'], ['p', sellerPubkey], ['withdrawn', '1']],
      content: '',
    });
    await publishEvent(signed);
  } catch { /* offline */ }
}

// Seller: fetch all live bids on their listings → { instanceId: bids[] (high→low) }.
export async function fetchBidsForListings(sellerPubkey: string): Promise<Record<string, MarketBid[]>> {
  if (!sellerPubkey) return {};
  try {
    const { queryEvents } = await import('../nostr/nostrService');
    const events = await queryEvents({ kinds: [30078], '#t': ['ndbid'], '#p': [sellerPubkey], limit: 300 }, MARKET_RELAYS);
    const byKey = new Map<string, any>(); // newest per (bidder, item)
    for (const e of events) {
      const d = e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) continue;
      const key = e.pubkey + '|' + d;
      if (!byKey.has(key) || e.created_at > byKey.get(key).created_at) byKey.set(key, e);
    }
    const out: Record<string, MarketBid[]> = {};
    for (const e of byKey.values()) {
      if (e.tags.find((t: string[]) => t[0] === 'withdrawn')) continue;
      const instanceId = e.tags.find((t: string[]) => t[0] === 'instance_id')?.[1] ?? e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      const amount = Math.floor(Number(e.tags.find((t: string[]) => t[0] === 'amount')?.[1] ?? '0'));
      if (!instanceId || !(amount >= 1)) continue;
      if (_soldInstances.has(instanceId)) continue;
      (out[instanceId] ??= []).push({ buyer: e.pubkey, amount, at: e.created_at * 1000 });
    }
    for (const id in out) out[id].sort((a, b) => b.amount - a.amount);
    return out;
  } catch { return {}; }
}

export function subscribeBids(sellerPubkey: string, onUpdate: () => void): () => void {
  let unsub = () => {};
  if (!sellerPubkey) return unsub;
  import('../nostr/nostrService').then(({ subscribeEvents }) => {
    unsub = subscribeEvents({ kinds: [30078], '#t': ['ndbid'], '#p': [sellerPubkey] }, () => onUpdate(), MARKET_RELAYS);
  });
  return () => unsub();
}

// Bidder: fetch your OWN active bids (so you can see + cancel them). One per item.
export interface MyBid { instanceId: string; itemId: string; amount: number; sellerPubkey: string }
export async function fetchMyBids(myPubkey: string): Promise<MyBid[]> {
  if (!myPubkey) return [];
  try {
    const { queryEvents } = await import('../nostr/nostrService');
    const events = await queryEvents({ kinds: [30078], authors: [myPubkey], '#t': ['ndbid'], limit: 200 }, MARKET_RELAYS);
    const byD = new Map<string, any>();
    for (const e of events) {
      const d = e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) continue;
      if (!byD.has(d) || e.created_at > byD.get(d).created_at) byD.set(d, e);
    }
    const out: MyBid[] = [];
    for (const e of byD.values()) {
      if (e.tags.find((t: string[]) => t[0] === 'withdrawn')) continue;
      const instanceId = e.tags.find((t: string[]) => t[0] === 'instance_id')?.[1] ?? e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      const itemId = e.tags.find((t: string[]) => t[0] === 'item_id')?.[1] ?? '';
      const amount = Math.floor(Number(e.tags.find((t: string[]) => t[0] === 'amount')?.[1] ?? '0'));
      const sellerPubkey = e.tags.find((t: string[]) => t[0] === 'p')?.[1] ?? '';
      if (!instanceId || !(amount >= 1) || _soldInstances.has(instanceId)) continue;
      out.push({ instanceId, itemId, amount, sellerPubkey });
    }
    return out;
  } catch { return []; }
}

// ── Wins (durable "you won — pay now" markers) ────────────────────────────────
export interface WinNotice { instanceId: string; itemId: string; price: number }

export async function fetchMyWins(myPubkey: string): Promise<WinNotice[]> {
  if (!_oracleSet.length || !myPubkey) return [];
  try {
    const { queryEvents } = await import('../nostr/nostrService');
    const events = await queryEvents({ kinds: [30078], authors: _oracleSet, '#t': ['ndwin'], '#p': [myPubkey], limit: 100 }, MARKET_RELAYS);

    // Also load the oracle-held escrow items so we can validate each win against
    // the live source of truth — a marker only counts if the item still exists,
    // isn't burned, and is still reserved for ME. This drops stale/resolved markers.
    const escrowEvents = await queryEvents({ kinds: [30078], authors: _oracleSet, '#p': _oracleSet, '#t': ['nditem'] }, MARKET_RELAYS);
    const escrowByD = new Map<string, any>();
    for (const e of escrowEvents) {
      if (!isTrustedOracle(e.pubkey)) continue;
      const d = e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) continue;
      if (!escrowByD.has(d) || e.created_at > escrowByD.get(d).created_at) escrowByD.set(d, e);
    }

    const byD = new Map<string, any>();
    for (const e of events) {
      if (!isTrustedOracle(e.pubkey)) continue;
      const d = e.tags.find((t: string[]) => t[0] === 'd')?.[1];
      if (!d) continue;
      if (!byD.has(d) || e.created_at > byD.get(d).created_at) byD.set(d, e);
    }
    const out: WinNotice[] = [];
    for (const e of byD.values()) {
      if (e.tags.find((t: string[]) => t[0] === 'withdrawn')) continue;
      const instanceId = e.tags.find((t: string[]) => t[0] === 'instance_id')?.[1];
      const itemId = e.tags.find((t: string[]) => t[0] === 'item_id')?.[1] ?? '';
      const price = Math.floor(Number(e.tags.find((t: string[]) => t[0] === 'winning_price')?.[1] ?? '0'));
      if (!instanceId || !(price >= 1) || _soldInstances.has(instanceId)) continue;
      // Validate against the live escrow: must still exist, not burned, reserved for me.
      const esc = escrowByD.get(instanceId);
      const burned = esc?.tags?.find((t: string[]) => t[0] === 'burned');
      const reservedFor = esc?.tags?.find((t: string[]) => t[0] === 'awaiting_winner')?.[1];
      if (!esc || burned || reservedFor !== myPubkey) continue;
      out.push({ instanceId, itemId, price });
    }
    return out;
  } catch { return []; }
}

export function subscribeWins(myPubkey: string, onUpdate: () => void): () => void {
  let unsub = () => {};
  if (!_oracleSet.length || !myPubkey) return unsub;
  import('../nostr/nostrService').then(({ subscribeEvents }) => {
    unsub = subscribeEvents({ kinds: [30078], authors: _oracleSet, '#t': ['ndwin'], '#p': [myPubkey] },
      (e) => { if (isTrustedOracle(e.pubkey)) onUpdate(); }, MARKET_RELAYS);
  });
  return () => unsub();
}

// Pay for an item you won via a bid. The server prices it at your winning bid.
export async function payWonItem(instanceId: string, onStatus?: (m: string) => void): Promise<PurchaseResult> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return { status: 'no_signer' };
  const { purchaseInitRequest } = await import('../nostr/presenceService');
  onStatus?.('Preparing…');
  const init = await purchaseInitRequest(instanceId);
  if (init.error || !init.bolt11) {
    if (init.error === 'already_sold' || init.error === 'item_gone') return { status: 'unavailable' };
    return { status: 'payment_failed' };
  }
  onStatus?.('Paying…');
  const { payBolt11 } = await import('../nostr/zapService');
  const paid = await payBolt11(init.bolt11);
  if (paid) return { status: 'ok' };
  return { status: 'invoice', invoice: init.bolt11 };
}

// ── Purchase (buy from market listing) ───────────────────────────────────────

export interface PurchaseResult {
  status: 'ok' | 'no_signer' | 'payment_failed' | 'no_address' | 'unavailable' | 'invoice';
  invoice?: string;     // bolt11 for QR fallback when the in-game wallet can't cover it
  reason?: string;      // server reason (e.g. reserved_for_winner) for a precise message
}

// Drop a listing from the local market view (after a successful/initiated buy).
function dropLocalListing(listing: RemoteListing): void {
  markSoldInstances([listing.instanceId]);
  _remoteListings = _remoteListings.filter(l => l.eventId !== listing.eventId);
  window.dispatchEvent(new CustomEvent('nd-market-update'));
}

// Escrow purchase flow:
//   1. Ask the server for an invoice (it fetches one from the SELLER's address)
//   2. Pay the bolt11 with our wallet (Spark/WebLN/NWC) — funds go to the seller
//   3. The server verifies payment (LNURL verify) and releases the escrowed item;
//      it arrives via item_minted. If our wallet can't cover it, we return the
//      invoice so the caller can show a QR — the server still auto-releases on pay.
export async function purchaseListing(listing: RemoteListing, onStatus?: (msg: string) => void): Promise<PurchaseResult> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return { status: 'no_signer' };

  const { purchaseInitRequest } = await import('../nostr/presenceService');

  onStatus?.('Reserving item…');
  const init = await purchaseInitRequest(listing.instanceId);
  if (init.error || !init.bolt11) {
    // Pre-payment failure — nothing was charged. These mean the item isn't buyable
    // by us right now; surface the precise reason so we don't say "payment failed".
    const unavailable = ['already_sold', 'item_gone', 'not_listed', 'reserved', 'reserved_for_winner', 'own_listing'];
    if (init.error && unavailable.includes(init.error)) {
      if (init.error !== 'reserved_for_winner') dropLocalListing(listing); // winner-reserved item may still resolve to others if they don't pay
      return { status: 'unavailable', reason: init.error };
    }
    return { status: 'payment_failed', reason: init.error };
  }

  // Try to pay from a connected wallet. Funds go straight to the seller.
  onStatus?.('Paying…');
  const { payBolt11 } = await import('../nostr/zapService');
  const paid = await payBolt11(init.bolt11);
  if (paid) {
    onStatus?.('Confirming…'); // server verifies + releases; item arrives via item_minted
    dropLocalListing(listing);
    return { status: 'ok' };
  }

  // Wallet couldn't cover it → hand back the invoice for a QR. The server is
  // already polling for payment and will release the item once it settles.
  dropLocalListing(listing);
  return { status: 'invoice', invoice: init.bolt11 };
}

// ── Direct send (gift via oracle transfer) ────────────────────────────────────

// Accept npub or hex; return hex or null if invalid
export function normalizePubkey(input: string): string | null {
  const s = input.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase();
  if (s.startsWith('npub1')) {
    try {
      const d = nip19.decode(s);
      if (d.type === 'npub') return d.data as string;
    } catch {}
  }
  return null;
}

export async function sendItemDirect(instanceId: string, toPubkey: string, _note?: string): Promise<boolean> {
  const event = _mintedEvents.get(instanceId);
  if (!event) return false;
  if (hasPendingOutgoingOffer(instanceId)) return false; // already committed to a trade offer
  const hex = normalizePubkey(toPubkey);
  if (!hex) return false;

  // Oracle burns our copy + mints a fresh one to the recipient on relays.
  // Pass the item name so the oracle can DM the recipient a readable notice.
  const itemName = ITEM_CATALOG.find(d => d.id === _inventory.find(i => i.instanceId === instanceId)?.itemId)?.name;
  const { sendItemGiftRequest } = await import('../nostr/presenceService');
  sendItemGiftRequest(event, hex, itemName);
  removeItem(instanceId);
  return true;
}

// ── Fish keep probabilities ───────────────────────────────────────────────────

export const FISH_KEEP_CHANCE: Record<string, number> = {
  legendary: 1.0,
  rare:      0.10,
  common:    0.05,
  junk:      0.05,
};

// ── Rarity-weighted item selection ────────────────────────────────────────────
// Tier-first: roll a rarity by FIXED odds, then pick uniformly among that tier's
// items in the pool. This keeps legendary/rare odds consistent regardless of how
// many commons a given pool happens to contain. Falls back to a lower tier if the
// pool has none of the rolled one.
// Standard scavenge/weekly odds, and slightly more generous holiday odds.
const TIER_ODDS: { tier: ItemRarity; p: number }[] = [
  { tier: 'legendary', p: 0.06 },  // 6%
  { tier: 'rare',      p: 0.20 },  // 20%
  { tier: 'common',    p: 0.74 },  // 74% (commons + junk share this tier)
];
const HOLIDAY_TIER_ODDS: { tier: ItemRarity; p: number }[] = [
  { tier: 'legendary', p: 0.08 },  // 8% — seasonal legendaries a touch easier
  { tier: 'rare',      p: 0.22 },  // 22%
  { tier: 'common',    p: 0.70 },  // 70%
];
const TIER_FALLBACK: Record<ItemRarity, ItemRarity[]> = {
  legendary: ['legendary', 'rare', 'common', 'junk'],
  rare:      ['rare', 'common', 'junk', 'legendary'],
  common:    ['common', 'junk', 'rare', 'legendary'],
  junk:      ['junk', 'common', 'rare', 'legendary'],
};

function pickWeightedFromPool(pool: string[], holiday = false): ItemDef | null {
  const defs = pool.map(id => ITEM_CATALOG.find(d => d.id === id)).filter((d): d is ItemDef => !!d);
  if (defs.length === 0) return null;

  // Roll a target tier by fixed odds
  let roll = Math.random();
  let target: ItemRarity = 'common';
  for (const { tier, p } of (holiday ? HOLIDAY_TIER_ODDS : TIER_ODDS)) {
    if (roll < p) { target = tier; break; }
    roll -= p;
  }

  // Find items of the target tier; fall back through the chain if none exist.
  // (common/junk are treated as one tier for fallback purposes)
  const inTier = (t: ItemRarity) => defs.filter(d =>
    t === 'common' ? (d.rarity === 'common' || d.rarity === 'junk') : d.rarity === t);
  for (const t of TIER_FALLBACK[target]) {
    const candidates = inTier(t);
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return defs[Math.floor(Math.random() * defs.length)];
}

// ── Daily drop ────────────────────────────────────────────────────────────────

// Weekly drop pool — no fish (fish come from fishing only), no legendary
const DAILY_POOL = ITEM_CATALOG.filter(i =>
  i.category !== 'fish' && (i.rarity === 'common' || i.rarity === 'junk')
);

// Requests a weekly drop from the server. The SERVER is the authoritative gate
// (account-wide, once per 7 days) — it grants or silently rejects. On grant it
// sends back an item_minted event with source=weekly_drop, and the mint handler
// shows the toast. No client-side gating so it works across browsers/devices.
export function tryDailyDrop(): void {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return;
  const def = pickWeightedFromPool(DAILY_POOL.map(d => d.id));
  if (!def) return;
  import('../nostr/presenceService').then(({ sendItemMintRequest }) => {
    sendItemMintRequest(def.id, 'weekly_drop');
  });
}

// ── Scene loot pools ──────────────────────────────────────────────────────────

// Pool per scene — thematic items
const SCENE_POOLS: Record<string, string[]> = {
  hub:     ['st_burner_phone','st_ghost_token','st_counterfeit_bill','st_lockpick_set','st_forged_id','st_blackmarket_map','st_zk_proof','st_kingpin_ledger','cr_sewer_rat','cr_alley_cat','cr_raccoon','cr_night_owl'], // hub allows street items + critters
  alley:   ['st_burner_phone','st_ghost_token','st_counterfeit_bill','st_lockpick_set','st_forged_id','st_contraband_pkg','st_skeleton_key','st_blackmarket_map','hw_data_chip','lo_relay_key','st_zk_proof','st_kingpin_ledger','hw_quantum_key','lo_manifesto','oc_black_candle','oc_evil_eye','oc_the_fool','oc_scrying_mirror','oc_hanged_man','cr_sewer_rat','cr_alley_cat','cr_roost_bat'],
  woods:   ['lo_satoshi_coin','lo_relay_key','lo_lightning_bolt','lo_seed_phrase','lo_node_badge','lo_pow_relic','hw_circuit_board','hw_cooling_fan','hw_data_chip','hw_quantum_key','hw_mainframe_core','lo_manifesto','lo_satoshi_email','cr_sewer_rat','cr_raccoon','cr_roost_bat','cr_night_owl'],
  rooftop: ['hw_signal_relay','hw_encrypted_drive','hw_burner_pager','hw_rogue_dish','hw_solder_iron','hw_data_chip','lo_genesis_fragment','lo_whitepaper_page','lo_block_plaque','hw_quantum_key','hw_mainframe_core','cr_roost_bat','cr_night_owl'],
  cabin:   ['lo_satoshi_coin','lo_genesis_fragment','lo_whitepaper_page','lo_seed_phrase','lo_block_plaque','lo_pow_relic','lo_relay_key','lo_manifesto','lo_satoshi_email','oc_black_candle','oc_evil_eye','oc_the_fool','oc_scrying_mirror','oc_hanged_man','cr_alley_cat'],
};

// ── Global scavenge spots ─────────────────────────────────────────────────────
// Exactly THREE scavenge spots exist across the entire game at any time. Each lives
// in a random scene at a random position. Collecting one rerolls it to a new
// random scene+position, so there are always three to hunt for somewhere.

// Per-scene spawn ranges + positions to avoid (doors, NPCs, interactables)
const SCAVENGE_SPAWN: Record<string, { min: number; max: number; avoid: number[] }> = {
  hub:   { min: 80,  max: 1520, avoid: [180, 480, 740, 980, 1215, 615, 860] },
  alley: { min: 110, max: 880,  avoid: [319, 422, 44, 930] },
  woods: { min: 640, max: 1520, avoid: [720, 900, 978] },
  cabin: { min: 110, max: 940,  avoid: [76, 227, 320, 870] },
};
const SCAVENGE_SCENES = Object.keys(SCAVENGE_SPAWN);

// Respawn delay after a spot is collected — random 30min … 1h
const SCAVENGE_RESPAWN_MIN = 30 * 60 * 1000;
const SCAVENGE_RESPAWN_MAX = 60 * 60 * 1000;

interface ScavSlot { scene: string; x: number; readyAt: number; }
const SLOTS_KEY = 'nd_scavenge_slots_v2';
let _slots: ScavSlot[] | null = null;

function pickScavengeX(scene: string): number {
  const cfg = SCAVENGE_SPAWN[scene];
  for (let i = 0; i < 40; i++) {
    const x = cfg.min + Math.random() * (cfg.max - cfg.min);
    if (cfg.avoid.every(a => Math.abs(a - x) >= 100)) return Math.round(x);
  }
  return Math.round(cfg.min + Math.random() * (cfg.max - cfg.min));
}

function rollSlot(delay = 0): ScavSlot {
  const scene = SCAVENGE_SCENES[Math.floor(Math.random() * SCAVENGE_SCENES.length)];
  return { scene, x: pickScavengeX(scene), readyAt: Date.now() + delay };
}

function loadSlots(): ScavSlot[] {
  if (_slots) return _slots;
  try {
    const s = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? 'null');
    if (Array.isArray(s) && s.length === 3) { _slots = s; return s; }
  } catch {}
  _slots = [rollSlot(), rollSlot(), rollSlot()]; // all active immediately on first run
  localStorage.setItem(SLOTS_KEY, JSON.stringify(_slots));
  return _slots;
}

function saveSlots(): void {
  if (_slots) localStorage.setItem(SLOTS_KEY, JSON.stringify(_slots));
}

export interface ScavengeSpot { id: string; x: number; pool: string[]; accent?: string; }

// ── Holiday drops ─────────────────────────────────────────────────────────────
// During a holiday window (~1 week, centered on the core days) TWO EXTRA scavenge
// spots appear that drop that holiday's themed items — distinct accent colour.

interface HolidayDrop { id: string; accent: string; startMD: [number, number]; endMD: [number, number]; pool: string[]; }

const HOLIDAY_DROPS: HolidayDrop[] = [
  { id: 'genesis',    accent: '#f0a030', startMD: [1, 1],   endMD: [1, 6],   pool: ['hol_block_zero', 'hol_chancellor', 'hol_genesis_coin'] },
  { id: 'finney',     accent: '#70b0ff', startMD: [1, 9],   endMD: [1, 15],  pool: ['hol_rpow_token', 'hol_running_btc'] },
  { id: 'pizza_day',  accent: '#ffb000', startMD: [5, 18],  endMD: [5, 25],  pool: ['hol_btc_pizza', 'hol_pepperoni', 'hol_pizza_coin'] },
  { id: 'july4',      accent: '#ff5566', startMD: [7, 1],   endMD: [7, 7],   pool: ['hol_sparkler', 'hol_flag_pin', 'hol_firecracker', 'hol_bottle_rocket', 'hol_liberty_coin', 'hol_eagle_feather'] },
  { id: 'halloween',  accent: '#ff6a00', startMD: [10, 27], endMD: [10, 31], pool: ['hol_candy_corn', 'hol_skull_candle', 'hol_black_cat', 'hol_jack_o_lantern', 'hol_witch_hat', 'hol_cauldron', 'hol_phantom_key', 'hol_reaper_coin'] },
  { id: 'whitepaper', accent: '#c070d0', startMD: [11, 1],  endMD: [11, 6],  pool: ['hol_satoshi_quill', 'hol_hashcash_stamp', 'hol_signed_paper', 'hol_double_spend'] },
  { id: 'nostr_day',  accent: '#9a6eff', startMD: [11, 7],  endMD: [11, 13], pool: ['hol_ostrich_egg', 'hol_purple_pill', 'hol_relay_stone', 'hol_zap_bolt', 'hol_first_note'] },
  { id: 'winter',     accent: '#9fd8ec', startMD: [12, 20], endMD: [12, 31], pool: ['hol_snowflake', 'hol_pine_sprig', 'hol_warm_mittens', 'hol_gift_box', 'hol_frost_coin'] },
];

const mdNum = (m: number, d: number) => m * 100 + d;

export function getActiveHolidayDrop(): HolidayDrop | null {
  const now = new Date();
  const t = mdNum(now.getMonth() + 1, now.getDate());
  for (const h of HOLIDAY_DROPS) {
    if (t >= mdNum(...h.startMD) && t <= mdNum(...h.endMD)) return h;
  }
  return null;
}

interface HolSlot { holidayId: string; scene: string; x: number; readyAt: number; }
const HOL_SLOTS_KEY = 'nd_holiday_slots_v1';
let _holSlots: HolSlot[] | null = null;

function loadHolSlots(holidayId: string): HolSlot[] {
  if (_holSlots && _holSlots[0]?.holidayId === holidayId) return _holSlots;
  try {
    const s = JSON.parse(localStorage.getItem(HOL_SLOTS_KEY) ?? 'null');
    if (Array.isArray(s) && s.length === 2 && s[0]?.holidayId === holidayId) { _holSlots = s; return s; }
  } catch {}
  // New holiday (or first run) — fresh pair, active immediately
  _holSlots = [rollHolSlot(holidayId), rollHolSlot(holidayId)];
  localStorage.setItem(HOL_SLOTS_KEY, JSON.stringify(_holSlots));
  return _holSlots;
}

function rollHolSlot(holidayId: string, delay = 0): HolSlot {
  const scene = SCAVENGE_SCENES[Math.floor(Math.random() * SCAVENGE_SCENES.length)];
  return { holidayId, scene, x: pickScavengeX(scene), readyAt: Date.now() + delay };
}

function saveHolSlots(): void {
  if (_holSlots) localStorage.setItem(HOL_SLOTS_KEY, JSON.stringify(_holSlots));
}

// The scavenge spots currently active (ready) in the given scene — base + holiday.
export function getSceneScavengeSpots(scene: string): ScavengeSpot[] {
  const now = Date.now();
  const out: ScavengeSpot[] = [];

  loadSlots().forEach((slot, i) => {
    if (slot.scene === scene && slot.readyAt <= now) {
      out.push({ id: `slot${i}`, x: slot.x, pool: SCENE_POOLS[scene] });
    }
  });

  const hol = getActiveHolidayDrop();
  if (hol) {
    loadHolSlots(hol.id).forEach((slot, i) => {
      if (slot.scene === scene && slot.readyAt <= now) {
        out.push({ id: `hol${i}`, x: slot.x, pool: hol.pool, accent: hol.accent });
      }
    });
  }
  return out;
}

// Collect a spot — mints an item and rerolls that slot with a random respawn delay.
export function collectScavengeSlot(spotId: string): ItemDef | null {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return null;
  const delay = SCAVENGE_RESPAWN_MIN + Math.random() * (SCAVENGE_RESPAWN_MAX - SCAVENGE_RESPAWN_MIN);

  let pool: string[];
  const isHoliday = spotId.startsWith('hol');
  if (isHoliday) {
    const hol = getActiveHolidayDrop();
    if (!hol) return null;
    const i = parseInt(spotId.replace('hol', ''));
    const slots = loadHolSlots(hol.id);
    if (!slots[i] || slots[i].readyAt > Date.now()) return null;
    pool = hol.pool;
    slots[i] = rollHolSlot(hol.id, delay);
    saveHolSlots();
  } else {
    const i = parseInt(spotId.replace('slot', ''));
    const slots = loadSlots();
    if (!slots[i] || slots[i].readyAt > Date.now()) return null;
    pool = SCENE_POOLS[slots[i].scene];
    slots[i] = rollSlot(delay);
    saveSlots();
  }

  const def = pickWeightedFromPool(pool, isHoliday);
  if (!def) return null;

  import('../nostr/presenceService').then(({ sendItemMintRequest }) => {
    sendItemMintRequest(def.id, 'found');
  });
  return def;
}

// ── Trade offers ──────────────────────────────────────────────────────────────

export interface TradeOffer {
  id: string;
  fromPubkey: string;
  toPubkey: string;
  offerInstanceId: string;
  offerItemId: string;
  offerEvent?: any;         // the offerer's oracle-signed item event (for the swap)
  wantItemId: string;       // what they want back (item type)
  message?: string;
  createdAt: number;
  direction: 'incoming' | 'outgoing';
}

// Trade offers — RELAY-BACKED (kind:30078, d-tag "nostr-district-offers"), in-memory
// only otherwise. NO localStorage. Persisted as the player's own signed event so it
// follows them across devices, like inventory / listings / unlocks.
let _offers: TradeOffer[] = [];
let _resolvedOffers = new Set<string>();
let _offersLoaded = false;
let _offersPublishTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleOffersPublish(): void {
  if (!_offersLoaded) return; // don't clobber the relay copy before we've merged it
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return;
  if (_offersPublishTimer) clearTimeout(_offersPublishTimer);
  _offersPublishTimer = setTimeout(async () => {
    _offersPublishTimer = null;
    try {
      const { publishTradeOffers } = await import('../nostr/nostrService');
      await publishTradeOffers({ offers: _offers, resolved: [..._resolvedOffers].slice(-500) });
    } catch { /* best effort */ }
  }, 800);
}

// Publish the offer state right now (no debounce). Used when an offer is resolved,
// so a reload immediately after accept/decline can't lose the resolution.
function flushOffersPublish(): void {
  if (!_offersLoaded) return;
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return;
  if (_offersPublishTimer) { clearTimeout(_offersPublishTimer); _offersPublishTimer = null; }
  import('../nostr/nostrService')
    .then(({ publishTradeOffers }) => publishTradeOffers({ offers: _offers, resolved: [..._resolvedOffers].slice(-500) }))
    .catch(() => {});
}

function loadOffers(): TradeOffer[] { return _offers; }
function saveOffers(offers: TradeOffer[]): void { _offers = offers; scheduleOffersPublish(); }

// Offers that have been accepted/rejected — kept so DM-history replay on re-login
// doesn't resurrect them.
function loadResolved(): Set<string> { return _resolvedOffers; }
function markResolved(offerId: string): void {
  _resolvedOffers.add(offerId);
  if (_resolvedOffers.size > 500) _resolvedOffers = new Set([..._resolvedOffers].slice(-500));
  flushOffersPublish(); // resolution is important — persist it immediately
}

/** Load the player's trade offers from relays on login (merges with anything that
 *  arrived live before the fetch resolved). Call once per real login. */
export function initTradeOffers(pubkey: string): void {
  _offersLoaded = false;
  import('../nostr/nostrService').then(async ({ fetchTradeOffers }) => {
    let remote: { offers?: TradeOffer[]; resolved?: string[] } | null = null;
    try { remote = await fetchTradeOffers(pubkey); } catch { /* offline → in-memory only */ }
    if (remote) {
      const byId = new Map<string, TradeOffer>();
      for (const o of [...(remote.offers ?? []), ..._offers]) byId.set(o.id, o); // live wins on dupe
      _offers = [...byId.values()];
      _resolvedOffers = new Set([...(remote.resolved ?? []), ..._resolvedOffers]);
    }
    // One-time migration: fold in resolved offers from the pre-relay localStorage era
    // so offers handled before offers went relay-backed don't resurface forever.
    let migrated = false;
    try {
      const old = JSON.parse(localStorage.getItem('nd_resolved_offers_v1') ?? '[]');
      if (Array.isArray(old) && old.length) {
        const before = _resolvedOffers.size;
        _resolvedOffers = new Set([...old.filter((x: unknown) => typeof x === 'string'), ..._resolvedOffers]);
        if (_resolvedOffers.size > before) migrated = true;
      }
    } catch { /* ignore */ }
    // Always drop resolved offers (even if the relay fetch failed) so DM-replay
    // re-adds during the pre-load window can't survive.
    _offers = _offers.filter(o => !_resolvedOffers.has(o.id));
    _offersLoaded = true;
    if (migrated || !remote) scheduleOffersPublish(); // persist the recovered/initial set
    window.dispatchEvent(new CustomEvent('nd-offers-update'));
    window.dispatchEvent(new CustomEvent('nd-inventory-update')); // re-apply offer locks
  });
}

/** Clear in-memory offer state (logout / guest login) so it can't leak across accounts. */
export function resetTradeOffers(): void {
  if (_offersPublishTimer) { clearTimeout(_offersPublishTimer); _offersPublishTimer = null; }
  _offers = [];
  _resolvedOffers = new Set();
  _offersLoaded = false;
}

export function getPendingOffers(): TradeOffer[] {
  const resolved = loadResolved();
  return loadOffers().filter(o => !resolved.has(o.id));
}

// An item with a pending OUTGOING offer is spoken for — it can't also be listed,
// gifted, or offered again (otherwise the same item is in two deals at once and one
// of them fails on completion). Mirrors how listed items are held out of inventory.
export function hasPendingOutgoingOffer(instanceId: string): boolean {
  return getPendingOffers().some(o => o.direction === 'outgoing' && o.offerInstanceId === instanceId);
}
export function getPendingOutgoingInstanceIds(): Set<string> {
  return new Set(getPendingOffers().filter(o => o.direction === 'outgoing').map(o => o.offerInstanceId));
}

// The offerer cancels their own outstanding offer — frees the item and tells the
// recipient to drop their incoming copy (reusing the reject message they handle).
export async function cancelTradeOffer(offer: TradeOffer): Promise<void> {
  const { sendProtocolMessage } = await import('../nostr/dmService');
  await sendProtocolMessage(offer.toPubkey, `nd-item-offer-reject:${JSON.stringify({ offerId: offer.id })}`);
  markResolved(offer.id);
  saveOffers(loadOffers().filter(o => o.id !== offer.id));
  window.dispatchEvent(new CustomEvent('nd-offers-update'));
  window.dispatchEvent(new CustomEvent('nd-inventory-update')); // item returns to inventory
}

export async function sendTradeOffer(
  toPubkey: string,
  myInstanceId: string,
  wantItemId: string,
  message?: string,
): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;

  const item = _inventory.find(i => i.instanceId === myInstanceId);
  if (!item) return false;
  if (hasPendingOutgoingOffer(myInstanceId)) return false; // no duplicate offers for the same item
  const event = _mintedEvents.get(myInstanceId);  // needed so the accepter can swap
  const myDef  = ITEM_CATALOG.find(d => d.id === item.itemId);
  const wantDef = ITEM_CATALOG.find(d => d.id === wantItemId);
  if (!myDef || !wantDef || !event) return false;

  const hex = normalizePubkey(toPubkey);
  if (!hex) return false;

  const offer: TradeOffer = {
    id: `offer_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    fromPubkey: pubkey,
    toPubkey: hex,
    offerInstanceId: myInstanceId,
    offerItemId: item.itemId,
    offerEvent: event,
    wantItemId,
    message,
    createdAt: Date.now(),
    direction: 'outgoing',
  };

  saveOffers([...loadOffers(), offer]);

  const { sendProtocolMessage } = await import('../nostr/dmService');
  await sendProtocolMessage(hex, `nd-item-offer:${JSON.stringify(offer)}`);
  window.dispatchEvent(new CustomEvent('nd-offers-update'));
  return true;
}

export function receiveTradeOffer(payload: string, fromPubkey: string): TradeOffer | null {
  try {
    const data: TradeOffer = JSON.parse(payload.replace(/^nd-item-offer:/, ''));
    if (!data.id || !data.offerItemId || !data.wantItemId) return null;
    if (loadResolved().has(data.id)) return null;          // already handled — ignore replay
    if (loadOffers().some(o => o.id === data.id)) return null; // dedupe
    const incoming: TradeOffer = { ...data, fromPubkey, direction: 'incoming' };
    saveOffers([...loadOffers(), incoming]);
    window.dispatchEvent(new CustomEvent('nd-offers-update'));
    return incoming;
  } catch { return null; }
}

export async function acceptTradeOffer(offer: TradeOffer, myInstanceId: string): Promise<boolean> {
  const { pubkey, loginMethod } = authStore.getState();
  if (!pubkey || loginMethod === 'guest') return false;

  const myEvent = _mintedEvents.get(myInstanceId);
  const theirEvent = offer.offerEvent;
  if (!myEvent || !theirEvent) return false;

  // Oracle performs the atomic swap: burns both, mints swapped copies on relays
  const { sendItemSwapRequest } = await import('../nostr/presenceService');
  sendItemSwapRequest(myEvent, theirEvent, offer.fromPubkey);
  removeItem(myInstanceId);

  // Notify offerer so they clear their outgoing offer
  const { sendProtocolMessage } = await import('../nostr/dmService');
  await sendProtocolMessage(offer.fromPubkey, `nd-item-offer-accept:${JSON.stringify({ offerId: offer.id })}`);

  markResolved(offer.id);
  saveOffers(loadOffers().filter(o => o.id !== offer.id));
  window.dispatchEvent(new CustomEvent('nd-offers-update'));
  return true;
}

export async function rejectTradeOffer(offer: TradeOffer): Promise<void> {
  const { sendProtocolMessage } = await import('../nostr/dmService');
  await sendProtocolMessage(offer.fromPubkey, `nd-item-offer-reject:${JSON.stringify({ offerId: offer.id })}`);
  markResolved(offer.id);
  saveOffers(loadOffers().filter(o => o.id !== offer.id));
  window.dispatchEvent(new CustomEvent('nd-offers-update'));
}

// Returns true only the FIRST time an accept is seen — so DM-history replay on
// re-login doesn't re-fire the toast every time.
export function handleOfferAccepted(payload: string): boolean {
  try {
    const { offerId } = JSON.parse(payload.replace(/^nd-item-offer-accept:/, ''));
    if (loadResolved().has(offerId)) return false; // already handled — ignore replay
    // Our offered item just changed hands — drop it locally so it doesn't linger
    // until the next relay rebuild.
    const accepted = loadOffers().find(o => o.id === offerId);
    if (accepted?.offerInstanceId) removeItem(accepted.offerInstanceId);
    markResolved(offerId);
    saveOffers(loadOffers().filter(o => o.id !== offerId));
    window.dispatchEvent(new CustomEvent('nd-offers-update'));
    return true;
  } catch { return false; }
}

export function handleOfferRejected(payload: string): boolean {
  try {
    const { offerId } = JSON.parse(payload.replace(/^nd-item-offer-reject:/, ''));
    if (loadResolved().has(offerId)) return false;
    markResolved(offerId);
    saveOffers(loadOffers().filter(o => o.id !== offerId));
    window.dispatchEvent(new CustomEvent('nd-offers-update'));
    window.dispatchEvent(new CustomEvent('nd-inventory-update')); // declined → offered item is free again
    return true;
  } catch { return false; }
}
