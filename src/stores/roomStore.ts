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
  | 'rust'       // industrial rust orange
  | 'cityview'   // floor-to-ceiling windows with night city skyline
  | 'cabin'       // log cabin wall with stone fireplace
  | 'dungeon'     // dungeon stone PNG wall
  | 'brickwall'   // brick wall PNG
  | 'marblewall'  // marble wall PNG
  | 'marblewallblack' // black marble wall PNG
  | 'oldpaperwall'; // old paper/worn wall PNG

export type FloorStyle =
  | 'hardwood'   // original purple wood planks
  | 'tile'       // checkerboard tile
  | 'carpet'     // soft solid color
  | 'concrete'   // industrial gray
  | 'neon'       // dark with neon trim
  | 'marble'     // white with gray veins
  | 'tatami'     // japanese woven mat
  | 'hex'        // hexagonal tile pattern
  | 'bamboo'          // vertical bamboo stalks
  | 'slate'           // polished dark slate tiles
  | 'void'            // deep space — stars beneath your feet
  | 'marbleblack'     // black marble PNG floor
  | 'carpetred'       // red carpet PNG floor
  | 'carpetpurple'    // purple carpet PNG floor
  | 'carpetblue'      // blue carpet PNG floor
  | 'carpetgold'      // gold carpet PNG floor
  | 'parquetwood'     // parquet wood PNG floor
  | 'dungeon'         // dungeon stone PNG floor
  | 'dirtfloor'       // dirt floor PNG
  | 'oldwoodenfloor'; // old wooden floor PNG

export type LightingMood =
  | 'teal'
  | 'pink'
  | 'purple'
  | 'amber'
  | 'red'
  | 'white'
  | 'cyan'
  | 'lime'
  | 'orange';

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
  | 'pet_bed'      // round cushioned pet bed (cat & dog)
  | 'cat_tree'     // cat tree / scratching post
  | 'pet_bowl'     // food & water bowl set
  | 'coffee_table' // low table in front of couch
  | 'record_player'// vinyl turntable on a stand
  | 'lava_lamp'    // glowing blob lamp
  | 'whiteboard'   // wall-mounted whiteboard with diagrams
  | 'server_rack'   // cyberpunk server rack with blinking LEDs
  | 'candles'       // clustered candles with warm glow
  | 'record_crates' // milk crates full of vinyl records
  | 'trunk'         // vintage wooden storage trunk
  | 'bookstack'     // messy pile of books on the floor
  | 'bar_cart'      // rolling bar cart with bottles
  | 'walltapestry1' // square wall tapestry
  | 'walltapestry2' // tall wall tapestry
  | 'walltapestry3' // large wall tapestry
  | 'hangingivy'     // hanging ivy wall plant
  | 'sworddec'       // decorative sword wall mount
  | 'gladusmount'    // decorative gladius wall mount
  | 'swordmount'    // decorative katana wall mount
  | 'persianrugwall1' // persian rug wall hanging
  | 'persianrug'      // persian rug floor item
  | 'bearskin'        // bearskin rug
  | 'striperug'       // striped area rug
  | 'armchair'        // arm chair
  | 'plant1'          // potted plant variant 1
  | 'plant2'          // potted plant variant 2
  | 'plant3'          // potted plant variant 3
  | 'plant4'          // potted plant variant 4
  | 'plant5'          // potted plant variant 5
  | 'nostrsign'       // NOSTR neon sign (wall)
  | 'plant6'          // potted plant variant 6
  | 'cactus'          // cactus in a pot
  | 'daffodils'       // daffodil flower pot
  | 'neonskull'       // skull neon sign (wall)
  | 'neoncoffee'      // coffee neon sign (wall)
  | 'decoratedcouch'    // decorated variant couch
  | 'decoratedarmchair' // decorated variant arm chair
  | 'tigerskin'         // tiger skin rug (floor)
  | 'coelacanthmount'   // coelacanth wall trophy mount (earned by catching the legendary fish)
  | 'safe'             // heavy floor safe
  | 'neongfy'          // GFY neon sign (wall)
  | 'neon58k'          // 58k neon sign (wall)
  | 'bitcoincircularrug' // bitcoin circular floor rug
  | 'carddeck'           // small deck of playing cards
  | 'endtable'           // small end table (lounge)
  | 'djtable'            // DJ turntable setup (tech)
  | 'ufopinup';          // UFO pin-up wall poster (tech)

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

