import type { AvatarConfig } from '../../stores/avatarStore';
import { imgCache, ITEM_DEFS, HAIR_DEFS, ROOM_HEAD_W, SPRITE_HAT_HEADROOM, ROOM_SPRITE_XPAD } from './assets';
import { drawHairImg, drawImgItemAuto, restorePantsThroughSkinReveals } from './drawCore';
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

// ══════════════════════════════════════
// BOTTOM — room scale
// ══════════════════════════════════════
export function drawRoomBottom(
  x: CanvasRenderingContext2D,
  a: AvatarConfig,
  oY: number,
  walkFrame: number,
  hasPng: boolean
): { data: ImageData; cx: number; cy: number; cw: number; ch: number } | null {
  const lY = walkFrame === 1 ? -1 : walkFrame === 2 ? 1 : 0;
  const rY = walkFrame === 1 ? 1 : walkFrame === 2 ? -1 : 0;
  const isPngBottom = ['jeans', 'camopants', 'baggyjeans', 'trousers', 'utilitypants', 'knightpants', 'cargopants', 'fishnet'].includes(a.bottom);

  if (!hasPng) {
    x.fillStyle = a.bottomColor;
    if (!['skirt', 'miniskirt', 'dress'].includes(a.bottom) && a.top !== 'dress') {
      x.fillRect(7, oY + 28, 10, 2);
      x.fillStyle = darken(a.bottomColor, 30);
      x.fillRect(6, oY + 28, 12, 2);
      x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
      x.fillRect(10, oY + 28, 4, 2);
      x.globalAlpha = 1;
      x.fillStyle = a.bottomColor;
    }
    if (a.top === 'dress') {
      x.fillRect(7, oY + 29 + lY, 4, 15);
      x.fillRect(13, oY + 29 + rY, 4, 15);
    } else if (a.bottom === 'shorts') {
      x.fillRect(7, oY + 29 + lY, 4, 7);
      x.fillRect(13, oY + 29 + rY, 4, 7);
    } else if (a.bottom === 'skirt') {
      x.fillRect(6, oY + 28, 12, 6);
      x.fillStyle = darken(a.bottomColor, 30);
      x.fillRect(6, oY + 28, 12, 2);
      x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
      x.fillRect(10, oY + 28, 4, 2);
      x.globalAlpha = 1;
      x.fillStyle = a.bottomColor;
    } else if (a.bottom === 'overalls') {
      x.fillRect(7, oY + 29 + lY, 4, 15);
      x.fillRect(13, oY + 29 + rY, 4, 15);
      x.fillStyle = darken(a.bottomColor, 10);
      x.fillRect(5, oY + 28, 14, 3);
    } else if (a.bottom === 'miniskirt') {
      x.fillStyle = darken(a.bottomColor, 30);
      x.fillRect(6, oY + 28, 12, 2);
      x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
      x.fillRect(10, oY + 28, 4, 2);
      x.globalAlpha = 1;
      x.fillStyle = a.bottomColor;
      x.fillRect(6, oY + 29, 12, 3);
    } else {
      x.fillRect(7, oY + 29 + lY, 4, 15);
      x.fillRect(13, oY + 29 + rY, 4, 15);
    }
    x.fillStyle = darken(a.bottomColor, 20);
    x.fillRect(5, oY + 44 + lY, 6, 3);
    x.fillRect(13, oY + 44 + rY, 6, 3);
  } else if (a.top !== 'dress') {
    if (!isPngBottom) {
      x.save();
      x.beginPath();
      x.rect(6, oY + 28, 12, 19);
      x.clip();
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = a.bottomColor;
      if (a.bottom === 'skirt') {
        x.globalCompositeOperation = 'source-over';
        x.fillRect(6, oY + 28, 12, 6);
      } else if (a.bottom === 'miniskirt') {
        x.globalCompositeOperation = 'source-over';
        x.fillRect(6, oY + 29, 12, 3);
      } else if (a.bottom === 'shorts') {
        x.fillRect(6, oY + 28, 12, 8);
      } else {
        x.fillRect(6, oY + 28, 12, 19);
      }
      x.restore();
      x.fillStyle = darken(a.bottomColor, 30);
      x.fillRect(6, oY + 28, 12, 2);
      x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
      x.fillRect(10, oY + 28, 4, 2);
      x.globalAlpha = 1;
    }
  }

  // ── PNG bottoms ──
  const roomPngBottomPrefix: Record<string, string> = {
    jeans: 'bottom_jeans_room', camopants: 'bottom_camopants_room',
    baggyjeans: 'bottom_baggyjeans_room', trousers: 'bottom_trousers_room',
    utilitypants: 'bottom_utilitypants_room', knightpants: 'bottom_knightpants_room',
    cargopants: 'bottom_cargopants_room', fishnet: 'bottom_fishnet_room',
  };
  if (roomPngBottomPrefix[a.bottom] && a.top !== 'dress') {
    const cFrame = walkFrame >= 1 && walkFrame <= 4 ? walkFrame : 1;
    const cKey = `${roomPngBottomPrefix[a.bottom]}_${cFrame}`;
    const cImg = imgCache.get(cKey);
    if (cImg) {
      const bx = Math.round(12 - cImg.naturalWidth / 2);
      const by = oY + 48 - cImg.naturalHeight;
      x.fillStyle = a.bottomColor;
      drawHairImg(x, cKey, bx, by, cImg.naturalWidth, cImg.naturalHeight);
      const snap = x.getImageData(bx + ROOM_SPRITE_XPAD, by + SPRITE_HAT_HEADROOM, cImg.naturalWidth, cImg.naturalHeight);
      return { data: snap, cx: bx + ROOM_SPRITE_XPAD, cy: by + SPRITE_HAT_HEADROOM, cw: cImg.naturalWidth, ch: cImg.naturalHeight };
    }
  }
  return null;
}

