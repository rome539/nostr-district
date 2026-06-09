import { getInventory, getSetProgress, ITEM_SETS, ITEM_CATALOG } from './tradeItemStore';
import { updateSetAuraProgress } from './auraUnlockStore';
import { checkFishHat } from './fishingUnlockStore';
import { isUnlocksLoaded } from './unlockStore';

/**
 * collectionUnlocks.ts — wires the trade inventory to collection-based unlocks.
 *
 * Listens for `nd-inventory-update` (fired by tradeItemStore on every add/remove
 * and on the relay rebuild) and recomputes:
 *   • set-based auras (smoke/fire/sparkle/electric/gold) → auraUnlockStore
 *   • the fish hat (own every non-legendary fish)        → fishingUnlockStore
 *
 * Kept here (rather than inside tradeItemStore) so the store doesn't depend on the
 * unlock stores — avoids a circular import.
 */

let _wired = false;

function recompute(): void {
  if (!isUnlocksLoaded()) return; // wait until the relay unlock state has merged in
  // Set-based auras — each set that declares a rewardAura drives that aura's progress.
  const progress: Record<string, { count: number; required: number }> = {};
  for (const set of ITEM_SETS) {
    if (!set.rewardAura) continue;
    const p = getSetProgress(set);
    progress[set.rewardAura] = { count: p.owned, required: p.total };
  }
  updateSetAuraProgress(progress);

  // Fish hat: own every non-legendary fish at once
  const nonLegFish = ITEM_CATALOG.filter(i => i.category === 'fish' && i.rarity !== 'legendary').map(i => i.id);
  const owned = new Set(getInventory().map(i => i.itemId));
  const ownedCount = nonLegFish.filter(id => owned.has(id)).length;
  checkFishHat(ownedCount, nonLegFish.length);
}

/** Call once on real (non-guest) login. Recomputes on every inventory change and once
 *  the relay unlock state has loaded (whichever order they arrive in). */
export function initCollectionUnlocks(): void {
  if (_wired) { recompute(); return; }
  _wired = true;
  window.addEventListener('nd-inventory-update', recompute);
  window.addEventListener('nd-unlocks-loaded', recompute);
  recompute(); // no-op until unlocks load, but covers an already-loaded re-login
}
