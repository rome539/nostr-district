/**
 * PetSprite.ts — Room pet with full animation state machine + 2D wandering
 *
 * States: walk, idle, sit, sleep, lay, stretch, lick, itch, emote
 * Movement: random target positions within room bounds (X and Y)
 * Perspective: scale and depth update per-frame based on Y so the pet
 *              appears larger / in-front when closer to the camera.
 */

import { PetSelection, PET_FRAME_SIZE, getAnimSpecs } from '../stores/petStore';

const PET_SPEED  = 60;   // px/s
const FLOOR_MIN  = 382;  // top of walkable band; kept below the back wall/furniture line
const FLOOR_MAX  = 445;  // bottom of walkable band (matches player clamp max)
// X bounds: couch right edge ≈ 190, desk left edge ≈ 558 — keep pets between furniture
const BOUNDS_MIN = 215;
const BOUNDS_MAX = 540;

// Perspective: pet scale multiplier at front vs back of room
const PERSP_NEAR = 1.05; // scale multiplier at FLOOR_MAX (camera-near)
const PERSP_FAR  = 0.72; // scale multiplier at FLOOR_MIN (camera-far)
const LAY_COOLDOWN_MS = 20000;

// Per-breed base scales: 1=Golden, 2=Akita, 3=Great Dane, 4=Schnauzer, 5=Saint Bernard, 6=Husky
const DOG_BREED_SCALE: Record<number, number> = {
  1: 1.9,  // Golden Retriever — medium
  2: 2.3,  // Akita            — medium-large (was too small)
  3: 2.2,  // Great Dane       — large but a bit smaller than before
  4: 1.5,  // Schnauzer        — small
  5: 2.4,  // Saint Bernard    — large
  6: 2.4,  // Siberian Husky   — medium-large (was too small)
};
const CAT_BREED_SCALE: Record<number, number> = {
  1: 2.2,
  2: 2.35, // Cat 2 — slightly larger
  3: 2.2,
  4: 2.2,
  5: 2.2,
  6: 2.2,
};

// States that play once then auto-transition via ANIMATION_COMPLETE
const ONE_SHOT_STATES = new Set(['stretch', 'lick', 'itch', 'emote']);

type PetState = 'walk' | 'idle' | 'sit' | 'sleep' | 'lay' | 'stretch' | 'lick' | 'itch' | 'emote';

export class PetSprite {
  private sprite!: Phaser.GameObjects.Sprite;
  private state: PetState = 'idle';
  private previousState: PetState | null = null;
  private stateTimer    = 0;
  private stateDuration = 0;
  private layCooldown   = 0;
  private species: 'dog' | 'cat' = 'dog';
  private prefix    = '';
  private baseScale = 1;
  private animFrameCounts: Record<string, number> = {};

  // Walk target
  private targetX = 300;
  private targetY = FLOOR_MAX;

  create(scene: Phaser.Scene, sel: PetSelection): void {
    if (sel.species === 'none') return;
    this.species   = sel.species;
    this.prefix    = `pet-${sel.species}-${sel.breed}`;
    this.baseScale = sel.species === 'dog'
      ? (DOG_BREED_SCALE[sel.breed] ?? 1.9)
      : (CAT_BREED_SCALE[sel.breed] ?? 2.2);

    // Register all animations
    const specs = getAnimSpecs(sel.species);
    for (const spec of specs) {
      this.animFrameCounts[spec.key] = spec.frames;
      const animKey = `${this.prefix}-${spec.key}-anim`;
      if (!scene.anims.exists(animKey)) {
        scene.anims.create({
          key: animKey,
          frames: scene.anims.generateFrameNumbers(`${this.prefix}-${spec.key}`, { start: 0, end: spec.frames - 1 }),
          frameRate: spec.frameRate,
          repeat: -1,
        });
      }
    }

    const startX = BOUNDS_MIN + Math.random() * (BOUNDS_MAX - BOUNDS_MIN);
    const startY = FLOOR_MIN  + Math.random() * (FLOOR_MAX - FLOOR_MIN);

    this.sprite = scene.add.sprite(startX, startY, `${this.prefix}-idle`)
      .setOrigin(0.5, 1);

    this.applyPerspective();
    this.enterState('idle');
  }

