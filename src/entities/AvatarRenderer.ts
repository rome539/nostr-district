/**
 * AvatarRenderer.ts — Layered pixel sprite generator
 *
 * Hub scale: 20x40, Room scale: 24x60
 * Draw order: skin → bottom → top → hair → hat → eyes → accessory
 */

import { AvatarConfig } from '../stores/avatarStore';

export function renderHubSprite(a: AvatarConfig, walkFrame = 0): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 20; c.height = 40;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  const s = 2;
  const cx = 10;
  const headY = 4;
  const tw = 2.5 * s;

  const topDark  = darken(a.topColor, 18);
  const topLight = lighten(a.topColor, 18);

  // ── Skin ──
  x.fillStyle = a.skinColor;
  x.fillRect(cx - 1.5 * s, headY, 3 * s, 2 * s);
  x.fillRect(cx - 2 * s, headY + 2 * s, 4 * s, 3 * s);
  x.fillRect(cx - 1.5 * s, headY + 5 * s, 3 * s, 1 * s);

  // ── Walk animation leg offsets ──
  // Frame 0: left leg up 1px, right leg down 1px. Frame 1: opposite.
  const legLY = walkFrame === 0 ? -1 * s : 1 * s;  // left leg Y offset
  const legRY = walkFrame === 0 ? 1 * s : -1 * s;  // right leg Y offset

  // ── Bottom ──
  x.fillStyle = a.bottomColor;
  if (a.top === 'dress') {
    x.fillRect(cx - 2 * s, headY + 13 * s + legLY, 1.5 * s, 6 * s);
    x.fillRect(cx + 0.5 * s, headY + 13 * s + legRY, 1.5 * s, 6 * s);
  } else if (a.bottom === 'shorts') {
    x.fillRect(cx - 2 * s, headY + 13 * s + legLY, 1.5 * s, 3 * s);
    x.fillRect(cx + 0.5 * s, headY + 13 * s + legRY, 1.5 * s, 3 * s);
    x.fillStyle = a.skinColor;
    x.fillRect(cx - 2 * s, headY + 16 * s + legLY, 1.5 * s, 3 * s);
    x.fillRect(cx + 0.5 * s, headY + 16 * s + legRY, 1.5 * s, 3 * s);
  } else if (a.bottom === 'skirt') {
    x.fillRect(cx - 2.5 * s, headY + 13 * s, 5 * s, 2 * s);
    x.fillStyle = a.skinColor;
    x.fillRect(cx - 2 * s, headY + 15 * s + legLY, 1.5 * s, 4 * s);
    x.fillRect(cx + 0.5 * s, headY + 15 * s + legRY, 1.5 * s, 4 * s);
  } else if (a.bottom === 'joggers') {
    x.fillRect(cx - 2 * s, headY + 13 * s + legLY, 1.5 * s, 6 * s);
    x.fillRect(cx + 0.5 * s, headY + 13 * s + legRY, 1.5 * s, 6 * s);
    x.fillStyle = darken(a.bottomColor, 20);
    x.fillRect(cx - 2 * s, headY + 18 * s + legLY, 1.5 * s, 1 * s);
    x.fillRect(cx + 0.5 * s, headY + 18 * s + legRY, 1.5 * s, 1 * s);
  } else if (a.bottom === 'cargopants') {
    x.fillRect(cx - 2 * s, headY + 13 * s + legLY, 1.5 * s, 6 * s);
    x.fillRect(cx + 0.5 * s, headY + 13 * s + legRY, 1.5 * s, 6 * s);
    x.fillStyle = darken(a.bottomColor, 15);
    x.fillRect(cx - 2 * s, headY + 15 * s + legLY, 1.5 * s, 2 * s);
  } else if (a.bottom === 'overalls') {
    x.fillRect(cx - 2 * s, headY + 13 * s + legLY, 1.5 * s, 6 * s);
    x.fillRect(cx + 0.5 * s, headY + 13 * s + legRY, 1.5 * s, 6 * s);
  } else {
    x.fillRect(cx - 2 * s, headY + 13 * s + legLY, 1.5 * s, 6 * s);
    x.fillRect(cx + 0.5 * s, headY + 13 * s + legRY, 1.5 * s, 6 * s);
  }

  // ── Top ──
  x.fillStyle = a.topColor;
  if (a.top === 'tank') {
    x.fillStyle = a.skinColor;
    x.fillRect(cx - tw, headY + 6 * s, tw * 2, 7 * s);
    x.fillStyle = a.topColor;
    x.fillRect(cx - 1 * s, headY + 6 * s, 2 * s, 7 * s);
  } else if (a.top === 'tshirt') {
    x.fillRect(cx - tw, headY + 6 * s, tw * 2, 7 * s);
    x.fillStyle = a.skinColor;
    x.fillRect(cx - tw, headY + 9 * s, 1 * s, 4 * s);
    x.fillRect(cx + tw - 1 * s, headY + 9 * s, 1 * s, 4 * s);
  } else if (a.top === 'hoodie') {
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 8 * s);
    x.fillStyle = topDark;
    x.fillRect(cx - 1 * s, headY + 9 * s, 2 * s, 2 * s);
    x.fillRect(cx - 1.5 * s, headY + 5 * s, 3 * s, 1.5 * s);
  } else if (a.top === 'jacket') {
    x.fillRect(cx - tw, headY + 6 * s, tw * 2, 7 * s);
    x.fillStyle = '#0e0a18';
    x.fillRect(cx - 0.5 * s, headY + 7 * s, 1 * s, 5 * s);
    x.fillStyle = '#c8c8c8'; x.globalAlpha = 0.5;
    x.fillRect(cx, headY + 7 * s, 0.5 * s, 5 * s);
    x.globalAlpha = 1;
  } else if (a.top === 'dress') {
    x.fillRect(cx - 2 * s, headY + 6 * s, 4 * s, 7 * s);
    x.fillRect(cx - tw, headY + 13 * s, tw * 2, 3 * s);
    x.fillStyle = topDark;
    x.fillRect(cx - 2 * s, headY + 12 * s, 4 * s, 1 * s);
  } else if (a.top === 'vest') {
    x.fillStyle = a.skinColor;
    x.fillRect(cx - tw, headY + 6 * s, tw * 2, 7 * s);
    x.fillStyle = a.topColor;
    x.fillRect(cx - tw, headY + 6 * s, 1 * s, 7 * s);
    x.fillRect(cx + tw - 1 * s, headY + 6 * s, 1 * s, 7 * s);
    x.fillStyle = topDark;
    x.fillRect(cx - 0.5 * s, headY + 7 * s, 1 * s, 5 * s);
  } else if (a.top === 'trenchcoat') {
    x.fillRect(cx - tw - 0.5 * s, headY + 5 * s, (tw + 0.5 * s) * 2, 9 * s);
    x.fillStyle = topDark;
    x.fillRect(cx - 0.5 * s, headY + 6 * s, 1 * s, 7 * s);
    x.fillRect(cx - tw - 0.5 * s, headY + 5 * s, tw + 0.5 * s, 2 * s);
    x.fillRect(cx, headY + 5 * s, tw + 0.5 * s, 2 * s);
    x.fillStyle = topLight; x.globalAlpha = 0.4;
    x.fillRect(cx - tw, headY + 5 * s, 1 * s, 1 * s);
    x.fillRect(cx + tw - 1 * s, headY + 5 * s, 1 * s, 1 * s);
    x.globalAlpha = 1;
  } else if (a.top === 'croptop') {
    x.fillRect(cx - tw, headY + 6 * s, tw * 2, 4 * s);
    x.fillStyle = a.skinColor;
    x.fillRect(cx - tw, headY + 10 * s, tw * 2, 3 * s);
    x.fillStyle = topDark;
    x.fillRect(cx - tw, headY + 6 * s, tw * 2, 0.5 * s);
  } else if (a.top === 'jersey') {
    x.fillRect(cx - tw, headY + 6 * s, tw * 2, 7 * s);
    x.fillStyle = topDark;
    x.fillRect(cx - 0.5 * s, headY + 7 * s, 1 * s, 5 * s);
    x.fillStyle = topLight; x.globalAlpha = 0.5;
    x.fillRect(cx - tw, headY + 9 * s, tw * 2, 1 * s);
    x.globalAlpha = 1;
    x.fillStyle = topDark;
    x.fillRect(cx - tw, headY + 7 * s, 0.5 * s, 2 * s);
    x.fillRect(cx + tw - 0.5 * s, headY + 7 * s, 0.5 * s, 2 * s);
  }

  // ── Overalls straps — only visible over open tops (not coats/hoodie/vest) ──
  const strapOverTop = !['hoodie', 'jacket', 'trenchcoat', 'vest'].includes(a.top);
  if (a.bottom === 'overalls' && strapOverTop) {
    x.fillStyle = a.bottomColor;
    x.fillRect(cx - 1 * s,   headY + 6 * s, 0.5 * s, 7 * s);
    x.fillRect(cx + 0.5 * s, headY + 6 * s, 0.5 * s, 7 * s);
    x.fillStyle = '#d4af37'; x.globalAlpha = 0.7;
    x.fillRect(cx - 1 * s,   headY + 8 * s, 0.5 * s, 1 * s);
    x.fillRect(cx + 0.5 * s, headY + 8 * s, 0.5 * s, 1 * s);
    x.globalAlpha = 1;
  }

  // ── Hair ──
  const hasHat = a.hat !== 'none';
  const longHairStyle = ['long', 'ponytail', 'mullet'].includes(a.hair);
  if (a.hair !== 'none') {
    x.fillStyle = a.hairColor;
    if (!hasHat) {
      // No hat — draw full hair
      drawHubHair(x, a.hair, cx, headY, s);
    } else if (longHairStyle) {
      // Hat on, but long/ponytail/mullet — draw only the hanging side parts
      drawHubHairSidesOnly(x, a.hair, cx, headY, s);
    }
    // All other hair styles: hidden completely under hat
  }

  // ── Hat ──
  if (hasHat) {
    x.fillStyle = a.hatColor;
    drawHubHat(x, a.hat, cx, headY, s);
  }

  // ── Eyes (before accessories so acc draws on top) ──
  drawHubEyes(x, a, cx, headY, s);

  // ── Accessory ──
  if (a.accessory !== 'none') {
    x.fillStyle = a.accessoryColor;
    drawHubAccessory(x, a.accessory, cx, headY, s);
  }

  return c;
}

