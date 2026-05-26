/**
 * Dev-only clothing hot-reload helper.
 *
 * Clothing PNGs are loaded once into a module-level Map at startup, then
 * composited into per-avatar canvases that Phaser caches as textures. So
 * editing a clothing PNG on disk does NOT live-update — the cached
 * Image() is stale and the composite Phaser texture is also stale.
 *
 * This module:
 *  1. Re-fetches every entry in `imgCache` / `hubImgCache` with a
 *     cache-busting query param so the browser actually pulls the new
 *     bytes off disk.
 *  2. Walks every active Phaser scene and regenerates the local player's
 *     walk frames + every other player's avatar texture.
 *
 * Exposed via `window.__refreshClothing()` in dev only. Also wired to a
 * Vite HMR listener so saving a PNG under `public/assets/` (which would
 * normally trigger a full page reload) instead refreshes in place.
 */

import { imgCache, hubImgCache } from './assets';

// Re-fetch every cached clothing image with `?t=<timestamp>` so the
// browser bypasses its disk cache and pulls fresh bytes.
async function reloadImage(name: string, cache: Map<string, HTMLImageElement>): Promise<void> {
  const old = cache.get(name);
  if (!old?.src) return;
  // Strip any existing cache-bust query so it doesn't accumulate.
  const baseSrc = old.src.split('?')[0];
  const fresh = baseSrc + '?t=' + Date.now();
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { cache.set(name, img); resolve(); };
    img.onerror = () => resolve();
    img.src = fresh;
  });
}

async function reloadAllClothingImages(): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const name of imgCache.keys())    tasks.push(reloadImage(name, imgCache));
  for (const name of hubImgCache.keys()) tasks.push(reloadImage(name, hubImgCache));
  await Promise.all(tasks);
}

// Walk every active Phaser scene and ask each one to refresh its
// avatar textures. BaseScene exposes `_devRefreshAvatars()` for this.
function regenerateAllAvatars(): void {
  const game = (window as unknown as { __nd_game?: Phaser.Game }).__nd_game;
  if (!game) return;
  for (const scene of game.scene.getScenes(true)) {
    (scene as unknown as { _devRefreshAvatars?: () => void })._devRefreshAvatars?.();
  }
}

export async function refreshClothingArt(): Promise<void> {
  console.log('[dev] Refreshing clothing art…');
  await reloadAllClothingImages();
  regenerateAllAvatars();
  console.log('[dev] Clothing art refreshed.');
}

// Dev-only wiring. Exposed globally and on the Vite HMR channel so
// saving a clothing PNG live-updates without a full reload.
if (import.meta.env.DEV) {
  (window as unknown as { __refreshClothing?: () => Promise<void> }).__refreshClothing = refreshClothingArt;
  if (import.meta.hot) {
    // Vite fires this for ALL static asset changes under /public, then
    // schedules a full reload. Intercept clothing-asset changes and do
    // an in-place refresh instead — return without letting the reload
    // proceed by accepting the HMR update.
    import.meta.hot.on('vite:beforeFullReload', (payload: { path?: string }) => {
      const p = payload?.path || '';
      if (/\/assets\/(tops|bottoms|hats|accessories|hair|eyes|body)\//.test(p)) {
        refreshClothingArt();
        // Vite still wants to reload — there's no clean way to cancel,
        // but the refresh fires before the reload completes so the user
        // gets an instant preview. The subsequent reload is a no-op
        // visually since the new state matches.
      }
    });
  }
}
