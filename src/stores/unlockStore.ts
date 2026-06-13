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

// ── Local cache (per pubkey) ──────────────────────────────────────────────────
// A synchronous mirror of the unlock state in localStorage. The relay copy is the
// cross-device source of truth, but its write is debounced, cancellable by a quick
// logout, and (for extension users) gated behind a signing popup — so it can't be
// relied on to record "I already counted a login today" or "ice is unlocked" before
// the next login reads it. That unreliability is what made the streak re-count and
// the ice aura re-"unlock" on every login. The cache is written synchronously on
// every change and unioned back in on load; unlock state only ever grows, so merging
// it is always safe.
const cacheKey = (pubkey: string) => `nd_unlocks_cache_${pubkey}`;

function loadLocalCache(pubkey: string): UnlockState | null {
  try {
    const o = JSON.parse(localStorage.getItem(cacheKey(pubkey)) || 'null');
    if (o && Array.isArray(o.auras)) {
      return {
        auras: o.auras || [], items: o.items || [],
        loginStreak: o.loginStreak || 0, lastLoginDate: o.lastLoginDate || '',
        legendaryCaught: o.legendaryCaught || 0,
      };
    }
  } catch { /* ignore */ }
  return null;
}

function saveLocalCache(): void {
  if (!_pubkey) return;
  try { localStorage.setItem(cacheKey(_pubkey), JSON.stringify(_state)); } catch { /* ignore */ }
}

export function getLegendaryCaught(): number { return _state.legendaryCaught; }

export function bumpLegendaryCaught(): number {
  _state.legendaryCaught = (_state.legendaryCaught || 0) + 1;
  schedulePublish();
  return _state.legendaryCaught;
}

function schedulePublish(): void {
  if (!_loaded || !_pubkey) return; // never write before we've merged the relay copy
  saveLocalCache();                 // synchronous local mirror — survives logout, no popup
  if (_publishTimer) clearTimeout(_publishTimer);
  _publishTimer = setTimeout(flush, 800);
}

async function flush(): Promise<void> {
  _publishTimer = null;
  const pubkey = _pubkey;
  if (!pubkey) return;
  try {
    const { publishUnlocks, fetchUnlocks } = await import('../nostr/nostrService');
    // MONOTONIC WRITE: re-read the newest relay copy and fold it in before publishing.
    // Unlock state only ever grows (auras/items add, counters climb), so a stale or
    // blank in-memory _state must never be allowed to clobber a richer relay copy.
    // Without this, a login that started from a slow/empty relay read would write the
    // thinner copy back as the newest event — dropping e.g. the ice aura and making it
    // re-"unlock" (toast) on the next login.
    let remote: UnlockState | null = null;
    try { remote = await fetchUnlocks(pubkey); } catch { /* offline → publish what we have */ }
    if (remote && _pubkey === pubkey) {
      _state.auras = union(_state.auras, remote.auras);
      _state.items = union(_state.items, remote.items);
      _state.loginStreak = Math.max(_state.loginStreak, remote.loginStreak ?? 0);
      if ((remote.lastLoginDate || '') > _state.lastLoginDate) _state.lastLoginDate = remote.lastLoginDate;
      _state.legendaryCaught = Math.max(_state.legendaryCaught, remote.legendaryCaught ?? 0);
    }
    if (_pubkey !== pubkey) return; // account switched mid-flush — don't write stale state
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
    // Fold in the synchronous local cache. It can be MORE current than the relay copy
    // (whose write is debounced/cancellable and may need a signing popup), so this is
    // what makes the streak day-guard reliable and keeps a freshly-unlocked aura (ice)
    // from re-toasting on the next login. auras/items union; counters take the max; the
    // streak follows whichever source has the later lastLoginDate.
    const cached = loadLocalCache(pubkey);
    if (cached) {
      _state.auras = union(_state.auras, cached.auras);
      _state.items = union(_state.items, cached.items);
      _state.legendaryCaught = Math.max(_state.legendaryCaught, cached.legendaryCaught);
      if (cached.lastLoginDate > _state.lastLoginDate) {
        _state.lastLoginDate = cached.lastLoginDate;
        _state.loginStreak = cached.loginStreak;
      } else if (cached.lastLoginDate === _state.lastLoginDate) {
        _state.loginStreak = Math.max(_state.loginStreak, cached.loginStreak);
      }
    }
    _loaded = true;
    saveLocalCache(); // seed/refresh the synchronous local mirror from the merged state
    // Only write on init if we actually folded in old localStorage data. We must NOT
    // publish just because the relay read came back empty (`!remote`) — that's often a
    // slow/timed-out query, not a genuinely new player, and writing our thin local copy
    // back as the newest event would clobber the real relay state (the ice-aura re-unlock
    // bug). Real new players have nothing to lose, and their first unlock will publish.
    if (migrated) schedulePublish();
    window.dispatchEvent(new CustomEvent('nd-unlocks-loaded'));
  });
}
