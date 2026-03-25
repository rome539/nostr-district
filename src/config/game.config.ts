export const GAME_WIDTH = 800;
export const GAME_HEIGHT = 480;
export const WORLD_WIDTH = 1600;
export const PLAYER_SPEED = 120;
export const GROUND_Y = 340;

// ── Extended Palette ──
export const P = {
  // Core darks
  bg: '#0a0014',
  sky: '#0d0020',
  skyDark: '#08001a',
  void: '#020008',

  // Neon pinks
  pink: '#e87aab',
  dpink: '#c4568a',
  lpink: '#f5b8d0',
  hotpink: '#ff4090',

  // Purples
  purp: '#7b68ee',
  dpurp: '#4a2d8e',
  lpurp: '#b8a8f8',
  violet: '#9a6eff',

  // Navy / structure
  navy: '#1a1040',
  dnavy: '#0e0828',
  mnavy: '#140c30',

  // Teals
  teal: '#5dcaa5',
  dteal: '#2a8a6e',
  lteal: '#8aecd0',
  cyan: '#40e8ff',

  // Reds
  red: '#e85454',
  dred: '#a83232',
  lred: '#f09595',

  // Ambers / golds
  amber: '#f0b040',
  damber: '#c08020',
  lamber: '#fad480',
  gold: '#ffe060',

  // Warm tones
  cream: '#f5e8d0',
  lcream: '#fff5e6',
  warm: '#e8a878',
  peach: '#f0a090',

  // Building shades
  bldg1: '#18103a',
  bldg2: '#1e1448',
  bldg3: '#140c30',
  bldg4: '#221850',
  bldg5: '#1a1244',

  // Ground
  ground: '#2a1858',
  sidewalk: '#3a2068',

  // Signs
  sign1: '#ff6090',
  sign2: '#60d0ff',
  sign3: '#ffe040',
  sign4: '#80ff90',
};

// ── Animation timing ──
export const ANIM = {
  neonFlicker: 80,         // ms per flicker frame
  bubbleFadeDuration: 800, // ms for speech bubble fade
  bubbleLifetime: 5000,    // ms total bubble display
  enterFlashDuration: 350, // ms neon door flash
  breatheSpeed: 0.002,     // speed for pulsing neon glow
  parallaxFactor: 0.4,     // background parallax multiplier
};

// ── Room themes ──
export const ROOM_THEMES: Record<string, { accent: string; ambient: string; floorTint: string }> = {
  relay:  { accent: P.sign1,  ambient: '#0a0818', floorTint: '#0e0828' },
  feed:   { accent: P.pink,   ambient: '#0c0820', floorTint: '#120a2c' },
  myroom: { accent: P.teal,   ambient: '#140c2a', floorTint: '#1e1040' },
  lounge: { accent: P.purp,   ambient: '#0b0020', floorTint: '#1a0a3e' },
  market: { accent: P.amber,  ambient: '#120828', floorTint: '#1a0c38' },
};

export function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// Convert hex string to { r, g, b } (0-255)
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = hexToNum(hex);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}