import type { AvatarConfig } from '../../stores/avatarStore';
import { imgCache, ITEM_DEFS, HAIR_DEFS, HUB_HEAD_W, ROOM_HEAD_W, SPRITE_HAT_HEADROOM } from './assets';
import { drawHairImg, drawImgItemAuto, restorePantsThroughSkinReveals } from './drawCore';
import { lighten, darken } from './helpers';

// ══════════════════════════════════════
// HAIR — hub scale
// ══════════════════════════════════════
export function drawHubHair(x: CanvasRenderingContext2D, hair: string, cx: number, hy: number, s: number): void {
  switch (hair) {
    case 'short': {
      const d = HAIR_DEFS.short;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy + 3, 4 * s, 2 * s - 1); x.fillRect(cx - 2.5 * s, hy + 1 * s + 3, 1 * s, 2 * s - 1); }
      break;
    }
    case 'mohawk':
      x.fillRect(cx - 0.5 * s, hy - 2 * s - 2, 1 * s, 3 * s);
      x.fillRect(cx - 1 * s, hy - 1 * s - 2, 2 * s, 2 * s);
      break;
    case 'long': {
      const d = HAIR_DEFS.long;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy, 4 * s, 2 * s - 1); x.fillRect(cx - 2.5 * s, hy + 1 * s - 1, 1 * s, 5 * s); x.fillRect(cx + 1.5 * s, hy + 1 * s - 1, 1 * s, 5 * s); }
      break;
    }
    case 'ponytail': {
      const d = HAIR_DEFS.ponytail;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s + 1, hy + 3, 4 * s - 1, 1); x.fillRect(cx - 2 * s, hy + 4, 4 * s, 2 * s - 2); x.fillRect(cx + 1.5 * s, hy + 1 * s + 2, 1 * s, 4 * s); }
      break;
    }
    case 'spiky': {
      const d = HAIR_DEFS.spiky;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy - 1 * s, 1 * s, 2 * s); x.fillRect(cx - 0.5 * s, hy - 2 * s, 1 * s, 2 * s); x.fillRect(cx + 1 * s, hy - 1 * s, 1 * s, 2 * s); x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s); }
      break;
    }
    case 'buzz':
      x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s);
      break;
    case 'afro': {
      const d = HAIR_DEFS.afro;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2.5 * s + 1, hy - 2 * s + 5, 5 * s - 2, 2 * s - 1); x.fillRect(cx - 3 * s + 1, hy - 1 * s + 4, 1.5 * s - 1, 2 * s); x.fillRect(cx + 1.5 * s, hy - 1 * s + 4, 1.5 * s - 1, 2 * s); x.fillRect(cx - 2 * s, hy + 4, 4 * s, 1 * s); }
      break;
    }
    case 'bun': {
      const d = HAIR_DEFS.bun;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s); x.fillRect(cx - 1 * s, hy - 2 * s, 2 * s, 1 * s); x.fillRect(cx - 1.5 * s, hy - 1 * s, 1 * s, 1 * s); x.fillRect(cx + 0.5 * s, hy - 1 * s, 1 * s, 1 * s); }
      break;
    }
    case 'grease': {
      const d = HAIR_DEFS.grease;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s); x.fillRect(cx - 2 * s, hy - 1 * s, 2 * s, 1 * s); }
      break;
    }
    case 'swept': {
      const d = HAIR_DEFS.swept;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s); x.fillRect(cx - 2 * s, hy - 2 * s, 3 * s, 2 * s); }
      break;
    }
    case 'pigtails': {
      const d = HAIR_DEFS.pigtails;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s); x.fillRect(cx - 3.5 * s, hy + 1 * s, 1 * s, 4 * s); x.fillRect(cx + 2.5 * s, hy + 1 * s, 1 * s, 4 * s); }
      break;
    }
    case 'horseshoe': {
      const d = HAIR_DEFS.horseshoe;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2.5 * s, hy, 1 * s, 3); x.fillRect(cx + 1.5 * s, hy, 1 * s, 3); }
      break;
    }
    case 'part': {
      const d = HAIR_DEFS.part;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s); }
      break;
    }
    case 'partbeard': {
      const d = HAIR_DEFS.partbeard;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s); x.fillRect(cx - 2 * s, hy + 3 * s, 4 * s, 4 * s); }
      break;
    }
    case 'braid': {
      const d = HAIR_DEFS.braid;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s); x.fillRect(cx, hy + 1 * s, 1 * s, 6 * s); }
      break;
    }
    case 'curtains':
      x.fillRect(cx - 2 * s, hy - 2, 4 * s, 2 * s);
      x.fillRect(cx - 2.5 * s, hy + 1 * s - 2, 1.5 * s, 3 * s);
      x.fillRect(cx + 1 * s, hy + 1 * s - 2, 1.5 * s, 3 * s);
      break;
    case 'mullet':
      x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s);
      x.fillRect(cx + 1.5 * s, hy + 1 * s, 1 * s, 6 * s);
      x.fillRect(cx - 2.5 * s, hy + 1 * s, 1 * s, 6 * s);
      break;
  }
}

