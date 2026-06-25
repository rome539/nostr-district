/**
 * halloweenUnlockStore.ts — the 🎃 Hallows name/chat color (pumpkin orange → witch
 * purple → toxic green, flowing across the name).
 *
 * Earned by logging into Nostr District during Halloween week (Oct 25–31). Relay-backed
 * via unlockStore (kind:30078) so it follows the player across devices. Permanent once
 * earned. Mirrors halving/july4/nostrBirthday unlock stores.
 *
 * Note: this uses its own Oct 25–31 window rather than the 'halloween' banner window
 * (Oct 29–30) so the color is earnable ON Halloween itself (Oct 31 — where the login
 * banner belongs to Whitepaper Day) and across the lead-up week.
 */

import { unlockItem, hasItem, isUnlocksLoaded } from './unlockStore';
import { SoundEngine } from '../audio/SoundEngine';

const HALLOWEEN_COLOR_KEY = 'nameColor:halloween';

/** Real-calendar Halloween week: Oct 25–31. */
function inRealWindow(now: Date = new Date()): boolean {
  return now.getMonth() + 1 === 10 && now.getDate() >= 25 && now.getDate() <= 31;
}

// The ?holiday=halloween param drives banner/scavenge visuals in any environment, but
// this grant is PERMANENT — so the override only counts in dev. In prod the real
// Oct 25–31 calendar is the only way in (otherwise anyone guessing the param mints it).
function inWindow(): boolean {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('holiday') === 'halloween') return true;
  return inRealWindow();
}

function showUnlockToast(): void {
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#1a1428;border:1px solid rgba(255,117,24,0.45);border-radius:8px',
    'padding:10px 20px;color:#ffe6cc;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none',
    'box-shadow:0 4px 20px rgba(255,117,24,0.3);transition:opacity 0.4s;white-space:nowrap',
  ].join(';');
  el.textContent = '🎃 Unlocked: Hallows name color';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4000);
}

/**
 * Grant the Hallows name color IF we're in the Halloween window and the player doesn't
 * already have it. Idempotent — safe to call on every login. Waits for the relay unlock
 * state to load before checking (so it doesn't double-grant / clobber).
 */
export function tryGrantHalloweenColor(): void {
  const run = () => {
    if (hasItem(HALLOWEEN_COLOR_KEY)) return; // already earned (a past Halloween)
    if (!inWindow()) return;                   // not the Halloween window
    if (unlockItem(HALLOWEEN_COLOR_KEY)) showUnlockToast();
  };
  if (isUnlocksLoaded()) run();
  else window.addEventListener('nd-unlocks-loaded', run, { once: true });
}