export function renderRoomSprite(a: AvatarConfig): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 24; c.height = 60;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  const oY = 8;

  const topDark  = darken(a.topColor, 18);
  const topLight = lighten(a.topColor, 18);

  // ── Skin (head + neck) ──
  x.fillStyle = a.skinColor;
  x.fillRect(7, oY + 0, 10, 4);
  x.fillRect(5, oY + 2, 14, 8);
  x.fillRect(7, oY + 10, 10, 2);
  x.fillRect(9, oY + 12, 6, 2);

  // ── Bottom ──
  x.fillStyle = a.bottomColor;
  if (a.top === 'dress') {
    x.fillRect(7, oY + 30, 4, 14);
    x.fillRect(13, oY + 30, 4, 14);
  } else if (a.bottom === 'shorts') {
    x.fillRect(7, oY + 30, 4, 6);
    x.fillRect(13, oY + 30, 4, 6);
    x.fillStyle = a.skinColor;
    x.fillRect(7, oY + 36, 4, 8);
    x.fillRect(13, oY + 36, 4, 8);
  } else if (a.bottom === 'skirt') {
    x.fillRect(5, oY + 28, 14, 6);
    x.fillStyle = a.skinColor;
    x.fillRect(7, oY + 34, 4, 10);
    x.fillRect(13, oY + 34, 4, 10);
  } else if (a.bottom === 'joggers') {
    x.fillRect(7, oY + 30, 4, 14);
    x.fillRect(13, oY + 30, 4, 14);
    x.fillStyle = darken(a.bottomColor, 20);
    x.fillRect(7, oY + 42, 4, 2);
    x.fillRect(13, oY + 42, 4, 2);
  } else if (a.bottom === 'cargopants') {
    x.fillRect(7, oY + 30, 4, 14);
    x.fillRect(13, oY + 30, 4, 14);
    x.fillStyle = darken(a.bottomColor, 15);
    x.fillRect(7, oY + 33, 4, 4);
    x.fillRect(13, oY + 33, 4, 4);
    x.fillStyle = darken(a.bottomColor, 25);
    x.fillRect(7, oY + 37, 4, 1);
    x.fillRect(13, oY + 37, 4, 1);
  } else if (a.bottom === 'overalls') {
    x.fillRect(7, oY + 30, 4, 14);
    x.fillRect(13, oY + 30, 4, 14);
    // Waistband
    x.fillStyle = darken(a.bottomColor, 10);
    x.fillRect(5, oY + 28, 14, 3);
  } else {
    x.fillRect(7, oY + 30, 4, 14);
    x.fillRect(13, oY + 30, 4, 14);
  }

  // Feet
  x.fillStyle = darken(a.bottomColor, 20);
  x.fillRect(5, oY + 44, 6, 3);
  x.fillRect(13, oY + 44, 6, 3);

  // ── Top ──
  x.fillStyle = a.topColor;
  if (a.top === 'tank') {
    x.fillStyle = a.skinColor;
    x.fillRect(3, oY + 14, 18, 14);
    x.fillStyle = a.topColor;
    x.fillRect(7, oY + 14, 2, 2);
    x.fillRect(15, oY + 14, 2, 2);
    x.fillRect(7, oY + 16, 10, 12);
    x.fillRect(7, oY + 28, 10, 2);
  } else if (a.top === 'tshirt') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(5, oY + 18, 14, 10);
    x.fillRect(7, oY + 28, 10, 2);
    x.fillStyle = a.skinColor;
    x.fillRect(3, oY + 18, 2, 10);
    x.fillRect(19, oY + 18, 2, 10);
    x.fillStyle = topDark;
    x.fillRect(8, oY + 14, 8, 1);
  } else if (a.top === 'hoodie') {
    x.fillRect(3, oY + 14, 18, 4);    // shoulders + sleeves
    x.fillRect(3, oY + 18, 18, 10);   // body
    x.fillRect(6, oY + 28, 12, 2);    // hem
    x.fillStyle = topDark;
    x.fillRect(9, oY + 14, 6, 1);     // subtle collar line only — matches hub
    x.fillRect(9, oY + 22, 6, 3);     // pocket
    x.fillStyle = topLight; x.globalAlpha = 0.5;
    x.fillRect(11, oY + 18, 1, 3);    // drawstring L
    x.fillRect(13, oY + 18, 1, 3);    // drawstring R
    x.globalAlpha = 1;
  } else if (a.top === 'jacket') {
    x.fillRect(3, oY + 14, 18, 4);    // shoulders
    x.fillRect(3, oY + 18, 18, 10);   // body
    x.fillRect(6, oY + 28, 12, 2);    // hem
    x.fillStyle = '#0e0a18';           // dark neutral undershirt (not purple)
    x.fillRect(11, oY + 17, 2, 11);   // narrow center gap
    x.fillStyle = topLight;
    x.fillRect(7, oY + 15, 4, 5);     // left lapel
    x.fillRect(13, oY + 15, 4, 5);    // right lapel
    x.fillStyle = '#c8c8c8'; x.globalAlpha = 0.5;
    x.fillRect(12, oY + 18, 1, 10);   // zipper
    x.globalAlpha = 1;
    x.fillStyle = topDark;
    x.fillRect(3, oY + 27, 18, 1);    // bottom hem line
  } else if (a.top === 'dress') {
    x.fillRect(5, oY + 14, 14, 4);
    x.fillRect(5, oY + 18, 14, 10);
    x.fillRect(3, oY + 28, 18, 8);
    x.fillStyle = a.skinColor;
    x.fillRect(3, oY + 14, 2, 14);
    x.fillRect(19, oY + 14, 2, 14);
    x.fillStyle = topDark;
    x.fillRect(5, oY + 27, 14, 2);
  } else if (a.top === 'vest') {
    x.fillStyle = a.skinColor;
    x.fillRect(3, oY + 14, 18, 14);
    x.fillStyle = a.topColor;
    x.fillRect(5, oY + 14, 6, 14);
    x.fillRect(13, oY + 14, 6, 14);
    x.fillStyle = topDark;
    x.fillRect(11, oY + 15, 2, 12);
    x.fillRect(5, oY + 14, 14, 2);
  } else if (a.top === 'trenchcoat') {
    x.fillRect(1, oY + 14, 22, 4);
    x.fillRect(1, oY + 18, 22, 10);
    x.fillRect(4, oY + 28, 16, 4);
    x.fillStyle = topDark;
    x.fillRect(10, oY + 15, 4, 13);
    x.fillStyle = topLight;
    x.fillRect(5, oY + 14, 5, 6);
    x.fillRect(14, oY + 14, 5, 6);
    x.fillStyle = topDark;
    x.fillRect(3, oY + 27, 18, 1);
    x.fillStyle = darken(a.topColor, 35);
    x.fillRect(3, oY + 24, 18, 2); // belt
    x.fillRect(11, oY + 23, 2, 4); // buckle
  } else if (a.top === 'croptop') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(5, oY + 18, 14, 6);
    x.fillStyle = a.skinColor;
    x.fillRect(3, oY + 18, 2, 10);
    x.fillRect(19, oY + 18, 2, 10);
    x.fillRect(5, oY + 24, 14, 4);
    x.fillStyle = topDark;
    x.fillRect(8, oY + 14, 8, 1);
  } else if (a.top === 'jersey') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(3, oY + 18, 18, 10);
    x.fillRect(6, oY + 28, 12, 2);
    x.fillStyle = topDark;
    x.fillRect(11, oY + 15, 2, 13);
    x.fillRect(3, oY + 17, 2, 2);
    x.fillRect(19, oY + 17, 2, 2);
    x.fillStyle = topLight; x.globalAlpha = 0.45;
    x.fillRect(3, oY + 22, 18, 2);
    x.globalAlpha = 1;
    x.fillStyle = topDark;
    x.fillRect(8, oY + 14, 8, 1);
  }

  // ── Overalls straps — only visible over open tops (not coats/hoodie/vest) ──
  const strapOverTop = !['hoodie', 'jacket', 'trenchcoat', 'vest'].includes(a.top);
  if (a.bottom === 'overalls' && strapOverTop) {
    x.fillStyle = a.bottomColor;
    x.fillRect(8,  oY + 14, 3, 16);
    x.fillRect(13, oY + 14, 3, 16);
    x.fillStyle = '#d4af37'; x.globalAlpha = 0.7;
    x.fillRect(8,  oY + 19, 3, 2);
    x.fillRect(13, oY + 19, 3, 2);
    x.globalAlpha = 1;
  }

  // ── Hair ──
  const hasHat = a.hat !== 'none';
  const longHairStyle = ['long', 'ponytail', 'mullet'].includes(a.hair);
  if (a.hair !== 'none') {
    x.fillStyle = a.hairColor;
    if (!hasHat) {
      drawRoomHair(x, a.hair, oY);
    } else if (longHairStyle) {
      drawRoomHairSidesOnly(x, a.hair, oY);
    }
  }

  // ── Hat ──
  if (hasHat) {
    x.fillStyle = a.hatColor;
    drawRoomHat(x, a.hat, oY);
  }

  // ── Eyes (before accessories so acc draws on top) ──
  drawRoomEyes(x, a, oY);

  // ── Accessory ──
  if (a.accessory !== 'none') {
    x.fillStyle = a.accessoryColor;
    drawRoomAccessory(x, a.accessory, oY);
  }

  return c;
}

