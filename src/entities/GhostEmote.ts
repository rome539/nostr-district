/** GhostEmote — translucent orbs drift upward with eerie wobble. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

interface Orb {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; r: number; phase: number;
}

export class GhostEmote implements BaseEmote {
  private orbs: Orb[] = [];
  private timer = 0;
  private spawnTimer = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 10000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; this.spawnTimer = 0; this.orbs = []; }
  stop(): void  { this._active = false; this.timer = 0; this.orbs = []; }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }
    this.spawnTimer += delta;

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    if (this.spawnTimer >= 700) {
      this.spawnTimer = 0;
      this.orbs.push({
        x: px + (Math.random() - 0.5) * (isRoom ? 24 : isCabin ? 20 : 14),
        y: py - (isRoom ? 20 : isCabin ? 14 : 8),
        vx: (Math.random() - 0.5) * (isRoom ? 0.2 : isCabin ? 0.17 : 0.12),
        vy: -(isRoom ? 0.35 : isCabin ? 0.28 : 0.22) - Math.random() * 0.15,
        life: 0,
        maxLife: 2200 + Math.random() * 800,
        r: isRoom ? 5 + Math.random() * 4 : isCabin ? 4 + Math.random() * 3 : 3 + Math.random() * 2.5,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const dt = delta / 16;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.x += (o.vx + Math.sin(o.life * 0.003 + o.phase) * 0.08) * dt;
      o.y += o.vy * dt;
      o.life += delta;
      const prog = o.life / o.maxLife;
      if (prog >= 1) { this.orbs.splice(i, 1); continue; }

      const alpha = prog < 0.2 ? (prog / 0.2) * 0.5 : (1 - prog) * 0.5;
      // Outer glow
      g.fillStyle(0xccddff, alpha * 0.3);
      g.fillCircle(o.x, o.y, o.r * 1.6);
      // Main orb
      g.fillStyle(0xeef2ff, alpha * 0.6);
      g.fillCircle(o.x, o.y, o.r);
      // Core highlight
      g.fillStyle(0xffffff, alpha * 0.4);
      g.fillCircle(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.4);
    }
    return true;
  }
}
