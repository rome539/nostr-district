/**
 * nostrBirthdayUnlockStore.ts — the 🦤 Nostrich name/chat color (purple, with an
 * ostrich bracketing the name).
 *
 * Earned by logging into Nostr District during Nostr's Birthday (Nov 7–11, the 💜
 * holiday). Relay-backed via unlockStore (kind:30078) so it follows the player across
 * devices. Permanent once earned. Mirrors halving/july4 unlock stores.
 */

import { isHolidayWindowNow } from '../ui/holidayBanners';
import { unlockItem, hasItem, isUnlocksLoaded } from './unlockStore';
import { SoundEngine } from '../audio/SoundEngine';

const NOSTRICH_COLOR_KEY = 'nameColor:nostrich';

// The ?holiday=nostr_day param drives banner/scavenge visuals in any environment, but
// this grant is PERMANENT — so the override only counts in dev. In prod the real
// Nov 7–11 calendar is the only way in (otherwise anyone guessing the param mints it).
function inWindow(): boolean {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('holiday') === 'nostr_day') return true;
  return isHolidayWindowNow('nostr_day');
}

function showUnlockToast(): void {
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#1a1428;border:1px solid rgba(154,110,255,0.45);border-radius:8px',
    'padding:10px 20px;color:#e0d0ff;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none',
    'box-shadow:0 4px 20px rgba(154,110,255,0.3);transition:opacity 0.4s;white-space:nowrap',
  ].join(';');
  el.textContent = '🦤 Unlocked: Nostrich name color';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4000);
}

/**
 * Grant the Nostrich name color IF we're in the Nostr's Birthday window and the player
 * doesn't already have it. Idempotent — safe to call on every login. Waits for the
 * relay unlock state to load before checking (so it doesn't double-grant / clobber).
 */
export function tryGrantNostrichColor(): void {
  const run = () => {
    if (hasItem(NOSTRICH_COLOR_KEY)) return; // already earned (a past Nostr's Birthday)
    if (!inWindow()) return;                  // not the Nostr's Birthday window
    if (unlockItem(NOSTRICH_COLOR_KEY)) showUnlockToast();
  };
  if (isUnlocksLoaded()) run();
  else window.addEventListener('nd-unlocks-loaded', run, { once: true });
}
