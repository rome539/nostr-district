import { getInventory, getSetProgress, ITEM_SETS, ITEM_CATALOG } from './tradeItemStore';
import { updateSetAuraProgress } from './auraUnlockStore';
import { checkFishHat } from './fishingUnlockStore';
import { isUnlocksLoaded } from './unlockStore';
import { authStore } from './authStore';
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

// Cosmetics unlocked by holding ONE specific collectable (not a whole set).
// Possession-based: usable only while the item is in inventory.
const ITEM_GATED_COSMETICS: { itemId: string; slot: string; value: string; label: string }[] = [
  { itemId: 'hol_sparkler', slot: 'accessory', value: 'sparkler', label: 'Sparkler' },
];

// Latest set-completion progress per cosmetic reward, keyed `${slot}:${value}`
// (matches the market catalog key). Read by the market panel rows + isOwned.
//
// POSSESSION-BASED: unlike auras, set cosmetics are usable only while the player
// currently HOLDS the complete set. Sell or trade away a piece and the cosmetic
// locks again until the set is reassembled — keeps set items liquid on the market.
const _cosmeticProgress: Record<string, { count: number; required: number; hint: string }> = {};
const _wasComplete: Record<string, boolean> = {}; // session transition tracking (toasts)
const _toasted = new Set<string>(); // reward keys already toasted — PERSISTED per pubkey.
// On reload the inventory rebuilds incrementally (relay refetch), so a complete set
// momentarily reads incomplete→complete and would re-fire the unlock toast every login.
// Persisting which rewards have been announced suppresses that across reloads, while a
// genuine first-time completion during play still toasts (then gets persisted).
let _toastedPk = '';

function toastedStorageKey(pk: string): string { return `nd_set_toasts_${pk}`; }

/** Load the persisted toasted-rewards set for the current pubkey (once per account). */
function ensureToastedLoaded(): void {
  const pk = authStore.getState().pubkey || '';
  if (pk === _toastedPk) return;
  _toastedPk = pk;
  _toasted.clear();
  for (const k of Object.keys(_wasComplete)) delete _wasComplete[k]; // reset transitions for the new account
  if (!pk) return;
  try {
    const arr = JSON.parse(localStorage.getItem(toastedStorageKey(pk)) || '[]');
    if (Array.isArray(arr)) arr.forEach((k: string) => _toasted.add(k));
  } catch { /* ignore */ }
}

function persistToasted(): void {
  if (!_toastedPk) return;
  try { localStorage.setItem(toastedStorageKey(_toastedPk), JSON.stringify([..._toasted])); } catch { /* ignore */ }
}

// Static hint + target for every set/item-gated cosmetic, derived straight from the
// definitions (no inventory needed). Lets the shop show "how to unlock" + the target
// count for GUESTS and before the live entitlement recompute has run — recompute()
// only fires on real login, so without this fallback those rows render a bare "0 / 0".
let _staticInfo: Record<string, { required: number; hint: string }> | null = null;
function staticCosmeticInfo(key: string): { required: number; hint: string } | undefined {
  if (!_staticInfo) {
    _staticInfo = {};
    for (const set of ITEM_SETS) {
      const rewards = [set.rewardCosmetic, ...(set.rewardCosmetics ?? [])].filter(Boolean) as { slot: string; value: string }[];
      for (const r of rewards) {
        _staticInfo[`${r.slot}:${r.value}`] = { required: set.itemIds.length, hint: `Complete the "${set.name}" set` };
      }
    }
    for (const g of ITEM_GATED_COSMETICS) {
      _staticInfo[`${g.slot}:${g.value}`] = { required: 1, hint: `Collect the ${g.label}` };
    }
  }
  return _staticInfo[key];
}

/** Live progress/entitlement for a set cosmetic. unlocked = currently holds the full set. */
export function getSetCosmeticProgress(slot: string, value: string): { count: number; required: number; unlocked: boolean; hint: string } {
  const key = `${slot}:${value}`;
  const p = _cosmeticProgress[key];
  if (p) return { count: p.count, required: p.required, unlocked: p.required > 0 && p.count >= p.required, hint: p.hint };
  // Guest / pre-login fallback: target + hint from the static definitions, count 0.
  const stat = staticCosmeticInfo(key);
  return { count: 0, required: stat?.required ?? 0, unlocked: false, hint: stat?.hint ?? '' };
}

