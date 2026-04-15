/**
 * RoomRenderer.ts — Canvas-based room background rendering
 * Extracted from RoomScene. Each draw method renders a room to an offscreen canvas.
 *
 * MyRoom is now dynamic — reads from roomStore for walls, floors, furniture, posters, lighting.
 */

import { P } from '../config/game.config';
import {
  getRoomConfig, RoomConfig,
  WALL_THEMES, FLOOR_STYLES, LIGHTING_MOODS,
  getFurnitureColor,
  PosterId,
} from '../stores/roomStore';

type BlinkingLED = { x: number; y: number; color: string; phase: number };
export type CandleFlame = { x: number; y: number; phase: number };

export class RoomRenderer {
  public blinkingLEDs: BlinkingLED[] = [];
  public candleFlames: CandleFlame[] = [];

  /** Render a room background to canvas and return the texture key */
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
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const x = canvas.getContext('2d')!;
    x.imageSmoothingEnabled = false;

    const rc = roomId.startsWith('myroom:') ? 'myroom' : roomId;
    const nc = neonColor;

    if (rc === 'myroom') this.drawMyRoom(x, W, H, nc, ownerRoomConfig);
    else if (rc === 'lounge') this.drawLounge(x, W, H, nc);
    else if (rc === 'relay') this.drawRelay(x, W, H, nc);
    else if (rc === 'feed') this.drawFeed(x, W, H, nc);
    else if (rc === 'market') this.drawMarket(x, W, H, nc);
    else this.drawDefault(x, W, H, nc);

    this.applyPostFX(x, W, H, nc);

    const texKey = `room_${roomId.replace(/[^a-z0-9]/g, '_')}`;
    if (scene.textures.exists(texKey)) scene.textures.remove(texKey);
    scene.textures.addCanvas(texKey, canvas);
    return texKey;
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

  // ════════════════════════════════════════════
  // DOOR — shared by all rooms
  // ════════════════════════════════════════════
  private drawDoor(x: CanvasRenderingContext2D, W: number, _doorY: number, nc: string, GAME_HEIGHT: number): void {
    const doorW = 44; const doorH = 60;
    const doorX = W / 2 - doorW / 2;
    const doorY = GAME_HEIGHT - doorH - 4;
    const frameX = doorX - 10;
    const frameY = doorY - 10;
    const frameW = doorW + 20;
    const frameH = doorH + 14;

    x.fillStyle = '#3a2878'; x.globalAlpha = 0.42;
    x.fillRect(frameX, frameY, frameW, frameH);
    x.fillStyle = '#2a1858'; x.globalAlpha = 0.32;
    x.fillRect(doorX - 6, doorY - 6, doorW + 12, doorH + 8);
    x.fillStyle = '#120a28'; x.globalAlpha = 0.4;
    x.fillRect(frameX + 1, frameY + 1, frameW - 2, frameH - 2);
    x.globalAlpha = 0.3;
    x.fillStyle = '#4a3888'; x.fillRect(doorX - 8, doorY - 10, doorW + 16, 3);
    x.globalAlpha = 0.45;
    x.fillStyle = '#0a0818'; x.fillRect(doorX, doorY, doorW, doorH);
    x.globalAlpha = 0.35;
    x.fillStyle = '#0e0828';
    x.fillRect(doorX + 4, doorY + 4, doorW - 8, doorH / 2 - 5);
    x.fillRect(doorX + 4, doorY + doorH / 2 + 1, doorW - 8, doorH / 2 - 5);
    x.strokeStyle = '#1a1040'; x.lineWidth = 1; x.globalAlpha = 0.5;
    x.strokeRect(doorX + 5, doorY + 5, doorW - 10, doorH / 2 - 7);
    x.strokeRect(doorX + 5, doorY + doorH / 2 + 2, doorW - 10, doorH / 2 - 7);
    x.fillStyle = nc; x.globalAlpha = 0.6;
    x.fillRect(doorX + doorW - 12, doorY + doorH / 2 - 4, 4, 8);
    x.globalAlpha = 0.3; x.fillRect(doorX + doorW - 13, doorY + doorH / 2 - 5, 6, 10);
    x.globalAlpha = 1;
    x.strokeStyle = nc; x.lineWidth = 1; x.globalAlpha = 0.14;
    x.strokeRect(doorX - 2, doorY - 2, doorW + 4, doorH + 4); x.globalAlpha = 1;
    const labelW = 60; const labelH = 18;
    const labelX = W / 2 - labelW / 2; const labelY = doorY - 26;
    x.globalAlpha = 0.5; x.fillStyle = '#0a0818'; x.fillRect(labelX, labelY, labelW, labelH); x.globalAlpha = 1;
    x.strokeStyle = nc; x.globalAlpha = 0.3; x.strokeRect(labelX, labelY, labelW, labelH); x.globalAlpha = 1;
    x.fillStyle = nc; x.globalAlpha = 0.85; x.font = 'bold 10px monospace'; x.textAlign = 'center';
    x.fillText('\u2190 EXIT', W / 2, labelY + 13); x.globalAlpha = 1;
    x.fillStyle = nc; x.globalAlpha = 0.02; x.fillRect(doorX - 20, doorY + doorH, doorW + 40, 16); x.globalAlpha = 1;
  }