// ══════════════════════════════════════
// HAIR — hub scale
// ══════════════════════════════════════
function drawHubHair(x: CanvasRenderingContext2D, hair: string, cx: number, hy: number, s: number): void {
  switch (hair) {
    case 'short':
      x.fillRect(cx - 2 * s, hy, 4 * s, 2 * s);
      x.fillRect(cx - 2.5 * s, hy + 1 * s, 1 * s, 2 * s);
      break;
    case 'mohawk':
      x.fillRect(cx - 0.5 * s, hy - 2 * s, 1 * s, 3 * s);
      x.fillRect(cx - 1 * s, hy - 1 * s, 2 * s, 2 * s);
      break;
    case 'long':
      x.fillRect(cx - 2 * s, hy, 4 * s, 2 * s);
      x.fillRect(cx - 2.5 * s, hy + 1 * s, 1 * s, 5 * s);
      x.fillRect(cx + 1.5 * s, hy + 1 * s, 1 * s, 5 * s);
      break;
    case 'ponytail':
      x.fillRect(cx - 2 * s, hy, 4 * s, 2 * s);
      x.fillRect(cx + 1.5 * s, hy + 2 * s, 1 * s, 4 * s);
      break;
    case 'spiky':
      x.fillRect(cx - 2 * s, hy - 1 * s, 1 * s, 2 * s);
      x.fillRect(cx - 0.5 * s, hy - 2 * s, 1 * s, 2 * s);
      x.fillRect(cx + 1 * s, hy - 1 * s, 1 * s, 2 * s);
      x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s);
      break;
    case 'buzz':
      x.fillRect(cx - 2 * s, hy, 4 * s, 1.5 * s);
      break;
    case 'afro':
      x.fillRect(cx - 3 * s, hy - 1 * s, 6 * s, 4 * s);
      x.fillRect(cx - 2 * s, hy - 2 * s, 4 * s, 2 * s);
      break;
    case 'bun':
      x.fillRect(cx - 2 * s, hy, 4 * s, 1.5 * s);
      x.fillRect(cx - 1 * s, hy - 2 * s, 2 * s, 2 * s);
      break;
    case 'curtains':
      x.fillRect(cx - 2 * s, hy, 4 * s, 2 * s);
      x.fillRect(cx - 2.5 * s, hy + 1 * s, 1.5 * s, 3 * s);
      x.fillRect(cx + 1 * s, hy + 1 * s, 1.5 * s, 3 * s);
      break;
    case 'mullet':
      x.fillRect(cx - 2 * s, hy, 4 * s, 2 * s);         // top
      x.fillRect(cx + 1.5 * s, hy + 2 * s, 1 * s, 6 * s); // long right hang
      x.fillRect(cx - 2.5 * s, hy + 2 * s, 1 * s, 6 * s); // long left hang
      break;
  }
}

