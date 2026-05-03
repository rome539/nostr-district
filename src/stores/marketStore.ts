/**
 * marketStore.ts — Market catalog + player inventory
 *
 * Catalog items are PNG-backed paid items. Everything procedural (canvas-drawn)
 * is free by default. Inventory is persisted via kind:30078.
 */

import { authStore } from './authStore';
import { isAuraUnlocked, checkGoldUnlock } from './auraUnlockStore';
import { isFishingItemUnlocked } from './fishingUnlockStore';

const OWNER_PUBKEYS = new Set([
  '5069ea44d8977e77c6aea605d0c5386b24504a3abd0fe8a3d1cf5f4cedca40a7',
  '0edcc015b167377154fa40ff1c59b2bbb18aca20b5b9c714980cfef60994a27a',
  '40a0a47768141eddabcf3b25f2947c783f2c8a150781abb9c1b9ba4cefb385f4',
]);

// If someone paid and didn't receive an item, add their hex pubkey + the item(s) here.
// 'slot:value' matches the catalog — e.g. 'hat:crown', 'top:jacket', 'accessory:wings'
const MANUAL_GRANTS: Record<string, string[]> = {
  // 'abc123pubkey': ['hat:crown'],
};


export interface MarketItem {
  id:    string;
  name:  string;
  slot:  'hair' | 'top' | 'bottom' | 'hat' | 'accessory' | 'nameColor' | 'chatColor' | 'rodSkin' | 'nameAnim' | 'aura' | 'eyes';
  value: string;
  price: number;
  tier:  'basic' | 'premium' | 'rare';
  earn?: boolean;   // earned in-world, never purchased
  hidden?: boolean; // exists for ownership gating but never shown in the shop
}

export interface RodSkinColors {
  grip:   number;
  tip:    number;
  line:   number;
  bobber: number;
}

export const ROD_SKINS: Record<string, RodSkinColors> = {
  '':         { grip: 0x3a2810, tip: 0x4a3418, line: 0xc8b89a, bobber: 0xe05028 }, // Classic (default)
  classic:    { grip: 0x3a2810, tip: 0x4a3418, line: 0xc8b89a, bobber: 0xe05028 },
  silver:     { grip: 0x8898a8, tip: 0xa8b8c8, line: 0xd0dce8, bobber: 0x5080c0 },
  bamboo:     { grip: 0x8a7040, tip: 0xa89050, line: 0xd4c880, bobber: 0x4a9050 },
  carbon:     { grip: 0x282828, tip: 0x383838, line: 0x808898, bobber: 0xe05028 },
  coral:      { grip: 0xc05848, tip: 0xe07060, line: 0xf0b090, bobber: 0x40b8c0 },
  gold:       { grip: 0xa07020, tip: 0xd09828, line: 0xf0d060, bobber: 0xe05028 },
  legendary:  { grip: 0x3a2810, tip: 0x4a3418, line: 0xc8b89a, bobber: 0xe05028 }, // animated rainbow
};

/** Returns an animated rainbow hex color based on current time. */
export function getRainbowColor(time: number): string {
  const hue = (time / 20) % 360;
  return `hsl(${hue},90%,68%)`;
}

export const ANIMATED_COLORS = new Set(['rainbow', 'fire', 'ice', 'electric', '#f0b040', '#c0c8d0']);

export function isAnimatedColor(color: string): boolean {
  return ANIMATED_COLORS.has(color);
}

export function getAnimatedColor(color: string, time: number): string {
  switch (color) {
    case 'rainbow': return getRainbowColor(time);
    case 'fire': {
      const hue = 15 + (Math.sin(time / 180) * 0.5 + 0.5) * 45;
      const lit = 52 + Math.sin(time / 250) * 12;
      return `hsl(${hue},100%,${lit}%)`;
    }
    case 'ice': {
      const sat = 60 + Math.sin(time / 300) * 25;
      const lit = 72 + Math.sin(time / 400) * 12;
      return `hsl(200,${sat}%,${lit}%)`;
    }
    case 'electric': {
      const hues = [55, 180, 200];
      const idx = Math.floor((time / 350) % hues.length);
      return `hsl(${hues[idx]},100%,72%)`;
    }
    case '#f0b040': { // gold shine
      const t = Math.sin(time / 600) * 0.5 + 0.5;
      const lit = 38 + t * 28;
      const sat = 88 + t * 12;
      return `hsl(42,${sat}%,${lit}%)`;
    }
    case '#c0c8d0': { // silver shimmer
      const t = Math.sin(time / 700) * 0.5 + 0.5;
      const lit = 62 + t * 22;
      const sat = 8 + t * 10;
      return `hsl(210,${sat}%,${lit}%)`;
    }
    default: return color;
  }
}

