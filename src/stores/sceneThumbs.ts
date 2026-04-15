/**
 * sceneThumbs.ts — Tiny thumbnail store for world map zone previews.
 * Each scene calls captureThumb() right after generating its background canvas.
 * WorldMap reads the stored data URLs as SVG image sources.
 */

const thumbs = new Map<string, string>();

/**
 * Downscale a center crop of sourceCanvas to a small JPEG thumbnail.
 * cropFraction controls how much of the canvas width is captured (default: center 40%).
 */
export function captureThumb(zone: string, sourceCanvas: HTMLCanvasElement, cropFraction = 0.4): void {
  try {
    const sw = Math.round(sourceCanvas.width * cropFraction);
    const sh = sourceCanvas.height;
    const sx = Math.round((sourceCanvas.width - sw) / 2);

    const thumb = document.createElement('canvas');
    thumb.width  = 160;
    thumb.height = 120;
    const ctx = thumb.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(sourceCanvas, sx, 0, sw, sh, 0, 0, 160, 120);
    thumbs.set(zone, thumb.toDataURL('image/jpeg', 0.72));
  } catch (_) {
    // tainted canvas or other error — skip silently
  }
}

export function getThumb(zone: string): string | undefined {
  return thumbs.get(zone);
}
