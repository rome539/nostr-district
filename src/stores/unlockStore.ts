/**
 * unlockStore.ts — relay-backed persistence for cosmetic unlocks.
 *
 * Holds every per-player unlock (auras, fishing items) plus the progress counters
 * that drive the action/time-based ones (login streak, legendary catches). Persisted
 * as a single kind:30078 event signed by the user (d-tag "nostr-district-unlocks"),
 * exactly like the avatar/inventory/room state — NOT localStorage, so unlocks follow
 * the player across devices and can't be wiped by clearing browser data.
 *
 * auraUnlockStore + fishingUnlockStore hold the unlock *logic* and read/write through
 * here. Load is async (relay fetch on login); checks are gated until `isUnlocksLoaded()`
 * so we never clobber the relay copy or fire spurious "unlocked" toasts before merge.
 */

export interface UnlockState {
  auras: string[];          // unlocked aura ids
  items: string[];          // unlocked fishing item ids (fishhat, fishnet, coelacanthmount)
  loginStreak: number;      // consecutive-day login streak (drives ice/void)
  lastLoginDate: string;    // YYYY-MM-DD of last counted login
  legendaryCaught: number;  // total legendary fish caught (drives fishnet + cabin backfill)
}

function blank(): UnlockState {
  return { auras: [], items: [], loginStreak: 0, lastLoginDate: '', legendaryCaught: 0 };
}

let _pubkey = '';
let _loaded = false;
let _state: UnlockState = blank();
let _publishTimer: ReturnType<typeof setTimeout> | null = null;

export function isUnlocksLoaded(): boolean { return _loaded; }
export function getUnlockState(): UnlockState { return _state; }

/** Clear in-memory unlock state (on logout / guest login) so it can't leak across accounts. */
export function resetUnlocks(): void {
  if (_publishTimer) { clearTimeout(_publishTimer); _publishTimer = null; }
  _pubkey = '';
  _loaded = false;
  _state = blank();
}

export function hasAura(id: string): boolean { return !!_pubkey && _state.auras.includes(id); }
export function hasItem(id: string): boolean { return !!_pubkey && _state.items.includes(id); }

/** Returns true if this was newly unlocked (caller shows the toast). */
export function unlockAura(id: string): boolean {
  if (!_pubkey || _state.auras.includes(id)) return false;
  _state.auras = [...new Set([..._state.auras, id])];
  schedulePublish();
  return true;
}

/** Returns true if this was newly unlocked (caller shows the toast). */
export function unlockItem(id: string): boolean {
  if (!_pubkey || _state.items.includes(id)) return false;
  _state.items = [...new Set([..._state.items, id])];
  schedulePublish();
  return true;
}

export function setLoginStreak(streak: number, date: string): void {
  if (_state.loginStreak === streak && _state.lastLoginDate === date) return;
  _state.loginStreak = streak;
  _state.lastLoginDate = date;
  schedulePublish();
}

export function getLegendaryCaught(): number { return _state.legendaryCaught; }

export function bumpLegendaryCaught(): number {
  _state.legendaryCaught = (_state.legendaryCaught || 0) + 1;
  schedulePublish();
  return _state.legendaryCaught;
}

function schedulePublish(): void {
  if (!_loaded || !_pubkey) return; // never write before we've merged the relay copy
  if (_publishTimer) clearTimeout(_publishTimer);
  _publishTimer = setTimeout(flush, 800);
}

async function flush(): Promise<void> {
  _publishTimer = null;
  try {
    const { publishUnlocks } = await import('../nostr/nostrService');
    await publishUnlocks(_state);
  } catch { /* best effort */ }
}

function union(a: string[] = [], b: string[] = []): string[] { return [...new Set([...a, ...b])]; }

// One-time migration: fold any pre-existing localStorage unlocks into the relay
// copy so upgrading users don't lose progress. Returns true if anything was found.
function migrateLocalStorage(pubkey: string): boolean {
  let found = false;
  try {
    const a = JSON.parse(localStorage.getItem(`nd_aura_progress_${pubkey}`) || 'null');
    if (a) {
      _state.auras = union(_state.auras, a.unlockedAuras || []);
      _state.loginStreak = Math.max(_state.loginStreak, a.loginStreak || 0);
      if ((a.lastLoginDate || '') > _state.lastLoginDate) _state.lastLoginDate = a.lastLoginDate;
      found = true;
    }
  } catch { /* ignore */ }
  try {
    const f = JSON.parse(localStorage.getItem(`nd_fishing_progress_${pubkey}`) || 'null');
    if (f) {
      _state.items = union(_state.items, f.unlockedItems || []);
      _state.legendaryCaught = Math.max(_state.legendaryCaught, f.legendaryCaught || 0);
      found = true;
    }
  } catch { /* ignore */ }
  return found;
}

/** Call once on real (non-guest) login. Loads + merges the relay copy, migrates any
 *  old localStorage, then fires `nd-unlocks-loaded` so the unlock checks can run. */
export function initUnlocks(pubkey: string): void {
  _pubkey = pubkey;
  _loaded = false;
  _state = blank();
  import('../nostr/nostrService').then(async ({ fetchUnlocks }) => {
    let remote: UnlockState | null = null;
    try { remote = await fetchUnlocks(pubkey); } catch { /* offline → start blank */ }
    if (remote) {
      _state = {
        auras: union(_state.auras, remote.auras),
        items: union(_state.items, remote.items),
        loginStreak: remote.loginStreak ?? _state.loginStreak,
        lastLoginDate: remote.lastLoginDate ?? _state.lastLoginDate,
        legendaryCaught: Math.max(_state.legendaryCaught, remote.legendaryCaught ?? 0),
      };
    }
    const migrated = migrateLocalStorage(pubkey);
    _loaded = true;
    // If we migrated old data or had nothing on relays, push the consolidated copy up.
    if (migrated || !remote) schedulePublish();
    window.dispatchEvent(new CustomEvent('nd-unlocks-loaded'));
  });
}
