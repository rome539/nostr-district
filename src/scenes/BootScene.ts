import Phaser from 'phaser';
import { WORLD_WIDTH, GAME_HEIGHT, GROUND_Y, P } from '../config/game.config';
import { getAvatar } from '../stores/avatarStore';
import { renderHubSprite, renderRoomSprite } from '../entities/AvatarRenderer';
import { initFeedService } from '../nostr/feedService';
import { captureThumb } from '../stores/sceneThumbs';
import { WoodsScene } from './WoodsScene';
import { AlleyScene } from './AlleyScene';
import { CabinScene } from './CabinScene';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    this.renderDistrictBackground();
    this.renderParallaxLayer();
    this.generatePlayerSprite();
    this.generateRoomPlayerSprite();
    this.generateNeonSignFrames();
    initFeedService();
    this.scene.start('HubScene');
  }

  // ================================================================
  // PARALLAX — far skyline layer that scrolls slower
  // ================================================================
  private renderParallaxLayer(): void {
    const W = WORLD_WIDTH;
    const H = GAME_HEIGHT;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const x = canvas.getContext('2d')!;
    x.imageSmoothingEnabled = false;
    x.clearRect(0, 0, W, H);

    const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); };

    let bx = -30;
    while (bx < W + 30) {
      const bw = 18 + Math.random() * 70;
      const bh = 55 + Math.random() * 185;
      const by = GROUND_Y - bh;
      const shade = ['#06040e', '#08061a', '#0a0820', '#050312', '#070518'][Math.floor(Math.random() * 5)];

      // Main body
      r(bx, by, bw, bh + 10, shade);

      // Stepped setback on ~half buildings
      if (Math.random() > 0.45 && bw > 24) {
        const sw = 4 + Math.random() * 12;
        const sh = 18 + Math.random() * 50;
        r(bx + sw, by - sh, bw - sw * 2, sh, shade);
        // Second setback (narrower towers)
        if (Math.random() > 0.55 && bw > 42) {
          r(bx + sw * 2, by - sh - 10 - Math.random() * 25, bw - sw * 4, 10 + Math.random() * 25, shade);
        }
      }

      // Roof parapet edge
      x.fillStyle = '#0e0a20';
      x.globalAlpha = 0.5;
      x.fillRect(bx, by, bw, 2);
      x.globalAlpha = 1;

      // Antenna / spire on some buildings
      if (Math.random() > 0.45) {
        const ah = 12 + Math.random() * 55;
        r(Math.floor(bx + bw / 2), by - ah, 1, ah, '#040210');
        // Tip light
        x.fillStyle = [P.red, '#ff5050', P.amber, P.teal][Math.floor(Math.random() * 4)];
        x.globalAlpha = 0.18 + Math.random() * 0.22;
        x.fillRect(Math.floor(bx + bw / 2) - 0.5, by - ah - 1, 2, 2);
        x.globalAlpha = 1;
      }

      // Windows — slightly hazy at this distance but readable
      const ws = 4 + Math.random() * 3;
      for (let wy = by + 6; wy + 4 < GROUND_Y - 10; wy += ws) {
        for (let wx = bx + 3; wx + 4 < bx + bw - 3; wx += ws) {
          if (Math.random() > 0.55) {
            const wc = [P.pink, P.purp, P.amber, P.teal, P.lcream, P.sign2][Math.floor(Math.random() * 6)];
            x.fillStyle = wc;
            x.globalAlpha = 0.07 + Math.random() * 0.1;
            x.fillRect(wx, wy, 3, 3);
            x.globalAlpha = 0.03;
            x.fillRect(wx - 1, wy - 1, 5, 5);
            x.globalAlpha = 1;
          } else {
            x.fillStyle = '#03010e';
            x.fillRect(wx, wy, 3, 3);
          }
        }
      }

      bx += bw + 2 + Math.random() * 18;
    }

    // Atmospheric horizon haze
    const hg = x.createLinearGradient(0, GROUND_Y - 90, 0, GROUND_Y);
    hg.addColorStop(0, 'rgba(0,0,0,0)');
    hg.addColorStop(1, 'rgba(18,8,52,0.15)');
    x.fillStyle = hg;
    x.fillRect(0, GROUND_Y - 90, W, 90);

    this.textures.addCanvas('parallax_bg', canvas);
  }

  // ================================================================
  // MAIN DISTRICT BACKGROUND
  // ================================================================
  private renderDistrictBackground(): void {
    const W = WORLD_WIDTH;
    const H = GAME_HEIGHT;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const x = canvas.getContext('2d')!;
    x.imageSmoothingEnabled = false;

    const rect = (ax: number, ay: number, aw: number, ah: number, col: string) => {
      x.fillStyle = col; x.fillRect(ax, ay, aw, ah);
    };

    const dither = (ax: number, ay: number, aw: number, ah: number, c1: string, c2: string, density = 0.5) => {
      rect(ax, ay, aw, ah, c1);
      x.fillStyle = c2;
      for (let py = ay; py < ay + ah; py += 2) {
        for (let px = ax + ((py / 2) % 2); px < ax + aw; px += 2) {
          if (Math.random() < density) x.fillRect(px, py, 1, 1);
        }
      }
    };

    const vGrad = (ax: number, ay: number, aw: number, ah: number, colors: string[]) => {
      const bandH = Math.ceil(ah / colors.length);
      colors.forEach((c, i) => rect(ax, ay + i * bandH, aw, bandH, c));
    };

    // ═══════════════════════════════════════════════
    // SKY — deeper gradient with subtle color banding
    // ═══════════════════════════════════════════════
    vGrad(0, 0, W, 230, [
      '#010008', '#010008', '#020010', '#040016', '#06001e', '#080024', '#0a002a',
      '#0c0030', '#0e0036', '#0d002e', '#0b0024', '#090020',
    ]);

    // Stars — more variety, twinkle hints
    for (let i = 0; i < 220; i++) {
      const sc = ['#fad480', '#e87aab', '#7b68ee', '#5dcaa5', '#ffffff', '#ffffff', '#ffffff'][Math.floor(Math.random() * 7)];
      x.fillStyle = sc;
      x.globalAlpha = 0.15 + Math.random() * 0.7;
      const sz = Math.random() > 0.88 ? 2 : 1;
      x.fillRect(Math.random() * W, Math.random() * 180, sz, sz);
    }
    // A few larger "bright" stars with cross flare
    for (let i = 0; i < 10; i++) {
      const sx = Math.random() * W;
      const sy = 10 + Math.random() * 130;
      x.fillStyle = '#fff';
      x.globalAlpha = 0.4 + Math.random() * 0.3;
      x.fillRect(sx, sy, 2, 2);
      x.globalAlpha = 0.1;
      x.fillRect(sx - 2, sy, 6, 1);
      x.fillRect(sx, sy - 2, 1, 6);
    }
    x.globalAlpha = 1;

    // Faint aurora / sky glow near horizon
    x.globalAlpha = 0.015;
    rect(0, 100, W, 60, P.purp);
    x.globalAlpha = 0.01;
    rect(0, 120, W, 40, P.pink);
    x.globalAlpha = 1;

    // ── Window drawing helper ──
    const drawWindow = (wx: number, wy: number, ww: number, wh: number, lit: boolean, color: string) => {
      if (!lit) {
        x.fillStyle = '#04020e'; x.fillRect(wx, wy, ww, wh);
        return;
      }
      // ~20% of windows are brighter (some rooms have overhead lights on)
      const bright = Math.random() > 0.8;
      const alpha = bright ? 0.24 + Math.random() * 0.12 : 0.12 + Math.random() * 0.12;
      x.fillStyle = color;
      // 1px glow bleed
      x.globalAlpha = alpha * 0.3;
      x.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
      // Core pane
      x.globalAlpha = alpha;
      x.fillRect(wx, wy, ww, wh);
      // Top-edge highlight (ceiling light on glass)
      x.globalAlpha = alpha * 0.5;
      x.fillRect(wx, wy, ww, 2);
      x.globalAlpha = 1;
    };

    // ── Rooftop details helpers ──
    const drawWaterTank = (tx: number, ty: number, tw: number) => {
      // Legs
      x.fillStyle = '#1a1240';
      x.fillRect(tx + 1, ty + 5, 2, 8); x.fillRect(tx + tw - 3, ty + 5, 2, 8);
      // Body
      x.fillStyle = '#0d091e'; x.fillRect(tx, ty, tw, 6);
      x.fillStyle = '#1a1440'; x.fillRect(tx + 1, ty + 1, tw - 2, 4);
      // Cap
      x.fillStyle = '#2a1858'; x.fillRect(tx - 1, ty - 2, tw + 2, 3);
    };
    const drawACUnit = (ax: number, ay: number) => {
      x.fillStyle = '#0d091e'; x.fillRect(ax, ay, 14, 8);
      x.fillStyle = '#1a1440'; x.fillRect(ax + 1, ay + 1, 12, 6);
      x.fillStyle = '#0a0818';
      for (let v = 0; v < 5; v++) x.fillRect(ax + 2 + v * 2, ay + 2, 1, 4);
      x.fillStyle = P.teal; x.globalAlpha = 0.25;
      x.fillRect(ax + 1, ay, 12, 1);
      x.globalAlpha = 1;
    };
    const drawFireEscape = (fx: number, fy: number, floors: number) => {
      x.fillStyle = '#2a1858'; x.globalAlpha = 0.45;
      for (let f = 0; f < floors; f++) {
        const ey = fy + f * 20;
        x.fillRect(fx, ey, 10, 2); // platform
        if (f < floors - 1) x.fillRect(fx + 8, ey + 2, 2, 18); // stair segment
      }
      x.globalAlpha = 1;
    };

    // ═══════════════════════════════════════════════
    // MID-LAYER BUILDINGS — denser, more varied
    // ═══════════════════════════════════════════════
    const midBuildings = [];
    for (let bx = -20; bx < W + 20; bx += 28 + Math.random() * 32) {
      midBuildings.push({
        x: bx,
        w: 22 + Math.random() * 58,
        h: 75 + Math.random() * 210,
        col: ['#0a0618', '#0c0820', '#0e0a24', '#080516', '#100828'][Math.floor(Math.random() * 5)],
      });
    }

    midBuildings.forEach(b => {
      const by = GROUND_Y - b.h;
      rect(b.x, by, b.w, b.h, b.col);
      // Roof parapet
      rect(b.x, by, b.w, 3, '#1a1240');
      rect(b.x, by + 3, b.w, 1, '#0e0828');
      // Edge highlights
      rect(b.x, by, 2, b.h, '#1a1240');
      rect(b.x + b.w - 2, by, 2, b.h, '#04020a');

      // Floor separator lines (every ~16px)
      x.fillStyle = '#06040f'; x.globalAlpha = 0.6;
      for (let fl = by + 16; fl < GROUND_Y - 10; fl += 16) x.fillRect(b.x, fl, b.w, 1);
      x.globalAlpha = 1;

      // Antenna / roof structure
      if (Math.random() > 0.55) {
        const aw = 1 + Math.floor(Math.random() * 2);
        const ah = 10 + Math.floor(Math.random() * 28);
        rect(b.x + b.w / 2 - 1, by - ah, aw, ah, '#080516');
        const lc = [P.red, P.teal, P.amber][Math.floor(Math.random() * 3)];
        x.fillStyle = lc; x.globalAlpha = 0.35 + Math.random() * 0.3;
        x.fillRect(b.x + b.w / 2 - 1, by - ah - 1, 2, 2);
        x.globalAlpha = 1;
      }

      // Small water tank on rooftop for some buildings
      if (Math.random() > 0.65 && b.w > 30) {
        drawWaterTank(b.x + b.w * 0.6, by - 12, 10);
      }

      // Windows locked to 16px floor grid — every floor gets a row
      const floorH = 16;
      const winW = 5 + Math.floor(Math.random() * 3); // consistent per building
      const winH = 8;
      const gapX = winW + 4 + Math.floor(Math.random() * 3);
      for (let fl = by + 8; fl + winH + 2 < GROUND_Y - 16; fl += floorH) {
        for (let wx = b.x + 5; wx + winW + 2 < b.x + b.w - 5; wx += gapX) {
          const lit = Math.random() > 0.42;
          const wc = [P.pink, P.purp, P.amber, P.teal, P.lcream][Math.floor(Math.random() * 5)];
          drawWindow(wx, fl + 3, winW, winH, lit, wc);
        }
      }
    });

    // ═══════════════════════════════════════════════
    // FOREGROUND BUILDINGS — the street-level storefronts
    // ═══════════════════════════════════════════════
    const fgBuildings = [
      { x: -20, w: 140, h: 220, col: P.bldg2, name: '', neon: '' },
      { x: 100, w: 160, h: 200, col: P.bldg4, name: 'RELAY', neon: P.sign1 },
      { x: 300, w: 60, h: 240, col: P.bldg1, name: '', neon: '' },
      { x: 380, w: 200, h: 230, col: P.bldg4, name: 'THE FEED', neon: P.pink },
      { x: 600, w: 50, h: 250, col: P.bldg3, name: '', neon: '' },
      { x: 660, w: 160, h: 190, col: P.bldg1, name: 'MY ROOM', neon: P.teal },
      { x: 840, w: 60, h: 260, col: P.bldg2, name: '', neon: '' },
      { x: 910, w: 140, h: 210, col: P.bldg3, name: 'LOUNGE', neon: P.pink },
      { x: 1070, w: 50, h: 230, col: P.bldg1, name: '', neon: '' },
      { x: 1130, w: 170, h: 220, col: P.bldg4, name: 'MARKET', neon: P.amber },
      { x: 1320, w: 70, h: 270, col: P.bldg3, name: '', neon: '' },
      { x: 1400, w: 50, h: 240, col: P.bldg2, name: '', neon: '' },
      { x: 1460, w: 140, h: 200, col: P.bldg1, name: '', neon: '' },
    ];

    // PASS 1: Draw all building structures (walls, windows, doors, rooftop details)
    fgBuildings.forEach((b, bi) => {
      const by = GROUND_Y - b.h;

      // Main structure with dithered texture
      dither(b.x, by, b.w, b.h, b.col, '#0a0818', 0.12);

      // Edge details — subtle 3D
      rect(b.x, by, 3, b.h, '#2a1858');
      rect(b.x + b.w - 3, by, 3, b.h, '#060412');
      rect(b.x, by, b.w, 4, '#2a1858');
      rect(b.x, GROUND_Y - 4, b.w, 4, '#2a1858');

      // Roof parapet — top 4px slightly lighter
      rect(b.x - 2, by - 2, b.w + 4, 5, '#1a1040');
      rect(b.x, by, b.w, 2, '#261850');

      // groundFloorY: where windows + floor lines stop
      const groundFloorY = b.name ? GROUND_Y - 46 : GROUND_Y - 30;

      // Floor separator lines — match the 20px grid windows snap to
      x.fillStyle = '#060410'; x.globalAlpha = 0.55;
      for (let fl = by + 20; fl < groundFloorY + 4; fl += 20) x.fillRect(b.x + 3, fl, b.w - 6, 1);
      x.globalAlpha = 1;

      // Windows locked to 20px floor grid — every floor gets a row, no gaps
      const floorH = 20;
      const winW = 8 + Math.floor(Math.random() * 4);
      const winH = 11;
      const gapX = winW + 6 + Math.floor(Math.random() * 3);
      for (let fl = by + 20; fl + winH + 2 < groundFloorY; fl += floorH) {
        for (let wx = b.x + 8; wx + winW + 2 < b.x + b.w - 8; wx += gapX) {
          const lit = Math.random() > 0.32;
          const wc = [P.pink, P.purp, P.amber, P.teal, P.lcream, P.sign2][Math.floor(Math.random() * 6)];
          drawWindow(wx, fl + 4, winW, winH, lit, wc);
        }
      }


      // Ground-floor panel — solid band from mid-building base to ground
      const gfY = GROUND_Y - 40;
      rect(b.x, gfY, b.w, 40, '#060412');
      x.fillStyle = b.neon || P.lcream; x.globalAlpha = 0.05;
      x.fillRect(b.x, gfY, b.w, 40);
      // Top edge line
      x.fillStyle = '#2a1858'; x.globalAlpha = 0.8;
      x.fillRect(b.x, gfY, b.w, 1);
      x.globalAlpha = 1;

      // ── Rooftop details (unique per building index) ──
      const ri = bi % 5;
      if (ri === 0 || ri === 3) {
        // Water tank
        drawWaterTank(b.x + b.w * 0.7, by - 15, 14);
      }
      if (ri === 1 || ri === 4) {
        // AC cluster on roof edge
        drawACUnit(b.x + 6, by - 8);
        if (b.w > 60) drawACUnit(b.x + 26, by - 8);
      }
      if (ri === 2) {
        // Rooftop antenna cluster
        for (let ai = 0; ai < 3; ai++) {
          const ah = 12 + ai * 8;
          rect(b.x + b.w * 0.4 + ai * 7, by - ah, 1, ah, '#080516');
        }
      }
      // Chimney only on unnamed buildings (bi 0, 2, 12) — animated smoke in HubScene
      if (!b.name && ri % 2 === 0 && b.w > 50) {
        const chX = b.x + b.w * 0.3;
        rect(chX, by - 16, 7, 16, '#0a0818');
        rect(chX - 1, by - 18, 9, 3, '#1a1240');
      }
      // AC units on building face (upper floors)
      if (b.w > 70 && Math.random() > 0.4) {
        const acY = by + 20 + Math.random() * (b.h * 0.4);
        drawACUnit(b.x + b.w - 18, acY);
      }

      // Fire escape on some buildings
      if (bi % 4 === 1 && b.h > 140) {
        drawFireEscape(b.x + b.w - 14, by + 30, Math.floor((b.h - 40) / 20));
      }

      // Door (for named buildings)
      if (b.name && b.neon) {
        const doorW = 22;
        const doorH = 32;
        const doorX = b.x + b.w / 2 - doorW / 2;
        rect(doorX - 4, GROUND_Y - doorH - 8, doorW + 8, doorH + 5, '#1a1040');
        rect(doorX, GROUND_Y - doorH - 4, doorW, doorH, '#0a0818');
        rect(doorX + 3, GROUND_Y - doorH, doorW - 6, doorH / 2 - 3, '#0e0828');
        rect(doorX + 3, GROUND_Y - doorH / 2, doorW - 6, doorH / 2 - 6, '#0e0828');
        // Door handle
        x.fillStyle = b.neon; x.globalAlpha = 0.5;
        x.fillRect(doorX + doorW - 6, GROUND_Y - doorH / 2 - 2, 3, 5);
        x.globalAlpha = 1;
        // Door frame glow
        x.strokeStyle = b.neon; x.lineWidth = 1; x.globalAlpha = 0.4;
        x.strokeRect(doorX - 1, GROUND_Y - doorH - 5, doorW + 2, doorH + 2);
        x.globalAlpha = 1;
        // Neon floor spill
        x.fillStyle = b.neon; x.globalAlpha = 0.06;
        x.fillRect(doorX - 20, GROUND_Y, doorW + 40, 14);
        x.globalAlpha = 0.03;
        x.fillRect(doorX - 35, GROUND_Y + 14, doorW + 70, 10);
        x.globalAlpha = 1;
      }
    });


    // ═══════════════════════════════════════════════
    // HANGING SIGNS — drawn before building name signs so they don't overlap
    // ═══════════════════════════════════════════════
    const hangingSigns = [
      { x: 50, y: 140, w: 36, h: 50, col: P.red, text: 'LIVE', vertical: false },
      { x: 85, y: 160, w: 20, h: 70, col: P.purp, text: '2F', vertical: true },
      { x: 265, y: 130, w: 50, h: 20, col: P.teal, text: 'ONLINE', vertical: false },
      { x: 310, y: 100, w: 18, h: 80, col: P.pink, text: 'ARCADE', vertical: true },
      { x: 360, y: 140, w: 40, h: 18, col: P.gold, text: 'SATS', vertical: false },
      { x: 620, y: 150, w: 44, h: 18, col: P.amber, text: 'COFFEE', vertical: false },
      { x: 760, y: 108, w: 16, h: 55, col: P.cyan, text: 'OPEN', vertical: true },
      { x: 830, y: 110, w: 16, h: 70, col: P.teal, text: 'DMs', vertical: true },
      { x: 980, y: 125, w: 42, h: 18, col: P.hotpink, text: 'VINYL', vertical: false },
      { x: 1060, y: 130, w: 40, h: 18, col: P.sign1, text: 'SHOP', vertical: false },
      { x: 1310, y: 120, w: 16, h: 60, col: P.purp, text: 'EXIT', vertical: true },
      { x: 1440, y: 140, w: 36, h: 18, col: P.red, text: 'GAME', vertical: false },
      { x: 1520, y: 115, w: 18, h: 70, col: P.amber, text: 'RAMEN', vertical: true },
    ];

    hangingSigns.forEach(s => {
      rect(s.x, s.y, s.w, s.h, '#0a0818');
      rect(s.x + 1, s.y + 1, s.w - 2, s.h - 2, s.col);
      x.globalAlpha = 0.7;
      rect(s.x + 2, s.y + 2, s.w - 4, s.h - 4, '#0a0818');
      x.globalAlpha = 1;

      x.fillStyle = s.col;
      x.globalAlpha = 0.9;
      if (s.vertical) {
        x.save();
        x.translate(s.x + s.w / 2 + 1, s.y + s.h / 2);
        x.rotate(-Math.PI / 2);
        x.font = `bold ${Math.min(s.w - 4, 10)}px monospace`;
        x.textAlign = 'center';
        x.fillText(s.text, 0, 4);
        x.restore();
      } else {
        x.font = `bold ${Math.min(s.h - 6, 11)}px monospace`;
        x.textAlign = 'center';
        x.fillText(s.text, s.x + s.w / 2, s.y + s.h / 2 + 4);
      }
      x.globalAlpha = 1;

      x.fillStyle = s.col;
      x.globalAlpha = 0.025;
      x.fillRect(s.x - 8, s.y + s.h, s.w + 16, 25);
      x.globalAlpha = 1;
      rect(s.x + s.w / 2 - 1, s.y - 8, 2, 8, '#3a2878');
    });

    // Small accent signs
    const accentSigns = [
      { x: 700, y: 200, w: 68, h: 16, col: P.amber, text: '\u26A1 ZAP SHOP' },
      { x: 1175, y: 175, w: 72, h: 16, col: P.pink, text: 'TRENDING' },
    ];
    accentSigns.forEach(s => {
      rect(s.x, s.y, s.w, s.h, '#0a0818');
      x.strokeStyle = s.col; x.lineWidth = 1; x.globalAlpha = 0.25;
      x.strokeRect(s.x, s.y, s.w, s.h); x.globalAlpha = 1;
      x.fillStyle = s.col; x.globalAlpha = 0.7;
      x.font = 'bold 8px monospace'; x.textAlign = 'center';
      x.fillText(s.text, s.x + s.w / 2, s.y + s.h - 4);
      x.globalAlpha = 1;
    });

    // Billboards on poles
    const drawBillboard = (bx: number, by: number, bw: number, bh: number, color: string, title: string, subtitle: string) => {
      const poleX = bx + bw / 2;
      rect(poleX - 2, by + bh, 4, GROUND_Y - by - bh, '#2a1858');
      rect(poleX - 1, by + bh, 2, GROUND_Y - by - bh, '#3a2878');
      rect(bx + 4, by + bh - 2, bw - 8, 3, '#3a2878');
      rect(bx - 2, by - 2, bw + 4, bh + 4, '#0a0818');
      x.strokeStyle = color; x.lineWidth = 2; x.globalAlpha = 0.45;
      x.strokeRect(bx - 1, by - 1, bw + 2, bh + 2); x.globalAlpha = 1;
      rect(bx, by, bw, bh, '#0c0a1e');
      rect(bx + 2, by + 2, bw - 4, bh - 4, '#0e0828');
      x.strokeStyle = color; x.lineWidth = 1; x.globalAlpha = 0.2;
      x.strokeRect(bx + 4, by + 4, bw - 8, bh - 8); x.globalAlpha = 1;
      x.fillStyle = color; x.globalAlpha = 0.75;
      x.font = `bold ${Math.min(Math.floor(bw / 5), 14)}px monospace`;
      x.textAlign = 'center';
      x.fillText(title, bx + bw / 2, by + bh * 0.42); x.globalAlpha = 1;
      if (subtitle) {
        x.fillStyle = P.lcream; x.globalAlpha = 0.35;
        x.font = `${Math.min(Math.floor(bw / 8), 8)}px monospace`;
        x.fillText(subtitle, bx + bw / 2, by + bh * 0.65); x.globalAlpha = 1;
      }
      x.fillStyle = color; x.globalAlpha = 0.3;
      x.fillRect(bx + 6, by + 6, 3, 3); x.fillRect(bx + bw - 9, by + 6, 3, 3);
      x.fillRect(bx + 6, by + bh - 9, 3, 3); x.fillRect(bx + bw - 9, by + bh - 9, 3, 3);
      x.globalAlpha = 1;
    };

    drawBillboard(268, 165, 56, 48, P.purp, 'CYBER', 'district hub');
    drawBillboard(842, 158, 50, 42, P.pink, '\u26A1 ZAP', 'stack sats');
    drawBillboard(1342, 162, 52, 45, P.teal, 'SIGNAL', 'stay connected');

    // PASS 2 (LAST): Draw building name signs on top of everything
    fgBuildings.forEach(b => {
      if (!b.name || !b.neon) return;
      const by = GROUND_Y - b.h;
      const signW = b.name.length * 16 + 40;
      const signX = b.x + (b.w - signW) / 2;
      const signY = by + 8;

      rect(signX - 2, signY - 2, signW + 4, 36, b.neon);
      x.globalAlpha = 0.15;
      rect(signX - 2, signY - 2, signW + 4, 36, b.neon);
      x.globalAlpha = 1;
      rect(signX, signY, signW, 32, '#0a0818');
      rect(signX + 3, signY + 3, signW - 6, 26, '#0e0828');

      x.strokeStyle = b.neon;
      x.lineWidth = 1;
      x.globalAlpha = 0.6;
      x.strokeRect(signX + 2, signY + 2, signW - 4, 28);
      x.globalAlpha = 1;

      x.fillStyle = b.neon;
      x.font = 'bold 16px monospace';
      x.textAlign = 'center';
      x.fillText(b.name, b.x + b.w / 2, signY + 23);

      x.fillStyle = b.neon;
      x.globalAlpha = 0.04;
      x.fillRect(signX - 10, signY + 32, signW + 20, 25);
      x.globalAlpha = 0.02;
      x.fillRect(signX - 20, signY + 32, signW + 40, 50);
      x.globalAlpha = 1;
    });

    // ═══════════════════════════════════════════════
    // STREET LAMPS — with colored glow pools
    // ═══════════════════════════════════════════════
    const lampPositions = [95, 240, 370, 560, 650, 830, 1010, 1120, 1280, 1430, 1550];
    lampPositions.forEach(lx => {
      rect(lx, 270, 3, 70, '#3a2878');
      rect(lx - 4, 266, 11, 6, P.dpurp);
      rect(lx - 2, 264, 7, 4, P.amber);

      // Multi-ring glow
      x.fillStyle = P.amber;
      for (let r = 1; r < 6; r++) {
        x.globalAlpha = 0.025 / r;
        x.beginPath(); x.arc(lx + 1, 272, r * 8, 0, Math.PI * 2); x.fill();
      }
      // Ground pool of light
      x.globalAlpha = 0.025;
      x.fillRect(lx - 16, GROUND_Y, 36, 18);
      x.globalAlpha = 1;
    });

    // ═══════════════════════════════════════════════
    // WIRES / CABLES between buildings
    // ═══════════════════════════════════════════════
    x.strokeStyle = '#2a1858';
    x.lineWidth = 1;
    x.globalAlpha = 0.4;
    const wireAnchors = [80, 260, 450, 640, 820, 1000, 1180, 1360, 1540];
    for (let i = 0; i < wireAnchors.length - 1; i++) {
      const ax = wireAnchors[i];
      const bx2 = wireAnchors[i + 1];
      const sag = 8 + Math.random() * 12;
      x.beginPath();
      x.moveTo(ax, 130 + Math.random() * 20);
      const mid = (ax + bx2) / 2;
      x.quadraticCurveTo(mid, 130 + sag, bx2, 130 + Math.random() * 20);
      x.stroke();
    }
    x.globalAlpha = 1;

    // ── Neon sign ground reflections (under each named building sign) ──
    fgBuildings.forEach(b => {
      if (!b.neon) return;
      x.fillStyle = b.neon;
      x.globalAlpha = 0.05;
      x.fillRect(b.x - 10, GROUND_Y, b.w + 20, 20);
      x.globalAlpha = 0.025;
      x.fillRect(b.x - 20, GROUND_Y + 20, b.w + 40, 16);
      x.globalAlpha = 1;
    });

    // ═══════════════════════════════════════════════
    // GROUND
    // ═══════════════════════════════════════════════
    rect(0, GROUND_Y, W, H - GROUND_Y, P.ground);
    // Sidewalk surface — slightly lighter stripe
    rect(0, GROUND_Y, W, 3, P.sidewalk);
    rect(0, GROUND_Y + 5, W, 1, '#4a2878');

    // Sidewalk tile joints (vertical lines at intervals)
    x.fillStyle = '#3a1868'; x.globalAlpha = 0.3;
    for (let tx = 0; tx < W; tx += 40) x.fillRect(tx, GROUND_Y, 1, 22);
    x.globalAlpha = 0.15;
    for (let tx = 20; tx < W; tx += 40) x.fillRect(tx, GROUND_Y, 1, 22);
    x.globalAlpha = 1;

    // Manhole / grate accents
    const manholes = [180, 450, 720, 990, 1260];
    manholes.forEach(mx => {
      x.fillStyle = '#1a0e38'; x.fillRect(mx, GROUND_Y + 8, 16, 10);
      x.fillStyle = '#2a1858'; x.globalAlpha = 0.6;
      for (let g = 0; g < 5; g++) x.fillRect(mx + 2, GROUND_Y + 9 + g * 2, 12, 1);
      x.globalAlpha = 1;
    });

    // Dithered ground texture
    for (let py = GROUND_Y + 8; py < H; py += 2) {
      for (let px = 0; px < W; px += 2) {
        if (Math.random() < 0.055) {
          x.fillStyle = '#3a2068'; x.fillRect(px, py, 1, 1);
        }
      }
    }

    // Perspective ground lines (receding into distance)
    for (let i = 0; i < W; i += 18) rect(i, GROUND_Y + 22, 8, 1, '#3a2068');
    for (let i = 0; i < W; i += 25) rect(i, GROUND_Y + 42, 12, 1, '#2a1858');
    for (let i = 0; i < W; i += 35) rect(i, GROUND_Y + 62, 16, 1, '#221850');
    for (let i = 0; i < W; i += 50) rect(i, GROUND_Y + 82, 20, 1, '#1a1040');

    // ═══════════════════════════════════════════════
    // STREET PROPS — payphones, dumpsters, vents
    // ═══════════════════════════════════════════════

    // Payphone booth
    const drawPayphone = (px: number) => {
      rect(px, GROUND_Y - 26, 10, 26, '#0a0818');
      rect(px + 1, GROUND_Y - 25, 8, 24, '#0e0828');
      // Glass panel
      x.fillStyle = P.teal; x.globalAlpha = 0.12;
      x.fillRect(px + 1, GROUND_Y - 20, 8, 12);
      // Top stripe
      x.fillStyle = P.teal; x.globalAlpha = 0.5;
      x.fillRect(px + 1, GROUND_Y - 25, 8, 2);
      // Handset
      x.fillStyle = '#1a1040'; x.globalAlpha = 1;
      x.fillRect(px + 3, GROUND_Y - 17, 4, 7);
      x.fillStyle = '#2a1858'; x.globalAlpha = 0.8;
      x.fillRect(px + 3, GROUND_Y - 17, 4, 1);
      x.fillRect(px + 3, GROUND_Y - 11, 4, 1);
      x.globalAlpha = 1;
    };

    // Dumpster
    const drawDumpster = (px: number, col: string) => {
      rect(px, GROUND_Y - 16, 26, 16, '#0a0818');
      rect(px + 1, GROUND_Y - 15, 24, 14, '#0e0828');
      // Colour tint
      x.fillStyle = col; x.globalAlpha = 0.12;
      x.fillRect(px + 1, GROUND_Y - 15, 24, 14);
      // Lid
      x.fillStyle = '#1a1240'; x.globalAlpha = 1;
      x.fillRect(px - 1, GROUND_Y - 18, 28, 4);
      x.fillStyle = '#2a1858'; x.globalAlpha = 0.6;
      x.fillRect(px - 1, GROUND_Y - 18, 28, 1);
      // Horizontal ribs
      x.fillStyle = '#060410'; x.globalAlpha = 0.5;
      x.fillRect(px + 1, GROUND_Y - 10, 24, 1);
      x.fillRect(px + 1, GROUND_Y - 6, 24, 1);
      x.globalAlpha = 1;
    };

    // Vent steam on sidewalk
    const drawVent = (px: number) => {
      rect(px, GROUND_Y - 2, 10, 2, '#1a1040');
      for (let v = 0; v < 3; v++) x.fillRect(px + 2 + v * 3, GROUND_Y - 2, 1, 2);
      x.fillStyle = '#aaaacc';
      x.globalAlpha = 0.1; x.fillRect(px + 1, GROUND_Y - 10, 8, 8);
      x.globalAlpha = 0.05; x.fillRect(px, GROUND_Y - 18, 10, 10);
      x.globalAlpha = 1;
    };

    // Scatter props along the street — avoid named-building door centers:
    // RELAY door ~180, THE FEED ~480, MY ROOM ~740, LOUNGE ~980, MARKET ~1215
    [[72, 'phone'], [225, 'dump'], [265, 'vent'], [340, 'phone'],
     [410, 'dump'], [560, 'vent'], [680, 'dump'], [800, 'phone'],
     [870, 'vent'], [1055, 'dump'], [1085, 'phone'], [1150, 'vent'],
     [1240, 'dump'], [1350, 'phone'], [1460, 'vent'], [1525, 'dump'],
    ].forEach(([px, type]) => {
      if (type === 'phone') drawPayphone(px as number);
      else if (type === 'dump') drawDumpster(px as number, [P.amber, P.teal, P.red, P.purp][Math.floor(Math.random() * 4)]);
      else drawVent(px as number);
    });

    // ═══════════════════════════════════════════════
    // NPC CROWD — denser, more depth variety
    // ═══════════════════════════════════════════════
    const silhouette = (sx: number, sy: number, scale: number, shade: string) => {
      const s = scale;
      rect(sx - 1.5 * s, sy - 11 * s, 3 * s, 2 * s, shade);
      rect(sx - 2 * s, sy - 9 * s, 4 * s, 3 * s, shade);
      rect(sx - 1.5 * s, sy - 6 * s, 3 * s, 1 * s, shade);
      rect(sx - 2.5 * s, sy - 5 * s, 5 * s, 7 * s, shade);
      rect(sx - 2 * s, sy + 2 * s, 1.5 * s, 6 * s, shade);
      rect(sx + 0.5 * s, sy + 2 * s, 1.5 * s, 6 * s, shade);
    };

    const crowd: [number, number, number, string][] = [];
    for (let cx = 60; cx < W; cx += 38 + Math.random() * 35)
      crowd.push([cx, GROUND_Y + 2, 1.5 + Math.random() * 0.6, '#18103a']);
    for (let cx = 80; cx < W; cx += 48 + Math.random() * 45)
      crowd.push([cx, GROUND_Y, 1.1 + Math.random() * 0.4, '#0e0828']);
    for (let cx = 40; cx < W; cx += 60 + Math.random() * 50)
      crowd.push([cx, GROUND_Y - 2, 0.8 + Math.random() * 0.3, '#0a0818']);
    crowd.forEach(([cx, cy, cs, cc]) => silhouette(cx, cy, cs, cc));

    // ═══════════════════════════════════════════════
    // POST-PROCESSING
    // ═══════════════════════════════════════════════

    // CRT scanlines (subtle vertical)
    x.globalAlpha = 0.02;
    for (let i = 0; i < W; i += 3) rect(i, 0, 1, H, P.pink);
    x.globalAlpha = 1;

    // Horizontal noise
    x.globalAlpha = 0.015;
    for (let y = 0; y < H; y += 2) {
      if (Math.random() > 0.75) rect(0, y, W, 1, P.pink);
    }
    x.globalAlpha = 1;

    // Vignette effect — darker edges
    const grad = x.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.65);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.3)');
    x.fillStyle = grad;
    x.fillRect(0, 0, W, H);

    this.textures.addCanvas('district_bg', canvas);
    captureThumb('hub', canvas);
    captureThumb('woods', WoodsScene.generateBg());
    captureThumb('alley', AlleyScene.generateBg());
    captureThumb('cabin', CabinScene.generateBg());
    captureThumb('rooms', genRoomPreview());
  }

  // ================================================================
  // PLAYER SPRITE — generated from avatar config
  // ================================================================
  private generatePlayerSprite(): void {
    const avatar = getAvatar();
    const canvas = renderHubSprite(avatar);
    this.textures.addCanvas('player', canvas);
  }

  // ================================================================
  // ROOM PLAYER SPRITE — generated from avatar config
  // ================================================================
  private generateRoomPlayerSprite(): void {
    const avatar = getAvatar();
    const canvas = renderRoomSprite(avatar);
    this.textures.addCanvas('player_room', canvas);
  }

  // ================================================================
  // NEON SIGN FRAMES — for animated flickering in HubScene
  // ================================================================
  private generateNeonSignFrames(): void {
    // Generate 4 frames of neon sign glow at varying intensities
    // HubScene will cycle these for a flickering neon effect
    const signs = [
      { key: 'relay', text: 'RELAY', color: P.sign1 },
      { key: 'feed', text: 'THE FEED', color: P.pink },
      { key: 'myroom', text: 'MY ROOM', color: P.teal },
      { key: 'lounge', text: 'LOUNGE', color: P.pink },
      { key: 'market', text: 'MARKET', color: P.amber },
    ];

    signs.forEach(sign => {
      for (let frame = 0; frame < 4; frame++) {
        const canvas = document.createElement('canvas');
        const w = sign.text.length * 16 + 40;
        const h = 36;
        canvas.width = w;
        canvas.height = h;
        const x = canvas.getContext('2d')!;
        x.imageSmoothingEnabled = false;

        // Varying glow intensity per frame
        const intensity = [0.7, 0.85, 1.0, 0.6][frame];

        x.fillStyle = '#0e0828';
        x.fillRect(0, 0, w, h);

        x.fillStyle = sign.color;
        x.globalAlpha = intensity;
        x.font = 'bold 16px monospace';
        x.textAlign = 'center';
        x.fillText(sign.text, w / 2, 22);

        // Glow halo
        x.globalAlpha = intensity * 0.1;
        x.fillRect(0, 0, w, h);
        x.globalAlpha = 1;

        const texKey = `neon_${sign.key}_${frame}`;
        if (this.textures.exists(texKey)) this.textures.remove(texKey);
        this.textures.addCanvas(texKey, canvas);
      }
    });
  }
}

