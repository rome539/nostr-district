import type { WallTheme, FloorStyle } from '../stores/roomStore';
import { lighten, darken, type FillRect, type VoidStar } from './roomHelpers';

const _wallImgs: Partial<Record<string, HTMLImageElement>> = {};
for (const [key, src] of [
  ['dungeon',      'assets/furniture/walls/dungeonwall.png'],
  ['brickwall',    'assets/furniture/walls/brickwall.png'],
  ['marblewall',   'assets/furniture/walls/marblewall.png'],
  ['marblewallblack', 'assets/furniture/walls/marblewallblack.png'],
  ['oldpaperwall', 'assets/furniture/walls/oldpaperwall.png'],
] as [string, string][]) {
  const img = new Image(); img.src = src; _wallImgs[key] = img;
}
const _floorImgs: Partial<Record<string, HTMLImageElement>> = {};
for (const [key, src] of [
  ['dungeon',        'assets/furniture/floors/dungeonfloor.png'],
  ['dirtfloor',      'assets/furniture/floors/dirtfloor.png'],
  ['marble',         'assets/furniture/floors/marblefloor.png'],
  ['marbleblack',    'assets/furniture/floors/marblefloorblack.png'],
  ['carpetred',      'assets/furniture/floors/carpetred.png'],
  ['carpetpurple',   'assets/furniture/floors/carpetpurple.png'],
  ['carpetblue',     'assets/furniture/floors/carpetblue.png'],
  ['carpetgold',     'assets/furniture/floors/carpetgold.png'],
  ['parquetwood',    'assets/furniture/floors/ParquetWoodfloor.png'],
  ['oldwoodenfloor', 'assets/furniture/floors/oldwoodenfloor.png'],
] as [string, string][]) {
  const img = new Image(); img.src = src; _floorImgs[key] = img;
}

const VOID_BG = '#060608';
const VOID_STAR_COLORS = ['#fad480', '#e87aab', '#7b68ee', '#5dcaa5', '#ffffff', '#ffffff', '#ffffff'];
const VOID_DESK_BLOCK = { x: 548, y: 150, w: 216, h: 150 };

function seeded(n: number): number {
  return Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
}

function inRect(px: number, py: number, rect: { x: number; y: number; w: number; h: number }): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

