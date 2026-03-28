/**
 * avatarStore.ts — Avatar customization state
 * Persisted in localStorage, synced via presence server
 */

export interface AvatarConfig {
  body: 'default' | 'tall' | 'short' | 'broad';
  skinColor: string;
  hair: 'none' | 'short' | 'mohawk' | 'long' | 'ponytail' | 'spiky' | 'buzz' | 'afro' | 'bun' | 'curtains' | 'mullet';
  hairColor: string;
  top: 'tshirt' | 'hoodie' | 'jacket' | 'tank' | 'dress' | 'vest' | 'trenchcoat' | 'croptop' | 'jersey';
  topColor: string;
  bottom: 'pants' | 'shorts' | 'skirt' | 'joggers' | 'cargopants' | 'overalls';
  bottomColor: string;
  hat: 'none' | 'cap' | 'beanie' | 'tophat' | 'cowboy' | 'beret' | 'bucket' | 'crown';
  hatColor: string;
  accessory: 'none' | 'glasses' | 'bandana' | 'scarf' | 'eyepatch' | 'chain' | 'earrings' | 'sunglasses' | 'headphones';
  accessoryColor: string;
  eyes: 'default' | 'wide' | 'angry' | 'happy' | 'wink' | 'star' | 'hollow';
  eyeColor: string;
}

const STORAGE_KEY = 'nostr_district_avatar';

const DEFAULT_AVATAR: AvatarConfig = {
  body: 'default',
  skinColor: '#2a1858',
  hair: 'short',
  hairColor: '#1a1040',
  top: 'tshirt',
  topColor: '#7b68ee',
  bottom: 'pants',
  bottomColor: '#1a1040',
  hat: 'none',
  hatColor: '#e87aab',
  accessory: 'none',
  accessoryColor: '#5dcaa5',
  eyes: 'default',
  eyeColor: '#ffffff',
};

let currentAvatar: AvatarConfig = { ...DEFAULT_AVATAR };

// Load from localStorage
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    currentAvatar = { ...DEFAULT_AVATAR, ...parsed };
  }
} catch (_) {}

export function getAvatar(): AvatarConfig {
  return { ...currentAvatar };
}

export function setAvatar(config: Partial<AvatarConfig>): AvatarConfig {
  currentAvatar = { ...currentAvatar, ...config };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentAvatar));
  } catch (_) {}
  return { ...currentAvatar };
}

export function resetAvatar(): AvatarConfig {
  currentAvatar = { ...DEFAULT_AVATAR };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentAvatar));
  } catch (_) {}
  return { ...currentAvatar };
}

export function getDefaultAvatar(): AvatarConfig {
  return { ...DEFAULT_AVATAR };
}

/** Serialize avatar config to a compact string for network sync */
export function serializeAvatar(a: AvatarConfig): string {
  return JSON.stringify(a);
}

/** Deserialize avatar config from network */
export function deserializeAvatar(s: string): AvatarConfig | null {
  try {
    const parsed = JSON.parse(s);
    return { ...DEFAULT_AVATAR, ...parsed };
  } catch (_) {
    return null;
  }
}

/** Available options for each slot */
export const AVATAR_OPTIONS = {
  hair: ['none', 'short', 'mohawk', 'long', 'ponytail', 'spiky', 'buzz', 'afro', 'bun', 'curtains', 'mullet'] as const,
  top: ['tshirt', 'hoodie', 'jacket', 'tank', 'dress', 'vest', 'trenchcoat', 'croptop', 'jersey'] as const,
  bottom: ['pants', 'shorts', 'skirt', 'joggers', 'cargopants', 'overalls'] as const,
  hat: ['none', 'cap', 'beanie', 'tophat', 'cowboy', 'beret', 'bucket', 'crown'] as const,
  accessory: ['none', 'glasses', 'bandana', 'scarf', 'eyepatch', 'chain', 'earrings', 'sunglasses', 'headphones'] as const,
  eyes: ['default', 'wide', 'angry', 'happy', 'wink', 'star', 'hollow'] as const,
};

export const COLOR_PRESETS = [
  '#2a1858', '#1a1040', '#3a2878', '#4a3888',
  '#e87aab', '#c4568a', '#f5b8d0', '#ff4090',
  '#7b68ee', '#4a2d8e', '#b8a8f8', '#9a6eff',
  '#5dcaa5', '#2a8a6e', '#8aecd0', '#40e8ff',
  '#e85454', '#f0b040', '#fad480', '#ffe060',
  '#f5e8d0', '#fff5e6', '#e8a878', '#f0a090',
  '#0a0014', '#0e0828', '#18103a', '#140c30',
];