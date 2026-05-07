import { P } from '../config/game.config';
import type { RoomConfig, FurnitureId } from '../stores/roomStore';
import { getFurnitureColor, getRoomConfig, getDefaultPos } from '../stores/roomStore';
import { lighten, darken, makeR } from './roomHelpers';

export function drawForegroundItems(
  x: CanvasRenderingContext2D,
  _W: number,
  _H: number,
  ownerRoomConfig?: RoomConfig,
  onlyId?: FurnitureId,
): void {
  const cfg = ownerRoomConfig ?? getRoomConfig();
  const FY = 300;
  const r = makeR(x);
  const fc = (id: string) => getFurnitureColor(cfg, id as Parameters<typeof getFurnitureColor>[1]);
  const pd = (id: FurnitureId) => {
    const def = getDefaultPos(id);
    const pos = cfg.furniturePositions?.[id] ?? def;
    return { dx: pos.x - def.x, dy: pos.y - def.y };
  };

  // ── Record Crates ──
  if ((!onlyId || onlyId === 'record_crates') && cfg.furniture.includes('record_crates')) {
    const { dx, dy } = pd('record_crates');
    x.save(); x.translate(dx, dy);
    const crateC = fc('record_crates');
    const crateLight = lighten(crateC, 22);
    const crateDark  = darken(crateC, 14);
    const drawCrate = (cx: number, topY: number, cw: number, ch: number) => {
      x.fillStyle = '#000'; x.globalAlpha = 0.18;
      x.beginPath(); x.ellipse(cx + cw / 2, topY + ch + 2, cw / 2 - 2, 4, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
      r(cx, topY, cw, ch, crateDark);
      r(cx + 1, topY + 1, cw - 2, ch - 2, crateC);
      x.strokeStyle = crateDark; x.lineWidth = 1; x.globalAlpha = 0.45;
      for (let gx2 = cx + 8; gx2 < cx + cw - 2; gx2 += 9) {
        x.beginPath(); x.moveTo(gx2, topY + 1); x.lineTo(gx2, topY + ch - 1); x.stroke();
      }
      for (let gy = topY + 8; gy < topY + ch - 2; gy += 9) {
        x.beginPath(); x.moveTo(cx + 1, gy); x.lineTo(cx + cw - 1, gy); x.stroke();
      }
      x.globalAlpha = 1;
      x.fillStyle = crateLight; x.globalAlpha = 0.15; x.fillRect(cx + 1, topY + 1, cw - 2, 3); x.globalAlpha = 1;
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
    x.restore();
  }

  // ── Trunk ──
  if ((!onlyId || onlyId === 'trunk') && cfg.furniture.includes('trunk')) {
    const { dx, dy } = pd('trunk');
    x.save(); x.translate(dx, dy);
    const trX = 100; const trY = FY + 124;
    const trW = 70; const trH = 40;
    const trC = fc('trunk');
    const trLight = lighten(trC, 20);
    const trDark  = darken(trC, 12);
    x.fillStyle = '#000'; x.globalAlpha = 0.2;
    x.beginPath(); x.ellipse(trX + trW / 2, trY + trH + 2, trW / 2 - 4, 5, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
    r(trX, trY, trW, trH, trDark);
    r(trX + 1, trY + 1, trW - 2, trH - 2, trC);
    r(trX, trY, trW, 6, darken(trC, 6));
    x.fillStyle = trLight; x.globalAlpha = 0.18; x.fillRect(trX + 2, trY + 1, trW - 4, 3); x.globalAlpha = 1;
    r(trX, trY + 14, trW, 2, trDark);
    const corners = [[trX, trY], [trX + trW - 6, trY], [trX, trY + trH - 6], [trX + trW - 6, trY + trH - 6]];
    corners.forEach(([cx2, cy2]) => {
      r(cx2, cy2, 6, 6, '#5a5040');
      x.fillStyle = '#9a8870'; x.globalAlpha = 0.5;
      x.fillRect(cx2 + 1, cy2 + 1, 2, 2); x.globalAlpha = 1;
    });
    r(trX, trY + 8, trW, 2, '#5a5040');
    r(trX, trY + trH - 10, trW, 2, '#5a5040');
    r(trX + trW / 2 - 5, trY + 12, 10, 6, '#4a4030');
    r(trX + trW / 2 - 3, trY + 13, 6, 4, '#7a6850');
    x.fillStyle = '#c0a860'; x.globalAlpha = 0.8;
    x.fillRect(trX + trW / 2 - 1, trY + 14, 2, 2); x.globalAlpha = 1;
    x.strokeStyle = trDark; x.lineWidth = 1; x.globalAlpha = 0.18;
    for (let gl = trX + 10; gl < trX + trW - 4; gl += 10) {
      x.beginPath(); x.moveTo(gl, trY + 2); x.lineTo(gl, trY + trH - 2); x.stroke();
    }
    x.globalAlpha = 1;
    x.restore();
  }

  // ── Book Stack ──
  if ((!onlyId || onlyId === 'bookstack') && cfg.furniture.includes('bookstack')) {
    const { dx: bdx, dy: bdy } = pd('bookstack');
    x.save(); x.translate(bdx, bdy);
    const bsX = 182;
    const bsC = fc('bookstack');
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
    const bookH = 8;
    x.fillStyle = '#000'; x.globalAlpha = 0.2;
    x.beginPath(); x.ellipse(bsX + 23, stackBaseY + 3, 26, 4, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
    bookData.forEach((b, i) => {
      const bx = bsX + b.dx;
      const by = stackBaseY - (bookData.length - i) * bookH;
      r(bx, by, b.w, bookH - 1, b.col);
      r(bx, by, 5, bookH - 1, darken(b.col, 14));
      r(bx + b.w - 6, by, 6, bookH - 1, '#c8c0a8');
      x.fillStyle = '#e8e0d0'; x.globalAlpha = 0.55;
      for (let pl = by + 1; pl < by + bookH - 2; pl += 2) {
        x.fillRect(bx + b.w - 5, pl, 4, 1);
      }
      x.globalAlpha = 1;
      x.fillStyle = lighten(b.col, 28); x.globalAlpha = 0.22;
      x.fillRect(bx + 1, by, 3, bookH - 1); x.globalAlpha = 1;
      x.fillStyle = '#000'; x.globalAlpha = 0.25;
      x.fillRect(bx, by + bookH - 1, b.w, 1); x.globalAlpha = 1;
    });
    x.restore();
  }

  // ── Bar Cart ──
  if ((!onlyId || onlyId === 'bar_cart') && cfg.furniture.includes('bar_cart')) {
    const { dx, dy } = pd('bar_cart');
    x.save(); x.translate(dx, dy);
    const bcX = 240; const bcC = fc('bar_cart');
    const bcLight = lighten(bcC, 28);
    const bcDark  = darken(bcC, 12);
    const topShelfY  = FY + 112;
    const botShelfY  = FY + 141;
    const cartW = 56; const shelfH = 4;
    x.fillStyle = '#000'; x.globalAlpha = 0.18;
    x.beginPath(); x.ellipse(bcX + cartW / 2, FY + 175, cartW / 2 - 2, 4, 0, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
    const legXs = [bcX + 4, bcX + cartW - 8];
    legXs.forEach(lx => {
      r(lx, topShelfY, 4, botShelfY - topShelfY + shelfH + 32, bcDark);
      x.fillStyle = bcLight; x.globalAlpha = 0.15; x.fillRect(lx + 1, topShelfY, 1, botShelfY - topShelfY + shelfH + 30); x.globalAlpha = 1;
    });
    x.strokeStyle = bcDark; x.lineWidth = 2; x.globalAlpha = 0.7;
    x.beginPath(); x.moveTo(bcX + 6, topShelfY + 14); x.lineTo(bcX + cartW - 6, botShelfY - 6); x.stroke();
    x.globalAlpha = 1;
    r(bcX, topShelfY, cartW, shelfH, bcC);
    x.fillStyle = bcLight; x.globalAlpha = 0.2; x.fillRect(bcX + 1, topShelfY, cartW - 2, 2); x.globalAlpha = 1;
    r(bcX, botShelfY, cartW, shelfH, bcC);
    x.fillStyle = bcLight; x.globalAlpha = 0.2; x.fillRect(bcX + 1, botShelfY, cartW - 2, 2); x.globalAlpha = 1;
    const wheelY = botShelfY + shelfH + 28;
    [bcX + 6, bcX + cartW - 10].forEach(wx => {
      x.fillStyle = bcDark;
      x.beginPath(); x.arc(wx + 2, wheelY, 5, 0, Math.PI * 2); x.fill();
      x.fillStyle = bcLight; x.globalAlpha = 0.3;
      x.beginPath(); x.arc(wx + 1, wheelY - 1, 2, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1;
    });
    const bottleData = [
      { bx: bcX + 6,  h: 22, w: 8,  col: '#1a3a18' },
      { bx: bcX + 17, h: 18, w: 7,  col: '#3a1a10' },
      { bx: bcX + 27, h: 24, w: 7,  col: '#1a1a30' },
      { bx: bcX + 37, h: 20, w: 6,  col: '#2a3a18' },
    ];
    bottleData.forEach(b => {
      r(b.bx, topShelfY - b.h, b.w, b.h, darken(b.col, 8));
      r(b.bx + 1, topShelfY - b.h + 1, b.w - 2, b.h - 2, b.col);
      r(b.bx + 2, topShelfY - b.h - 6, b.w - 4, 7, darken(b.col, 4));
      r(b.bx + 1, topShelfY - b.h + 5, b.w - 2, 7, lighten(b.col, 30));
      x.fillStyle = '#fff'; x.globalAlpha = 0.1;
      x.fillRect(b.bx + 1, topShelfY - b.h + 1, 2, b.h - 4); x.globalAlpha = 1;
    });
    [[bcX + 8, 10], [bcX + 18, 10], [bcX + 28, 12]].forEach(([gx2, gh]) => {
      r(gx2, botShelfY - gh, 7, gh, '#d0e8f8');
      x.fillStyle = '#fff'; x.globalAlpha = 0.25; x.fillRect(gx2 + 1, botShelfY - gh + 1, 2, gh - 2); x.globalAlpha = 1;
      x.fillStyle = '#000'; x.globalAlpha = 0.1; x.fillRect(gx2, botShelfY - gh, 7, 2); x.globalAlpha = 1;
    });
    x.restore();
  }

  // ── Cat Tree ──
  if ((!onlyId || onlyId === 'cat_tree') && cfg.furniture.includes('cat_tree')) {
    const { dx, dy } = pd('cat_tree');
    x.save(); x.translate(dx, dy);
    const ctX = 776; const ctBotY = FY + 172;
    const ctC = fc('cat_tree');
    const ctLight = lighten(ctC, 22);
    const ctDark  = darken(ctC, 14);
    x.fillStyle = '#000'; x.globalAlpha = 0.2;
    x.beginPath(); x.ellipse(ctX, ctBotY + 1, 20, 4, 0, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    r(ctX - 19, ctBotY - 8, 38, 8, ctDark);
    r(ctX - 17, ctBotY - 6, 34, 5, ctC);
    x.fillStyle = ctLight; x.globalAlpha = 0.2; x.fillRect(ctX - 17, ctBotY - 6, 34, 2); x.globalAlpha = 1;
    r(ctX - 5, ctBotY - 82, 10, 74, ctDark);
    for (let py2 = ctBotY - 82; py2 < ctBotY - 8; py2 += 5) {
      x.fillStyle = ctLight; x.globalAlpha = 0.3; x.fillRect(ctX - 5, py2, 10, 3); x.globalAlpha = 1;
    }
    r(ctX - 20, ctBotY - 52, 40, 6, ctDark);
    r(ctX - 18, ctBotY - 50, 36, 4, ctC);
    x.fillStyle = ctLight; x.globalAlpha = 0.18; x.fillRect(ctX - 18, ctBotY - 50, 36, 2); x.globalAlpha = 1;
    r(ctX - 5, ctBotY - 100, 10, 48, ctDark);
    for (let py2 = ctBotY - 100; py2 < ctBotY - 52; py2 += 5) {
      x.fillStyle = ctLight; x.globalAlpha = 0.3; x.fillRect(ctX - 5, py2, 10, 3); x.globalAlpha = 1;
    }
    r(ctX - 15, ctBotY - 130, 30, 30, ctDark);
    r(ctX - 13, ctBotY - 128, 26, 26, ctC);
    x.fillStyle = ctLight; x.globalAlpha = 0.1; x.fillRect(ctX - 13, ctBotY - 128, 26, 4); x.globalAlpha = 1;
    x.fillStyle = '#06030e';
    x.beginPath(); x.arc(ctX, ctBotY - 115, 7, 0, Math.PI * 2); x.fill();
    r(ctX - 17, ctBotY - 132, 34, 5, ctDark);
    x.fillStyle = ctLight; x.globalAlpha = 0.22; x.fillRect(ctX - 17, ctBotY - 132, 34, 2); x.globalAlpha = 1;
    x.strokeStyle = darken(ctC, 20); x.lineWidth = 1; x.globalAlpha = 0.6;
    x.beginPath(); x.moveTo(ctX - 14, ctBotY - 50); x.lineTo(ctX - 14, ctBotY - 36); x.stroke();
    x.globalAlpha = 1;
    x.fillStyle = P.pink; x.globalAlpha = 0.9;
    x.beginPath(); x.arc(ctX - 14, ctBotY - 33, 4, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff'; x.globalAlpha = 0.25;
    x.beginPath(); x.arc(ctX - 16, ctBotY - 35, 1.5, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    x.restore();
  }
}
