/**
 * marketStore.ts — Market catalog + player inventory
 *
 * Catalog items are PNG-backed paid items. Everything procedural (canvas-drawn)
 * is free by default. Inventory is persisted via kind:30078.
 */

import { authStore } from './authStore';

const OWNER_PUBKEYS = new Set([
  '5069ea44d8977e77c6aea605d0c5386b24504a3abd0fe8a3d1cf5f4cedca40a7',
  '0edcc015b167377154fa40ff1c59b2bbb18aca20b5b9c714980cfef60994a27a',
]);

export interface MarketItem {
  id:    string;
  name:  string;
  slot:  'hair' | 'top' | 'bottom' | 'hat' | 'accessory' | 'nameColor' | 'chatColor' | 'rodSkin';
  value: string;
  price: number;
  tier:  'basic' | 'accessories' | 'rare';
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

export const TIER_LABEL: Record<MarketItem['tier'], string> = {
  basic:       'BASIC',
  accessories: 'ACC',
  rare:        'RARE',
};

export const TIER_COLOR: Record<MarketItem['tier'], string> = {
  basic:       '#7b68ee',
  accessories: '#5dcaa5',
  rare:        '#e87aab',
};

export const CATALOG: MarketItem[] = [
  // ── Basic — 1,000 sats ───────────────────────────────────────────────────────
  { id: 'top_camoshirt',   name: 'Camo Shirt',    slot: 'top',       value: 'camoshirt',   price: 1000, tier: 'basic' },
  { id: 'top_flannel',     name: 'Flannel',        slot: 'top',       value: 'flannel',     price: 1000, tier: 'basic' },
  { id: 'top_bomber',      name: 'Bomber Jacket',  slot: 'top',       value: 'bomber',      price: 1000, tier: 'basic' },
  { id: 'top_jacket',      name: 'Jacket',         slot: 'top',       value: 'jacket',      price: 1000, tier: 'basic' },
  { id: 'bot_camopants',   name: 'Camo Pants',     slot: 'bottom',    value: 'camopants',   price: 1000, tier: 'basic' },
  // ── Accessories — 2,500 sats ─────────────────────────────────────────────────
  { id: 'hat_headphones',  name: 'Headphones',     slot: 'hat',       value: 'headphones',  price: 2500, tier: 'accessories' },
  { id: 'hat_catears',     name: 'Cat Ears',       slot: 'hat',       value: 'catears',     price: 2500, tier: 'accessories' },
  { id: 'hat_halo',        name: 'Halo',           slot: 'hat',       value: 'halo',        price: 2500, tier: 'accessories' },
  { id: 'hat_horns',       name: 'Horns',          slot: 'hat',       value: 'horns',       price: 2500, tier: 'accessories' },
  { id: 'hat_hornsspiral', name: 'Spiral Horns',   slot: 'hat',       value: 'hornsspiral', price: 2500, tier: 'accessories' },
  // ── Rare — 5,000 sats ───────────────────────────────────────────────────────
  { id: 'acc_wings',       name: 'Wings',              slot: 'accessory', value: 'wings',       price: 5000, tier: 'rare' },
  { id: 'acc_cape',        name: 'Cape',               slot: 'accessory', value: 'cape',        price: 5000, tier: 'rare' },
  { id: 'hair_afro',       name: 'Afro',               slot: 'hair',      value: 'afro',        price: 5000, tier: 'rare' },
  { id: 'hair_ponytail',   name: 'Ponytail',           slot: 'hair',      value: 'ponytail',    price: 5000, tier: 'rare' },
  // ── Name tag colors ──────────────────────────────────────────────────────────
  { id: 'name_orange',     name: 'Orange Name Tag',    slot: 'nameColor', value: '#f0a050',     price: 1000, tier: 'basic' },
  { id: 'name_pink',       name: 'Pink Name Tag',      slot: 'nameColor', value: '#e87aab',     price: 1000, tier: 'basic' },
  { id: 'name_cyan',       name: 'Cyan Name Tag',      slot: 'nameColor', value: '#40e8ff',     price: 1000, tier: 'basic' },
  { id: 'name_purple',     name: 'Purple Name Tag',    slot: 'nameColor', value: '#9a6eff',     price: 1000, tier: 'basic' },
  { id: 'name_teal',       name: 'Teal Name Tag',      slot: 'nameColor', value: '#5dcaa5',     price: 1000, tier: 'basic' },
  { id: 'name_red',        name: 'Red Name Tag',       slot: 'nameColor', value: '#e85454',     price: 1000, tier: 'basic' },
  { id: 'name_gold',       name: 'Gold Name Tag',      slot: 'nameColor', value: '#f0b040',     price: 5000, tier: 'rare'  },
  { id: 'name_silver',     name: 'Silver Name Tag',    slot: 'nameColor', value: '#c0c8d0',     price: 5000, tier: 'rare'  },
  { id: 'name_rainbow',    name: '🌈 Rainbow Name Tag',slot: 'nameColor', value: 'rainbow',     price: 5000, tier: 'rare'  },
  // ── Chat bubble colors ───────────────────────────────────────────────────────
  { id: 'chat_orange',     name: 'Orange Chat',        slot: 'chatColor', value: '#f0a050',     price: 1000, tier: 'basic' },
  { id: 'chat_pink',       name: 'Pink Chat',          slot: 'chatColor', value: '#e87aab',     price: 1000, tier: 'basic' },
  { id: 'chat_cyan',       name: 'Cyan Chat',          slot: 'chatColor', value: '#40e8ff',     price: 1000, tier: 'basic' },
  { id: 'chat_purple',     name: 'Purple Chat',        slot: 'chatColor', value: '#9a6eff',     price: 1000, tier: 'basic' },
  { id: 'chat_teal',       name: 'Teal Chat',          slot: 'chatColor', value: '#5dcaa5',     price: 1000, tier: 'basic' },
  { id: 'chat_red',        name: 'Red Chat',           slot: 'chatColor', value: '#e85454',     price: 1000, tier: 'basic' },
  { id: 'chat_gold',       name: 'Gold Chat',          slot: 'chatColor', value: '#f0b040',     price: 5000, tier: 'rare'  },
  { id: 'chat_silver',     name: 'Silver Chat',        slot: 'chatColor', value: '#c0c8d0',     price: 5000, tier: 'rare'  },
  { id: 'chat_rainbow',    name: '🌈 Rainbow Chat',    slot: 'chatColor', value: 'rainbow',     price: 5000, tier: 'rare'  },
  // ── Fishing rod skins ────────────────────────────────────────────────────────
  { id: 'rod_silver',     name: 'Silver Rod',         slot: 'rodSkin',   value: 'silver',      price: 1000, tier: 'basic' },
  { id: 'rod_bamboo',     name: 'Bamboo Rod',         slot: 'rodSkin',   value: 'bamboo',      price: 1000, tier: 'basic' },
  { id: 'rod_carbon',     name: 'Carbon Rod',         slot: 'rodSkin',   value: 'carbon',      price: 1000, tier: 'basic' },
  { id: 'rod_coral',      name: 'Coral Rod',          slot: 'rodSkin',   value: 'coral',       price: 2500, tier: 'accessories' },
  { id: 'rod_gold',       name: 'Gold Rod',           slot: 'rodSkin',   value: 'gold',        price: 2500, tier: 'accessories' },
  { id: 'rod_legendary',  name: '🌈 Legendary Rod',   slot: 'rodSkin',   value: 'legendary',   price: 5000, tier: 'rare'  },
];

// Lookup by slot:value for fast membership test
const PAID_KEYS = new Set(CATALOG.map(i => `${i.slot}:${i.value}`));

// ── Inventory state ───────────────────────────────────────────────────────────

let _inventory: Set<string> = new Set();

/** Returns true if the player can equip this item (free or purchased). */
export function isOwned(slot: string, value: string): boolean {
  const key = `${slot}:${value}`;
  if (!PAID_KEYS.has(key)) return true; // free (procedural or free PNG)
  if (OWNER_PUBKEYS.has(authStore.getState().pubkey ?? '')) return true; // dev accounts own everything
  return _inventory.has(key);
}

/** Mark an item as purchased in memory. */
export function addToInventory(slot: string, value: string): void {
  _inventory.add(`${slot}:${value}`);
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