// ══════════════════════════════════════
// HAIR SIDES ONLY — hub (for when hat is worn)
// ══════════════════════════════════════
function drawHubHairSidesOnly(x: CanvasRenderingContext2D, hair: string, cx: number, hy: number, s: number): void {
  switch (hair) {
    case 'long':
      x.fillRect(cx - 2.5 * s, hy + 1 * s, 1 * s, 5 * s); // left hang
      x.fillRect(cx + 1.5 * s, hy + 1 * s, 1 * s, 5 * s); // right hang
      break;
    case 'ponytail':
      x.fillRect(cx + 1.5 * s, hy + 2 * s, 1 * s, 4 * s); // tail
      break;
    case 'mullet':
      x.fillRect(cx - 2.5 * s, hy + 2 * s, 1 * s, 6 * s); // left hang
      x.fillRect(cx + 1.5 * s, hy + 2 * s, 1 * s, 6 * s); // right hang
      break;
  }
}

// ══════════════════════════════════════
// HAIR SIDES ONLY — room (for when hat is worn)
// ══════════════════════════════════════
function drawRoomHairSidesOnly(x: CanvasRenderingContext2D, hair: string, oY: number): void {
  switch (hair) {
    case 'long':
      x.fillRect(3, oY + 2, 4, 10);  // left hang
      x.fillRect(17, oY + 2, 4, 10); // right hang
      break;
    case 'ponytail':
      x.fillRect(17, oY + 4, 3, 8);  // tail
      break;
    case 'mullet':
      x.fillRect(15, oY + 2, 3, 14); // left back hang
      x.fillRect(18, oY + 2, 3, 14); // right back hang
      break;
  }
}
function drawRoomHair(x: CanvasRenderingContext2D, hair: string, oY: number): void {
  switch (hair) {
    case 'short':
      x.fillRect(5, oY, 14, 4);
      x.fillRect(3, oY + 2, 4, 4);
      break;
    case 'mohawk':
      x.fillRect(9, oY - 4, 6, 6);
      x.fillRect(10, oY - 6, 4, 3);
      break;
    case 'long':
      x.fillRect(5, oY, 14, 4);
      x.fillRect(3, oY + 2, 4, 10);
      x.fillRect(17, oY + 2, 4, 10);
      break;
    case 'ponytail':
      x.fillRect(5, oY, 14, 4);
      x.fillRect(17, oY + 4, 3, 8);
      break;
    case 'spiky':
      x.fillRect(5, oY - 2, 4, 4);
      x.fillRect(10, oY - 4, 4, 4);
      x.fillRect(15, oY - 2, 4, 4);
      x.fillRect(5, oY, 14, 3);
      break;
    case 'buzz':
      x.fillRect(5, oY, 14, 3);
      break;
    case 'afro':
      x.fillRect(4, oY - 4, 16, 6);   // top puff - raised higher
      x.fillRect(2, oY - 2, 4, 5);    // left puff
      x.fillRect(18, oY - 2, 4, 5);   // right puff
      x.fillRect(5, oY, 14, 3);       // base band across forehead only
      break;
    case 'bun':
      x.fillRect(5, oY, 14, 3);
      x.fillRect(9, oY - 4, 6, 5);
      x.fillRect(11, oY - 5, 2, 2);
      break;
    case 'curtains':
      x.fillRect(5, oY, 14, 4);
      x.fillRect(3, oY + 2, 6, 6);
      x.fillRect(15, oY + 2, 6, 6);
      break;
    case 'mullet':
      x.fillRect(5, oY, 14, 4);       // top
      x.fillRect(3, oY + 2, 3, 3);    // left side
      x.fillRect(18, oY + 2, 3, 14);  // long right back hang
      x.fillRect(15, oY + 2, 3, 14);  // long left back hang
      break;
  }
}

