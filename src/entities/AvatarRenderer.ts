/**
 * AvatarRenderer.ts — Layered pixel sprite generator
 *
 * Hub scale: 20x40, Room scale: 24x60
 * Draw order: skin → bottom → top → hair → hat → eyes → accessory
 */

import { AvatarConfig } from '../stores/avatarStore';

// ── Image-based item cache (hats, accessories, tops, bottoms) ────────────────
const imgCache = new Map<string, HTMLImageElement>();
const hubImgCache = new Map<string, HTMLImageElement>();

function loadItemImg(name: string, src: string, cache = imgCache): Promise<void> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => { cache.set(name, img); resolve(); };
    img.onerror = () => resolve();
    img.src = src;
  });
}

// ── Item definitions ──────────────────────────────────────────────────────────
// anchor:     which body reference point the item attaches to
// widthRatio: fraction of that anchor's reference width (headW for head anchors, bodyW for body anchors)
// above:      true = image extends ABOVE anchor (hats), false = image starts AT/BELOW anchor
// yGap:       room-scale px. If above: distance from image bottom to anchor. If below: offset from anchor to image top.
type AnchorType = 'headTop' | 'eyeLine' | 'mouthLine' | 'neckLine' | 'shoulder' | 'waist';
interface ItemDef { anchor: AnchorType; widthRatio: number; roomWidthRatio?: number; hubSrc?: string; above: boolean; yGap: number; roomYGap?: number; hubYGap?: number; flipH?: boolean; hubFlipH?: boolean; xOffset?: number; tintDark?: boolean; }

const ITEM_DEFS: Record<string, ItemDef> = {
  // ── Hats ──
  wizard:             { anchor: 'headTop', widthRatio: 1.8, roomWidthRatio: 1.5, above: true, yGap: -5, hubYGap: 2, hubFlipH: true },
  ostrichhat:         { anchor: 'headTop', widthRatio: 1.875, roomWidthRatio: 1.68, above: true, yGap: -6, hubYGap: 2, flipH: true, xOffset: -1, tintDark: true },
  // ── Accessories (image-based) ──
  halo:               { anchor: 'headTop', widthRatio: 1.0, roomWidthRatio: 1.28, above: true, yGap:  2, hubYGap: 11 },
  catears:            { anchor: 'headTop', widthRatio: 1.0, roomWidthRatio: 1.0,  above: true, yGap: -5, hubYGap:  4 },
  headphones:         { anchor: 'headTop', widthRatio: 2.0,  roomWidthRatio: 1.43, hubSrc: 'assets/hats/headphoneshub.png', above: true, yGap: -8, hubYGap: -4 },
  horns:              { anchor: 'headTop', widthRatio: 1.43,   roomWidthRatio: 1.3, above: true, yGap: -4, hubYGap:  4 },
  hornsspiral:        { anchor: 'headTop', widthRatio: 1.0,  above: true, yGap: -3, roomYGap: -4, hubYGap: 4 },
  // ── Accessories ──  (add image-based accessories here)
  // ── Tops ──        (add image-based tops here)
  // ── Bottoms ──     (add image-based bottoms here)
};

// Reference dimensions (room scale is source of truth for yGap values)
const ROOM_HEAD_W = 14;
const ROOM_BODY_W = 16; // used when image-based tops/bottoms are added
const HUB_HEAD_W  = 8;
const HUB_BODY_W  = 10; // used when image-based tops/bottoms are added

// Extra transparent pixels added to the top of every sprite canvas so tall
// hats never clip. All scenes use setOrigin(0.5, 1) so the bottom anchor
// stays fixed — this headroom is invisible to scene positioning logic.
export const SPRITE_HAT_HEADROOM = 16;
// Extra transparent pixels on each side of the room canvas so wide hats never clip.
// Body drawing uses translated coords (shifted right by this amount) so nothing moves.
export const ROOM_SPRITE_XPAD = 8;