// ══════════════════════════════════════
// HAIR SIDES ONLY — hub (for when hat is worn)
// ══════════════════════════════════════
export function drawHubHairSidesOnly(x: CanvasRenderingContext2D, hair: string, cx: number, hy: number, s: number): void {
  switch (hair) {
    case 'long': {
      const d = HAIR_DEFS.long;
      if (d.hatHubKey && imgCache.has(d.hatHubKey)) { drawHairImg(x, d.hatHubKey, cx + d.hatHubOffX!, hy + d.hatHubOffY!, d.hatHubW!, d.hatHubH!, d.flipH); }
      else if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2.5 * s, hy + 1 * s - 1, 1 * s, 5 * s); x.fillRect(cx + 1.5 * s, hy + 1 * s - 1, 1 * s, 5 * s); }
      break;
    }
    case 'braid': {
      const d = HAIR_DEFS.braid;
      if (d.hatHubKey && imgCache.has(d.hatHubKey)) { drawHairImg(x, d.hatHubKey, cx + d.hatHubOffX!, hy + d.hatHubOffY!, d.hatHubW!, d.hatHubH!, d.flipH); }
      else if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx, hy + 1 * s, 1 * s, 6 * s); }
      break;
    }
    case 'ponytail':
      x.fillRect(cx + 1.5 * s, hy + 2 * s + 1, 1 * s, 4 * s); // tail
      break;
    case 'mullet':
      x.fillRect(cx - 2.5 * s, hy + 1 * s, 1 * s, 6 * s); // left hang
      x.fillRect(cx + 1.5 * s, hy + 1 * s, 1 * s, 6 * s); // right hang
      break;
    case 'pigtails':
      x.fillRect(cx - 3.5 * s, hy + 1 * s, 1 * s, 4 * s); // left tail
      x.fillRect(cx + 2.5 * s, hy + 1 * s, 1 * s, 4 * s); // right tail
      break;
    case 'partbeard': {
      const d = HAIR_DEFS.partbeard;
      if (d.hatHubKey && imgCache.has(d.hatHubKey)) { drawHairImg(x, d.hatHubKey, cx + d.hatHubOffX!, hy + d.hatHubOffY!, d.hatHubW!, d.hatHubH!, d.flipH); }
      else if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s, hy + 3 * s, 4 * s, 4 * s); }
      break;
    }
  }
}

// ══════════════════════════════════════
// HATS — hub scale
// ══════════════════════════════════════
export function drawHubHat(x: CanvasRenderingContext2D, hat: string, cx: number, hy: number, s: number): void {
  const hatY = hy + s + 2;
  const pY = hy + s; // hat band sits at head top (matches hair level)
  switch (hat) {
    case 'cap':
      x.fillRect(cx - 2 * s, pY - 2 * s, 4 * s, 1 * s);
      x.fillRect(cx - 2 * s, pY - 1 * s, 2 * s, 0.5 * s);
      break;
    case 'beanie':
      x.fillRect(cx - 2 * s, pY - 3 * s + 1, 4 * s, 2 * s);
      x.fillRect(cx - 0.5 * s, pY - 4 * s + 1, 1 * s, 1 * s);
      break;
    case 'tophat':
      x.fillRect(cx - 1.5 * s, pY - 5 * s + 1, 3 * s, 3 * s);
      x.fillRect(cx - 2 * s, pY - 2 * s + 1, 4 * s, 1 * s);
      break;
    case 'cowboy': {
      x.fillRect(cx - 1.5 * s, pY - 4 * s + 1, 3 * s, 2 * s);
      x.fillRect(cx - 3 * s, pY - 2 * s + 1, 6 * s, 1 * s);
      const cSave = x.fillStyle as string;
      x.fillStyle = darken(cSave, 20);
      x.fillRect(cx - 1.5 * s, pY - 4 * s + 1, 3 * s, 0.5 * s);
      x.fillStyle = cSave;
      break;
    }
    case 'beret':
      x.fillRect(cx - 2 * s, pY - 2 * s + 1, 4 * s, 1 * s);
      x.fillRect(cx - 1 * s, pY - 3 * s + 1, 3 * s, 1 * s);
      x.fillRect(cx - 2 * s, pY - 1 * s + 1, 4 * s, 0.5 * s);
      break;
    case 'bucket':
      x.fillRect(cx - 2 * s, pY - 3 * s, 4 * s, 2 * s);
      x.fillRect(cx - 2 * s, pY - 1 * s, 4 * s, 1 * s);
      break;
    case 'visor':
      x.fillRect(cx - 1.5 * s, pY - 1.75 * s, 3 * s, 0.75 * s); // sweatband nub
      x.fillRect(cx - 3 * s,   pY - 1 * s,     6 * s, 0.75 * s); // wide brim
      break;
    case 'fedora': {
      const fedSave = x.fillStyle as string;
      x.fillRect(cx - 1.5 * s, pY - 4.5 * s, 3 * s, 3 * s);    // crown
      x.fillRect(cx - 3 * s,   pY - 1.5 * s,  6 * s, 1 * s);   // wide brim
      x.fillStyle = darken(fedSave, 20);
      x.fillRect(cx - 1.5 * s, pY - 4.5 * s, 3 * s, 0.5 * s);  // top crease indent
      x.fillStyle = fedSave;
      break;
    }
    case 'hardhat': {
      const hhSave = x.fillStyle as string;
      x.fillRect(cx - 2 * s,   pY - 3.5 * s, 4 * s,   3 * s);   // dome
      x.fillRect(cx - 2.5 * s, pY - 0.5 * s, 5 * s,   0.75 * s); // brim
      x.fillStyle = lighten(hhSave, 22); x.globalAlpha = 0.45;
      x.fillRect(cx - 0.5 * s, pY - 3.5 * s, 1 * s,   2.5 * s); // highlight stripe
      x.globalAlpha = 1;
      x.fillStyle = hhSave;
      break;
    }
    case 'newsboy': {
      const nbSave = x.fillStyle as string;
      x.fillRect(cx - 2 * s,   pY - 3 * s,   4 * s,   2.5 * s); // puffed crown
      x.fillRect(cx - 2.5 * s, pY - 0.5 * s, 5 * s,   0.75 * s); // band
      x.fillRect(cx - 2.5 * s, pY - 1.25 * s, 3 * s,  0.75 * s); // asymmetric visor
      x.fillStyle = darken(nbSave, 18);
      x.fillRect(cx - 2 * s,   pY - 0.75 * s, 4 * s,  0.5 * s);  // crease shadow
      x.fillStyle = nbSave;
      break;
    }
    default:
      if (ITEM_DEFS[hat]) drawImgItemAuto(x, hat, cx, hatY, HUB_HEAD_W, HUB_HEAD_W / ROOM_HEAD_W);
  }
}