export const TIER_LABEL: Record<MarketItem['tier'], string> = {
  basic:   'BASIC',
  premium: 'PREMIUM',
  rare:    'RARE',
};

export const TIER_COLOR: Record<MarketItem['tier'], string> = {
  basic:   '#7b68ee',
  premium: '#5dcaa5',
  rare:    '#e87aab',
};

export const CATALOG: MarketItem[] = [
  // ── Tops ─────────────────────────────────────────────────────────────────────
  { id: 'top_camoshirt',   name: 'Camo Shirt',      slot: 'top',       value: 'camoshirt',      price: 0.50, tier: 'basic' },
  { id: 'top_flannel',     name: 'Flannel',          slot: 'top',       value: 'flannel',        price: 0.50, tier: 'basic' },
  { id: 'top_bomber',      name: 'Bomber Jacket',    slot: 'top',       value: 'bomber',         price: 1.50, tier: 'premium' },
  { id: 'top_jacket',      name: 'Jacket',           slot: 'top',       value: 'jacket',         price: 0.50, tier: 'basic' },
  { id: 'top_tunic',       name: 'Tunic',            slot: 'top',       value: 'tunic',          price: 0.50, tier: 'basic' },
  { id: 'top_skindress',   name: 'Skin Dress',       slot: 'top',       value: 'skindress',      price: 0.50, tier: 'basic' },
  // { id: 'top_knightchest', name: 'Knight Chest',     slot: 'top',       value: 'knightchest',    price: 1.50, tier: 'premium' },
  // ── Bottoms ───────────────────────────────────────────────────────────────────
  { id: 'bot_camopants',   name: 'Camo Pants',       slot: 'bottom',    value: 'camopants',      price: 0.50, tier: 'basic' },
  { id: 'bot_baggyjeans',  name: 'Baggy Jeans',      slot: 'bottom',    value: 'baggyjeans',     price: 0.50, tier: 'basic' },
  { id: 'bot_trousers',    name: 'Trousers',         slot: 'bottom',    value: 'trousers',       price: 0.50, tier: 'basic' },
  { id: 'bot_utilitypants',name: 'Utility Pants',    slot: 'bottom',    value: 'utilitypants',   price: 0.50, tier: 'basic' },
  { id: 'bot_cargopants',  name: 'Cargo Pants',      slot: 'bottom',    value: 'cargopants',     price: 0.50, tier: 'basic' },
  // { id: 'bot_knightpants', name: 'Knight Pants',     slot: 'bottom',    value: 'knightpants',    price: 1.50, tier: 'premium' },
  // ── Hats ─────────────────────────────────────────────────────────────────────
  // { id: 'hat_knightsheadband', name: 'Knight Headband', slot: 'hat',      value: 'knightsheadband', price: 1.50, tier: 'premium' },
  { id: 'hat_catears',     name: 'Cat Ears',         slot: 'hat',       value: 'catears',        price: 1.50, tier: 'premium' },
  { id: 'hat_halo',        name: 'Halo',             slot: 'hat',       value: 'halo',           price: 1.50, tier: 'premium' },
  { id: 'hat_horns',       name: 'Horns',            slot: 'hat',       value: 'horns',          price: 1.50, tier: 'premium' },
  { id: 'hat_hornsspiral', name: 'Spiral Horns',     slot: 'hat',       value: 'hornsspiral',    price: 1.50, tier: 'premium' },
  { id: 'hat_crown',       name: 'Crown',            slot: 'hat',       value: 'crown',          price: 8.00, tier: 'rare' },
  { id: 'hat_crown_purple',name: 'Purple Crown',     slot: 'hat',       value: 'crown_purple',   price: 8.00, tier: 'rare' },
  { id: 'hat_crown_silver',name: 'Silver Crown',     slot: 'hat',       value: 'crown_silver',   price: 8.00, tier: 'rare' },
  { id: 'hat_crown_bronze',name: 'Bronze Crown',     slot: 'hat',       value: 'crown_bronze',   price: 8.00, tier: 'rare' },
  // ── Accessories ───────────────────────────────────────────────────────────────
  // { id: 'acc_sword',       name: 'Sword',            slot: 'accessory', value: 'sword',          price: 1.50, tier: 'premium' },
  { id: 'acc_floatie',        name: 'Ostrich Floatie',    slot: 'accessory', value: 'ostirchfloatie',  price: 1.50, tier: 'premium' },
  { id: 'acc_ballon',         name: 'Balloon',            slot: 'accessory', value: 'ballon',          price: 0.50, tier: 'basic' },
  { id: 'acc_ballonbitcoin',  name: 'Bitcoin Balloon',    slot: 'accessory', value: 'ballonbitcoin',   price: 1.50, tier: 'premium' },
  { id: 'acc_ballonostrich',  name: 'Ostrich Balloon',    slot: 'accessory', value: 'ballonostrich',   price: 1.50, tier: 'premium' },
  { id: 'acc_wings',       name: 'Wings',            slot: 'accessory', value: 'wings',          price: 3.00, tier: 'rare' },
  { id: 'acc_cape',        name: 'Cape',             slot: 'accessory', value: 'cape',           price: 3.00, tier: 'rare' },
  // ── Hair ─────────────────────────────────────────────────────────────────────
  { id: 'hair_afro',       name: 'Afro',             slot: 'hair',      value: 'afro',           price: 0.50, tier: 'basic' },
  { id: 'hair_ponytail',   name: 'Ponytail',         slot: 'hair',      value: 'ponytail',       price: 0.50, tier: 'basic' },
  { id: 'hair_bun',        name: 'Bun',              slot: 'hair',      value: 'bun',            price: 0.50, tier: 'basic' },
  { id: 'hair_grease',     name: 'Grease',           slot: 'hair',      value: 'grease',         price: 1.50, tier: 'premium' },
  { id: 'hair_swept',      name: 'Swept',            slot: 'hair',      value: 'swept',          price: 0.50, tier: 'basic' },
  { id: 'hair_pigtails',   name: 'Pigtails',         slot: 'hair',      value: 'pigtails',       price: 0.50, tier: 'basic' },
  { id: 'hair_spiky',      name: 'Spiky',            slot: 'hair',      value: 'spiky',          price: 0.50, tier: 'basic' },
  { id: 'hair_horseshoe',  name: 'Horseshoe',        slot: 'hair',      value: 'horseshoe',      price: 0.50, tier: 'basic' },
  { id: 'hair_partbeard',  name: 'Part + Beard',     slot: 'hair',      value: 'partbeard',      price: 0.50, tier: 'basic' },
  { id: 'hair_braid',      name: 'Braid',            slot: 'hair',      value: 'braid',          price: 1.50, tier: 'premium' },
  // ── Eyes ─────────────────────────────────────────────────────────────────────
  { id: 'eye_heart',  name: '♥ Heart Eyes',  slot: 'eyes', value: 'heart',  price: 0.50, tier: 'basic' },
  { id: 'eye_glow',   name: '✦ Glow Eyes',   slot: 'eyes', value: 'glow',   price: 2.00, tier: 'premium' },
  { id: 'eye_blaze',  name: '🔥 Blaze Eyes',  slot: 'eyes', value: 'blaze',  price: 3.00, tier: 'rare' },
  { id: 'eye_frost',  name: '❄️ Frost Eyes',  slot: 'eyes', value: 'frost',  price: 3.00, tier: 'rare' },
  { id: 'eye_cosmic', name: '✨ Cosmic Eyes', slot: 'eyes', value: 'cosmic', price: 3.00, tier: 'rare' },
  // { id: 'eye_cry', name: '💧 Cry Eyes', slot: 'eyes', value: 'cry', price: 3.00, tier: 'rare' }, // TODO: convert to emote
  // ── Name colors ───────────────────────────────────────────────────────────────
  { id: 'color_orange',    name: 'Orange',           slot: 'nameColor', value: '#f07020',  price: 0.50, tier: 'basic' },
  { id: 'color_pink',      name: 'Pink',             slot: 'nameColor', value: '#e87aab',  price: 0.50, tier: 'basic' },
  { id: 'color_cyan',      name: 'Cyan',             slot: 'nameColor', value: '#40e8ff',  price: 0.50, tier: 'basic' },
  { id: 'color_purple',    name: 'Purple',           slot: 'nameColor', value: '#9a6eff',  price: 0.50, tier: 'basic' },
  { id: 'color_teal',      name: 'Teal',             slot: 'nameColor', value: '#5dcaa5',  price: 0.50, tier: 'basic' },
  { id: 'color_red',       name: 'Red',              slot: 'nameColor', value: '#e85454',  price: 0.50, tier: 'basic' },
  { id: 'color_yellow',    name: 'Yellow',           slot: 'nameColor', value: '#f0e040',  price: 0.50, tier: 'basic' },
  { id: 'color_neongreen', name: 'Neon Green',       slot: 'nameColor', value: '#39ff14',  price: 0.50, tier: 'basic' },
  { id: 'color_gold',      name: 'Gold',             slot: 'nameColor', value: '#f0b040',  price: 1.50, tier: 'rare'  },
  { id: 'color_silver',    name: 'Silver',           slot: 'nameColor', value: '#c0c8d0',  price: 1.50, tier: 'rare'  },
  { id: 'color_fire',      name: '🔥 Fire',          slot: 'nameColor', value: 'fire',     price: 3.00, tier: 'rare'  },
  { id: 'color_ice',       name: '❄️ Ice',           slot: 'nameColor', value: 'ice',      price: 3.00, tier: 'rare'  },
  { id: 'color_electric',  name: '⚡ Electric',      slot: 'nameColor', value: 'electric', price: 3.00, tier: 'rare'  },
  { id: 'color_rainbow',   name: '🌈 Rainbow',       slot: 'nameColor', value: 'rainbow',  price: 5.00, tier: 'rare'  },
  // ── Name tag animations ───────────────────────────────────────────────────────
  { id: 'anim_bob',        name: 'Bob',              slot: 'nameAnim',  value: 'bob',      price: 2.00, tier: 'basic' },
  { id: 'anim_pulse',      name: 'Pulse',            slot: 'nameAnim',  value: 'pulse',    price: 2.00, tier: 'basic' },
  { id: 'anim_zoom',       name: 'Zoom',             slot: 'nameAnim',  value: 'zoom',     price: 2.00, tier: 'basic' },
  { id: 'anim_jitter',     name: 'Jitter',           slot: 'nameAnim',  value: 'jitter',   price: 2.00, tier: 'premium' },
  { id: 'anim_swing',      name: 'Swing',            slot: 'nameAnim',  value: 'swing',    price: 2.00, tier: 'premium' },
  { id: 'anim_wave',       name: 'Wave',             slot: 'nameAnim',  value: 'wave',     price: 3.00, tier: 'premium' },
  { id: 'anim_glow',       name: 'Glow',             slot: 'nameAnim',  value: 'glow',     price: 3.00, tier: 'premium' },
  // ── Fishing rod skins ────────────────────────────────────────────────────────
  { id: 'rod_silver',      name: 'Silver Rod',       slot: 'rodSkin',   value: 'silver',   price: 1.50, tier: 'premium' },
  { id: 'rod_bamboo',      name: 'Bamboo Rod',       slot: 'rodSkin',   value: 'bamboo',   price: 0.50, tier: 'basic' },
  { id: 'rod_carbon',      name: 'Carbon Rod',       slot: 'rodSkin',   value: 'carbon',   price: 0.50, tier: 'basic' },
  { id: 'rod_coral',       name: 'Coral Rod',        slot: 'rodSkin',   value: 'coral',    price: 0.50, tier: 'basic' },
  { id: 'rod_gold',        name: 'Gold Rod',         slot: 'rodSkin',   value: 'gold',     price: 1.50, tier: 'premium' },
  { id: 'rod_legendary',   name: '🌈 Legendary Rod', slot: 'rodSkin',   value: 'legendary',price: 5.00, tier: 'rare'  },
  // ── Fishing unlocks (earned by catching legendary fish) ─────────────────────
  { id: 'hat_fishhat',   name: 'Fish Hat',          slot: 'hat',    value: 'fishhat', price: 0, tier: 'rare', earn: true, hidden: true },
  { id: 'bot_fishnet',   name: 'Fish Net Bottoms',  slot: 'bottom', value: 'fishnet', price: 0, tier: 'rare', earn: true, hidden: true },
  // ── Player auras (earned in-world, not purchased) ────────────────────────────
  { id: 'aura_smoke',    name: 'Smoke Aura',    slot: 'aura', value: 'smoke',    price: 0, tier: 'rare', earn: true },
  { id: 'aura_fire',     name: 'Fire Aura',     slot: 'aura', value: 'fire',     price: 0, tier: 'rare', earn: true },
  { id: 'aura_sparkle',  name: 'Sparkle Aura',  slot: 'aura', value: 'sparkle',  price: 0, tier: 'rare', earn: true },
  { id: 'aura_ice',      name: 'Ice Aura',      slot: 'aura', value: 'ice',      price: 0, tier: 'rare', earn: true },
  { id: 'aura_electric', name: 'Electric Aura', slot: 'aura', value: 'electric', price: 0, tier: 'rare', earn: true },
  { id: 'aura_void',     name: 'Void Aura',     slot: 'aura', value: 'void',     price: 0, tier: 'rare', earn: true },
  { id: 'aura_gold',     name: 'Gold Aura',     slot: 'aura', value: 'gold',     price: 0, tier: 'rare', earn: true },
  { id: 'aura_rainbow',  name: 'Rainbow Aura',  slot: 'aura', value: 'rainbow',  price: 0, tier: 'rare', earn: true },
];