export const itemImagesReady = Promise.all([
  loadItemImg('wizard',               'assets/hats/wizardhat.png'),
  loadItemImg('wizard',               'assets/hats/wizardhathub.png', hubImgCache),
  loadItemImg('halo',                 'assets/hats/halo.png'),
  loadItemImg('catears',              'assets/hats/catears.png'),
  loadItemImg('headphones',           'assets/hats/headphones.png'),
  loadItemImg('baseballcap',          'assets/hats/baseballcap.png'),
  loadItemImg('baseballcapbackwards', 'assets/hats/baseballcapbackwards.png'),
  loadItemImg('ostrichhat',           'assets/hats/ostrichhat.png'),
  loadItemImg('horns',                'assets/hats/horns.png'),
  loadItemImg('hornsspiral',          'assets/hats/hornsspiral.png'),
  // hub-scale variants (designed for the smaller 8px head)
  loadItemImg('headphones', 'assets/hats/headphoneshub.png', hubImgCache),
  loadItemImg('ostrichhat', 'assets/hats/ostrichhathub.png', hubImgCache),
  // hair image overrides
  loadItemImg('hair_short', 'assets/hair/short.png'),
  loadItemImg('hair_short_hub', 'assets/hair/shorthub.png'),
  loadItemImg('hair_afro', 'assets/hair/afro.png'),
  loadItemImg('hair_afro_hub', 'assets/hair/afrohub.png'),
  loadItemImg('hair_ponytail', 'assets/hair/ponytail.png'),
  loadItemImg('hair_ponytail_hub', 'assets/hair/ponytailhub.png'),
  // body base sprites
  loadItemImg('body_room',   'assets/body/body.png'),
  loadItemImg('body_hub',    'assets/body/bodyhub.png'),
  loadItemImg('body_hub_1',  'assets/body/bodyhub1.png'),
  loadItemImg('body_hub_2',  'assets/body/bodyhub2.png'),
  loadItemImg('body_hub_3',  'assets/body/bodyhub3.png'),
  loadItemImg('body_hub_4',  'assets/body/bodyhub4.png'),
  loadItemImg('body_room_1', 'assets/body/body1.png'),
  loadItemImg('body_room_2', 'assets/body/body2.png'),
  loadItemImg('body_room_3', 'assets/body/body3.png'),
  loadItemImg('body_room_4', 'assets/body/body4.png'),
  // top detail overlays
  loadItemImg('top_bomber_hub',      'assets/tops/bomberhub.png'),
  loadItemImg('top_flannel_hub',     'assets/tops/flanelhub.png'),
  loadItemImg('top_robe_hub',        'assets/tops/wizardrobehub.png'),
  loadItemImg('top_ostrichshirt_hub','assets/tops/ostirchshirthub.png'),
  loadItemImg('top_bitcoinshirt_hub','assets/tops/Bitcoinshirthub.png'),
  loadItemImg('top_bomber_room',     'assets/tops/bomber.png'),
  loadItemImg('top_flannel_room',    'assets/tops/flanel.png'),
  loadItemImg('top_robe_room',       'assets/tops/wizardrobe.png'),
  loadItemImg('top_ostrichshirt_room','assets/tops/ostirchshirt.png'),
  loadItemImg('top_bitcoinshirt_room','assets/tops/Bitcoinshirt.png'),
]);

// Kept for backward compatibility
export const hatImagesReady = itemImagesReady;

// ── Auto-placement renderer ───────────────────────────────────────────────────
// anchorCx/anchorY: anchor position in canvas pixels
// refW:             reference width for this anchor (headW or bodyW) in canvas pixels
// roomScale:        refW / ROOM_HEAD_W (or ROOM_BODY_W) — scales yGap to current canvas size
function drawImgItemAuto(
  x: CanvasRenderingContext2D, name: string,
  anchorCx: number, anchorY: number, refW: number, roomScale: number,
): void {
  const def = ITEM_DEFS[name];
  const isHub = roomScale < 1;
  const img = (isHub && hubImgCache.has(name)) ? hubImgCache.get(name)! : imgCache.get(name);
  if (!def || !img) return;
  const ratio = (!isHub && def.roomWidthRatio !== undefined) ? def.roomWidthRatio : def.widthRatio;
  let W = Math.round(refW * ratio);
  if (W % 2 !== 0) W += 1;
  const H = Math.round(W * img.naturalHeight / img.naturalWidth);
  const yGapSrc = isHub && def.hubYGap !== undefined ? def.hubYGap : (!isHub && def.roomYGap !== undefined ? def.roomYGap : def.yGap);
  const gap = Math.round(yGapSrc * roomScale);
  const dy = def.above ? anchorY - H - gap : anchorY + gap;
  const xOff = Math.round((def.xOffset ?? 0) * roomScale);
  const flip = isHub && def.hubFlipH !== undefined ? def.hubFlipH : (def.flipH ?? false);
  drawImgItem(x, name, Math.round(anchorCx - W / 2) + xOff, dy, W, H, flip, img);
}

function parseRgb(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  const rgb = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return [0, 0, 0];
}

function drawImgItem(x: CanvasRenderingContext2D, name: string, dx: number, dy: number, dw: number, dh: number, flipH = false, imgOverride?: HTMLImageElement): void {
  const img = imgOverride ?? imgCache.get(name);
  if (!img) return;
  const def = ITEM_DEFS[name];
  // Use the image's natural size for the intermediate canvas — avoids a lossy
  // non-integer pre-scale step when the source doesn't evenly match dw*4.
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const tmp = document.createElement('canvas');
  tmp.width = iw; tmp.height = ih;
  const tc = tmp.getContext('2d')!;
  tc.imageSmoothingEnabled = false;
  if (flipH) {
    tc.save(); tc.scale(-1, 1); tc.drawImage(img, -iw, 0, iw, ih); tc.restore();
  } else {
    tc.drawImage(img, 0, 0, iw, ih);
  }
  if (def?.tintDark) {
    // Only replace near-black pixels with the hat color, leaving natural colors intact
    const [tr, tg, tb] = parseRgb(x.fillStyle as string);
    const idata = tc.getImageData(0, 0, iw, ih);
    const d = idata.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      if ((d[i] + d[i + 1] + d[i + 2]) / 3 < 60) {
        d[i] = tr; d[i + 1] = tg; d[i + 2] = tb;
      }
    }
    tc.putImageData(idata, 0, 0);
  } else {
    // Multiply tint: white stays item color, grey becomes darker shade (preserves shading detail)
    tc.globalCompositeOperation = 'multiply';
    tc.fillStyle = x.fillStyle as string;
    tc.fillRect(0, 0, iw, ih);
    // Restore transparency from original art
    tc.globalCompositeOperation = 'destination-in';
    if (flipH) {
      tc.save(); tc.scale(-1, 1); tc.drawImage(img, -iw, 0, iw, ih); tc.restore();
    } else {
      tc.drawImage(img, 0, 0, iw, ih);
    }
  }
  // Nearest-neighbor from 4x intermediate → final pixel canvas (keeps crisp pixel art edges)
  x.save();
  x.imageSmoothingEnabled = false;
  x.drawImage(tmp, dx, dy, dw, dh);
  x.restore();
}

