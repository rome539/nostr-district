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
const SET_BASED_AURAS = ['smoke', 'fire', 'sparkle', 'electric', 'gold'];

const LABELS: Record<string, string> = {
  smoke: 'Smoke Aura', fire: 'Fire Aura', sparkle: 'Sparkle Aura', ice: 'Ice Aura',
  electric: 'Electric Aura', void: 'Void Aura', gold: 'Gold Aura', rainbow: 'Rainbow Aura',
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
};

const BASE_AURAS = ['smoke', 'fire', 'sparkle', 'ice'];

let _pubkey = '';
let _streakListenerBound = false;

// Latest set-completion progress per set-based aura (for the market-panel display).
const _setAuraProgress: Record<string, { count: number; required: number }> = {};

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
  const auras = getUnlockState().auras;
  if (!auras.includes('rainbow') && BASE_AURAS.every(a => auras.includes(a))) {
    if (unlockAura('rainbow')) showUnlockToast(LABELS.rainbow);
  }
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
  _pubkey = pubkey;
  if (!_streakListenerBound) {
    _streakListenerBound = true;
    window.addEventListener('nd-unlocks-loaded', applyLoginStreak);
  }
  if (isUnlocksLoaded()) applyLoginStreak(); // already loaded (re-login within session)
}

/** Returns true if the current player has earned this aura. */
export function isAuraUnlocked(type: string): boolean {
  return hasAura(type);
}

/** Returns progress info for display in the market panel. */
export function getAuraProgress(type: string): { count: number; required: number; unlocked: boolean; hint: string } {
  const hint = AURA_HINTS[type] ?? '';
  if (!_pubkey) return { count: 0, required: THRESHOLDS[type] ?? 0, unlocked: false, hint };
  const unlocked = hasAura(type);

  if (type === 'rainbow') {
    return { count: getUnlockState().auras.filter(a => BASE_AURAS.includes(a)).length, required: 4, unlocked, hint };
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
  for (const [aura, p] of Object.entries(progress)) {
    if (p.required > 0 && p.count >= p.required && unlockAura(aura)) {
      showUnlockToast(LABELS[aura] ?? aura);
    }
  }
  _checkCompositeUnlocks();
}