// ══════════════════════════════════════
// HATS — hub scale
// ══════════════════════════════════════
function drawHubHat(x: CanvasRenderingContext2D, hat: string, cx: number, hy: number, s: number): void {
  const hatY = hy + s + 2;
  switch (hat) {
    case 'cap':
      x.fillRect(cx - 2 * s, hatY - 2 * s, 4 * s, 1 * s);
      x.fillRect(cx - 2 * s, hatY - 1 * s, 2 * s, 0.5 * s);
      break;
    case 'beanie':
      x.fillRect(cx - 2 * s, hatY - 3 * s, 4 * s, 2 * s);
      x.fillRect(cx - 0.5 * s, hatY - 4 * s, 1 * s, 1 * s);
      break;
    case 'tophat':
      x.fillRect(cx - 1.5 * s, hatY - 5 * s, 3 * s, 3 * s);
      x.fillRect(cx - 2 * s, hatY - 2 * s, 4 * s, 1 * s);
      break;
    case 'cowboy': {
      x.fillRect(cx - 1.5 * s, hatY - 4 * s, 3 * s, 2 * s);
      x.fillRect(cx - 3 * s, hatY - 2 * s, 6 * s, 1 * s);
      const cSave = x.fillStyle as string;
      x.fillStyle = darken(cSave, 20);
      x.fillRect(cx - 1.5 * s, hatY - 4 * s, 3 * s, 0.5 * s);
      x.fillStyle = cSave;
      break;
    }
    case 'beret':
      x.fillRect(cx - 2 * s, hatY - 2 * s, 4 * s, 1 * s);
      x.fillRect(cx - 1 * s, hatY - 3 * s, 3 * s, 1 * s);
      x.fillRect(cx - 2 * s, hatY - 1 * s, 4 * s, 0.5 * s);
      break;
    case 'bucket':
      x.fillRect(cx - 2 * s, hatY - 3 * s, 4 * s, 2 * s);
      x.fillRect(cx - 2 * s, hatY - 1 * s, 4 * s, 1 * s);
      break;
    case 'crown': {
      const crSave = x.fillStyle as string;
      x.fillStyle = '#f0c040';
      x.fillRect(cx - 2 * s, hatY - 3 * s, 4 * s, 1.5 * s);
      x.fillRect(cx - 2 * s, hatY - 4 * s, 1 * s, 1 * s);
      x.fillRect(cx - 0.5 * s, hatY - 5 * s, 1 * s, 1.5 * s);
      x.fillRect(cx + 1 * s, hatY - 4 * s, 1 * s, 1 * s);
      x.fillStyle = '#e87a10'; x.globalAlpha = 0.7;
      x.fillRect(cx - 1 * s, hatY - 2 * s, 1 * s, 0.5 * s);
      x.globalAlpha = 1;
      x.fillStyle = crSave;
      break;
    }
  }
}

