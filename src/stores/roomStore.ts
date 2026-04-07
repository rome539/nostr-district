/**
 * roomStore.ts — Room customization state
 * In-memory only — persisted via kind:30078 on demand.
 */

import type { PetSelection } from './petStore';

export type WallTheme =
  | 'default'    // dark purple brick (original)
  | 'midnight'   // deep navy blue
  | 'crimson'    // dark red tones
  | 'forest'     // dark green
  | 'amber'      // warm dark gold
  | 'slate'      // cool gray
  | 'neon'       // black with neon grid lines
  | 'void'       // near-black minimal
  | 'rose'       // deep dusty rose / mauve
  | 'ocean'      // deep teal-blue
  | 'rust';      // industrial rust orange

export type FloorStyle =
  | 'hardwood'   // original purple wood planks
  | 'tile'       // checkerboard tile
  | 'carpet'     // soft solid color
  | 'concrete'   // industrial gray
  | 'neon'       // dark with neon trim
  | 'marble'     // white with gray veins
  | 'tatami'     // japanese woven mat
  | 'hex'        // hexagonal tile pattern
  | 'bamboo';    // vertical bamboo stalks

export type LightingMood =
  | 'teal'       // original teal accent
  | 'pink'       // neon pink
  | 'purple'     // deep purple
  | 'amber'      // warm gold
  | 'red'        // moody red
  | 'white'      // neutral bright
  | 'cyan'       // electric cyan
  | 'lime'       // acid green
  | 'orange';    // warm neon orange

export type FurnitureId =
  | 'desk'       // computer desk (always present — it has the terminal)
  | 'bookshelf'
  | 'couch'
  | 'plant'
  | 'rug'
  | 'lamp'
  | 'speaker'
  | 'minifridge'
  | 'beanbag'    // bean bag chair in the corner
  | 'arcade'     // retro arcade cabinet
  | 'tv'         // wall-mounted TV
  | 'pet_bed'    // round cushioned pet bed (cat & dog)
  | 'cat_tree'   // cat tree / scratching post
  | 'pet_bowl';  // food & water bowl set

export type PosterId =
  | 'none'
  | 'bitcoin'    // original BTC poster
  | 'nostr'      // original Nostr poster
  | 'pixel_art'  // abstract pixel art
  | 'landscape'  // pixel landscape
  | 'cat'        // pixel cat
  | 'skull'      // pixel skull
  | 'moon'       // moon scene
  | 'code'       // code snippet poster
  | 'synthwave'  // retro synthwave grid
  | 'matrix'     // falling green code
  | 'space';     // deep space nebula

export interface RoomConfig {
  wallTheme: WallTheme;
  floorStyle: FloorStyle;
  lighting: LightingMood;
  furniture: FurnitureId[];
  /** Up to 3 poster slots: left wall, center wall, right wall */
  posters: [PosterId, PosterId, PosterId];
  /** Per-furniture color overrides (hex string). If not set, uses default. */
  furnitureColors: Partial<Record<FurnitureId, string>>;
  /** Whether the player has completed first-time setup */
  hasSetup: boolean;
  /** Ceiling light string color override (uses lighting by default) */
  ceilingLightColor: string | null;
  /** Pinned wall note text (null = no note) */
  pinnedNote: string | null;
  /** Pet living in the room */
  pet: PetSelection;
}

const DEFAULT_ROOM: RoomConfig = {
  wallTheme: 'default',
  floorStyle: 'hardwood',
  lighting: 'teal',
  furniture: ['desk', 'bookshelf', 'lamp'],
  posters: ['bitcoin', 'nostr', 'pixel_art'],
  furnitureColors: {},
  hasSetup: false,
  ceilingLightColor: null,
  pinnedNote: null,
  pet: { species: 'none', breed: 1 },
};

let currentRoom: RoomConfig = { ...DEFAULT_ROOM, furniture: [...DEFAULT_ROOM.furniture], posters: [...DEFAULT_ROOM.posters], furnitureColors: {} };

function save(): void {
  // in-memory only — persisted via kind:30078 on demand
}

/** Apply a RoomConfig fetched from Nostr into in-memory state. */
export function applyRemoteRoomConfig(remote: RoomConfig): void {
  currentRoom = {
    ...DEFAULT_ROOM,
    ...remote,
    furniture: remote.furniture ? [...remote.furniture] : [...DEFAULT_ROOM.furniture],
    posters: remote.posters ? [remote.posters[0] || 'none', remote.posters[1] || 'none', remote.posters[2] || 'none'] as [PosterId, PosterId, PosterId] : [...DEFAULT_ROOM.posters] as [PosterId, PosterId, PosterId],
    furnitureColors: remote.furnitureColors ? { ...remote.furnitureColors } : {},
    pet: remote.pet ?? DEFAULT_ROOM.pet,
  };
}

