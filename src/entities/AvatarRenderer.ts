/**
 * AvatarRenderer.ts — Layered pixel sprite generator
 *
 * Hub scale: 20x40, Room scale: 24x60
 * Draw order: skin → bottom → top → hair → eyes → hat → accessory
 */

import { AvatarConfig } from '../stores/avatarStore';
import { imgCache, SPRITE_HAT_HEADROOM, ROOM_SPRITE_XPAD } from './avatar/assets';
import { drawHairImg, restorePantsThroughSkinReveals } from './avatar/drawCore';
import { drawHubHair, drawHubHairSidesOnly, drawHubHat, drawHubEyes, drawHubAccessory } from './avatar/hubParts';
import { drawRoomHair, drawRoomHairSidesOnly, drawRoomHat, drawRoomEyes, drawRoomAccessory } from './avatar/roomParts';
import { darken, lighten } from './avatar/helpers';

export { itemImagesReady, hatImagesReady, SPRITE_HAT_HEADROOM, ROOM_SPRITE_XPAD } from './avatar/assets';

export function renderHubSprite(a: AvatarConfig, walkFrame = -1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 37; c.height = 40 + SPRITE_HAT_HEADROOM;
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  x.translate(0, SPRITE_HAT_HEADROOM);
  const s = 2;
  const cx = 18;
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

  // ── Wings / sword — drawn before body so they appear behind ──
  if (a.accessory === 'wings') {
    const wImg = imgCache.get('acc_wings_hub');
    if (wImg) {
      x.fillStyle = a.accessoryColor;
      drawHairImg(x, 'acc_wings_hub', Math.round(cx - wImg.naturalWidth / 2), headY + 4 * s - 7, wImg.naturalWidth, wImg.naturalHeight);
      x.fillStyle = a.skinColor;
    }
  }
  if (a.accessory === 'sword') {
    const sImg = imgCache.get('acc_sword_hub');
    if (sImg) {
      x.fillStyle = a.accessoryColor;
      drawHairImg(x, 'acc_sword_hub', Math.round(cx - sImg.naturalWidth / 2), headY + 4 * s - 4, sImg.naturalWidth, sImg.naturalHeight);
      x.fillStyle = a.skinColor;
    }
  }

  if (hasPng) {
    const bImg = imgCache.get(bodyHubKey)!;
    const bx = Math.round(cx - bImg.naturalWidth / 2);
    drawHairImg(x, bodyHubKey, bx, headY, bImg.naturalWidth, bImg.naturalHeight);
  }

  const legLY = walkFrame < 0 ? 0 : (walkFrame === 1 ? -1 : walkFrame === 3 ? 1 : 0);
  const legRY = walkFrame < 0 ? 0 : (walkFrame === 1 ? 1 : walkFrame === 3 ? -1 : 0);

  // ── Bottom — color over PNG leg pixels (skipped for pure-PNG bottoms) ──
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
      // waistband fill covers the inter-leg gap in walking frames
      x.fillRect(cx - 2 * s, legY, 4 * s, 3);
      // belt buckle
      x.fillStyle = darken(a.bottomColor, 30);
      x.fillRect(cx - 2 * s, legY - 2, 4 * s, 2);
      x.fillStyle = '#c8a830'; x.globalAlpha = 0.85;
      x.fillRect(cx - 1, legY - 2, 2, 2);
      x.globalAlpha = 1;
      x.fillStyle = a.bottomColor;
      // split into left/right legs so walk animation offsets work
      x.fillRect(cx - 2 * s, legY + legLY, 2 * s - 1, 7 * s);
      x.fillRect(cx + 1,     legY + legRY, 2 * s - 1, 7 * s);
      if (a.bottom === 'shorts') {
        x.fillStyle = a.skinColor;
        x.fillRect(cx - 2 * s, legY + 4 * s + legLY, 2 * s - 1, 3 * s);
        x.fillRect(cx + 1,     legY + 4 * s + legRY, 2 * s - 1, 3 * s);
      }
    }
  }

  // ── PNG bottoms — drawn before top so shirt layers over waistband ──
  const hubPngBottomPrefix: Record<string, string> = {
    jeans: 'bottom_jeans_hub', camopants: 'bottom_camopants_hub',
    baggyjeans: 'bottom_baggyjeans_hub', trousers: 'bottom_trousers_hub',
    utilitypants: 'bottom_utilitypants_hub', knightpants: 'bottom_knightpants_hub',
    cargopants: 'bottom_cargopants_hub', fishnet: 'bottom_fishnet_hub',
  };
  let pantsSnap: ImageData | null = null;
  let pantsCX = 0, pantsCY = 0, pantsCW = 0, pantsCH = 0;
  if (hubPngBottomPrefix[a.bottom] && a.top !== 'dress') {
    const cFrame = walkFrame >= 0 && walkFrame <= 3 ? walkFrame + 1 : 1;
    const cKey = `${hubPngBottomPrefix[a.bottom]}_${cFrame}`;
    const cImg = imgCache.get(cKey);
    if (cImg) {
      // Bottom-anchored at legY + 14 so taller PNGs extend upward over the torso.
      const bx = Math.round(cx - cImg.naturalWidth / 2);
      const by = legY + 14 - cImg.naturalHeight;
      x.fillStyle = a.bottomColor;
      drawHairImg(x, cKey, bx, by, cImg.naturalWidth, cImg.naturalHeight);
      // Snapshot pants region in canvas coords (account for translate(0, SPRITE_HAT_HEADROOM)).
      pantsCX = bx;
      pantsCY = by + SPRITE_HAT_HEADROOM;
      pantsCW = cImg.naturalWidth;
      pantsCH = cImg.naturalHeight;
      pantsSnap = x.getImageData(pantsCX, pantsCY, pantsCW, pantsCH);
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

  // Show pants through any shirt skin-reveal areas (croptop midriff, tank, etc.).
  if (pantsSnap) restorePantsThroughSkinReveals(x, pantsCX, pantsCY, pantsCW, pantsCH, pantsSnap, a.skinColor);

  // ── Overalls straps — only visible over open tops (not coats/hoodie/vest) ──
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
  // ── Cape / floatie — drawn over clothes but under hair/hat ──
  if (a.accessory === 'cape') {
    const cImg = imgCache.get('acc_cape_hub');
    if (cImg) {
      x.fillStyle = a.accessoryColor;
      drawHairImg(x, 'acc_cape_hub', Math.round(cx - cImg.naturalWidth / 2), headY + 4 * s, cImg.naturalWidth, cImg.naturalHeight);
    }
  }
  if (a.accessory === 'ostirchfloatie') {
    const fImg = imgCache.get('acc_ostirchfloatie_hub');
    if (fImg) {
      x.fillStyle = a.accessoryColor;
      drawHairImg(x, 'acc_ostirchfloatie_hub', Math.round(cx - fImg.naturalWidth / 2), headY + 5 * s, fImg.naturalWidth, fImg.naturalHeight);
    }
  }

  // ── Ring & watch — only visible when wrist is exposed (short/no sleeve) ──
  const hubWristExposed = ['none', 'tank', 'tshirt', 'croptop', 'jersey', 'vest', 'dress', 'camoshirt', 'bitcoinshirt', 'ostrichshirt', 'tunic', 'polo', 'turtleneck', 'skindress'].includes(a.top);
  if ((a.accessory === 'ring' || a.accessory === 'watch') && hubWristExposed) {
    x.fillStyle = a.accessoryColor;
    drawHubAccessory(x, a.accessory, cx, headY, s);
  }

  // ── Accessory (under hair; ring/watch/headphones already drawn above) ──
  if (a.accessory !== 'none' && !['headphones', 'ring', 'watch'].includes(a.accessory)) {
    x.fillStyle = a.accessoryColor;
    drawHubAccessory(x, a.accessory, cx, headY, s);
  }

  // ── Headphones under hair ──
  if (a.accessory === 'headphones') {
    x.fillStyle = a.accessoryColor;
    drawHubAccessory(x, 'headphones', cx, headY, s);
  }

  // ── Hair ──
  const hasHat = a.hat !== 'none';
  const hatAllowsFullHair = ['halo', 'catears', 'horns', 'hornsspiral', 'knightsheadband'].includes(a.hat);
  const longHairStyle = ['long', 'mullet', 'partbeard', 'braid'].includes(a.hair);
  if (a.hair !== 'none') {
    x.fillStyle = a.hairColor;
    if (!hasHat || hatAllowsFullHair) {
      drawHubHair(x, a.hair, cx, headY, s);
    } else if (longHairStyle) {
      drawHubHairSidesOnly(x, a.hair, cx, headY, s);
    }
  }

  // ── Eyes (before hat so hat always covers eyes) ──
  drawHubEyes(x, a, cx, headY, s);

  // ── Hat ──
  if (hasHat) {
    x.fillStyle = a.hatColor;
    drawHubHat(x, a.hat, cx, headY, s);
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

  // ── Wings / sword — drawn before body so they appear behind ──
  if (a.accessory === 'wings') {
    const wImg = imgCache.get('acc_wings_room');
    if (wImg) {
      x.fillStyle = a.accessoryColor;
      drawHairImg(x, 'acc_wings_room', Math.round(12 - wImg.naturalWidth / 2), oY + 2, wImg.naturalWidth, wImg.naturalHeight);
    }
  }
  if (a.accessory === 'sword') {
    const sImg = imgCache.get('acc_sword_room');
    if (sImg) {
      x.fillStyle = a.accessoryColor;
      drawHairImg(x, 'acc_sword_room', Math.round(12 - sImg.naturalWidth / 2), oY + 5, sImg.naturalWidth, sImg.naturalHeight);
    }
  }

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
    const isPngBottom = ['jeans', 'camopants', 'baggyjeans', 'trousers', 'utilitypants', 'knightpants', 'cargopants', 'fishnet'].includes(a.bottom);
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

  // ── PNG bottoms — drawn before top so shirt layers over waistband ──
  const roomPngBottomPrefix: Record<string, string> = {
    jeans: 'bottom_jeans_room', camopants: 'bottom_camopants_room',
    baggyjeans: 'bottom_baggyjeans_room', trousers: 'bottom_trousers_room',
    utilitypants: 'bottom_utilitypants_room', knightpants: 'bottom_knightpants_room',
    cargopants: 'bottom_cargopants_room', fishnet: 'bottom_fishnet_room',
  };
  let pantsSnap: ImageData | null = null;
  let pantsCX = 0, pantsCY = 0, pantsCW = 0, pantsCH = 0;
  if (roomPngBottomPrefix[a.bottom] && a.top !== 'dress') {
    const cFrame = walkFrame >= 1 && walkFrame <= 4 ? walkFrame : 1;
    const cKey = `${roomPngBottomPrefix[a.bottom]}_${cFrame}`;
    const cImg = imgCache.get(cKey);
    if (cImg) {
      // Bottom-anchored at oY + 48 so taller PNGs extend upward over the torso.
      const bx = Math.round(12 - cImg.naturalWidth / 2);
      const by = oY + 48 - cImg.naturalHeight;
      x.fillStyle = a.bottomColor;
      drawHairImg(x, cKey, bx, by, cImg.naturalWidth, cImg.naturalHeight);
      // Snapshot pants region in canvas coords (account for translate(ROOM_SPRITE_XPAD, SPRITE_HAT_HEADROOM)).
      pantsCX = bx + ROOM_SPRITE_XPAD;
      pantsCY = by + SPRITE_HAT_HEADROOM;
      pantsCW = cImg.naturalWidth;
      pantsCH = cImg.naturalHeight;
      pantsSnap = x.getImageData(pantsCX, pantsCY, pantsCW, pantsCH);
    }
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

  // Show pants through any shirt skin-reveal areas (croptop midriff, tank, etc.).
  if (pantsSnap) restorePantsThroughSkinReveals(x, pantsCX, pantsCY, pantsCW, pantsCH, pantsSnap, a.skinColor);

  // ── Overalls straps — only visible over open tops (not coats/hoodie/vest) ──
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
  x.restore();

  // ── Cape / floatie — drawn over clothes but under hair/hat ──
  if (a.accessory === 'cape') {
    const cImg = imgCache.get('acc_cape_room');
    if (cImg) {
      x.fillStyle = a.accessoryColor;
      drawHairImg(x, 'acc_cape_room', Math.round(12 - cImg.naturalWidth / 2), oY + 13, cImg.naturalWidth, cImg.naturalHeight);
    }
  }
  if (a.accessory === 'ostirchfloatie') {
    const fImg = imgCache.get('acc_ostirchfloatie_room');
    if (fImg) {
      x.fillStyle = a.accessoryColor;
      drawHairImg(x, 'acc_ostirchfloatie_room', Math.round(12 - fImg.naturalWidth / 2), oY + 14, fImg.naturalWidth, fImg.naturalHeight);
    }
  }

  // ── Ring & watch — only visible when wrist is exposed (short/no sleeve) ──
  const roomWristExposed = ['none', 'tank', 'tshirt', 'croptop', 'jersey', 'vest', 'dress', 'camoshirt', 'bitcoinshirt', 'ostrichshirt', 'tunic', 'polo', 'turtleneck', 'skindress'].includes(a.top);
  if ((a.accessory === 'ring' || a.accessory === 'watch') && roomWristExposed) {
    x.fillStyle = a.accessoryColor;
    drawRoomAccessory(x, a.accessory, oY);
  }

  // ── Accessory (under hair; ring/watch/headphones already drawn above) ──
  if (a.accessory !== 'none' && !['headphones', 'ring', 'watch'].includes(a.accessory)) {
    x.fillStyle = a.accessoryColor;
    drawRoomAccessory(x, a.accessory, oY);
  }

  // ── Headphones under hair ──
  if (a.accessory === 'headphones') {
    x.fillStyle = a.accessoryColor;
    drawRoomAccessory(x, 'headphones', oY);
  }

  // ── Hair ──
  const hasHat = a.hat !== 'none';
  const hatAllowsFullHair = ['halo', 'catears', 'horns', 'hornsspiral', 'knightsheadband'].includes(a.hat);
  const longHairStyle = ['long', 'mullet', 'partbeard', 'braid'].includes(a.hair);
  if (a.hair !== 'none') {
    x.fillStyle = a.hairColor;
    if (!hasHat || hatAllowsFullHair) {
      drawRoomHair(x, a.hair, oY);
    } else if (longHairStyle) {
      drawRoomHairSidesOnly(x, a.hair, oY);
    }
  }

  // ── Eyes (before hat so hat always covers eyes) ──
  drawRoomEyes(x, a, oY);

  // ── Hat ──
  if (hasHat) {
    x.fillStyle = a.hatColor;
    drawRoomHat(x, a.hat, oY);
  }

  return c;
}
