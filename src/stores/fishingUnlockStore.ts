import { SoundEngine } from '../audio/SoundEngine';

const STORAGE_PREFIX = 'nd_fishing_progress_';

interface FishingProgress {
  legendaryCaught: number;
  unlockedItems: string[];
}

const THRESHOLDS: Record<string, number> = {
  fishhat: 1,
  fishnet: 5,
};

const LABELS: Record<string, string> = {
  fishhat: 'Fish Hat',
  fishnet: 'Fish Net Bottoms',
};

let _pubkey = '';

function storageKey(): string { return `${STORAGE_PREFIX}${_pubkey}`; }

function load(): FishingProgress {
  try {
    const s = localStorage.getItem(storageKey());
    if (s) return JSON.parse(s);
  } catch {}
  return { legendaryCaught: 0, unlockedItems: [] };
}

function persist(data: FishingProgress): void {
  try { localStorage.setItem(storageKey(), JSON.stringify(data)); } catch {}
}

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

export function incrementLegendaryCatch(): void {
  if (!_pubkey) return;
  const data = load();
  data.legendaryCaught = (data.legendaryCaught || 0) + 1;
  for (const [item, threshold] of Object.entries(THRESHOLDS)) {
    if (!data.unlockedItems.includes(item) && data.legendaryCaught >= threshold) {
      data.unlockedItems.push(item);
      showFishUnlockToast(LABELS[item]);
    }
  }
  persist(data);
}

export function isFishingItemUnlocked(item: string): boolean {
  if (!_pubkey) return false;
  return load().unlockedItems.includes(item);
}

export function getFishingProgress(item: string): { count: number; required: number; unlocked: boolean } {
  const data = load();
  return {
    count: data.legendaryCaught,
    required: THRESHOLDS[item] ?? 1,
    unlocked: data.unlockedItems.includes(item),
  };
}