// ══════════════════════════════════════
// EYES — hub scale
// ══════════════════════════════════════
export function drawHubEyes(x: CanvasRenderingContext2D, a: AvatarConfig, cx: number, headY: number, s: number): void {
  const col = a.eyeColor || '#ffffff';
  const ey = headY + 3;
  x.fillStyle = col;
  switch (a.eyes) {
    case 'wide':
      // 2x2 blocks at cols 7-8 and 11-12, gap at 9-10
      x.globalAlpha = 0.85;
      x.fillRect(cx - 3, ey, 2, 2);
      x.fillRect(cx + 1, ey, 2, 2);
      break;
    case 'angry':
      x.globalAlpha = 0.9;
      x.fillRect(cx - 3, ey - 1, 2, 1);  // left brow
      x.fillRect(cx + 1, ey - 1, 2, 1);  // right brow
      x.fillRect(cx - 3, ey + 1, 1, 1);  // left pupil
      x.fillRect(cx + 2, ey + 1, 1, 1);  // right pupil
      break;
    case 'happy':
      x.globalAlpha = 0.75;
      x.fillRect(cx - 3, ey + 1, 2, 1);
      x.fillRect(cx + 1, ey + 1, 2, 1);
      break;
    case 'wink':
      // Left: 2x2 open square; right: horizontal line (the wink)
      x.globalAlpha = 0.9;
      x.fillRect(cx - 3, ey,     2, 2);  // open eye: cols 7-8, rows ey..ey+1
      x.fillRect(cx + 1, ey + 1, 2, 1);  // wink line: cols 11-12, row ey+1
      break;
    case 'star':
      // Plus-sign centered at col 7 and col 12 (1px outward from default pupils)
      // This puts left eye at cols 6-8 and right at cols 11-13 with a clean gap
      x.globalAlpha = 0.75;
      x.fillRect(cx - 3, ey,     1, 3);  // left vert: col 7
      x.fillRect(cx - 4, ey + 1, 3, 1);  // left horiz: cols 6-8
      x.fillRect(cx + 2, ey,     1, 3);  // right vert: col 12
      x.fillRect(cx + 1, ey + 1, 3, 1);  // right horiz: cols 11-13
      break;
    case 'hollow':
      // 3x3 ring centered at col 7 and col 12 — gap between eyes shows naturally
      x.globalAlpha = 0.85;
      x.fillRect(cx - 4, ey,     3, 1);  // left top: cols 6-8
      x.fillRect(cx - 4, ey + 1, 1, 1);  // left side: col 6
      x.fillRect(cx - 2, ey + 1, 1, 1);  // left side: col 8
      x.fillRect(cx - 4, ey + 2, 3, 1);  // left bottom: cols 6-8
      x.fillRect(cx + 1, ey,     3, 1);  // right top: cols 11-13
      x.fillRect(cx + 1, ey + 1, 1, 1);  // right side: col 11
      x.fillRect(cx + 3, ey + 1, 1, 1);  // right side: col 13
      x.fillRect(cx + 1, ey + 2, 3, 1);  // right bottom: cols 11-13
      break;
    case 'sleepy':
      // 3-wide bar (wider than happy's 2-wide) at cols 6-8 and 11-13
      x.globalAlpha = 0.75;
      x.fillRect(cx - 4, ey + 1, 3, 1);
      x.fillRect(cx + 1, ey + 1, 3, 1);
      break;
    case 'cross':
      // X centered at col 7 and col 12 — diagonals at cols 6,8 and 11,13 (no merge)
      x.globalAlpha = 0.85;
      x.fillRect(cx - 4, ey,     1, 1); x.fillRect(cx - 2, ey,     1, 1);
      x.fillRect(cx - 3, ey + 1, 1, 1);
      x.fillRect(cx - 4, ey + 2, 1, 1); x.fillRect(cx - 2, ey + 2, 1, 1);
      x.fillRect(cx + 1, ey,     1, 1); x.fillRect(cx + 3, ey,     1, 1);
      x.fillRect(cx + 2, ey + 1, 1, 1);
      x.fillRect(cx + 1, ey + 2, 1, 1); x.fillRect(cx + 3, ey + 2, 1, 1);
      break;
    case 'glow':
      x.shadowColor = col;
      x.shadowBlur = 1.5;
      x.globalAlpha = 1;
      x.fillRect(cx - 3, ey + 1, 1, 1);
      x.fillRect(cx + 2, ey + 1, 1, 1);
      x.shadowBlur = 0;
      break;
    case 'heart':
      // Heart centered at col 7 and col 12 — body at cols 6-8 and 11-13 (no merge)
      x.globalAlpha = 0.9;
      x.fillRect(cx - 4, ey,     1, 1); x.fillRect(cx - 2, ey,     1, 1);
      x.fillRect(cx - 4, ey + 1, 3, 1);
      x.fillRect(cx - 3, ey + 2, 1, 1);
      x.fillRect(cx + 1, ey,     1, 1); x.fillRect(cx + 3, ey,     1, 1);
      x.fillRect(cx + 1, ey + 1, 3, 1);
      x.fillRect(cx + 2, ey + 2, 1, 1);
      break;
    case 'blaze':
      // Flame tip above pupil — both at cry positions (cx-3, cx+2)
      x.globalAlpha = 0.65;
      x.fillRect(cx - 3, ey,     1, 1); // left flame tip
      x.fillRect(cx + 2, ey,     1, 1); // right flame tip
      x.globalAlpha = 1.0;
      x.fillRect(cx - 3, ey + 1, 1, 1); // left pupil
      x.fillRect(cx + 2, ey + 1, 1, 1); // right pupil
      break;
    case 'frost':
      // Vertical ice shard — bright center, dim tips; cry positions (cx-3, cx+2)
      x.globalAlpha = 0.55;
      x.fillRect(cx - 3, ey,     1, 1); // left tip
      x.fillRect(cx + 2, ey,     1, 1); // right tip
      x.globalAlpha = 1.0;
      x.fillRect(cx - 3, ey + 1, 1, 1); // left main
      x.fillRect(cx + 2, ey + 1, 1, 1); // right main
      x.globalAlpha = 0.55;
      x.fillRect(cx - 3, ey + 2, 1, 1); // left base
      x.fillRect(cx + 2, ey + 2, 1, 1); // right base
      break;
    case 'cosmic':
      x.globalAlpha = 1.0;
      x.fillRect(cx - 3, ey,     2, 2); // left iris
      x.fillRect(cx + 2, ey,     2, 2); // right iris
      x.globalAlpha = 0.35;
      x.fillRect(cx - 4, ey - 1, 1, 1); x.fillRect(cx - 1, ey - 1, 1, 1);
      x.fillRect(cx - 4, ey + 2, 1, 1); x.fillRect(cx - 1, ey + 2, 1, 1);
      x.fillRect(cx + 1, ey - 1, 1, 1); x.fillRect(cx + 4, ey - 1, 1, 1);
      x.fillRect(cx + 1, ey + 2, 1, 1); x.fillRect(cx + 4, ey + 2, 1, 1);
      break;
    case 'cry':
      x.globalAlpha = 0.9;
      x.fillRect(cx - 3, ey,     1, 2); // left pupil
      x.fillRect(cx + 2, ey,     1, 2); // right pupil
      break;
    default:
      x.globalAlpha = 1;
      x.fillRect(cx - 3, ey + 1, 1, 1);
      x.fillRect(cx + 2, ey + 1, 1, 1);
  }
  x.globalAlpha = 1;
}