// ══════════════════════════════════════
// HATS — room scale
// ══════════════════════════════════════
function drawRoomHat(x: CanvasRenderingContext2D, hat: string, oY: number): void {
  switch (hat) {
    case 'cap':
      x.fillRect(5, oY - 1, 14, 4);
      x.fillRect(2, oY + 2, 8, 2);
      break;
    case 'beanie':
      x.fillRect(5, oY - 3, 14, 5);
      x.fillRect(10, oY - 5, 4, 3);
      break;
    case 'tophat':
      x.fillRect(7, oY - 8, 10, 8);
      x.fillRect(4, oY - 1, 16, 3);
      break;
    case 'cowboy': {
      x.fillRect(7, oY - 6, 10, 6);
      x.fillRect(2, oY - 1, 20, 3);
      const cowSave = x.fillStyle as string;
      x.fillStyle = darken(cowSave, 20);
      x.fillRect(7, oY - 6, 10, 1);
      x.fillStyle = cowSave;
      break;
    }
    case 'beret': {
      const berSave = x.fillStyle as string;
      x.fillRect(5, oY - 2, 14, 4);
      x.fillRect(7, oY - 4, 12, 3);
      x.fillStyle = darken(berSave, 20);
      x.fillRect(5, oY,     14, 2);
      x.fillStyle = berSave;
      break;
    }
    case 'bucket':
      x.fillRect(6, oY - 4, 12, 5);
      x.fillRect(4, oY + 1, 16, 2);
      break;
    case 'crown': {
      const crSave = x.fillStyle as string;
      x.fillStyle = '#f0c040';
      x.fillRect(5, oY - 4, 14, 5);
      x.fillRect(5,  oY - 7, 3, 3);
      x.fillRect(11, oY - 8, 2, 4);
      x.fillRect(16, oY - 7, 3, 3);
      x.fillStyle = '#e05020'; x.globalAlpha = 0.8;
      x.fillRect(9,  oY - 3, 2, 2);
      x.fillRect(13, oY - 3, 2, 2);
      x.globalAlpha = 1;
      x.fillStyle = crSave;
      break;
    }
  }
}

