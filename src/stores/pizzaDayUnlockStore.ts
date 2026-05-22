/**
 * pizzaDayUnlockStore.ts — Bitcoin Pizza Day (May 22) hat unlock.
 *
 * The pizza hat can only be obtained by logging into Nostr District on
 * May 22 of any year. The grant is per-pubkey and persists locally once
 * earned, so a user who logs in on Pizza Day 2026 keeps the hat forever.
 *
 * Called from HubScene immediately after authentication: if today is
 * May 22 and the user doesn't already have the unlock, it's granted and
 * a toast is shown.
 */

import { SoundEngine } from '../audio/SoundEngine';

const STORAGE_PREFIX = 'nd_pizza_day_unlock_';

/** True if today's local date is May 22. */
export function isPizzaDay(): boolean {
  const now = new Date();
  return now.getMonth() === 4 && now.getDate() === 22; // getMonth is 0-based
}

function storageKey(pubkey: string): string {
  return `${STORAGE_PREFIX}${pubkey}`;
}

/** True if the given pubkey has already been granted the pizza hat. */
export function isPizzaHatUnlocked(pubkey: string): boolean {
  if (!pubkey) return false;
  try { return localStorage.getItem(storageKey(pubkey)) === '1'; }
  catch { return false; }
}

/**
 * Grant the pizza hat to the user IF today is May 22 and they don't already
 * have it. Idempotent — safe to call on every login. Returns true when the
 * grant was just performed (so callers can show a toast).
 */
export function tryGrantPizzaHat(pubkey: string): boolean {
  if (!pubkey) return false;
  if (!isPizzaDay()) return false;
  if (isPizzaHatUnlocked(pubkey)) return false;
  try { localStorage.setItem(storageKey(pubkey), '1'); }
  catch { return false; }
  showPizzaHatToast();
  return true;
}

function showPizzaHatToast(): void {
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#241308;border:1px solid color-mix(in srgb,#f0a030 60%,transparent);border-radius:8px',
    'padding:10px 22px;color:#ffd07a;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none;letter-spacing:0.06em',
    'box-shadow:0 4px 20px color-mix(in srgb,#f0a030 35%,transparent);transition:opacity 0.4s;white-space:nowrap',
    'text-shadow:0 0 6px color-mix(in srgb,#f0a030 60%,transparent)',
  ].join(';');
  el.textContent = '🍕 Bitcoin Pizza Day hat unlocked!';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 4000);
}