// ══════════════════════════════════════
// ACCESSORIES — hub scale
// ══════════════════════════════════════
export function drawHubAccessory(x: CanvasRenderingContext2D, acc: string, cx: number, hy: number, s: number): void {
  const savedColor = x.fillStyle as string;
  switch (acc) {
    case 'glasses':
      x.globalAlpha = 0.8;
      x.fillRect(cx - 1 * s - 1, hy + 4, 1 * s + 1, 0.5 * s);   // left lens (1px wider outer)
      x.fillRect(cx + 0.5 * s,   hy + 4, 1 * s + 1, 0.5 * s);   // right lens (1px wider outer)
      x.fillRect(cx - 0.5 * s,   hy + 4, 1 * s, 0.5 * s);        // bridge
      x.globalAlpha = 1;
      break;
    case 'sunglasses':
      x.globalAlpha = 0.9;
      x.fillRect(cx - 1.5 * s - 1, hy + 3, 1.5 * s + 1, 1 * s); // left lens (1px wider outer)
      x.fillRect(cx - 1.5 * s - 2, hy + 3, 1, 1);                // outer edge pixel
      x.fillRect(cx + 0.5 * s,     hy + 3, 1.5 * s + 1, 1 * s); // right lens (1px wider outer)
      x.fillRect(cx - 0.5 * s,     hy + 3, 1 * s, 0.5 * s);      // bridge
      x.globalAlpha = 1;
      break;
    case 'bandana': {
      x.globalAlpha = 1;
      x.fillRect(cx - 2 * s - 1, hy + 5, 4 * s + 2, 1.5 * s);   // band (1px wider each side)
      x.fillRect(cx - 1.5 * s,   hy + 7, 3 * s, 1 * s);           // triangle row 1 (tapers from band)
      x.fillRect(cx - 0.5 * s,   hy + 9, 1 * s, 0.5 * s);         // triangle tip
      x.fillStyle = lighten(savedColor, 22); x.globalAlpha = 0.5;
      x.fillRect(cx - 2 * s - 1, hy + 5, 4 * s + 2, 0.5 * s);    // top fold
      x.globalAlpha = 1;
      x.fillStyle = darken(savedColor, 20);
      x.fillRect(cx + 2 * s + 1, hy + 6, 1 * s, 0.5 * s);         // knot
      x.fillStyle = savedColor;
      break;
    }
    case 'scarf':
      x.fillRect(cx - 2 * s, hy + 9, 4 * s, 1.5 * s);
      x.fillRect(cx + 1.5 * s, hy + 10, 1 * s, 2 * s);
      break;
    case 'eyepatch':
      x.globalAlpha = 0.9;
      x.fillRect(cx - 2 * s, hy + 2, 4 * s, 0.5 * s);
      x.fillRect(cx + 0.5 * s, hy + 3, 1.5 * s, 1 * s);
      x.globalAlpha = 1;
      break;
    case 'chain': {
      // cx=10, headY=4, s=2. Neck top at headY+5*s=14. Body center x=10.
      const hx = Math.round(cx);
      const hY = Math.round(hy);
      x.fillStyle = '#d4af37'; x.globalAlpha = 0.8;
      // Left side: starts at left neck (x=7), steps inward going down
      x.fillRect(hx - 3, hY + 10, 1, 2);  // y=14 — neck
      x.fillRect(hx - 2, hY + 12, 1, 2);  // y=16
      x.fillRect(hx - 1, hY + 14, 1, 2);  // y=18
      // Right side: starts at right neck (x=12), steps inward going down
      x.fillRect(hx + 2, hY + 10, 1, 2);  // y=14 — neck
      x.fillRect(hx + 1, hY + 12, 1, 2);  // y=16
      x.fillRect(hx,     hY + 14, 1, 2);  // y=18
      // Pendant where both meet
      x.fillRect(hx - 1, hY + 16, 2, 2);  // y=20
      x.fillStyle = savedColor; x.globalAlpha = 1;
      break;
    }
    case 'earrings':
      x.globalAlpha = 0.9;
      x.fillRect(cx - 2.5 * s - 1, hy + 4, 0.5 * s, 1 * s);  // left (1px further out, 1px lower)
      x.fillRect(cx + 2 * s + 1,   hy + 4, 0.5 * s, 1 * s);  // right (1px further out, 1px lower)
      x.globalAlpha = 1;
      break;
    case 'watch': {
      x.fillStyle = darken(savedColor, 18);
      x.fillRect(cx - 2.5 * s - 1, hy + 12 * s - 5, 1 * s + 1, 1);
      x.fillStyle = savedColor;
      x.fillRect(cx - 2.5 * s,     hy + 12 * s - 5, 1 * s, 1);
      x.globalAlpha = 1;
      break;
    }
    case 'mask':
      x.fillRect(cx - 1.5 * s, hy + 5, 3 * s, 1.5 * s);
      x.fillStyle = lighten(savedColor, 18); x.globalAlpha = 0.4;
      x.fillRect(cx - 1.5 * s, hy + 5, 3 * s, 0.5 * s);
      x.fillStyle = darken(savedColor, 18); x.globalAlpha = 0.5;
      x.fillRect(cx - 0.5 * s, hy + 7, 1 * s, 0.5 * s);
      x.fillStyle = savedColor; x.globalAlpha = 0.65;
      x.fillRect(cx - 2 * s - 1, hy + 6, 0.5 * s, 1);  // left ear strap
      x.fillRect(cx + 1.5 * s,   hy + 6, 0.5 * s, 1);  // right ear strap
      x.globalAlpha = 1;
      break;
    case 'monocle':
      x.globalAlpha = 0.85;
      x.fillRect(cx - 1.5 * s, hy + 3, 1.5 * s, 1.5 * s);
      x.fillStyle = lighten(savedColor, 35); x.globalAlpha = 0.4;
      x.fillRect(cx - 1.5 * s, hy + 3, 0.5 * s, 0.5 * s);
      x.fillStyle = savedColor; x.globalAlpha = 0.55;
      x.fillRect(cx - 0.5 * s, hy + 6, 0.25 * s, 1.5 * s);
      x.globalAlpha = 1;
      break;
    case 'ring': {
      // Right arm: x = cx+tw-1*s = 13, w=2. Last arm pixel at hy+12*s.
      x.fillStyle = '#d4af37'; x.globalAlpha = 0.9;
      x.fillRect(cx + 1.5 * s, hy + 12 * s - 4, 1 * s, 1);
      x.globalAlpha = 1;
      x.fillStyle = savedColor;
      break;
    }
    default:
      if (ITEM_DEFS[acc]) {
        const hatY = hy + s + 2;
        drawImgItemAuto(x, acc, cx, hatY, HUB_HEAD_W, HUB_HEAD_W / ROOM_HEAD_W);
      }
  }
}

