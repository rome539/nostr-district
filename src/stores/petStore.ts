/**
 * petStore.ts — Pet selection persistence + animation specs
 */

export type PetSpecies = 'none' | 'dog' | 'cat';

export interface PetSelection {
  species: PetSpecies;
  breed: number; // 1–6
}

export interface AnimSpec {
  key: string;       // filename suffix  e.g. 'walk', 'lick1'
  frames: number;
  frameRate: number;
}

// ── Dog animations (100×100 frames) ──
export const DOG_ANIM_SPECS: AnimSpec[] = [
  { key: 'walk',    frames: 8,  frameRate: 10 },
  { key: 'run',     frames: 8,  frameRate: 14 },
  { key: 'idle',    frames: 10, frameRate: 8  },
  { key: 'sit',     frames: 1,  frameRate: 1  },
  { key: 'sleep',   frames: 1,  frameRate: 1  },
  { key: 'lay',     frames: 7,  frameRate: 8  },
  { key: 'stretch', frames: 10, frameRate: 8  },
  { key: 'lick1',   frames: 4,  frameRate: 8  },
  { key: 'lick2',   frames: 4,  frameRate: 8  },
  { key: 'itch',    frames: 2,  frameRate: 6  },
  { key: 'bark',    frames: 3,  frameRate: 8  },
];

// ── Cat animations (50×50 frames) ──
export const CAT_ANIM_SPECS: AnimSpec[] = [
  { key: 'walk',    frames: 8,  frameRate: 10 },
  { key: 'run',     frames: 8,  frameRate: 14 },
  { key: 'idle',    frames: 10, frameRate: 8  },
  { key: 'sit',     frames: 1,  frameRate: 1  },
  { key: 'sleep',   frames: 1,  frameRate: 1  },
  { key: 'lay',     frames: 8,  frameRate: 8  },
  { key: 'stretch', frames: 13, frameRate: 8  },
  { key: 'lick1',   frames: 5,  frameRate: 8  },
  { key: 'lick2',   frames: 5,  frameRate: 8  },
  { key: 'itch',    frames: 2,  frameRate: 6  },
  { key: 'meow',    frames: 4,  frameRate: 8  },
];

export function getAnimSpecs(species: Exclude<PetSpecies, 'none'>): AnimSpec[] {
  return species === 'dog' ? DOG_ANIM_SPECS : CAT_ANIM_SPECS;
}

export const PET_FRAME_SIZE: Record<Exclude<PetSpecies, 'none'>, number> = {
  dog: 100,
  cat: 50,
};

export const DOG_BREEDS = [
  { id: 1, name: 'Dog 1', scale: 1.0 },
  { id: 2, name: 'Dog 2', scale: 1.5 },
  { id: 3, name: 'Dog 3', scale: 1.0 },
  { id: 4, name: 'Dog 4', scale: 1.5 },
  { id: 5, name: 'Dog 5', scale: 1.0 },
  { id: 6, name: 'Dog 6', scale: 1.0 },
];

export const CAT_BREEDS = [
  { id: 1, name: 'Cat 1' }, { id: 2, name: 'Cat 2' }, { id: 3, name: 'Cat 3' },
  { id: 4, name: 'Cat 4' }, { id: 5, name: 'Cat 5' }, { id: 6, name: 'Cat 6' },
];

const STORAGE_KEY = 'nd_pet';
const DEFAULT: PetSelection = { species: 'none', breed: 1 };

export function getPet(): PetSelection {
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) return { ...DEFAULT, ...JSON.parse(s) }; } catch {}
  return { ...DEFAULT };
}

export function setPet(p: Partial<PetSelection>): PetSelection {
  const updated = { ...getPet(), ...p };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function getPetPaths(sel: PetSelection): { [anim: string]: string } | null {
  if (sel.species === 'none') return null;
  const specs = getAnimSpecs(sel.species);
  const paths: Record<string, string> = {};
  for (const spec of specs) {
    paths[spec.key] = `pets/${sel.species}-${sel.breed}-${spec.key}.png`;
  }
  return paths;
}

export function petTexKey(sel: PetSelection): string {
  return `pet-${sel.species}-${sel.breed}`;
}

// Legacy — kept for compatibility
export const PET_FRAME_CONFIG: Record<Exclude<PetSpecies, 'none'>, { size: number; walkFrames: number; idleFrames: number }> = {
  dog: { size: 100, walkFrames: 8, idleFrames: 10 },
  cat: { size: 50,  walkFrames: 8, idleFrames: 10 },
};