  // ════════════════════════════════════════════
  // DYNAMIC MY ROOM
  // ════════════════════════════════════════════
  private drawMyRoom(x: CanvasRenderingContext2D, W: number, H: number, nc: string, ownerRoomConfig?: RoomConfig): void {
    const cfg = ownerRoomConfig ?? getRoomConfig();
    const wall = WALL_THEMES[cfg.wallTheme];
    const floor = FLOOR_STYLES[cfg.floorStyle];
    const light = LIGHTING_MOODS[cfg.lighting];
    const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); };
    const FY = 300;
    // Fixed furniture colors — independent of wall theme
    const FUR_FRAME = '#1e1432';   // dark charcoal body (couch frame, desk legs)
    const FUR_MID   = '#2a1c48';   // mid upholstery / desk surface
    const FUR_DARK  = '#140e26';   // darkest accent (drawer panels, keyboard)
    // Per-furniture accent colors
    const COUCH_BODY  = '#3d2860'; // rich purple couch
    const COUCH_CUSH  = '#5a3a7a'; // lighter cushion
    const COUCH_TRIM  = '#7a54a0'; // accent piping
    const DESK_SURF   = '#2e1e0e'; // dark walnut desk surface
    const DESK_LEG    = '#1e1208'; // darker leg wood
    const SHELF_BODY  = '#2a1a08'; // warm dark wood bookshelf
    const SHELF_SHELF = '#1e1006'; // shelf planks

    // Per-furniture user-chosen colors (with fallback to defaults)
    const fc = (id: import('../stores/roomStore').FurnitureId) => getFurnitureColor(cfg, id);
    // Derive lighter/darker variants from base color for shading
    const lighten = (hex: string, amt = 20): string => {
      const n = parseInt(hex.replace('#',''), 16);
      const r = Math.min(255, ((n >> 16) & 0xff) + amt);
      const g = Math.min(255, ((n >>  8) & 0xff) + amt);
      const b = Math.min(255,  (n        & 0xff) + amt);
      return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
    };
    const darken = (hex: string, amt = 20): string => lighten(hex, -amt);

    // ── Walls ──
    r(0, 0, W, FY, wall.bg);

    // Wall pattern based on theme
    if (cfg.wallTheme === 'neon') {
      // Neon grid
      x.strokeStyle = light.primary; x.lineWidth = 0.5; x.globalAlpha = 0.08;
      for (let gy = 20; gy < FY; gy += 24) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
      for (let gx = 20; gx < W; gx += 24) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, FY); x.stroke(); }
      x.globalAlpha = 1;
    } else if (cfg.wallTheme === 'void') {
      // Minimal — just subtle noise
      for (let wy = 0; wy < FY; wy += 8) {
        for (let wx = 0; wx < W; wx += 8) {
          x.globalAlpha = 0.02 + Math.random() * 0.02;
          r(wx, wy, 4, 4, wall.accent);
          x.globalAlpha = 1;
        }
      }
    } else {
      // Brick pattern (default and most themes)
      for (let wy = 8; wy < FY; wy += 24) {
        for (let wx = 8; wx < W; wx += 24) {
          x.globalAlpha = 0.06;
          r(wx, wy, 20, 20, wall.brick);
          x.globalAlpha = 1;
        }
      }
      // Subtle wallpaper dots
      for (let wy = 0; wy < FY; wy += 16) {
        for (let wx = (wy % 32 === 0 ? 0 : 8); wx < W; wx += 16) {
          x.globalAlpha = 0.02;
          r(wx + 6, wy + 2, 4, 4, wall.accent);
          x.globalAlpha = 1;
        }
      }
    }

    // ── Baseboard ──
    r(0, FY - 10, W, 10, wall.accent);
    r(0, FY - 12, W, 2, wall.accent);
    x.globalAlpha = 0.5; r(0, FY - 10, W, 1, light.primary); x.globalAlpha = 1;

    // ── Floor ──
    r(0, FY, W, H - FY, floor.base);
    if (cfg.floorStyle === 'tile') {
      // Checkerboard
      for (let fy = FY; fy < H; fy += 22) {
        for (let fx = 0; fx < W; fx += 22) {
          const isAlt = ((fx / 22 + fy / 22) % 2) < 1;
          x.globalAlpha = isAlt ? 0.2 : 0.08;
          r(fx, fy, 20, 20, floor.alt);
          x.globalAlpha = 1;
        }
      }
    } else if (cfg.floorStyle === 'carpet') {
      // Soft texture
      for (let fy = FY; fy < H; fy += 4) {
        for (let fx = 0; fx < W; fx += 4) {
          x.globalAlpha = 0.03 + Math.random() * 0.04;
          r(fx, fy, 3, 3, floor.alt);
          x.globalAlpha = 1;
        }
      }
    } else if (cfg.floorStyle === 'concrete') {
      // Industrial speckle
      for (let i = 0; i < 200; i++) {
        x.globalAlpha = 0.04 + Math.random() * 0.04;
        r(Math.random() * W, FY + Math.random() * (H - FY), 2, 2, floor.alt);
        x.globalAlpha = 1;
      }
    } else if (cfg.floorStyle === 'neon') {
      // Dark with neon gridlines
      x.strokeStyle = light.primary; x.lineWidth = 1; x.globalAlpha = 0.28;
      for (let fy = FY + 22; fy < H; fy += 22) { x.beginPath(); x.moveTo(0, fy); x.lineTo(W, fy); x.stroke(); }
      for (let fx = 0; fx < W; fx += 38) { x.beginPath(); x.moveTo(fx, FY); x.lineTo(fx, H); x.stroke(); }
      // Glow pass
      x.lineWidth = 3; x.globalAlpha = 0.06;
      for (let fy = FY + 22; fy < H; fy += 22) { x.beginPath(); x.moveTo(0, fy); x.lineTo(W, fy); x.stroke(); }
      for (let fx = 0; fx < W; fx += 38) { x.beginPath(); x.moveTo(fx, FY); x.lineTo(fx, H); x.stroke(); }
      x.globalAlpha = 1; x.lineWidth = 1;
    } else if (cfg.floorStyle === 'marble') {
      // Large slab tiles with grout lines
      const slabW = 90; const slabH = 24;
      for (let fy = FY; fy < H; fy += slabH) {
        for (let fx = 0; fx < W; fx += slabW) {
          x.globalAlpha = 0.04 + ((Math.floor(fx / slabW) + Math.floor((fy - FY) / slabH)) % 2) * 0.04;
          r(fx, fy, slabW - 1, slabH - 1, floor.alt);
        }
      }
      x.globalAlpha = 0.5; x.strokeStyle = floor.groove; x.lineWidth = 1;
      for (let fy = FY; fy < H; fy += slabH) { x.beginPath(); x.moveTo(0, fy); x.lineTo(W, fy); x.stroke(); }
      for (let fx = 0; fx < W; fx += slabW) { x.beginPath(); x.moveTo(fx, FY); x.lineTo(fx, H); x.stroke(); }
      x.globalAlpha = 1;
    } else if (cfg.floorStyle === 'tatami') {
      // Woven mat — grid of rectangles with alternating weave direction
      for (let fy = FY; fy < H; fy += 18) {
        for (let fx = 0; fx < W; fx += 36) {
          const row = Math.floor((fy - FY) / 18);
          x.globalAlpha = 0.14;
          r(fx, fy, 34, 16, floor.alt);
          x.globalAlpha = 0.06;
          if (row % 2 === 0) {
            for (let wx = fx + 3; wx < fx + 34; wx += 5) r(wx, fy, 2, 16, floor.groove);
          } else {
            for (let wy = fy + 3; wy < fy + 16; wy += 5) r(fx, wy, 34, 2, floor.groove);
          }
          x.globalAlpha = 1;
        }
      }
    } else if (cfg.floorStyle === 'hex') {
      // Hexagonal tile pattern
      const hexW = 26; const hexH = 14;
      for (let fy = FY; fy < H; fy += hexH) {
        const rowOff = (Math.floor((fy - FY) / hexH) % 2) * (hexW / 2);
        for (let fx = -hexW + rowOff; fx < W + hexW; fx += hexW) {
          x.globalAlpha = 0.12;
          x.strokeStyle = floor.alt; x.lineWidth = 1;
          x.beginPath();
          x.moveTo(fx + hexW * 0.25, fy);
          x.lineTo(fx + hexW * 0.75, fy);
          x.lineTo(fx + hexW, fy + hexH / 2);
          x.lineTo(fx + hexW * 0.75, fy + hexH);
          x.lineTo(fx + hexW * 0.25, fy + hexH);
          x.lineTo(fx, fy + hexH / 2);
          x.closePath(); x.stroke();
          x.globalAlpha = 1;
        }
      }
    } else if (cfg.floorStyle === 'bamboo') {
      // Vertical bamboo stalks with node rings
      const stalkW = 14;
      for (let fx = 0; fx < W; fx += stalkW) {
        const col = Math.floor(fx / stalkW);
        const shade = col % 3 === 0 ? lighten(floor.base, 12) : col % 3 === 1 ? floor.base : darken(floor.base, 8);
        r(fx, FY, stalkW - 1, H - FY, shade);
        // Grain lines
        x.globalAlpha = 0.15;
        r(fx + 3, FY, 1, H - FY, '#6a7a28');
        r(fx + 9, FY, 1, H - FY, '#4a5818');
        x.globalAlpha = 1;
        // Node rings at staggered intervals
        const nodeOffset = (col % 3) * 6;
        for (let fy = FY + 10 + nodeOffset; fy < H; fy += 18) {
          x.globalAlpha = 0.45; r(fx, fy, stalkW - 1, 2, floor.groove);
          x.globalAlpha = 0.2;  r(fx, fy + 2, stalkW - 1, 1, lighten(floor.base, 20));
          x.globalAlpha = 1;
        }
      }
      // Subtle sheen
      const bSheen = x.createLinearGradient(0, FY, 0, H);
      bSheen.addColorStop(0, 'rgba(160,200,40,0.06)');
      bSheen.addColorStop(1, 'rgba(0,0,0,0.08)');
      x.fillStyle = bSheen; x.fillRect(0, FY, W, H - FY);
    } else {
      // Hardwood planks — warm brown wood look
      const WOOD_BASE   = '#3d1f0a';
      const WOOD_LIGHT  = '#5a2e10';
      const WOOD_DARK   = '#2a1406';
      const WOOD_GRAIN  = '#4a2510';
      r(0, FY, W, H - FY, WOOD_BASE);
      for (let fy = FY; fy < H; fy += 13) {
        const row = Math.floor((fy - FY) / 13);
        const off = (row % 2) * 52;
        for (let fx = off - 52; fx < W + 52; fx += 104) {
          // Plank body — alternating brightness for depth
          const shade = (row % 3 === 0) ? WOOD_LIGHT : (row % 3 === 1 ? WOOD_BASE : WOOD_DARK);
          x.globalAlpha = 1; r(fx, fy, 102, 11, shade);
          // Plank gap/groove
          x.globalAlpha = 0.7; r(fx, fy + 11, 102, 2, WOOD_DARK); x.globalAlpha = 1;
          // Wood grain lines (horizontal streaks)
          x.globalAlpha = 0.18;
          r(fx + 6,  fy + 3, 30 + (row * 17) % 40, 1, WOOD_GRAIN);
          r(fx + 50, fy + 7, 20 + (row * 11) % 30, 1, WOOD_GRAIN);
          r(fx + 20, fy + 5, 15 + (row * 7)  % 25, 1, '#7a4020');
          x.globalAlpha = 0.08;
          r(fx + 8,  fy + 2, 70, 1, '#8a5030');
          r(fx + 14, fy + 9, 50, 1, '#2a1006');
          x.globalAlpha = 1;
          // Knot (occasional) — deterministic
          if ((row + Math.floor(fx / 104)) % 7 === 0) {
            x.fillStyle = WOOD_DARK; x.globalAlpha = 0.5;
            x.beginPath(); x.ellipse(fx + 40, fy + 5, 4, 3, 0, 0, Math.PI * 2); x.fill();
            x.globalAlpha = 0.25;
            x.beginPath(); x.ellipse(fx + 40, fy + 5, 7, 5, 0, 0, Math.PI * 2); x.fill();
            x.globalAlpha = 1;
          }
        }
      }
      // Subtle floor sheen
      const sheen = x.createLinearGradient(0, FY, 0, H);
      sheen.addColorStop(0, 'rgba(255,180,80,0.06)');
      sheen.addColorStop(0.5, 'rgba(255,180,80,0.02)');
      sheen.addColorStop(1, 'rgba(0,0,0,0.1)');
      x.fillStyle = sheen; x.fillRect(0, FY, W, H - FY);
    }

    // ── Rug (furniture item) ──
    if (cfg.furniture.includes('rug')) {
      const rugX = 250; const rugY = FY + 18;
      const rugC = fc('rug');
      const rugLight = lighten(rugC, 18);
      const rugDark  = darken(rugC, 12);
      r(rugX, rugY, 280, 104, rugDark);
      x.globalAlpha = 0.55; r(rugX + 4, rugY + 4, 272, 96, rugC); x.globalAlpha = 1;
      x.globalAlpha = 0.12; r(rugX + 8, rugY + 8, 264, 88, '#fff'); x.globalAlpha = 1;
      // Rug pattern
      for (let ry = rugY + 12; ry < rugY + 96; ry += 8) {
        for (let rx = rugX + 12; rx < rugX + 268; rx += 8) {
          x.fillStyle = rugLight;
          x.globalAlpha = 0.06 + Math.random() * 0.06;
          x.fillRect(rx, ry, 4, 4);
          x.globalAlpha = 1;
        }
      }
      // Fringe
      for (let rx = rugX + 4; rx < rugX + 276; rx += 4) {
        x.fillStyle = rugLight; x.globalAlpha = 0.5;
        x.fillRect(rx, rugY + 102, 2, 3 + Math.random() * 2);
        x.fillRect(rx, rugY - 2, 2, 3 + Math.random() * 2);
        x.globalAlpha = 1;
      }
    }

    // ── Couch ──
    if (cfg.furniture.includes('couch')) {
      const cx = 30; const cy = FY - 60;
      const cBase = fc('couch');
      const cLight = lighten(cBase, 22);
      const cTrim  = lighten(cBase, 40);
      r(cx, cy, 160, 70, cBase);
      r(cx, cy - 5, 160, 8, cTrim);
      x.globalAlpha = 0.15; r(cx + 5, cy + 3, 150, 55, '#c0a0e8'); x.globalAlpha = 1;
      r(cx + 10, cy + 8, 50, 22, cLight);
      x.globalAlpha = 0.12; r(cx + 12, cy + 10, 46, 18, '#fff'); x.globalAlpha = 1;
      r(cx + 65, cy + 8, 50, 22, cLight);
      x.globalAlpha = 0.12; r(cx + 67, cy + 10, 46, 18, '#fff'); x.globalAlpha = 1;
      r(cx + 5, cy + 30, 150, 28, cBase);
      r(cx + 5, cy + 30, 150, 4, cTrim);
      r(cx + 10, FY - 8, 8, 8, SHELF_BODY);
      r(cx + 142, FY - 8, 8, 8, SHELF_BODY);
    }

    // ── Coffee Table ──
    if (cfg.furniture.includes('coffee_table')) {
      const ctC = fc('coffee_table');
      const ctLight = lighten(ctC, 22);
      const ctDark  = darken(ctC, 18);
      // Shadow
      x.fillStyle = '#000'; x.globalAlpha = 0.22;
      x.beginPath(); x.ellipse(94, FY + 22, 66, 8, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      // Legs
      r(38, FY + 16, 5, 18, ctDark);
      r(151, FY + 16, 5, 18, ctDark);
      // Crossbar
      r(38, FY + 26, 118, 4, darken(ctC, 10));
      // Table surface
      r(30, FY + 8, 130, 10, ctC);
      r(30, FY + 8, 130, 3, ctLight);
      r(30, FY + 18, 130, 2, ctDark);
      // Surface grain
      x.globalAlpha = 0.08;
      for (let gx2 = 35; gx2 < 158; gx2 += 12) {
        x.fillStyle = ctLight; x.fillRect(gx2, FY + 9, 1, 8);
      }
      x.globalAlpha = 1;
    }

    // ── Candles ──
    if (cfg.furniture.includes('candles')) {
      const canC   = fc('candles');
      const canLight = lighten(canC, 20);
      // If coffee table is present, sit on it; otherwise sit on floor
      const canY = cfg.furniture.includes('coffee_table') ? FY + 6 : FY - 2;
      // Tray/saucer
      r(76, canY, 34, 4, '#1a1208');
      x.globalAlpha = 0.25; r(77, canY + 1, 32, 2, '#fff'); x.globalAlpha = 1;
      // Three candles — center tall, left medium, right short
      const candles3: Array<{ cx: number; h: number; col: string; phase: number }> = [
        { cx: 86, h: 28, col: canC,             phase: 0 },
        { cx: 78, h: 18, col: canLight,          phase: 1.3 },
        { cx: 102, h: 14, col: darken(canC, 8), phase: 2.6 },
      ];
      candles3.forEach(({ cx: cv, h, col, phase }) => {
        // Wax body
        r(cv - 3, canY - h, 6, h, col);
        r(cv - 3, canY - h, 6, 2, darken(col, 10));
        x.globalAlpha = 0.18; r(cv - 1, canY - h + 2, 2, h - 4, '#fff'); x.globalAlpha = 1;
        // Wax drip
        x.fillStyle = col; x.globalAlpha = 0.5;
        x.fillRect(cv + 1, canY - h + 2, 2, Math.floor(h / 4)); x.globalAlpha = 1;
        // Wick (static)
        r(cv, canY - h - 4, 1, 4, '#1a0a04');
        // Register flame position for live animation (drawn in RoomScene update loop)
        this.candleFlames.push({ x: cv, y: canY - h - 4, phase });
      });
    }

    // ── Posters ──
    this.drawPoster(x, cfg.posters[0], 50, 40, 80, 100, light);
    this.drawPoster(x, cfg.posters[1], 160, 30, 70, 90, light);
    this.drawPoster(x, cfg.posters[2], 470, 35, 90, 70, light);

    // ── Whiteboard ──
    if (cfg.furniture.includes('whiteboard')) {
      const wbC = fc('whiteboard');
      const wbX = 596; const wbY = 14;
      // Drop shadow
      x.fillStyle = '#000'; x.globalAlpha = 0.3;
      x.fillRect(wbX + 3, wbY + 3, 56, 76); x.globalAlpha = 1;
      // Frame
      r(wbX, wbY, 56, 76, wbC);
      x.fillStyle = lighten(wbC, 18); x.globalAlpha = 0.7;
      x.fillRect(wbX, wbY, 56, 3); x.fillRect(wbX, wbY, 3, 76); x.globalAlpha = 1;
      x.fillStyle = darken(wbC, 14); x.globalAlpha = 0.7;
      x.fillRect(wbX, wbY + 73, 56, 3); x.fillRect(wbX + 53, wbY, 3, 76); x.globalAlpha = 1;
      // Board surface
      r(wbX + 3, wbY + 3, 50, 66, '#d4cce8');
      x.globalAlpha = 0.04; r(wbX + 3, wbY + 3, 50, 66, '#fff'); x.globalAlpha = 1;
      // Pixel scribbles — title underline
      x.fillStyle = '#806880'; x.globalAlpha = 0.8;
      x.fillRect(wbX + 6, wbY + 8, 28, 2); x.globalAlpha = 1;
      // Text lines
      x.fillStyle = '#504060'; x.globalAlpha = 0.7;
      [[6,13,32],[6,17,24],[6,21,28],[6,25,18],[6,31,30],[6,35,22],[6,39,26]].forEach(([ox, oy, w2]) => {
        x.fillRect(wbX + ox, wbY + oy, w2, 2);
      });
      x.globalAlpha = 1;
      // Box diagram
      x.strokeStyle = '#603878'; x.lineWidth = 1; x.globalAlpha = 0.65;
      x.strokeRect(wbX + 6, wbY + 46, 16, 10);
      x.strokeRect(wbX + 28, wbY + 46, 16, 10);
      // Arrow between boxes
      x.fillStyle = '#603878'; x.globalAlpha = 0.65;
      x.fillRect(wbX + 22, wbY + 50, 6, 2);
      x.fillRect(wbX + 26, wbY + 48, 2, 6);
      x.globalAlpha = 1;
      // Ledge
      r(wbX, wbY + 76, 56, 5, darken(wbC, 6));
      // Markers on ledge
      r(wbX + 8,  wbY + 77, 8, 3, '#e87aab');
      r(wbX + 19, wbY + 77, 8, 3, '#5dcaa5');
    }

    // ── Bookshelf ──
    if (cfg.furniture.includes('bookshelf')) {
      const BSH = 185;
      const shC = fc('bookshelf');
      const shDark = darken(shC, 12);
      r(755, FY - BSH, 35, BSH, shC);
      r(757, FY - BSH + 2, 31, BSH - 4, shDark);
      x.globalAlpha = 0.1;
      for (let gi = 0; gi < BSH; gi += 18) r(756, FY - BSH + gi, 1, 14, lighten(shC, 30));
      x.globalAlpha = 1;
      for (let sh = 0; sh < 4; sh++) {
        const shY = FY - BSH + 36 + sh * 38;
        r(755, shY, 35, 4, lighten(shC, 14));
        for (let bx2 = 759; bx2 < 785; bx2 += 5 + Math.floor(Math.random() * 2)) {
          const bc = [P.pink, P.purp, P.teal, P.amber, P.red, P.lcream][Math.floor(Math.random() * 6)];
          x.fillStyle = bc; x.globalAlpha = 0.45 + Math.random() * 0.3;
          const bookH = 12 + Math.random() * 18;
          x.fillRect(bx2, shY - bookH, 4, bookH); x.globalAlpha = 1;
        }
      }
    }

    // ── Server Rack ──
    if (cfg.furniture.includes('server_rack')) {
      const srvX = 524; const srvY = FY - 108;
      const srvC = fc('server_rack');
      const srvDark  = darken(srvC, 12);
      const srvLight = lighten(srvC, 14);
      // Shadow
      x.fillStyle = '#000'; x.globalAlpha = 0.2;
      x.beginPath(); x.ellipse(srvX + 16, FY + 2, 16, 4, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      // Rack body
      r(srvX, srvY, 32, 108, srvC);
      // Side ears
      r(srvX,      srvY, 4, 108, srvDark);
      r(srvX + 28, srvY, 4, 108, srvDark);
      // Front panel
      r(srvX + 4, srvY + 2, 24, 104, darken(srvC, 8));
      // Rack units (6 × 16px each)
      const ledColors = [light.primary, P.teal, P.amber, light.primary, P.pink, P.teal];
      for (let ru = 0; ru < 6; ru++) {
        const ruY = srvY + 4 + ru * 16;
        r(srvX + 5, ruY, 22, 14, darken(srvC, 6));
        r(srvX + 5, ruY, 22, 2, darken(srvC, 14));
        // Rack screws
        r(srvX + 6,  ruY + 4, 2, 2, srvDark);
        r(srvX + 23, ruY + 4, 2, 2, srvDark);
        // Drive bay slots
        x.globalAlpha = 0.12;
        for (let di = 8; di < 20; di += 4) r(srvX + di, ruY + 5, 2, 5, srvLight);
        x.globalAlpha = 1;
        // Blinking LED per unit
        this.blinkingLEDs.push({ x: srvX + 25, y: ruY + 9, color: ledColors[ru], phase: (ru * 1.3) % (Math.PI * 2) });
      }
      // Bottom vents
      x.globalAlpha = 0.3;
      for (let vy = srvY + 100; vy < srvY + 106; vy += 3) r(srvX + 5, vy, 22, 1, srvDark);
      x.globalAlpha = 1;
      // Top rail
      r(srvX + 4, srvY, 24, 4, srvDark);
    }

    // ── Floor Lamp ──
    if (cfg.furniture.includes('lamp')) {
      const lampC = fc('lamp');
      r(205, FY - 140, 3, 140, darken(lampC, 10));
      r(190, FY - 155, 32, 18, lampC);
      r(194, FY - 151, 24, 10, light.primary);
      // Light glow
      x.fillStyle = light.primary; x.globalAlpha = 0.04;
      x.beginPath(); x.arc(206, FY - 140, 50, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.arc(206, FY - 140, 80, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 0.025; x.fillRect(150, FY, 120, 40); x.globalAlpha = 1;
    }

    // ── Plant ──
    if (cfg.furniture.includes('plant')) {
      const potC = fc('plant');
      const DSY = FY - 45;
      r(570, DSY - 14, 10, 12, potC);
      x.fillStyle = lighten(potC, 40); x.globalAlpha = 0.45;
      x.fillRect(568, DSY - 26, 6, 12);
      x.fillRect(576, DSY - 32, 6, 18);
      x.fillRect(572, DSY - 36, 6, 22);
      x.globalAlpha = 0.3;
      x.fillRect(566, DSY - 22, 4, 8);
      x.fillRect(580, DSY - 28, 4, 14);
      x.globalAlpha = 1;
    }

    // ── Speaker ──
    if (cfg.furniture.includes('speaker')) {
      const spkC = fc('speaker');
      r(8, FY - 48, 22, 48, spkC);
      r(10, FY - 46, 18, 44, darken(spkC, 8));
      x.fillStyle = lighten(spkC, 16);
      x.beginPath(); x.arc(19, FY - 30, 7, 0, Math.PI * 2); x.fill();
      x.fillStyle = light.primary; x.globalAlpha = 0.25;
      x.beginPath(); x.arc(19, FY - 30, 4, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      x.fillStyle = lighten(spkC, 16);
      x.beginPath(); x.arc(19, FY - 12, 3, 0, Math.PI * 2); x.fill();
    }

    // ── Mini Fridge ──
    if (cfg.furniture.includes('minifridge')) {
      const fridgeC = fc('minifridge');
      r(192, FY - 48, 30, 48, fridgeC);
      r(194, FY - 46, 26, 44, lighten(fridgeC, 10));
      r(194, FY - 20, 26, 2, darken(fridgeC, 10));
      x.fillStyle = light.primary; x.globalAlpha = 0.4;
      x.fillRect(216, FY - 38, 3, 12);
      x.globalAlpha = 1;
      this.blinkingLEDs.push({ x: 198, y: FY - 42, color: light.primary, phase: Math.random() * Math.PI * 2 });
    }

    // ── Record Player ──
    if (cfg.furniture.includes('record_player')) {
      const rpX = 420; const rpC = fc('record_player');
      const rpDark  = darken(rpC, 16);
      const rpLight = lighten(rpC, 16);
      // Stand/crate
      r(rpX, FY - 22, 28, 22, rpDark);
      r(rpX + 2, FY - 20, 24, 16, darken(rpC, 8));
      x.globalAlpha = 0.18;
      r(rpX + 2, FY - 14, 24, 1, rpLight);
      r(rpX + 2, FY - 8,  24, 1, rpLight);
      x.globalAlpha = 1;
      // Turntable body
      r(rpX, FY - 38, 28, 16, rpC);
      r(rpX, FY - 38, 28, 3, rpLight);
      r(rpX + 1, FY - 35, 26, 13, darken(rpC, 6));
      // Platter (perspective ellipse)
      x.fillStyle = '#0a0612';
      x.beginPath(); x.ellipse(rpX + 14, FY - 30, 11, 4, 0, 0, Math.PI * 2); x.fill();
      // Vinyl grooves
      x.strokeStyle = '#2a1848'; x.lineWidth = 1; x.globalAlpha = 0.5;
      x.beginPath(); x.ellipse(rpX + 14, FY - 30, 9, 3.2, 0, 0, Math.PI * 2); x.stroke();
      x.beginPath(); x.ellipse(rpX + 14, FY - 30, 6, 2.2, 0, 0, Math.PI * 2); x.stroke();
      x.globalAlpha = 1;
      // Record label center
      x.fillStyle = light.primary; x.globalAlpha = 0.7;
      x.beginPath(); x.ellipse(rpX + 14, FY - 30, 2.5, 1, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      // Tonearm
      x.strokeStyle = rpLight; x.lineWidth = 1.5; x.globalAlpha = 0.8;
      x.beginPath(); x.moveTo(rpX + 25, FY - 36); x.lineTo(rpX + 16, FY - 30); x.stroke();
      x.globalAlpha = 1;
      // Pivot dot
      x.fillStyle = rpLight;
      x.beginPath(); x.arc(rpX + 25, FY - 36, 1.5, 0, Math.PI * 2); x.fill();
      // Subtle glow
      x.fillStyle = light.primary; x.globalAlpha = 0.03;
      x.beginPath(); x.arc(rpX + 14, FY - 30, 18, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
    }

    // ── Bean Bag — moved to x=350, away from minifridge ──
    if (cfg.furniture.includes('beanbag')) {
      const bx = 350; const by = FY;
      const bagC = fc('beanbag');
      const bagLight = lighten(bagC, 24);
      const bagDark  = darken(bagC, 16);
      x.fillStyle = '#000'; x.globalAlpha = 0.25;
      x.beginPath(); x.ellipse(bx, by - 2, 30, 6, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      x.fillStyle = bagDark; x.globalAlpha = 1;
      x.beginPath(); x.ellipse(bx, by - 8, 28, 10, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = bagC; x.globalAlpha = 1;
      x.beginPath(); x.ellipse(bx, by - 26, 24, 22, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff'; x.globalAlpha = 0.12;
      x.beginPath(); x.ellipse(bx - 6, by - 30, 14, 14, -0.4, 0, Math.PI * 2); x.fill();
      x.strokeStyle = bagDark; x.lineWidth = 1.5; x.globalAlpha = 0.5;
      x.beginPath(); x.ellipse(bx, by - 26, 16, 18, 0.3, 0, Math.PI * 2); x.stroke();
      x.beginPath(); x.moveTo(bx, by - 48); x.lineTo(bx, by - 8); x.stroke();
      x.fillStyle = bagLight; x.globalAlpha = 1;
      x.beginPath(); x.arc(bx, by - 47, 3, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
    }

    // ── Lava Lamp ──
    if (cfg.furniture.includes('lava_lamp')) {
      const llX = 229; const llC = fc('lava_lamp');
      const llDark  = darken(llC, 20);
      const llLight = lighten(llC, 25);
      // Floor shadow
      x.fillStyle = '#000'; x.globalAlpha = 0.18;
      x.beginPath(); x.ellipse(llX + 9, FY + 2, 12, 3, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      // Base — wide foot
      r(llX, FY - 12, 18, 12, llDark);
      r(llX + 2, FY - 10, 14, 8, darken(llC, 12));
      x.globalAlpha = 0.2; r(llX + 3, FY - 9, 12, 2, '#fff'); x.globalAlpha = 1;
      // Glass tube
      r(llX + 5, FY - 68, 8, 56, '#0a0618');
      x.fillStyle = llC; x.globalAlpha = 0.15;
      x.fillRect(llX + 5, FY - 68, 8, 56); x.globalAlpha = 1;
      // Blobs inside
      const blobs = [
        { oy: -52, rx: 2.5, ry: 4 },
        { oy: -38, rx: 3,   ry: 5 },
        { oy: -24, rx: 2,   ry: 3.5 },
      ];
      blobs.forEach(({ oy, rx: bRx, ry: bRy }) => {
        x.fillStyle = llC; x.globalAlpha = 0.75;
        x.beginPath(); x.ellipse(llX + 9, FY + oy, bRx, bRy, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = llLight; x.globalAlpha = 0.3;
        x.beginPath(); x.ellipse(llX + 8, FY + oy - 1, bRx * 0.5, bRy * 0.4, -0.3, 0, Math.PI * 2); x.fill();
        x.globalAlpha = 1;
      });
      // Glass edge highlight
      x.fillStyle = '#fff'; x.globalAlpha = 0.07;
      x.fillRect(llX + 5, FY - 68, 2, 56); x.globalAlpha = 1;
      // Cap top
      r(llX + 4, FY - 70, 10, 5, llDark);
      r(llX + 6, FY - 68, 6, 2, darken(llC, 8));
      // Glow
      x.fillStyle = llC; x.globalAlpha = 0.04;
      x.beginPath(); x.arc(llX + 9, FY - 40, 28, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
    }

    // ── Arcade Cabinet ──
    if (cfg.furniture.includes('arcade')) {
      const ax = 480; const ay = FY - 110;
      const arcC = fc('arcade');
      const arcDark = darken(arcC, 12);
      r(ax, ay, 42, 110, arcC);
      r(ax + 2, ay + 2, 38, 106, '#0a0818');
      r(ax + 4, ay + 8, 34, 30, arcDark);
      // Arcade screen — pixel game scene
      r(ax + 6, ay + 10, 30, 26, '#020108'); // screen bg
      // Stars
      x.fillStyle = '#fff'; x.globalAlpha = 0.4;
      [[8,12],[14,11],[22,13],[26,11],[10,15],[20,17]].forEach(([ox,oy]) => x.fillRect(ax+ox, ay+oy, 1, 1));
      x.globalAlpha = 1;
      // Score bar at top
      r(ax + 6, ay + 10, 30, 4, '#0a0428');
      x.fillStyle = P.amber; x.globalAlpha = 0.7;
      x.fillRect(ax + 8, ay + 11, 10, 2); // score
      x.fillRect(ax + 26, ay + 11, 6, 2); // hi
      x.globalAlpha = 1;
      // Enemy row (3 little pixel sprites)
      x.fillStyle = P.pink; x.globalAlpha = 0.7;
      [0,1,2].forEach(i => { x.fillRect(ax + 9 + i * 8, ay + 18, 4, 3); x.fillRect(ax + 8 + i * 8, ay + 21, 6, 2); });
      x.globalAlpha = 1;
      // Player ship at bottom
      x.fillStyle = light.primary; x.globalAlpha = 0.8;
      x.fillRect(ax + 18, ay + 31, 6, 3);
      x.fillRect(ax + 20, ay + 29, 2, 2);
      x.globalAlpha = 1;
      // Bullet
      x.fillStyle = '#fff'; x.globalAlpha = 0.6;
      x.fillRect(ax + 21, ay + 25, 1, 3);
      x.globalAlpha = 1;
      r(ax + 2, ay + 44, 38, 18, lighten(arcC, 8));
      r(ax + 8, ay + 48, 4, 10, arcDark);
      x.fillStyle = P.lcream; x.globalAlpha = 0.6;
      x.beginPath(); x.arc(ax + 10, ay + 48, 4, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      [P.pink, P.amber, P.teal, P.purp].forEach((bc, i) => {
        x.fillStyle = bc; x.globalAlpha = 0.7;
        x.beginPath(); x.arc(ax + 24 + (i % 2) * 8, ay + 50 + Math.floor(i / 2) * 7, 3, 0, Math.PI * 2); x.fill();
        x.globalAlpha = 1;
      });
      r(ax + 14, ay + 66, 14, 3, arcDark);
      x.fillStyle = light.primary; x.globalAlpha = 0.5;
      x.font = 'bold 5px monospace'; x.textAlign = 'center';
      x.fillText('PLAY', ax + 21, ay + 104);
      x.globalAlpha = 1;
    }

    // ── Wall TV ──
    if (cfg.furniture.includes('tv')) {
      const tvX = 305; const tvY = 46;
      const tvW = 130; const tvH = 78;
      const tvC = fc('tv');
      r(tvX + tvW / 2 - 2, tvY + tvH, 4, 22, darken(tvC, 8));
      r(tvX + tvW / 2 - 14, tvY + tvH + 18, 28, 5, tvC);
      r(tvX, tvY, tvW, tvH, tvC);
      r(tvX + 2, tvY + 2, tvW - 4, tvH - 4, darken(tvC, 10));
      r(tvX + 5, tvY + 5, tvW - 10, tvH - 10, '#060410');
      // Screen background glow tint
      x.fillStyle = light.primary; x.globalAlpha = 0.08;
      x.fillRect(tvX + 5, tvY + 5, tvW - 10, tvH - 10);
      x.globalAlpha = 1;
      // TV screen — pixel scene (talk show / news desk look)
      const screenX = tvX + 5; const screenY = tvY + 5;
      const screenW = tvW - 10; const screenH = tvH - 10;
      // Dark room background
      r(screenX, screenY, screenW, screenH, '#04020c');
      // Floor line
      r(screenX, screenY + screenH - 12, screenW, 2, '#1a1030');
      // Left figure silhouette
      r(screenX + 8,  screenY + screenH - 30, 10, 18, '#0e0828');
      r(screenX + 11, screenY + screenH - 36, 4,  6,  '#0e0828'); // head
      // Right figure silhouette
      r(screenX + screenW - 22, screenY + screenH - 28, 10, 16, '#0e0828');
      r(screenX + screenW - 19, screenY + screenH - 34, 4,  6,  '#0e0828');
      // Desk between them
      r(screenX + 20, screenY + screenH - 18, screenW - 40, 4, '#1a1040');
      // Backdrop lighting — colored strip behind figures
      x.fillStyle = light.primary; x.globalAlpha = 0.12;
      x.fillRect(screenX, screenY, screenW, screenH - 12);
      x.globalAlpha = 1;
      // Lower third chyron bar
      r(screenX, screenY + screenH - 14, screenW, 12, '#0a0040');
      x.fillStyle = light.primary; x.globalAlpha = 0.8;
      x.fillRect(screenX, screenY + screenH - 14, 4, 12); // accent bar
      x.globalAlpha = 0.4;
      x.fillRect(screenX + 6, screenY + screenH - 11, 40, 2);
      x.fillRect(screenX + 6, screenY + screenH - 7,  28, 2);
      x.globalAlpha = 1;
      // Scanlines
      for (let sl = screenY; sl < screenY + screenH; sl += 3) {
        x.fillStyle = '#000'; x.globalAlpha = 0.1;
        x.fillRect(screenX, sl, screenW, 1);
      }
      x.globalAlpha = 1;
      // Glare
      x.fillStyle = '#fff'; x.globalAlpha = 0.04;
      x.beginPath(); x.moveTo(screenX + 4, screenY + 4);
      x.lineTo(screenX + 28, screenY + 4);
      x.lineTo(screenX + 14, screenY + 18);
      x.closePath(); x.fill();
      x.globalAlpha = 1;
      // Power LED
      x.fillStyle = light.primary; x.globalAlpha = 1;
      x.beginPath(); x.arc(tvX + tvW - 7, tvY + tvH - 6, 2, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 0.3;
      x.beginPath(); x.arc(tvX + tvW - 7, tvY + tvH - 6, 5, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
    }
    const lightColor = cfg.ceilingLightColor || light.primary;
    for (let lx = 30; lx < W - 30; lx += 30) {
      r(lx, 14, 30, 1, wall.accent);
      const bc = [P.pink, P.amber, P.teal, P.purp, P.lcream][Math.floor(Math.random() * 5)];
      x.fillStyle = bc; x.globalAlpha = 0.35 + Math.random() * 0.35;
      x.fillRect(lx + 13, 15, 4, 5);
      x.globalAlpha = 0.025; x.beginPath(); x.arc(lx + 15, 19, 10, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
    }

    // ── Top neon strip ──
    r(0, 0, W, 3, lightColor);
    x.globalAlpha = 0.12; r(0, 0, W, 3, lightColor); x.globalAlpha = 1;

    // ── Computer Desk — drawn last, DBOT extends past FY so it's always over the floor ──
    const DSY  = FY - 58;
    const DBOT = FY + 11;
    const deskC   = fc('desk');
    const deskLeg = darken(deskC, 16);

    // Desk surface
    r(558, DSY,      196, 10, deskC);
    r(558, DSY + 10, 196,  3, deskLeg);
    x.globalAlpha = 0.12;
    r(560, DSY + 2, 80, 1, lighten(deskC, 30)); r(640, DSY + 5, 60, 1, lighten(deskC, 30));
    r(700, DSY + 3, 40, 1, lighten(deskC, 30)); x.globalAlpha = 1;

    // Left leg and right leg — extend to DBOT (past floor line)
    r(561, DSY + 13,  8, DBOT - (DSY + 13), deskLeg);
    r(744, DSY + 13,  8, DBOT - (DSY + 13), deskLeg);
    // Crossbar
    r(561, FY - 8, 191, 5, deskLeg);

    // Cabinet (left side) — tall enough to cover both drawers
    r(561, DSY + 13, 58, DSY + 61 - (DSY + 13), deskC);
    r(564, DSY + 16, 52, 24, deskLeg);
    r(564, DSY + 40, 52, 20, deskLeg);
    r(582, DSY + 26, 14,  3, '#8a6040');
    r(582, DSY + 50, 14,  3, '#8a6040');

    // Monitor stand
    r(647, DSY,      46,  5, FUR_FRAME);
    r(663, DSY - 20, 14, 20, FUR_FRAME);

    // Monitor
    r(596, DSY - 82, 134, 62, '#0a0818');
    r(599, DSY - 79, 128, 56, '#050310');
    r(599, DSY - 79,  10, 56, '#080618');

    // Keyboard
    r(608, DSY - 10, 88, 10, FUR_FRAME);
    r(610, DSY - 9,  84,  8, FUR_DARK);
    for (let kx = 612; kx < 690; kx += 6) {
      x.globalAlpha = 0.2; r(kx, DSY - 8, 4, 5, FUR_MID); x.globalAlpha = 1;
    }

    // Mouse
    r(703, DSY - 10, 16, 9, FUR_FRAME);
    r(705, DSY - 8,  12, 6, FUR_DARK);

    // Coffee cup
    r(726, DSY - 14, 14, 14, FUR_FRAME);
    r(728, DSY - 12, 10,  8, '#1a0a10');
    x.fillStyle = '#3d1a0a'; x.globalAlpha = 0.8;
    x.fillRect(728, DSY - 12, 10, 3); x.globalAlpha = 1;
    r(740, DSY - 10,  3, 6, FUR_FRAME);
    r(724, DSY,      16, 2, FUR_MID);
    x.fillStyle = '#fff'; x.globalAlpha = 0.06;
    x.fillRect(730, DSY - 26, 2, 10);
    x.fillRect(735, DSY - 29, 2, 12);
    x.fillRect(732, DSY - 24, 2,  8);
    x.globalAlpha = 1;

    // ── Pet Bowls (food & water) ── behind player
    if (cfg.furniture.includes('pet_bowl')) {
      const bwlX = 598; const bwlY = FY + 136;
      const bowlC = fc('pet_bowl');
      const bowlLight = lighten(bowlC, 22);
      x.fillStyle = '#000'; x.globalAlpha = 0.18;
      x.beginPath(); x.ellipse(bwlX + 18, bwlY + 8, 24, 5, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
      x.fillStyle = darken(bowlC, 12);
      x.beginPath(); x.ellipse(bwlX + 8, bwlY + 6, 13, 8, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = bowlC;
      x.beginPath(); x.ellipse(bwlX + 8, bwlY + 5, 11, 6, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#3a8edc'; x.globalAlpha = 0.8;
      x.beginPath(); x.ellipse(bwlX + 8, bwlY + 3, 7, 4, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff'; x.globalAlpha = 0.22;
      x.beginPath(); x.ellipse(bwlX + 5, bwlY + 2, 3, 1.5, -0.4, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
      x.fillStyle = darken(bowlC, 12);
      x.beginPath(); x.ellipse(bwlX + 30, bwlY + 6, 13, 8, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = bowlC;
      x.beginPath(); x.ellipse(bwlX + 30, bwlY + 5, 11, 6, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#7a4820'; x.globalAlpha = 0.9;
      x.beginPath(); x.ellipse(bwlX + 30, bwlY + 3, 7, 4, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
      x.fillStyle = '#a06030'; x.globalAlpha = 0.95;
      [[27,1],[30,0],[33,1],[29,-1],[32,-1]].forEach(([ox, oy]) => {
        x.beginPath(); x.arc(bwlX + ox, bwlY + oy, 1.5, 0, Math.PI * 2); x.fill();
      });
      x.globalAlpha = 1;
      x.strokeStyle = bowlLight; x.lineWidth = 1; x.globalAlpha = 0.35;
      x.beginPath(); x.ellipse(bwlX + 8,  bwlY + 5, 11, 6, 0, 0, Math.PI * 2); x.stroke();
      x.beginPath(); x.ellipse(bwlX + 30, bwlY + 5, 11, 6, 0, 0, Math.PI * 2); x.stroke();
      x.globalAlpha = 1;
    }

    // ── Pet Bed ── behind player
    if (cfg.furniture.includes('pet_bed')) {
      const bedX = 668; const bedY = FY + 124;
      const bedW = 56; const bedH = 40;
      const bedC = fc('pet_bed');
      const bedLight = lighten(bedC, 28);
      const bedDark  = darken(bedC, 16);
      x.fillStyle = '#000'; x.globalAlpha = 0.2;
      x.fillRect(bedX + 3, bedY + bedH + 1, bedW - 2, 4); x.globalAlpha = 1;
      r(bedX, bedY, bedW, bedH, bedDark);
      r(bedX + 1, bedY + 1, bedW - 2, bedH - 2, bedC);
      r(bedX + 1,        bedY + 1,        bedW - 2, 8,  darken(bedC, 4));
      r(bedX + 1,        bedY + 1,        8, bedH - 2,  darken(bedC, 4));
      r(bedX + bedW - 9, bedY + 1,        8, bedH - 2,  darken(bedC, 4));
      r(bedX + 1,        bedY + bedH - 7, bedW - 2, 6,  darken(bedC, 4));
      r(bedX + 9, bedY + 9, bedW - 18, bedH - 16, darken(bedC, 10));
      r(bedX + 10, bedY + 10, bedW - 20, bedH - 18, darken(bedC, 7));
      x.fillStyle = bedLight; x.globalAlpha = 0.22;
      x.fillRect(bedX + 2, bedY + 1, bedW - 4, 2);
      x.fillRect(bedX + 1, bedY + 2, 2, bedH - 4); x.globalAlpha = 1;
      x.strokeStyle = bedDark; x.lineWidth = 1; x.globalAlpha = 0.45;
      x.setLineDash([3, 2]);
      x.strokeRect(bedX + 9, bedY + 9, bedW - 18, bedH - 16);
      x.setLineDash([]); x.globalAlpha = 1;
    }

    // ── Door ──
    this.drawDoor(x, W, H - 64, nc, H);
  }

  // ════════════════════════════════════════════
  // FOREGROUND LAYER — rendered on a transparent canvas, displayed in front of the player
  // ════════════════════════════════════════════

  /** Render foreground furniture to a transparent canvas and return texture key */
  renderForeground(
    scene: Phaser.Scene,
    roomId: string,
    W: number,
    H: number,
    ownerRoomConfig?: RoomConfig,
  ): string {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const x = canvas.getContext('2d')!;
    x.imageSmoothingEnabled = false;
    const rc = roomId.startsWith('myroom:') ? 'myroom' : roomId;
    if (rc === 'myroom') this.drawForegroundItems(x, W, H, ownerRoomConfig);
    const texKey = `roomfg_${roomId.replace(/[^a-z0-9]/g, '_')}`;
    if (scene.textures.exists(texKey)) scene.textures.remove(texKey);
    scene.textures.addCanvas(texKey, canvas);
    return texKey;
  }

  private drawForegroundItems(x: CanvasRenderingContext2D, _W: number, _H: number, ownerRoomConfig?: RoomConfig): void {
    const cfg = ownerRoomConfig ?? getRoomConfig();
    const FY = 300;
    const r = (ax: number, ay: number, aw: number, ah: number, col: string) => {
      x.fillStyle = col; x.fillRect(ax, ay, aw, ah);
    };
    const fc = (id: string) => getFurnitureColor(cfg, id as Parameters<typeof getFurnitureColor>[1]);
    const lighten = (hex: string, amt: number): string => {
      const n = parseInt(hex.slice(1), 16);
      const clamp = (v: number) => Math.min(255, Math.max(0, v));
      const rb = clamp(((n >> 16) & 0xff) + amt); const gb = clamp(((n >> 8) & 0xff) + amt); const bb = clamp((n & 0xff) + amt);
      return `#${rb.toString(16).padStart(2,'0')}${gb.toString(16).padStart(2,'0')}${bb.toString(16).padStart(2,'0')}`;
    };
    const darken = (hex: string, amt: number): string => lighten(hex, -amt);

    // ── Record Crates ──
    if (cfg.furniture.includes('record_crates')) {
      const crateC = fc('record_crates');
      const crateLight = lighten(crateC, 22);
      const crateDark  = darken(crateC, 14);
      const drawCrate = (cx: number, topY: number, cw: number, ch: number) => {
        // Shadow
        x.fillStyle = '#000'; x.globalAlpha = 0.18;
        x.beginPath(); x.ellipse(cx + cw / 2, topY + ch + 2, cw / 2 - 2, 4, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
        // Crate body
        r(cx, topY, cw, ch, crateDark);
        r(cx + 1, topY + 1, cw - 2, ch - 2, crateC);
        // Grid lines
        x.strokeStyle = crateDark; x.lineWidth = 1; x.globalAlpha = 0.45;
        for (let gx2 = cx + 8; gx2 < cx + cw - 2; gx2 += 9) {
          x.beginPath(); x.moveTo(gx2, topY + 1); x.lineTo(gx2, topY + ch - 1); x.stroke();
        }
        for (let gy = topY + 8; gy < topY + ch - 2; gy += 9) {
          x.beginPath(); x.moveTo(cx + 1, gy); x.lineTo(cx + cw - 1, gy); x.stroke();
        }
        x.globalAlpha = 1;
        // Top highlight
        x.fillStyle = crateLight; x.globalAlpha = 0.15; x.fillRect(cx + 1, topY + 1, cw - 2, 3); x.globalAlpha = 1;
        // Vinyl records peeking out the top
        const recordCols = ['#181828', '#261614', '#141e14', '#22201a'];
        for (let ri = 0; ri < Math.min(4, Math.floor((cw - 6) / 7)); ri++) {
          const rx = cx + 3 + ri * 7;
          r(rx, topY - 9, 5, 11, recordCols[ri % recordCols.length]);
          x.fillStyle = '#555'; x.globalAlpha = 0.7;
          x.beginPath(); x.arc(rx + 2, topY - 4, 1.2, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
        }
      };
      drawCrate(10, FY + 132, 34, 38);
      drawCrate(46, FY + 120, 34, 50);
    }

    // ── Trunk ──
    if (cfg.furniture.includes('trunk')) {
      const trX = 100; const trY = FY + 124;
      const trW = 70; const trH = 40;
      const trC = fc('trunk');
      const trLight = lighten(trC, 20);
      const trDark  = darken(trC, 12);
      // Shadow
      x.fillStyle = '#000'; x.globalAlpha = 0.2;
      x.beginPath(); x.ellipse(trX + trW / 2, trY + trH + 2, trW / 2 - 4, 5, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
      // Body
      r(trX, trY, trW, trH, trDark);
      r(trX + 1, trY + 1, trW - 2, trH - 2, trC);
      // Lid top (rounded slightly with a highlight band)
      r(trX, trY, trW, 6, darken(trC, 6));
      x.fillStyle = trLight; x.globalAlpha = 0.18; x.fillRect(trX + 2, trY + 1, trW - 4, 3); x.globalAlpha = 1;
      // Lid dividing line
      r(trX, trY + 14, trW, 2, trDark);
      // Metal corner reinforcements
      const corners = [[trX, trY], [trX + trW - 6, trY], [trX, trY + trH - 6], [trX + trW - 6, trY + trH - 6]];
      corners.forEach(([cx2, cy2]) => {
        r(cx2, cy2, 6, 6, '#5a5040');
        x.fillStyle = '#9a8870'; x.globalAlpha = 0.5;
        x.fillRect(cx2 + 1, cy2 + 1, 2, 2); x.globalAlpha = 1;
      });
      // Horizontal metal straps
      r(trX, trY + 8, trW, 2, '#5a5040');
      r(trX, trY + trH - 10, trW, 2, '#5a5040');
      // Center clasp
      r(trX + trW / 2 - 5, trY + 12, 10, 6, '#4a4030');
      r(trX + trW / 2 - 3, trY + 13, 6, 4, '#7a6850');
      x.fillStyle = '#c0a860'; x.globalAlpha = 0.8;
      x.fillRect(trX + trW / 2 - 1, trY + 14, 2, 2); x.globalAlpha = 1;
      // Wood grain lines
      x.strokeStyle = trDark; x.lineWidth = 1; x.globalAlpha = 0.18;
      for (let gl = trX + 10; gl < trX + trW - 4; gl += 10) {
        x.beginPath(); x.moveTo(gl, trY + 2); x.lineTo(gl, trY + trH - 2); x.stroke();
      }
      x.globalAlpha = 1;
    }

    // ── Book Stack ──
    if (cfg.furniture.includes('bookstack')) {
      const bsX = 182;
      const bsC = fc('bookstack');
      // Books lying flat in a messy pile — each book is a thin horizontal slab
      // with a colored spine on the left, cream page-edges on the right, slight offsets for chaos
      const bookData: Array<{ dx: number; w: number; col: string }> = [
        { dx:  0, w: 44, col: bsC },
        { dx:  3, w: 38, col: lighten(bsC, 22) },
        { dx: -2, w: 42, col: darken(bsC, 12) },
        { dx:  5, w: 36, col: lighten(bsC, 36) },
        { dx:  1, w: 40, col: darken(bsC, 22) },
        { dx: -3, w: 34, col: lighten(bsC, 14) },
        { dx:  2, w: 46, col: darken(bsC, 6) },
      ];
      const stackBaseY = FY + 172;
      const bookH = 8; // each book's thickness in pixels
      // Ground shadow
      x.fillStyle = '#000'; x.globalAlpha = 0.2;
      x.beginPath(); x.ellipse(bsX + 23, stackBaseY + 3, 26, 4, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
      bookData.forEach((b, i) => {
        const bx = bsX + b.dx;
        const by = stackBaseY - (bookData.length - i) * bookH;
        // Cover color (top face)
        r(bx, by, b.w, bookH - 1, b.col);
        // Spine strip on left (darker, slightly narrower)
        r(bx, by, 5, bookH - 1, darken(b.col, 14));
        // Page edges on right (cream/off-white)
        r(bx + b.w - 6, by, 6, bookH - 1, '#c8c0a8');
        x.fillStyle = '#e8e0d0'; x.globalAlpha = 0.55;
        // Thin page lines on the edge for texture
        for (let pl = by + 1; pl < by + bookH - 2; pl += 2) {
          x.fillRect(bx + b.w - 5, pl, 4, 1);
        }
        x.globalAlpha = 1;
        // Top highlight on spine
        x.fillStyle = lighten(b.col, 28); x.globalAlpha = 0.22;
        x.fillRect(bx + 1, by, 3, bookH - 1); x.globalAlpha = 1;
        // Thin dark separator line between books
        x.fillStyle = '#000'; x.globalAlpha = 0.25;
        x.fillRect(bx, by + bookH - 1, b.w, 1); x.globalAlpha = 1;
      });
    }

    // ── Bar Cart ──
    if (cfg.furniture.includes('bar_cart')) {
      const bcX = 240; const bcC = fc('bar_cart');
      const bcLight = lighten(bcC, 28);
      const bcDark  = darken(bcC, 12);
      const topShelfY  = FY + 112;
      const botShelfY  = FY + 141;
      const cartW = 56; const shelfH = 4;
      // Shadow
      x.fillStyle = '#000'; x.globalAlpha = 0.18;
      x.beginPath(); x.ellipse(bcX + cartW / 2, FY + 175, cartW / 2 - 2, 4, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
      // Frame legs (vertical bars)
      const legXs = [bcX + 4, bcX + cartW - 8];
      legXs.forEach(lx => {
        r(lx, topShelfY, 4, botShelfY - topShelfY + shelfH + 32, bcDark);
        x.fillStyle = bcLight; x.globalAlpha = 0.15; x.fillRect(lx + 1, topShelfY, 1, botShelfY - topShelfY + shelfH + 30); x.globalAlpha = 1;
      });
      // Cross brace
      x.strokeStyle = bcDark; x.lineWidth = 2; x.globalAlpha = 0.7;
      x.beginPath(); x.moveTo(bcX + 6, topShelfY + 14); x.lineTo(bcX + cartW - 6, botShelfY - 6); x.stroke();
      x.globalAlpha = 1;
      // Shelves
      r(bcX, topShelfY, cartW, shelfH, bcC);
      x.fillStyle = bcLight; x.globalAlpha = 0.2; x.fillRect(bcX + 1, topShelfY, cartW - 2, 2); x.globalAlpha = 1;
      r(bcX, botShelfY, cartW, shelfH, bcC);
      x.fillStyle = bcLight; x.globalAlpha = 0.2; x.fillRect(bcX + 1, botShelfY, cartW - 2, 2); x.globalAlpha = 1;
      // Wheels
      const wheelY = botShelfY + shelfH + 28;
      [bcX + 6, bcX + cartW - 10].forEach(wx => {
        x.fillStyle = bcDark;
        x.beginPath(); x.arc(wx + 2, wheelY, 5, 0, Math.PI * 2); x.fill();
        x.fillStyle = bcLight; x.globalAlpha = 0.3;
        x.beginPath(); x.arc(wx + 1, wheelY - 1, 2, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
      });
      // Bottles on top shelf
      const bottleData = [
        { bx: bcX + 6,  h: 22, w: 8,  col: '#1a3a18' },
        { bx: bcX + 17, h: 18, w: 7,  col: '#3a1a10' },
        { bx: bcX + 27, h: 24, w: 7,  col: '#1a1a30' },
        { bx: bcX + 37, h: 20, w: 6,  col: '#2a3a18' },
      ];
      bottleData.forEach(b => {
        // Bottle body
        r(b.bx, topShelfY - b.h, b.w, b.h, darken(b.col, 8));
        r(b.bx + 1, topShelfY - b.h + 1, b.w - 2, b.h - 2, b.col);
        // Neck
        r(b.bx + 2, topShelfY - b.h - 6, b.w - 4, 7, darken(b.col, 4));
        // Label
        r(b.bx + 1, topShelfY - b.h + 5, b.w - 2, 7, lighten(b.col, 30));
        // Glass highlight
        x.fillStyle = '#fff'; x.globalAlpha = 0.1;
        x.fillRect(b.bx + 1, topShelfY - b.h + 1, 2, b.h - 4); x.globalAlpha = 1;
      });
      // Glasses on bottom shelf
      [[bcX + 8, 10], [bcX + 18, 10], [bcX + 28, 12]].forEach(([gx2, gh]) => {
        r(gx2, botShelfY - gh, 7, gh, '#d0e8f8');
        x.fillStyle = '#fff'; x.globalAlpha = 0.25; x.fillRect(gx2 + 1, botShelfY - gh + 1, 2, gh - 2); x.globalAlpha = 1;
        x.fillStyle = '#000'; x.globalAlpha = 0.1; x.fillRect(gx2, botShelfY - gh, 7, 2); x.globalAlpha = 1;
      });
    }

    // ── Cat Tree / Scratching Post ──
    if (cfg.furniture.includes('cat_tree')) {
      const ctX = 776; const ctBotY = FY + 172;
      const ctC = fc('cat_tree');
      const ctLight = lighten(ctC, 22);
      const ctDark  = darken(ctC, 14);
      // Floor shadow
      x.fillStyle = '#000'; x.globalAlpha = 0.2;
      x.beginPath(); x.ellipse(ctX, ctBotY + 1, 20, 4, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
      // Base platform
      r(ctX - 19, ctBotY - 8, 38, 8, ctDark);
      r(ctX - 17, ctBotY - 6, 34, 5, ctC);
      x.fillStyle = ctLight; x.globalAlpha = 0.2; x.fillRect(ctX - 17, ctBotY - 6, 34, 2); x.globalAlpha = 1;
      // Center post — sisal rope bands
      r(ctX - 5, ctBotY - 82, 10, 74, ctDark);
      for (let py2 = ctBotY - 82; py2 < ctBotY - 8; py2 += 5) {
        x.fillStyle = ctLight; x.globalAlpha = 0.3; x.fillRect(ctX - 5, py2, 10, 3); x.globalAlpha = 1;
      }
      // Mid platform
      r(ctX - 20, ctBotY - 52, 40, 6, ctDark);
      r(ctX - 18, ctBotY - 50, 36, 4, ctC);
      x.fillStyle = ctLight; x.globalAlpha = 0.18; x.fillRect(ctX - 18, ctBotY - 50, 36, 2); x.globalAlpha = 1;
      // Post between mid and top
      r(ctX - 5, ctBotY - 100, 10, 48, ctDark);
      for (let py2 = ctBotY - 100; py2 < ctBotY - 52; py2 += 5) {
        x.fillStyle = ctLight; x.globalAlpha = 0.3; x.fillRect(ctX - 5, py2, 10, 3); x.globalAlpha = 1;
      }
      // Hideout box
      r(ctX - 15, ctBotY - 130, 30, 30, ctDark);
      r(ctX - 13, ctBotY - 128, 26, 26, ctC);
      x.fillStyle = ctLight; x.globalAlpha = 0.1; x.fillRect(ctX - 13, ctBotY - 128, 26, 4); x.globalAlpha = 1;
      // Entrance hole
      x.fillStyle = '#06030e';
      x.beginPath(); x.arc(ctX, ctBotY - 115, 7, 0, Math.PI * 2); x.fill();
      // Roof cap
      r(ctX - 17, ctBotY - 132, 34, 5, ctDark);
      x.fillStyle = ctLight; x.globalAlpha = 0.22; x.fillRect(ctX - 17, ctBotY - 132, 34, 2); x.globalAlpha = 1;
      // Dangling toy — hangs from mid platform edge
      x.strokeStyle = darken(ctC, 20); x.lineWidth = 1; x.globalAlpha = 0.6;
      x.beginPath(); x.moveTo(ctX - 14, ctBotY - 50); x.lineTo(ctX - 14, ctBotY - 36); x.stroke();
      x.globalAlpha = 1;
      x.fillStyle = P.pink; x.globalAlpha = 0.9;
      x.beginPath(); x.arc(ctX - 14, ctBotY - 33, 4, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff'; x.globalAlpha = 0.25;
      x.beginPath(); x.arc(ctX - 16, ctBotY - 35, 1.5, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
    }

  }

  // ── Poster Drawing Helper ──
  private drawPoster(
    x: CanvasRenderingContext2D,
    poster: PosterId,
    px: number, py: number, pw: number, ph: number,
    light: { primary: string; glow: string },
  ): void {
    if (poster === 'none') return;

    // Drop shadow
    x.fillStyle = '#000'; x.globalAlpha = 0.35;
    x.fillRect(px + 3, py + 3, pw, ph); x.globalAlpha = 1;
    // Outer frame — warm dark wood
    x.fillStyle = '#3a220e'; x.fillRect(px, py, pw, ph);
    // Bevel highlight (top/left lighter)
    x.fillStyle = '#5a3818'; x.globalAlpha = 0.8;
    x.fillRect(px, py, pw, 4);       // top edge
    x.fillRect(px, py, 4, ph);       // left edge
    x.globalAlpha = 1;
    // Bevel shadow (bottom/right darker)
    x.fillStyle = '#1e0e04'; x.globalAlpha = 0.8;
    x.fillRect(px, py + ph - 4, pw, 4);   // bottom edge
    x.fillRect(px + pw - 4, py, 4, ph);   // right edge
    x.globalAlpha = 1;
    // Inner mat — dark art background
    x.fillStyle = '#06040f'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
    // Subtle inner glow from lighting
    x.fillStyle = light.glow; x.globalAlpha = 0.04;
    x.fillRect(px + 6, py + 6, pw - 12, ph - 12); x.globalAlpha = 1;

    // Content based on poster type
    x.textAlign = 'center';
    switch (poster) {
      case 'bitcoin':
        // Circuit board lines
        x.strokeStyle = P.amber; x.lineWidth = 0.5;
        for (let bly = py + 10; bly < py + ph - 10; bly += 7) {
          x.globalAlpha = 0.08;
          x.beginPath(); x.moveTo(px + 8, bly); x.lineTo(px + pw - 8, bly); x.stroke();
        }
        x.globalAlpha = 1;
        // ₿ symbol
        x.fillStyle = P.amber; x.globalAlpha = 0.88;
        x.font = `bold ${Math.floor(Math.min(pw, ph) * 0.42)}px monospace`;
        x.fillText('\u20BF', px + pw / 2, py + ph * 0.58);
        x.globalAlpha = 1;
        // "BITCOIN" label
        x.fillStyle = P.amber; x.font = 'bold 7px monospace';
        x.globalAlpha = 0.8; x.fillText('BITCOIN', px + pw / 2, py + ph * 0.84); x.globalAlpha = 1;
        // Inner glow border
        x.strokeStyle = P.amber; x.globalAlpha = 0.25; x.lineWidth = 1;
        x.strokeRect(px + 9, py + 9, pw - 18, ph - 18); x.globalAlpha = 1;
        break;

      case 'nostr':
        // Title
        x.fillStyle = P.purp; x.globalAlpha = 0.9;
        x.font = 'bold 9px monospace';
        x.fillText('NOSTR', px + pw / 2, py + 20); x.globalAlpha = 1;
        // Spokes from center hub
        x.strokeStyle = P.purp; x.lineWidth = 0.5;
        x.globalAlpha = 0.22;
        x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.15, py+ph*0.33); x.stroke();
        x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.85, py+ph*0.33); x.stroke();
        x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.1, py+ph*0.62); x.stroke();
        x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.9, py+ph*0.62); x.stroke();
        x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.35, py+ph*0.76); x.stroke();
        x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.65, py+ph*0.76); x.stroke();
        // Center hub
        x.fillStyle = P.pink; x.globalAlpha = 0.9;
        x.beginPath(); x.arc(px+pw*0.5, py+ph*0.5, 5, 0, Math.PI*2); x.fill();
        x.fillStyle = '#fff'; x.globalAlpha = 0.7;
        x.beginPath(); x.arc(px+pw*0.5, py+ph*0.5, 2, 0, Math.PI*2); x.fill();
        // Outer nodes
        x.fillStyle = P.purp; x.globalAlpha = 0.7;
        x.beginPath(); x.arc(px+pw*0.15, py+ph*0.33, 3, 0, Math.PI*2); x.fill();
        x.beginPath(); x.arc(px+pw*0.85, py+ph*0.33, 3, 0, Math.PI*2); x.fill();
        x.beginPath(); x.arc(px+pw*0.1,  py+ph*0.62, 3, 0, Math.PI*2); x.fill();
        x.beginPath(); x.arc(px+pw*0.9,  py+ph*0.62, 3, 0, Math.PI*2); x.fill();
        x.beginPath(); x.arc(px+pw*0.35, py+ph*0.76, 3, 0, Math.PI*2); x.fill();
        x.beginPath(); x.arc(px+pw*0.65, py+ph*0.76, 3, 0, Math.PI*2); x.fill();
        x.globalAlpha = 1;
        x.fillStyle = P.purp; x.font = '6px monospace';
        x.globalAlpha = 0.5; x.fillText('decentralized', px + pw/2, py + ph - 9); x.globalAlpha = 1;
        break;

      case 'pixel_art':
        // Night city skyline
        x.fillStyle = '#080420'; x.fillRect(px+6, py+6, pw-12, ph-12);
        // Stars (deterministic)
        x.fillStyle = '#fff';
        for (let s = 0; s < 16; s++) {
          x.globalAlpha = 0.15 + (s % 4) * 0.08;
          x.fillRect(px + 8 + (s * 14) % (pw - 16), py + 7 + (s * 11) % Math.floor(ph * 0.4), 1, 1);
        }
        x.globalAlpha = 1;
        // Crescent moon
        x.fillStyle = '#e8d060'; x.globalAlpha = 0.6;
        x.beginPath(); x.arc(px+pw*0.82, py+ph*0.18, 6, 0, Math.PI*2); x.fill();
        x.fillStyle = '#080420'; x.globalAlpha = 0.96;
        x.beginPath(); x.arc(px+pw*0.85, py+ph*0.16, 5, 0, Math.PI*2); x.fill();
        x.globalAlpha = 1;
        // Building silhouettes
        x.fillStyle = '#030112';
        x.fillRect(px+6,      py+ph*0.55, 14, ph-6-ph*0.55);
        x.fillRect(px+8,      py+ph*0.44, 10, ph*0.12);
        x.fillRect(px+18,     py+ph*0.62, 12, ph-6-ph*0.62);
        x.fillRect(px+28,     py+ph*0.48, 18, ph-6-ph*0.48);
        x.fillRect(px+32,     py+ph*0.37, 8,  ph*0.13);
        x.fillRect(px+pw-24,  py+ph*0.52, 18, ph-6-ph*0.52);
        x.fillRect(px+pw-22,  py+ph*0.42, 12, ph*0.12);
        // Windows
        x.fillStyle = P.amber; x.globalAlpha = 0.38;
        x.fillRect(px+10, py+ph*0.5,  2, 2); x.fillRect(px+14, py+ph*0.5,  2, 2);
        x.fillRect(px+10, py+ph*0.57, 2, 2); x.fillRect(px+30, py+ph*0.52, 2, 2);
        x.fillRect(px+36, py+ph*0.52, 2, 2); x.fillRect(px+30, py+ph*0.59, 2, 2);
        x.fillRect(px+pw-20, py+ph*0.56, 2, 2); x.fillRect(px+pw-14, py+ph*0.56, 2, 2);
        x.fillStyle = P.teal; x.globalAlpha = 0.28;
        x.fillRect(px+32, py+ph*0.65, 2, 2); x.fillRect(px+38, py+ph*0.65, 2, 2);
        x.globalAlpha = 1;
        break;

      case 'landscape':
        // Pixel mountain scene
        x.fillStyle = '#0a0020'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
        // Mountains
        x.fillStyle = '#1a1040'; x.globalAlpha = 0.6;
        x.beginPath(); x.moveTo(px + 5, py + ph * 0.7);
        x.lineTo(px + pw * 0.3, py + ph * 0.25); x.lineTo(px + pw * 0.5, py + ph * 0.5);
        x.lineTo(px + pw * 0.7, py + ph * 0.2); x.lineTo(px + pw - 5, py + ph * 0.6);
        x.lineTo(px + pw - 5, py + ph * 0.7); x.fill();
        x.globalAlpha = 1;
        // Moon
        x.fillStyle = '#fad480'; x.globalAlpha = 0.5;
        x.beginPath(); x.arc(px + pw * 0.8, py + ph * 0.2, 6, 0, Math.PI * 2); x.fill();
        x.globalAlpha = 1;
        // Stars
        for (let s = 0; s < 8; s++) {
          x.fillStyle = '#fff'; x.globalAlpha = 0.3 + Math.random() * 0.3;
          x.fillRect(px + 8 + Math.random() * (pw - 16), py + 6 + Math.random() * (ph * 0.4), 1, 1);
        }
        x.globalAlpha = 1;
        break;

      case 'cat':
        // Ears (triangles)
        x.fillStyle = P.pink; x.globalAlpha = 0.75;
        x.beginPath(); x.moveTo(px+pw*0.25, py+ph*0.22); x.lineTo(px+pw*0.18, py+ph*0.06); x.lineTo(px+pw*0.38, py+ph*0.18); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(px+pw*0.75, py+ph*0.22); x.lineTo(px+pw*0.82, py+ph*0.06); x.lineTo(px+pw*0.62, py+ph*0.18); x.closePath(); x.fill();
        // Inner ear
        x.fillStyle = '#ff9dc0'; x.globalAlpha = 0.4;
        x.beginPath(); x.moveTo(px+pw*0.27, py+ph*0.2); x.lineTo(px+pw*0.21, py+ph*0.1); x.lineTo(px+pw*0.36, py+ph*0.17); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(px+pw*0.73, py+ph*0.2); x.lineTo(px+pw*0.79, py+ph*0.1); x.lineTo(px+pw*0.64, py+ph*0.17); x.closePath(); x.fill();
        // Head
        x.fillStyle = P.pink; x.globalAlpha = 0.65;
        x.beginPath(); x.arc(px+pw/2, py+ph*0.44, pw*0.29, 0, Math.PI*2); x.fill();
        // Eyes
        x.fillStyle = '#0e0828'; x.globalAlpha = 1;
        x.beginPath(); x.ellipse(px+pw*0.37, py+ph*0.40, 4, 5, -0.2, 0, Math.PI*2); x.fill();
        x.beginPath(); x.ellipse(px+pw*0.63, py+ph*0.40, 4, 5,  0.2, 0, Math.PI*2); x.fill();
        x.fillStyle = '#fff'; x.globalAlpha = 0.85;
        x.fillRect(px+pw*0.35, py+ph*0.36, 2, 2); x.fillRect(px+pw*0.61, py+ph*0.36, 2, 2);
        // Nose
        x.fillStyle = '#ff7090'; x.globalAlpha = 0.85;
        x.beginPath(); x.moveTo(px+pw*0.5, py+ph*0.5); x.lineTo(px+pw*0.44, py+ph*0.54); x.lineTo(px+pw*0.56, py+ph*0.54); x.closePath(); x.fill();
        // Whiskers
        x.strokeStyle = '#fff'; x.globalAlpha = 0.28; x.lineWidth = 0.5;
        x.beginPath(); x.moveTo(px+pw*0.18, py+ph*0.50); x.lineTo(px+pw*0.43, py+ph*0.52); x.stroke();
        x.beginPath(); x.moveTo(px+pw*0.82, py+ph*0.50); x.lineTo(px+pw*0.57, py+ph*0.52); x.stroke();
        x.beginPath(); x.moveTo(px+pw*0.16, py+ph*0.55); x.lineTo(px+pw*0.43, py+ph*0.55); x.stroke();
        x.beginPath(); x.moveTo(px+pw*0.84, py+ph*0.55); x.lineTo(px+pw*0.57, py+ph*0.55); x.stroke();
        x.globalAlpha = 1;
        x.fillStyle = P.pink; x.font = 'bold 8px monospace';
        x.fillText('MEOW', px + pw / 2, py + ph * 0.87);
        break;

      case 'skull':
        // Cranium
        x.fillStyle = '#d0c8b8'; x.globalAlpha = 0.85;
        x.beginPath(); x.arc(px+pw/2, py+ph*0.33, pw*0.28, 0, Math.PI*2); x.fill();
        x.fillRect(px+pw/2-pw*0.22, py+ph*0.4, pw*0.44, ph*0.22);
        // Eye sockets
        x.fillStyle = '#040110'; x.globalAlpha = 1;
        x.beginPath(); x.ellipse(px+pw*0.35, py+ph*0.30, 6, 7, -0.1, 0, Math.PI*2); x.fill();
        x.beginPath(); x.ellipse(px+pw*0.65, py+ph*0.30, 6, 7,  0.1, 0, Math.PI*2); x.fill();
        // Nose cavity
        x.beginPath(); x.moveTo(px+pw/2, py+ph*0.43); x.lineTo(px+pw/2-3, py+ph*0.5); x.lineTo(px+pw/2+3, py+ph*0.5); x.closePath(); x.fill();
        // Teeth
        x.fillStyle = '#d0c8b8'; x.globalAlpha = 0.75;
        for (let t = 0; t < 5; t++) {
          x.fillRect(px+pw*0.28 + t*(pw*0.44/5), py+ph*0.58, pw*0.44/5-2, ph*0.1);
        }
        // Crack
        x.strokeStyle = '#040110'; x.globalAlpha = 0.35; x.lineWidth = 0.5;
        x.beginPath(); x.moveTo(px+pw*0.52, py+ph*0.09); x.lineTo(px+pw*0.5, py+ph*0.2); x.lineTo(px+pw*0.53, py+ph*0.28); x.stroke();
        x.globalAlpha = 1;
        break;

      case 'moon':
        // Deep space
        x.fillStyle = '#010008'; x.fillRect(px+6, py+6, pw-12, ph-12);
        // Stars (deterministic)
        x.fillStyle = '#fff';
        for (let s = 0; s < 22; s++) {
          x.globalAlpha = 0.12 + (s % 4) * 0.08;
          x.fillRect(px + 8 + (s * 13) % (pw-16), py + 8 + (s * 17) % (ph-16), (s % 6 === 0) ? 1.5 : 1, (s % 6 === 0) ? 1.5 : 1);
        }
        x.globalAlpha = 1;
        // Full circle (gold)
        x.fillStyle = '#f0d050'; x.globalAlpha = 0.92;
        x.beginPath(); x.arc(px+pw/2, py+ph*0.42, Math.min(pw,ph)*0.24, 0, Math.PI*2); x.fill();
        // Crescent shadow (overlapping circle)
        x.fillStyle = '#010008'; x.globalAlpha = 0.96;
        x.beginPath(); x.arc(px+pw/2+Math.min(pw,ph)*0.12, py+ph*0.38, Math.min(pw,ph)*0.2, 0, Math.PI*2); x.fill();
        // Craters
        x.fillStyle = '#b8a030'; x.globalAlpha = 0.32;
        x.beginPath(); x.arc(px+pw*0.36, py+ph*0.48, 3, 0, Math.PI*2); x.fill();
        x.beginPath(); x.arc(px+pw*0.3,  py+ph*0.36, 2, 0, Math.PI*2); x.fill();
        x.beginPath(); x.arc(px+pw*0.4,  py+ph*0.38, 1.5, 0, Math.PI*2); x.fill();
        x.globalAlpha = 1;
        break;

      case 'code':
        x.fillStyle = '#060412'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
        // Line number gutter
        x.fillStyle = '#1a1040'; x.globalAlpha = 0.5;
        for (let ln = 0; ln < 9; ln++) x.fillRect(px+8, py+12+ln*8, 5, 5);
        x.globalAlpha = 1;
        x.font = '6px monospace'; x.textAlign = 'left';
        x.fillStyle = P.purp;  x.globalAlpha = 0.75; x.fillText('const',      px+16, py+16);
        x.fillStyle = P.lcream; x.globalAlpha = 0.65; x.fillText('nostr =',    px+38, py+16);
        x.fillStyle = P.teal;  x.globalAlpha = 0.75; x.fillText('require',     px+16, py+24);
        x.fillStyle = P.amber; x.globalAlpha = 0.65; x.fillText('("nostr")',   px+42, py+24);
        x.fillStyle = P.purp;  x.globalAlpha = 0.75; x.fillText('async',       px+16, py+32);
        x.fillStyle = P.pink;  x.globalAlpha = 0.75; x.fillText('function',    px+38, py+32);
        x.fillStyle = P.teal;  x.globalAlpha = 0.65; x.fillText('sign(e) {',   px+16, py+40);
        x.fillStyle = P.amber; x.globalAlpha = 0.6;  x.fillText('return relay',px+20, py+48);
        x.fillStyle = P.pink;  x.globalAlpha = 0.55; x.fillText('.publish(e)', px+20, py+56);
        x.fillStyle = P.lcream; x.globalAlpha = 0.65; x.fillText('}',          px+16, py+64);
        x.textAlign = 'center'; x.globalAlpha = 1;
        break;
      case 'synthwave': {
        // Dark sky
        x.fillStyle = '#060212'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
        // Sky gradient — deep purple to magenta at horizon
        const swGrad = x.createLinearGradient(px + 6, py + 6, px + 6, py + ph * 0.62);
        swGrad.addColorStop(0, '#0d0025');
        swGrad.addColorStop(0.6, '#2a0040');
        swGrad.addColorStop(1, '#4a0050');
        x.fillStyle = swGrad; x.globalAlpha = 1;
        x.fillRect(px + 6, py + 6, pw - 12, Math.floor((ph - 12) * 0.58));
        x.globalAlpha = 1;
        // Sun — solid circle
        x.fillStyle = '#ff4488'; x.globalAlpha = 1;
        x.beginPath(); x.arc(px + pw / 2, py + ph * 0.4, pw * 0.2, 0, Math.PI * 2); x.fill();
        // Sun horizontal scan lines (gives retro banded look)
        const sunCY = py + ph * 0.4; const sunR = pw * 0.2;
        x.fillStyle = '#060212'; x.globalAlpha = 1;
        for (let sl = 1; sl < 6; sl++) {
          const ly = sunCY + sunR * 0.1 + sl * (sunR * 0.8 / 6);
          const hw = Math.sqrt(Math.max(0, sunR * sunR - (ly - sunCY) * (ly - sunCY)));
          x.fillRect(px + pw / 2 - hw, ly, hw * 2, sunR * 0.09);
        }
        // Horizon line
        const horizY = py + ph * 0.58;
        x.fillStyle = '#ff44aa'; x.globalAlpha = 0.8;
        x.fillRect(px + 6, horizY, pw - 12, 1);
        // Grid floor — proper perspective
        x.strokeStyle = '#cc22cc'; x.lineWidth = 0.5; x.globalAlpha = 0.6;
        // Horizontal lines (perspective)
        for (let gl = 0; gl < 5; gl++) {
          const t = gl / 4;
          const gy = horizY + 2 + t * t * (py + ph - 8 - horizY);
          x.beginPath(); x.moveTo(px + 6, gy); x.lineTo(px + pw - 6, gy); x.stroke();
        }
        // Vertical lines converging to vanishing point
        const vp = px + pw / 2;
        for (let gc = -4; gc <= 4; gc++) {
          const bx2 = vp + gc * ((pw - 12) / 8);
          x.beginPath(); x.moveTo(vp, horizY); x.lineTo(bx2, py + ph - 8); x.stroke();
        }
        x.globalAlpha = 1;
        // Stars
        x.fillStyle = '#fff';
        for (let s = 0; s < 14; s++) {
          x.globalAlpha = 0.15 + (s % 4) * 0.1;
          x.fillRect(px + 8 + (s * 13) % (pw - 16), py + 8 + (s * 9) % Math.floor(ph * 0.28), (s % 5 === 0) ? 1.5 : 1, (s % 5 === 0) ? 1.5 : 1);
        }
        x.globalAlpha = 1;
        break;
      }

      case 'matrix': {
        // Dark green rain of code
        x.fillStyle = '#000a02'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
        // Clip to inner frame so characters can't overflow
        x.save();
        x.beginPath(); x.rect(px + 6, py + 6, pw - 12, ph - 12); x.clip();
        x.font = '5px monospace'; x.textAlign = 'left';
        const matChars = '01アイウエオカキクケコ'.split('');
        const cols = Math.floor((pw - 12) / 8);
        const rows = Math.floor((ph - 12) / 7);
        for (let col = 0; col < cols; col++) {
          for (let row = 0; row < rows; row++) {
            const alpha = 0.1 + (row / rows) * 0.65;
            x.fillStyle = col % 3 === 0 ? '#00ff41' : '#00cc33';
            x.globalAlpha = alpha;
            const ch = matChars[(col * 3 + row * 2) % matChars.length];
            x.fillText(ch, px + 8 + col * 8, py + 12 + row * 7);
            x.globalAlpha = 1;
          }
        }
        // Bright leading char per column
        x.fillStyle = '#ccffcc'; x.globalAlpha = 0.95;
        for (let col = 0; col < cols; col++) {
          x.fillText(matChars[col % matChars.length], px + 8 + col * 8, py + 12);
        }
        x.globalAlpha = 1;
        x.restore();
        x.textAlign = 'center';
        break;
      }

      case 'space': {
        // Deep nebula
        x.fillStyle = '#010008'; x.fillRect(px + 6, py + 6, pw - 12, ph - 12);
        // Nebula clouds
        const nebColors = ['#3a0050', '#001a50', '#002a30', '#200040'];
        nebColors.forEach((nc2, i) => {
          x.fillStyle = nc2; x.globalAlpha = 0.3;
          x.beginPath();
          x.ellipse(
            px + 6 + (i * 18) % (pw - 12),
            py + 6 + (i * 14) % (ph - 12),
            20 + i * 6, 12 + i * 4, i * 0.5, 0, Math.PI * 2
          );
          x.fill(); x.globalAlpha = 1;
        });
        // Stars
        x.fillStyle = '#fff';
        for (let s = 0; s < 30; s++) {
          x.globalAlpha = 0.1 + (s % 5) * 0.1;
          const sz = s % 8 === 0 ? 1.5 : 1;
          x.fillRect(px + 8 + (s * 17) % (pw - 16), py + 8 + (s * 11) % (ph - 16), sz, sz);
        }
        x.globalAlpha = 1;
        // Bright star
        x.fillStyle = '#fff'; x.globalAlpha = 0.9;
        x.beginPath(); x.arc(px + pw * 0.7, py + ph * 0.25, 2, 0, Math.PI * 2); x.fill();
        x.globalAlpha = 0.15;
        x.beginPath(); x.arc(px + pw * 0.7, py + ph * 0.25, 6, 0, Math.PI * 2); x.fill();
        x.globalAlpha = 1;
        break;
      }
    }
  }

  // ════════════════════════════════════════════
  // ════════════════════════════════════════════
  // OTHER ROOM DRAW METHODS — unchanged from original
  // ════════════════════════════════════════════

  private drawLounge(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void { const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); }; const FY = 300; ['#010008', '#020010', '#030014', '#05001c', '#070024', '#09002c', '#0b0032'].forEach((c, i) => r(0, i * 42, W, 42, c)); for (let i = 0; i < 140; i++) { x.fillStyle = ['#fad480', '#e87aab', '#7b68ee', '#5dcaa5', '#fff', '#fff', '#fff'][Math.floor(Math.random() * 7)]; x.globalAlpha = 0.12 + Math.random() * 0.55; const sz = Math.random() > 0.9 ? 2 : 1; x.fillRect(Math.random() * W, Math.random() * 180, sz, sz); } for (let i = 0; i < 5; i++) { const sx = Math.random() * W; const sy = 10 + Math.random() * 120; x.fillStyle = '#fff'; x.globalAlpha = 0.3; x.fillRect(sx, sy, 2, 2); x.globalAlpha = 0.08; x.fillRect(sx - 2, sy, 6, 1); x.fillRect(sx, sy - 2, 1, 6); } x.globalAlpha = 1; x.fillStyle = '#f5e8d0'; x.globalAlpha = 0.06; x.beginPath(); x.arc(620, 50, 28, 0, Math.PI * 2); x.fill(); x.globalAlpha = 0.12; x.beginPath(); x.arc(620, 50, 18, 0, Math.PI * 2); x.fill(); x.globalAlpha = 0.35; x.beginPath(); x.arc(620, 50, 12, 0, Math.PI * 2); x.fill(); x.globalAlpha = 0.6; x.beginPath(); x.arc(620, 50, 8, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1; for (let i = 0; i < W; i += 16 + Math.random() * 22) { const bw = 10 + Math.random() * 38; const bh = 25 + Math.random() * 150; r(i, 220 - bh, bw, bh, '#0a0818'); for (let wy = 220 - bh + 3; wy < 218; wy += 4 + Math.random() * 3) { for (let wx = i + 2; wx < i + bw - 2; wx += 3 + Math.random() * 3) { if (Math.random() > 0.4) { x.fillStyle = [P.pink, P.purp, P.amber, P.teal, P.lcream][Math.floor(Math.random() * 5)]; x.globalAlpha = 0.04 + Math.random() * 0.1; x.fillRect(wx, wy, 2, 2); x.globalAlpha = 1; } } } } x.globalAlpha = 0.035; r(0, 175, W, 45, P.pink); x.globalAlpha = 0.02; r(0, 155, W, 65, P.amber); x.globalAlpha = 1; r(0, 196, W, 3, '#3a2878'); r(0, 206, W, 3, '#3a2878'); r(0, 218, W, 12, '#1a1040'); for (let rx = 20; rx < W; rx += 30) r(rx, 196, 3, 24, '#2a1858'); x.strokeStyle = '#2a1858'; x.lineWidth = 1; x.globalAlpha = 0.4; x.beginPath(); x.moveTo(0, 198); x.lineTo(W, 198); x.stroke(); x.beginPath(); x.moveTo(0, 208); x.lineTo(W, 208); x.stroke(); x.globalAlpha = 1; for (let lx = 8; lx < W - 8; lx += 16) { const bc = [P.pink, P.amber, P.teal, P.purp, P.lcream, P.red][Math.floor(lx / 16) % 6]; x.fillStyle = bc; x.globalAlpha = 0.15; x.fillRect(lx - 1, 197, 3, 3); x.globalAlpha = 1; } for (let lx = 14; lx < W - 8; lx += 16) { const bc = [P.amber, P.teal, P.pink, P.lcream, P.purp, P.red][Math.floor(lx / 16) % 6]; x.fillStyle = bc; x.globalAlpha = 0.15; x.fillRect(lx - 1, 207, 3, 3); x.globalAlpha = 1; } r(0, FY - 70, W, H - FY + 70, '#1a0a3e'); for (let fy = FY - 65; fy < H; fy += 14) { for (let fx = 0; fx < W; fx += 22) { x.globalAlpha = 0.1; r(fx, fy, 20, 12, '#221448'); x.globalAlpha = 0.04; r(fx, fy, 20, 1, '#3a2878'); x.globalAlpha = 1; } } r(30, FY - 50, 14, 55, '#2a1858'); r(176, FY - 50, 14, 55, '#2a1858'); r(40, FY - 55, 140, 28, '#2a1858'); r(45, FY - 52, 130, 22, '#342068'); r(40, FY - 28, 140, 34, '#2a1858'); r(45, FY - 24, 130, 26, '#342068'); r(50, FY - 22, 38, 20, '#4a2878'); r(92, FY - 22, 38, 20, '#3a2068'); r(134, FY - 22, 38, 20, '#4a2878'); x.fillStyle = P.pink; x.globalAlpha = 0.2; x.fillRect(55, FY - 48, 14, 10); x.globalAlpha = 1; r(540, FY - 45, 14, 50, '#2a1858'); r(670, FY - 45, 14, 50, '#2a1858'); r(550, FY - 48, 124, 24, '#2a1858'); r(555, FY - 45, 114, 18, '#342068'); r(550, FY - 25, 124, 30, '#2a1858'); r(555, FY - 21, 114, 22, '#342068'); r(250, FY - 12, 200, 10, '#2a1858'); r(255, FY - 9, 190, 4, '#3a2878'); r(260, FY - 2, 6, 18, '#221448'); r(434, FY - 2, 6, 18, '#221448'); x.globalAlpha = 0.5; r(290, FY - 20, 8, 10, P.teal); x.globalAlpha = 1; r(292, FY - 18, 4, 6, '#1a1040'); x.globalAlpha = 0.4; r(330, FY - 18, 6, 8, P.amber); x.globalAlpha = 1; x.globalAlpha = 0.35; r(370, FY - 22, 10, 12, P.pink); x.globalAlpha = 1; r(410, FY - 20, 6, 10, '#f5e8d0'); x.fillStyle = P.amber; x.globalAlpha = 0.5; x.fillRect(412, FY - 24, 2, 4); x.globalAlpha = 0.035; x.beginPath(); x.arc(413, FY - 22, 14, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1; r(710, FY - 55, 50, 55, '#1a1040'); r(715, FY - 50, 40, 45, '#221448'); r(705, FY - 58, 60, 5, '#2a1858'); x.fillStyle = P.amber; x.globalAlpha = 0.04; x.beginPath(); x.arc(735, FY - 35, 35, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1; r(6, FY - 48, 22, 30, '#1a1040'); r(8, FY - 46, 18, 26, '#0e0828'); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(17, FY - 38, 7, 0, Math.PI * 2); x.fill(); x.fillStyle = '#342068'; x.beginPath(); x.arc(17, FY - 38, 4, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(17, FY - 26, 3, 0, Math.PI * 2); x.fill(); r(W - 28, FY - 48, 22, 30, '#1a1040'); r(W - 26, FY - 46, 18, 26, '#0e0828'); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(W - 17, FY - 38, 7, 0, Math.PI * 2); x.fill(); x.fillStyle = '#342068'; x.beginPath(); x.arc(W - 17, FY - 38, 4, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(W - 17, FY - 26, 3, 0, Math.PI * 2); x.fill(); r(680, FY - 78, 80, 10, '#2a1858'); r(690, FY - 92, 60, 16, '#1a1040'); r(695, FY - 88, 50, 8, '#0a0818'); x.fillStyle = '#0a0818'; x.beginPath(); x.arc(720, FY - 84, 10, 0, Math.PI * 2); x.fill(); x.fillStyle = P.purp; x.globalAlpha = 0.3; x.beginPath(); x.arc(720, FY - 84, 4, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1; r(680, FY - 66, 24, 48, '#1a1040'); r(684, FY - 62, 16, 40, '#0e0828'); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(692, FY - 42, 6, 0, Math.PI * 2); x.fill(); x.fillStyle = '#2a1858'; x.beginPath(); x.arc(692, FY - 54, 3, 0, Math.PI * 2); x.fill(); r(310, FY - 68, 160, 26, '#0a0818'); r(312, FY - 66, 156, 22, '#0e0828'); x.strokeStyle = nc; x.globalAlpha = 0.35; x.strokeRect(310, FY - 68, 160, 26); x.globalAlpha = 1; x.fillStyle = nc; x.font = 'bold 11px monospace'; x.textAlign = 'center'; x.fillText('ROOFTOP LOUNGE', 390, FY - 52); x.fillStyle = nc; x.globalAlpha = 0.03; x.fillRect(300, FY - 42, 180, 15); x.globalAlpha = 1; this.drawDoor(x, W, FY + 50, nc, H); }

  private drawRelay(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void { const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); }; const FY = 300; r(0, 0, W, H, '#0a0818'); r(0, FY, W, H - FY, '#0e0828'); r(0, FY, W, 2, nc); for (let fy = FY + 4; fy < H; fy += 16) { for (let fx = 0; fx < W; fx += 32) { x.globalAlpha = 0.06; r(fx, fy, 30, 14, '#1a1040'); x.globalAlpha = 1; } } for (let rack = 0; rack < 3; rack++) { const rx = 40 + rack * 120; r(rx, 30, 100, 265, '#080616'); r(rx + 2, 32, 96, 261, '#0c0a1e'); x.strokeStyle = nc; x.globalAlpha = 0.15; x.strokeRect(rx, 30, 100, 265); x.globalAlpha = 1; for (let sy = 40; sy < 285; sy += 18) { r(rx + 8, sy, 84, 12, '#060412'); for (let lx = rx + 12; lx < rx + 88; lx += 8) { const lc = [P.teal, P.pink, P.amber, P.purp, P.red][Math.floor(Math.random() * 5)]; this.blinkingLEDs.push({ x: lx, y: sy + 3, color: lc, phase: Math.random() * Math.PI * 2 }); } } } r(450, 30, 310, 265, '#080616'); r(452, 32, 306, 261, '#0c0a1e'); x.strokeStyle = nc; x.globalAlpha = 0.15; x.strokeRect(450, 30, 310, 265); x.globalAlpha = 1; r(460, 40, 290, 24, '#0a0818'); x.fillStyle = nc; x.font = 'bold 11px monospace'; x.textAlign = 'center'; x.fillText('RELAY STATUS: CONNECTED', 605, 57); const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band', 'wss://eden.nostr.land', 'wss://nostr.wine', 'wss://relay.snort.social']; relays.forEach((rl, i) => { const ry = 78 + i * 26; r(460, ry, 290, 20, i % 2 === 0 ? '#0a0818' : '#0c0a20'); x.fillStyle = P.teal; x.globalAlpha = 0.6; x.fillRect(468, ry + 6, 8, 8); x.globalAlpha = 1; x.fillStyle = P.lcream; x.globalAlpha = 0.5; x.font = '9px monospace'; x.textAlign = 'left'; x.fillText(rl, 484, ry + 14); x.globalAlpha = 1; x.fillStyle = P.teal; x.textAlign = 'right'; x.globalAlpha = 0.4; x.fillText(`${Math.floor(Math.random() * 50 + 10)}ms`, 740, ry + 14); x.globalAlpha = 1; }); r(460, 268, 140, 20, '#0a0818'); x.fillStyle = P.amber; x.font = 'bold 8px monospace'; x.textAlign = 'center'; x.fillText('847 CONNECTED', 530, 282); r(610, 268, 140, 20, '#0a0818'); x.fillStyle = P.pink; x.fillText('1.2M EVENTS/HR', 680, 282); this.drawDoor(x, W, FY + 50, nc, H); }

  private drawFeed(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void { const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); }; const FY = 300; r(0, 0, W, H, '#0c0820'); r(0, FY, W, H - FY, '#120a2c'); r(0, FY, W, 2, nc); r(28, 46, W - 56, 246, '#040208'); r(30, 48, W - 60, 242, '#060412'); r(34, 52, W - 68, 234, '#080616'); x.strokeStyle = nc; x.globalAlpha = 0.25; x.strokeRect(30, 48, W - 60, 242); x.globalAlpha = 1; x.strokeStyle = nc; x.globalAlpha = 0.08; x.strokeRect(34, 52, W - 68, 234); x.globalAlpha = 1; r(40, 54, W - 80, 22, '#0a0818'); x.fillStyle = nc; x.font = 'bold 11px monospace'; x.textAlign = 'center'; x.fillText('24/7 STREAM NOTES', W / 2, 70); r(40, 78, W - 80, 1, nc); x.globalAlpha = 0.2; r(40, 78, W - 80, 1, nc); x.globalAlpha = 1; x.fillStyle = P.red; x.globalAlpha = 0.5; x.beginPath(); x.arc(60, 64, 3, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1; x.fillStyle = P.red; x.font = 'bold 7px monospace'; x.textAlign = 'left'; x.globalAlpha = 0.6; x.fillText('LIVE', 66, 67); x.globalAlpha = 1; x.fillStyle = P.teal; x.globalAlpha = 0.4; x.font = 'bold 7px monospace'; x.textAlign = 'right'; x.fillText('GLOBAL NOSTR', W - 56, 67); x.globalAlpha = 1; for (let i = 0; i < 9; i++) { const ey = 84 + i * 22; r(44, ey, W - 88, 18, i % 2 === 0 ? '#0a0818' : '#0c0a20'); } x.fillStyle = nc; x.globalAlpha = 0.025; r(20, FY, W - 40, 35, nc); x.globalAlpha = 1; this.drawDoor(x, W, FY + 50, nc, H); }

  private drawMarket(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void { const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); }; const FY = 300; r(0, 0, W, H, '#120828'); r(0, FY, W, H - FY, '#1a0c38'); r(0, FY, W, 2, nc); for (let fy = FY + 4; fy < H; fy += 14) { for (let fx = 0; fx < W; fx += 14) { const dark = ((fx / 14 + fy / 14) % 2) < 1; x.globalAlpha = dark ? 0.08 : 0.03; r(fx, fy, 14, 14, '#3a2878'); x.globalAlpha = 1; } } const labels = ['AVATARS', 'FURNITURE', 'EFFECTS', 'THEMES']; for (let shelf = 0; shelf < 4; shelf++) { const sx = 30 + shelf * 190; r(sx, 30, 170, 260, '#0a0818'); r(sx + 2, 32, 166, 256, '#0e0828'); x.strokeStyle = nc; x.globalAlpha = 0.12; x.strokeRect(sx, 30, 170, 260); x.globalAlpha = 1; x.fillStyle = nc; x.font = 'bold 8px monospace'; x.textAlign = 'center'; x.globalAlpha = 0.55; x.fillText(labels[shelf], sx + 85, 46); x.globalAlpha = 1; for (let row = 0; row < 4; row++) { const ry = 55 + row * 56; r(sx + 6, ry + 42, 158, 3, '#3a2878'); for (let item = 0; item < 5; item++) { const ix = sx + 12 + item * 32; const c = [P.pink, P.teal, P.amber, P.purp, P.red, P.sign2][Math.floor(Math.random() * 6)]; x.fillStyle = c; x.globalAlpha = 0.18 + Math.random() * 0.22; const iw = 14 + Math.random() * 8; const ih = 16 + Math.random() * 20; x.fillRect(ix, ry + 42 - ih, iw, ih); x.globalAlpha = 1; } x.fillStyle = P.amber; x.globalAlpha = 0.4; x.font = 'bold 6px monospace'; x.textAlign = 'right'; x.fillText(`\u26A1 ${Math.floor(Math.random() * 500 + 21)}`, sx + 162, ry + 52); x.globalAlpha = 1; } } r(W / 2 - 110, FY - 20, 220, 18, '#0a0818'); x.strokeStyle = nc; x.globalAlpha = 0.2; x.strokeRect(W / 2 - 110, FY - 20, 220, 18); x.globalAlpha = 1; x.fillStyle = nc; x.font = 'bold 9px monospace'; x.textAlign = 'center'; x.fillText('\u26A1 ZAP TO UNLOCK ITEMS', W / 2, FY - 8); this.drawDoor(x, W, FY + 50, nc, H); }

  private drawDefault(x: CanvasRenderingContext2D, W: number, H: number, nc: string): void { const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); }; const FY = 300; r(0, 0, W, H, '#120828'); r(0, FY, W, H - FY, '#1a0a3e'); r(0, FY, W, 2, nc); r(0, 0, W, 3, nc); x.globalAlpha = 0.15; r(0, 0, W, 3, nc); x.globalAlpha = 1; this.drawDoor(x, W, FY + 50, nc, H); }
}
