import type { AvatarConfig } from '../../stores/avatarStore';
import { imgCache, ITEM_DEFS, HAIR_DEFS, ROOM_HEAD_W } from './assets';
import { drawHairImg, drawImgItemAuto } from './drawCore';
import { lighten, darken } from './helpers';

// ══════════════════════════════════════
// HAIR — room scale
// ══════════════════════════════════════
export function drawRoomHair(x: CanvasRenderingContext2D, hair: string, oY: number): void {
  switch (hair) {
    case 'short': {
      const d = HAIR_DEFS.short;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY, 14, 4); x.fillRect(3, oY + 2, 4, 4); }
      break;
    }
    case 'mohawk':
      x.fillRect(9, oY - 4, 6, 6);
      x.fillRect(10, oY - 6, 4, 3);
      break;
    case 'long': {
      const d = HAIR_DEFS.long;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY, 14, 4); x.fillRect(3, oY + 2, 4, 10); x.fillRect(17, oY + 2, 4, 10); }
      break;
    }
    case 'ponytail': {
      const d = HAIR_DEFS.ponytail;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(6, oY, 12, 1); x.fillRect(5, oY + 1, 14, 3); x.fillRect(19, oY + 3, 1, 1); x.fillRect(17, oY + 4, 3, 8); }
      break;
    }
    case 'spiky': {
      const d = HAIR_DEFS.spiky;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY - 2, 4, 4); x.fillRect(10, oY - 4, 4, 4); x.fillRect(15, oY - 2, 4, 4); x.fillRect(5, oY, 14, 3); }
      break;
    }
    case 'buzz':
      x.fillRect(5, oY, 14, 3);
      break;
    case 'afro': {
      const d = HAIR_DEFS.afro;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY - 4, 14, 5); x.fillRect(3, oY - 1, 3, 4); x.fillRect(18, oY - 1, 3, 4); x.fillRect(5, oY, 14, 3); }
      break;
    }
    case 'bun': {
      const d = HAIR_DEFS.bun;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY, 14, 3); x.fillRect(9, oY - 4, 6, 5); x.fillRect(11, oY - 5, 2, 2); }
      break;
    }
    case 'grease': {
      const d = HAIR_DEFS.grease;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(4, oY, 16, 4); x.fillRect(3, oY - 2, 6, 4); }
      break;
    }
    case 'swept': {
      const d = HAIR_DEFS.swept;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(4, oY, 16, 4); x.fillRect(3, oY - 4, 8, 6); }
      break;
    }
    case 'pigtails': {
      const d = HAIR_DEFS.pigtails;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY, 14, 4); x.fillRect(1, oY + 2, 4, 10); x.fillRect(19, oY + 2, 4, 10); }
      break;
    }
    case 'horseshoe': {
      const d = HAIR_DEFS.horseshoe;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(3, oY, 3, 4); x.fillRect(18, oY, 3, 4); }
      break;
    }
    case 'part': {
      const d = HAIR_DEFS.part;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY, 14, 4); }
      break;
    }
    case 'partbeard': {
      const d = HAIR_DEFS.partbeard;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY, 14, 4); x.fillRect(5, oY + 8, 14, 8); }
      break;
    }
    case 'braid': {
      const d = HAIR_DEFS.braid;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY, 14, 4); x.fillRect(9, oY + 4, 6, 10); }
      break;
    }
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
// HAIR SIDES ONLY — room (for when hat is worn)
// ══════════════════════════════════════
export function drawRoomHairSidesOnly(x: CanvasRenderingContext2D, hair: string, oY: number): void {
  switch (hair) {
    case 'long': {
      const d = HAIR_DEFS.long;
      if (d.hatRoomKey && imgCache.has(d.hatRoomKey)) { drawHairImg(x, d.hatRoomKey, d.hatRoomX!, oY + d.hatRoomY!, d.hatRoomW!, d.hatRoomH!, d.flipH); }
      else if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(3, oY + 2, 4, 10); x.fillRect(17, oY + 2, 4, 10); }
      break;
    }
    case 'braid': {
      const d = HAIR_DEFS.braid;
      if (d.hatRoomKey && imgCache.has(d.hatRoomKey)) { drawHairImg(x, d.hatRoomKey, d.hatRoomX!, oY + d.hatRoomY!, d.hatRoomW!, d.hatRoomH!, d.flipH); }
      else if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(9, oY + 4, 6, 10); }
      break;
    }
    case 'ponytail':
      x.fillRect(17, oY + 4, 3, 8);  // tail
      break;
    case 'mullet':
      x.fillRect(15, oY + 2, 3, 14); // left back hang
      x.fillRect(18, oY + 2, 3, 14); // right back hang
      break;
    case 'pigtails':
      x.fillRect(1, oY + 2, 4, 10);  // left tail
      x.fillRect(19, oY + 2, 4, 10); // right tail
      break;
    case 'partbeard': {
      const d = HAIR_DEFS.partbeard;
      if (d.hatRoomKey && imgCache.has(d.hatRoomKey)) { drawHairImg(x, d.hatRoomKey, d.hatRoomX!, oY + d.hatRoomY!, d.hatRoomW!, d.hatRoomH!, d.flipH); }
      else if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY + 6, 14, 8); }
      break;
    }
  }
}