// ══════════════════════════════════════
// BOTTOM — hub scale
// ══════════════════════════════════════
export function drawHubBottom(
  x: CanvasRenderingContext2D,
  a: AvatarConfig,
  cx: number, headY: number, s: number,
  walkFrame: number
): { data: ImageData; cx: number; cy: number; cw: number; ch: number } | null {
  const legY = headY + 12 * s - 3;
  const legLY = walkFrame < 0 ? 0 : (walkFrame === 1 ? -1 : walkFrame === 3 ? 1 : 0);
  const legRY = walkFrame < 0 ? 0 : (walkFrame === 1 ? 1 : walkFrame === 3 ? -1 : 0);

  // ── Procedural bottoms ──
  const isPngBottom = ['jeans', 'camopants', 'baggyjeans', 'trousers', 'utilitypants', 'knightpants', 'cargopants', 'fishnet'].includes(a.bottom);
  if (a.top !== 'dress' && !isPngBottom) {
    x.fillStyle = a.bottomColor;
    if (a.bottom === 'skirt') {
      x.fillRect(cx - 2 * s, legY + 1, 4 * s, 2 * s);
      x.fillStyle = darken(a.bottomColor, 30);
      x.fillRect(cx - 2 * s, legY - 1, 4 * s, 2);
      x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
      x.fillRect(cx - 1, legY - 1, 2, 2);
      x.globalAlpha = 1;
      x.fillStyle = a.bottomColor;
    } else if (a.bottom === 'miniskirt') {
      x.fillRect(cx - 2 * s, legY + 1, 4 * s, 1 * s);
      x.fillStyle = darken(a.bottomColor, 30);
      x.fillRect(cx - 2 * s, legY - 1, 4 * s, 2);
      x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
      x.fillRect(cx - 1, legY - 1, 2, 2);
      x.globalAlpha = 1;
      x.fillStyle = a.bottomColor;
    } else {
      x.fillRect(cx - 2 * s, legY, 4 * s, 3);
      x.fillStyle = darken(a.bottomColor, 30);
      x.fillRect(cx - 2 * s, legY - 2, 4 * s, 2);
      x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
      x.fillRect(cx - 1, legY - 2, 2, 2);
      x.globalAlpha = 1;
      x.fillStyle = a.bottomColor;
      x.fillRect(cx - 2 * s, legY + legLY, 2 * s - 1, 7 * s);
      x.fillRect(cx + 1,     legY + legRY, 2 * s - 1, 7 * s);
      if (a.bottom === 'shorts') {
        x.fillStyle = a.skinColor;
        x.fillRect(cx - 2 * s, legY + 4 * s + legLY, 2 * s - 1, 3 * s);
        x.fillRect(cx + 1,     legY + 4 * s + legRY, 2 * s - 1, 3 * s);
      }
    }
  }

  // ── PNG bottoms ──
  const hubPngBottomPrefix: Record<string, string> = {
    jeans: 'bottom_jeans_hub', camopants: 'bottom_camopants_hub',
    baggyjeans: 'bottom_baggyjeans_hub', trousers: 'bottom_trousers_hub',
    utilitypants: 'bottom_utilitypants_hub', knightpants: 'bottom_knightpants_hub',
    cargopants: 'bottom_cargopants_hub', fishnet: 'bottom_fishnet_hub',
  };
  if (hubPngBottomPrefix[a.bottom] && a.top !== 'dress') {
    const cFrame = walkFrame >= 0 && walkFrame <= 3 ? walkFrame + 1 : 1;
    const cKey = `${hubPngBottomPrefix[a.bottom]}_${cFrame}`;
    const cImg = imgCache.get(cKey);
    if (cImg) {
      const bx = Math.round(cx - cImg.naturalWidth / 2);
      const by = legY + 14 - cImg.naturalHeight;
      x.fillStyle = a.bottomColor;
      drawHairImg(x, cKey, bx, by, cImg.naturalWidth, cImg.naturalHeight);
      const snap = x.getImageData(bx, by + SPRITE_HAT_HEADROOM, cImg.naturalWidth, cImg.naturalHeight);
      return { data: snap, cx: bx, cy: by + SPRITE_HAT_HEADROOM, cw: cImg.naturalWidth, ch: cImg.naturalHeight };
    }
  }
  return null;
}

