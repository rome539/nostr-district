/**
 * halvingUnlockStore.ts — the ⛏ Halving name color (mempool fee gradient).
 *
 * Earned by logging into Nostr District during the Halving celebration window
 * (the 7 days after the halving block is mined, per getHalvingPhase). Unlike the
 * Pizza Hat (localStorage), this is RELAY-BACKED via unlockStore (kind:30078), so
 * it follows the player across devices. Permanent once earned.
 */

import { getHalvingPhase } from '../ui/holidayBanners';
import { unlockItem, hasItem, isUnlocksLoaded } from './unlockStore';
import { SoundEngine } from '../audio/SoundEngine';

const HALVING_COLOR_KEY = 'nameColor:halving';

function showUnlockToast(): void {
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#1a1428;border:1px solid rgba(240,150,40,0.4);border-radius:8px',
    'padding:10px 20px;color:#f0c060;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none',
    'box-shadow:0 4px 20px rgba(240,150,40,0.3);transition:opacity 0.4s;white-space:nowrap',
  ].join(';');
  el.textContent = '⛏ Unlocked: Halving name color';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4000);
}

/**
 * Grant the Halving name color IF we're in the celebration window and the player
 * doesn't already have it. Idempotent — safe to call on every login. Waits for the
 * relay unlock state to load before checking (so it doesn't double-grant / clobber).
 */
export function tryGrantHalvingColor(): void {
  const run = () => {
    if (hasItem(HALVING_COLOR_KEY)) return;        // already earned (a past halving)
    if (getHalvingPhase() !== 'celebration') return; // not the halving window
    if (unlockItem(HALVING_COLOR_KEY)) showUnlockToast();
  };
  if (isUnlocksLoaded()) run();
  else window.addEventListener('nd-unlocks-loaded', run, { once: true });
}