export type FurniturePos = { x: number; y: number };

const FURNITURE_DEFAULT_POS_FALLBACK: FurniturePos = { x: 300, y: 310 };

/** Default anchor positions (top-left of visual bounding box) at FY=300, W=800 */
export const FURNITURE_DEFAULT_POS: Partial<Record<FurnitureId, FurniturePos>> = {
  desk:          { x: 558, y: 160 },
  bookshelf:     { x: 755, y: 115 },
  couch:         { x: 30,  y: 230 },
  plant:         { x: 566, y: 219 },
  rug:           { x: 250, y: 318 },
  lamp:          { x: 190, y: 145 },
  speaker:       { x: 8,   y: 252 },
  minifridge:    { x: 192, y: 252 },
  beanbag:       { x: 321, y: 260 },
  armchair:      { x: 210, y: 230 },
  arcade:        { x: 480, y: 190 },
  tv:            { x: 305, y: 46  },
  pet_bed:       { x: 668, y: 424 },
  cat_tree:      { x: 757, y: 340 },
  pet_bowl:      { x: 598, y: 428 },
  coffee_table:  { x: 30,  y: 308 },
  record_player: { x: 420, y: 262 },
  lava_lamp:     { x: 229, y: 230 },
  whiteboard:    { x: 596, y: 14  },
  server_rack:   { x: 524, y: 192 },
  candles:       { x: 76,  y: 278 },
  record_crates: { x: 10,  y: 411 },
  trunk:         { x: 100, y: 424 },
  bookstack:     { x: 182, y: 416 },
  bar_cart:      { x: 240, y: 388 },
  walltapestry1: { x: 50,  y: 30  },
  walltapestry2: { x: 450, y: 20  },
  walltapestry3: { x: 655, y: 15  },
  hangingivy:    { x: 690, y: 30  },
  sworddec:        { x: 200, y: 20  },
  gladusmount:      { x: 90,  y: 90  },
  swordmount:      { x: 250, y: 90  },
  persianrugwall1: { x: 350, y: 20  },
  persianrug:      { x: 260, y: 318 },
  bearskin:        { x: 200, y: 320 },
  striperug:       { x: 250, y: 318 },
  plant1:          { x: 566, y: 221 },
  plant2:          { x: 20,  y: 220 },
  plant3:          { x: 120, y: 220 },
  plant4:          { x: 430, y: 220 },
  plant5:          { x: 460, y: 220 },
  nostrsign:       { x: 200, y: 50  },
  plant6:           { x: 350, y: 220 },
  cactus:           { x: 185, y: 200 },
  daffodils:        { x: 530, y: 220 },
  neonskull:        { x: 580, y: 50  },
  neoncoffee:       { x: 420, y: 50  },
  decoratedcouch:    { x: 30,  y: 230 },
  decoratedarmchair: { x: 210, y: 230 },
  tigerskin:         { x: 150, y: 320 },
  coelacanthmount:   { x: 300, y: 30  },
  safe:              { x: 750, y: 380 },
  neongfy:           { x: 100, y: 50  },
  neon58k:           { x: 180, y: 50  },
  bitcoincircularrug: { x: 310, y: 310 },
  carddeck:           { x: 88,  y: 287 },
  djtable:            { x: 290, y: 295 },
  ufopinup:           { x: 340, y: 50  },
};

export function getDefaultPos(id: FurnitureId): FurniturePos {
  return FURNITURE_DEFAULT_POS[id] ?? FURNITURE_DEFAULT_POS_FALLBACK;
}

/**
 * Visual bounding box size for canvas-drawn furniture items (pixels).
 * PNG items are NOT listed here — use getFurnitureBounds() from RoomRenderer
 * to read native PNG dimensions at runtime.
 */
