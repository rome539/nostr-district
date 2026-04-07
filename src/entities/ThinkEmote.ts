/** ThinkEmote — a pulsing thought bubble with "..." above the player. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

export class ThinkEmote implements BaseEmote {
  private timer = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 10000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; }
  stop(): void  { this._active = false; this.timer = 0; }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    // Slow pulse 0.7 – 1.0
    const pulse = 0.7 + Math.sin(this.timer * 0.003) * 0.15;

    // Bubble trail dots — three small circles leading from head to cloud
    const trailOffX = isRoom ? 12 : isCabin ? 10 : 7;
    const trailOffY = isRoom ? -148 : isCabin ? -83 : -43;
    const trailRads = isRoom ? [3, 4, 5] : isCabin ? [2, 2.5, 3] : [1.5, 2, 2.5];
    g.fillStyle(0xddeeff, pulse * 0.8);
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      g.fillCircle(
        px + trailOffX + t * (isRoom ? 12 : isCabin ? 10 : 7),
        py + trailOffY - t * (isRoom ? 10 : isCabin ? 8 : 6),
        trailRads[i],
      );
    }

    // Thought cloud oval — several overlapping circles
    const cloudX  = px + (isRoom ? 38 : isCabin ? 32 : 22);
    const cloudY  = py + (isRoom ? -176 : isCabin ? -110 : -62);
    const cloudRX = isRoom ? 22 : isCabin ? 18 : 13;
    const cloudRY = isRoom ? 14 : isCabin ? 11 : 8;

    g.fillStyle(0xddeeff, pulse * 0.75);
    // Approximate ellipse with 5 circles along X axis
    for (let i = 0; i <= 4; i++) {
      const t  = i / 4;
      const ox = (t - 0.5) * cloudRX * 2;
      const ry = cloudRY * Math.sqrt(1 - ((t - 0.5) * 2) ** 2 + 0.001);
      g.fillCircle(cloudX + ox, cloudY, ry);
    }

    // "..." dots inside the cloud
    const dotR   = isRoom ? 2 : isCabin ? 1.7 : 1.2;
    const dotGap = isRoom ? 6 : isCabin ? 5 : 3.5;
    const dotPulse = 0.6 + Math.sin(this.timer * 0.006) * 0.4;
    g.fillStyle(0x6699cc, dotPulse * 0.9);
    for (let d = -1; d <= 1; d++) {
      g.fillCircle(cloudX + d * dotGap, cloudY + 1, dotR);
    }
    return true;
  }
}