// ══════════════════════════════════════
// ACCESSORIES — hub scale
// ══════════════════════════════════════
function drawHubAccessory(x: CanvasRenderingContext2D, acc: string, cx: number, hy: number, s: number): void {
  const savedColor = x.fillStyle as string;
  switch (acc) {
    case 'glasses':
      x.globalAlpha = 0.8;
      x.fillRect(cx - 1 * s, hy + 3 * s, 1 * s, 0.5 * s);
      x.fillRect(cx + 0.5 * s, hy + 3 * s, 1 * s, 0.5 * s);
      x.fillRect(cx - 0.5 * s, hy + 3 * s, 1 * s, 0.5 * s);
      x.globalAlpha = 1;
      break;
    case 'sunglasses':
      x.globalAlpha = 0.9;
      x.fillRect(cx - 1.5 * s, hy + 2.5 * s, 1.5 * s, 1 * s);
      x.fillRect(cx + 0.5 * s, hy + 2.5 * s, 1.5 * s, 1 * s);
      x.fillRect(cx - 0.5 * s, hy + 2.5 * s, 1 * s, 0.5 * s);
      x.globalAlpha = 1;
      break;
    case 'bandana': {
      x.globalAlpha = 1;
      // Band across face
      x.fillRect(cx - 2 * s, hy + 3.5 * s, 4 * s, 1.5 * s);
      // Triangle point hanging down
      x.fillRect(cx - 1 * s, hy + 5 * s, 2 * s, 1 * s);
      x.fillRect(cx - 0.5 * s, hy + 6 * s, 1 * s, 0.5 * s);
      // Lighter top fold
      x.fillStyle = lighten(savedColor, 22); x.globalAlpha = 0.5;
      x.fillRect(cx - 2 * s, hy + 3.5 * s, 4 * s, 0.5 * s);
      x.globalAlpha = 1;
      // Knot at back right
      x.fillStyle = darken(savedColor, 20);
      x.fillRect(cx + 2 * s, hy + 4 * s, 1 * s, 0.5 * s);
      x.fillStyle = savedColor;
      break;
    }
    case 'scarf':
      x.fillRect(cx - 2 * s, hy + 5.5 * s, 4 * s, 1.5 * s);
      x.fillRect(cx + 1.5 * s, hy + 6 * s, 1 * s, 2 * s);
      break;
    case 'eyepatch':
      x.globalAlpha = 0.9;
      x.fillRect(cx + 0.5 * s, hy + 3 * s, 1.5 * s, 1 * s);
      x.globalAlpha = 1;
      break;
    case 'chain':
      x.fillStyle = '#d4af37'; x.globalAlpha = 0.75;
      for (let i = 0; i < 4; i++) x.fillRect(cx - 1.5 * s + i * 0.75 * s, hy + 5.5 * s, 0.5 * s, 0.5 * s);
      x.fillStyle = savedColor; x.globalAlpha = 1;
      break;
    case 'earrings':
      x.globalAlpha = 0.9;
      x.fillRect(cx - 2.5 * s, hy + 4 * s, 0.5 * s, 1 * s);
      x.fillRect(cx + 2 * s,   hy + 4 * s, 0.5 * s, 1 * s);
      x.globalAlpha = 1;
      break;
  }
}

// ══════════════════════════════════════
// ACCESSORIES — room scale
// ══════════════════════════════════════
function drawRoomAccessory(x: CanvasRenderingContext2D, acc: string, oY: number): void {
  const savedColor = x.fillStyle as string;
  switch (acc) {
    case 'glasses':
      x.globalAlpha = 0.85;
      x.fillRect(7, oY + 5, 4, 2);
      x.fillRect(13, oY + 5, 4, 2);
      x.fillRect(11, oY + 5, 2, 1);
      x.globalAlpha = 1;
      break;
    case 'sunglasses':
      x.globalAlpha = 0.95;
      x.fillRect(6, oY + 5, 5, 2);
      x.fillRect(13, oY + 5, 5, 2);
      x.fillRect(11, oY + 5, 2, 1);
      x.fillRect(3,  oY + 5, 3, 1);
      x.fillRect(18, oY + 5, 3, 1);
      x.globalAlpha = 1;
      break;
    case 'bandana': {
      x.globalAlpha = 1;
      // Main band across lower face
      x.fillRect(5, oY + 6, 14, 4);
      // Triangle point down
      x.fillRect(8,  oY + 10, 8, 2);
      x.fillRect(10, oY + 12, 4, 2);
      x.fillRect(11, oY + 14, 2, 1);
      // Top fold stripe
      x.fillStyle = lighten(savedColor, 22); x.globalAlpha = 0.5;
      x.fillRect(5, oY + 6, 14, 1);
      x.globalAlpha = 1;
      // Knot at right side
      x.fillStyle = darken(savedColor, 20);
      x.fillRect(19, oY + 7, 3, 2);
      x.fillRect(20, oY + 9, 2, 1);
      x.fillStyle = savedColor;
      break;
    }
    case 'scarf':
      x.fillRect(5, oY + 11, 14, 3);
      x.fillRect(17, oY + 12, 3, 6);
      break;
    case 'eyepatch':
      x.globalAlpha = 0.9;
      x.fillRect(13, oY + 5, 4, 3);
      x.fillRect(10, oY + 4, 8, 1);
      x.globalAlpha = 1;
      break;
    case 'chain':
      x.fillStyle = '#d4af37'; x.globalAlpha = 0.8;
      for (let i = 0; i < 6; i++) x.fillRect(7 + i * 2, oY + 13, 2, 2);
      x.fillStyle = savedColor; x.globalAlpha = 1;
      break;
    case 'earrings':
      x.globalAlpha = 0.9;
      x.fillRect(4,  oY + 7, 2, 3);
      x.fillRect(18, oY + 7, 2, 3);
      x.globalAlpha = 1;
      break;
  }
}

