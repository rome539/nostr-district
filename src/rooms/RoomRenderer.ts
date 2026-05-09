/**
 * RoomRenderer.ts — Canvas-based room background rendering orchestrator.
 * Drawing logic is split across:
 *   roomHelpers.ts   — shared utilities (lighten/darken/makeR, types)
 *   roomDoor.ts      — shared door rendering
 *   roomPosters.ts   — poster artwork (used by myroom)
 *   roomWalls.ts     — wall + floor patterns
 *   roomFurniture.ts — all furniture items for myroom
 *   roomForeground.ts — foreground layer items
 *   roomFixed.ts     — lounge, relay, feed, market, default rooms
 */

import {
  getRoomConfig,
  type RoomConfig,
  type FurnitureId,
  WALL_THEMES,
  FLOOR_STYLES,
  LIGHTING_MOODS,
  FURNITURE_BOUNDS,
} from '../stores/roomStore';

/**
 * Returns the visual bounds for a furniture item.
 * - PNG items: native texture dimensions (auto-syncs when sprites are resized)
 * - Canvas-drawn items: hardcoded entries in FURNITURE_BOUNDS
 * Returns null if the texture is missing (PNG) or no entry exists (canvas).
 */
export function getFurnitureBounds(scene: Phaser.Scene, id: FurnitureId): { w: number; h: number } | null {
  if (PNG_FURNITURE_IDS.has(id)) {
    const key = `furniture_${id}`;
    if (!scene.textures.exists(key)) return null;
    const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const w = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width;
    const h = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height;
    return { w, h };
  }
  return FURNITURE_BOUNDS[id] ?? null;
}
import { type BlinkingLED, type CandleFlame, type FireplaceFlame, type VoidStar, makeR } from './roomHelpers';
import { drawDoor } from './roomDoor';
import { drawWalls, drawFloor } from './roomWalls';
import { drawMyRoomFurniture } from './roomFurniture';
import { drawForegroundItems } from './roomForeground';
import { drawLounge, drawRelay, drawFeed, drawMarket, drawDefault } from './roomFixed';

const FOREGROUND_IDS = new Set<FurnitureId>(['record_crates', 'trunk', 'bookstack', 'bar_cart', 'cat_tree']);
// Items that should always render behind the player — drawn on the static background canvas
const BACKGROUND_ONLY_IDS = new Set<FurnitureId>(['rug', 'pet_bed']);
// PNG items that are floor rugs — render behind all furniture (depth 1), same as BACKGROUND_ONLY_IDS
export const PNG_BACKGROUND_IDS = new Set<FurnitureId>(['persianrug', 'bearskin', 'striperug', 'tigerskin', 'bitcoincircularrug']);
// Items where ONLY near-white pixels get the tint color (everything else stays as-is)
export const PNG_TINT_WHITE_IDS = new Set<FurnitureId>(['plant1']);
// PNG-based furniture items — loaded as Phaser textures, skips canvas drawing
export const PNG_FURNITURE_IDS = new Set<FurnitureId>([
  'walltapestry1',
  'walltapestry2',
  'walltapestry3',
  'hangingivy',
  'sworddec',
  'persianrugwall1',
  'persianrug',
  'bearskin',
  'striperug',
  'couch',
  'beanbag',
  'armchair',
  'plant1',
  'plant2',
  'plant3',
  'plant4',
  'plant5',
  'nostrsign',
  'plant6',
  'cactus',
  'daffodils',
  'neonskull',
  'neoncoffee',
  'decoratedcouch',
  'decoratedarmchair',
  'tigerskin',
  'coelacanthmount',
  'safe',
  'neongfy',
  'neon58k',
  'bitcoincircularrug',
  'endtable',
  'djtable',
  'ufopinup',
]);

// Asset paths for PNG furniture — defaults to assets/furniture/<id>.png if not listed
export const PNG_FURNITURE_PATHS: Partial<Record<FurnitureId, string>> = {
  walltapestry1:   'assets/furniture/decor/walltapestry1.png',
  walltapestry2:   'assets/furniture/decor/walltapestry2.png',
  walltapestry3:   'assets/furniture/decor/walltapestry3.png',
  hangingivy:      'assets/furniture/decor/hangingivy.png',
  sworddec:        'assets/furniture/decor/sworddec.png',
  persianrugwall1: 'assets/furniture/decor/persianrugwall1.png',
  persianrug:      'assets/furniture/lounge/persianrug.png',
  bearskin:        'assets/furniture/lounge/bearskin.png',
  striperug:       'assets/furniture/lounge/striperug.png',
  couch:           'assets/furniture/lounge/couch.png',
  beanbag:         'assets/furniture/lounge/beanbag.png',
  armchair:        'assets/furniture/lounge/armchair.png',
  plant1:          'assets/furniture/decor/plant1.png',
  plant2:          'assets/furniture/decor/plant2.png',
  plant3:          'assets/furniture/decor/plant3.png',
  plant4:          'assets/furniture/decor/plant4.png',
  plant5:          'assets/furniture/decor/plant5.png',
  nostrsign:       'assets/furniture/tech/NOSTR.png',
  plant6:            'assets/furniture/decor/plant6.png',
  cactus:            'assets/furniture/decor/cactus.png',
  daffodils:         'assets/furniture/decor/Daffodils.png',
  neonskull:         'assets/furniture/tech/neonskull.png',
  neoncoffee:        'assets/furniture/tech/neoncoffee.png',
  decoratedcouch:    'assets/furniture/lounge/decoratedcouch.png',
  decoratedarmchair: 'assets/furniture/lounge/decoratedarmchair.png',
  tigerskin:         'assets/furniture/lounge/tigerskin.png',
  coelacanthmount:   'assets/furniture/lounge/coelacanthmount.png',
  safe:              'assets/furniture/lounge/safe.png',
  neongfy:           'assets/furniture/tech/neongfy.png',
  neon58k:           'assets/furniture/tech/neon58k.png',
  bitcoincircularrug: 'assets/furniture/lounge/bitcoincircularrug.png',
  endtable:           'assets/furniture/lounge/endtable.png',
  djtable:            'assets/furniture/tech/djtable.png',
  ufopinup:           'assets/furniture/tech/ufopinup.png',
};