// ══════════════════════════════════════
// TOP — hub scale
// ══════════════════════════════════════
export function drawHubTop(
  x: CanvasRenderingContext2D,
  a: AvatarConfig,
  cx: number, headY: number, s: number,
  pantsSnap: { data: ImageData; cx: number; cy: number; cw: number; ch: number } | null
): void {
  const topDark  = darken(a.topColor, 18);
  const topLight = lighten(a.topColor, 18);
  const tw = 3 * s;
  x.fillStyle = a.topColor;
  if (a.top === 'tank') {
    x.fillStyle = a.skinColor;
    x.fillRect(cx - 4, headY + 5 * s, 8, 2);
    x.fillStyle = a.topColor;
    x.fillRect(cx - 4, headY + 5 * s, 2, 2);
    x.fillRect(cx + 2,  headY + 5 * s, 2, 2);
    x.fillRect(cx - 4, headY + 5 * s + 2, 8, 8);
  } else if (a.top === 'tshirt') {
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 4);
    x.fillRect(cx - 2 * s, headY + 5 * s + 4, 4 * s, 7);
  } else if (a.top === 'hoodie') {
    x.fillRect(cx - tw + 1, headY + 5 * s, 4, 1);
    x.fillRect(cx + 1, headY + 5 * s, 4, 1);
    x.fillRect(cx - tw, headY + 5 * s + 1, tw * 2, 10);
    x.fillStyle = topDark;
    x.fillRect(cx - 1 * s, headY + 5 * s, 2 * s, 1 * s);
    x.fillRect(cx - 1.5 * s, headY + 5 * s + 5, 3 * s, 2 * s);
    x.fillStyle = topLight; x.globalAlpha = 0.45;
    x.fillRect(cx - 0.5 * s, headY + 5 * s + 3, 0.5 * s, 2 * s);
    x.fillRect(cx, headY + 5 * s + 3, 0.5 * s, 2 * s);
    x.globalAlpha = 1;
  } else if (a.top === 'jacket') {
  } else if (a.top === 'dress') {
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 4);
    x.fillRect(cx - 2 * s, headY + 5 * s + 4, 4 * s, 6);
    x.fillRect(cx - tw, headY + 5 * s + 10, tw * 2, 16);
    x.fillStyle = topDark;
    x.fillRect(cx - tw, headY + 5 * s + 9, tw * 2, 1);
    x.fillStyle = darken(a.topColor, 35);
    x.fillRect(cx - 2 * s, headY + 5 * s + 13, 4 * s, 1);
    x.fillRect(cx - 0.5 * s, headY + 5 * s + 12, 1 * s, 3);
  } else if (a.top === 'vest') {
    x.fillStyle = a.topColor;
    x.fillRect(cx - 1 * s - 1, headY + 5 * s, 2 * s + 2, 11);
    x.fillStyle = topDark; x.globalAlpha = 0.8;
    x.fillRect(cx - 1, headY + 5 * s, 2, 11);
    x.globalAlpha = 1;
  } else if (a.top === 'trenchcoat') {
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 7 * s - 2);
    x.fillRect(cx - tw, headY + 12 * s - 2, tw * 2, 5 * s + 3);
    x.fillStyle = topDark;
    x.fillRect(cx - 0.5 * s, headY + 5 * s, 1 * s, 12 * s - 1);
    x.fillStyle = topLight;
    x.fillRect(cx - tw, headY + 5 * s, 2 * s, 4 * s - 1);
    x.fillRect(cx + tw - 2 * s, headY + 5 * s, 2 * s, 4 * s - 1);
    x.fillStyle = darken(a.topColor, 35);
    x.fillRect(cx - tw, headY + 11 * s, tw * 2, 1 * s);
    x.fillRect(cx - 0.5 * s, headY + 10 * s, 1 * s, 3 * s);
    x.globalAlpha = 1;
  } else if (a.top === 'croptop') {
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 4);
    x.fillRect(cx - 2 * s, headY + 5 * s + 4, 4 * s, 3);
    x.fillStyle = topDark;
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 1);
  } else if (a.top === 'jersey') {
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 4);
    x.fillRect(cx - tw, headY + 5 * s + 4, tw * 2, 7);
    x.fillStyle = topDark;
    x.fillRect(cx - tw, headY + 5 * s + 4, 1 * s, 7);
    x.fillRect(cx + tw - 1 * s, headY + 5 * s + 4, 1 * s, 7);
    x.fillRect(cx - 0.5 * s, headY + 5 * s + 1, 1 * s, 10);
    x.fillStyle = topLight; x.globalAlpha = 0.45;
    x.fillRect(cx - tw, headY + 5 * s + 6, tw * 2, 1);
    x.globalAlpha = 1;
  } else if (a.top === 'longsleeve') {
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 4);
    x.fillRect(cx - tw, headY + 5 * s + 4, tw * 2, 7);
    x.fillStyle = topDark;
    x.fillRect(cx - tw, headY + 5 * s + 1, 1 * s, 10);
    x.fillRect(cx + tw - 1 * s, headY + 5 * s + 1, 1 * s, 10);
  } else if (a.top === 'polo') {
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 4);
    x.fillRect(cx - 2 * s, headY + 5 * s + 4, 4 * s, 7);
    x.fillStyle = topDark;
    x.fillRect(cx - 0.5 * s, headY + 5 * s, 1 * s, 4);
    x.fillStyle = topLight; x.globalAlpha = 0.6;
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 1);
    x.globalAlpha = 1;
  } else if (a.top === 'turtleneck') {
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 4);
    x.fillRect(cx - 2 * s, headY + 5 * s + 4, 4 * s, 7);
    x.fillRect(cx - 1.5 * s, headY + 4 * s, 3 * s, 2);
    x.fillStyle = topDark;
    x.fillRect(cx - 1.5 * s, headY + 5 * s, 3 * s, 1);
  }

  // ── PNG top detail overlay ──
  const hubTopPngKey = ({
    jacket:      'top_jacket_hub',
    bomber:      'top_bomber_hub',
    flannel:     'top_flannel_hub',
    robe:        'top_robe_hub',
    bitcoinshirt:'top_bitcoinshirt_hub',
    ostrichshirt:'top_ostrichshirt_hub',
    camoshirt:   'top_camoshirt_hub',
    tunic:       'top_tunic_hub',
    skindress:   'top_skindress_hub',
    knightchest: 'top_knightchest_hub',
  } as Record<string, string>)[a.top];
  if (hubTopPngKey && imgCache.has(hubTopPngKey)) {
    const tImg = imgCache.get(hubTopPngKey)!;
    const tx = Math.round(cx - tImg.naturalWidth / 2);
    const hubTopYOffset = a.top === 'bomber' ? -1 : 0;
    x.fillStyle = a.topColor;
    drawHairImg(x, hubTopPngKey, tx, headY + 5 * s + hubTopYOffset, tImg.naturalWidth, tImg.naturalHeight);
  }

  if (pantsSnap) restorePantsThroughSkinReveals(x, pantsSnap.cx, pantsSnap.cy, pantsSnap.cw, pantsSnap.ch, pantsSnap.data, a.skinColor);

  // ── Overalls straps ──
  const strapOverTop = !['hoodie', 'jacket', 'trenchcoat', 'vest', 'robe', 'skindress', 'knightchest', 'bomber', 'flannel', 'tunic'].includes(a.top);
  if (a.bottom === 'overalls' && strapOverTop) {
    x.fillStyle = a.bottomColor;
    x.fillRect(cx - 1 * s,   headY + 5 * s, 0.5 * s + 1, 7 * s - 1);
    x.fillRect(cx + 0.5 * s, headY + 5 * s, 0.5 * s + 1, 7 * s - 1);
    x.fillStyle = '#d4af37'; x.globalAlpha = 0.7;
    x.fillRect(cx - 1 * s,   headY + 8 * s - 1, 0.5 * s + 1, 1 * s);
    x.fillRect(cx + 0.5 * s, headY + 8 * s - 1, 0.5 * s + 1, 1 * s);
    x.globalAlpha = 1;
  }
}