// ── Weekly sale ───────────────────────────────────────────────────────────────

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Returns the item on sale this week (deterministic, same for all players). */
export function getWeeklySaleItem(): MarketItem {
  const week     = Math.floor(Date.now() / MS_PER_WEEK);
  const eligible = CATALOG.filter(i => !i.earn && i.price > 0);
  return eligible[week % eligible.length];
}

/** Returns the discounted price for the weekly sale item. */
export function getSalePrice(item: MarketItem): number {
  return Math.round(item.price * 0.75 * 100) / 100;
}

/** Returns how many days remain in the current sale week. */
export function getSaleDaysLeft(): number {
  const weekStart = Math.floor(Date.now() / MS_PER_WEEK) * MS_PER_WEEK;
  return Math.max(1, Math.ceil((weekStart + MS_PER_WEEK - Date.now()) / (24 * 60 * 60 * 1000)));
}

// Lookup by slot:value for fast membership test
const PAID_KEYS = new Set(CATALOG.map(i => `${i.slot}:${i.value}`));
const EARN_KEYS = new Set(CATALOG.filter(i => i.earn).map(i => `${i.slot}:${i.value}`));

// ── Inventory state ───────────────────────────────────────────────────────────

let _inventory: Set<string> = new Set();

/** Returns true if the player can equip this item (free, purchased, or earned). */
export function isOwned(slot: string, value: string): boolean {
  // Chat colors are bundled with name colors — owning one grants the other
  if (slot === 'chatColor') return isOwned('nameColor', value);
  const key = `${slot}:${value}`;
  if (!PAID_KEYS.has(key)) return true; // free (procedural or free PNG)
  const pubkey = authStore.getState().pubkey ?? '';
  if (OWNER_PUBKEYS.has(pubkey)) return true;
  if (MANUAL_GRANTS[pubkey]?.includes(key)) return true;
  if (EARN_KEYS.has(key)) {
    if (slot === 'hat' || slot === 'bottom') return isFishingItemUnlocked(value);
    return isAuraUnlocked(value);
  }
  return _inventory.has(key);
}

/** Mark an item as purchased in memory. */
export function addToInventory(slot: string, value: string): void {
  _inventory.add(`${slot}:${value}`);
  checkGoldUnlock(_inventory.size);
}

/** Returns the inventory as a string array for Nostr persistence. */
export function getInventory(): string[] {
  return Array.from(_inventory);
}

/** Overwrites local inventory from a Nostr fetch. */
export function applyRemoteInventory(items: string[]): void {
  _inventory = new Set(items);
}

/** Returns the catalog entry for a slot+value pair, or undefined if free. */
export function getCatalogItem(slot: string, value: string): MarketItem | undefined {
  return CATALOG.find(i => i.slot === slot && i.value === value);
}
