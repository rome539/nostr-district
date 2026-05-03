/**
 * AvatarRenderer.ts — Layered pixel sprite generator
 *
 * Hub scale: 20x40, Room scale: 24x60
 * Draw order: skin → bottom → top → hair → eyes → hat → accessory
 */

import { AvatarConfig } from '../stores/avatarStore';
import { imgCache, SPRITE_HAT_HEADROOM, ROOM_SPRITE_XPAD } from './avatar/assets';
import { drawHairImg } from './avatar/drawCore';
import { drawHubHair, drawHubHairSidesOnly, drawHubHat, drawHubEyes, drawHubAccessory, drawHubPngAccBehind, drawHubPngAccOver, drawHubPngAccAbove, drawHubBottom, drawHubTop } from './avatar/hubParts';
import { drawRoomHair, drawRoomHairSidesOnly, drawRoomHat, drawRoomEyes, drawRoomAccessory, drawRoomPngAccBehind, drawRoomPngAccOver, drawRoomPngAccAbove, drawRoomBottom, drawRoomTop } from './avatar/roomParts';

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

  // ── Skin ──
  x.fillStyle = a.skinColor;
  const bodyHubKey = walkFrame >= 0 && walkFrame <= 3 ? `body_hub_${walkFrame + 1}`
    : imgCache.has('body_hub') ? 'body_hub' : 'body_hub_1';
  const hasPng = imgCache.has(bodyHubKey);

  // ── Wings / sword — drawn before body so they appear behind ──
  drawHubPngAccBehind(x, a.accessory, a.accessoryColor, a.skinColor, cx, headY, s);

  if (hasPng) {
    const bImg = imgCache.get(bodyHubKey)!;
    const bx = Math.round(cx - bImg.naturalWidth / 2);
    drawHairImg(x, bodyHubKey, bx, headY, bImg.naturalWidth, bImg.naturalHeight);
  }

  const pantsSnap = drawHubBottom(x, a, cx, headY, s, walkFrame);
  drawHubTop(x, a, cx, headY, s, pantsSnap);

  // ── Cape / floatie — drawn over clothes but under hair/hat ──
  drawHubPngAccOver(x, a.accessory, a.accessoryColor, cx, headY, s);

  // ── Ring & watch — only visible when wrist is exposed (short/no sleeve) ──
  const hubWristExposed = ['none', 'tank', 'tshirt', 'croptop', 'jersey', 'vest', 'dress', 'camoshirt', 'bitcoinshirt', 'ostrichshirt', 'tunic', 'polo', 'turtleneck', 'skindress'].includes(a.top);
  if ((a.accessory === 'ring' || a.accessory === 'watch') && hubWristExposed) {
    x.fillStyle = a.accessoryColor;
    drawHubAccessory(x, a.accessory, cx, headY, s);
  }

  // ── Accessory (under hair; ring/watch/headphones/balloon already drawn above) ──
  if (a.accessory !== 'none' && !['headphones', 'ring', 'watch', 'ballon', 'ballonbitcoin', 'ballonostrich'].includes(a.accessory)) {
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

  // ── Balloon — floats above everything, string anchored at wrist ──
  drawHubPngAccAbove(x, a.accessory, a.accessoryColor, cx, headY, s);

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
  // ── Wings / sword — drawn before body so they appear behind ──
  drawRoomPngAccBehind(x, a.accessory, a.accessoryColor, oY);

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

  // ── Bottom + Top ──
  x.save();
  x.translate(0, 1);
  const pantsSnap = drawRoomBottom(x, a, oY, walkFrame, hasPng);
  drawRoomTop(x, a, oY, pantsSnap);
  x.restore();

  // ── Cape / floatie — drawn over clothes but under hair/hat ──
  drawRoomPngAccOver(x, a.accessory, a.accessoryColor, oY);

  // ── Ring & watch — only visible when wrist is exposed (short/no sleeve) ──
  const roomWristExposed = ['none', 'tank', 'tshirt', 'croptop', 'jersey', 'vest', 'dress', 'camoshirt', 'bitcoinshirt', 'ostrichshirt', 'tunic', 'polo', 'turtleneck', 'skindress'].includes(a.top);
  if ((a.accessory === 'ring' || a.accessory === 'watch') && roomWristExposed) {
    x.fillStyle = a.accessoryColor;
    drawRoomAccessory(x, a.accessory, oY);
  }

  // ── Accessory (under hair; ring/watch/headphones/balloon already drawn above) ──
  if (a.accessory !== 'none' && !['headphones', 'ring', 'watch', 'ballon', 'ballonbitcoin', 'ballonostrich'].includes(a.accessory)) {
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

  // ── Balloon — floats above everything, string anchored at wrist ──
  drawRoomPngAccAbove(x, a.accessory, a.accessoryColor, oY);

  return c;
}