/** Generic private-room interior preview for the Rooms map node. */
function genRoomPreview(): HTMLCanvasElement {
  const W = 800, H = 500;
  const FLOOR = Math.round(H * 0.65);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const r = (ax: number, ay: number, aw: number, ah: number, col: string) => { x.fillStyle = col; x.fillRect(ax, ay, aw, ah); };

  // Wall
  const wg = x.createLinearGradient(0, 0, 0, FLOOR);
  wg.addColorStop(0, '#08060e'); wg.addColorStop(1, '#10102a');
  x.fillStyle = wg; x.fillRect(0, 0, W, FLOOR);
  // Subtle horizontal wallpaper lines
  x.globalAlpha = 0.05;
  for (let wy = 20; wy < FLOOR; wy += 20) r(0, wy, W, 1, '#ffffff');
  x.globalAlpha = 1;

  // Window
  const winX = 320, winY = 22, winW = 160, winH = 140;
  r(winX, winY, winW, winH, '#060c18');
  x.globalAlpha = 0.32; r(winX, winY, winW, winH, '#304870'); x.globalAlpha = 1;
  // Moonlight spill on floor
  x.globalAlpha = 0.09; x.fillStyle = '#8aaae0';
  x.beginPath(); x.ellipse(winX + winW / 2, FLOOR + 10, 130, 70, 0, 0, Math.PI * 2); x.fill();
  x.globalAlpha = 1;
  // Frame
  x.fillStyle = '#26200e';
  r(winX - 3, winY - 3, winW + 6, 3, '#26200e'); r(winX - 3, winY + winH, winW + 6, 3, '#26200e');
  r(winX - 3, winY - 3, 3, winH + 6, '#26200e'); r(winX + winW, winY - 3, 3, winH + 6, '#26200e');
  r(winX, winY + Math.floor(winH / 2) - 1, winW, 2, '#1e180c');
  r(winX + Math.floor(winW / 2) - 1, winY, 2, winH, '#1e180c');

  // Baseboard
  r(0, FLOOR - 6, W, 10, '#1a1610');

  // Floor
  const fg = x.createLinearGradient(0, FLOOR, 0, H);
  fg.addColorStop(0, '#281c0e'); fg.addColorStop(1, '#160e06');
  x.fillStyle = fg; x.fillRect(0, FLOOR, W, H - FLOOR);
  x.globalAlpha = 0.28;
  for (let fy = FLOOR + 4; fy < H; fy += 18) r(0, fy, W, 2, '#1a1008');
  x.globalAlpha = 0.1;
  for (let fx = 90; fx < W; fx += 90) r(fx, FLOOR, 1, H - FLOOR, '#0e0a04');
  x.globalAlpha = 1;

  // Neon accent strip along baseboard
  x.globalAlpha = 0.18; r(0, FLOOR - 10, W, 3, '#5dcaa5');
  x.globalAlpha = 0.07;
  x.beginPath(); x.rect(0, FLOOR - 28, W, 22); x.fill();
  x.globalAlpha = 1;

  // Vignette
  const vg = x.createRadialGradient(W / 2, H / 2, W * 0.12, W / 2, H / 2, W * 0.65);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.78)');
  x.fillStyle = vg; x.fillRect(0, 0, W, H);

  return c;
}