export const FURNITURE_BOUNDS: Partial<Record<FurnitureId, { w: number; h: number }>> = {
  desk:          { w: 196, h: 140 },
  bookshelf:     { w: 35,  h: 185 },
  plant:         { w: 20,  h: 40  },
  rug:           { w: 280, h: 104 },
  lamp:          { w: 32,  h: 160 },
  speaker:       { w: 22,  h: 50  },
  minifridge:    { w: 30,  h: 50  },
  arcade:        { w: 42,  h: 112 },
  tv:            { w: 130, h: 101 },
  pet_bed:       { w: 56,  h: 44  },
  cat_tree:      { w: 40,  h: 133 },
  pet_bowl:      { w: 48,  h: 16  },
  coffee_table:  { w: 130, h: 26  },
  record_player: { w: 28,  h: 40  },
  lava_lamp:     { w: 18,  h: 70  },
  whiteboard:    { w: 56,  h: 81  },
  server_rack:   { w: 32,  h: 110 },
  candles:       { w: 34,  h: 34  },
  record_crates: { w: 70,  h: 61  },
  trunk:         { w: 70,  h: 44  },
  bookstack:     { w: 54,  h: 60  },
  bar_cart:      { w: 56,  h: 85  },
  carddeck:      { w: 44,  h: 21  },
};

export const POSTER_DEFAULT_POS: [FurniturePos, FurniturePos, FurniturePos] = [
  { x: 50,  y: 40 },
  { x: 160, y: 30 },
  { x: 470, y: 35 },
];
export const POSTER_SIZE: [{ w: number; h: number }, { w: number; h: number }, { w: number; h: number }] = [
  { w: 80, h: 100 },
  { w: 70, h: 90  },
  { w: 90, h: 70  },
];

export interface RoomConfig {
  wallTheme: WallTheme;
  floorStyle: FloorStyle;
  lighting: LightingMood;
  furniture: FurnitureId[];
  /** Up to 3 poster slots: left wall, center wall, right wall */
  posters: [PosterId, PosterId, PosterId];
  /** Per-furniture color overrides (hex string). If not set, uses default. */
  furnitureColors: Partial<Record<FurnitureId, string>>;
  /** Per-furniture position overrides. Missing keys use FURNITURE_DEFAULT_POS. */
  furniturePositions: Partial<Record<FurnitureId, FurniturePos>>;
  /** Per-poster position overrides. Null entries use POSTER_DEFAULT_POS. */
  posterPositions: [FurniturePos | null, FurniturePos | null, FurniturePos | null];
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
  furniturePositions: {},
  posterPositions: [null, null, null],
  hasSetup: false,
  ceilingLightColor: null,
  pinnedNote: null,
  pet: { species: 'none', breed: 1 },
};

let currentRoom: RoomConfig = { ...DEFAULT_ROOM, furniture: [...DEFAULT_ROOM.furniture], posters: [...DEFAULT_ROOM.posters], furnitureColors: {}, furniturePositions: {}, posterPositions: [null, null, null] };

function save(): void {
  // in-memory only — persisted via kind:30078 on demand
}

/** Apply a RoomConfig fetched from Nostr into in-memory state. */
export function applyRemoteRoomConfig(remote: RoomConfig): void {
  currentRoom = {
    ...DEFAULT_ROOM,
    ...remote,
    wallTheme:  remote.wallTheme  in WALL_THEMES  ? remote.wallTheme  : DEFAULT_ROOM.wallTheme,
    floorStyle: remote.floorStyle in FLOOR_STYLES ? remote.floorStyle : DEFAULT_ROOM.floorStyle,
    furniture: remote.furniture ? [...remote.furniture] : [...DEFAULT_ROOM.furniture],
    posters: remote.posters ? [remote.posters[0] || 'none', remote.posters[1] || 'none', remote.posters[2] || 'none'] as [PosterId, PosterId, PosterId] : [...DEFAULT_ROOM.posters] as [PosterId, PosterId, PosterId],
    furnitureColors: remote.furnitureColors ? { ...remote.furnitureColors } : {},
    furniturePositions: remote.furniturePositions ? { ...remote.furniturePositions } : {},
    posterPositions: remote.posterPositions ? [...remote.posterPositions] as [FurniturePos | null, FurniturePos | null, FurniturePos | null] : [null, null, null],
    pet: remote.pet ?? DEFAULT_ROOM.pet,
  };
}

export function getRoomConfig(): RoomConfig {
  return {
    ...currentRoom,
    furniture: [...currentRoom.furniture],
    posters: [...currentRoom.posters] as [PosterId, PosterId, PosterId],
    furnitureColors: { ...currentRoom.furnitureColors },
    furniturePositions: { ...currentRoom.furniturePositions },
    posterPositions: [...currentRoom.posterPositions] as [FurniturePos | null, FurniturePos | null, FurniturePos | null],
  };
}