export function getRoomConfig(): RoomConfig {
  return {
    ...currentRoom,
    furniture: [...currentRoom.furniture],
    posters: [...currentRoom.posters] as [PosterId, PosterId, PosterId],
    furnitureColors: { ...currentRoom.furnitureColors },
  };
}

export function setRoomConfig(config: Partial<RoomConfig>): RoomConfig {
  if (config.furniture) currentRoom.furniture = [...config.furniture];
  if (config.posters) currentRoom.posters = [...config.posters] as [PosterId, PosterId, PosterId];
  if (config.wallTheme !== undefined) currentRoom.wallTheme = config.wallTheme;
  if (config.floorStyle !== undefined) currentRoom.floorStyle = config.floorStyle;
  if (config.lighting !== undefined) currentRoom.lighting = config.lighting;
  if (config.hasSetup !== undefined) currentRoom.hasSetup = config.hasSetup;
  if (config.ceilingLightColor !== undefined) currentRoom.ceilingLightColor = config.ceilingLightColor;
  if (config.pinnedNote !== undefined) currentRoom.pinnedNote = config.pinnedNote;
  if (config.furnitureColors !== undefined) currentRoom.furnitureColors = { ...config.furnitureColors };
  save();
  return getRoomConfig();
}

/** Default colors per furniture piece (used when no override is set) */
export const DEFAULT_FURNITURE_COLORS: Record<FurnitureId, string> = {
  desk:       '#2e1e0e',  // walnut brown
  bookshelf:  '#2a1a08',  // dark wood
  couch:      '#3d2860',  // deep purple
  plant:      '#1e3a1a',  // dark green pot
  rug:        '#2a1858',  // dark purple
  lamp:       '#1e1432',  // charcoal
  speaker:    '#1e1432',  // charcoal
  minifridge: '#1e1432',  // charcoal
  beanbag:    '#c44060',  // hot pink/red
  arcade:     '#1e1432',  // charcoal
  tv:         '#1a1830',  // dark navy
  pet_bed:    '#7a3858',  // warm rose/mauve cushion
  cat_tree:   '#5a3a1a',  // natural tan/sisal
  pet_bowl:   '#2a1e3e',  // dark pewter
};

export function setFurnitureColor(id: FurnitureId, color: string): RoomConfig {
  currentRoom.furnitureColors = { ...currentRoom.furnitureColors, [id]: color };
  save();
  return getRoomConfig();
}

export function getFurnitureColor(cfg: RoomConfig, id: FurnitureId): string {
  return cfg.furnitureColors[id] || DEFAULT_FURNITURE_COLORS[id];
}

export function toggleFurniture(id: FurnitureId): RoomConfig {
  // Desk is always present (it has the terminal)
  if (id === 'desk') return getRoomConfig();
  const idx = currentRoom.furniture.indexOf(id);
  if (idx >= 0) currentRoom.furniture.splice(idx, 1);
  else currentRoom.furniture.push(id);
  save();
  return getRoomConfig();
}

export function setPoster(slot: 0 | 1 | 2, poster: PosterId): RoomConfig {
  currentRoom.posters[slot] = poster;
  save();
  return getRoomConfig();
}

export function markSetupComplete(): RoomConfig {
  currentRoom.hasSetup = true;
  save();
  return getRoomConfig();
}

export function isFirstVisit(): boolean {
  return !currentRoom.hasSetup;
}

export function resetRoom(): RoomConfig {
  currentRoom = { ...DEFAULT_ROOM, furniture: [...DEFAULT_ROOM.furniture], posters: [...DEFAULT_ROOM.posters], furnitureColors: {} };
  save();
  return getRoomConfig();
}

/** Color definitions for each wall theme */
export const WALL_THEMES: Record<WallTheme, { bg: string; brick: string; accent: string; label: string }> = {
  default:  { bg: '#140c2a', brick: '#1a1040', accent: '#3a2878', label: 'Purple Brick' },
  midnight: { bg: '#0a0c2a', brick: '#0e1240', accent: '#1a2878', label: 'Midnight' },
  crimson:  { bg: '#1a0c0c', brick: '#2a1010', accent: '#4a1818', label: 'Crimson' },
  forest:   { bg: '#0a1a0c', brick: '#0e2810', accent: '#183a18', label: 'Forest' },
  amber:    { bg: '#1a150a', brick: '#28200e', accent: '#3a2e14', label: 'Amber Den' },
  slate:    { bg: '#12121a', brick: '#1a1a24', accent: '#2a2a3a', label: 'Slate' },
  neon:     { bg: '#04040a', brick: '#08080e', accent: '#0e0e1a', label: 'Neon Grid' },
  void:     { bg: '#060608', brick: '#0a0a0e', accent: '#0e0e14', label: 'Void' },
  rose:     { bg: '#1a0c14', brick: '#2a1020', accent: '#3e1a2e', label: 'Rose' },
  ocean:    { bg: '#080e1a', brick: '#0c1428', accent: '#122038', label: 'Ocean' },
  rust:     { bg: '#1a0e08', brick: '#28180c', accent: '#3a2010', label: 'Rust' },
};

