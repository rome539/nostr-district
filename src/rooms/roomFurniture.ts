import { P } from '../config/game.config';
import type { RoomConfig, FurnitureId } from '../stores/roomStore';
import { getFurnitureColor, getDefaultPos, POSTER_DEFAULT_POS, POSTER_SIZE } from '../stores/roomStore';
import { lighten, darken, makeR, type BlinkingLED, type CandleFlame } from './roomHelpers';
import { drawPoster } from './roomPosters';

// Fixed furniture colors — independent of wall/lighting theme
const FUR_FRAME = '#1e1432';
const FUR_MID   = '#2a1c48';
const FUR_DARK  = '#140e26';
const SHELF_BODY = '#2a1a08';

export function drawMyRoomFurniture(
  x: CanvasRenderingContext2D,
  W: number,
  FY: number,
  cfg: RoomConfig,
  wall: { accent: string },
  light: { primary: string; glow: string },
  blinkingLEDs: BlinkingLED[],
  candleFlames: CandleFlame[],
  onlyId?: FurnitureId | '__static__',
): void {
  // item(id) = true when we should draw this furniture piece
  const item = (id: FurnitureId): boolean => (!onlyId || onlyId === id) && cfg.furniture.includes(id);
  // stat = true when we should draw static scene elements (ceiling, desk, posters)
  const stat = !onlyId || onlyId === '__static__';

  const r = makeR(x);
  const fc = (id: FurnitureId) => getFurnitureColor(cfg, id);
  const pd = (id: FurnitureId) => {
    const def = getDefaultPos(id);
    const pos = cfg.furniturePositions?.[id] ?? def;
    return { dx: pos.x - def.x, dy: pos.y - def.y };
  };

  // ── Rug ──
  if (item('rug')) {
    const { dx, dy } = pd('rug');
    x.save(); x.translate(dx, dy);
    const rugX = 250; const rugY = FY + 18;
    const rugC = fc('rug');
    const rugLight = lighten(rugC, 18);
    const rugDark  = darken(rugC, 12);
    r(rugX, rugY, 280, 104, rugDark);
    x.globalAlpha = 0.55; r(rugX + 4, rugY + 4, 272, 96, rugC); x.globalAlpha = 1;
    x.globalAlpha = 0.12; r(rugX + 8, rugY + 8, 264, 88, '#fff'); x.globalAlpha = 1;
    for (let ry = rugY + 12; ry < rugY + 96; ry += 8) {
      for (let rx = rugX + 12; rx < rugX + 268; rx += 8) {
        x.fillStyle = rugLight;
        x.globalAlpha = 0.06 + Math.random() * 0.06;
        x.fillRect(rx, ry, 4, 4);
        x.globalAlpha = 1;
      }
    }
    for (let rx = rugX + 4; rx < rugX + 276; rx += 4) {
      x.fillStyle = rugLight; x.globalAlpha = 0.5;
      x.fillRect(rx, rugY + 102, 2, 3 + Math.random() * 2);
      x.fillRect(rx, rugY - 2, 2, 3 + Math.random() * 2);
      x.globalAlpha = 1;
    }
    x.restore();
  }

  // ── Couch ──
  if (item('couch')) {
    const { dx, dy } = pd('couch');
    x.save(); x.translate(dx, dy);
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
    x.restore();
  }

  // ── Coffee Table ──
  if (item('coffee_table')) {
    const { dx, dy } = pd('coffee_table');
    x.save(); x.translate(dx, dy);
    const ctC = fc('coffee_table');
    const ctLight = lighten(ctC, 22);
    const ctDark  = darken(ctC, 18);
    x.fillStyle = '#000'; x.globalAlpha = 0.22;
    x.beginPath(); x.ellipse(94, FY + 22, 66, 8, 0, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    r(38, FY + 16, 5, 18, ctDark);
    r(151, FY + 16, 5, 18, ctDark);
    r(38, FY + 26, 118, 4, darken(ctC, 10));
    r(30, FY + 8, 130, 10, ctC);
    r(30, FY + 8, 130, 3, ctLight);
    r(30, FY + 18, 130, 2, ctDark);
    x.globalAlpha = 0.08;
    for (let gx2 = 35; gx2 < 158; gx2 += 12) {
      x.fillStyle = ctLight; x.fillRect(gx2, FY + 9, 1, 8);
    }
    x.globalAlpha = 1;
    x.restore();
  }

  // ── Candles ──
  if (item('candles')) {
    const { dx, dy } = pd('candles');
    x.save(); x.translate(dx, dy);
    const canC   = fc('candles');
    const canLight = lighten(canC, 20);
    const canY = cfg.furniture.includes('coffee_table') ? FY + 6 : FY + 8;
    r(76, canY, 34, 4, '#1a1208');
    x.globalAlpha = 0.25; r(77, canY + 1, 32, 2, '#fff'); x.globalAlpha = 1;
    const candles3: Array<{ cx: number; h: number; col: string; phase: number }> = [
      { cx: 86, h: 28, col: canC,             phase: 0 },
      { cx: 78, h: 18, col: canLight,          phase: 1.3 },
      { cx: 102, h: 14, col: darken(canC, 8), phase: 2.6 },
    ];
    candles3.forEach(({ cx: cv, h, col, phase }) => {
      r(cv - 3, canY - h, 6, h, col);
      r(cv - 3, canY - h, 6, 2, darken(col, 10));
      x.globalAlpha = 0.18; r(cv - 1, canY - h + 2, 2, h - 4, '#fff'); x.globalAlpha = 1;
      x.fillStyle = col; x.globalAlpha = 0.5;
      x.fillRect(cv + 1, canY - h + 2, 2, Math.floor(h / 4)); x.globalAlpha = 1;
      r(cv, canY - h - 4, 1, 4, '#1a0a04');
      candleFlames.push({ x: cv + dx, y: canY - h - 4 + dy, phase });
    });
    x.restore();
  }

  // ── Posters ── (always wall-mounted, drawn on static background)
  if (stat) {
    for (let s = 0; s < 3; s++) {
      const pos = cfg.posterPositions?.[s] ?? POSTER_DEFAULT_POS[s];
      const sz  = POSTER_SIZE[s];
      drawPoster(x, cfg.posters[s], pos.x, pos.y, sz.w, sz.h, light);
    }
  }

  // ── Whiteboard ──
  if (item('whiteboard')) {
    const { dx, dy } = pd('whiteboard');
    x.save(); x.translate(dx, dy);
    const wbC = fc('whiteboard');
    const wbX = 596; const wbY = 14;
    x.fillStyle = '#000'; x.globalAlpha = 0.3;
    x.fillRect(wbX + 3, wbY + 3, 56, 76); x.globalAlpha = 1;
    r(wbX, wbY, 56, 76, wbC);
    x.fillStyle = lighten(wbC, 18); x.globalAlpha = 0.7;
    x.fillRect(wbX, wbY, 56, 3); x.fillRect(wbX, wbY, 3, 76); x.globalAlpha = 1;
    x.fillStyle = darken(wbC, 14); x.globalAlpha = 0.7;
    x.fillRect(wbX, wbY + 73, 56, 3); x.fillRect(wbX + 53, wbY, 3, 76); x.globalAlpha = 1;
    r(wbX + 3, wbY + 3, 50, 66, '#d4cce8');
    x.globalAlpha = 0.04; r(wbX + 3, wbY + 3, 50, 66, '#fff'); x.globalAlpha = 1;
    x.fillStyle = '#806880'; x.globalAlpha = 0.8;
    x.fillRect(wbX + 6, wbY + 8, 28, 2); x.globalAlpha = 1;
    x.fillStyle = '#504060'; x.globalAlpha = 0.7;
    [[6,13,32],[6,17,24],[6,21,28],[6,25,18],[6,31,30],[6,35,22],[6,39,26]].forEach(([ox, oy, w2]) => {
      x.fillRect(wbX + ox, wbY + oy, w2, 2);
    });
    x.globalAlpha = 1;
    x.strokeStyle = '#603878'; x.lineWidth = 1; x.globalAlpha = 0.65;
    x.strokeRect(wbX + 6, wbY + 46, 16, 10);
    x.strokeRect(wbX + 28, wbY + 46, 16, 10);
    x.fillStyle = '#603878'; x.globalAlpha = 0.65;
    x.fillRect(wbX + 22, wbY + 50, 6, 2);
    x.fillRect(wbX + 26, wbY + 48, 2, 6);
    x.globalAlpha = 1;
    r(wbX, wbY + 76, 56, 5, darken(wbC, 6));
    r(wbX + 8,  wbY + 77, 8, 3, '#e87aab');
    r(wbX + 19, wbY + 77, 8, 3, '#5dcaa5');
    x.restore();
  }

  // ── Bookshelf ──
  if (item('bookshelf')) {
    const { dx, dy } = pd('bookshelf');
    x.save(); x.translate(dx, dy);
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
    x.restore();
  }

  // ── Server Rack ──
  if (item('server_rack')) {
    const { dx, dy } = pd('server_rack');
    x.save(); x.translate(dx, dy);
    const srvX = 524; const srvY = FY - 108;
    const srvC = fc('server_rack');
    const srvDark  = darken(srvC, 12);
    const srvLight = lighten(srvC, 14);
    x.fillStyle = '#000'; x.globalAlpha = 0.2;
    x.beginPath(); x.ellipse(srvX + 16, FY + 2, 16, 4, 0, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    r(srvX, srvY, 32, 108, srvC);
    r(srvX,      srvY, 4, 108, srvDark);
    r(srvX + 28, srvY, 4, 108, srvDark);
    r(srvX + 4, srvY + 2, 24, 104, darken(srvC, 8));
    const ledColors = [light.primary, P.teal, P.amber, light.primary, P.pink, P.teal];
    for (let ru = 0; ru < 6; ru++) {
      const ruY = srvY + 4 + ru * 16;
      r(srvX + 5, ruY, 22, 14, darken(srvC, 6));
      r(srvX + 5, ruY, 22, 2, darken(srvC, 14));
      r(srvX + 6,  ruY + 4, 2, 2, srvDark);
      r(srvX + 23, ruY + 4, 2, 2, srvDark);
      x.globalAlpha = 0.12;
      for (let di = 8; di < 20; di += 4) r(srvX + di, ruY + 5, 2, 5, srvLight);
      x.globalAlpha = 1;
      blinkingLEDs.push({ x: srvX + 25 + dx, y: ruY + 9 + dy, color: ledColors[ru], phase: (ru * 1.3) % (Math.PI * 2) });
    }
    x.globalAlpha = 0.3;
    for (let vy = srvY + 100; vy < srvY + 106; vy += 3) r(srvX + 5, vy, 22, 1, srvDark);
    x.globalAlpha = 1;
    r(srvX + 4, srvY, 24, 4, srvDark);
    x.restore();
  }

  // ── Floor Lamp ──
  if (item('lamp')) {
    const { dx, dy } = pd('lamp');
    x.save(); x.translate(dx, dy);
    const lampC = fc('lamp');
    r(205, FY - 140, 3, 140, darken(lampC, 10));
    r(190, FY - 155, 32, 18, lampC);
    r(194, FY - 151, 24, 10, light.primary);
    x.fillStyle = light.primary; x.globalAlpha = 0.04;
    x.beginPath(); x.arc(206, FY - 140, 50, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(206, FY - 140, 80, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 0.025; x.fillRect(150, FY, 120, 40); x.globalAlpha = 1;
    x.restore();
  }

  // ── Plant ──
  if (item('plant')) {
    const { dx, dy } = pd('plant');
    x.save(); x.translate(dx, dy);
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
    x.restore();
  }

  // ── Speaker ──
  if (item('speaker')) {
    const { dx, dy } = pd('speaker');
    x.save(); x.translate(dx, dy);
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
    x.restore();
  }

  // ── Mini Fridge ──
  if (item('minifridge')) {
    const { dx, dy } = pd('minifridge');
    x.save(); x.translate(dx, dy);
    const fridgeC = fc('minifridge');
    r(192, FY - 48, 30, 48, fridgeC);
    r(194, FY - 46, 26, 44, lighten(fridgeC, 10));
    r(194, FY - 20, 26, 2, darken(fridgeC, 10));
    x.fillStyle = light.primary; x.globalAlpha = 0.4;
    x.fillRect(216, FY - 38, 3, 12);
    x.globalAlpha = 1;
    blinkingLEDs.push({ x: 198 + dx, y: FY - 42 + dy, color: light.primary, phase: Math.random() * Math.PI * 2 });
    x.restore();
  }

  // ── Record Player ──
  if (item('record_player')) {
    const { dx, dy } = pd('record_player');
    x.save(); x.translate(dx, dy);
    const rpX = 420; const rpC = fc('record_player');
    const rpDark  = darken(rpC, 16);
    const rpLight = lighten(rpC, 16);
    r(rpX, FY - 22, 28, 22, rpDark);
    r(rpX + 2, FY - 20, 24, 16, darken(rpC, 8));
    x.globalAlpha = 0.18;
    r(rpX + 2, FY - 14, 24, 1, rpLight);
    r(rpX + 2, FY - 8,  24, 1, rpLight);
    x.globalAlpha = 1;
    r(rpX, FY - 38, 28, 16, rpC);
    r(rpX, FY - 38, 28, 3, rpLight);
    r(rpX + 1, FY - 35, 26, 13, darken(rpC, 6));
    x.fillStyle = '#0a0612';
    x.beginPath(); x.ellipse(rpX + 14, FY - 30, 11, 4, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#2a1848'; x.lineWidth = 1; x.globalAlpha = 0.5;
    x.beginPath(); x.ellipse(rpX + 14, FY - 30, 9, 3.2, 0, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.ellipse(rpX + 14, FY - 30, 6, 2.2, 0, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 1;
    x.fillStyle = light.primary; x.globalAlpha = 0.7;
    x.beginPath(); x.ellipse(rpX + 14, FY - 30, 2.5, 1, 0, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    x.strokeStyle = rpLight; x.lineWidth = 1.5; x.globalAlpha = 0.8;
    x.beginPath(); x.moveTo(rpX + 25, FY - 36); x.lineTo(rpX + 16, FY - 30); x.stroke();
    x.globalAlpha = 1;
    x.fillStyle = rpLight;
    x.beginPath(); x.arc(rpX + 25, FY - 36, 1.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = light.primary; x.globalAlpha = 0.03;
    x.beginPath(); x.arc(rpX + 14, FY - 30, 18, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    x.restore();
  }

  // ── Bean Bag ──
  if (item('beanbag')) {
    const { dx, dy } = pd('beanbag');
    x.save(); x.translate(dx, dy);
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
    x.restore();
  }

  // ── Lava Lamp ──
  if (item('lava_lamp')) {
    const { dx, dy } = pd('lava_lamp');
    x.save(); x.translate(dx, dy);
    const llX = 229; const llC = fc('lava_lamp');
    const llDark  = darken(llC, 20);
    const llLight = lighten(llC, 25);
    x.fillStyle = '#000'; x.globalAlpha = 0.18;
    x.beginPath(); x.ellipse(llX + 9, FY + 2, 12, 3, 0, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    r(llX, FY - 12, 18, 12, llDark);
    r(llX + 2, FY - 10, 14, 8, darken(llC, 12));
    x.globalAlpha = 0.2; r(llX + 3, FY - 9, 12, 2, '#fff'); x.globalAlpha = 1;
    r(llX + 5, FY - 68, 8, 56, '#0a0618');
    x.fillStyle = llC; x.globalAlpha = 0.15;
    x.fillRect(llX + 5, FY - 68, 8, 56); x.globalAlpha = 1;
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
    x.fillStyle = '#fff'; x.globalAlpha = 0.07;
    x.fillRect(llX + 5, FY - 68, 2, 56); x.globalAlpha = 1;
    r(llX + 4, FY - 70, 10, 5, llDark);
    r(llX + 6, FY - 68, 6, 2, darken(llC, 8));
    x.fillStyle = llC; x.globalAlpha = 0.04;
    x.beginPath(); x.arc(llX + 9, FY - 40, 28, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    x.restore();
  }

  // ── Arcade Cabinet ──
  if (item('arcade')) {
    const { dx, dy } = pd('arcade');
    x.save(); x.translate(dx, dy);
    const ax = 480; const ay = FY - 110;
    const arcC = fc('arcade');
    const arcDark = darken(arcC, 12);
    r(ax, ay, 42, 110, arcC);
    r(ax + 2, ay + 2, 38, 106, '#0a0818');
    r(ax + 4, ay + 8, 34, 30, arcDark);
    r(ax + 6, ay + 10, 30, 26, '#020108');
    x.fillStyle = '#fff'; x.globalAlpha = 0.4;
    [[8,12],[14,11],[22,13],[26,11],[10,15],[20,17]].forEach(([ox,oy]) => x.fillRect(ax+ox, ay+oy, 1, 1));
    x.globalAlpha = 1;
    r(ax + 6, ay + 10, 30, 4, '#0a0428');
    x.fillStyle = P.amber; x.globalAlpha = 0.7;
    x.fillRect(ax + 8, ay + 11, 10, 2);
    x.fillRect(ax + 26, ay + 11, 6, 2);
    x.globalAlpha = 1;
    x.fillStyle = P.pink; x.globalAlpha = 0.7;
    [0,1,2].forEach(i => { x.fillRect(ax + 9 + i * 8, ay + 18, 4, 3); x.fillRect(ax + 8 + i * 8, ay + 21, 6, 2); });
    x.globalAlpha = 1;
    x.fillStyle = light.primary; x.globalAlpha = 0.8;
    x.fillRect(ax + 18, ay + 31, 6, 3);
    x.fillRect(ax + 20, ay + 29, 2, 2);
    x.globalAlpha = 1;
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
    x.restore();
  }

  // ── Wall TV ──
  if (item('tv')) {
    const { dx, dy } = pd('tv');
    x.save(); x.translate(dx, dy);
    const tvX = 305; const tvY = 46;
    const tvW = 130; const tvH = 78;
    const tvC = fc('tv');
    r(tvX + tvW / 2 - 2, tvY + tvH, 4, 22, darken(tvC, 8));
    r(tvX + tvW / 2 - 14, tvY + tvH + 18, 28, 5, tvC);
    r(tvX, tvY, tvW, tvH, tvC);
    r(tvX + 2, tvY + 2, tvW - 4, tvH - 4, darken(tvC, 10));
    r(tvX + 5, tvY + 5, tvW - 10, tvH - 10, '#060410');
    x.fillStyle = light.primary; x.globalAlpha = 0.08;
    x.fillRect(tvX + 5, tvY + 5, tvW - 10, tvH - 10);
    x.globalAlpha = 1;
    const screenX = tvX + 5; const screenY = tvY + 5;
    const screenW = tvW - 10; const screenH = tvH - 10;
    r(screenX, screenY, screenW, screenH, '#04020c');
    r(screenX, screenY + screenH - 12, screenW, 2, '#1a1030');
    r(screenX + 8,  screenY + screenH - 30, 10, 18, '#0e0828');
    r(screenX + 11, screenY + screenH - 36, 4,  6,  '#0e0828');
    r(screenX + screenW - 22, screenY + screenH - 28, 10, 16, '#0e0828');
    r(screenX + screenW - 19, screenY + screenH - 34, 4,  6,  '#0e0828');
    r(screenX + 20, screenY + screenH - 18, screenW - 40, 4, '#1a1040');
    x.fillStyle = light.primary; x.globalAlpha = 0.12;
    x.fillRect(screenX, screenY, screenW, screenH - 12);
    x.globalAlpha = 1;
    r(screenX, screenY + screenH - 14, screenW, 12, '#0a0040');
    x.fillStyle = light.primary; x.globalAlpha = 0.8;
    x.fillRect(screenX, screenY + screenH - 14, 4, 12);
    x.globalAlpha = 0.4;
    x.fillRect(screenX + 6, screenY + screenH - 11, 40, 2);
    x.fillRect(screenX + 6, screenY + screenH - 7,  28, 2);
    x.globalAlpha = 1;
    for (let sl = screenY; sl < screenY + screenH; sl += 3) {
      x.fillStyle = '#000'; x.globalAlpha = 0.1;
      x.fillRect(screenX, sl, screenW, 1);
    }
    x.globalAlpha = 1;
    x.fillStyle = '#fff'; x.globalAlpha = 0.04;
    x.beginPath(); x.moveTo(screenX + 4, screenY + 4);
    x.lineTo(screenX + 28, screenY + 4);
    x.lineTo(screenX + 14, screenY + 18);
    x.closePath(); x.fill();
    x.globalAlpha = 1;
    x.fillStyle = light.primary; x.globalAlpha = 1;
    x.beginPath(); x.arc(tvX + tvW - 7, tvY + tvH - 6, 2, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 0.3;
    x.beginPath(); x.arc(tvX + tvW - 7, tvY + tvH - 6, 5, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    x.restore();
  }

  // ── Pet Bowls ──
  if (item('pet_bowl')) {
    const { dx, dy } = pd('pet_bowl');
    x.save(); x.translate(dx, dy);
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
    x.restore();
  }

  // ── Pet Bed ──
  if (item('pet_bed')) {
    const { dx, dy } = pd('pet_bed');
    x.save(); x.translate(dx, dy);
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
    x.restore();
  }

  if (!stat) return;

  // ── Ceiling lights + neon strip ──
  const lightColor = (cfg as unknown as { ceilingLightColor?: string }).ceilingLightColor ?? light.primary;
  for (let lx = 30; lx < W - 30; lx += 30) {
    r(lx, 14, 30, 1, wall.accent);
    x.fillStyle = lightColor; x.globalAlpha = 0.7;
    x.fillRect(lx + 13, 15, 4, 5);
    x.globalAlpha = 0.06; x.beginPath(); x.arc(lx + 15, 19, 10, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
  }
  r(0, 0, W, 3, lightColor);
  x.globalAlpha = 0.12; r(0, 0, W, 3, lightColor); x.globalAlpha = 1;

  // ── Computer Desk (always present) ──
  const DSY  = FY - 58;
  const DBOT = FY + 11;
  const deskC   = fc('desk');
  const deskLeg = darken(deskC, 16);

  r(558, DSY,      196, 10, deskC);
  r(558, DSY + 10, 196,  3, deskLeg);
  x.globalAlpha = 0.12;
  r(560, DSY + 2, 80, 1, lighten(deskC, 30)); r(640, DSY + 5, 60, 1, lighten(deskC, 30));
  r(700, DSY + 3, 40, 1, lighten(deskC, 30)); x.globalAlpha = 1;

  r(561, DSY + 13,  8, DBOT - (DSY + 13), deskLeg);
  r(744, DSY + 13,  8, DBOT - (DSY + 13), deskLeg);
  r(561, FY - 8, 191, 5, deskLeg);

  r(561, DSY + 13, 58, DSY + 61 - (DSY + 13), deskC);
  r(564, DSY + 16, 52, 24, deskLeg);
  r(564, DSY + 40, 52, 20, deskLeg);
  r(582, DSY + 26, 14,  3, '#8a6040');
  r(582, DSY + 50, 14,  3, '#8a6040');

  r(647, DSY,      46,  5, FUR_FRAME);
  r(663, DSY - 20, 14, 20, FUR_FRAME);

  r(596, DSY - 82, 134, 62, '#0a0818');
  r(599, DSY - 79, 128, 56, '#050310');
  r(599, DSY - 79,  10, 56, '#080618');

  r(608, DSY - 10, 88, 10, FUR_FRAME);
  r(610, DSY - 9,  84,  8, FUR_DARK);
  for (let kx = 612; kx < 690; kx += 6) {
    x.globalAlpha = 0.2; r(kx, DSY - 8, 4, 5, FUR_MID); x.globalAlpha = 1;
  }

  r(703, DSY - 10, 16, 9, FUR_FRAME);
  r(705, DSY - 8,  12, 6, FUR_DARK);

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

}
