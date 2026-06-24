// The 'sparkler' ACCESSORY, rendered live: a crackling spark shower + flickering
// burning bead held at the avatar's hand. Unlike the PNG accessories (baked into
// the avatar canvas), this is an overlay emitter that follows the player each
// frame — one per player wearing it (local + others nearby).
import Phaser from 'phaser';

const SPARK_TEX = 'spark_dot';

function ensureSparkTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SPARK_TEX)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, 2, 2);
  g.generateTexture(SPARK_TEX, 2, 2);
  g.destroy();
}

export class HandSparkler {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private g: Phaser.GameObjects.Graphics;
  private readonly s: number;
  private readonly seed = Math.random() * 1000;

  constructor(scene: Phaser.Scene, depth: number, spriteScale: number) {
    ensureSparkTexture(scene);
    const s = this.s = Math.max(0.35, spriteScale);
    this.g = scene.add.graphics().setDepth(depth);
    this.emitter = scene.add.particles(0, 0, SPARK_TEX, {
      speed:    { min: 10 * s, max: 40 * s },
      angle:    { min: 0, max: 360 },   // sparks in all directions
      lifespan: { min: 90, max: 240 },  // very short → crackle
      scale:    { start: 0.7 * s, end: 0 },
      alpha:    { start: 1, end: 0 },
      tint:     [0xffffff, 0xfff0c0, 0xffd060, 0xff6060, 0x80a0ff], // white/gold + faint red/blue
      gravityY: 55 * s,                  // sparks arc and fall
      frequency: 24,
      quantity:  1,
      blendMode: 'ADD',
    }).setDepth(depth);
  }

  /** Held at the hand (handX, handY): a HORIZONTAL wooden stick points out to the
   *  side (dir = -1 left / +1 right, away from the body), burning bead at the tip. */
  update(time: number, handX: number, handY: number, dir: number, depth: number): void {
    const s = this.s;
    const stickLen = 9 * s;
    const tipX = handX + dir * stickLen; // bead at the outer end
    this.emitter.setPosition(tipX, handY).setDepth(depth);
    this.g.setDepth(depth);
    this.g.clear();
    // Horizontal wooden stick from the hand outward to the burning tip. Drawn as a
    // fillRect (not strokePath): a sub-1px stroked horizontal line at a STATIC sub-pixel
    // Y rounds away to nothing on the small hub avatar (reappears only while the walk-bob
    // nudges it across pixel rows). A min-1px filled rect always renders.
    const w = Math.max(1, 1.6 * s);
    this.g.fillStyle(0x6b4a2a, 1);
    this.g.fillRect(Math.min(handX, tipX), handY - w / 2, stickLen, w);
    // Burning bead — flickers in size + brightness (sputter).
    const f = Math.min(1, 0.6 + Math.sin(time * 0.03 + this.seed) * 0.25 + Math.random() * 0.15);
    this.g.fillStyle(0xffe080, 0.3 * f);
    this.g.fillCircle(tipX, handY, (2.6 + f * 1.4) * s); // soft glow
    this.g.fillStyle(0xffffff, f);
    this.g.fillCircle(tipX, handY, (1.1 + f * 0.7) * s); // hot core
  }

  destroy(): void {
    this.emitter.destroy();
    this.g.destroy();
  }
}
