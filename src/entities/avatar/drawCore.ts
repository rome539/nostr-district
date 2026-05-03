import { imgCache, hubImgCache, ITEM_DEFS, HUB_HEAD_W, ROOM_HEAD_W } from './assets';
import { parseRgb } from './helpers';

// anchorCx/anchorY: anchor position in canvas pixels
// refW:             reference width for this anchor (headW or bodyW) in canvas pixels
// roomScale:        refW / ROOM_HEAD_W (or ROOM_BODY_W) — scales yGap to current canvas size
export function drawImgItemAuto(
  x: CanvasRenderingContext2D, name: string,
  anchorCx: number, anchorY: number, refW: number, roomScale: number,
): void {
  const def = ITEM_DEFS[name];
  const isHub = roomScale < 1;
  const imgKey = def?.srcName ?? name;
  const img = (isHub && hubImgCache.has(imgKey)) ? hubImgCache.get(imgKey)! : imgCache.get(imgKey);
  if (!def || !img) return;
  const yGapSrc = isHub && def.hubYGap !== undefined ? def.hubYGap : (!isHub && def.roomYGap !== undefined ? def.roomYGap : def.yGap);
  if (def.naturalSize) {
    // Draw at exact PNG pixel dimensions — no ratio scaling, no roomScale on gap
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const gap = Math.round(yGapSrc);
    const dy = def.above ? anchorY - H - gap : anchorY + gap;
    const xOff = def.xOffset ?? 0;
    const flip = isHub && def.hubFlipH !== undefined ? def.hubFlipH : (def.flipH ?? false);
    drawImgItem(x, name, Math.round(anchorCx - W / 2) + xOff, dy, W, H, flip, img);
    return;
  }
  const ratio = (!isHub && def.roomWidthRatio !== undefined) ? def.roomWidthRatio : def.widthRatio;
  let W = Math.round(refW * ratio);
  if (W % 2 !== 0) W += 1;
  const H = Math.round(W * img.naturalHeight / img.naturalWidth);
  const gap = Math.round(yGapSrc * roomScale);
  const dy = def.above ? anchorY - H - gap : anchorY + gap;
  const xOff = Math.round((def.xOffset ?? 0) * roomScale);
  const flip = isHub && def.hubFlipH !== undefined ? def.hubFlipH : (def.flipH ?? false);
  drawImgItem(x, name, Math.round(anchorCx - W / 2) + xOff, dy, W, H, flip, img);
}

export function drawImgItem(x: CanvasRenderingContext2D, name: string, dx: number, dy: number, dw: number, dh: number, flipH = false, imgOverride?: HTMLImageElement): void {
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
  } else if (!def?.noTint) {
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
  if (def?.cssFilter) x.filter = def.cssFilter;
  x.drawImage(tmp, dx, dy, dw, dh);
  x.restore();
}

export function drawHairImg(x: CanvasRenderingContext2D, key: string, dx: number, dy: number, dw: number, dh: number, flipH = false): void {
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

// Restores pants pixels that the shirt overdrew with skin color, so shirt skin-reveals
// (croptop midriff, tank exposed torso, etc.) show pants instead of skin where pants extend up.
export function restorePantsThroughSkinReveals(
  x: CanvasRenderingContext2D,
  cx: number, cy: number, w: number, h: number,
  snapshot: ImageData,
  skinColor: string,
): void {
  const r = parseInt(skinColor.slice(1, 3), 16);
  const g = parseInt(skinColor.slice(3, 5), 16);
  const b = parseInt(skinColor.slice(5, 7), 16);
  const cur = x.getImageData(cx, cy, w, h);
  const cd = cur.data, sd = snapshot.data;
  for (let i = 0; i < cd.length; i += 4) {
    if (cd[i] === r && cd[i+1] === g && cd[i+2] === b && sd[i+3] > 0 &&
        (sd[i] !== r || sd[i+1] !== g || sd[i+2] !== b)) {
      cd[i] = sd[i]; cd[i+1] = sd[i+1]; cd[i+2] = sd[i+2]; cd[i+3] = sd[i+3];
    }
  }
  x.putImageData(cur, cx, cy);
}
