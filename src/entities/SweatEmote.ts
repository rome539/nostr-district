/** SweatEmote — blue sweat drops slide down from the player's temples. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

interface Drop {
  x: number; y: number; vy: number;
  life: number; maxLife: number; r: number;
}

export class SweatEmote implements BaseEmote {
  private drops: Drop[] = [];
  private timer = 0;
  private spawnTimer = 0;
  private idx = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 8000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; this.spawnTimer = 0; this.drops = []; this.idx = 0; }
  stop(): void  { this._active = false; this.timer = 0; this.drops = []; }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }
    this.spawnTimer += delta;

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    if (this.spawnTimer >= 700) {
      this.spawnTimer = 0;
      const side = this.idx % 2 === 0 ? -1 : 1;
      const templeX = px + side * (isRoom ? 18 : isCabin ? 14 : 9);
      const templeY = py - (isRoom ? 128 : isCabin ? 68 : 34);
      this.drops.push({
        x: templeX,
        y: templeY,
        vy: isRoom ? 0.45 : isCabin ? 0.36 : 0.28,
        life: 0,
        maxLife: 1400 + Math.random() * 400,
        r: isRoom ? 2.5 + Math.random() : isCabin ? 2 + Math.random() * 0.7 : 1.5 + Math.random() * 0.5,
      });
      this.idx++;
    }

    const dt = delta / 16;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y += d.vy * dt;
      d.life += delta;
      const prog = d.life / d.maxLife;
      if (prog >= 1) { this.drops.splice(i, 1); continue; }
      const alpha = prog < 0.1 ? (prog / 0.1) * 0.85 : (1 - prog) * 0.85;
      // Elongate circle to look like a falling drop
      g.fillStyle(0x55aaff, alpha);
      g.fillCircle(d.x, d.y, d.r);
      g.fillTriangle(
        d.x - d.r * 0.7, d.y,
        d.x + d.r * 0.7, d.y,
        d.x,              d.y + d.r * 1.8,
      );
    }
    return true;
  }
}
