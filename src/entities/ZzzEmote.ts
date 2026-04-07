/** ZzzEmote — sleeping Z's drift upward. Stops when the player moves. */
import Phaser from 'phaser';
import { BaseEmote } from './EmoteSet';

interface ZParticle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; startSz: number;
}

export class ZzzEmote implements BaseEmote {
  private zs: ZParticle[] = [];
  private timer = 0;
  private spawnTimer = 0;
  private idx = 0;
  private _active = false;
  readonly stopsOnMove = true;
  private readonly duration = 20000;

  get active(): boolean { return this._active; }
  start(): void { this._active = true; this.timer = 0; this.spawnTimer = 0; this.zs = []; this.idx = 0; }
  stop(): void  { this._active = false; this.timer = 0; this.zs = []; }

  private drawZ(g: Phaser.GameObjects.Graphics, zx: number, zy: number, sz: number, alpha: number): void {
    const w  = sz * 6;
    const h  = sz * 8;
    const th = Math.max(1, sz);
    g.fillStyle(0xaaddff, alpha);
    // Top bar
    g.fillRect(zx, zy, w, th);
    // Bottom bar
    g.fillRect(zx, zy + h, w, th);
    // Diagonal approximated with small steps
    const steps = Math.max(4, Math.round(h / th));
    for (let s = 0; s <= steps; s++) {
      const t  = s / steps;
      const dx = (w - th) * (1 - t);
      const dy = h * t;
      g.fillRect(zx + dx, zy + dy, th, th);
    }
  }

  update(g: Phaser.GameObjects.Graphics, delta: number, px: number, py: number, _fr: boolean, scale: 'hub' | 'cabin' | 'room'): boolean {
    if (!this._active) return false;
    this.timer += delta;
    if (this.timer > this.duration) { this.stop(); return false; }
    this.spawnTimer += delta;

    const isRoom  = scale === 'room';
    const isCabin = scale === 'cabin';
    const spawnInterval = 1200 - this.idx * 40; // slight speedup
    if (this.spawnTimer >= Math.max(600, spawnInterval)) {
      this.spawnTimer = 0;
      const side = (this.idx % 3) - 1; // -1, 0, 1
      this.zs.push({
        x: px + side * (isRoom ? 8 : isCabin ? 7 : 5) + (Math.random() - 0.5) * (isRoom ? 6 : isCabin ? 5 : 4),
        y: py - (isRoom ? 152 : isCabin ? 88 : 44),
        vx: (isRoom ? 0.14 : isCabin ? 0.12 : 0.09) * (1 + Math.random() * 0.4),
        vy: -(isRoom ? 0.28 : isCabin ? 0.23 : 0.18) - Math.random() * 0.1,
        life: 0,
        maxLife: 2600 + Math.random() * 600,
        startSz: isRoom ? 1.5 : isCabin ? 1.3 : 1,
      });
      this.idx++;
    }

    const dt = delta / 16;
    for (let i = this.zs.length - 1; i >= 0; i--) {
      const z = this.zs[i];
      z.x += z.vx * dt;
      z.y += z.vy * dt;
      z.life += delta;
      const prog = z.life / z.maxLife;
      if (prog >= 1) { this.zs.splice(i, 1); continue; }
      const alpha = prog < 0.1 ? (prog / 0.1) * 0.8 : (1 - prog) * 0.8;
      const sz = z.startSz + prog * (isRoom ? 1.2 : isCabin ? 1.0 : 0.8);
      this.drawZ(g, z.x, z.y, sz, alpha);
    }
    return true;
  }
}