function drawVoidStaticSpace(
  x: CanvasRenderingContext2D,
  W: number,
  y: number,
  h: number,
  starCount: number,
  seedOffset = 0,
): void {
  x.fillStyle = VOID_BG;
  x.fillRect(0, y, W, h);

  for (let i = 0; i < starCount; i++) {
    x.globalAlpha = 0.10 + seeded(seedOffset + i * 2.7) * 0.25;
    x.fillStyle = '#d0d8ff';
    x.fillRect(seeded(seedOffset + i * 3.3) * W, y + seeded(seedOffset + i * 1.7) * h, 1, 1);
  }

  const nebulas = [[0.18, 0.3, 90, 40], [0.62, 0.45, 110, 35], [0.82, 0.18, 70, 30]];
  for (const [nx2, ny2, nw, nh] of nebulas) {
    const cx = nx2 * W;
    const cy = y + ny2 * h;
    const grad = x.createRadialGradient(cx, cy, 0, cx, cy, nw);
    grad.addColorStop(0, 'rgba(80,50,140,0.05)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grad; x.fillRect(cx - nw, cy - nh, nw * 2, nh * 2);
  }
  x.globalAlpha = 1;
}

function addVoidAnimatedStars(
  voidStarsOut: VoidStar[] | undefined,
  W: number,
  y: number,
  h: number,
  seedOffset = 0,
  block?: { x: number; y: number; w: number; h: number },
): void {
  if (!voidStarsOut) return;

  for (let i = 0; i < 55; i++) {
    const sx = Math.round(seeded(seedOffset + i * 2.1) * W);
    const sy = Math.round(y + seeded(seedOffset + i * 3.7) * h);
    if (block && inRect(sx, sy, block)) continue;
    voidStarsOut.push({
      x: sx,
      y: sy,
      color: VOID_STAR_COLORS[Math.floor(seeded(seedOffset + i * 6.3) * VOID_STAR_COLORS.length)],
      phase: seeded(seedOffset + i * 4.9) * Math.PI * 2,
      size: seeded(seedOffset + i * 5.3) > 0.78 ? 2 : 1,
    });
  }
}

export function drawWalls(
  x: CanvasRenderingContext2D,
  W: number,
  FY: number,
  wallTheme: WallTheme,
  wall: { bg: string; brick: string; accent: string },
  light: { primary: string },
  r: FillRect,
  pngImg?: HTMLImageElement | HTMLCanvasElement,
  voidStarsOut?: VoidStar[],
): void {
  r(0, 0, W, FY, wall.bg);

  if (wallTheme === 'cabin') {
    const CX  = W / 2;
    const FP  = { x: CX - 56, y: FY - 124, w: 112, h: 124 };
    const FB  = { x: CX - 35, y: FY -  80, w:  70, h:  70 };
    const MAN = { x: CX - 66, y: FY - 130, w: 132, h:  11 };
    const HTH = { x: CX - 62, y: FY -  10, w: 124, h:  10 };

    // Log bands — full wall width
    const LOG_H = 26, CHINK = 2;
    const LOGS  = ['#1a0d06', '#221108'];
    for (let li = 0, ly = 0; ly < FY; li++, ly += LOG_H + CHINK) {
      const lc = LOGS[li % 2];
      r(0, ly, W, LOG_H, lc);
      x.globalAlpha = 0.13; r(0, ly, W, 2, '#b07848');
      x.globalAlpha = 0.20; r(0, ly + LOG_H - 3, W, 3, '#000000');
      x.globalAlpha = 1;    r(0, ly + LOG_H, W, CHINK, '#0c0604');
    }
    // Knots
    const knots = [[70,32],[168,86],[50,144],[114,248],[652,42],[716,110],[642,168],[754,224],[320,60],[480,140]];
    for (const [kx, ky] of knots) {
      x.globalAlpha = 0.16; x.fillStyle = '#060402';
      x.beginPath(); x.ellipse(kx, ky, 10, 7, 0, 0, Math.PI * 2); x.fill();
      x.globalAlpha = 1;
    }

    // ── Stone arched fireplace ───────────────────────────────
    x.fillStyle = '#000'; x.globalAlpha = 0.24;
    x.fillRect(FP.x + 4, FP.y + 8, FP.w, FP.h);
    x.globalAlpha = 1;

    const stoneBase = '#7f796e';
    const stoneDark = '#4e4942';
    const stoneLite = '#aaa294';
    r(FP.x, FP.y, FP.w, FP.h, stoneBase);

    const archCx = CX;
    const archCy = FB.y + 6;
    const archRx = 44;
    const archRy = 42;
    x.fillStyle = '#0a0503';
    x.beginPath();
    x.moveTo(FB.x, FY - 10);
    x.lineTo(FB.x, archCy);
    x.quadraticCurveTo(archCx, archCy - archRy, FB.x + FB.w, archCy);
    x.lineTo(FB.x + FB.w, FY - 10);
    x.closePath();
    x.fill();

    x.fillStyle = stoneBase;
    x.beginPath();
    x.moveTo(FB.x - 11, FY);
    x.lineTo(FB.x - 11, archCy + 5);
    x.quadraticCurveTo(archCx, archCy - archRy - 20, FB.x + FB.w + 11, archCy + 5);
    x.lineTo(FB.x + FB.w + 11, FY);
    x.lineTo(FB.x + FB.w - 1, FY);
    x.lineTo(FB.x + FB.w - 1, archCy);
    x.quadraticCurveTo(archCx, archCy - archRy, FB.x + 1, archCy);
    x.lineTo(FB.x + 1, FY);
    x.closePath();
    x.fill();

    x.strokeStyle = stoneDark; x.lineWidth = 2; x.globalAlpha = 0.78;
    x.beginPath();
    x.moveTo(FB.x - 11, FY);
    x.lineTo(FB.x - 11, archCy + 5);
    x.quadraticCurveTo(archCx, archCy - archRy - 20, FB.x + FB.w + 11, archCy + 5);
    x.lineTo(FB.x + FB.w + 11, FY);
    x.stroke();
    x.globalAlpha = 1; x.lineWidth = 1;

    // Block seams, kept chunky so the stonework reads at game scale
    x.strokeStyle = stoneDark; x.globalAlpha = 0.55;
    for (let sy = FP.y + 24; sy < FY - 12; sy += 26) {
      x.beginPath(); x.moveTo(FP.x + 5, sy); x.lineTo(FB.x - 10, sy); x.stroke();
      x.beginPath(); x.moveTo(FB.x + FB.w + 10, sy); x.lineTo(FP.x + FP.w - 5, sy); x.stroke();
    }
    for (let vx = FP.x + 19; vx < FB.x - 8; vx += 20) {
      x.beginPath(); x.moveTo(vx, FP.y + 3); x.lineTo(vx, FY - 13); x.stroke();
    }
    for (let vx = FB.x + FB.w + 18; vx < FP.x + FP.w - 5; vx += 20) {
      x.beginPath(); x.moveTo(vx, FP.y + 3); x.lineTo(vx, FY - 13); x.stroke();
    }
    for (let i = -3; i <= 3; i++) {
      const ax = archCx + i * 12;
      x.beginPath(); x.moveTo(ax, archCy - 34 + Math.abs(i) * 7); x.lineTo(ax + i * 2, archCy + 6); x.stroke();
    }
    x.globalAlpha = 0.16; r(FP.x + 4, FP.y + 4, FP.w - 8, 3, stoneLite);
    x.globalAlpha = 0.28; r(FP.x + FP.w - 7, FP.y + 8, 4, FP.h - 20, '#1a1714');
    x.globalAlpha = 1;

    // ── Mantel shelf ────────────────────────────────────────
    r(MAN.x + 6, MAN.y - 5, MAN.w - 12, 5, '#1d0d05');
    r(MAN.x, MAN.y, MAN.w, MAN.h, '#4a260f');
    x.globalAlpha = 0.22; r(MAN.x, MAN.y, MAN.w, 3, '#b0703a');
    x.globalAlpha = 0.55; r(MAN.x, MAN.y + MAN.h - 4, MAN.w, 4, '#1a0e06');
    x.globalAlpha = 0.05;
    for (let gx = MAN.x + 8; gx < MAN.x + MAN.w; gx += 12)
      { x.fillStyle = '#080402'; x.fillRect(gx, MAN.y, 1, MAN.h); }
    x.globalAlpha = 1;

    // ── Hearth ledge ────────────────────────────────────────
    r(HTH.x, HTH.y, HTH.w, HTH.h, '#5f594f');
    x.globalAlpha = 0.28; r(HTH.x, HTH.y, HTH.w, 2, stoneLite);
    x.globalAlpha = 0.58; r(HTH.x, HTH.y + HTH.h - 4, HTH.w, 4, '#2c2824');
    x.globalAlpha = 0.45;
    for (let hx = HTH.x + 20; hx < HTH.x + HTH.w; hx += 28) r(hx, HTH.y, 1, HTH.h, stoneDark);
    x.globalAlpha = 1;

    // ── Firebox interior ─────────────────────────────────────
    x.save();
    x.beginPath();
    x.moveTo(FB.x + 2, FY - 10);
    x.lineTo(FB.x + 2, archCy);
    x.quadraticCurveTo(archCx, archCy - archRy, FB.x + FB.w - 2, archCy);
    x.lineTo(FB.x + FB.w - 2, FY - 10);
    x.closePath();
    x.clip();
    r(FB.x, FB.y - 6, FB.w, FB.h + 12, '#080402');
    const insideGrad = x.createLinearGradient(0, FB.y, 0, FY - 10);
    insideGrad.addColorStop(0, 'rgba(0,0,0,0.72)');
    insideGrad.addColorStop(0.62, 'rgba(30,10,2,0.22)');
    insideGrad.addColorStop(1, 'rgba(70,36,18,0.42)');
    x.fillStyle = insideGrad; x.fillRect(FB.x, FB.y - 8, FB.w, FB.h + 12);
    r(FB.x, FY - 25, FB.w, 15, '#241c15');

    const emberGlow = x.createRadialGradient(FB.x + FB.w / 2, FY - 24, 2, FB.x + FB.w / 2, FY - 24, 38);
    emberGlow.addColorStop(0, 'rgba(255,110,24,0.48)');
    emberGlow.addColorStop(0.45, 'rgba(180,42,8,0.16)');
    emberGlow.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = emberGlow; x.fillRect(FB.x, FB.y + 8, FB.w, FB.h);

    // Charred logs and hot coal bed under the animated flame layer
    x.save();
    x.translate(FB.x + FB.w / 2, FY - 25);
    x.rotate(-0.16);
    r(-24, -5, 48, 7, '#3a1808');
    x.globalAlpha = 0.45; r(-20, -4, 36, 2, '#7a3410'); x.globalAlpha = 1;
    r(-27, -6, 6, 8, '#120804');
    r(21, -6, 6, 8, '#120804');
    x.rotate(0.32);
    r(-22, -5, 44, 7, '#2a1006');
    x.globalAlpha = 0.42; r(-16, -4, 31, 2, '#a54410'); x.globalAlpha = 1;
    r(-26, -6, 6, 8, '#120804');
    r(20, -6, 6, 8, '#120804');
    x.restore();

    for (const ef of [0.14, 0.25, 0.38, 0.52, 0.67, 0.82]) {
      x.globalAlpha = 0.75; x.fillStyle = '#b82808';
      x.fillRect(FB.x + ef * FB.w, FB.y + FB.h - 10, 3, 2);
      x.globalAlpha = 0.95; x.fillStyle = '#ffb040';
      x.fillRect(FB.x + ef * FB.w + 1, FB.y + FB.h - 11, 1, 1);
    }
    x.globalAlpha = 1;

    const fireGlow = x.createRadialGradient(FB.x + FB.w / 2, FB.y + FB.h - 24, 8, FB.x + FB.w / 2, FB.y + FB.h - 24, 64);
    fireGlow.addColorStop(0, 'rgba(255,150,40,0.16)');
    fireGlow.addColorStop(0.48, 'rgba(255,70,20,0.06)');
    fireGlow.addColorStop(1, 'rgba(255,70,20,0)');
    x.fillStyle = fireGlow; x.fillRect(FB.x - 4, FB.y, FB.w + 8, FB.h);
    x.restore();

  } else if (wallTheme === 'cityview') {
    const seeded = (n: number) => Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
    const FRAME = '#181c28';
    const SILL  = '#22263a';

    const wins = [
      { wx: 45,  wy: 10, ww: 195, wh: 242 },
      { wx: 302, wy: 10, ww: 197, wh: 242 },
      { wx: 558, wy: 10, ww: 196, wh: 242 },
    ];

    for (let wi = 0; wi < wins.length; wi++) {
      const { wx, wy, ww, wh } = wins[wi];
      const FR = 7;
      const ix = wx + FR, iy = wy + FR, iw = ww - FR * 2, ih = wh - FR * 2;

      // Sky gradient
      const sky = x.createLinearGradient(0, iy, 0, iy + ih);
      sky.addColorStop(0,   '#010508');
      sky.addColorStop(0.5, '#050e20');
      sky.addColorStop(1,   '#0a1530');
      x.fillStyle = sky; x.fillRect(ix, iy, iw, ih);

      // Stars
      for (let si = 0; si < 22; si++) {
        const sx = ix + seeded(wi * 200 + si * 3.1) * iw;
        const sy = iy + seeded(wi * 200 + si * 3.7) * ih * 0.50;
        const br = 0.35 + seeded(wi * 200 + si * 2.3) * 0.65;
        x.globalAlpha = br; x.fillStyle = '#ffffff'; x.fillRect(sx, sy, 1, 1);
        if (seeded(wi * 200 + si * 5.1) > 0.72) {
          x.globalAlpha = br * 0.4;
          x.fillRect(sx - 1, sy, 1, 1); x.fillRect(sx + 1, sy, 1, 1);
        }
      }
      x.globalAlpha = 1;

      // Moon (center window only)
      if (wi === 1) {
        const mx = ix + iw * 0.78, my = iy + ih * 0.14;
        x.globalAlpha = 0.88; x.fillStyle = '#e8dca8';
        x.beginPath(); x.arc(mx, my, 8, 0, Math.PI * 2); x.fill();
        x.fillStyle = '#d0c480'; x.globalAlpha = 0.45;
        x.beginPath(); x.arc(mx - 2, my + 1, 2, 0, Math.PI * 2); x.fill();
        x.beginPath(); x.arc(mx + 3, my - 2, 1.5, 0, Math.PI * 2); x.fill();
        x.globalAlpha = 1;
      }

      // Buildings
      const horizY = iy + ih * 0.58;
      const bldgs = [
        [0.00, 0.08, 0.36],[0.08, 0.11, 0.52],[0.19, 0.07, 0.40],
        [0.26, 0.13, 0.62],[0.39, 0.10, 0.75],[0.49, 0.07, 0.56],
        [0.56, 0.12, 0.66],[0.68, 0.09, 0.42],[0.77, 0.11, 0.54],
        [0.88, 0.08, 0.36],[0.96, 0.04, 0.28],
      ];
      for (let bi = 0; bi < bldgs.length; bi++) {
        const [bxf, bwf, bhf] = bldgs[bi];
        const bx = ix + bxf * iw, bw = bwf * iw;
        const bh = bhf * (iy + ih - horizY);
        const btop = iy + ih - bh;
        x.fillStyle = '#060a14'; x.fillRect(bx, btop, bw, ih - (btop - iy));
        // Windows
        const cols = Math.max(1, Math.floor(bw / 5));
        const rows = Math.max(1, Math.floor(bh / 7));
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const s = wi * 10000 + bi * 1000 + row * 50 + col;
            if (seeded(s) > 0.42) {
              x.fillStyle = seeded(s + 0.5) > 0.28 ? '#f0da60' : '#80b8f8';
              x.globalAlpha = 0.65 + seeded(s + 0.3) * 0.35;
              x.fillRect(bx + col * 5 + 1, btop + row * 7 + 2, 2, 3);
            }
          }
        }
        x.globalAlpha = 1;
      }

      // Horizon city-glow
      const hglow = x.createLinearGradient(0, horizY - 15, 0, horizY + 25);
      hglow.addColorStop(0, 'rgba(50,70,160,0)');
      hglow.addColorStop(0.5, 'rgba(70,90,200,0.14)');
      hglow.addColorStop(1, 'rgba(50,70,160,0)');
      x.fillStyle = hglow; x.fillRect(ix, horizY - 15, iw, 40);

      // Frame bars
      r(wx, wy, ww, FR, FRAME); r(wx, wy + wh - FR, ww, FR, FRAME);
      r(wx, wy, FR, wh, FRAME); r(wx + ww - FR, wy, FR, wh, FRAME);
      r(wx, wy + Math.round(wh / 2) - 2, ww, 4, FRAME);
      r(wx + Math.round(ww / 2) - 2, wy, 4, wh, FRAME);
      // Sill ledge
      r(wx - 4, wy + wh - FR, ww + 8, FR + 5, SILL);
      // Subtle frame highlight
      x.globalAlpha = 0.1;
      r(wx, wy, ww, 1, '#a0b4d0'); r(wx, wy, 1, wh, '#a0b4d0');
      x.globalAlpha = 1;
    }
  } else if (wallTheme === 'neon') {
    x.strokeStyle = light.primary; x.lineWidth = 0.5; x.globalAlpha = 0.08;
    for (let gy = 20; gy < FY; gy += 24) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
    for (let gx = 20; gx < W; gx += 24) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, FY); x.stroke(); }
    x.globalAlpha = 1;
  } else if (wallTheme === 'void') {
    drawVoidStaticSpace(x, W, 0, FY, 140);
    addVoidAnimatedStars(voidStarsOut, W, 0, FY, 0, VOID_DESK_BLOCK);
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

  const wallImg = _wallImgs[wallTheme];
  if (wallImg?.complete && wallImg.naturalWidth) {
    x.drawImage(wallImg, 0, 0, W, FY);
  }

  // Baseboard (skipped for PNG walls, cabin, and cityview which have their own treatment)
  const _PNG_WALLS = new Set(['dungeon', 'brickwall', 'marblewall', 'marblewallblack', 'oldpaperwall']);
  if (wallTheme !== 'cabin' && wallTheme !== 'cityview' && wallTheme !== 'void' && !_PNG_WALLS.has(wallTheme)) {
    r(0, FY - 10, W, 10, wall.accent);
    r(0, FY - 12, W, 2, wall.accent);
    x.globalAlpha = 0.5; r(0, FY - 10, W, 1, light.primary); x.globalAlpha = 1;
  }
}

