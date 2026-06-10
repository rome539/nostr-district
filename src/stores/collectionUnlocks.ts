import { getInventory, getSetProgress, ITEM_SETS, ITEM_CATALOG } from './tradeItemStore';
import { updateSetAuraProgress } from './auraUnlockStore';
import { checkFishHat } from './fishingUnlockStore';
import { isUnlocksLoaded } from './unlockStore';
import { SoundEngine } from '../audio/SoundEngine';

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

// Latest set-completion progress per cosmetic reward, keyed `${slot}:${value}`
// (matches the market catalog key). Read by the market panel rows + isOwned.
//
// POSSESSION-BASED: unlike auras, set cosmetics are usable only while the player
// currently HOLDS the complete set. Sell or trade away a piece and the cosmetic
// locks again until the set is reassembled — keeps set items liquid on the market.
const _cosmeticProgress: Record<string, { count: number; required: number; hint: string }> = {};
const _wasComplete: Record<string, boolean> = {}; // session transition tracking (toasts)
const _toasted = new Set<string>(); // toast each reward at most ONCE per session —
// inventory rebuilds (bazaar open, relay refetch) can flap progress transiently and
// would otherwise re-fire the unlock toast every time.

/** Live progress/entitlement for a set cosmetic. unlocked = currently holds the full set. */
export function getSetCosmeticProgress(slot: string, value: string): { count: number; required: number; unlocked: boolean; hint: string } {
  const p = _cosmeticProgress[`${slot}:${value}`] ?? { count: 0, required: 0, hint: '' };
  return { count: p.count, required: p.required, unlocked: p.required > 0 && p.count >= p.required, hint: p.hint };
}

/** True if this slot:value is a set-reward cosmetic (known to the live entitlement map). */
export function isSetCosmetic(slot: string, value: string): boolean {
  return `${slot}:${value}` in _cosmeticProgress;
}

// Same look as the aura unlock toast (auraUnlockStore) — kept local to avoid exporting it.
function showCosmeticToast(label: string): void {
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#1a1428;border:1px solid rgba(154,110,255,0.35);border-radius:8px',
    'padding:10px 20px;color:#e0d0ff;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none',
    'box-shadow:0 4px 20px rgba(154,110,255,0.3);transition:opacity 0.4s;white-space:nowrap',
  ].join(';');
  el.textContent = `✨ Unlocked: ${label}`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3600);
}

// ── Entitlement enforcement ───────────────────────────────────────────────────
// Possession-based cosmetics must come OFF when the set breaks. The wardrobe picker
// re-locks on its own (it filters by isOwned), but the EQUIPPED avatar and saved
// outfits would otherwise keep the cosmetic forever. This strips any earn-gated
// value the player no longer qualifies for. Runs after every entitlement recompute
// (inventory changed) and after every local avatar change (covers outfit loads —
// applying a saved outfit with a lost cosmetic gets corrected immediately).
// Note: client-side enforcement — same trust level as the avatar itself.
let _enforcing = false;
async function enforceEquipped(): Promise<void> {
  if (_enforcing || !isUnlocksLoaded()) return;
  _enforcing = true;
  try {
    const [{ getAvatar, setAvatar }, { isOwned, isEarnGated }] = await Promise.all([
      import('./avatarStore'), import('./marketStore'),
    ]);
    const a = getAvatar();
    const fixes: Record<string, string> = {};
    const check = (slot: keyof typeof a & string, none: string) => {
      const v = String(a[slot] ?? '');
      if (v && v !== none && isEarnGated(slot, v) && !isOwned(slot, v)) fixes[slot] = none;
    };
    check('hat', 'none');
    check('bottom', 'pants');
    check('aura', '');
    check('rodSkin', '');
    check('nameColor', '');
    check('chatColor', '');
    if (Object.keys(fixes).length) setAvatar(fixes as any);
  } finally {
    _enforcing = false;
  }
}

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

  // Set cosmetics (rod skins, name colors, hats) — POSSESSION-BASED entitlement.
  // No permanent unlock is stored: ownership is recomputed live from the inventory,
  // so trading away a set piece re-locks the cosmetic until the set is whole again.
  for (const set of ITEM_SETS) {
    if (!set.rewardCosmetic) continue;
    const { slot, value, label } = set.rewardCosmetic;
    const key = `${slot}:${value}`;
    const p = getSetProgress(set);
    _cosmeticProgress[key] = { count: p.owned, required: p.total, hint: `Complete the "${set.name}" set` };
    const complete = p.total > 0 && p.owned >= p.total;
    // Toast only on an incomplete→complete transition, at most once per session
    // (rebuild flaps would otherwise re-fire it on every bazaar open).
    if (complete && _wasComplete[key] === false && !_toasted.has(key)) {
      _toasted.add(key);
      showCosmeticToast(label);
    }
    _wasComplete[key] = complete;
  }

  // Fish hat: own every non-legendary fish at once
  const nonLegFish = ITEM_CATALOG.filter(i => i.category === 'fish' && i.rarity !== 'legendary').map(i => i.id);
  const owned = new Set(getInventory().map(i => i.itemId));
  const ownedCount = nonLegFish.filter(id => owned.has(id)).length;
  checkFishHat(ownedCount, nonLegFish.length);

  // Strip anything the player no longer qualifies for off the equipped avatar.
  enforceEquipped().catch(() => {});
}

/** Call once on real (non-guest) login. Recomputes on every inventory change and once
 *  the relay unlock state has loaded (whichever order they arrive in). */
export function initCollectionUnlocks(): void {
  if (_wired) { recompute(); return; }
  _wired = true;
  // Debounced: inventory rebuilds fire bursts of nd-inventory-update with transient
  // partial state — evaluate once things settle so entitlements (and the equipped-
  // avatar enforcement) never act on a half-built inventory.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const recomputeSettled = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; recompute(); }, 150);
  };
  window.addEventListener('nd-inventory-update', recomputeSettled);
  window.addEventListener('nd-unlocks-loaded', recomputeSettled);
  // Re-validate on every local avatar change too — this is what closes the saved-
  // outfit loophole: loading an outfit that includes a since-lost cosmetic gets
  // stripped immediately (the _enforcing guard prevents loops).
  import('./avatarStore').then(({ onLocalAvatarChange }) => {
    onLocalAvatarChange(() => { enforceEquipped().catch(() => {}); });
  });
  recompute(); // no-op until unlocks load, but covers an already-loaded re-login
}