// ══════════════════════════════════════
// EYES — hub scale
// ══════════════════════════════════════
function drawHubEyes(x: CanvasRenderingContext2D, a: AvatarConfig, cx: number, headY: number, s: number): void {
  const col = a.eyeColor || '#ffffff';
  const ey = headY + 3 * s;
  x.fillStyle = col;
  switch (a.eyes) {
    case 'wide':
      x.globalAlpha = 0.85;
      x.fillRect(cx - 2, ey - 1, 2, 2);
      x.fillRect(cx + 1, ey - 1, 2, 2);
      break;
    case 'angry':
      x.globalAlpha = 0.75;
      x.fillRect(cx - 2, ey, 1, 1);
      x.fillRect(cx + 1, ey, 1, 1);
      x.fillRect(cx - 2, ey - 2, 2, 1);
      x.fillRect(cx + 1, ey - 2, 2, 1);
      break;
    case 'happy':
      x.globalAlpha = 0.75;
      x.fillRect(cx - 2, ey + 1, 2, 1);
      x.fillRect(cx + 1, ey + 1, 2, 1);
      break;
    case 'wink':
      x.globalAlpha = 0.9;
      x.fillRect(cx + 1, ey - 1, 1, 2);
      x.fillRect(cx - 2, ey, 2, 1);
      break;
    case 'star':
      x.globalAlpha = 0.9;
      x.fillRect(cx - 2, ey + 1, 2, 1);
      x.fillRect(cx - 1, ey, 1, 3);
      x.fillRect(cx + 1, ey + 1, 2, 1);
      x.fillRect(cx + 2, ey, 1, 3);
      break;
    case 'hollow':
      x.globalAlpha = 0.85;
      x.fillRect(cx - 2, ey - 1, 2, 2);
      x.fillRect(cx + 1, ey - 1, 2, 2);
      x.fillStyle = a.skinColor;
      x.fillRect(cx - 1, ey, 1, 1);
      x.fillRect(cx + 2, ey, 1, 1);
      break;
    default:
      x.globalAlpha = 0.7;
      x.fillRect(cx - 2, ey, 1, 1);
      x.fillRect(cx + 1, ey, 1, 1);
  }
  x.globalAlpha = 1;
}

// ══════════════════════════════════════
// EYES — room scale
// ══════════════════════════════════════
function drawRoomEyes(x: CanvasRenderingContext2D, a: AvatarConfig, oY: number): void {
  const col = a.eyeColor || '#ffffff';
  x.fillStyle = col;
  switch (a.eyes) {
    case 'wide':
      x.globalAlpha = 0.85;
      x.fillRect(6, oY + 4, 3, 3);
      x.fillRect(14, oY + 4, 3, 3);
      break;
    case 'angry':
      x.globalAlpha = 0.8;
      x.fillRect(7, oY + 5, 2, 2);
      x.fillRect(14, oY + 5, 2, 2);
      x.fillRect(7, oY + 3, 3, 1);
      x.fillRect(13, oY + 3, 3, 1);
      break;
    case 'happy':
      x.globalAlpha = 0.8;
      x.fillRect(7, oY + 6, 3, 1);
      x.fillRect(14, oY + 6, 3, 1);
      break;
    case 'wink':
      x.globalAlpha = 0.8;
      x.fillRect(14, oY + 5, 2, 2);
      x.fillRect(7, oY + 6, 3, 1);
      break;
    case 'star':
      x.globalAlpha = 0.9;
      x.fillRect(8, oY + 4, 1, 3);
      x.fillRect(7, oY + 5, 3, 1);
      x.fillRect(15, oY + 4, 1, 3);
      x.fillRect(14, oY + 5, 3, 1);
      break;
    case 'hollow':
      x.globalAlpha = 0.9;
      x.fillRect(6, oY + 4, 4, 4);
      x.fillRect(14, oY + 4, 4, 4);
      x.fillStyle = a.skinColor;
      x.fillRect(7, oY + 5, 2, 2);
      x.fillRect(15, oY + 5, 2, 2);
      break;
    default:
      x.globalAlpha = 0.7;
      x.fillRect(7, oY + 5, 2, 2);
      x.fillRect(14, oY + 5, 2, 2);
  }
  x.globalAlpha = 1;
}

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 0xff) + amount);
  const g = clamp(((n >> 8) & 0xff) + amount);
  const b = clamp((n & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function darken(hex: string, amount: number): string {
  return lighten(hex, -amount);
}