/** Color definitions for each floor style */
export const FLOOR_STYLES: Record<FloorStyle, { base: string; alt: string; groove: string; label: string }> = {
  hardwood: { base: '#1e1040', alt: '#241448', groove: '#1a0c38', label: 'Hardwood' },
  tile:     { base: '#181830', alt: '#222244', groove: '#101028', label: 'Tile' },
  carpet:   { base: '#201838', alt: '#241c3e', groove: '#1a1230', label: 'Carpet' },
  concrete: { base: '#1a1a20', alt: '#1e1e26', groove: '#14141a', label: 'Concrete' },
  neon:     { base: '#06060e', alt: '#0e0e1a', groove: '#060610', label: 'Neon' },
  marble:   { base: '#dcd8ec', alt: '#504868', groove: '#a098b8', label: 'Marble' },
  tatami:   { base: '#1a1808', alt: '#242010', groove: '#141206', label: 'Tatami' },
  hex:      { base: '#12101e', alt: '#1a182c', groove: '#0e0c18', label: 'Hex Tile' },
  bamboo:   { base: '#2a2e12', alt: '#3e4418', groove: '#1a1e08', label: 'Bamboo' },
};

/** Color definitions for each lighting mood */
export const LIGHTING_MOODS: Record<LightingMood, { primary: string; glow: string; label: string }> = {
  teal:   { primary: '#5dcaa5', glow: '#2a8a6e', label: 'Teal' },
  pink:   { primary: '#e87aab', glow: '#c4568a', label: 'Pink' },
  purple: { primary: '#7b68ee', glow: '#4a2d8e', label: 'Purple' },
  amber:  { primary: '#f0b040', glow: '#c08020', label: 'Amber' },
  red:    { primary: '#e85454', glow: '#a83232', label: 'Red' },
  white:  { primary: '#e8e0d0', glow: '#a8a090', label: 'White' },
  cyan:   { primary: '#00e5ff', glow: '#0090aa', label: 'Cyan' },
  lime:   { primary: '#aaff44', glow: '#66aa00', label: 'Lime' },
  orange: { primary: '#ff7020', glow: '#c04800', label: 'Orange' },
};

/** Furniture display data */
export const FURNITURE_DATA: Record<FurnitureId, { label: string; emoji: string }> = {
  desk:      { label: 'Computer Desk', emoji: '🖥' },
  bookshelf: { label: 'Bookshelf', emoji: '📚' },
  couch:     { label: 'Couch', emoji: '🛋' },
  plant:     { label: 'Plant', emoji: '🪴' },
  rug:       { label: 'Area Rug', emoji: '🟪' },
  lamp:      { label: 'Floor Lamp', emoji: '💡' },
  speaker:   { label: 'Speaker', emoji: '🔊' },
  minifridge: { label: 'Mini Fridge', emoji: '🧊' },
  beanbag:   { label: 'Bean Bag', emoji: '🫘' },
  arcade:    { label: 'Arcade Cabinet', emoji: '🕹' },
  tv:        { label: 'Wall TV', emoji: '📺' },
  pet_bed:   { label: 'Pet Bed', emoji: '🛏' },
  cat_tree:  { label: 'Cat Tree', emoji: '🐾' },
  pet_bowl:  { label: 'Pet Bowls', emoji: '🥣' },
};

/** Poster display data */
export const POSTER_DATA: Record<PosterId, { label: string; emoji: string }> = {
  none:       { label: 'Empty', emoji: '⬜' },
  bitcoin:    { label: 'Bitcoin', emoji: '₿' },
  nostr:      { label: 'Nostr', emoji: '🟣' },
  pixel_art:  { label: 'Pixel Art', emoji: '🎨' },
  landscape:  { label: 'Landscape', emoji: '🏔' },
  cat:        { label: 'Cat', emoji: '🐱' },
  skull:      { label: 'Skull', emoji: '💀' },
  moon:       { label: 'Moon', emoji: '🌙' },
  code:       { label: 'Code', emoji: '⌨' },
  synthwave:  { label: 'Synthwave', emoji: '🌅' },
  matrix:     { label: 'Matrix', emoji: '💚' },
  space:      { label: 'Nebula', emoji: '🌌' },
};

/** All available furniture IDs */
export const ALL_FURNITURE: FurnitureId[] = ['desk', 'bookshelf', 'couch', 'plant', 'rug', 'lamp', 'speaker', 'minifridge', 'beanbag', 'arcade', 'tv', 'pet_bed', 'cat_tree', 'pet_bowl'];

/** All available poster IDs */
export const ALL_POSTERS: PosterId[] = ['none', 'bitcoin', 'nostr', 'pixel_art', 'landscape', 'cat', 'skull', 'moon', 'code', 'synthwave', 'matrix', 'space'];