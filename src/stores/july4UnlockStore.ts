/**
 * july4UnlockStore.ts — the 🎆 Liberty name/chat color (red→white→blue flag palette).
 *
 * Earned by logging into Nostr District during the Independence window (July 1–7,
 * per isJuly4thWindow). Relay-backed via unlockStore (kind:30078) so it follows the
 * player across devices. Permanent once earned. Mirrors halvingUnlockStore.
 */

import { isJuly4thWindow } from '../utils/fireworks';
import { unlockItem, hasItem, isUnlocksLoaded } from './unlockStore';
import { SoundEngine } from '../audio/SoundEngine';

const LIBERTY_COLOR_KEY = 'nameColor:liberty';

function showUnlockToast(): void {
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#1a1428;border:1px solid rgba(80,140,255,0.45);border-radius:8px',
    'padding:10px 20px;color:#e8ecff;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none',
    'box-shadow:0 4px 20px rgba(80,140,255,0.3);transition:opacity 0.4s;white-space:nowrap',
  ].join(';');
  el.textContent = '🎆 Unlocked: Liberty name color';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4000);
}

/**
 * Grant the Liberty name color IF we're in the July-4 window and the player doesn't
 * already have it. Idempotent — safe to call on every login. Waits for the relay
 * unlock state to load before checking (so it doesn't double-grant / clobber).
 */
export function tryGrantJuly4Color(): void {
  const run = () => {
    if (hasItem(LIBERTY_COLOR_KEY)) return;       // already earned (a past July 4th)
    if (!isJuly4thWindow()) return;               // not the Independence window
    if (unlockItem(LIBERTY_COLOR_KEY)) showUnlockToast();
  };
  if (isUnlocksLoaded()) run();
  else window.addEventListener('nd-unlocks-loaded', run, { once: true });
}
