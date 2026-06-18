import { SoundEngine } from '../audio/SoundEngine';
import {
  hasAura, unlockAura, getUnlockState, setLoginStreak, isUnlocksLoaded,
} from './unlockStore';

/**
 * auraUnlockStore.ts — aura unlock LOGIC. State lives in unlockStore (relay-backed,
 * kind:30078), not localStorage.
 *
 * Unlock conditions:
 *   smoke    — complete the "Off the Books" set (every street item)
 *   fire     — complete "The Canon" set (every lore item)
 *   sparkle  — complete the "Deep Time" set
 *   electric — complete the "Dead Hardware" set (every hardware item)
 *   gold     — collect every legendary item that isn't a fish
 *   ice      — log in 7 consecutive days
 *   void     — log in 30 consecutive days
 *   rainbow  — unlock smoke + fire + sparkle + ice first
 *
 * smoke/fire/sparkle/electric/gold are SET-based: progress is fed in from the trade
 * inventory (collectionUnlocks.ts → updateSetAuraProgress). ice/void are login-streak
 * based, applied once the relay unlock state has loaded (nd-unlocks-loaded).
 */

const THRESHOLDS: Record<string, number> = { ice: 7, void: 30, rainbow: 4 };
const SET_BASED_AURAS = ['smoke', 'fire', 'sparkle', 'electric', 'gold', 'runes', 'bats', 'snow', 'fireworks', 'steam', 'spores', 'nebula', 'school'];

const LABELS: Record<string, string> = {
  smoke: 'Smoke Aura', fire: 'Fire Aura', sparkle: 'Sparkle Aura', ice: 'Ice Aura',
  electric: 'Electric Aura', void: 'Void Aura', gold: 'Gold Aura', rainbow: 'Rainbow Aura',
  runes: 'Runes Aura', bats: 'Bat Aura', snow: 'Snowfall Aura', fireworks: 'Fireworks Aura', steam: 'Steam Aura',
  spores: 'Spores Aura', nebula: 'Nebula Aura', school: 'School Aura',
};

export const AURA_HINTS: Record<string, string> = {
  smoke:    'Complete the "Off the Books" set (every street item)',
  fire:     'Complete "The Canon" set (every lore item)',
  sparkle:  'Complete the "Deep Time" set',
  electric: 'Complete the "Dead Hardware" set (every hardware item)',
  gold:     'Collect every legendary item (besides fish)',
  ice:      'Log in 7 days in a row',
  void:     'Log in 30 days in a row (no breaks)',
  rainbow:  'Unlock smoke, fire, sparkle, and ice auras first',
  runes:    'Complete "The Arcane" set (every occult item)',
  bats:     'Complete the "All Hallows" set (Halloween drops)',
  snow:     'Complete the "Cold Storage" set (winter drops)',
  fireworks:'Complete the "Independence" set (July 4th drops)',
  steam:    'Complete the "Greasy Spoon" set (every Eats item)',
  spores:   'Complete the "Undergrowth" set (every Flora item)',
  nebula:   'Complete the "Falling Sky" set (every Celestial item)',
  school:   'Complete the "Full Catch" set (one of every fish)',
};

const BASE_AURAS = ['smoke', 'fire', 'sparkle', 'ice'];

let _pubkey = '';
let _streakListenerBound = false;

// Latest set-completion progress per set-based aura (for the market-panel display
// AND the live entitlement check — set auras are POSSESSION-BASED: usable only while
// the player currently holds the complete set; selling a piece re-locks the aura).
const _setAuraProgress: Record<string, { count: number; required: number }> = {};
const _wasComplete: Record<string, boolean> = {}; // session transition tracking (toasts)
const _toasted = new Set<string>(); // aura keys already toasted — PERSISTED per pubkey.
// Set auras are possession-based and the inventory rebuilds incrementally on reload, so a
// complete set momentarily flaps incomplete→complete and would re-announce every login.
// Persisting which auras have been toasted suppresses that across reloads.

function persistAuraToasts(): void {
  if (!_pubkey) return;
  try { localStorage.setItem(`nd_aura_toasts_${_pubkey}`, JSON.stringify([..._toasted])); } catch { /* ignore */ }
}

function showUnlockToast(label: string): void {
  SoundEngine.get().auraUnlock();
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
    'background:#1a1428;border:1px solid rgba(154,110,255,0.35);border-radius:8px',
    'padding:10px 20px;color:#e0d0ff;font-family:\'Courier New\',monospace',
    'font-size:12px;font-weight:bold;z-index:9999;pointer-events:none',
    'box-shadow:0 4px 20px rgba(154,110,255,0.3);transition:opacity 0.4s;white-space:nowrap',
  ].join(';');
  el.textContent = `✨ Aura unlocked: ${label}`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3600);
}