// ══════════════════════════════════════
// PNG ACCESSORIES — hub scale
// ══════════════════════════════════════

/** Wings / sword — drawn before body so they appear behind */
export function drawHubPngAccBehind(x: CanvasRenderingContext2D, acc: string, color: string, skinColor: string, cx: number, hy: number, s: number): void {
  if (acc === 'wings') {
    const img = imgCache.get('acc_wings_hub');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_wings_hub', Math.round(cx - img.naturalWidth / 2), hy + 4 * s - 7, img.naturalWidth, img.naturalHeight); x.fillStyle = skinColor; }
  }
  if (acc === 'sword') {
    const img = imgCache.get('acc_sword_hub');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_sword_hub', Math.round(cx - img.naturalWidth / 2), hy + 4 * s - 4, img.naturalWidth, img.naturalHeight); x.fillStyle = skinColor; }
  }
}

/** Cape / floatie — drawn over clothes but under hair/hat */
export function drawHubPngAccOver(x: CanvasRenderingContext2D, acc: string, color: string, cx: number, hy: number, s: number): void {
  if (acc === 'cape') {
    const img = imgCache.get('acc_cape_hub');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_cape_hub', Math.round(cx - img.naturalWidth / 2), hy + 4 * s, img.naturalWidth, img.naturalHeight); }
  }
  if (acc === 'ostirchfloatie') {
    const img = imgCache.get('acc_ostirchfloatie_hub');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_ostirchfloatie_hub', Math.round(cx - img.naturalWidth / 2), hy + 5 * s, img.naturalWidth, img.naturalHeight); }
  }
}

/** Balloon — floats above everything, string anchored at wrist */
export function drawHubPngAccAbove(x: CanvasRenderingContext2D, acc: string, color: string, cx: number, hy: number, _s: number): void {
  if (acc === 'ballon') {
    const img = imgCache.get('acc_ballon_hub');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_ballon_hub', Math.round(cx - 14), hy - 10, img.naturalWidth, img.naturalHeight); }
  }
  if (acc === 'ballonbitcoin') {
    const img = imgCache.get('acc_ballonbitcoin_hub');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_ballonbitcoin_hub', Math.round(cx - 14), hy - 10, img.naturalWidth, img.naturalHeight); }
  }
  if (acc === 'ballonostrich') {
    const img = imgCache.get('acc_ballonostrich_hub');
    if (img) { x.fillStyle = color; drawHairImg(x, 'acc_ballonostrich_hub', Math.round(cx - 14), hy - 10, img.naturalWidth, img.naturalHeight); }
  }
}
