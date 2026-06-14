/**
 * roamStore.ts — the `/roam` easter egg.
 *
 * A tiny module-level flag (survives scene changes) that, while on, makes the
 * avatar auto-stroll the hub ↔ woods loop on its own. The per-scene autopilot
 * (BaseScene.roamVX) reads this; any manual move cancels it via setRoaming(false).
 */
let _active = false;

export function isRoaming(): boolean { return _active; }
export function setRoaming(on: boolean): void { _active = on; }
export function toggleRoaming(): boolean { _active = !_active; return _active; }