function _checkCompositeUnlocks(): void {
  // Rainbow is live like the set auras: available only while smoke/fire/sparkle/ice
  // are ALL currently available. Toast on the transition into availability.
  const nowAvailable = BASE_AURAS.every(a => isAuraUnlocked(a));
  if (nowAvailable && _wasComplete['rainbow'] === false && !_toasted.has('rainbow')) {
    _toasted.add('rainbow');
    persistAuraToasts();
    showUnlockToast(LABELS.rainbow);
  }
  _wasComplete['rainbow'] = nowAvailable;
}

// Streak / ice / void — runs once the relay unlock state has loaded.
function applyLoginStreak(): void {
  const state = getUnlockState();
  if (state.auras.includes('ice') && state.auras.includes('void')) { _checkCompositeUnlocks(); return; }

  const today = new Date().toISOString().slice(0, 10);
  if (state.lastLoginDate === today) { _checkCompositeUnlocks(); return; }

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const streak = state.lastLoginDate === yesterday ? (state.loginStreak || 0) + 1 : 1;
  setLoginStreak(streak, today);

  if (streak >= THRESHOLDS.ice && unlockAura('ice')) showUnlockToast(LABELS.ice);
  if (streak >= THRESHOLDS.void && unlockAura('void')) showUnlockToast(LABELS.void);
  _checkCompositeUnlocks();
}

/** Call once on every real (non-guest) login. */
export function initAuraProgress(pubkey: string): void {
  if (pubkey !== _pubkey) {
    // Hydrate persisted unlock toasts for this account so reloads don't re-announce
    // set auras whose inventory momentarily reads incomplete during the relay rebuild.
    _toasted.clear();
    for (const k of Object.keys(_wasComplete)) delete _wasComplete[k];
    try {
      const arr = JSON.parse(localStorage.getItem(`nd_aura_toasts_${pubkey}`) || '[]');
      if (Array.isArray(arr)) arr.forEach((k: string) => _toasted.add(k));
    } catch { /* ignore */ }
  }
  _pubkey = pubkey;
  if (!_streakListenerBound) {
    _streakListenerBound = true;
    window.addEventListener('nd-unlocks-loaded', applyLoginStreak);
  }
  if (isUnlocksLoaded()) applyLoginStreak(); // already loaded (re-login within session)
}

/** Returns true if the current player can use this aura right now.
 *  Set-based auras + rainbow are POSSESSION-BASED (live set completion);
 *  ice/void (login streaks) stay permanent once earned. */
export function isAuraUnlocked(type: string): boolean {
  if (SET_BASED_AURAS.includes(type)) {
    const p = _setAuraProgress[type];
    return !!p && p.required > 0 && p.count >= p.required;
  }
  if (type === 'rainbow') return BASE_AURAS.every(a => isAuraUnlocked(a));
  return hasAura(type);
}

/** Returns progress info for display in the market panel. */
export function getAuraProgress(type: string): { count: number; required: number; unlocked: boolean; hint: string } {
  const hint = AURA_HINTS[type] ?? '';
  if (!_pubkey) return { count: 0, required: THRESHOLDS[type] ?? 0, unlocked: false, hint };
  const unlocked = isAuraUnlocked(type); // live for set auras/rainbow, stored for ice/void

  if (type === 'rainbow') {
    return { count: BASE_AURAS.filter(a => isAuraUnlocked(a)).length, required: 4, unlocked, hint };
  }
  if (type === 'ice' || type === 'void') {
    return { count: getUnlockState().loginStreak || 0, required: THRESHOLDS[type], unlocked, hint };
  }
  if (SET_BASED_AURAS.includes(type)) {
    const p = _setAuraProgress[type] ?? { count: 0, required: 0 };
    return { count: p.count, required: p.required, unlocked, hint };
  }
  return { count: 0, required: 0, unlocked, hint };
}

/**
 * Feed in set-completion progress for the set-based auras (called from the inventory
 * wiring). Unlocks any aura whose set is complete and caches progress for display.
 */
export function updateSetAuraProgress(progress: Record<string, { count: number; required: number }>): void {
  for (const [aura, p] of Object.entries(progress)) _setAuraProgress[aura] = p;
  if (!_pubkey) return;
  // POSSESSION-BASED: nothing is stored — availability is the live set completion.
  // Toast only on an incomplete→complete transition observed this session (the first
  // update after login just records state; re-assembling a sold set toasts again).
  for (const [aura, p] of Object.entries(progress)) {
    const complete = p.required > 0 && p.count >= p.required;
    if (complete && _wasComplete[aura] === false && !_toasted.has(aura)) {
      _toasted.add(aura);
      persistAuraToasts();
      showUnlockToast(LABELS[aura] ?? aura);
    }
    _wasComplete[aura] = complete;
  }
  _checkCompositeUnlocks();
}
