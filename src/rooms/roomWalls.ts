import type { WallTheme, FloorStyle } from '../stores/roomStore';
import { lighten, darken, type FillRect, type VoidStar } from './roomHelpers';

const _wallImgs: Partial<Record<string, HTMLImageElement>> = {};
for (const [key, src] of [
  ['dungeon',      'assets/furniture/walls/dungeonwall.png'],
  ['brickwall',    'assets/furniture/walls/brickwall.png'],
  ['oldpaperwall', 'assets/furniture/walls/oldpaperwall.png'],
] as [string, string][]) {
  const img = new Image(); img.src = src; _wallImgs[key] = img;
}
const _floorImgs: Partial<Record<string, HTMLImageElement>> = {};
for (const [key, src] of [
  ['dungeon',        'assets/furniture/floors/dungeonfloor.png'],
  ['dirtfloor',      'assets/furniture/floors/dirtfloor.png'],
  ['oldwoodenfloor', 'assets/furniture/floors/oldwoodenfloor.png'],
] as [string, string][]) {
  const img = new Image(); img.src = src; _floorImgs[key] = img;
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
    // Small fireplace centered on wall, sitting at floor line
    const CX  = W / 2;
    const FP  = { x: CX - 46, y: FY - 110, w:  92, h: 110 }; // stone surround (sits to floor)
    const FB  = { x: CX - 30, y: FY -  88, w:  60, h:  80 }; // firebox opening
    const MAN = { x: CX - 54, y: FY - 110, w: 108, h:   9 }; // mantel shelf
    const HTH = { x: CX - 38, y: FY -   6, w:  76, h:   6 }; // hearth ledge

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

    // ── Stone surround ──────────────────────────────────────
    r(FP.x, FP.y + MAN.h, FP.w, FP.h - MAN.h, '#706860');
    x.fillStyle = '#3c3430'; x.globalAlpha = 0.65;
    for (let sy = FP.y + MAN.h; sy < FP.y + FP.h; sy += 18)
      x.fillRect(FP.x, sy, FP.w, 1);
    const sRows = Math.ceil((FP.h - MAN.h) / 18);
    for (let row = 0; row < sRows; row++) {
      const ry = FP.y + MAN.h + row * 18;
      const off = row % 2 === 0 ? 0 : 14;
      for (let vx = FP.x + off; vx < FP.x + FP.w; vx += 28)
        x.fillRect(vx, ry, 1, 18);
    }
    x.globalAlpha = 1;
    x.globalAlpha = 0.10; r(FP.x, FP.y + MAN.h, 2, FP.h - MAN.h, '#ffffff'); x.globalAlpha = 1;

    // ── Mantel shelf ────────────────────────────────────────
    r(MAN.x, MAN.y, MAN.w, MAN.h, '#3a2010');
    x.globalAlpha = 0.18; r(MAN.x, MAN.y, MAN.w, 1, '#c09060');
    x.globalAlpha = 0.45; r(MAN.x, MAN.y + MAN.h - 3, MAN.w, 3, '#1a0e06');
    x.globalAlpha = 0.05;
    for (let gx = MAN.x + 8; gx < MAN.x + MAN.w; gx += 12)
      { x.fillStyle = '#080402'; x.fillRect(gx, MAN.y, 1, MAN.h); }
    x.globalAlpha = 1;

    // ── Hearth ledge ────────────────────────────────────────
    r(HTH.x, HTH.y, HTH.w, HTH.h, '#5a5248');
    x.fillStyle = '#3c3430'; x.globalAlpha = 0.55;
    for (let hx = HTH.x; hx < HTH.x + HTH.w; hx += 24) x.fillRect(hx, HTH.y, 1, HTH.h);
    x.fillRect(HTH.x, HTH.y, HTH.w, 1);
    x.globalAlpha = 1;

    // ── Firebox interior ─────────────────────────────────────
    r(FB.x, FB.y, FB.w, FB.h, '#080402');
    const lsh = x.createLinearGradient(FB.x, 0, FB.x + 12, 0);
    lsh.addColorStop(0, 'rgba(0,0,0,0.65)'); lsh.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = lsh; x.fillRect(FB.x, FB.y, 12, FB.h);
    const rsh = x.createLinearGradient(FB.x + FB.w - 12, 0, FB.x + FB.w, 0);
    rsh.addColorStop(0, 'rgba(0,0,0,0)'); rsh.addColorStop(1, 'rgba(0,0,0,0.65)');
    x.fillStyle = rsh; x.fillRect(FB.x + FB.w - 12, FB.y, 12, FB.h);
    const tsh = x.createLinearGradient(0, FB.y, 0, FB.y + 12);
    tsh.addColorStop(0, 'rgba(0,0,0,0.55)'); tsh.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = tsh; x.fillRect(FB.x, FB.y, FB.w, 12);
    // Ash floor
    r(FB.x, FB.y + FB.h - 14, FB.w, 14, '#242018');
    // Static ember glow
    const eg = x.createRadialGradient(FB.x + FB.w/2, FB.y + FB.h - 6, 2, FB.x + FB.w/2, FB.y + FB.h - 6, 36);
    eg.addColorStop(0, 'rgba(255,80,0,0.40)'); eg.addColorStop(1, 'rgba(255,80,0,0)');
    x.fillStyle = eg; x.fillRect(FB.x, FB.y + FB.h - 36, FB.w, 36);
    // Ember dots
    for (const ef of [0.15, 0.35, 0.55, 0.75]) {
      x.globalAlpha = 0.7; x.fillStyle = '#cc3000';
      x.fillRect(FB.x + ef * FB.w, FB.y + FB.h - 7, 3, 2);
      x.globalAlpha = 0.9; x.fillStyle = '#ff6020';
      x.fillRect(FB.x + ef * FB.w + 1, FB.y + FB.h - 8, 1, 1);
    }
    x.globalAlpha = 1;
    const flg = x.createRadialGradient(FB.x + FB.w/2, FB.y + FB.h/2, 6, FB.x + FB.w/2, FB.y + FB.h/2, 60);
    flg.addColorStop(0, 'rgba(255,100,20,0.16)'); flg.addColorStop(1, 'rgba(255,100,20,0)');
    x.fillStyle = flg; x.fillRect(FB.x, FB.y, FB.w, FB.h);

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
    const seeded = (n: number) => Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
    const COLORS = ['#fad480', '#e87aab', '#7b68ee', '#5dcaa5', '#ffffff', '#ffffff', '#ffffff'];
    // Faint static background stars on canvas
    for (let i = 0; i < 140; i++) {
      x.globalAlpha = 0.10 + seeded(i * 2.7) * 0.25;
      x.fillStyle = '#d0d8ff';
      x.fillRect(seeded(i * 3.3) * W, seeded(i * 1.7) * FY, 1, 1);
    }
    // Subtle nebula clouds
    const nebulas = [[0.18, 0.3, 90, 40], [0.62, 0.45, 110, 35], [0.82, 0.18, 70, 30]];
    for (const [nx2, ny2, nw, nh] of nebulas) {
      const grad = x.createRadialGradient(nx2 * W, ny2 * FY, 0, nx2 * W, ny2 * FY, nw);
      grad.addColorStop(0, 'rgba(80,50,140,0.05)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = grad; x.fillRect(nx2 * W - nw, ny2 * FY - nh, nw * 2, nh * 2);
    }
    x.globalAlpha = 1;
    // Bright animated stars — pushed to voidStarsOut for Phaser to blink each frame
    if (voidStarsOut) {
      for (let i = 0; i < 55; i++) {
        voidStarsOut.push({
          x: Math.round(seeded(i * 2.1) * W),
          y: Math.round(seeded(i * 3.7) * FY),
          color: COLORS[Math.floor(seeded(i * 6.3) * COLORS.length)],
          phase: seeded(i * 4.9) * Math.PI * 2,
          size: seeded(i * 5.3) > 0.78 ? 2 : 1,
        });
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

  const wallImg = _wallImgs[wallTheme];
  if (wallImg?.complete && wallImg.naturalWidth) {
    x.drawImage(wallImg, 0, 0, W, FY);
  }

  // Baseboard (skipped for PNG walls, cabin, and cityview which have their own treatment)
  const _PNG_WALLS = new Set(['dungeon', 'brickwall', 'oldpaperwall']);
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
  } else if (floorStyle === 'marble') {
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