export type { CandleFlame };

export class RoomRenderer {
  public blinkingLEDs: BlinkingLED[] = [];
  public candleFlames: CandleFlame[] = [];
  public fireplaceFlames: FireplaceFlame[] = [];
  public voidStars: VoidStar[] = [];

  render(
    scene: Phaser.Scene,
    roomId: string,
    neonColor: string,
    W: number,
    H: number,
    ownerRoomConfig?: RoomConfig,
  ): string {
    this.blinkingLEDs = [];
    this.candleFlames = [];
    this.fireplaceFlames = [];
    this.voidStars = [];
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const x = canvas.getContext('2d')!;
    x.imageSmoothingEnabled = false;

    const rc = roomId.startsWith('myroom:') ? 'myroom' : roomId;
    const nc = neonColor;

    if      (rc === 'myroom') this.drawMyRoom(x, W, H, nc, ownerRoomConfig);
    else if (rc === 'lounge') drawLounge(x, W, H, nc);
    else if (rc === 'relay')  drawRelay(x, W, H, nc, this.blinkingLEDs);
    else if (rc === 'feed')   drawFeed(x, W, H, nc);
    else if (rc === 'market') drawMarket(x, W, H, nc);
    else                      drawDefault(x, W, H, nc);

    this.applyPostFX(x, W, H, nc);

    const texKey = `room_${roomId.replace(/[^a-z0-9]/g, '_')}`;
    if (scene.textures.exists(texKey)) scene.textures.remove(texKey);
    scene.textures.addCanvas(texKey, canvas);
    return texKey;
  }

  renderAllFurnitureItems(
    scene: Phaser.Scene,
    roomId: string,
    W: number,
    H: number,
    ownerRoomConfig?: RoomConfig,
  ): { id: FurnitureId; texKey: string }[] {
    const rc = roomId.startsWith('myroom:') ? 'myroom' : roomId;
    if (rc !== 'myroom') return [];
    const cfg = ownerRoomConfig ?? getRoomConfig();
    const wall  = WALL_THEMES[cfg.wallTheme];
    const light = LIGHTING_MOODS[cfg.lighting] ?? LIGHTING_MOODS['teal'];
    const FY = 300;
    const results: { id: FurnitureId; texKey: string }[] = [];
    for (const id of cfg.furniture.filter(id2 => !BACKGROUND_ONLY_IDS.has(id2) && !PNG_FURNITURE_IDS.has(id2) && !!FURNITURE_BOUNDS[id2])) {
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      if (FOREGROUND_IDS.has(id)) {
        drawForegroundItems(ctx, W, H, cfg, id);
      } else {
        drawMyRoomFurniture(ctx, W, FY, cfg, wall, light, this.blinkingLEDs, this.candleFlames, id);
      }
      const texKey = `roomi_${id}_${roomId.replace(/[^a-z0-9]/g, '_')}`;
      if (scene.textures.exists(texKey)) scene.textures.remove(texKey);
      scene.textures.addCanvas(texKey, canvas);
      results.push({ id, texKey });
    }
    return results;
  }

  private drawMyRoom(
    x: CanvasRenderingContext2D,
    W: number,
    H: number,
    nc: string,
    ownerRoomConfig?: RoomConfig,
  ): void {
    const cfg = ownerRoomConfig ?? getRoomConfig();
    const wall  = WALL_THEMES[cfg.wallTheme];
    const floor = FLOOR_STYLES[cfg.floorStyle];
    const light = LIGHTING_MOODS[cfg.lighting] ?? LIGHTING_MOODS['teal'];
    const r = makeR(x);
    const FY = 300;

    drawWalls(x, W, FY, cfg.wallTheme, wall, light, r, undefined, this.voidStars);
    if (cfg.wallTheme === 'cabin') this.fireplaceFlames.push({ x: 400, y: 289, w: 48 });
    drawFloor(x, W, H, FY, cfg.floorStyle, floor, light, r, this.voidStars);
    // Background-only items (rug, pet_bed) always behind player
    for (const id of cfg.furniture) {
      if (BACKGROUND_ONLY_IDS.has(id)) {
        drawMyRoomFurniture(x, W, FY, cfg, wall, light, this.blinkingLEDs, this.candleFlames, id);
      }
    }
    drawMyRoomFurniture(x, W, FY, cfg, wall, light, this.blinkingLEDs, this.candleFlames, '__static__');
    drawDoor(x, W, H - 64, nc, H);
  }

  private applyPostFX(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void {
    x.globalAlpha = 0.015;
    for (let i = 0; i < W; i += 3) { x.fillStyle = nc; x.fillRect(i, 0, 1, H); }
    x.globalAlpha = 1;
    const grad = x.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.6);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.35)');
    x.fillStyle = grad;
    x.fillRect(0, 0, W, H);
  }
}