// ══════════════════════════════════════
// TOP — room scale
// ══════════════════════════════════════
export function drawRoomTop(
  x: CanvasRenderingContext2D,
  a: AvatarConfig,
  oY: number,
  pantsSnap: { data: ImageData; cx: number; cy: number; cw: number; ch: number } | null
): void {
  const topDark  = darken(a.topColor, 18);
  const topLight = lighten(a.topColor, 18);
  x.fillStyle = a.topColor;
  if (a.top === 'tank') {
    x.fillStyle = a.skinColor;
    x.fillRect(4, oY + 14, 16, 14);
    x.fillStyle = a.topColor;
    x.fillRect(7, oY + 14, 2, 2);
    x.fillRect(15, oY + 14, 2, 2);
    x.fillRect(7, oY + 16, 10, 12);
  } else if (a.top === 'tshirt') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(6, oY + 18, 12, 10);
    x.fillStyle = a.skinColor;
    x.fillRect(4, oY + 18, 2, 10);
    x.fillRect(18, oY + 18, 2, 10);
    x.fillStyle = topDark;
    x.fillRect(9, oY + 14, 6, 1);
  } else if (a.top === 'hoodie') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(6, oY + 18, 12, 10);
    x.fillRect(6, oY + 28, 12, 2);
    x.fillStyle = topDark;
    x.fillRect(3, oY + 18, 3, 12);
    x.fillRect(18, oY + 18, 3, 12);
    x.fillRect(9, oY + 14, 6, 1);
    x.fillRect(9, oY + 22, 6, 4);
    x.fillStyle = topLight; x.globalAlpha = 0.45;
    x.fillRect(11, oY + 14, 1, 4);
    x.fillRect(13, oY + 14, 1, 4);
    x.globalAlpha = 1;
  } else if (a.top === 'jacket') {
  } else if (a.top === 'dress') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(6, oY + 18, 12, 10);
    x.fillRect(4, oY + 28, 16, 16);
    x.fillStyle = a.skinColor;
    x.fillRect(4, oY + 18, 2, 10);
    x.fillRect(18, oY + 18, 2, 10);
    x.fillStyle = topDark;
    x.fillRect(4, oY + 27, 16, 2);
    x.fillStyle = darken(a.topColor, 35);
    x.fillRect(6, oY + 32, 12, 2);
    x.fillRect(11, oY + 31, 2, 4);
  } else if (a.top === 'vest') {
    x.fillStyle = a.skinColor;
    x.fillRect(4, oY + 14, 16, 14);
    x.fillRect(4, oY + 18, 2, 10);
    x.fillRect(18, oY + 18, 2, 10);
    x.fillStyle = a.topColor;
    x.fillRect(6, oY + 14, 5, 14);
    x.fillRect(13, oY + 14, 5, 14);
    x.fillStyle = topDark;
    x.fillRect(11, oY + 15, 2, 12);
    x.fillRect(6, oY + 14, 12, 2);
  } else if (a.top === 'trenchcoat') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(3, oY + 18, 18, 10);
    x.fillRect(3, oY + 18, 2, 10);
    x.fillRect(19, oY + 18, 2, 10);
    x.fillRect(3, oY + 27, 18, 16);
    x.fillStyle = topDark;
    x.fillRect(11, oY + 15, 2, 29);
    x.fillStyle = topLight;
    x.fillRect(4, oY + 14, 4, 5);
    x.fillRect(16, oY + 14, 4, 5);
    x.fillStyle = topDark;
    x.fillRect(4, oY + 27, 16, 1);
    x.fillStyle = darken(a.topColor, 35);
    x.fillRect(4, oY + 32, 16, 2);
    x.fillRect(11, oY + 31, 2, 4);
  } else if (a.top === 'croptop') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(6, oY + 18, 12, 6);
    x.fillStyle = a.skinColor;
    x.fillRect(4, oY + 18, 2, 10);
    x.fillRect(18, oY + 18, 2, 10);
    x.fillRect(6, oY + 24, 12, 4);
    x.fillStyle = topDark;
    x.fillRect(9, oY + 14, 6, 1);
  } else if (a.top === 'jersey') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(4, oY + 18, 16, 10);
    x.fillRect(6, oY + 28, 12, 2);
    x.fillStyle = topDark;
    x.fillRect(3, oY + 18, 3, 12);
    x.fillRect(18, oY + 18, 3, 12);
    x.fillRect(11, oY + 15, 2, 13);
    x.fillRect(4, oY + 17, 2, 2);
    x.fillRect(18, oY + 17, 2, 2);
    x.fillStyle = topLight; x.globalAlpha = 0.45;
    x.fillRect(4, oY + 22, 16, 2);
    x.globalAlpha = 1;
    x.fillStyle = topDark;
    x.fillRect(8, oY + 14, 8, 1);
  } else if (a.top === 'longsleeve') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(4, oY + 18, 16, 10);
    x.fillRect(6, oY + 28, 12, 2);
    x.fillStyle = topDark;
    x.fillRect(3, oY + 18, 3, 12);
    x.fillRect(18, oY + 18, 3, 12);
    x.fillRect(8, oY + 14, 8, 1);
  } else if (a.top === 'polo') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(4, oY + 18, 16, 10);
    x.fillRect(6, oY + 28, 12, 2);
    x.fillStyle = a.skinColor;
    x.fillRect(4, oY + 18, 2, 10);
    x.fillRect(18, oY + 18, 2, 10);
    x.fillStyle = topDark;
    x.fillRect(11, oY + 15, 2, 6);
    x.fillStyle = topLight; x.globalAlpha = 0.6;
    x.fillRect(8, oY + 14, 8, 1);
    x.globalAlpha = 1;
  } else if (a.top === 'flannel' || a.top === 'bomber') {
  } else if (a.top === 'turtleneck') {
    x.fillRect(3, oY + 14, 18, 4);
    x.fillRect(4, oY + 18, 16, 10);
    x.fillRect(6, oY + 28, 12, 2);
    x.fillRect(7, oY + 12, 10, 2);
    x.fillStyle = a.skinColor;
    x.fillRect(4, oY + 18, 2, 10);
    x.fillRect(18, oY + 18, 2, 10);
    x.fillStyle = topDark;
    x.fillRect(8, oY + 13, 8, 1);
  } else if (a.top === 'robe' || a.top === 'bitcoinshirt' || a.top === 'ostrichshirt' || a.top === 'camoshirt' || a.top === 'tunic' || a.top === 'skindress' || a.top === 'knightchest') {
  }

  // ── PNG top detail overlay ──
  const roomTopPngKey = ({
    jacket:       'top_jacket_room',
    bomber:       'top_bomber_room',
    flannel:      'top_flannel_room',
    robe:         'top_robe_room',
    bitcoinshirt: 'top_bitcoinshirt_room',
    ostrichshirt: 'top_ostrichshirt_room',
    camoshirt:    'top_camoshirt_room',
    tunic:        'top_tunic_room',
    skindress:    'top_skindress_room',
    knightchest:  'top_knightchest_room',
  } as Record<string, string>)[a.top];
  if (roomTopPngKey && imgCache.has(roomTopPngKey)) {
    const tImg = imgCache.get(roomTopPngKey)!;
    const tx = Math.round(12 - tImg.naturalWidth / 2);
    const roomTopYOffset = a.top === 'bomber' ? -1 : a.top === 'jacket' ? -1 : 0;
    x.fillStyle = a.topColor;
    drawHairImg(x, roomTopPngKey, tx, oY + 14 + roomTopYOffset, tImg.naturalWidth, tImg.naturalHeight);
  }

  if (pantsSnap) restorePantsThroughSkinReveals(x, pantsSnap.cx, pantsSnap.cy, pantsSnap.cw, pantsSnap.ch, pantsSnap.data, a.skinColor);

  // ── Overalls straps ──
  const strapOverTop = !['hoodie', 'jacket', 'trenchcoat', 'vest', 'robe', 'skindress', 'knightchest', 'bomber', 'flannel', 'tunic'].includes(a.top);
  if (a.bottom === 'overalls' && strapOverTop) {
    x.fillStyle = a.bottomColor;
    x.fillRect(8,  oY + 14, 3, 16);
    x.fillRect(13, oY + 14, 3, 16);
    x.fillStyle = '#d4af37'; x.globalAlpha = 0.7;
    x.fillRect(8,  oY + 19, 3, 2);
    x.fillRect(13, oY + 19, 3, 2);
    x.globalAlpha = 1;
  }
}

