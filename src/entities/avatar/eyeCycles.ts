/**
 * eyeCycles.ts — single source of truth for color-cycling eye palettes + speeds.
 *
 * Color-cycling eyes (blaze/frost/galaxy/laser/…) animate by stepping `eyeColor`
 * through a palette every N ms. That stepping is driven in BaseScene (the live
 * sprites) and mirrored by the wardrobe + market previews. Keeping the palettes
 * here means a new cycling eye is defined in ONE place; every consumer derives its
 * type-set from EYE_CYCLE_TYPES so nothing drifts.
 *
 * NOT here: particle eyes (e.g. `cry`, see makeEyeVfxConfig in BaseScene) and static
 * eyes (slit/visor/void/…), which use the player's chosen eyeColor and don't cycle.
 */

export const EYE_PALETTES: Record<string, string[]> = {
  blaze:    ['#ff6600', '#ff3300', '#ffaa00', '#ffdd00', '#ff4400'],
  frost:    ['#aaddff', '#ffffff', '#88ccff', '#cceeff', '#44aaff'],
  cosmic:   ['#7a3cff', '#c84cff', '#ff6ad5', '#4ad8ff', '#9a6eff', '#ffffff'], // legacy: renders as galaxy
  galaxy:   ['#7a3cff', '#c84cff', '#ff6ad5', '#4ad8ff', '#9a6eff', '#ffffff'],
  laser:    ['#ff2a00', '#ff5500', '#ff8800', '#ffb347', '#ff3300'],
  aurora:   ['#33ffcc', '#33ff88', '#66e0ff', '#aa77ff', '#33ffaa'],
  matrix:   ['#00ff44', '#00cc33', '#33ff66', '#008f22', '#aaffaa'],
  toxic:    ['#aaff00', '#ccff33', '#88dd00', '#e6ff66', '#99cc00'],
  electric: ['#88ccff', '#ffffff', '#fff066', '#44aaff', '#cce8ff', '#66bbff'],
};

export const EYE_CYCLE_MS: Record<string, number> = {
  blaze: 100, frost: 280, cosmic: 300, galaxy: 300,
  laser: 120, aurora: 420, matrix: 110, toxic: 240, electric: 110,
};

/** The set of color-cycling eye ids — consumers derive their checks from this. */
export const EYE_CYCLE_TYPES: ReadonlySet<string> = new Set(Object.keys(EYE_PALETTES));

/**
 * Motion eyes — animate by *position/intensity* (not color), so the draw varies with a
 * frame phase instead of eyeColor. `steps` = frames in the loop, `ms` = ms per frame.
 * The draw functions self-compute the current phase via eyeMotionStep(); BaseScene (and
 * the wardrobe/market previews) just re-render on the same cadence so it's visible.
 */
export const EYE_MOTION: Record<string, { steps: number; ms: number }> = {
  shifty: { steps: 4, ms: 460 },  // pupils dart center→right→center→left
  dizzy:  { steps: 4, ms: 150 },  // grey corner pixel rotates clockwise around the 2x2
  heart:  { steps: 6, ms: 150 },  // heartbeat: beat-beat-rest glow pulse
};
export const EYE_MOTION_TYPES: ReadonlySet<string> = new Set(Object.keys(EYE_MOTION));

/** Current animation frame for a motion eye (shared by the draw + the re-render trigger). */
export function eyeMotionStep(type: string, nowMs: number = Date.now()): number {
  const m = EYE_MOTION[type];
  return m ? Math.floor(nowMs / m.ms) % m.steps : 0;
}

/** 2x2 corner cells, clockwise from top-left — the grey Dizzy pixel rotates through these. */
export const DIZZY_CORNERS: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Heartbeat glow intensity per frame (beat-beat-rest) — drives the Heart pulse. */
export const HEARTBEAT_PULSE = [1.0, 0.4, 0.85, 0.15, 0.15, 0.2];

/** Pupil x-offset per frame for the Shifty darting look. */
export const SHIFTY_DX = [0, 1, 0, -1];