export function drawFloor(
  x: CanvasRenderingContext2D,
  W: number,
  H: number,
  FY: number,
  floorStyle: FloorStyle,
  floor: { base: string; alt: string; groove: string },
  light: { primary: string },
  r: FillRect,
  voidStarsOut?: VoidStar[],
): void {
  r(0, FY, W, H - FY, floor.base);

  if (floorStyle === 'tile') {
    for (let fy = FY; fy < H; fy += 22) {
      for (let fx = 0; fx < W; fx += 22) {
        const isAlt = ((fx / 22 + fy / 22) % 2) < 1;
        x.globalAlpha = isAlt ? 0.2 : 0.08;
        r(fx, fy, 20, 20, floor.alt);
        x.globalAlpha = 1;
      }
    }
  } else if (floorStyle === 'carpet') {
    for (let fy = FY; fy < H; fy += 4) {
      for (let fx = 0; fx < W; fx += 4) {
        x.globalAlpha = 0.03 + Math.random() * 0.04;
        r(fx, fy, 3, 3, floor.alt);
        x.globalAlpha = 1;
      }
    }
  } else if (floorStyle === 'concrete') {
    for (let i = 0; i < 200; i++) {
      x.globalAlpha = 0.04 + Math.random() * 0.04;
      r(Math.random() * W, FY + Math.random() * (H - FY), 2, 2, floor.alt);
      x.globalAlpha = 1;
    }
  } else if (floorStyle === 'neon') {
    x.strokeStyle = light.primary; x.lineWidth = 1; x.globalAlpha = 0.28;
    for (let fy = FY + 22; fy < H; fy += 22) { x.beginPath(); x.moveTo(0, fy); x.lineTo(W, fy); x.stroke(); }
    for (let fx = 0; fx < W; fx += 38) { x.beginPath(); x.moveTo(fx, FY); x.lineTo(fx, H); x.stroke(); }
    x.lineWidth = 3; x.globalAlpha = 0.06;
    for (let fy = FY + 22; fy < H; fy += 22) { x.beginPath(); x.moveTo(0, fy); x.lineTo(W, fy); x.stroke(); }
    for (let fx = 0; fx < W; fx += 38) { x.beginPath(); x.moveTo(fx, FY); x.lineTo(fx, H); x.stroke(); }
    x.globalAlpha = 1; x.lineWidth = 1;
  } else if (floorStyle === 'tatami') {
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
  } else if (floorStyle === 'hex') {
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
  } else if (floorStyle === 'bamboo') {
    const stalkW = 14;
    for (let fx = 0; fx < W; fx += stalkW) {
      const col = Math.floor(fx / stalkW);
      const shade = col % 3 === 0 ? lighten(floor.base, 12) : col % 3 === 1 ? floor.base : darken(floor.base, 8);
      r(fx, FY, stalkW - 1, H - FY, shade);
      x.globalAlpha = 0.15;
      r(fx + 3, FY, 1, H - FY, '#6a7a28');
      r(fx + 9, FY, 1, H - FY, '#4a5818');
      x.globalAlpha = 1;
      const nodeOffset = (col % 3) * 6;
      for (let fy = FY + 10 + nodeOffset; fy < H; fy += 18) {
        x.globalAlpha = 0.45; r(fx, fy, stalkW - 1, 2, floor.groove);
        x.globalAlpha = 0.2;  r(fx, fy + 2, stalkW - 1, 1, lighten(floor.base, 20));
        x.globalAlpha = 1;
      }
    }
    const bSheen = x.createLinearGradient(0, FY, 0, H);
    bSheen.addColorStop(0, 'rgba(160,200,40,0.06)');
    bSheen.addColorStop(1, 'rgba(0,0,0,0.08)');
    x.fillStyle = bSheen; x.fillRect(0, FY, W, H - FY);
  } else if (floorStyle === 'void') {
    drawVoidStaticSpace(x, W, FY, H - FY, 140, 2000);
    addVoidAnimatedStars(voidStarsOut, W, FY, H - FY, 2000);
  } else if (floorStyle === 'slate') {
    const TW = 60; const TH = 28;
    for (let fy = FY; fy < H; fy += TH) {
      const row = Math.floor((fy - FY) / TH);
      const off = (row % 2) * (TW / 2);
      for (let fx = -TW + off; fx < W + TW; fx += TW) {
        x.globalAlpha = 0.03 + (row % 2) * 0.015;
        r(fx, fy, TW - 1, TH - 1, '#1a1a28');
        x.globalAlpha = 0.06;
        r(fx, fy, TW - 1, 1, '#8080b0');
        r(fx, fy, 1, TH - 1, '#6060a0');
        x.globalAlpha = 1;
      }
    }
    x.strokeStyle = 'rgba(120,120,180,0.12)'; x.lineWidth = 1;
    for (let fy = FY; fy < H; fy += TH) { x.beginPath(); x.moveTo(0, fy); x.lineTo(W, fy); x.stroke(); }
    x.globalAlpha = 1;
    const glare = x.createRadialGradient(W * 0.5, FY + 10, 0, W * 0.5, FY + 10, W * 0.6);
    glare.addColorStop(0, 'rgba(180,180,255,0.06)');
    glare.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = glare; x.fillRect(0, FY, W, H - FY);
    x.strokeStyle = 'rgba(200,200,255,0.22)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(0, FY); x.lineTo(W, FY); x.stroke();
    x.globalAlpha = 1;
  } else {
    // Hardwood planks
    const WOOD_BASE  = '#3d1f0a';
    const WOOD_LIGHT = '#5a2e10';
    const WOOD_DARK  = '#2a1406';
    const WOOD_GRAIN = '#4a2510';
    r(0, FY, W, H - FY, WOOD_BASE);
    for (let fy = FY; fy < H; fy += 13) {
      const row = Math.floor((fy - FY) / 13);
      const off = (row % 2) * 52;
      for (let fx = off - 52; fx < W + 52; fx += 104) {
        const shade = (row % 3 === 0) ? WOOD_LIGHT : (row % 3 === 1 ? WOOD_BASE : WOOD_DARK);
        x.globalAlpha = 1; r(fx, fy, 102, 11, shade);
        x.globalAlpha = 0.7; r(fx, fy + 11, 102, 2, WOOD_DARK); x.globalAlpha = 1;
        x.globalAlpha = 0.18;
        r(fx + 6,  fy + 3, 30 + (row * 17) % 40, 1, WOOD_GRAIN);
        r(fx + 50, fy + 7, 20 + (row * 11) % 30, 1, WOOD_GRAIN);
        r(fx + 20, fy + 5, 15 + (row * 7)  % 25, 1, '#7a4020');
        x.globalAlpha = 0.08;
        r(fx + 8,  fy + 2, 70, 1, '#8a5030');
        r(fx + 14, fy + 9, 50, 1, '#2a1006');
        x.globalAlpha = 1;
        if ((row + Math.floor(fx / 104)) % 7 === 0) {
          x.fillStyle = WOOD_DARK; x.globalAlpha = 0.5;
          x.beginPath(); x.ellipse(fx + 40, fy + 5, 4, 3, 0, 0, Math.PI * 2); x.fill();
          x.globalAlpha = 0.25;
          x.beginPath(); x.ellipse(fx + 40, fy + 5, 7, 5, 0, 0, Math.PI * 2); x.fill();
          x.globalAlpha = 1;
        }
      }
    }
    const sheen = x.createLinearGradient(0, FY, 0, H);
    sheen.addColorStop(0, 'rgba(255,180,80,0.06)');
    sheen.addColorStop(0.5, 'rgba(255,180,80,0.02)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.1)');
    x.fillStyle = sheen; x.fillRect(0, FY, W, H - FY);
  }

  const floorImg = _floorImgs[floorStyle];
  if (floorImg?.complete && floorImg.naturalWidth) {
    x.drawImage(floorImg, 0, FY, W, H - FY);
  }
}
