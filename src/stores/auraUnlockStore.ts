import { SoundEngine } from '../audio/SoundEngine';

/**
 * auraUnlockStore.ts — Tracks per-player aura unlock progress in localStorage.
 *
 * Unlock conditions:
 *   smoke    — use smoke emote 50 times
 *   fire     — stoke the cabin fireplace 30 times
 *   sparkle  — use the telescope in the woods 20 times
 *   ice      — log in 7 consecutive days
 *   electric — send 200 chat messages
 *   void     — log in 30 consecutive days (same streak as ice, higher threshold)
 *   gold     — own 10+ market items
 *   rainbow  — unlock smoke + fire + sparkle + ice first
 */

const THRESHOLDS: Record<string, number> = {
  smoke: 50, fire: 30, sparkle: 20, ice: 7,
  electric: 200, void: 30, gold: 10, rainbow: 4,
};

const LABELS: Record<string, string> = {
  smoke: 'Smoke Aura', fire: 'Fire Aura', sparkle: 'Sparkle Aura', ice: 'Ice Aura',
  electric: 'Electric Aura', void: 'Void Aura', gold: 'Gold Aura', rainbow: 'Rainbow Aura',
};

export const AURA_HINTS: Record<string, string> = {
  smoke:    'Use the smoke emote 50 times',
  fire:     'Stoke the cabin fireplace 30 times',
  sparkle:  'Use the telescope in the woods 20 times',
  ice:      'Log in 7 days in a row',
  electric: 'Send 200 chat messages',
  void:     'Log in 30 days in a row (no breaks)',
  gold:     'Own 10 or more market items',
  rainbow:  'Unlock smoke, fire, sparkle, and ice auras first',
};

const BASE_AURAS = ['smoke', 'fire', 'sparkle', 'ice'];

interface AuraProgressData {
  smokeEmoteCount:  number;
  fireStokesCount:  number;
  telescopeCount:   number;
  chatMessageCount: number;
  goldItemCount:    number;
  loginStreak:      number;
  lastLoginDate:    string;
  unlockedAuras:    string[];
}

type CountField = keyof AuraProgressData;
const COUNT_FIELD: Record<string, CountField> = {
  smoke:    'smokeEmoteCount',
  fire:     'fireStokesCount',
  sparkle:  'telescopeCount',
  electric: 'chatMessageCount',
  gold:     'goldItemCount',
  ice:      'loginStreak',
  void:     'loginStreak',
};

let _pubkey = '';

function storageKey(): string { return `nd_aura_progress_${_pubkey}`; }

function load(): AuraProgressData {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) return {
      smokeEmoteCount: 0, fireStokesCount: 0, telescopeCount: 0,
      chatMessageCount: 0, goldItemCount: 0,
      loginStreak: 0, lastLoginDate: '', unlockedAuras: [],
      ...JSON.parse(raw),
    };
  } catch { /* ignore */ }
  return {
    smokeEmoteCount: 0, fireStokesCount: 0, telescopeCount: 0,
    chatMessageCount: 0, goldItemCount: 0,
    loginStreak: 0, lastLoginDate: '', unlockedAuras: [],
  };
}

function persist(data: AuraProgressData): void {
  try { localStorage.setItem(storageKey(), JSON.stringify(data)); } catch { /* ignore */ }
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

function _checkCompositeUnlocks(data: AuraProgressData): boolean {
  let changed = false;
  if (!data.unlockedAuras.includes('rainbow') &&
      BASE_AURAS.every(a => data.unlockedAuras.includes(a))) {
    data.unlockedAuras = [...data.unlockedAuras, 'rainbow'];
    changed = true;
    showUnlockToast(LABELS.rainbow);
  }
  return changed;
}

/** Call once on every real (non-guest) login with the player's pubkey. */
export function initAuraProgress(pubkey: string): void {
  _pubkey = pubkey;
  const data = load();

  // Keep tracking streak until both ice (7) and void (30) are unlocked
  if (data.unlockedAuras.includes('ice') && data.unlockedAuras.includes('void')) {
    _checkCompositeUnlocks(data);
    return;
  }

  const today     = new Date().toISOString().slice(0, 10);
  if (data.lastLoginDate === today) return;

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  data.loginStreak = data.lastLoginDate === yesterday ? (data.loginStreak || 0) + 1 : 1;
  data.lastLoginDate = today;

  let toasted = false;
  if (data.loginStreak >= THRESHOLDS.ice && !data.unlockedAuras.includes('ice')) {
    data.unlockedAuras = [...new Set([...data.unlockedAuras, 'ice'])];
    showUnlockToast(LABELS.ice);
    toasted = true;
  }
  if (data.loginStreak >= THRESHOLDS.void && !data.unlockedAuras.includes('void')) {
    data.unlockedAuras = [...new Set([...data.unlockedAuras, 'void'])];
    if (!toasted) showUnlockToast(LABELS.void);
  }

  _checkCompositeUnlocks(data);
  persist(data);
}

/** Returns true if the current player has earned this aura. */
export function isAuraUnlocked(type: string): boolean {
  if (!_pubkey) return false;
  return load().unlockedAuras.includes(type);
}

/** Returns progress info for display in the market panel. */
export function getAuraProgress(type: string): { count: number; required: number; unlocked: boolean; hint: string } {
  const required = THRESHOLDS[type] ?? 0;
  const hint     = AURA_HINTS[type] ?? '';
  if (!_pubkey) return { count: 0, required, unlocked: false, hint };
  const data = load();
  const unlocked = data.unlockedAuras.includes(type);

  let count: number;
  if (type === 'rainbow') {
    count = BASE_AURAS.filter(a => data.unlockedAuras.includes(a)).length;
  } else if (COUNT_FIELD[type]) {
    count = (data[COUNT_FIELD[type]] as number) || 0;
  } else {
    count = 0;
  }

  return { count, required, unlocked, hint };
}

/** Call when the player performs a tracked earn action (smoke, fire, sparkle, electric). */
export function incrementAuraProgress(type: 'smoke' | 'fire' | 'sparkle' | 'electric'): void {
  if (!_pubkey) return;
  const data = load();
  if (data.unlockedAuras.includes(type)) return;
  const field = COUNT_FIELD[type];
  (data[field] as number) = ((data[field] as number) || 0) + 1;
  if ((data[field] as number) >= THRESHOLDS[type]) {
    data.unlockedAuras = [...new Set([...data.unlockedAuras, type])];
    persist(data);
    showUnlockToast(LABELS[type]);
    const data2 = load();
    if (_checkCompositeUnlocks(data2)) persist(data2);
  } else {
    persist(data);
  }
}

/** Call after inventory changes with the new total count. */
export function checkGoldUnlock(inventoryCount: number): void {
  if (!_pubkey) return;
  const data = load();
  if (data.unlockedAuras.includes('gold')) return;
  data.goldItemCount = inventoryCount;
  if (inventoryCount >= THRESHOLDS.gold) {
    data.unlockedAuras = [...new Set([...data.unlockedAuras, 'gold'])];
    persist(data);
    showUnlockToast(LABELS.gold);
    const data2 = load();
    if (_checkCompositeUnlocks(data2)) persist(data2);
  } else {
    persist(data);
  }
}
