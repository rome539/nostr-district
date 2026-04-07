/**
 * avatarStore.ts — Avatar customization state
 * In-memory only — persisted via kind:30078 on demand.
 */

export interface AvatarConfig {
  body: 'default' | 'tall' | 'short' | 'broad';
  skinColor: string;
  hair: 'none' | 'short' | 'mohawk' | 'long' | 'ponytail' | 'spiky' | 'buzz' | 'afro' | 'bun' | 'curtains' | 'mullet';
  hairColor: string;
  top: 'tshirt' | 'hoodie' | 'jacket' | 'tank' | 'dress' | 'vest' | 'trenchcoat' | 'croptop' | 'jersey' | 'longsleeve' | 'polo' | 'flannel' | 'bomber' | 'turtleneck' | 'robe';
  topColor: string;
  bottom: 'pants' | 'shorts' | 'skirt' | 'joggers' | 'cargopants' | 'overalls' | 'leggings' | 'jeans' | 'miniskirt';
  bottomColor: string;
  hat: 'none' | 'cap' | 'beanie' | 'tophat' | 'cowboy' | 'beret' | 'bucket' | 'crown' | 'visor' | 'fedora' | 'wizard' | 'hardhat' | 'newsboy';
  hatColor: string;
  accessory: 'none' | 'glasses' | 'bandana' | 'scarf' | 'eyepatch' | 'chain' | 'earrings' | 'sunglasses' | 'headphones' | 'watch' | 'mask' | 'monocle' | 'ring';
  accessoryColor: string;
  eyes: 'default' | 'wide' | 'angry' | 'happy' | 'wink' | 'star' | 'hollow';
  eyeColor: string;
}

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

export function getAvatar(): AvatarConfig { return { ...currentAvatar }; }

export function setAvatar(config: Partial<AvatarConfig>): AvatarConfig {
  currentAvatar = { ...currentAvatar, ...config };
  return { ...currentAvatar };
}

export function resetAvatar(): AvatarConfig {
  currentAvatar = { ...DEFAULT_AVATAR };
  return { ...currentAvatar };
}

export function applyRemoteAvatar(remote: Partial<AvatarConfig>): void {
  currentAvatar = { ...DEFAULT_AVATAR, ...remote };
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
  top: ['tshirt', 'hoodie', 'jacket', 'tank', 'dress', 'vest', 'trenchcoat', 'croptop', 'jersey', 'longsleeve', 'polo', 'flannel', 'bomber', 'turtleneck', 'robe'] as const,
  bottom: ['pants', 'shorts', 'skirt', 'joggers', 'cargopants', 'overalls', 'leggings', 'jeans', 'miniskirt'] as const,
  hat: ['none', 'cap', 'beanie', 'tophat', 'cowboy', 'beret', 'bucket', 'crown', 'visor', 'fedora', 'wizard', 'hardhat', 'newsboy'] as const,
  accessory: ['none', 'glasses', 'bandana', 'scarf', 'eyepatch', 'chain', 'earrings', 'sunglasses', 'headphones', 'watch', 'mask', 'monocle', 'ring'] as const,
  eyes: ['default', 'wide', 'angry', 'happy', 'wink', 'star', 'hollow'] as const,
};

// ── Outfit presets ────────────────────────────────────────────────────────────

export interface OutfitPreset {
  name: string;
  avatar: AvatarConfig;
}

let outfits: OutfitPreset[] = [];

export function getOutfits(): OutfitPreset[] { return outfits; }

export function saveOutfit(name: string): OutfitPreset[] {
  outfits = [...outfits, { name, avatar: { ...currentAvatar } }];
  return outfits;
}

export function deleteOutfit(index: number): OutfitPreset[] {
  outfits = outfits.filter((_, i) => i !== index);
  return outfits;
}

export function applyRemoteOutfits(remote: OutfitPreset[]): void {
  outfits = remote;
}

export const COLOR_PRESETS = [
  // Neutrals & basics
  '#f0ece4', '#d4cfc8', '#a89f96', '#7a7270',
  '#4a4540', '#2e2a28', '#1a1614', '#080604',
  // Grays & slate
  '#e0e4e8', '#b0b8c4', '#6e7c8a', '#3a4550',
  // Denim & navy
  '#1e3a5a', '#2a5280', '#3a6ea0', '#4e8cbe',
  // Khaki, olive, army
  '#8a7a50', '#6a6030', '#4a5030', '#2e3820',
  // Browns & leather
  '#6e4020', '#8e5a2a', '#a87040', '#c49060',
  // Burgundy, wine, maroon
  '#5a1020', '#7a1830', '#a02040', '#c03050',
  // Forest & sage green
  '#1e4028', '#2e5c3a', '#4a7850', '#6a9868',
  // Cream, tan, sand
  '#f5e8c8', '#e0c898', '#c8a870', '#a88850',
  // Classic bright row
  '#e87aab', '#c4568a', '#ff4090', '#e85454',
  '#f0b040', '#ffe060', '#5dcaa5', '#40e8ff',
  '#7b68ee', '#9a6eff', '#2a1858', '#0a0014',
];