// ══════════════════════════════════════
// PNG ACCESSORIES — room scale
// ══════════════════════════════════════

/** Wings / sword — drawn before body so they appear behind */
export function drawRoomPngAccBehind(x: CanvasRenderingContext2D, acc: string, color: string, oY: number): void {
  if (acc === 'wings') {
    const img = imgCache.get('acc_wings_room');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_wings_room', Math.round(12 - img.naturalWidth / 2), oY + 2, img.naturalWidth, img.naturalHeight); }
  }
  if (acc === 'sword') {
    const img = imgCache.get('acc_sword_room');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_sword_room', Math.round(12 - img.naturalWidth / 2), oY + 5, img.naturalWidth, img.naturalHeight); }
  }
}

/** Cape / floatie — drawn over clothes but under hair/hat */
export function drawRoomPngAccOver(x: CanvasRenderingContext2D, acc: string, color: string, oY: number): void {
  if (acc === 'cape') {
    const img = imgCache.get('acc_cape_room');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_cape_room', Math.round(12 - img.naturalWidth / 2), oY + 13, img.naturalWidth, img.naturalHeight); }
  }
  if (acc === 'ostirchfloatie') {
    const img = imgCache.get('acc_ostirchfloatie_room');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_ostirchfloatie_room', Math.round(12 - img.naturalWidth / 2), oY + 14, img.naturalWidth, img.naturalHeight); }
  }
}

/** Balloon — floats above everything, string anchored at wrist */
export function drawRoomPngAccAbove(x: CanvasRenderingContext2D, acc: string, color: string, oY: number): void {
  if (acc === 'ballon') {
    const img = imgCache.get('acc_ballon_room');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_ballon_room', -6, oY - 16, img.naturalWidth, img.naturalHeight); }
  }
  if (acc === 'ballonbitcoin') {
    const img = imgCache.get('acc_ballonbitcoin_room');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_ballonbitcoin_room', -6, oY - 16, img.naturalWidth, img.naturalHeight); }
  }
  if (acc === 'ballonostrich') {
    const img = imgCache.get('acc_ballonostrich_room');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_ballonostrich_room', -6, oY - 16, img.naturalWidth, img.naturalHeight); }
  }
}