export function renderHubSprite(a: AvatarConfig, walkFrame = -1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 20; c.height = 40 + SPRITE_HAT_HEADROOM;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  x.translate(0, SPRITE_HAT_HEADROOM);
  const s = 2;
  const cx = 10;
  const headY = 4;
  const tw = 3 * s;

  const topDark  = darken(a.topColor, 18);
  const topLight = lighten(a.topColor, 18);

  // ── Skin ──
  x.fillStyle = a.skinColor;
  const bodyHubKey = walkFrame >= 0 && walkFrame <= 3 ? `body_hub_${walkFrame + 1}`
    : imgCache.has('body_hub') ? 'body_hub' : 'body_hub_1';
  const hasPng = imgCache.has(bodyHubKey);

  const legY = headY + 12 * s - 3;

  if (hasPng) {
    const bImg = imgCache.get(bodyHubKey)!;
    const bx = Math.round(cx - bImg.naturalWidth / 2);
    drawHairImg(x, bodyHubKey, bx, headY, bImg.naturalWidth, bImg.naturalHeight);
  }

  const legLY = walkFrame < 0 ? 0 : (walkFrame === 1 ? -1 : walkFrame === 3 ? 1 : 0);
  const legRY = walkFrame < 0 ? 0 : (walkFrame === 1 ? 1 : walkFrame === 3 ? -1 : 0);

  // ── Bottom — color over PNG leg pixels ──
  if (a.top !== 'dress') {
    x.fillStyle = a.bottomColor;
    if (a.bottom === 'skirt') {
      x.fillRect(cx - 2.5 * s, legY + 1 * s, 5 * s, 2 * s);
    } else if (a.bottom === 'miniskirt') {
      x.fillRect(cx - 2.5 * s, legY, 5 * s, 1.5 * s);
    } else {
      // split into left/right legs so walk animation offsets work
      x.fillRect(cx - 2 * s, legY + legLY, 2 * s - 1, 7 * s);
      x.fillRect(cx + 1,     legY + legRY, 2 * s - 1, 7 * s);
      if (a.bottom === 'shorts') {
        x.fillStyle = a.skinColor;
        x.fillRect(cx - 2 * s, legY + 4 * s + legLY, 2 * s - 1, 3 * s);
        x.fillRect(cx + 1,     legY + 4 * s + legRY, 2 * s - 1, 3 * s);
      } else if (a.bottom === 'cargopants') {
        x.fillStyle = darken(a.bottomColor, 15);
        x.fillRect(cx - 2 * s, legY + 3 * s + legLY, 1.5 * s, 2 * s);
        x.fillRect(cx + 1,     legY + 3 * s + legRY, 1.5 * s, 2 * s);
      }
      // belt: dark band + gold buckle (matches room scale)
      if (!['overalls'].includes(a.bottom) && !['dress', 'trenchcoat', 'robe'].includes(a.top)) {
        x.fillStyle = darken(a.bottomColor, 30);
        x.fillRect(cx - 2 * s, legY - 2, 4 * s, 2);
        x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
        x.fillRect(cx - 1, legY - 2, 2, 2);
        x.globalAlpha = 1;
      }
    }
  }

  // ── Top ──
  x.fillStyle = a.topColor;
  // ── short sleeve base: 12px shoulders 4px, 8px torso 7px (matches bitcoin PNG) ──
  // ── long sleeve base: collar notch 1px + full 12px body 10px (matches flannel PNG) ──
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
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 4);
    x.fillRect(cx - tw, headY + 5 * s + 4, tw * 2, 7);
    x.fillStyle = topDark;
    x.fillRect(cx - tw, headY + 5 * s + 4, 1 * s, 7);
    x.fillRect(cx + tw - 1 * s, headY + 5 * s + 4, 1 * s, 7);
    x.fillStyle = '#0e0a18';
    x.fillRect(cx - 0.5 * s, headY + 5 * s + 3, 1 * s, 8);
    x.fillStyle = '#c8c8c8'; x.globalAlpha = 0.5;
    x.fillRect(cx, headY + 5 * s + 3, 0.5 * s, 8);
    x.globalAlpha = 1;
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
    x.fillRect(cx - tw, headY + 5 * s, tw * 2, 7 * s - 2);         // upper coat
    x.fillRect(cx - tw, headY + 12 * s - 2, tw * 2, 5 * s + 3);    // long skirt (gap filled)
    x.fillStyle = topDark;
    x.fillRect(cx - 0.5 * s, headY + 5 * s, 1 * s, 12 * s - 1);               // center seam
    x.fillStyle = topLight;
    x.fillRect(cx - tw, headY + 5 * s, 2 * s, 4 * s - 1);                      // left lapel
    x.fillRect(cx + tw - 2 * s, headY + 5 * s, 2 * s, 4 * s - 1);             // right lapel
    x.fillStyle = darken(a.topColor, 35);
    x.fillRect(cx - tw, headY + 11 * s, tw * 2, 1 * s);                    // belt
    x.fillRect(cx - 0.5 * s, headY + 10 * s, 1 * s, 3 * s);               // buckle
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
    x.fillRect(cx - 1.5 * s, headY + 3 * s, 3 * s, 2 * s);
    x.fillStyle = topDark;
    x.fillRect(cx - 1.5 * s, headY + 5 * s, 3 * s, 1);
  }

  // ── PNG top detail overlay ──
  const hubTopPngKey = ({
    bomber:      'top_bomber_hub',
    flannel:     'top_flannel_hub',
    robe:        'top_robe_hub',
    bitcoinshirt:'top_bitcoinshirt_hub',
    ostrichshirt:'top_ostrichshirt_hub',
  } as Record<string, string>)[a.top];
  if (hubTopPngKey && imgCache.has(hubTopPngKey)) {
    const tImg = imgCache.get(hubTopPngKey)!;
    const tx = Math.round(cx - tImg.naturalWidth / 2);
    const hubTopYOffset = a.top === 'bomber' ? -1 : 0;
    x.fillStyle = a.topColor;
    drawHairImg(x, hubTopPngKey, tx, headY + 5 * s + hubTopYOffset, tImg.naturalWidth, tImg.naturalHeight);
  }

  // ── Overalls straps — only visible over open tops (not coats/hoodie/vest) ──
  const strapOverTop = !['hoodie', 'jacket', 'trenchcoat', 'vest', 'robe'].includes(a.top);
  if (a.bottom === 'overalls' && strapOverTop) {
    x.fillStyle = a.bottomColor;
    x.fillRect(cx - 1 * s,   headY + 5 * s, 0.5 * s + 1, 7 * s - 1);
    x.fillRect(cx + 0.5 * s, headY + 5 * s, 0.5 * s + 1, 7 * s - 1);
    x.fillStyle = '#d4af37'; x.globalAlpha = 0.7;
    x.fillRect(cx - 1 * s,   headY + 8 * s - 1, 0.5 * s + 1, 1 * s);
    x.fillRect(cx + 0.5 * s, headY + 8 * s - 1, 0.5 * s + 1, 1 * s);
    x.globalAlpha = 1;
  }
  // ── Ring & watch — only visible when wrist is exposed (short/no sleeve) ──
  const hubWristExposed = ['none', 'tank', 'tshirt', 'croptop', 'jersey', 'vest', 'dress'].includes(a.top);
  if ((a.accessory === 'ring' || a.accessory === 'watch') && hubWristExposed) {
    x.fillStyle = a.accessoryColor;
    drawHubAccessory(x, a.accessory, cx, headY, s);
  }

  // ── Headphones drawn before hair so hair renders on top ──
  if (a.accessory === 'headphones') {
    x.fillStyle = a.accessoryColor;
    drawHubAccessory(x, 'headphones', cx, headY, s);
  }

  // ── Hair ──
  const hasHat = a.hat !== 'none';
  const hatAllowsFullHair = ['halo', 'catears', 'horns', 'hornsspiral'].includes(a.hat);
  const longHairStyle = ['long', 'mullet'].includes(a.hair);
  if (a.hair !== 'none') {
    x.fillStyle = a.hairColor;
    if (!hasHat || hatAllowsFullHair) {
      drawHubHair(x, a.hair, cx, headY, s);
    } else if (longHairStyle) {
      drawHubHairSidesOnly(x, a.hair, cx, headY, s);
    }
  }

  // ── Hat ──
  if (hasHat) {
    x.fillStyle = a.hatColor;
    drawHubHat(x, a.hat, cx, headY, s);
  }

  // ── Eyes (before accessories so acc draws on top) ──
  drawHubEyes(x, a, cx, headY, s);

  // ── Accessory (ring/watch/headphones already drawn above) ──
  if (a.accessory !== 'none' && !['headphones', 'ring', 'watch'].includes(a.accessory)) {
    x.fillStyle = a.accessoryColor;
    drawHubAccessory(x, a.accessory, cx, headY, s);
  }

  return c;
}