/** True if this slot:value is a set-reward cosmetic (known to the live entitlement map). */
export function isSetCosmetic(slot: string, value: string): boolean {
  return `${slot}:${value}` in _cosmeticProgress;
}

// Same look as the aura unlock toast (auraUnlockStore) — kept local to avoid exporting it.
// Takes all labels unlocked in one pass so simultaneous completions collapse into a
// SINGLE toast + a single sound (instead of N divs stacking on the same spot).
function showCosmeticToast(labels: string[]): void {
  if (!labels.length) return;
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#1a1428;border:1px solid rgba(154,110,255,0.35);border-radius:8px',
    'padding:10px 20px;color:#e0d0ff;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none',
    'box-shadow:0 4px 20px rgba(154,110,255,0.3);transition:opacity 0.4s;max-width:80vw;text-align:center',
  ].join(';');
  el.textContent = `✨ Unlocked: ${labels.join(', ')}`;
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
    check('accessory', 'none');
    check('bottom', 'pants');
    check('eyes', 'default');
    check('aura', '');
    check('rodSkin', '');
    check('nameColor', '');
    check('chatColor', '');
    if (Object.keys(fixes).length) {
      const updated = setAvatar(fixes as any);
      // Broadcast the strip so OTHER players de-equip it in real time too — setAvatar
      // alone only updates locally (without this, e.g. a sparkler you gave away stays
      // drawn on you for everyone else until they reload).
      const [{ publishAvatar }, { sendAvatarUpdate }] = await Promise.all([
        import('../nostr/nostrService'), import('../nostr/presenceService'),
      ]);
      publishAvatar(updated).catch(() => {});
      sendAvatarUpdate();
    }
  } finally {
    _enforcing = false;
  }
}

function recompute(): void {
  if (!isUnlocksLoaded()) return; // wait until the relay unlock state has merged in
  ensureToastedLoaded();          // hydrate persisted toasts so reloads don't re-announce
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
  // Collect every reward that newly completes this pass, so multiple simultaneous
  // unlocks announce as one toast + one sound rather than N stacked on the same spot.
  const newlyUnlocked: string[] = [];
  for (const set of ITEM_SETS) {
    const rewards = [set.rewardCosmetic, ...(set.rewardCosmetics ?? [])].filter(Boolean) as { slot: string; value: string; label: string }[];
    if (!rewards.length) continue;
    const p = getSetProgress(set);
    const complete = p.total > 0 && p.owned >= p.total;
    for (const { slot, value, label } of rewards) {
      const key = `${slot}:${value}`;
      _cosmeticProgress[key] = { count: p.owned, required: p.total, hint: `Complete the "${set.name}" set` };
      // Toast only on an incomplete→complete transition, at most once per session
      // (rebuild flaps would otherwise re-fire it on every bazaar open).
      if (complete && _wasComplete[key] === false && !_toasted.has(key)) {
        _toasted.add(key);
        newlyUnlocked.push(label);
      }
      _wasComplete[key] = complete;
    }
  }

  // Item-gated cosmetics — granted by simply OWNING one specific collectable (not a
  // full set). Possession-based like set cosmetics: re-locks the instant the item is
  // sold/traded/gifted, and enforceEquipped() then strips it if it's currently worn.
  const heldIds = new Set(getInventory().map(i => i.itemId));
  for (const { itemId, slot, value, label } of ITEM_GATED_COSMETICS) {
    const has = heldIds.has(itemId);
    const key = `${slot}:${value}`;
    _cosmeticProgress[key] = { count: has ? 1 : 0, required: 1, hint: `Collect the ${label}` };
    if (has && _wasComplete[key] === false && !_toasted.has(key)) {
      _toasted.add(key);
      newlyUnlocked.push(label);
    }
    _wasComplete[key] = has;
  }

  if (newlyUnlocked.length) {
    persistToasted();
    showCosmeticToast(newlyUnlocked);
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