// ══════════════════════════════════════
// HATS — room scale
// ══════════════════════════════════════
export function drawRoomHat(x: CanvasRenderingContext2D, hat: string, oY: number): void {
  switch (hat) {
    case 'cap':
      x.fillRect(5, oY - 1, 14, 4);
      x.fillRect(2, oY + 2, 8, 2);
      break;
    case 'beanie':
      x.fillRect(5, oY - 2, 14, 5);
      x.fillRect(10, oY - 4, 4, 3);
      break;
    case 'tophat':
      x.fillRect(7, oY - 7, 10, 8);
      x.fillRect(4, oY,     16, 3);
      break;
    case 'cowboy': {
      x.fillRect(7, oY - 5, 10, 6);
      x.fillRect(2, oY,     20, 3);
      const cowSave = x.fillStyle as string;
      x.fillStyle = darken(cowSave, 20);
      x.fillRect(7, oY - 5, 10, 1);
      x.fillStyle = cowSave;
      break;
    }
    case 'beret': {
      const berSave = x.fillStyle as string;
      x.fillRect(5, oY - 1, 14, 4);
      x.fillRect(7, oY - 3, 12, 3);
      x.fillStyle = darken(berSave, 20);
      x.fillRect(5, oY + 1, 14, 2);
      x.fillStyle = berSave;
      break;
    }
    case 'bucket':
      x.fillRect(6, oY - 4, 12, 5);
      x.fillRect(4, oY + 1, 16, 2);
      break;
    case 'visor':
      x.fillRect(5, oY - 2, 14, 3);  // sweatband
      x.fillRect(2, oY + 1, 20, 2);  // wide brim
      break;
    case 'fedora': {
      const fedSave = x.fillStyle as string;
      x.fillRect(7, oY - 7, 10, 8);  // crown
      x.fillRect(3, oY,     18, 3);  // wide brim
      x.fillStyle = darken(fedSave, 20);
      x.fillRect(7, oY - 7,  10, 1); // top crease
      x.fillRect(3, oY,      18, 1); // brim shadow edge
      x.fillStyle = fedSave;
      break;
    }
    case 'hardhat': {
      const hhSave = x.fillStyle as string;
      x.fillRect(6, oY - 6, 12, 7);  // dome
      x.fillRect(4, oY + 1, 16, 2);  // brim
      x.fillStyle = lighten(hhSave, 22); x.globalAlpha = 0.45;
      x.fillRect(9, oY - 5,  3, 5);  // highlight
      x.globalAlpha = 1;
      x.fillStyle = hhSave;
      break;
    }
    case 'newsboy': {
      const nbSave = x.fillStyle as string;
      x.fillRect(5, oY - 6,  14, 7);  // puffed crown
      x.fillRect(4, oY + 1,  16, 2);  // band
      x.fillRect(3, oY - 1,  12, 2);  // asymmetric visor brim
      x.fillStyle = darken(nbSave, 18);
      x.fillRect(5, oY,      14, 1);  // crease shadow
      x.fillStyle = nbSave;
      break;
    }
    default:
      if (ITEM_DEFS[hat]) drawImgItemAuto(x, hat, 12, oY, ROOM_HEAD_W, 1);
  }
}