export function renderRoomSprite(a: AvatarConfig, walkFrame = 0): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 24 + ROOM_SPRITE_XPAD * 2; c.height = 60 + SPRITE_HAT_HEADROOM;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  x.translate(ROOM_SPRITE_XPAD, SPRITE_HAT_HEADROOM);
  const oY = 10;

  // Walk animation leg offsets: frame 0 = neutral (standing), frame 1 = left up/right down, frame 2 = opposite
  const lY = walkFrame === 1 ? -1 : walkFrame === 2 ? 1 : 0;
  const rY = walkFrame === 1 ? 1 : walkFrame === 2 ? -1 : 0;

  const topDark  = darken(a.topColor, 18);
  const topLight = lighten(a.topColor, 18);

  // ── Body PNG ──
  x.fillStyle = a.skinColor;
  const bodyRoomKey = walkFrame >= 1 && walkFrame <= 4 ? `body_room_${walkFrame}` : 'body_room';
  const resolvedRoomKey = imgCache.has(bodyRoomKey) ? bodyRoomKey
    : imgCache.has('body_room') ? 'body_room' : 'body_room_1';
  const rImg = imgCache.get(resolvedRoomKey);
  const hasPng = !!rImg;
  if (rImg) {
    const rx = Math.round(12 - rImg.naturalWidth / 2);
    drawHairImg(x, resolvedRoomKey, rx, oY, rImg.naturalWidth, rImg.naturalHeight);
  }

  // ── Bottom (skipped when body PNG present — PNG walk frames handle legs) ──
  x.save();
  x.translate(0, 1);
  if (!hasPng) {
    x.fillStyle = a.bottomColor;
    if (!['skirt', 'miniskirt', 'dress'].includes(a.bottom) && a.top !== 'dress') {
      x.fillRect(7, oY + 28, 10, 2);
    }
    if (a.top === 'dress') {
      x.fillRect(7, oY + 29 + lY, 4, 15);
      x.fillRect(13, oY + 29 + rY, 4, 15);
    } else if (a.bottom === 'shorts') {
      x.fillRect(7, oY + 29 + lY, 4, 7);
      x.fillRect(13, oY + 29 + rY, 4, 7);
    } else if (a.bottom === 'skirt') {
      x.fillRect(5, oY + 28, 14, 6);
    } else if (a.bottom === 'cargopants') {
      x.fillRect(7, oY + 29 + lY, 4, 15);
      x.fillRect(13, oY + 29 + rY, 4, 15);
      x.fillStyle = darken(a.bottomColor, 15);
      x.fillRect(7, oY + 33 + lY, 4, 4);
      x.fillRect(13, oY + 33 + rY, 4, 4);
      x.fillStyle = darken(a.bottomColor, 25);
      x.fillRect(7, oY + 37 + lY, 4, 1);
      x.fillRect(13, oY + 37 + rY, 4, 1);
    } else if (a.bottom === 'overalls') {
      x.fillRect(7, oY + 29 + lY, 4, 15);
      x.fillRect(13, oY + 29 + rY, 4, 15);
      x.fillStyle = darken(a.bottomColor, 10);
      x.fillRect(5, oY + 28, 14, 3);
    } else if (a.bottom === 'miniskirt') {
      x.fillStyle = a.bottomColor;
      x.fillRect(5, oY + 29, 14, 3);
    } else {
      x.fillRect(7, oY + 29 + lY, 4, 15);
      x.fillRect(13, oY + 29 + rY, 4, 15);
    }
    x.fillStyle = darken(a.bottomColor, 20);
    x.fillRect(5, oY + 44 + lY, 6, 3);
    x.fillRect(13, oY + 44 + rY, 6, 3);
  } else if (a.top !== 'dress') {
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
      if (a.bottom === 'cargopants') {
        x.fillStyle = darken(a.bottomColor, 15);
        x.fillRect(7, oY + 33, 4, 4);
        x.fillRect(13, oY + 33, 4, 4);
      }
    }
    x.restore();
  }

  // ── Belt ──
  if (!['dress', 'overalls'].includes(a.bottom) && !['dress', 'trenchcoat', 'robe'].includes(a.top)) {
    x.fillStyle = darken(a.bottomColor, 30);
    x.fillRect(6, oY + 28, 12, 2);
    x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
    x.fillRect(10, oY + 28, 4, 2);
    x.globalAlpha = 1;
  }

  // ── Top ──
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
    x.fillRect(3, oY + 14, 18, 4);    // shoulders + sleeves
    x.fillRect(6, oY + 18, 12, 10);   // body
    x.fillRect(6, oY + 28, 12, 2);    // hem over belt
    x.fillStyle = topDark;
    x.fillRect(3, oY + 18, 3, 12);    // left sleeve (full, darker)
    x.fillRect(18, oY + 18, 3, 12);   // right sleeve (full, darker)
    x.fillRect(9, oY + 14, 6, 1);     // collar line
    x.fillRect(9, oY + 22, 6, 4);     // kangaroo pocket
    x.fillStyle = topLight; x.globalAlpha = 0.45;
    x.fillRect(11, oY + 14, 1, 4);    // drawstring L
    x.fillRect(13, oY + 14, 1, 4);    // drawstring R
    x.globalAlpha = 1;
  } else if (a.top === 'jacket') {
    x.fillRect(3, oY + 14, 18, 4);    // shoulders
    x.fillRect(6, oY + 18, 12, 10);   // body
    x.fillStyle = topDark;
    x.fillRect(3, oY + 18, 3, 12);    // left sleeve (full, darker)
    x.fillRect(18, oY + 18, 3, 12);   // right sleeve (full, darker)
    x.fillStyle = '#0e0a18';
    x.fillRect(11, oY + 17, 2, 11);   // narrow center gap
    x.fillStyle = topLight;
    x.fillRect(7, oY + 15, 4, 5);     // left lapel
    x.fillRect(13, oY + 15, 4, 5);    // right lapel
    x.fillStyle = '#c8c8c8'; x.globalAlpha = 0.5;
    x.fillRect(12, oY + 18, 1, 10);   // zipper
    x.globalAlpha = 1;
    x.fillStyle = topDark;
    x.fillRect(4, oY + 27, 16, 1);    // bottom hem line
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
    x.fillRect(3, oY + 14, 18, 4);   // shoulders
    x.fillRect(3, oY + 18, 18, 10);  // body
    x.fillRect(3, oY + 18, 2, 10);   // left sleeve
    x.fillRect(19, oY + 18, 2, 10);  // right sleeve
    x.fillRect(3, oY + 27, 18, 16);  // long coat skirt
    x.fillStyle = topDark;
    x.fillRect(11, oY + 15, 2, 29);  // center seam
    x.fillStyle = topLight;
    x.fillRect(4, oY + 14, 4, 5);    // left lapel
    x.fillRect(16, oY + 14, 4, 5);   // right lapel
    x.fillStyle = topDark;
    x.fillRect(4, oY + 27, 16, 1);   // waist hem line
    x.fillStyle = darken(a.topColor, 35);
    x.fillRect(4, oY + 32, 16, 2);   // belt
    x.fillRect(11, oY + 31, 2, 4);   // buckle
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
    x.fillRect(7, oY + 10, 10, 4);
    x.fillStyle = a.skinColor;
    x.fillRect(4, oY + 18, 2, 10);
    x.fillRect(18, oY + 18, 2, 10);
    x.fillStyle = topDark;
    x.fillRect(8, oY + 13, 8, 1);
  } else if (a.top === 'robe' || a.top === 'bitcoinshirt' || a.top === 'ostrichshirt') {
  }

  // ── PNG top detail overlay ──
  const roomTopPngKey = ({
    bomber:       'top_bomber_room',
    flannel:      'top_flannel_room',
    robe:         'top_robe_room',
    bitcoinshirt: 'top_bitcoinshirt_room',
    ostrichshirt: 'top_ostrichshirt_room',
  } as Record<string, string>)[a.top];
  if (roomTopPngKey && imgCache.has(roomTopPngKey)) {
    const tImg = imgCache.get(roomTopPngKey)!;
    const tx = Math.round(12 - tImg.naturalWidth / 2);
    const roomTopYOffset = a.top === 'bomber' ? -1 : 0;
    x.fillStyle = a.topColor;
    drawHairImg(x, roomTopPngKey, tx, oY + 14 + roomTopYOffset, tImg.naturalWidth, tImg.naturalHeight);
  }

  // ── Overalls straps — only visible over open tops (not coats/hoodie/vest) ──
  const strapOverTop = !['hoodie', 'jacket', 'trenchcoat', 'vest', 'robe'].includes(a.top);
  if (a.bottom === 'overalls' && strapOverTop) {
    x.fillStyle = a.bottomColor;
    x.fillRect(8,  oY + 14, 3, 16);
    x.fillRect(13, oY + 14, 3, 16);
    x.fillStyle = '#d4af37'; x.globalAlpha = 0.7;
    x.fillRect(8,  oY + 19, 3, 2);
    x.fillRect(13, oY + 19, 3, 2);
    x.globalAlpha = 1;
  }
  x.restore();

  // ── Ring & watch — only visible when wrist is exposed (short/no sleeve) ──
  const roomWristExposed = ['none', 'tank', 'tshirt', 'croptop', 'jersey', 'vest', 'dress'].includes(a.top);
  if ((a.accessory === 'ring' || a.accessory === 'watch') && roomWristExposed) {
    x.fillStyle = a.accessoryColor;
    drawRoomAccessory(x, a.accessory, oY);
  }

  // ── Headphones drawn before hair so hair renders on top ──
  if (a.accessory === 'headphones') {
    x.fillStyle = a.accessoryColor;
    drawRoomAccessory(x, 'headphones', oY);
  }

  // ── Hair ──
  const hasHat = a.hat !== 'none';
  const hatAllowsFullHair = ['halo', 'catears', 'horns', 'hornsspiral'].includes(a.hat);
  const longHairStyle = ['long', 'mullet'].includes(a.hair);
  if (a.hair !== 'none') {
    x.fillStyle = a.hairColor;
    if (!hasHat || hatAllowsFullHair) {
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

  // ── Accessory (ring/watch/headphones already drawn above) ──
  if (a.accessory !== 'none' && !['headphones', 'ring', 'watch'].includes(a.accessory)) {
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
    case 'long':
      x.fillRect(cx - 2 * s, hy, 4 * s, 2 * s - 1);
      x.fillRect(cx - 2.5 * s, hy + 1 * s - 1, 1 * s, 5 * s);
      x.fillRect(cx + 1.5 * s, hy + 1 * s - 1, 1 * s, 5 * s);
      break;
    case 'ponytail': {
      const d = HAIR_DEFS.ponytail;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2 * s + 1, hy + 3, 4 * s - 1, 1); x.fillRect(cx - 2 * s, hy + 4, 4 * s, 2 * s - 2); x.fillRect(cx + 1.5 * s, hy + 1 * s + 2, 1 * s, 4 * s); }
      break;
    }
    case 'spiky':
      x.fillRect(cx - 2 * s, hy - 1 * s, 1 * s, 2 * s);
      x.fillRect(cx - 0.5 * s, hy - 2 * s, 1 * s, 2 * s);
      x.fillRect(cx + 1 * s, hy - 1 * s, 1 * s, 2 * s);
      x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s);
      break;
    case 'buzz':
      x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s);
      break;
    case 'afro': {
      const d = HAIR_DEFS.afro;
      if (imgCache.has(d.hubKey)) { drawHairImg(x, d.hubKey, cx + d.hubOffX, hy + d.hubOffY, d.hubW, d.hubH, d.flipH); }
      else { x.fillRect(cx - 2.5 * s + 1, hy - 2 * s + 5, 5 * s - 2, 2 * s - 1); x.fillRect(cx - 3 * s + 1, hy - 1 * s + 4, 1.5 * s - 1, 2 * s); x.fillRect(cx + 1.5 * s, hy - 1 * s + 4, 1.5 * s - 1, 2 * s); x.fillRect(cx - 2 * s, hy + 4, 4 * s, 1 * s); }
      break;
    }
    case 'bun':
      x.fillRect(cx - 2 * s, hy, 4 * s, 1 * s);
      x.fillRect(cx - 1 * s, hy - 2 * s, 2 * s, 1 * s);
      x.fillRect(cx - 1.5 * s, hy - 1 * s, 1 * s, 1 * s);
      x.fillRect(cx + 0.5 * s, hy - 1 * s, 1 * s, 1 * s);
      x.fillRect(cx - 1 * s, hy, 2 * s, 1 * s);
      break;
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
function drawHubHairSidesOnly(x: CanvasRenderingContext2D, hair: string, cx: number, hy: number, s: number): void {
  switch (hair) {
    case 'long':
      x.fillRect(cx - 2.5 * s, hy + 1 * s - 1, 1 * s, 5 * s); // left hang
      x.fillRect(cx + 1.5 * s, hy + 1 * s - 1, 1 * s, 5 * s); // right hang
      break;
    case 'ponytail':
      x.fillRect(cx + 1.5 * s, hy + 2 * s + 1, 1 * s, 4 * s); // tail
      break;
    case 'mullet':
      x.fillRect(cx - 2.5 * s, hy + 1 * s, 1 * s, 6 * s); // left hang
      x.fillRect(cx + 1.5 * s, hy + 1 * s, 1 * s, 6 * s); // right hang
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
interface HairDef {
  roomKey: string; roomX: number; roomY: number; roomW: number; roomH: number;
  hubKey:  string; hubOffX: number; hubOffY: number; hubW: number; hubH: number;
  flipH?: boolean;
}
const HAIR_DEFS: Record<string, HairDef> = {
  short:    { roomKey: 'hair_short',    roomX: 4, roomY: -3, roomW: 16, roomH: 7,  hubKey: 'hair_short_hub',    hubOffX: -5, hubOffY: -2, hubW: 10, hubH: 4  },
  afro:     { roomKey: 'hair_afro',     roomX: 1, roomY: -7, roomW: 22, roomH: 15, hubKey: 'hair_afro_hub',     hubOffX: -8, hubOffY: -6, hubW: 16, hubH: 12 },
  ponytail: { roomKey: 'hair_ponytail', roomX: 0, roomY: -7, roomW: 20, roomH: 14, hubKey: 'hair_ponytail_hub', hubOffX: -7, hubOffY: -6, hubW: 13, hubH: 11, flipH: true },
};

function drawHairImg(x: CanvasRenderingContext2D, key: string, dx: number, dy: number, dw: number, dh: number, flipH = false): void {
  const img = imgCache.get(key);
  if (!img) return;
  const tmp = document.createElement('canvas');
  tmp.width = img.naturalWidth; tmp.height = img.naturalHeight;
  const tc = tmp.getContext('2d')!;
  tc.imageSmoothingEnabled = false;
  tc.drawImage(img, 0, 0);
  tc.globalCompositeOperation = 'multiply';
  tc.fillStyle = x.fillStyle as string;
  tc.fillRect(0, 0, tmp.width, tmp.height);
  tc.globalCompositeOperation = 'destination-in';
  tc.drawImage(img, 0, 0);
  x.save();
  x.imageSmoothingEnabled = false;
  if (flipH) {
    x.translate(dx + dw, dy);
    x.scale(-1, 1);
    x.drawImage(tmp, 0, 0, dw, dh);
  } else {
    x.drawImage(tmp, dx, dy, dw, dh);
  }
  x.restore();
}

function drawRoomHair(x: CanvasRenderingContext2D, hair: string, oY: number): void {
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
    case 'long':
      x.fillRect(5, oY, 14, 4);
      x.fillRect(3, oY + 2, 4, 10);
      x.fillRect(17, oY + 2, 4, 10);
      break;
    case 'ponytail': {
      const d = HAIR_DEFS.ponytail;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(6, oY, 12, 1); x.fillRect(5, oY + 1, 14, 3); x.fillRect(19, oY + 3, 1, 1); x.fillRect(17, oY + 4, 3, 8); }
      break;
    }
    case 'spiky':
      x.fillRect(5, oY - 2, 4, 4);
      x.fillRect(10, oY - 4, 4, 4);
      x.fillRect(15, oY - 2, 4, 4);
      x.fillRect(5, oY, 14, 3);
      break;
    case 'buzz':
      x.fillRect(5, oY, 14, 3);
      break;
    case 'afro': {
      const d = HAIR_DEFS.afro;
      if (imgCache.has(d.roomKey)) { drawHairImg(x, d.roomKey, d.roomX, oY + d.roomY, d.roomW, d.roomH, d.flipH); }
      else { x.fillRect(5, oY - 4, 14, 5); x.fillRect(3, oY - 1, 3, 4); x.fillRect(18, oY - 1, 3, 4); x.fillRect(5, oY, 14, 3); }
      break;
    }
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
    case 'crown': {
      const crSave = x.fillStyle as string;
      x.fillStyle = '#f0c040';
      x.fillRect(cx - 2 * s, pY - 3 * s, 4 * s, 1.5 * s);
      x.fillRect(cx - 2 * s, pY - 4 * s, 1 * s, 1 * s);
      x.fillRect(cx - 0.5 * s, pY - 5 * s, 1 * s, 1.5 * s);
      x.fillRect(cx + 1 * s, pY - 4 * s, 1 * s, 1 * s);
      x.fillStyle = '#e87a10'; x.globalAlpha = 0.7;
      x.fillRect(cx - 1 * s, pY - 2 * s, 1 * s, 0.5 * s);
      x.globalAlpha = 1;
      x.fillStyle = crSave;
      break;
    }
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
// HATS — room scale
// ══════════════════════════════════════
function drawRoomHat(x: CanvasRenderingContext2D, hat: string, oY: number): void {
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
// ACCESSORIES — hub scale
// ══════════════════════════════════════
function drawHubAccessory(x: CanvasRenderingContext2D, acc: string, cx: number, hy: number, s: number): void {
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
// EYES — hub scale
// ══════════════════════════════════════
function drawHubEyes(x: CanvasRenderingContext2D, a: AvatarConfig, cx: number, headY: number, s: number): void {
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
      // 1px bright pupil + faint halo around each pupil
      x.globalAlpha = 1;
      x.fillRect(cx - 2, ey + 1, 1, 1);
      x.fillRect(cx + 1, ey + 1, 1, 1);
      x.globalAlpha = 0.3;
      // left halo
      x.fillRect(cx - 3, ey + 1, 1, 1);
      x.fillRect(cx - 1, ey + 1, 1, 1);
      x.fillRect(cx - 2, ey,     1, 1);
      x.fillRect(cx - 2, ey + 2, 1, 1);
      // right halo
      x.fillRect(cx,     ey + 1, 1, 1);
      x.fillRect(cx + 2, ey + 1, 1, 1);
      x.fillRect(cx + 1, ey,     1, 1);
      x.fillRect(cx + 1, ey + 2, 1, 1);
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
    default:
      x.globalAlpha = 1;
      x.fillRect(cx - 3, ey + 1, 1, 1);
      x.fillRect(cx + 2, ey + 1, 1, 1);
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
      // Default 2x2 pupils with tight cardinal ring
      x.globalAlpha = 1;
      x.fillRect(7,  oY + 5, 2, 2);
      x.fillRect(14, oY + 5, 2, 2);
      x.globalAlpha = 0.3;
      x.fillRect(7,  oY + 4, 2, 1); x.fillRect(7,  oY + 7, 2, 1);
      x.fillRect(6,  oY + 5, 1, 2); x.fillRect(9,  oY + 5, 1, 2);
      x.fillRect(14, oY + 4, 2, 1); x.fillRect(14, oY + 7, 2, 1);
      x.fillRect(13, oY + 5, 1, 2); x.fillRect(16, oY + 5, 1, 2);
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
    default:
      x.globalAlpha = 0.7;
      x.fillRect(8, oY + 5, 2, 2);
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