export function setRoomConfig(config: Partial<RoomConfig>): RoomConfig {
  if (config.furniture) currentRoom.furniture = [...config.furniture];
  if (config.posters) currentRoom.posters = [...config.posters] as [PosterId, PosterId, PosterId];
  if (config.wallTheme !== undefined) currentRoom.wallTheme = config.wallTheme in WALL_THEMES ? config.wallTheme : 'default';
  if (config.floorStyle !== undefined) currentRoom.floorStyle = config.floorStyle in FLOOR_STYLES ? config.floorStyle : 'hardwood';
  if (config.lighting !== undefined) currentRoom.lighting = config.lighting;
  if (config.hasSetup !== undefined) currentRoom.hasSetup = config.hasSetup;
  if (config.ceilingLightColor !== undefined) currentRoom.ceilingLightColor = config.ceilingLightColor;
  if (config.pinnedNote !== undefined) currentRoom.pinnedNote = config.pinnedNote;
  if (config.furnitureColors !== undefined) currentRoom.furnitureColors = { ...config.furnitureColors };
  if (config.furniturePositions !== undefined) currentRoom.furniturePositions = { ...config.furniturePositions };
  if (config.posterPositions !== undefined) currentRoom.posterPositions = [...config.posterPositions] as [FurniturePos | null, FurniturePos | null, FurniturePos | null];
  if (config.pet !== undefined) currentRoom.pet = { ...config.pet };
  save();
  return getRoomConfig();
}

export function setPosterPosition(slot: 0 | 1 | 2, pos: FurniturePos): RoomConfig {
  currentRoom.posterPositions[slot] = pos;
  save();
  return getRoomConfig();
}

export function setFurniturePosition(id: FurnitureId, pos: FurniturePos): RoomConfig {
  currentRoom.furniturePositions = { ...currentRoom.furniturePositions, [id]: pos };
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
  cat_tree:     '#5a3a1a',  // natural tan/sisal
  pet_bowl:     '#2a1e3e',  // dark pewter
  coffee_table: '#2a1a0c',  // dark walnut wood
  record_player:'#1e1432',  // dark charcoal plastic
  lava_lamp:    '#e87aab',  // pink blobs
  whiteboard:   '#2a1a0c',  // dark wood frame
  server_rack:   '#1e1432',  // dark charcoal
  candles:       '#f0e0a8',  // warm ivory wax
  record_crates: '#c87840',  // orange-tan milk crate plastic
  trunk:         '#3a2410',  // dark walnut wood
  bookstack:     '#2a1858',  // deep purple (spine color)
  bar_cart:      '#2a2a2a',  // brushed dark metal
  walltapestry1: '#d4c4a8',  // warm ivory
  walltapestry2: '#d4c4a8',  // warm ivory
  walltapestry3: '#d4c4a8',  // warm ivory
  hangingivy:    '#ffffff',
  sworddec:        '#c8c8c8',  // steel grey
  gladusmount:      '#c8c8c8',  // steel grey
  swordmount:      '#c8c8c8',  // steel grey
  persianrugwall1: '#d4c4a8',  // warm ivory
  persianrug:      '#d4c4a8',  // warm ivory
  bearskin:        '#c8b89a',  // natural tan
  striperug:       '#d4c4a8',  // warm ivory
  armchair:        '#3d2860',  // deep purple
  plant1:          '#ffffff',  // white = no tint by default; color picker tints the white pot
  plant2:          '#ffffff',  // no tint
  plant3:          '#ffffff',
  plant4:          '#ffffff',
  plant5:          '#ffffff',
  plant6:            '#ffffff',
  cactus:            '#ffffff',
  daffodils:         '#ffffff',
  neonskull:         '#ff3355',
  neoncoffee:        '#ff9020',
  decoratedcouch:    '#3d2860',
  decoratedarmchair: '#3d2860',
  nostrsign:       '#7b2ff7',  // nostr purple
  tigerskin:       '#ffffff',  // preserve natural PNG colors
  coelacanthmount: '#ffffff',
  safe:            '#ffffff',
  neongfy:           '#ff3355',
  neon58k:           '#ff3355',
  bitcoincircularrug: '#ffffff',
  carddeck:           '#8b0000',
  endtable:           '#2a1a08',
  djtable:            '#ffffff',
  ufopinup:           '#ffffff',
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
  currentRoom = { ...DEFAULT_ROOM, furniture: [...DEFAULT_ROOM.furniture], posters: [...DEFAULT_ROOM.posters], furnitureColors: {}, furniturePositions: {}, posterPositions: [null, null, null] };
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
  rose:     { bg: '#1a0c14', brick: '#2a1020', accent: '#3e1a2e', label: 'Rose' },
  ocean:    { bg: '#080e1a', brick: '#0c1428', accent: '#122038', label: 'Ocean' },
  rust:     { bg: '#1a0e08', brick: '#28180c', accent: '#3a2010', label: 'Rust' },
  cityview: { bg: '#04080f', brick: '#0a0e1a', accent: '#1a1e2a', label: 'City View' },
  cabin:    { bg: '#110904', brick: '#1a0d06', accent: '#3a1e0a', label: 'Log Cabin' },
  void:     { bg: '#060608', brick: '#0a0a0e', accent: '#0e0e14', label: 'Void' },
  dungeon:     { bg: '#0c0c0e', brick: '#141416', accent: '#2a2a30', label: 'Dungeon' },
  brickwall:   { bg: '#1a0e08', brick: '#2a1810', accent: '#3a2014', label: 'Brick Wall' },
  marblewall:  { bg: '#d8d4df', brick: '#c8c3d0', accent: '#90889c', label: 'Marble Wall' },
  marblewallblack: { bg: '#08080c', brick: '#101018', accent: '#303040', label: 'Black Marble Wall' },
  oldpaperwall:{ bg: '#1a1610', brick: '#24201a', accent: '#3a3428', label: 'Old Paper Wall' },
};

