// Fireworks AURA — drives the real FireworksEngine (the same one the sky uses,
// shapes and all) inside a small box that follows a player's head, so the aura
// pops tiny shaped shells (ring/star/heart/₿/ostrich) instead of a flat dot burst.
//
// The engine works in its own local box coords; we draw into a Graphics object
// that we position + scale above the head each frame, so the box renders just
// over the player and scales with sprite size.
import Phaser from 'phaser';
import { FireworksEngine, drawFireworksPhaser } from '../utils/fireworks';

const BOX_W = 64;
const BOX_H = 58;

export class AuraFireworks {
  private g: Phaser.GameObjects.Graphics;
  private engine: FireworksEngine;
  private s: number;

  constructor(scene: Phaser.Scene, depth: number, spriteScale: number) {
    this.s = spriteScale;
    this.g = scene.add.graphics().setDepth(depth);
    this.engine = new FireworksEngine(BOX_W, BOX_H, {
      launchY:        BOX_H,
      explodeYMin:    6,
      explodeYMax:    BOX_H * 0.42,
      xMin:           12,
      xMax:           BOX_W - 12,
      intervalMin:    1100,
      intervalMax:    1700,
      particleRadius: 0.5,
      explosionCount: 7,
      explosionSpeed: 1.0,
      shapes:         ['burst'],
    });
  }

  /** Tick + redraw, with the box's bottom centred on (x, headY). */
  update(time: number, delta: number, x: number, headY: number, depth: number): void {
    this.g.setDepth(depth);
    this.g.setScale(this.s);
    this.g.setPosition(x - (BOX_W * this.s) / 2, headY - BOX_H * this.s);
    this.engine.tick(time, delta);
    this.g.clear();
    drawFireworksPhaser(this.g, this.engine);
  }

  destroy(): void {
    this.g.destroy();
  }
}