// ══════════════════════════════════════
// EYES — room scale
// ══════════════════════════════════════
export function drawRoomEyes(x: CanvasRenderingContext2D, a: AvatarConfig, oY: number): void {
  const col = a.eyeColor || '#ffffff';
  x.fillStyle = col;
  switch (a.eyes) {
    case 'wide':
      x.globalAlpha = 0.85;
      x.fillRect(7, oY + 4, 3, 3);
      x.fillRect(14, oY + 4, 3, 3);
      break;
    case 'angry':
      x.globalAlpha = 0.8;
      x.fillRect(8, oY + 5, 2, 2);
      x.fillRect(14, oY + 5, 2, 2);
      x.fillRect(8, oY + 3, 3, 1);
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
      x.fillRect(8, oY + 5, 1, 3);
      x.fillRect(7, oY + 6, 3, 1);
      x.fillRect(15, oY + 5, 1, 3);
      x.fillRect(14, oY + 6, 3, 1);
      break;
    case 'hollow':
      x.globalAlpha = 0.9;
      x.fillRect(6, oY + 4, 4, 4);
      x.fillRect(14, oY + 4, 4, 4);
      x.fillStyle = a.skinColor;
      x.fillRect(7, oY + 5, 2, 2);
      x.fillRect(15, oY + 5, 2, 2);
      break;
    case 'sleepy':
      x.globalAlpha = 0.8;
      x.fillRect(6, oY + 5, 4, 1);
      x.fillRect(14, oY + 5, 4, 1);
      // tiny lashes beneath
      x.globalAlpha = 0.5;
      x.fillRect(7, oY + 6, 1, 1);
      x.fillRect(9, oY + 6, 1, 1);
      x.fillRect(15, oY + 6, 1, 1);
      x.fillRect(17, oY + 6, 1, 1);
      break;
    case 'cross':
      x.globalAlpha = 0.85;
      // left X (3x3)
      x.fillRect(7, oY + 5, 1, 1); x.fillRect(9, oY + 5, 1, 1);
      x.fillRect(8, oY + 6, 1, 1);
      x.fillRect(7, oY + 7, 1, 1); x.fillRect(9, oY + 7, 1, 1);
      // right X
      x.fillRect(14, oY + 5, 1, 1); x.fillRect(16, oY + 5, 1, 1);
      x.fillRect(15, oY + 6, 1, 1);
      x.fillRect(14, oY + 7, 1, 1); x.fillRect(16, oY + 7, 1, 1);
      break;
    case 'glow':
      x.shadowColor = col;
      x.shadowBlur = 2.5;
      x.globalAlpha = 1;
      x.fillRect(8,  oY + 5, 2, 2);
      x.fillRect(14, oY + 5, 2, 2);
      x.shadowBlur = 0;
      break;
    case 'heart':
      x.globalAlpha = 0.9;
      // left heart (3x3): two bumps on top row, full middle row, point at bottom
      x.fillRect(7, oY + 5, 1, 1); x.fillRect(9, oY + 5, 1, 1);
      x.fillRect(7, oY + 6, 3, 1);
      x.fillRect(8, oY + 7, 1, 1);
      // right heart
      x.fillRect(14, oY + 5, 1, 1); x.fillRect(16, oY + 5, 1, 1);
      x.fillRect(14, oY + 6, 3, 1);
      x.fillRect(15, oY + 7, 1, 1);
      break;
    case 'blaze':
      // Bright 2x2 pupils with flame tip row above
      x.globalAlpha = 0.65;
      x.fillRect(8,  oY + 4, 2, 1); // left flame tip
      x.fillRect(15, oY + 4, 2, 1); // right flame tip
      x.globalAlpha = 1.0;
      x.fillRect(8,  oY + 5, 2, 2); // left pupil
      x.fillRect(15, oY + 5, 2, 2); // right pupil
      break;
    case 'frost':
      // Vertical ice shard — bright center 2x2, dim 2x1 tips; cry positions (x=8, x=15)
      x.globalAlpha = 0.5;
      x.fillRect(8,  oY + 4, 2, 1); // left tip
      x.fillRect(15, oY + 4, 2, 1); // right tip
      x.globalAlpha = 1.0;
      x.fillRect(8,  oY + 5, 2, 2); // left main
      x.fillRect(15, oY + 5, 2, 2); // right main
      x.globalAlpha = 0.5;
      x.fillRect(8,  oY + 7, 2, 1); // left base
      x.fillRect(15, oY + 7, 2, 1); // right base
      break;
    case 'cosmic':
      x.globalAlpha = 1.0;
      x.fillRect(8,  oY + 5, 2, 2); // left iris
      x.fillRect(15, oY + 5, 2, 2); // right iris
      x.globalAlpha = 0.3;
      x.fillRect(7,  oY + 4, 1, 1); x.fillRect(10, oY + 4, 1, 1);
      x.fillRect(7,  oY + 7, 1, 1); x.fillRect(10, oY + 7, 1, 1);
      x.fillRect(14, oY + 4, 1, 1); x.fillRect(17, oY + 4, 1, 1);
      x.fillRect(14, oY + 7, 1, 1); x.fillRect(17, oY + 7, 1, 1);
      break;
    case 'cry':
      x.globalAlpha = 0.9;
      x.fillRect(8,  oY + 4, 2, 3); // left pupil
      x.fillRect(15, oY + 4, 2, 3); // right pupil
      x.globalAlpha = 0.55;
      x.fillRect(8,  oY + 7, 2, 1); // left tear
      x.fillRect(15, oY + 7, 2, 1); // right tear
      break;
    default:
      x.globalAlpha = 0.7;
      x.fillRect(8, oY + 5, 2, 2);
      x.fillRect(14, oY + 5, 2, 2);
  }
  x.globalAlpha = 1;
}

