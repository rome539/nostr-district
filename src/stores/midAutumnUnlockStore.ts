/**
 * midAutumnUnlockStore.ts — the 🏮 Lantern name/chat color (deep lantern red with a
 * warm gold glint sweeping across).
 *
 * Earned by logging into Nostr District during the Mid-Autumn / Mooncake Festival.
 * The festival is the 15th day of the 8th lunar month, so the date drifts every year —
 * the windows live in holidayBanners (specificDates) and isHolidayWindowNow gates this
 * grant off the real calendar. Relay-backed via unlockStore (kind:30078), permanent
 * once earned. Mirrors halving/july4/halloween/nostrBirthday unlock stores.
 */

import { isHolidayWindowNow } from '../ui/holidayBanners';
import { unlockItem, hasItem, isUnlocksLoaded } from './unlockStore';
import { SoundEngine } from '../audio/SoundEngine';

const LANTERN_COLOR_KEY = 'nameColor:midautumn';

// The ?holiday=mid_autumn param drives banner/scavenge visuals in any environment, but
// this grant is PERMANENT — so the override only counts in dev. In prod the real lunar
// calendar (specificDates) is the only way in (otherwise anyone guessing the param mints it).
function inWindow(): boolean {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('holiday') === 'mid_autumn') return true;
  return isHolidayWindowNow('mid_autumn');
}

function showUnlockToast(): void {
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#1a1428;border:1px solid rgba(240,192,80,0.5);border-radius:8px',
    'padding:10px 20px;color:#ffe6b0;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none',
    'box-shadow:0 4px 20px rgba(240,192,80,0.3);transition:opacity 0.4s;white-space:nowrap',
  ].join(';');
  el.textContent = '🏮 Unlocked: Lantern name color';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4000);
}

/**
 * Grant the Lantern name color IF we're in the Mid-Autumn window and the player doesn't
 * already have it. Idempotent — safe to call on every login. Waits for the relay unlock
 * state to load before checking (so it doesn't double-grant / clobber).
 */
export function tryGrantMidAutumnColor(): void {
  const run = () => {
    if (hasItem(LANTERN_COLOR_KEY)) return; // already earned (a past Mid-Autumn)
    if (!inWindow()) return;                 // not the Mid-Autumn window
    if (unlockItem(LANTERN_COLOR_KEY)) showUnlockToast();
  };
  if (isUnlocksLoaded()) run();
  else window.addEventListener('nd-unlocks-loaded', run, { once: true });
}