/** Color definitions for each floor style */
export const FLOOR_STYLES: Record<FloorStyle, { base: string; alt: string; groove: string; label: string }> = {
  hardwood: { base: '#1e1040', alt: '#241448', groove: '#1a0c38', label: 'Hardwood' },
  tile:     { base: '#181830', alt: '#222244', groove: '#101028', label: 'Tile' },
  carpet:   { base: '#201838', alt: '#241c3e', groove: '#1a1230', label: 'Carpet' },
  concrete: { base: '#1a1a20', alt: '#1e1e26', groove: '#14141a', label: 'Concrete' },
  neon:     { base: '#06060e', alt: '#0e0e1a', groove: '#060610', label: 'Neon' },
  slate:    { base: '#060608', alt: '#0e0e14', groove: '#040408', label: 'Slate' },
  tatami:   { base: '#1a1808', alt: '#242010', groove: '#141206', label: 'Tatami' },
  hex:      { base: '#12101e', alt: '#1a182c', groove: '#0e0c18', label: 'Hex Tile' },
  bamboo:         { base: '#2a2e12', alt: '#3e4418', groove: '#1a1e08', label: 'Bamboo' },
  marble:         { base: '#dcd8ec', alt: '#504868', groove: '#a098b8', label: 'Marble' },
  marbleblack:    { base: '#08080c', alt: '#20202a', groove: '#383848', label: 'Black Marble' },
  carpetred:      { base: '#321018', alt: '#501828', groove: '#18080c', label: 'Red Carpet' },
  carpetpurple:   { base: '#241038', alt: '#3a1a58', groove: '#140820', label: 'Purple Carpet' },
  carpetblue:     { base: '#101c38', alt: '#183060', groove: '#081020', label: 'Blue Carpet' },
  carpetgold:     { base: '#4a3510', alt: '#7a5a18', groove: '#241804', label: 'Gold Carpet' },
  parquetwood:    { base: '#3a220c', alt: '#5a3412', groove: '#1a0e04', label: 'Parquet Wood' },
  dungeon:        { base: '#141416', alt: '#1a1a1e', groove: '#0c0c0e', label: 'Dungeon' },
  dirtfloor:      { base: '#1a1208', alt: '#221808', groove: '#100c04', label: 'Dirt Floor' },
  oldwoodenfloor: { base: '#1e1408', alt: '#2a1e0c', groove: '#140e04', label: 'Old Wood Floor' },
  void:           { base: '#060608', alt: '#0a0a0e', groove: '#0e0e14', label: 'Void' },
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
  pet_bed:       { label: 'Pet Bed',       emoji: '🛏' },
  cat_tree:      { label: 'Cat Tree',      emoji: '🐾' },
  pet_bowl:      { label: 'Pet Bowls',     emoji: '🥣' },
  coffee_table:  { label: 'Coffee Table',  emoji: '🪵' },
  record_player: { label: 'Record Player', emoji: '🎵' },
  lava_lamp:     { label: 'Lava Lamp',     emoji: '🌡' },
  whiteboard:    { label: 'Whiteboard',    emoji: '📋' },
  server_rack:   { label: 'Server Rack',   emoji: '🖥' },
  candles:       { label: 'Candles',       emoji: '🕯' },
  record_crates: { label: 'Record Crates', emoji: '📦' },
  trunk:         { label: 'Trunk',         emoji: '🧳' },
  bookstack:     { label: 'Book Stack',    emoji: '📚' },
  bar_cart:      { label: 'Bar Cart',      emoji: '🍾' },
  walltapestry1: { label: 'Tapestry 1',   emoji: '🖼' },
  walltapestry2: { label: 'Tapestry 2',   emoji: '🖼' },
  walltapestry3: { label: 'Tapestry 3',   emoji: '🖼' },
  hangingivy:    { label: 'Hanging Ivy',  emoji: '🌿' },
  sworddec:        { label: 'Sword Mount',    emoji: '⚔️' },
  gladusmount:      { label: 'Gladius Mount',  emoji: '⚔️' },
  swordmount:      { label: 'Katana Mount',   emoji: '⚔️' },
  persianrugwall1: { label: 'Persian Rug',   emoji: '🪆' },
  persianrug:      { label: 'Persian Rug',   emoji: '🪆' },
  bearskin:        { label: 'Bearskin Rug',  emoji: '🐻' },
  striperug:       { label: 'Stripe Rug',    emoji: '🟫' },
  armchair:        { label: 'Arm Chair',     emoji: '🪑' },
  plant1:          { label: 'Snake Plant',   emoji: '🪴' },
  plant2:          { label: 'Bonsai',        emoji: '🪴' },
  plant3:          { label: 'Lavender',      emoji: '🪴' },
  plant4:          { label: 'Monstera',      emoji: '🪴' },
  plant5:          { label: 'Red Tulips',    emoji: '🪴' },
  nostrsign:       { label: 'NOSTR Sign',    emoji: '🟣' },
  plant6:          { label: 'Mini Sunflower', emoji: '🪴' },
  cactus:            { label: 'Cactus',               emoji: '🌵' },
  daffodils:         { label: 'Daffodils',            emoji: '🌼' },
  neonskull:         { label: 'Skull Neon Sign',      emoji: '💀' },
  neoncoffee:        { label: 'Coffee Neon Sign',     emoji: '☕' },
  decoratedcouch:    { label: 'Decorated Couch',      emoji: '🛋' },
  decoratedarmchair: { label: 'Decorated Armchair',   emoji: '🪑' },
  tigerskin:         { label: 'Tiger Skin Rug',       emoji: '🐯' },
  coelacanthmount:   { label: 'Coelacanth Mount',     emoji: '🐟' },
  safe:              { label: 'Safe',                  emoji: '🔒' },
  neongfy:           { label: 'GFY Neon Sign',         emoji: '🔆' },
  neon58k:           { label: '58k Neon Sign',         emoji: '🔆' },
  bitcoincircularrug: { label: 'Bitcoin Circular Rug', emoji: '₿' },
  carddeck:           { label: 'Playing Cards',        emoji: '🃏' },
  endtable:           { label: 'End Table',             emoji: '🪵' },
  djtable:            { label: 'DJ Table',              emoji: '🎧' },
  ufopinup:           { label: 'UFO Pin-Up',            emoji: '🛸' },
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
export const ALL_FURNITURE: FurnitureId[] = ['desk', 'bookshelf', 'couch', 'plant', 'rug', 'lamp', 'speaker', 'minifridge', 'beanbag', 'arcade', 'tv', 'pet_bed', 'cat_tree', 'pet_bowl', 'coffee_table', 'record_player', 'lava_lamp', 'whiteboard', 'server_rack', 'candles', 'record_crates', 'trunk', 'bookstack', 'bar_cart', 'carddeck'];

/** All available poster IDs */
export const ALL_POSTERS: PosterId[] = ['none', 'bitcoin', 'nostr', 'pixel_art', 'landscape', 'cat', 'skull', 'moon', 'code', 'synthwave', 'matrix', 'space'];
