import { SoundEngine } from '../audio/SoundEngine';
import { hasItem, unlockItem, getLegendaryCaught, bumpLegendaryCaught } from './unlockStore';

/**
 * fishingUnlockStore.ts — fishing unlock LOGIC. State lives in unlockStore
 * (relay-backed, kind:30078), not localStorage.
 *
 *   fishhat         — own every non-legendary fish at once (checkFishHat)
 *   fishnet         — catch 5 legendary fish
 *   coelacanthmount — catch the leviathan coelacanth
 */

const LEGENDARY_THRESHOLDS: Record<string, number> = { fishnet: 5 };

const LABELS: Record<string, string> = {
  fishhat: 'Fish Hat',
  fishnet: 'Fish Net Bottoms',
  coelacanthmount: 'Coelacanth Wall Mount',
};

let _pubkey = '';

// Latest fish-collection progress (own all non-legendary fish), for display.
let _fishHatProgress = { owned: 0, total: 0 };

function showFishUnlockToast(label: string): void {
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#0d1f1a;border:1px solid rgba(80,210,150,0.4);border-radius:8px',
    'padding:10px 20px;color:#a0ffd8;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none',
    'box-shadow:0 4px 20px rgba(80,210,150,0.25);transition:opacity 0.4s;white-space:nowrap',
  ].join(';');
  el.textContent = `🎣 Item unlocked: ${label}`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3600);
}

export function initFishingProgress(pubkey: string): void {
  _pubkey = pubkey;
}

export function incrementCoelacanth(): void {
  if (!_pubkey) return;
  if (unlockItem('coelacanthmount')) showFishUnlockToast(LABELS.coelacanthmount);
}

export function incrementLegendaryCatch(): void {
  if (!_pubkey) return;
  const total = bumpLegendaryCaught();
  for (const [item, threshold] of Object.entries(LEGENDARY_THRESHOLDS)) {
    if (total >= threshold && unlockItem(item)) showFishUnlockToast(LABELS[item]);
  }
}

/**
 * Fish hat is earned by owning every non-legendary fish at once. Sticky — once
 * unlocked it stays even if fish are later sold. Fed in from the inventory wiring.
 */
export function checkFishHat(owned: number, total: number): void {
  _fishHatProgress = { owned, total };
  if (!_pubkey) return;
  if (total > 0 && owned >= total && unlockItem('fishhat')) showFishUnlockToast(LABELS.fishhat);
}

export function isFishingItemUnlocked(item: string): boolean {
  return hasItem(item);
}

/** Total legendary fish ever caught (drives the cabin leaderboard backfill). */
export function getLegendaryCount(): number {
  return getLegendaryCaught();
}

export function getFishingProgress(item: string): { count: number; required: number; unlocked: boolean } {
  if (item === 'fishhat') {
    return { count: _fishHatProgress.owned, required: _fishHatProgress.total, unlocked: hasItem('fishhat') };
  }
  return { count: getLegendaryCaught(), required: LEGENDARY_THRESHOLDS[item] ?? 1, unlocked: hasItem(item) };
}
