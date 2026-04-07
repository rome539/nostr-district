/** FireEmote — orange/red flame particles rise from the player's feet. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

interface Flame {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; phase: number;
}

export class FireEmote implements BaseEmote {
  private flames: Flame[] = [];
  private timer = 0;
  private _active = false;
  readonly stopsOnMove = false;
  private readonly duration = 8000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; this.flames = []; }
  stop(): void  { this._active = false; this.timer = 0; this.flames = []; }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    const fade    = this.timer > this.duration - 1500 ? (this.duration - this.timer) / 1500 : 1;

    // Spawn flames at feet
    if (Math.random() > 0.35) {
      const spreadX = isRoom ? 18 : isCabin ? 15 : 11;
      this.flames.push({
        x: px + (Math.random() - 0.5) * spreadX * 2,
        y: py - 4,
        vx: (Math.random() - 0.5) * (isRoom ? 0.5 : isCabin ? 0.42 : 0.32),
        vy: -(isRoom ? 0.7 : isCabin ? 0.58 : 0.44) - Math.random() * (isRoom ? 0.8 : isCabin ? 0.65 : 0.5),
        life: 0,
        maxLife: (isRoom ? 700 : isCabin ? 600 : 500) + Math.random() * (isRoom ? 500 : isCabin ? 400 : 300),
        size: isRoom ? 3 + Math.random() * 3 : isCabin ? 2.5 + Math.random() * 2.5 : 2 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const dt = delta / 16;
    for (let i = this.flames.length - 1; i >= 0; i--) {
      const f = this.flames[i];
      f.x += (f.vx + Math.sin(f.life * 0.01 + f.phase) * 0.1) * dt;
      f.y += f.vy * dt;
      f.life += delta;
      const prog = f.life / f.maxLife;
      if (prog >= 1) { this.flames.splice(i, 1); continue; }

      const alpha = (1 - prog) * fade * 0.85;
      const sz    = f.size * (1 - prog * 0.6);

      // Inner core: yellow-white
      g.fillStyle(0xffee88, alpha);
      g.fillCircle(f.x, f.y, sz * 0.45);
      // Mid: orange
      g.fillStyle(0xff8822, alpha * 0.75);
      g.fillCircle(f.x, f.y, sz * 0.75);
      // Outer: red
      g.fillStyle(0xcc2200, alpha * 0.4);
      g.fillCircle(f.x, f.y, sz);
    }
    if (this.flames.length > 40) this.flames = this.flames.slice(-30);
    return true;
  }
}