  update(delta: number): void {
    if (!this.sprite?.active) return;
    this.layCooldown = Math.max(0, this.layCooldown - delta);

    if (this.state === 'walk') {
      const dx   = this.targetX - this.sprite.x;
      const dy   = this.targetY - this.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 6) {
        this.transitionFrom('walk');
        return;
      }

      const spd = PET_SPEED * (delta / 1000);
      this.sprite.x += (dx / dist) * spd;
      this.sprite.y += (dy / dist) * spd;
      this.sprite.setFlipX(dx < 0);
      this.applyPerspective(); // scale + depth update every frame while moving
    } else {
      if (!ONE_SHOT_STATES.has(this.state)) {
        this.stateTimer += delta;
        if (this.stateTimer >= this.stateDuration) this.transitionFrom(this.state);
      }
    }
  }

  // ── Perspective helpers ─────────────────────────────────────────────────────

  /** Lerp scale and depth based on Y so the pet looks 3-D. */
  private applyPerspective(): void {
    const t     = (this.sprite.y - FLOOR_MIN) / (FLOOR_MAX - FLOOR_MIN); // 0=far, 1=near
    const tClamped = Math.max(0, Math.min(1, t));
    const persp = PERSP_FAR + (PERSP_NEAR - PERSP_FAR) * tClamped;
    this.sprite.setScale(this.baseScale * persp);
    // Keep pets behind the player (depth 10) across the whole room.
    this.sprite.setDepth(7 + tClamped * 2);
  }

  // ── State machine ───────────────────────────────────────────────────────────

  private enterState(state: PetState): void {
    this.sprite.removeAllListeners(Phaser.Animations.Events.ANIMATION_COMPLETE);
    this.previousState = this.state;
    this.state = state;
    this.stateTimer = 0;

    switch (state) {
      case 'walk': {
        // Pick a target that is meaningfully different in Y (at least 50 px away)
        // so diagonal movement is always visible, not just side-to-side.
        const halfY   = (FLOOR_MAX - FLOOR_MIN) / 2;
        const curHalf = this.sprite.y > FLOOR_MIN + halfY ? 'near' : 'far';
        const yMin    = curHalf === 'near' ? FLOOR_MIN : FLOOR_MIN + halfY;
        const yMax    = curHalf === 'near' ? FLOOR_MIN + halfY : FLOOR_MAX;
        this.targetX  = BOUNDS_MIN + Math.random() * (BOUNDS_MAX - BOUNDS_MIN);
        this.targetY  = yMin + Math.random() * (yMax - yMin);
        const dx      = this.targetX - this.sprite.x;
        this.sprite.setFlipX(dx < 0);
        this.sprite.play({ key: `${this.prefix}-walk-anim`, repeat: -1 });
        break;
      }

      case 'idle':
        this.sprite.play({ key: `${this.prefix}-idle-anim`, repeat: -1 });
        this.stateDuration = 5000 + Math.random() * 7000;  // 5–12 s
        break;

      case 'sit':
        this.sprite.stop();
        this.sprite.setTexture(`${this.prefix}-sit`).setFrame(0);
        this.stateDuration = 6000 + Math.random() * 8000;  // 6–14 s
        break;

      case 'sleep':
        this.sprite.stop();
        this.sprite.setTexture(`${this.prefix}-sleep`).setFrame(0);
        this.stateDuration = 10000 + Math.random() * 12000; // 10–22 s
        break;

      case 'lay':
        this.sprite.play({ key: `${this.prefix}-lay-anim`, repeat: 0 });
        this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (!this.sprite?.active || this.state !== 'lay') return;
          const finalFrame = Math.max(0, (this.animFrameCounts.lay ?? 1) - 1);
          this.sprite.stop();
          this.sprite.setTexture(`${this.prefix}-lay`).setFrame(finalFrame);
        });
        this.stateDuration = 7000 + Math.random() * 8000;  // 7–15 s
        this.layCooldown = LAY_COOLDOWN_MS;
        break;

      case 'stretch':
        this.sprite.play({ key: `${this.prefix}-stretch-anim`, repeat: 0 });
        this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.transitionFrom('stretch'));
        break;

      case 'lick': {
        const which = Math.random() < 0.5 ? 'lick1' : 'lick2';
        this.sprite.play({ key: `${this.prefix}-${which}-anim`, repeat: 2 }); // 3 loops
        this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.transitionFrom('lick'));
        break;
      }

      case 'itch':
        this.sprite.play({ key: `${this.prefix}-itch-anim`, repeat: 4 }); // 5 loops
        this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.transitionFrom('itch'));
        break;

      case 'emote': {
        const emoteKey = this.species === 'dog' ? 'bark' : 'meow';
        this.sprite.play({ key: `${this.prefix}-${emoteKey}-anim`, repeat: 1 }); // 2 loops
        this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => this.transitionFrom('emote'));
        break;
      }
    }
  }

  private transitionFrom(state: PetState): void {
    if (!this.sprite?.active) return;
    const r = Math.random();

    switch (state) {
      case 'walk':
        if (r < 0.40)      this.enterState('idle');
        else if (r < 0.60) this.enterState('sit');
        else if (r < 0.75) this.enterState('itch');
        else if (r < 0.90) this.enterState('lick');
        else               this.enterState('emote');
        break;

      case 'idle':
        if (r < 0.40)      this.enterState('walk');
        else if (r < 0.60) this.enterState('sit');
        else if (r < 0.72) this.enterState('stretch');
        else if (r < 0.82) this.enterState('lick');
        else if (r < 0.92) this.enterState('itch');
        else               this.enterState('emote');
        break;

      case 'sit':
        if (this.previousState === 'lay') {
          if (r < 0.45)      this.enterState('idle');
          else if (r < 0.75) this.enterState('walk');
          else if (r < 0.90) this.enterState('sleep');
          else               this.enterState('lick');
        } else {
          if (r < 0.40)      this.enterState('idle');
          else if (r < 0.60 && this.layCooldown <= 0) this.enterState('lay');
          else if (r < 0.80) this.enterState('sleep');
          else               this.enterState('lick');
        }
        break;

      case 'lay':
        if (r < 0.45)      this.enterState('idle');
        else if (r < 0.80) this.enterState('walk');
        else if (r < 0.92) this.enterState('stretch');
        else               this.enterState('sleep');
        break;

      case 'sleep':
        this.enterState('idle');
        break;

      case 'stretch':
      case 'lick':
      case 'itch':
      case 'emote':
        if (r < 0.70) this.enterState('idle');
        else          this.enterState('sit');
        break;
    }
  }

  destroy(): void {
    if (this.sprite?.active) {
      this.sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE);
      this.sprite.destroy();
    }
  }
}