// ══════════════════════════════════════
// ACCESSORIES — room scale
// ══════════════════════════════════════
export function drawRoomAccessory(x: CanvasRenderingContext2D, acc: string, oY: number): void {
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
      x.fillRect(5,  oY + 5, 1, 1);
      x.fillRect(18, oY + 5, 1, 1);
      x.globalAlpha = 1;
      break;
    case 'bandana': {
      x.globalAlpha = 1;
      // Main band across lower face (1px lower)
      x.fillRect(5, oY + 7, 14, 4);
      // Triangle point down
      x.fillRect(8,  oY + 11, 8, 2);
      x.fillRect(10, oY + 13, 4, 2);
      x.fillRect(11, oY + 15, 2, 1);
      // Top fold stripe
      x.fillStyle = lighten(savedColor, 22); x.globalAlpha = 0.5;
      x.fillRect(5, oY + 7, 14, 1);
      x.globalAlpha = 1;
      // Knot at right side
      x.fillStyle = darken(savedColor, 20);
      x.fillRect(19, oY + 8, 3, 2);
      x.fillRect(20, oY + 10, 2, 1);
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
      // Strap spanning full head width
      x.fillRect(5, oY + 4, 14, 1);
      x.globalAlpha = 1;
      break;
    case 'chain':
      x.fillStyle = '#d4af37'; x.globalAlpha = 0.8;
      x.fillRect(9,  oY + 15, 1, 1);
      x.fillRect(9,  oY + 16, 1, 2);
      x.fillRect(10, oY + 18, 1, 2);
      x.fillRect(11, oY + 20, 1, 2);
      x.fillRect(14, oY + 15, 1, 1);
      x.fillRect(14, oY + 16, 1, 2);
      x.fillRect(13, oY + 18, 1, 2);
      x.fillRect(12, oY + 20, 1, 2);
      x.fillRect(11, oY + 22, 2, 2);
      x.fillStyle = savedColor; x.globalAlpha = 1;
      break;
    case 'earrings':
      x.globalAlpha = 0.9;
      x.fillRect(4,  oY + 7, 2, 3);
      x.fillRect(18, oY + 7, 2, 3);
      x.globalAlpha = 1;
      break;
    case 'watch': {
      // Left arm: x=4, w=2. Strap: 1px overhang left only (no right overflow).
      x.fillStyle = darken(savedColor, 25);
      x.fillRect(3, oY + 27, 3, 1);  // strap (arm x=4-6, 1px left overhang only)
      x.fillStyle = savedColor;
      x.fillRect(4, oY + 27, 2, 1);  // watch face (exact arm width)
      break;
    }
    case 'mask':
      // Cloth mask — lower face only (nose to chin)
      x.fillRect(7, oY + 7, 10, 3);   // mask body (narrower, 3px tall)
      x.fillStyle = lighten(savedColor, 18); x.globalAlpha = 0.35;
      x.fillRect(7, oY + 7, 10, 1);   // top fold crease
      x.fillStyle = darken(savedColor, 18); x.globalAlpha = 0.5;
      x.fillRect(10, oY + 8, 4, 1);   // center pleat
      x.fillStyle = savedColor; x.globalAlpha = 0.45;
      x.fillRect(5,  oY + 7, 2, 2);   // left ear strap
      x.fillRect(17, oY + 7, 2, 2);   // right ear strap
      x.globalAlpha = 1;
      break;
    case 'monocle':
      // Monocle on left eye + hanging chain
      x.globalAlpha = 0.9;
      x.fillRect(6, oY + 4, 5, 4);    // lens frame
      x.fillStyle = lighten(savedColor, 35); x.globalAlpha = 0.4;
      x.fillRect(7, oY + 4, 2, 2);    // lens glint
      x.fillStyle = savedColor; x.globalAlpha = 0.6;
      x.fillRect(10, oY + 8, 1, 4);   // chain
      x.globalAlpha = 1;
      break;
    case 'ring': {
      // Right arm skin is at x=18, w=2 — ring must start at x=18 not x=17
      x.fillStyle = '#d4af37'; x.globalAlpha = 0.9;
      x.fillRect(18, oY + 30, 2, 1);
      x.globalAlpha = 1;
      x.fillStyle = savedColor;
      break;
    }
    default:
      if (ITEM_DEFS[acc]) drawImgItemAuto(x, acc, 12, oY, ROOM_HEAD_W, 1);
  }
}
